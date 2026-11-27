// /api/migrate — eski panelin KV kayıtlarını bu siteye taşıyan TEK KULLANIM admin fonksiyonu
// POST { password: ADMIN_KEY, keys: [...rec...], users: [...rec...] }
// Kayıtları birebir (created/expiry/tier/status/bound_hwid/note) yazar.
// Taşıma bitince dosyanın silinmesi önerilir (isteyen de silemez çünkü şifre gerekir).

import {
  store,
  json,
  err,
  readBody,
  kvGet,
  kvSet,
  ADMIN_KEY,
} from "./_lib.mjs";

export default async (req) => {
  if (req.method !== "POST") return err("method", 405);
  let b = {};
  try { b = JSON.parse(await req.text()); } catch {}
  if (String(b.password || "") !== ADMIN_KEY()) return err("unauthorized", 401);

  const kv = store();
  const out = { keys: 0, users: 0 };

  const inKeys = Array.isArray(b.keys) ? b.keys : [];
  if (inKeys.length > 2000) return err("too many keys", 413);
  const keyIndex = new Set(await kvGet(kv, "key:index", []));
  for (const rec of inKeys) {
    if (!rec || typeof rec !== "object" || typeof rec.bare !== "string") continue;
    const bare = rec.bare.replace(/[^0-9A-Fa-f]/g, "");
    if (bare.length !== 72) continue;
    // en fazla 200 bayt olmayan alanları sınırla (güvenmeyen veri yazma)
    const clean = {
      key: String(rec.key || "").slice(0, 400),
      bare,
      tier: Math.min(Math.max(parseInt(rec.tier) || 1, 0), 3),
      status: rec.status === "revoked" || rec.status === "banned" ? rec.status : "active",
      created: Number(rec.created) || Date.now(),
      expiry: Number(rec.expiry) || Date.now() + 30 * 86400_000,
      note: String(rec.note || "").slice(0, 80),
      bound_hwid: String(rec.bound_hwid || "").slice(0, 64),
    };
    await kvSet(kv, "key:" + bare, clean);
    keyIndex.add(bare);
    out.keys++;
  }
  await kvSet(kv, "key:index", Array.from(keyIndex));

  const inUsers = Array.isArray(b.users) ? b.users : [];
  if (inUsers.length > 20000) return err("too many users", 413);
  const userIndex = new Set(await kvGet(kv, "user:index", []));
  for (const rec of inUsers) {
    if (!rec || typeof rec !== "object" || typeof rec.ip !== "string") continue;
    const ip = rec.ip.replace(/[^0-9A-Fa-f.:]/g, "").slice(0, 39);
    if (!ip) continue;
    const clean = {
      ip,
      hwid: String(rec.hwid || "").slice(0, 64),
      nick: String(rec.nick || "").slice(0, 64),
      key: String(rec.key || "").slice(0, 400),
      tier: Math.min(Math.max(parseInt(rec.tier) || 1, 0), 3),
      country: String(rec.country || "").slice(0, 4),
      ua: String(rec.ua || "").slice(0, 120),
      first: Number(rec.first) || Date.now(),
      last: Number(rec.last) || Date.now(),
      hits: Math.max(parseInt(rec.hits) || 0, 0),
      status: rec.status === "banned" || rec.status === "active" ? rec.status : "active",
    };
    await kvSet(kv, "user:" + ip, clean);
    userIndex.add(ip);
    out.users++;
  }
  await kvSet(kv, "user:index", Array.from(userIndex));

  // eski panelin rapor sayacı da taşınır
  if (typeof b.reports === "number") {
    const stats = await kvGet(kv, "stats", {});
    stats.reports = Math.max(parseInt(b.reports) || 0, 0);
    await kvSet(kv, "stats", stats);
  }

  return json({ ok: true, migrated: out });
};
