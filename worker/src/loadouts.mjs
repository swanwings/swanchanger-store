// /api/loadouts — panel: skin (loadout) kayitlari (admin only)
//
//   GET    /api/loadouts            -> tum kayitlar (cozulmus, sadece admin)
//   GET    /api/loadouts?steamid=.. -> tek kayit
//   DELETE /api/loadouts?steamid=.. -> kaydi sil
//   POST   /api/loadouts/sync       -> GitHub deposunu zorla senkronla
//
// Loadout'lar private GitHub reposunda SIFRELI tutulur; burada sifre
// COZULER (sadece ADMIN_KEY + session bilen admin icin).

import { json, err, unauthorized, sessionValid, decryptLoadout, getEnv } from "./_lib.mjs";
import {
  loadoutsRead,
  loadoutGet,
  loadoutDelete,
  loadoutsSync,
  loadoutsEnabled,
} from "./_loadouts.mjs";

async function isAdmin(req) {
  const header = req.headers.get("x-swan-admin");
  if (header && header === getEnv("ADMIN_KEY", "")) return true;
  return await sessionValid(req.headers.get("cookie"));
}

export default async (req) => {
  if (!(await isAdmin(req))) return unauthorized();

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (!loadoutsEnabled()) {
    return err("github deposu yapilandirilmadi (GITHUB_TOKEN / GITHUB_REPO)", 503);
  }

  // Manuel senkron
  if (req.method === "POST" && path.endsWith("/sync")) {
    const r = await loadoutsSync();
    return json({ ok: !!r.ok, ...r });
  }

  // Tek kayit
  if (req.method === "GET" && url.searchParams.get("steamid")) {
    const sid = String(url.searchParams.get("steamid") || "");
    const rec = await loadoutGet(sid);
    if (!rec) return err("not found", 404);
    return json({
      ok: true,
      steamid: sid,
      nick: rec.nick || "",
      updated: rec.updated || 0,
      loadout: rec.enc ? await decryptLoadout(rec.enc) : null,
    });
  }

  // Tum kayitlar
  if (req.method === "GET") {
    const data = await loadoutsRead();
    const items = [];
    for (const [sid, rec] of Object.entries(data.items || {})) {
      items.push({
        steamid: sid,
        nick: rec.nick || "",
        updated: rec.updated || 0,
        loadout: rec.enc ? await decryptLoadout(rec.enc) : null,
      });
    }
    items.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    return json({ ok: true, count: items.length, items });
  }

  // Sil
  if (req.method === "DELETE") {
    const sid = String(url.searchParams.get("steamid") || "");
    if (!sid) return err("missing steamid", 400);
    const ok = await loadoutDelete(sid);
    if (!ok) return err("not found", 404);
    await loadoutsSync();
    return json({ ok: true, deleted: sid });
  }

  return err("method", 405);
};
