// _community.mjs — Steam/Discord uyelik kontrol yardimcilari (endpoint degil:
// underscore on eki Netlify'de fonksiyon olarak sayilmaz)

import { getEnv, kvGet, kvSet } from "./_lib.mjs";

export const STEAM_GROUP = "swanwings";
export const STEAM_GROUP_NAME = "swanwings";
export const STEAM_GROUP_ID64 = "103582791475871275";
export const STEAM_TAG = "swanwings";
export const STEAM_GROUP_URL = "https://steamcommunity.com/groups/swanwings";
export const DISCORD_INVITE = getEnv("DISCORD_INVITE", "zT8mfwCT56");
export const DISCORD_SERVER_URL = "https://discord.gg/" + DISCORD_INVITE;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SwanChanger/1.0";

// community maskesi: 1 = Steam grubu, 2 = Steam tag, 4 = Discord sunucusu
// Eger sunucuda DISCORD_CLIENT_ID henuz tanimli degilse (OAuth yapilandirilmamis)
// kullaniciyi engellememek adina Discord sarti otomatik saglanmis sayilir.
export const maskOf = (c) => {
  const discordConfigured = !!getEnv("DISCORD_CLIENT_ID", "");
  const discordDone = c && (c.discord_guild || !discordConfigured);
  return (c && c.steam_group ? 1 : 0) | (c && c.steam_tag ? 2 : 0) | (discordDone ? 4 : 0);
};

export const communityComplete = (c) => (maskOf(c) & 0x7) === 0x7;

// ------------------------------------------------------------------ Steam

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Profil XML'inde <groupName>...<groupName> listesi -> grup uyeligi (guvenilir).
function groupsFromProfileXml(xml) {
  const names = [];
  const re = /<groupName><!\[CDATA\[([\s\S]*?)\]\]><\/groupName>/gi;
  let m;
  while ((m = re.exec(xml))) names.push(m[1].trim().toLowerCase());
  return names;
}

// Profil HTML'inde grup rozeti (profile_primary_group / whiteLink) -> uyelik.
function groupFromProfileHtml(html) {
  if (!html) return false;
  const re = new RegExp(
    "steamcommunity\\.com/groups/" + esc(STEAM_GROUP) + "[\"'>]",
    "i"
  );
  if (!re.test(html)) return false;
  // "primary group" blogu icinde geciyorsa uyelik kesin
  if (/profile_primary_group/i.test(html)) return true;
  return true;
}

// Steam grup etiketleri (tag) herkese acik sayfada bazen gizli olabiliyor.
// Sadece SAYFADA baska bir uyenin etiketi gorunuyorsa bizim uyenin etiketini
// arariz; hic etiket gorunmuyorsa Steam etiketleri gizliyor demektir ve
// dogrulama yapilamaz -> grup uyeligi yeterli sayilir (zorlamiyoruz).
function tagFromMembersPage(html, accountId) {
  if (!html) return { tag: false, verifiable: false };
  const chipRe = /class="[^"]*tag[^"]*"|data-tag="[^"]*"|\btag_label\b/gi;
  const anyChip = chipRe.test(html);
  if (!anyChip) return { tag: false, verifiable: false };

  const id = String(accountId || "");
  const idx = id ? html.indexOf(`data-miniprofile="${id}"`) : -1;
  if (idx < 0) return { tag: false, verifiable: true };

  const start = Math.max(0, idx - 400);
  const window = html.slice(start, Math.min(html.length, idx + 2500));
  const tagRe = new RegExp(
    "(?:class=\"[^\"]*tag[^\"]*\"|data-tag=\"[^\"]*\"|tag_label)[^>]*>[^<]*" +
      esc(STEAM_TAG) +
      "|<[^>]*tag[^>]*>\\s*" +
      esc(STEAM_TAG) +
      "\\s*<",
    "i"
  );
  return { tag: tagRe.test(window), verifiable: true };
}

export async function steamState(steamId64) {
  const out = { group: false, tag: false, tag_ok: false, tag_verifiable: false, account_id: "" };
  const id = String(steamId64 || "").trim();
  if (!/^\d{17}$/.test(id)) return out;
  out.account_id = String(BigInt(id) - 76561197960265728n);

  // 1) XML profil: grup listesi + groupID64 (Steam 3 gruptan sonrasini sadece groupID64 olarak verir)
  try {
    const r = await fetch(`https://steamcommunity.com/profiles/${id}?xml=1`, {
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    });
    const xml = await r.text();
    if (xml) {
      const names = groupsFromProfileXml(xml);
      out.group =
        names.includes(STEAM_GROUP_NAME) ||
        names.includes(STEAM_GROUP) ||
        xml.includes(STEAM_GROUP_ID64);
      // profil gizli mi?
      out.private = /<privacyState>private<\/privacyState>/i.test(xml);
    }
  } catch {
    /* yoksay */
  }

  // 2) HTML profil (yedek + etiket işaretleri)
  try {
    const r = await fetch(`https://steamcommunity.com/profiles/${id}`, {
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    });
    const html = await r.text();
    if (html) {
      if (groupFromProfileHtml(html)) out.group = true;
      const tagRe = new RegExp(
        "(profile_tag|member_tag|group_tag|tag_label|data-tag)[^>]{0,120}" + esc(STEAM_TAG),
        "i"
      );
      if (tagRe.test(html)) out.tag = true;
    }
  } catch {
    /* yoksay */
  }

  // 3) Grup resmi XML uye listesi (en kesin kontrol - profil gizli olsa bile grupta gorunur)
  if (!out.group) {
    try {
      const mr = await fetch(`${STEAM_GROUP_URL}/memberslistxml/?xml=1`, {
        headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
      });
      const mxml = await mr.text();
      if (mxml && mxml.includes(`<steamID64>${id}</steamID64>`)) {
        out.group = true;
      }
    } catch {
      /* yoksay */
    }
  }

  // 4) Grup uyeleri sayfasindaki etiket kontrolu
  try {
    const r = await fetch(`${STEAM_GROUP_URL}/members`, {
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    });
    const html = await r.text();
    const t = tagFromMembersPage(html, out.account_id);
    out.tag = out.tag || t.tag;
    out.tag_verifiable = t.verifiable;
  } catch {
    /* yoksay */
  }

  // CS2/Steam grup etiketleri web profilinde artik herkese acik olarak sunulmuyor.
  // Kullanici gruba uye ise ve tag'ini secme hakki varsa (oyun icinde secmis durumda),
  // grup uyeligi tag sartini da basarili kabul eder.
  if (out.group) {
    out.tag = true;
    out.tag_ok = true;
    out.tag_verifiable = true;
  } else {
    out.tag_ok = out.tag || !out.tag_verifiable;
  }

  return out;
}

// ------------------------------------------------------------------ Discord

let guildIdCache = { id: null, at: 0 };

export async function discordGuildId() {
  if (guildIdCache.id && Date.now() - guildIdCache.at < 3600_000) return guildIdCache.id;
  try {
    const r = await fetch(`https://discord.com/api/v9/invites/${DISCORD_INVITE}`, {
      headers: { "user-agent": UA },
    });
    const j = await r.json();
    const id = j && j.guild && j.guild.id ? j.guild.id : null;
    if (id) guildIdCache = { id, at: Date.now() };
    return id;
  } catch {
    return guildIdCache.id;
  }
}

export async function discordGuilds(accessToken) {
  const r = await fetch("https://discord.com/api/users/@me/guilds", {
    headers: { authorization: `Bearer ${accessToken}`, "user-agent": UA },
  });
  if (!r.ok) return null;
  return await r.json();
}

// Refresh token ile yeni access token (periyodik uyelik kontrolu icin)
export async function refreshDiscordToken(refreshToken) {
  const clientId = getEnv("DISCORD_CLIENT_ID", "");
  const clientSecret = getEnv("DISCORD_CLIENT_SECRET", "");
  if (!clientId || !clientSecret || !refreshToken) return null;
  try {
    const r = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    const j = await r.json();
    return j && j.access_token ? j : null;
  } catch {
    return null;
  }
}

// Discord token deposu (ayri blob: panelde gosterilmez) — HWID bazli
export const discordStoreKey = (hwid) => `discord:${hwid}`;

export async function loadDiscordStore(kv, hwid) {
  return (await kvGet(kv, discordStoreKey(hwid), null)) || {};
}

export const saveDiscordStore = (kv, hwid, value) => kvSet(kv, discordStoreKey(hwid), value);

// ------------------------------------------------------------------ KV
// Community durumu CIHAZ (HWID) bazli tutulur: kullanici lisans anahtarini
// girmeden once kartlari doldurur, bu yuzden key'e baglanamaz.

export const communityStoreKey = (hwid) => `community:${hwid}`;

export async function loadCommunity(kv, hwid) {
  const rec = await kvGet(kv, communityStoreKey(hwid), null);
  return (rec && rec.community) || {};
}

export async function saveCommunity(kv, hwid, patch) {
  const key = communityStoreKey(hwid);
  const rec = (await kvGet(kv, key, null)) || {};
  rec.community = Object.assign({}, rec.community || {}, patch);
  await kvSet(kv, key, rec);
  return rec.community;
}
