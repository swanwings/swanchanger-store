// SwanChanger Dashboard — ortak yardımcılar
// Firebase Cloud Functions (2. nesil, Node 22) için yazıldı.
//
// Netlify Blobs (KV) -> Cloud Firestore. Netlify'in @netlify/blobs API'si birebir
// taklit edilir: get(key,{type:"json"}) / setJSON / delete / list({prefix}).
// Böylece report/keys/peer/list/users/... dosyaları mantık değişmeden çalışır.
//
// Loadout'lar (skinler) Firestore'da SIFRELI tutulur: AES-256-GCM, anahtar sadece
// sunucuda (LOADOUT_KEY secret'i ya da admin/session secret'ından türetilir).
// Firestore kuralları da istemciye tamamen kapalı -> veritabanı dökümü bile
// ciphertext görür, skinleri yalnızca sahibi (panel) çözebilir.

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createCipheriv, createDecipheriv, createHash, randomBytes, hkdfSync } from "node:crypto";

// ------------------------------------------------------------------ Firestore

let db = null;

function firestore() {
  if (!db) {
    if (!getApps().length) {
      initializeApp({ projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "swanchanger" });
    }
    db = getFirestore();
  }
  return db;
}

const KV_COLLECTION = "kv";

// Firestore dokuman ID'si: KV anahtarlari "/" iceremez, ama base64url ile
// her zaman guvenli (kisa anahtar, 1500 baytlik ID limitinin cok altinda).
const docId = (key) => Buffer.from(String(key), "utf8").toString("base64url");

// Firestore tek dokuman en fazla 1 MiB kabul eder. DLL (base64) ~21 MB oldugu
// icin buyuk degerler otomatik olarak parcalara bolunur:
//   anahtar        -> { __big: 1, chunks: N, size, sha256 }
//   anahtar::part:i-> { d: "<parca metni>" }
// get() bunlari birlestirip eski API'yi aynen taklit eder.
const BIG_MARK = "__big";
const PART_SEP = "::part:";
const CHUNK_CHARS = 700_000; // ~700 KB (1 MiB sinirina guvenli pay)

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Firestore "undefined" / "NaN" degerlerini kabul ETMEZ; Netlify Blobs (JSON)
// ise undefined alanlari sessizce dusururdu. Ayni davranisi taklit ediyoruz,
// yoksa report.mjs gibi "ban_reason: undefined" yazan handler'lar 500 verir.
function sanitize(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "function" || typeof value === "symbol") return null;
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : sanitize(v)));
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = sanitize(v);
    }
    return out;
  }
  return value;
}

// Netlify Blobs API'sinin aynisi (Firestore uzerinde).
export const store = () => ({
  async get(key, opts = {}) {
    try {
      const snap = await firestore().collection(KV_COLLECTION).doc(docId(key)).get();
      if (!snap.exists) return null;
      const data = snap.data() || {};
      const value = "v" in data ? data.v : null;

      // buyuk deger: parcalari birlestir
      if (value && typeof value === "object" && value[BIG_MARK]) {
        if (opts && opts.type === "metadata") {
          // meta: degerin icindeki gercek sha256 (orn. DLL'in binary hash'i)
          const meta = value.meta && typeof value.meta === "object" ? value.meta : null;
          return {
            metadata: {
              sha256: (meta && meta.sha256) || value.sha256 || "",
              size: (meta && meta.size) || value.size || 0,
            },
          };
        }
        const text = await readParts(key, value.chunks || 0);
        if (text === null) return null;
        if (opts && opts.type === "json") {
          try {
            return JSON.parse(text);
          } catch {
            return null;
          }
        }
        return text;
      }

      if (opts && opts.type === "json") return value === undefined ? null : value;
      return value;
    } catch {
      return null;
    }
  },

  async setJSON(key, value) {
    // Netlify Blobs davranisi: setJSON tamamen DEGISTIRIR (merge yok).
    const text = JSON.stringify(value === undefined ? null : value);
    if (text && text.length > CHUNK_CHARS) {
      // 1) eski parcalari temizle
      await deleteParts(key);
      // 2) parcalari yaz
      const chunks = Math.ceil(text.length / CHUNK_CHARS);
      for (let i = 0; i < chunks; i++) {
        const part = text.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS);
        await firestore()
          .collection(KV_COLLECTION)
          .doc(docId(`${key}${PART_SEP}${i}`))
          .set({ k: `${key}${PART_SEP}${i}`, v: { d: part }, u: Date.now() });
      }
      // 3) isaretci dokumani
      const meta =
        value && typeof value === "object" && !Array.isArray(value) && typeof value.sha256 === "string"
          ? { sha256: value.sha256, size: value.size ?? 0 }
          : null;
      await firestore().collection(KV_COLLECTION).doc(docId(key)).set({
        k: String(key),
        v: {
          [BIG_MARK]: 1,
          chunks,
          size: text.length,
          sha256: sha256Hex(text),
          ...(meta ? { meta } : {}),
        },
        u: Date.now(),
      });
      return;
    }

    await firestore().collection(KV_COLLECTION).doc(docId(key)).set({
      k: String(key),
      v: sanitize(value),
      u: Date.now(),
    });
  },

  async delete(key) {
    try {
      await firestore().collection(KV_COLLECTION).doc(docId(key)).delete();
      await deleteParts(key);
    } catch {
      /* sessiz */
    }
  },

  async list({ prefix = "", limit = 2000 } = {}) {
    let query = firestore().collection(KV_COLLECTION);
    if (prefix) {
      query = query.where("k", ">=", prefix).where("k", "<=", `${prefix}\uf8ff`);
    }
    const snap = await query.limit(limit).get();
    const blobs = [];
    for (const doc of snap.docs) {
      const key = doc.get("k");
      // dahili parca anahtarlari listelenmez
      if (typeof key !== "string" || key.includes(PART_SEP)) continue;
      blobs.push({ key });
    }
    return { blobs };
  },
});

// buyuk degerin parcalarini birlestirir
async function readParts(key, chunks) {
  if (!chunks) return null;
  const texts = new Array(chunks);
  const BATCH = 8;
  for (let start = 0; start < chunks; start += BATCH) {
    const idx = [];
    for (let i = start; i < Math.min(start + BATCH, chunks); i++) idx.push(i);
    const docs = await Promise.all(
      idx.map((i) => firestore().collection(KV_COLLECTION).doc(docId(`${key}${PART_SEP}${i}`)).get())
    );
    for (let j = 0; j < idx.length; j++) {
      const d = docs[j].data();
      const part = d && d.v && typeof d.v.d === "string" ? d.v.d : "";
      if (!part && idx[j] < chunks - 1) return null;
      texts[idx[j]] = part;
    }
  }
  return texts.join("");
}

async function deleteParts(key) {
  try {
    const q = firestore()
      .collection(KV_COLLECTION)
      .where("k", ">=", `${key}${PART_SEP}`)
      .where("k", "<=", `${key}${PART_SEP}\uf8ff`);
    const snap = await q.get();
    if (snap.empty) return;
    const batch = firestore().batch();
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
  } catch {
    /* temizlik kritik degil */
  }
}

// ------------------------------------------------------------------ env

export const getEnv = (k, fallback = "") => {
  if (typeof process !== "undefined" && process.env && process.env[k]) return process.env[k];
  return fallback;
};

// ------------------------------------------------------------------ env
export const ADMIN_KEY = () => getEnv("ADMIN_KEY", "");
export const SESSION_SECRET = () => getEnv("SITE_SESSION_SECRET", "") || ADMIN_KEY();

// ---------------------------------------------------------------- auth token
// cookie: base64url(payload).base64url(hmac-sha256(payload, SESSION_SECRET))
// payload = "exp:<unix>"

const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const unb64url = (s) => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "====".slice(t.length % 4 || 4);
  return Uint8Array.from(atob(t + pad), (c) => c.charCodeAt(0));
};

async function hmac(data, key) {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data))
  );
}

export async function makeSession() {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12; // 12 saat
  const payload = `exp:${exp}`;
  const sig = await hmac(payload, SESSION_SECRET());
  return `${b64url(new TextEncoder().encode(payload))}.${b64url(sig)}`;
}

export async function sessionValid(cookieHeader) {
  const m = /(?:^|;\s*)swan_sess=([^;]+)/.exec(cookieHeader || "");
  if (!m) return false;
  const parts = m[1].split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  try {
    const payload = new TextDecoder().decode(unb64url(parts[0]));
    const sig = await hmac(payload, SESSION_SECRET());
    if (b64url(sig) !== parts[1]) return false;
    const exp = Number(payload.replace("exp:", ""));
    return Number.isFinite(exp) && exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export const sessionCookie = (value) =>
  `swan_sess=${value}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=43200`;

// ------------------------------------------------------------------ imzali payload
// Genel amaçlı token: base64url(payload).base64url(hmac-sha256(payload, secret))
// Discord OAuth state'i ve lisans/community durumu için kullanılır.

export async function signPayload(payload, secret = SESSION_SECRET()) {
  const sig = await hmac(payload, secret);
  return `${b64url(new TextEncoder().encode(payload))}.${b64url(sig)}`;
}

export async function verifyPayload(token, secret = SESSION_SECRET()) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const payload = new TextDecoder().decode(unb64url(parts[0]));
    const sig = b64url(await hmac(payload, secret));
    if (sig !== parts[1]) return null;
    return payload;
  } catch {
    return null;
  }
}

export const clearCookie = () =>
  `swan_sess=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

// ------------------------------------------------------------------ helpers

export const json = (body, extra = {}) =>
  new Response(JSON.stringify(body), {
    status: extra.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // DİKKAT: "private" şart. Firebase Hosting edge'i (ve hosting emülatörü)
      // cache-control içinde "private" yoksa Set-Cookie header'ını SİLer.
      // Bu olmadan panel girişi (session cookie) tarayıcıya hiç ulaşmaz.
      "cache-control": "private, no-store",
      ...(extra.headers || {}),
    },
  });

export const err = (msg, status = 400) => json({ error: msg }, { status });
export const unauthorized = () => json({ error: "unauthorized" }, { status: 401 });

export function clientIp(req) {
  return (
    req.headers.get("x-nf-client-connection-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-goog-client-ip") ||
    req.headers.get("client-ip") ||
    req.headers.get("cf-connecting-ip") ||
    "0.0.0.0"
  );
}

export async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

// ------------------------------------------------------- lisans anahtarı
// C++ licensing.hpp ile birebir uyumlu:
//   36 byte → 72 hex karakter (tire dahil: 9 grup x 4 hex = 9x4 + 8 tire)
//   byte 0   = 0x53 ('S' magic)
//   byte 1   = tier (0=trial, 1=monthly, 2=unlimited)
//   byte 2   = dolgu
//   byte 3-6 = expiry (big-endian unix timestamp)
//   byte 7-34= HWID + salt (28 byte)
//   byte 35  = XOR checksum (byte[1] ^ byte[2] ^ ... ^ byte[34])

const HEXC = "0123456789ABCDEF";

export function bareKey(key) {
  return String(key || "")
    .replace(/[^0-9a-fA-F]/g, "")
    .toUpperCase();
}

export function formatKey(bare) {
  // 72 hex → 9 grup x 8 hex, tire ile: XXXX-XXXX-...
  return (bare.match(/.{1,4}/g) || []).join("-");
}

export function isValidBare(bare) {
  return /^[0-9A-F]{72}$/i.test(bare);
}

// C++ key: 36 byte = 72 hex karakter
export function hexToBytes(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16);
  return b;
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (x) => HEXC[x >> 4] + HEXC[x & 0xf]).join("");
}

export function verifyKeyBytes(b) {
  // C++ verify_key_local: key[0]==0x53, then XOR(key[1]..key[34])==key[35]
  if (b.length !== 36) return false;
  if (b[0] !== 0x53) return false;
  let sum = 0;
  for (let i = 1; i < 35; i++) sum ^= b[i];
  return (sum & 0xff) === b[35];
}

export function parseKey(key) {
  const bare = bareKey(key);
  if (bare.length !== 72) return null; // 36 bytes = 72 hex chars
  const b = hexToBytes(bare);
  if (!verifyKeyBytes(b)) return null;
  const expiry = ((b[3] << 24) | (b[4] << 16) | (b[5] << 8) | b[6]) >>> 0;
  return { bare, bytes: b, tier: b[1], expiry };
}

// Anahtar üretimi (C++ parse_key/verify_key_local ile uyumlu)
export function makeKey({ days = 30, tier = 1, hwid = "" }) {
  const b = new Uint8Array(36);
  b[0] = 0x53; // 'S' magic
  b[1] = tier & 0xff;
  b[2] = 0; // dolgu
  const ts = Math.floor(Date.now() / 1000) + days * 86400;
  b[3] = (ts >>> 24) & 0xff;
  b[4] = (ts >>> 16) & 0xff;
  b[5] = (ts >>> 8) & 0xff;
  b[6] = ts & 0xff;
  // byte 7..34: random salt + hwid karıştırma
  const salt = new Uint8Array(28);
  crypto.getRandomValues(salt);
  for (let i = 0; i < 28; i++) {
    let v = salt[i];
    if (hwid && i < hwid.length) v ^= hwid.charCodeAt(i) & 0xff;
    b[7 + i] = v;
  }
  // byte 35: checksum = XOR(byte[1]..byte[34])
  let sum = 0;
  for (let i = 1; i < 35; i++) sum ^= b[i];
  b[35] = sum & 0xff;
  return formatKey(bytesToHex(b));
}

export const TIERS = { 0: "trial", 1: "1 ay", 2: "sınırsız", 3: "ömürlük" };

// ---------------------------------------------------------- KV yardımcıları

export async function kvGet(kv, key, fallback) {
  try {
    const v = await kv.get(key, { type: "json" });
    return v === null || v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

export const kvSet = (kv, key, value) => kv.setJSON(key, value);

export async function kvDel(kv, key) {
  try {
    await kv.delete(key);
  } catch {
    // silent
  }
}

// list ile prefix tarama
export async function kvListKeys(kv, prefix) {
  const results = [];
  const { blobs } = await kv.list({ prefix });
  for (const entry of blobs) {
    results.push(entry.key);
  }
  return results;
}

// ------------------------------------------------ loadout şifreleme (AES-256-GCM)
// Anahtar sadece sunucuda durur:
//   1) LOADOUT_KEY secret'i (base64 ya da 64 haneli hex)
//   2) yoksa SITE_SESSION_SECRET / ADMIN_KEY'den HKDF ile türetilir
//   3) ikisi de yoksa şifreleme yapılmaz (loadout kaydedilmez)

let cachedKey = null;

function loadoutKey() {
  if (cachedKey) return cachedKey;

  const raw = getEnv("LOADOUT_KEY", "");
  if (raw) {
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (buf.length === 32) {
      cachedKey = buf;
      return cachedKey;
    }
  }

  const secret = SESSION_SECRET();
  if (!secret) return null;

  cachedKey = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.from("swanchanger-loadout-v1", "utf8"),
      Buffer.from("loadout", "utf8"),
      32
    )
  );
  return cachedKey;
}

export const loadoutEncryptionReady = () => !!loadoutKey();

export function encryptLoadout(obj) {
  const key = loadoutKey();
  if (!key || !obj) return null;
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
    return {
      v: 1,
      alg: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ct: ct.toString("base64"),
    };
  } catch {
    return null;
  }
}

export function decryptLoadout(enc) {
  if (!enc || !enc.ct || !enc.iv || !enc.tag) return null;
  const key = loadoutKey();
  if (!key) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(enc.iv, "base64"));
    decipher.setAuthTag(Buffer.from(enc.tag, "base64"));
    const pt = Buffer.concat([decipher.update(Buffer.from(enc.ct, "base64")), decipher.final()]);
    return JSON.parse(pt.toString("utf8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------- discord bildirim

export async function discordNotify(embed) {
  const url = getEnv("DISCORD_WEBHOOK");
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "SwanChanger", embeds: [embed] }),
    });
  } catch {
    /* bildirim kritik değil */
  }
}
