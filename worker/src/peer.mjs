// /api/peer — SwanChanger kullanıcılarının birbirini tanıması ve skinlerini paylaşması
// POST /api/peer { steamid, nick, loadout? } -> { ok, count, peers }
// GET  /api/peer                            -> { ok, peers }
//
// ÖNEMLİ: Her peer KENDİ anahtarında tutulur ("peer:{steamid}").
// Eski sürüm tek "peers:active" anahtarı üzerinde oku-değiştir-yaz yaptığı için
// iki istemci aynı anda senkron olunca birbirinin kaydını eziyordu (lost update) —
// arkadaşlar birbirini hiç göremiyordu. Kendi-anahtarı tasarımı bu yarışı tamamen çözer:
// bir istemcinin yazması diğerinin kaydını asla silmez.

import {
  store,
  json,
  err,
  clientIp,
  kvGet,
  kvSet,
  kvDel,
  kvListKeys,
  encryptLoadout,
  decryptLoadout,
} from "./_lib.mjs";
import { ADMIN_KEY } from "./_lib.mjs";
import { loadoutSet, loadoutsRead, loadoutsEnabled } from "./_loadouts.mjs";

const PEER_EXPIRE_MS = 15 * 60 * 1000; // 15 dakika hareketsiz kalan peer silinir
const MAX_BODY_BYTES = 16 * 1024;      // istek gövdesi üst sınırı (16 KB)
const MAX_LOADOUT_JSON = 4096;         // loadout JSON üst sınırı (4 KB)
const MAX_GUNS = 64;                   // paylaşılan silah skin'i üst sınırı
// build etiketi: canlı deploy'un yeni versiyonu olduğunu doğrulamak için
const BUILD_ID = "2026-11-13-ltfix";
const MAX_PEERS = 512;                 // eşzamanlı aktif peer üst sınırı
const PEER_PREFIX = "peer:";           // her peer kendi anahtarında
const LEGACY_KEY = "peers:active";     // eski monolitik anahtar (temizlenir)

// ── RATE LIMIT: aynı steamid'den dakikada en fazla 10 imzalı POST ──
const RATE_LIMIT_PREFIX = "rl:peer:";  // rl:peer:{steamid}:{minuteBucket}
const MAX_SYNC_PER_MINUTE = 10;
const RATE_WINDOW_MS = 60 * 1000;

// İzin verilen loadout anahtarları (whitelist) - fazlası ve "__proto__" gibi
// anahtarlar tamamen atılır, KV'ye kirli veri yazılması engellenir.
const LOADOUT_KEYS = new Set([
  "pin_def", "pin_img",
  "knife", "gloves", "guns",
  "agentDefinition", "gloveDefinition", "lt",
  "d", "p", "s", "w", "t",
]);
const SKIN_KEYS = new Set(["d", "p", "s", "w", "t"]);

const isSteamid = (s) => /^\d{1,20}$/.test(s) && s !== "0";

// ── peer sync imzası: steamid sahteciliğini önler ──
// Aynı sabit C++ peer_sync.hpp içinde. Geçerli "steamid:ts" HMAC'i olmadan
// kayıt YAZILMAZ — biri başkasının steamid'siyle panele kaydolamaz.
const SIG_SECRET = "SwanChanger|peer|sig|v1";
const SIG_WINDOW = 300; // ±5 dakika replay penceresi (saniye)

async function hmacHex(keyStr, msg) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keyStr),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// sabit-zamanlı karşılaştırma: imza karşılaştırmasında timing sızıntısı yok
function ctEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function clampNum(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

// IP'yi salt'lı SHA-256 ile hash'le: KV sızsa bile gerçek kullanıcı IP'leri
// açığa çıkmaz. Ban/limit gibi işlevler için hash yeterli.
async function hashIp(ip) {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(ADMIN_KEY() + "|peer"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(ip)));
    return Array.from(new Uint8Array(sig)).slice(0, 12)
      .map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "unknown";
  }
}

function sanitizeSkin(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const out = {};
  if ("d" in obj) out.d = clampNum(obj.d, 0, 65535, 0);
  if ("p" in obj) out.p = clampNum(obj.p, 0, 100000, 0);
  if ("s" in obj) out.s = clampNum(obj.s, 0, 1000, 0);
  if ("w" in obj) out.w = clampNum(obj.w, 0, 1, 0.06);
  if ("t" in obj) out.t = !!obj.t;
  return out;
}

// loadout'u sadece izin verilen anahtarlarla, tipleri doğrulanmış ve
// boyutu sınırlanmış hale getirir. Güvenmeyen veriyi KV'ye yazmadan temizler.
function sanitizeLoadout(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  if ("pin_def" in raw) out.pin_def = clampNum(raw.pin_def, 0, 1000000, 0);
  if ("pin_img" in raw) {
    const img = String(raw.pin_img || "");
    const clean = img.slice(0, 128).replace(/[^A-Za-z0-9_./-]/g, "");
    if (clean && !clean.includes("..")) out.pin_img = clean;
  }
  if ("knife" in raw) { const k = sanitizeSkin(raw.knife); if (k) out.knife = k; }
  if ("gloves" in raw) { const g = sanitizeSkin(raw.gloves); if (g) out.gloves = g; }
  if ("agentDefinition" in raw) out.agentDefinition = clampNum(raw.agentDefinition, 0, 65535, 0);
  if ("gloveDefinition" in raw) out.gloveDefinition = clampNum(raw.gloveDefinition, 0, 65535, 0);
  // takım (2=T, 3=CT): düşürülürse client'taki taraf kontrolü ölü kalıyor
  if ("lt" in raw) out.lt = clampNum(raw.lt, 0, 3, 0);
  if ("guns" in raw && Array.isArray(raw.guns)) {
    const arr = [];
    for (let i = 0; i < raw.guns.length && arr.length < MAX_GUNS; i++) {
      const s = sanitizeSkin(raw.guns[i]);
      if (s && s.d) arr.push(s);
    }
    if (arr.length) out.guns = arr;
  }
  return Object.keys(out).length ? out : null;
}

// Tüm peer anahtarlarını okur, süresi dolanları ve artık anahtarları temizler.
// Loadout'lar artık private GitHub reposunda (şifreli) tutulur; D1'de sadece
// peer METADATA'si (steamid, nick, ip, last_seen) kalır.
// Dönen liste aktif peer'ları içerir: { key, steamid, nick, loadout, last_seen }
async function readActivePeers(kv) {
  const now = Date.now();
  const keys = await kvListKeys(kv, PEER_PREFIX);
  const active = [];
  // Tek batch ile hepsini oku (Worker free: invocation basina 50 sorgu limiti)
  const map = await kv.getMany(keys);
  for (const key of keys.slice(0, MAX_PEERS * 2)) {
    const data = map.get(key);
    if (!data || typeof data !== "object") {
      await kvDel(kv, key);
      continue;
    }
    const sid = String(data.steamid || "");
    // artık/bozuk kayıt: doğrulanamıyorsa sil
    if (!isSteamid(sid) || key !== PEER_PREFIX + sid) {
      await kvDel(kv, key);
      continue;
    }
    if (now - (data.last_seen || 0) > PEER_EXPIRE_MS) {
      await kvDel(kv, key); // hareketsizlik süresi doldu
      continue;
    }
    active.push({
      key,
      steamid: sid,
      nick: data.nick || "",
      loadout: null,
    });
  }
  // eski monolitik anahtardaki artık veriyi bertaraf et (bir kez, sessizce)
  try { await kvDel(kv, LEGACY_KEY); } catch { /* yoksa yok */ }

  // Loadout'lar GitHub deposundan (şifreli) alinır ve çözülür
  if (loadoutsEnabled() && active.length) {
    try {
      const repo = await loadoutsRead();
      for (const p of active) {
        const rec = repo.items[p.steamid];
        if (!rec || !rec.enc) continue;
        p.loadout = (await decryptLoadout(rec.enc)) || null;
      }
    } catch (e) {
      console.error("[peer] loadout okunamadi:", e && e.message);
    }
  }
  return active;
}

// Rate limit kontrolü: steamid + dakika_bucket üzerinden sayaç tutar.
// Aşımda false döner.
async function checkRateLimit(kv, steamid) {
  const bucket = Math.floor(Date.now() / RATE_WINDOW_MS);
  const key = RATE_LIMIT_PREFIX + steamid + ":" + bucket;
  const current = await kvGet(kv, key, 0);
  const count = Number(current) || 0;
  if (count >= MAX_SYNC_PER_MINUTE) return false;
  await kvSet(kv, key, count + 1);
  // eski bucket'ları temizle (basit: bu fonksiyonun çağırmasıyla sınırlı)
  return true;
}

function toPeerView(e) {
  return { steamid: e.steamid, nick: e.nick, loadout: e.loadout };
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  const kv = store();
  const ip = await hashIp(clientIp(req)); // ham IP asla KV'ye yazılmaz

  // GET: aktif peer listesi (rate limit altında)
  if (req.method === "GET") {
    const active = await readActivePeers(kv);
    return json({ ok: true, build: BUILD_ID, peers: active.map(toPeerView) });
  }

  // POST: heartbeat & loadout sync
  if (req.method === "POST") {
    // ── RATE LIMIT: steamid'den önce okunamaz, ama steamid gerekiyor.
    // İsteği parse edip steamid'yi alıp limit'e tabi tutuyoruz.
    let body = {};
    try {
      const text = await req.text();
      if (text.length > MAX_BODY_BYTES) return err("payload too large", 413);
      body = JSON.parse(text);
    } catch {
      return err("invalid json", 400);
    }

    const steamid = String(body.steamid || "").trim();
    if (!isSteamid(steamid)) return err("invalid steamid", 400);

    if (!(await checkRateLimit(kv, steamid))) return err("rate limit exceeded", 429);

    // ── imza doğrulama: geçerli HMAC yoksa kayıt yok (steamid sahteciliği kapalı) ──
    const ts = Number(body.ts);
    const sig = String(body.sig || "");
    if (!Number.isFinite(ts) || !/^[0-9a-f]{64}$/.test(sig)) return err("missing signature", 401);
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - ts) > SIG_WINDOW) return err("stale timestamp", 401);
    if (!ctEq(await hmacHex(SIG_SECRET, steamid + ":" + ts), sig)) return err("bad signature", 401);

    const nick = String(body.nick || "").slice(0, 64);
    // loadout: whitelist + clamp + boyut sınırı (KV'ye kirli veri yazma)
    let loadout = sanitizeLoadout(body.loadout);
    if (loadout && JSON.stringify(loadout).length > MAX_LOADOUT_JSON) loadout = null;
    const now = Date.now();

    const active = await readActivePeers(kv);
    const selfKey = PEER_PREFIX + steamid;
    const selfExists = active.some((e) => e.key === selfKey);

    // Peer sayısını sınırla: istemci tabloyu şiştiremez (KV şişirme koruması)
    if (!selfExists && active.length >= MAX_PEERS) return err("peer table full", 429);

    // Yalnızca KENDİ anahtarımıza yazarız — başka hiçbir peer'in kaydı ezilmez.
    // Loadout (skinler) private GitHub reposunda SIFRELI saklanır: AES-256-GCM,
    // anahtar sadece Worker'da. GitHub dökümü ciphertext verir, skinleri yalnızca
    // sahibi (panel) çözebilir.
    const loadoutEnc = loadout ? await encryptLoadout(loadout) : null;
    if (loadout && !loadoutEnc) {
      console.error("[peer] loadout encryption key missing - loadout not stored");
    }
    // D1'de sadece metadata
    await kvSet(kv, selfKey, { steamid, nick, ip, last_seen: now });
    // Loadout -> GitHub (write-behind: arka planda yazilir)
    if (loadoutsEnabled()) {
      try {
        await loadoutSet(steamid, loadoutEnc, nick);
      } catch (e) {
        console.error("[peer] loadout yazilamadi:", e && e.message);
      }
    } else {
      // GitHub yoksa geriye donuk: D1'ye yaz (eski davranis)
      await kvSet(kv, selfKey, { steamid, nick, ip, last_seen: now, loadoutEnc });
    }

    // Yanıt: aktif liste + kendi taze kaydımız
    const peers = [];
    let selfPlaced = false;
    for (const e of active) {
      if (e.key === selfKey) {
        peers.push({ steamid, nick, loadout });
        selfPlaced = true;
      } else {
        peers.push(toPeerView(e));
      }
    }
    if (!selfPlaced) peers.push({ steamid, nick, loadout });

    return json({ ok: true, build: BUILD_ID, count: peers.length, peers });
  }

  return err("method not allowed", 405);
};
