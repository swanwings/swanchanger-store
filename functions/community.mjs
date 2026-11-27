// /api/community — Steam grubu + Discord sunucusu uyelik kontrolu (BOT'SUZ)
// Discord botu yerine OAuth2 "guilds/@me": kullanici tarayicida bir kez giris
// yapar, sunucu access token'i alir ve uyeligi kontrol eder. Bot / surekli
// acik bilgisayar gerekmez (Netlify function).
//
// Durum HWID (cihaz) bazli tutulur: kullanici lisans anahtarini girmeden once
// kartlari doldurur, bu yuzden key'e baglanamaz.
//
//   GET  /api/community/discord/start?h=<hwid>&s=<steamid64>
//   GET  /api/community/discord/callback?code=...&state=...
//   GET  /api/community/steam?h=<hwid>&s=<steamid64>
//   GET  /api/community/status?h=<hwid>

import {
  store,
  getEnv,
  json,
  err,
  signPayload,
  verifyPayload,
} from "./_lib.mjs";
import {
  steamState,
  discordGuildId,
  discordGuilds,
  loadCommunity,
  saveCommunity,
  loadDiscordStore,
  saveDiscordStore,
  maskOf,
  DISCORD_SERVER_URL,
} from "./_community.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SwanChanger/1.0";
const normHwid = (s) => String(s || "").toUpperCase().replace(/[^0-9A-F]/g, "").slice(0, 64);

const page = (title, body, color) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
      `<body style="background:#0d0d14;color:${color};font-family:Segoe UI,sans-serif;display:grid;place-items:center;height:100vh;margin:0">` +
      `<div style="text-align:center;max-width:520px;padding:32px">` +
      `<div style="font-size:52px">${title}</div>` +
      `<p style="color:#c8cce0;line-height:1.6">${body}</p>` +
      `<p style="color:#6f7590;font-size:13px">Bu sayfayi kapatip oyuna don.</p></div></body>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/+/, "").replace(/^api\/community\/?/, "");
  const kv = store();

  // ---------------------------------------------------------- Discord baslat
  if (path === "discord/start") {
    const hwid = normHwid(url.searchParams.get("h"));
    const sid = (url.searchParams.get("s") || "").trim();
    if (hwid.length !== 32) return err("bad hwid", 400);

    const clientId = getEnv("DISCORD_CLIENT_ID", "");
    if (!clientId) {
      // Netlify env'de OAuth app tanimli degilse kullaniciyi engellemiyoruz:
      // HWID topluluk durumunu onayliyoruz ve kullaniciyi dogrudan sunucu davetine yonlendiriyoruz.
      const c = await saveCommunity(kv, hwid, {
        discord_guild: true,
        discord_checked_at: Date.now(),
        steam_id: sid || "",
      });
      return json({
        url: DISCORD_SERVER_URL,
        redirect_uri: DISCORD_SERVER_URL,
        ok: true,
        mask: maskOf(c),
      });
    }

    const redirect = `${url.origin}/api/community/discord/callback`;
    const exp = Math.floor(Date.now() / 1000) + 900;
    const state = await signPayload(`d:${hwid}|${sid}|${exp}`);

    const auth =
      `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}` +
      `&scope=${encodeURIComponent("identify guilds")}` +
      `&response_type=code&redirect_uri=${encodeURIComponent(redirect)}` +
      `&state=${encodeURIComponent(state)}&prompt=consent`;

    return json({ url: auth, redirect_uri: redirect });
  }

  // ---------------------------------------------------------- Discord callback
  if (path === "discord/callback") {
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const payload = await verifyPayload(state);

    if (!payload || !payload.startsWith("d:")) {
      return page("&#9888;", "Dogrulama linki gecersiz veya suresi dolmus. Tekrar dene.", "#ed4245");
    }
    const parts = payload.split("|");
    const hwid = normHwid(parts[1]);
    const sid = parts[2] || "";
    const exp = Number(parts[3]);
    if (hwid.length !== 32 || !Number.isFinite(exp) || exp * 1000 < Date.now()) {
      return page("&#9888;", "Dogrulama linkinin suresi dolmus. Tekrar dene.", "#ed4245");
    }
    if (!code) {
      return page("&#9888;", "Discord girisi tamamlanmadi. Tekrar dene.", "#ed4245");
    }

    const clientId = getEnv("DISCORD_CLIENT_ID", "");
    const clientSecret = getEnv("DISCORD_CLIENT_SECRET", "");
    const redirect = `${url.origin}/api/community/discord/callback`;

    let token = null;
    let refresh = "";
    let userId = "";
    try {
      const tr = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirect,
        }),
      });
      const tj = await tr.json();
      token = tj && tj.access_token ? tj.access_token : null;
      refresh = (tj && tj.refresh_token) || "";
      if (token) {
        const ur = await fetch("https://discord.com/api/users/@me", {
          headers: { authorization: `Bearer ${token}`, "user-agent": UA },
        });
        const uj = await ur.json();
        userId = uj && uj.id ? uj.id : "";
      }
    } catch {
      token = null;
    }

    if (!token) {
      return page(
        "&#9888;",
        "Discord token alinamadi (uygulama yapilandirmasi eksik olabilir: DISCORD_CLIENT_ID/SECRET).",
        "#ed4245"
      );
    }

    const guilds = await discordGuilds(token);
    const gid = await discordGuildId();
    const member = !!(guilds && gid && guilds.some((g) => g.id === gid));

    if (!member) {
      return page(
        "&#10060;",
        "Discord sunucusuna <b>katilmis veya dogrulanmis gorunmuyorsun</b>. " +
          "Once sunucuya katil, ekrandaki sunucu kurallarini onayla, sonra bu sayfayi yenile. " +
          "Uyelik aktif olunca kart yesil tik olur.",
        "#ed4245"
      );
    }

    const patch = {
      discord_id: userId,
      discord_guild: true,
      discord_checked_at: Date.now(),
      steam_id: sid || "",
    };
    await saveCommunity(kv, hwid, patch);
    if (refresh) {
      await saveDiscordStore(kv, hwid, { refresh, id: userId, checked_at: Date.now(), member: true });
    }

    return page(
      "&#9989;",
      "Discord dogrulandi! Sunucuya uyesin ve lisansin aktif. " +
        "DLL'deki kart en fazla 2 dakika icinde yesil tik olacak.",
      "#57f287"
    );
  }

  // ---------------------------------------------------------- Steam kontrol
  if (path === "steam") {
    const hwid = normHwid(url.searchParams.get("h"));
    const sid = (url.searchParams.get("s") || "").trim();
    if (hwid.length !== 32) return err("bad hwid", 400);

    const state = await steamState(sid);
    const clientId = getEnv("DISCORD_CLIENT_ID", "");
    const patch = {
      steam_id: sid,
      steam_group: state.group,
      steam_tag: state.tag_ok,
      steam_tag_visible: state.tag,
      steam_tag_verifiable: !!state.tag_verifiable,
      steam_checked_at: Date.now(),
    };
    if (!clientId) {
      patch.discord_guild = true;
      patch.discord_checked_at = Date.now();
    }
    const c = await saveCommunity(kv, hwid, patch);
    return json({
      ok: true,
      group: state.group,
      tag: state.tag_ok,
      tag_visible: state.tag,
      tag_verifiable: !!state.tag_verifiable,
      discord: !!(c.discord_guild || !clientId),
      mask: maskOf(c),
    });
  }

  // ---------------------------------------------------------- durum
  if (path === "status") {
    const hwid = normHwid(url.searchParams.get("h"));
    if (hwid.length !== 32) return err("bad hwid", 400);
    const c = await loadCommunity(kv, hwid);
    const clientId = getEnv("DISCORD_CLIENT_ID", "");
    const discordDone = !!(c.discord_guild || !clientId);
    return json({
      ok: true,
      group: !!c.steam_group,
      tag: !!c.steam_tag,
      tag_visible: !!c.steam_tag_visible,
      tag_verifiable: !!c.steam_tag_verifiable,
      discord: discordDone,
      mask: maskOf(c),
      steam_id: c.steam_id || "",
      discord_id: c.discord_id || "",
    });
  }

  return err("not found", 404);
};
