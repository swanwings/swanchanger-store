// /api/auth — panel girişi (sadece sahibi: isim + şifre)
// POST   { "user": "...", "password": "..." } → HttpOnly cookie
// GET    /api/auth/check                    → { ok: true|false }
// DELETE                                  → cookie temizle (çıkış)
//
// Güvenlik:
//   - ADMIN_USER (secret) + ADMIN_KEY (secret) ikisi de gerekir.
//   - ADMIN_USER tanımlı değilse geriye dönük: sadece şifre sorulur.
//   - ADMIN_KEY tanımlı değilse giriş KAPALI (fail closed).
//   - Başarısız denemeler IP bazlı sayılır (IP hash'lenerek saklanır),
//     eşik aşılınca kısa süreli kilit (429) uygulanır.

import {
  makeSession,
  sessionValid,
  sessionCookie,
  clearCookie,
  json,
  err,
  readBody,
  clientIp,
  store,
  kvGet,
  kvSet,
  ADMIN_KEY,
  ADMIN_USER,
} from "./_lib.mjs";

const RL_PREFIX = "rl:login:";
const RL_WINDOW_MS = 5 * 60 * 1000; // 5 dakikalik pencere
const MAX_ATTEMPTS = 10; // pencere icin izin verilen basarisiz deneme
const MAX_TOTAL = 30; // toplam deneme (basarili dahil)

// IP'yi salt'li HMAC ile hash'le (ham IP asla DB'ye yazilmaz)
async function hashIp(ip) {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(ADMIN_KEY() + "|login"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(ip)));
    return Array.from(new Uint8Array(sig))
      .slice(0, 12)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "unknown";
  }
}

// Kaba kuvvet sayaci: { fail, total } — pencere bazli.
async function rlState(kv, ipHash) {
  const bucket = Math.floor(Date.now() / RL_WINDOW_MS);
  const key = RL_PREFIX + ipHash + ":" + bucket;
  const cur = await kvGet(kv, key, null);
  const st = cur && typeof cur === "object" ? cur : { fail: 0, total: 0 };
  return { key, bucket, st };
}

export default async (req) => {
  const url = new URL(req.url);

  // Çıkış
  if (req.method === "DELETE") {
    const res = json({ ok: true });
    res.headers.append("set-cookie", clearCookie());
    return res;
  }

  // Session kontrol
  if (req.method === "GET" && url.pathname.endsWith("/check")) {
    return json({ ok: await sessionValid(req.headers.get("cookie")) });
  }

  // Giriş
  if (req.method === "POST") {
    const b = await readBody(req);
    const user = String(b.user || b.username || b.name || "").trim();
    const pass = String(b.password || b.key || "");
    const adminKey = ADMIN_KEY();
    const adminUser = ADMIN_USER();

    // ADMIN_KEY tanımlı değilse giriş KAPALI (fail closed): boş şifreyle girilemez.
    if (!adminKey) {
      console.error("[auth] ADMIN_KEY tanimli degil - giris engellendi");
      return err("admin not configured", 503);
    }

    const kv = store();
    const ipHash = await hashIp(clientIp(req));
    const { key: rlKey, st } = await rlState(kv, ipHash);

    // Pencere dolduysa sifirla
    if (st.fail >= MAX_ATTEMPTS || st.total >= MAX_TOTAL) {
      const wait = Math.ceil(
        (RL_WINDOW_MS - (Date.now() % RL_WINDOW_MS)) / 1000
      );
      return err(`too many attempts, retry in ${wait}s`, 429);
    }

    const userOk = !adminUser || user.toLowerCase() === adminUser.toLowerCase();
    const passOk = pass.length > 0 && pass === adminKey;

    if (!userOk || !passOk) {
      st.fail = (st.fail || 0) + 1;
      st.total = (st.total || 0) + 1;
      st.last = Date.now();
      await kvSet(kv, rlKey, st);
      console.warn("[auth] basarisiz giris denemesi:", {
        user: user ? user.slice(0, 32) : "(bos)",
        ip: ipHash,
        fail: st.fail,
      });
      // Kullanici hatasi ve sifre hatasi AYNI mesaji verir (user enumeration yok).
      return err("wrong credentials", 401);
    }

    // Basarili: sayaclari sifirla
    await kvSet(kv, rlKey, { fail: 0, total: 0, last: Date.now() });

    const token = await makeSession();
    const res = json({ ok: true, user: adminUser || user || "owner" });
    res.headers.append("set-cookie", sessionCookie(token));
    return res;
  }

  return err("method", 405);
};
