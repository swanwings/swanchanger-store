// /api/auth — giriş (sadece olivia)
// POST   { "password": "..." } → HttpOnly cookie
// GET    /api/auth/check       → { ok: true|false }
// DELETE                       → cookie temizle (çıkış)

import {
  makeSession,
  sessionValid,
  sessionCookie,
  clearCookie,
  json,
  err,
  readBody,
  ADMIN_KEY,
} from "./_lib.mjs";

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
    const pass = String(b.password || b.key || "");
    const adminKey = ADMIN_KEY();
    // ADMIN_KEY tanımlı değilse giriş KAPALI (fail closed): boş şifreyle girilemez.
    if (!adminKey) {
      console.error("[auth] ADMIN_KEY tanimli degil - giris engellendi");
      return err("admin not configured", 503);
    }
    if (pass !== adminKey) {
      return err("wrong password", 401);
    }
    const token = await makeSession();
    const res = json({ ok: true });
    res.headers.append("set-cookie", sessionCookie(token));
    return res;
  }

  return err("method", 405);
};
