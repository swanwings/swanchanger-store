// /api/keys — anahtar üret / iptal et / geri al / sil (giriş korumalı)
// POST   { count, days, tier, note, hwid? }  → üretilen anahtarlar
// PUT    { bare, status, note? }             → iptal / geri al
// DELETE ?bare=...                            → kalıcı sil

import {
  store,
  sessionValid,
  makeKey,
  bareKey,
  json,
  err,
  kvGet,
  kvSet,
  kvDel,
  discordNotify,
} from "./_lib.mjs";

export default async (req) => {
  if (!(await sessionValid(req.headers.get("cookie"))))
    return err("unauthorized", 401);

  const kv = store();

  // Anahtar üret
  if (req.method === "POST") {
    let b = {};
    try { b = await req.json(); } catch {}
    const count = Math.min(Math.max(parseInt(b.count) || 1, 1), 100);
    const days = Math.min(Math.max(parseInt(b.days) || 30, 1), 36500);
    const tier = Math.min(Math.max(parseInt(b.tier) || 1, 0), 3);
    const note = String(b.note || "").slice(0, 80);
    const hwid = String(b.hwid || "").slice(0, 64);
    const communityRequired = false;

    const made = [];
    for (let i = 0; i < count; i++) {
      const key = makeKey({ days, tier, hwid });
      const bare = bareKey(key);
      const rec = {
        key,
        bare,
        tier,
        status: "active",
        created: Date.now(),
        expiry: Date.now() + days * 86400_000,
        note,
        bound_hwid: hwid,
        community_required: communityRequired,
        community: {},
      };
      await kvSet(kv, "key:" + bare, rec);
      made.push(rec);
    }

    // Not: key:index güncellemesi bilinçli olarak kaldırıldı — listeartık
    // key: prefix taramasıyla okunuyor, index yazmak yarış bırakıyordu.

    discordNotify({
      title: `🔑 ${made.length} anahtar üretildi`,
      color: 0x5865f2,
      description: made
        .map((m) => "`" + m.key + "`")
        .join("\n")
        .slice(0, 1800),
      footer: { text: note || "panel" },
      timestamp: new Date().toISOString(),
    });

    return json({ keys: made });
  }

  // Anahtar durumu güncelle (iptal / geri al)
  if (req.method === "PUT") {
    let b = {};
    try { b = await req.json(); } catch {}
    const bare = bareKey(b.bare || "");
    if (bare.length !== 72) return err("bad key", 400);
    const rec = await kvGet(kv, "key:" + bare, null);
    if (!rec) return err("not found", 404);
    if (b.status === "revoked" || b.status === "active") rec.status = b.status;
    if (typeof b.note === "string") rec.note = b.note.slice(0, 80);
    await kvSet(kv, "key:" + bare, rec);
    return json({ ok: true, key: rec });
  }

  // Anahtar sil
  if (req.method === "DELETE") {
    const bare = bareKey(new URL(req.url).searchParams.get("bare") || "");
    if (bare.length !== 72) return err("bad key", 400);
    await kvDel(kv, "key:" + bare);
    return json({ ok: true });
  }

  return err("method", 405);
};
