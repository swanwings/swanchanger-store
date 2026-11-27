// /api/users — kullanıcı banla / sil (giriş korumalı)

import { store, sessionValid, json, err, kvGet, kvSet, kvDel } from "./_lib.mjs";

export default async (req) => {
  if (!(await sessionValid(req.headers.get("cookie"))))
    return err("unauthorized", 401);

  const kv = store();

  // Ban / unban
  if (req.method === "PUT") {
    let b = {};
    try { b = await req.json(); } catch {}
    const ip = String(b.ip || "");
    if (!ip) return err("no ip", 400);
    const rec = await kvGet(kv, "user:" + ip, null);
    if (!rec) return err("not found", 404);
    rec.status = b.status === "banned" ? "banned" : "active";
    await kvSet(kv, "user:" + ip, rec);
    return json({ ok: true });
  }

  // Sil
  if (req.method === "DELETE") {
    const ip = new URL(req.url).searchParams.get("ip") || "";
    if (!ip) return err("no ip", 400);
    await kvDel(kv, "user:" + ip);
    const index = (await kvGet(kv, "user:index", [])).filter((x) => x !== ip);
    await kvSet(kv, "user:index", index);
    return json({ ok: true });
  }

  return err("method", 405);
};
