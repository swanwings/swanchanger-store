// SwanChanger Dashboard — ortak yardımcılar
// Cloudflare Worker (Workers + D1) için yazıldı.
//
// Netlify Blobs (KV) -> Cloudflare D1 (SQLite). Netlify'in @netlify/blobs API'si
// birebir taklit edilir: get(key,{type:"json"}) / setJSON / delete / list({prefix}).
// Böylece report/keys/peer/list/users/... dosyaları mantık değişmeden çalışır.
//
// Loadout'lar (skinler) D1'de SIFRELI tutulur: AES-256-GCM, anahtar sadece
// sunucuda (LOADOUT_KEY secret'i ya da admin/session secret'ından türetilir).
// D1 dökümü bile ciphertext görür, skinleri yalnızca sahibi (panel) çözebilir.
//
// NOT: Node API'leri (node:crypto, Buffer, process.env) KULLANILMAZ — Worker
// runtime'ında WebCrypto (crypto.subtle) ve D1 binding kullanılır.

export const BIG_MARK = "__big";
export const PART_SEP = "::part:";
// D1 satır boyutu sınırı (2 MB) ve SQL ifadesi sınırı (100 KB) içinde kalmak
// için parcalar 90 KB'ta kirilir.
const CHUNK_CHARS = 90_000;

// ------------------------------------------------------------------ env

// Worker binding'leri (vars/secret) globalde tutulur; handler'lar process.env
// görmez ama getEnv() aynı arayüzü sunar.
export function setEnv(env) {
  globalThis.__SWAN_ENV = env || {};
}

export const getEnv = (k, fallback = "") => {
  const env = globalThis.__SWAN_ENV || {};
  if (env && env[k]) return env[k];
  if (typeof process !== "undefined" && process.env && process.env[k]) return process.env[k];
  return fallback;
};

export const ADMIN_KEY = () => getEnv("ADMIN_KEY", "");
export const SESSION_SECRET = () => getEnv("SITE_SESSION_SECRET", "") || ADMIN_KEY();

// Panel kullanici adi (secret olarak tutulur, public depoda YAZILMAZ).
// Bos ise geriye donuk davranis: sadece sifre sorulur.
export const ADMIN_USER = () => getEnv("ADMIN_USER", "");

// Panelin calisabilecegi kaynaklar (CORS + CSRF). GitHub Pages varsayilan.
export const PANEL_ORIGINS = () => {
  const raw = getEnv("PANEL_ORIGINS", "");
  const list = String(raw || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const def = ["https://swanwings.github.io"];
  for (const d of def) if (!list.includes(d)) list.push(d);
  return list;
};

// Istegin Origin'i panel icin izinli mi?
export function originAllowed(req) {
  const origin = (req.headers.get("origin") || "").replace(/\/+$/, "");
  if (!origin) return true; // CLI / sunucudan gelen istek
  const self = new URL(req.url).origin.replace(/\/+$/, "");
  if (origin === self) return true;
  return PANEL_ORIGINS().includes(origin);
}

// CSRF korumasi: durum degistiren (POST/PUT/DELETE) isteklerde ya
// x-swan-admin basligi (CLI) ya da izinli bir Origin gerekir.
// Origin yoksa istek tarayici disi sayilir; bu durumda JSON content-type
// zorunlu olur (cross-site form POST application/json gonderemez ->
// tarayici preflight'a takilir, preflight sadece izinli origin'e gecer).
export function csrfOk(req) {
  const key = ADMIN_KEY();
  const h = req.headers.get("x-swan-admin");
  if (key && h && h === key) return true; // CLI / script (kimlik header'i)
  const origin = req.headers.get("origin");
  if (origin) return originAllowed(req);
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  return ct.includes("application/json");
}

// ------------------------------------------------------------------ D1

const TABLE = "kv";

function d1() {
  const env = globalThis.__SWAN_ENV || {};
  return env.KV || env.DB || null;
}

// D1 sorguları hazırla (tablo yoksa sessizce null döner -> hata gizlenir)
function stmt(sql) {
  const db = d1();
  if (!db) return null;
  try {
    return db.prepare(sql);
  } catch {
    return null;
  }
}

// Netlify'in sessizce düşürdüğü undefined/NaN alanlar Firestore'da 500 verirdi.
// Aynı davranışı taklit ediyoruz.
function sanitize(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "function" || typeof value === "symbol") return null;
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : sanitize(v)));
  if (value instanceof Date) return value.toISOString();
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

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Netlify Blobs API'sinin aynisi (D1 uzerinde).
export const store = () => ({
  async get(key, opts = {}) {
    const s = stmt(`SELECT v FROM ${TABLE} WHERE k = ?`);
    if (!s) return null;
    try {
      const row = await s.bind(String(key)).first();
      if (!row || row.v === null || row.v === undefined) return null;
      let value;
      try {
        value = JSON.parse(row.v);
      } catch {
        return null;
      }

      // buyuk deger: parcalari birlestir
      if (value && typeof value === "object" && value[BIG_MARK]) {
        if (opts && opts.type === "metadata") {
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

  // Tek sorguda birden fazla anahtar okur (D1 batch = 1 sorgu).
  // Worker free planda "invocation basina 50 sorgu" siniri var; listeler
  // bu yuzden batch ile okunur.
  async getMany(keys, opts = {}) {
    const out = new Map();
    const db = d1();
    if (!db || !keys || !keys.length) return out;
    try {
      const stmts = keys.map((k) =>
        db.prepare(`SELECT v FROM ${TABLE} WHERE k = ?`).bind(String(k))
      );
      const res = await db.batch(stmts);
      for (let i = 0; i < keys.length; i++) {
        const row = res[i] && res[i].results && res[i].results[0];
        if (!row || row.v === null || row.v === undefined) {
          out.set(String(keys[i]), null);
          continue;
        }
        try {
          out.set(String(keys[i]), JSON.parse(row.v));
        } catch {
          out.set(String(keys[i]), null);
        }
      }
    } catch {
      /* sessiz */
    }
    return out;
  },

  async setJSON(key, value) {
    // Netlify Blobs davranisi: setJSON tamamen DEGISTIRIR (merge yok).
    const text = JSON.stringify(value === undefined ? null : value);
    const db = d1();
    if (!db) return;

    if (text && text.length > CHUNK_CHARS) {
      // 1) eski parcalari temizle
      await deleteParts(key);
      // 2) parcalari yaz
      const chunks = Math.ceil(text.length / CHUNK_CHARS);
      for (let i = 0; i < chunks; i++) {
        const part = text.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS);
        await db
          .prepare(`INSERT OR REPLACE INTO ${TABLE} (k, v, u) VALUES (?, ?, ?)`)
          .bind(`${key}${PART_SEP}${i}`, JSON.stringify({ d: part }), Date.now())
          .run();
      }
      // 3) isaretci satiri
      const meta =
        value && typeof value === "object" && !Array.isArray(value) && typeof value.sha256 === "string"
          ? { sha256: value.sha256, size: value.size ?? 0 }
          : null;
      await db
        .prepare(`INSERT OR REPLACE INTO ${TABLE} (k, v, u) VALUES (?, ?, ?)`)
        .bind(
          String(key),
          JSON.stringify({
            [BIG_MARK]: 1,
            chunks,
            size: text.length,
            sha256: await sha256Hex(text),
            ...(meta ? { meta } : {}),
          }),
          Date.now()
        )
        .run();
      return;
    }

    await db
      .prepare(`INSERT OR REPLACE INTO ${TABLE} (k, v, u) VALUES (?, ?, ?)`)
      .bind(String(key), JSON.stringify(sanitize(value)), Date.now())
      .run();
  },

  async delete(key) {
    const db = d1();
    if (!db) return;
    try {
      await db.prepare(`DELETE FROM ${TABLE} WHERE k = ?`).bind(String(key)).run();
      await deleteParts(key);
    } catch {
      /* sessiz */
    }
  },

  async list({ prefix = "", limit = 2000 } = {}) {    const db = d1();
    if (!db) return { blobs: [] };
    try {
      let sql = `SELECT k FROM ${TABLE}`;
      const binds = [];
      if (prefix) {
        sql += ` WHERE k >= ? AND k <= ?`;
        binds.push(prefix, `${prefix}\uffff`);
      }
      sql += ` ORDER BY k LIMIT ?`;
      binds.push(Number(limit) || 2000);
      const res = await db.prepare(sql).bind(...binds).all();
      const rows = (res && res.results) || [];
      const blobs = [];
      for (const row of rows) {
        const key = row.k;
        // dahili parca anahtarlari listelenmez
        if (typeof key !== "string" || key.includes(PART_SEP)) continue;
        blobs.push({ key });
      }
      return { blobs };
    } catch {
      return { blobs: [] };
    }
  },
});

// buyuk degerin parcalarini birlestirir
async function readParts(key, chunks) {
  if (!chunks) return null;
  const db = d1();
  if (!db) return null;
  const texts = new Array(chunks);
  try {
    const res = await db
      .prepare(`SELECT k, v FROM ${TABLE} WHERE k >= ? AND k <= ? ORDER BY k`)
      .bind(`${key}${PART_SEP}`, `${key}${PART_SEP}\uffff`)
      .all();
    const rows = (res && res.results) || [];
    const map = new Map();
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.v);
        if (parsed && typeof parsed.d === "string") map.set(row.k, parsed.d);
      } catch {
        /* bozuk parca */
      }
    }
    for (let i = 0; i < chunks; i++) {
      const part = map.get(`${key}${PART_SEP}${i}`);
      if (typeof part !== "string") return null;
      texts[i] = part;
    }
  } catch {
    return null;
  }
  return texts.join("");
}

async function deleteParts(key) {
  const db = d1();
  if (!db) return;
  try {
    await db
      .prepare(`DELETE FROM ${TABLE} WHERE k >= ? AND k <= ?`)
      .bind(`${key}${PART_SEP}`, `${key}${PART_SEP}\uffff`)
      .run();
  } catch {
    /* temizlik kritik degil */
  }
}

// ---------------------------------------------------------------- auth token
// cookie: base64url(payload).base64url(hmac-sha256(payload, SESSION_SECRET))
// payload = "exp:<unix>"

const b64url = (bytes) => {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const unb64url = (s) => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "====".slice(t.length % 4 || 4);
  const bin = atob(t + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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

// Session cookie.
// SameSite=None + Secure: panel GitHub Pages (swanwings.github.io) üzerinden
// açıldığında cookie cross-site gönderilebilsin. CSRF koruması origin
// kontrolü ile sağlanır (bkz. csrfOk).
export const sessionCookie = (value) =>
  `swan_sess=${value}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=43200`;

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
  `swan_sess=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`;

// ------------------------------------------------------------------ helpers

export const json = (body, extra = {}) =>
  new Response(JSON.stringify(body), {
    status: extra.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // DİKKAT: "private" şart. Firebase Hosting edge'i (ve hosting emülatörü)
      // cache-control içinde "private" yoksa Set-Cookie header'ını SİLer.
      "cache-control": "private, no-store",
      ...(extra.headers || {}),
    },
  });

export const err = (msg, status = 400) => json({ error: msg }, { status });
export const unauthorized = () => json({ error: "unauthorized" }, { status: 401 });

export function clientIp(req) {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-nf-client-connection-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-goog-client-ip") ||
    req.headers.get("client-ip") ||
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
  const salt = crypto.getRandomValues(new Uint8Array(28));
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
let cachedKeyPromise = null;

function decodeKeyMaterial(raw) {
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = parseInt(raw.substr(i * 2, 2), 16);
    return out;
  }
  try {
    const bin = atob(raw);
    if (bin.length !== 32) return null;
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function deriveKey() {
  const raw = getEnv("LOADOUT_KEY", "");
  const direct = decodeKeyMaterial(raw);
  if (direct) return direct;

  const secret = SESSION_SECRET();
  if (!secret) return null;

  // HKDF-SHA256(ikm=secret, salt="swanchanger-loadout-v1", info="loadout", 32)
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "HKDF",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("swanchanger-loadout-v1"),
      info: new TextEncoder().encode("loadout"),
    },
    base,
    256
  );
  return new Uint8Array(bits);
}

async function loadoutKey() {
  if (cachedKey) return cachedKey;
  if (!cachedKeyPromise) {
    cachedKeyPromise = deriveKey().then((k) => {
      cachedKey = k;
      return k;
    });
  }
  return cachedKeyPromise;
}

export const loadoutEncryptionReady = async () => !!(await loadoutKey());

export async function encryptLoadout(obj) {
  const key = await loadoutKey();
  if (!key || !obj) return null;
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ck = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["encrypt"]);
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, ck, new TextEncoder().encode(JSON.stringify(obj)))
    );
    // WebCrypto: ciphertext||tag -> eski format ile ayni: ct ve tag ayri
    const ct = sealed.slice(0, sealed.length - 16);
    const tag = sealed.slice(sealed.length - 16);
    return {
      v: 1,
      alg: "aes-256-gcm",
      iv: btoa(String.fromCharCode(...iv)),
      tag: btoa(String.fromCharCode(...tag)),
      ct: btoa(String.fromCharCode(...ct)),
    };
  } catch {
    return null;
  }
}

export async function decryptLoadout(enc) {
  if (!enc || !enc.ct || !enc.iv || !enc.tag) return null;
  const key = await loadoutKey();
  if (!key) return null;
  try {
    const bin = atob(String(enc.ct));
    const ct = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) ct[i] = bin.charCodeAt(i);
    const tagBin = atob(String(enc.tag));
    const tag = new Uint8Array(tagBin.length);
    for (let i = 0; i < tagBin.length; i++) tag[i] = tagBin.charCodeAt(i);
    const ivBin = atob(String(enc.iv));
    const iv = new Uint8Array(ivBin.length);
    for (let i = 0; i < ivBin.length; i++) iv[i] = ivBin.charCodeAt(i);

    const combined = new Uint8Array(ct.length + tag.length);
    combined.set(ct, 0);
    combined.set(tag, ct.length);

    const ck = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, ck, combined);
    return JSON.parse(new TextDecoder().decode(plain));
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
