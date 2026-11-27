// /api/site — public satis sitesi (Discord giris + lisans sorgu)
// Bot'suz Discord OAuth2: access token Netlify function'da degistirilir,
// sunucu uyeligi (guilds/@me) kontrol edilir. Bilgisayarin acik olmasi gerekmez.
//
//   GET  /api/site/login     -> Discord authorize sayfasina yonlendirir
//   GET  /api/site/callback  -> token exchange + session cookie + public store yonlendirmesi
//   GET  /api/site/me        -> { ok, user:{...}, member:true|false }
//   POST /api/site/logout    -> cookie temizle
//   POST /api/site/license   -> { key, hwid } -> lisans durumu

import {
  getEnv,
  json,
  err,
  signPayload,
  verifyPayload,
  SESSION_SECRET,
  readBody,
  store,
  kvGet,
  kvSet,
  parseKey,
  formatKey,
} from "./_lib.mjs";
import {
  DISCORD_INVITE,
  discordGuildId,
  discordGuilds,
  refreshDiscordToken,
  loadCommunity,
  maskOf,
} from "./_community.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SwanChanger/1.0";
const SECRET = SESSION_SECRET;
// Satış vitrini, API ve veritabanı artık aynı Firebase projesinde:
// https://swanchanger.web.app (hosting) + Cloud Functions + Firestore.
const PUBLIC_URL = () =>
  getEnv("PUBLIC_SITE_URL", "https://swanchanger.web.app").replace(/\/+$/, "");
const COOKIE = "swan_user";

const userCookie = (value) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=604800`;
const clearUserCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;

function readCookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(raw);
  return m ? m[1] : "";
}

async function currentUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const payload = await verifyPayload(token, SECRET());
  if (!payload || !payload.startsWith("u:")) return null;
  const parts = payload.split("|");
  if (!parts[0] || !parts[1]) return null;
  const exp = Number(parts[parts.length - 1]);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  return {
    id: parts[0],
    username: parts[1] || "",
    global_name: parts[2] || "",
    avatar: parts[3] || "",
    exp,
  };
}

const redirect = (location) =>
  // "private" şart: aksi halde Hosting edge'i Set-Cookie'yi siler (OAuth
  // geri dönüşünde kullanıcı cookie'si kaybolur).
  new Response(null, { status: 302, headers: { location, "cache-control": "private, no-store" } });

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/api\/site\/?/, "").replace(/\/+$/, "");

  const clientId = getEnv("DISCORD_CLIENT_ID", "");
  const clientSecret = getEnv("DISCORD_CLIENT_SECRET", "");

  // ---------------------------------------------------------- Discord giris
  if (path === "login") {
    if (!clientId || !clientSecret) {
      return json(
        {
          error: "discord_not_configured",
          hint: "Worker secret: DISCORD_CLIENT_ID + DISCORD_CLIENT_SECRET gerekli",
        },
        { status: 503 }
      );
    }
    const redirectUri = `${PUBLIC_URL()}/api/site/callback`;
    const exp = Math.floor(Date.now() / 1000) + 900;
    const state = await signPayload(`s:${exp}`, SECRET());
    const auth =
      `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}` +
      `&scope=${encodeURIComponent("identify guilds")}` +
      `&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}&prompt=consent`;
    return redirect(auth);
  }

  // ---------------------------------------------------------- Discord callback
  if (path === "callback") {
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const payload = await verifyPayload(state, SECRET());
    const exp = payload && payload.startsWith("s:") ? Number(payload.slice(2)) : 0;
    if (!payload || !Number.isFinite(exp) || exp * 1000 < Date.now()) {
      return redirect(`${PUBLIC_URL()}/?login=expired`);
    }
    if (!code) return redirect(`${PUBLIC_URL()}/?login=missing`);

    const redirectUri = `${PUBLIC_URL()}/api/site/callback`;
    try {
      const tr = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      });
      const tj = await tr.json();
      const access = tj && tj.access_token;
      if (!access) return redirect(`${PUBLIC_URL()}/?login=failed`);

      const ur = await fetch("https://discord.com/api/users/@me", {
        headers: { authorization: `Bearer ${access}`, "user-agent": UA },
      });
      const uj = await ur.json();
      const id = uj && uj.id ? uj.id : "";
      if (!id) return redirect(`${PUBLIC_URL()}/?login=failed`);

      const token = await signPayload(
        `u:${id}|${uj.username || ""}|${uj.global_name || ""}|${uj.avatar || ""}|${Math.floor(Date.now() / 1000) + 604800}`,
        SECRET()
      );

      // Sunucu uyeligini hemen kontrol et + refresh token'i sakla (bot gerekmez)
      let member = false;
      try {
        const guilds = await discordGuilds(access);
        const gid = await discordGuildId();
        member = !!(guilds && gid && guilds.some((g) => g.id === gid));
      } catch {
        /* yoksay */
      }
      try {
        const kv = store();
        await kvSet(kv, "site:discord:" + id, {
          id,
          refresh: tj.refresh_token || "",
          member,
          checked_at: Date.now(),
        });
      } catch {
        /* yoksay */
      }

      const res = redirect(`${PUBLIC_URL()}/?login=ok`);
      res.headers.append("set-cookie", userCookie(token));
      return res;
    } catch {
      return redirect(`${PUBLIC_URL()}/?login=failed`);
    }
  }

  // ---------------------------------------------------------- oturum bilgisi
  if (path === "me") {
    const user = await currentUser(req);
    if (!user) return json({ ok: false });
    let member = false;
    try {
      const kv = store();
      const rec = await kvGet(kv, "site:discord:" + user.id, null);
      member = !!(rec && rec.member);
      const stale = !rec || Date.now() - (rec.checked_at || 0) > 15 * 60_000;
      if (stale && rec && rec.refresh) {
        const tk = await refreshDiscordToken(rec.refresh);
        if (tk) {
          const guilds = await discordGuilds(tk.access_token);
          const gid = await discordGuildId();
          member = !!(guilds && gid && guilds.some((g) => g.id === gid));
          rec.refresh = tk.refresh_token || rec.refresh;
          rec.member = member;
          rec.checked_at = Date.now();
          await kvSet(kv, "site:discord:" + user.id, rec);
        }
      }
    } catch {
      /* yoksay */
    }
    return json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        global_name: user.global_name,
        avatar: user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
          : "",
      },
      member,
      guild_id: await discordGuildId(),
      invite: `https://discord.gg/${DISCORD_INVITE}`,
    });
  }

  // ---------------------------------------------------------- cikis
  if (path === "logout") {
    const res = json({ ok: true });
    res.headers.append("set-cookie", clearUserCookie());
    return res;
  }

  // ---------------------------------------------------------- lisans sorgu
  if (path === "license") {
    const user = await currentUser(req);
    if (!user) return err("login_required", 401);

    const b = await readBody(req);
    const key = String(b.key || "").slice(0, 200);
    const hwid = String(b.hwid || "").toUpperCase().replace(/[^0-9A-F]/g, "").slice(0, 64);
    const parsed = parseKey(key);
    if (!parsed) return json({ ok: false, status: "invalid_key" });

    const kv = store();
    const rec = await kvGet(kv, "key:" + parsed.bare, null);
    if (!rec) return json({ ok: false, status: "unknown_key" });

    const c = hwid ? await loadCommunity(kv, hwid) : {};
    const bound = rec.bound_hwid ? rec.bound_hwid.toUpperCase() : "";
    const sameHwid = !bound || !hwid || bound === hwid;

    let status = rec.status || "active";
    if (status === "active" && rec.expiry && rec.expiry < Date.now()) status = "expired";
    if (rec.status === "revoked") {
      status =
        rec.revoke_reason && String(rec.revoke_reason).startsWith("community")
          ? "community_required"
          : "revoked";
    }
    if (!sameHwid) status = "hwid_mismatch";

    return json({
      ok: true,
      status,
      tier: parsed.tier,
      expiry: parsed.expiry * 1000,
      expiry_ms: rec.expiry || 0,
      note: rec.note || "",
      hwid_match: sameHwid,
      bound_hwid: bound,
      community_required: !!rec.community_required,
      community: {
        group: !!c.steam_group,
        tag: !!c.steam_tag,
        discord: !!c.discord_guild,
        mask: maskOf(c),
      },
      key: formatKey(parsed.bare),
    });
  }

  return err("not found", 404);
};
