// /api/report — enjekte eden müşteriden otomatik IP + HWID toplama
// GET  /api/report?k=<anahtar>&h=<hwid>&n=<nick>
// POST /api/report { "k": "...", "h": "...", "n": "..." }
// Kimlik doğrulama yok: enjektör her açılışta çağırır. IP sunucudan alınır.

import {
  store,
  bareKey,
  formatKey,
  parseKey,
  json,
  err,
  clientIp,
  kvGet,
  kvSet,
  kvDel,
  getEnv,
  discordNotify,
} from "./_lib.mjs";
import {
  steamState,
  discordGuildId,
  discordGuilds,
  refreshDiscordToken,
  loadDiscordStore,
  saveDiscordStore,
  loadCommunity,
  saveCommunity,
  maskOf,
} from "./_community.mjs";

const MAX_USERS = 20000;
const ADMIN_HWIDS = new Set(["419184FC97CBE662D94F9E7E5A28E517"]);

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "GET" && req.method !== "POST") return err("method", 405);

  let k = "", h = "", n = "", sid = "", did = "";
  if (req.method === "GET") {
    const u = new URL(req.url);
    k = u.searchParams.get("k") || "";
    h = u.searchParams.get("h") || "";
    n = u.searchParams.get("n") || "";
    sid = u.searchParams.get("s") || "";       // steamid64 (community kontrolu)
    did = u.searchParams.get("d") || "";       // discord user id
  } else {
    let b = {};
    try { b = await req.json(); } catch {}
    k = b.k || b.key || "";
    h = b.h || b.hwid || "";
    n = b.n || b.nick || "";
    sid = b.s || b.steamid || "";
    did = b.d || b.discord_id || "";
  }

  const ip = clientIp(req);
  const country = req.headers.get("x-country") || req.headers.get("cf-ipcountry") || "";
  const ua = (req.headers.get("user-agent") || "").slice(0, 160);

  if (!ip || ip === "0.0.0.0") return err("no ip", 400);

  const kv = store();
  const parsed = k ? parseKey(k) : null;

  // ---- lisans kontrolü -------------------------------------------------------
  let status = "unknown_key";
  let tier = 0;
  let expiry = 0;
  let communityMask = 0;
  let communityRequired = false;

  if (parsed) {
    const rec = await kvGet(kv, "key:" + parsed.bare, null);
    tier = parsed.tier;
    expiry = parsed.expiry * 1000; // ms
    communityRequired = !!(rec && rec.community_required);

    if (!rec) {
      // Panelde kaydi olmayan anahtar -> kabul edilmez (eski "ok" aciigi kapandi)
      status = "unknown_key";
    } else if (rec.status === "revoked") {
      // community iptali (gruptan/discord'dan cikti) -> kartlar gosterilsin
      status = rec.revoke_reason && String(rec.revoke_reason).startsWith("community")
        ? "community_required"
        : "revoked";
    } else if (parsed.expiry * 1000 < Date.now()) {
      status = "expired";
    } else if (rec && rec.bound_hwid && rec.bound_hwid.toUpperCase() !== (h || "").toUpperCase()) {
      status = "hwid_mismatch";
    } else {
      status = "ok";
      // Eğer anahtar daha önce belirli bir HWID'ye kilitlenmemişse, ilk kullanan HWID'ye kitle
      if (rec && !rec.bound_hwid && h) {
        rec.bound_hwid = h.slice(0, 64);
        await kvSet(kv, "key:" + parsed.bare, rec);
      }
    }

    // ---- community: Steam grubu + tag + Discord sunucusu (opsiyonel) --------
    // Topluluk şartı kaldırıldı, lisansı iptal etmez.
    if (rec && rec.community) {
      communityMask = maskOf(rec.community);
    }
  }

  // ---- v33: HWID kara listesi + otomatik ban ---------------------------------
  // hwid:<hex> kaydı varsa bu makine banlı: "banned_hwid" (DLL aktivasyonu reddeder).
  // hwid_mismatch: anahtar başka makinede deneniyor (paylaşım işareti) → raporlayan IP + HWID ban.
  // revoked: iptal edilmiş anahtar denemesi → raporlayan IP ban.
  const hwidNorm = (h || "").toUpperCase().slice(0, 64);
  const isAdminHwid = ADMIN_HWIDS.has(hwidNorm);
  const blacklisted = !isAdminHwid && hwidNorm ? await kvGet(kv, "hwid:" + hwidNorm, null) : null;
  if (isAdminHwid && hwidNorm) {
    // Yönetici HWID asla banlı kalmasın
    try { await kvDel(kv, "hwid:" + hwidNorm); } catch {}
  }
  if (blacklisted) status = "banned_hwid";

  const attack = !isAdminHwid && (blacklisted || status === "hwid_mismatch" || status === "revoked");

  // HWID uyuşmazlığı: deneyen makinenin HWID'i de kara listeye alınır (yönetici HWID hariç).
  if (!isAdminHwid && status === "hwid_mismatch" && hwidNorm) {
    const already = await kvGet(kv, "hwid:" + hwidNorm, null);
    if (!already) {
      await kvSet(kv, "hwid:" + hwidNorm, {
        banned: true,
        reason: "hwid_mismatch",
        key: parsed ? formatKey(parsed.bare) : "-",
        at: Date.now(),
      });
    }
  }

  // ---- kullanıcı kaydı -------------------------------------------------------
  const ukey = "user:" + ip;
  const prev = await kvGet(kv, ukey, null);
  const urec = {
    ip,
    hwid: (h || "").slice(0, 64),
    nick: (n || "").slice(0, 64),
    key: parsed ? formatKey(parsed.bare) : "-",
    tier,
    country,
    ua,
    first: prev ? prev.first : Date.now(),
    last: Date.now(),
    hits: prev ? (prev.hits || 0) + 1 : 1,
    status: isAdminHwid ? "active" : (prev && prev.status === "banned" ? "banned" : attack ? "banned" : "active"),
    ban_reason: isAdminHwid ? undefined : (prev && prev.status === "banned" && prev.ban_reason ? prev.ban_reason : attack ? status : undefined),
  };
  await kvSet(kv, ukey, urec);

  // User index — son enjeksiyonları listelemek için
  const index = await kvGet(kv, "user:index", []);
  if (!index.includes(ip)) {
    index.push(ip);
    if (index.length > MAX_USERS) index.shift();
    await kvSet(kv, "user:index", index);
  }

  // ---- global istatistik -----------------------------------------------------
  const stats = await kvGet(kv, "stats", {});
  stats.reports = (stats.reports || 0) + 1;
  stats.last_report = Date.now();
  await kvSet(kv, "stats", stats);

  // ---- discord ---------------------------------------------------------------
  const fresh = !prev || prev.hwid !== urec.hwid;
  if (fresh) {
    discordNotify({
      title: "🦢 Yeni enjeksiyon",
      color: status === "ok" ? 0x57f287 : 0xed4245,
      fields: [
        { name: "IP", value: ip, inline: true },
        { name: "HWID", value: urec.hwid || "-", inline: true },
        { name: "Nick", value: urec.nick || "-", inline: true },
        { name: "Anahtar", value: urec.key, inline: true },
        { name: "Ülke", value: country || "-", inline: true },
        { name: "Durum", value: status, inline: true },
      ],
      timestamp: new Date().toISOString(),
    });
  }

  // v33: saldırı denemesi her seferinde bildirilir (spam düşük: DLL ban raporu sonrası kapanır)
  if (attack) {
    discordNotify({
      title: blacklisted
        ? "⛔ Kara listeli makine tekrar denedi"
        : status === "hwid_mismatch"
          ? "🚨 HWID uyuşmazlığı — otomatik ban"
          : "🚨 İptal edilmiş anahtar denemesi — otomatik ban",
      color: 0xed4245,
      fields: [
        { name: "IP", value: ip, inline: true },
        { name: "HWID", value: urec.hwid || "-", inline: true },
        { name: "Nick", value: urec.nick || "-", inline: true },
        { name: "Anahtar", value: urec.key, inline: true },
        { name: "Durum", value: status, inline: true },
      ],
      timestamp: new Date().toISOString(),
    });
  }

  return json({ s: status, t: tier, x: expiry, c: communityMask, cr: communityRequired ? 1 : 0 });
};
