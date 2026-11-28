// Loadout deposu — GitHub (private repo) uzerinde
//
// Skinler (loadout) artik private GitHub reposunda tutulur:
//   data/loadouts.json  -> { version, updated, items: { "<steamid>": {enc, nick, updated} } }
//
// "enc" alani AES-256-GCM ciphertext'idir (iv/tag/ct) — anahtar Worker'da
// kalir, GitHub'a SIFRELI veri gider. Repo ele gecse bile skinler okunamaz.
//
// Yazma modeli: write-behind (hizli yaz + arka plan GitHub senkron)
//   - okuma: GitHub dosyasi bellekte ~20 sn cache'lenir
//   - yazma: degisiklik "kirli" olarak isaretlenir, yanit hemen doner,
//     GitHub'a yazma istegi ctx.waitUntil ile arka planda yapilir
//   - 5 dakikada bir cron ile de guvenlik agi (yedek) calisir

import { ghGetFile, ghPutFile, githubConfigured } from "./_github.mjs";

const FILE = "data/loadouts.json";
const CACHE_MS = 20_000;

let cache = null; // { data, sha, at }
const dirty = new Map(); // steamid -> { enc, nick }
let flushing = false;

const emptyData = () => ({ version: 1, updated: new Date().toISOString(), items: {} });

function parse(content) {
  if (!content) return emptyData();
  try {
    const j = JSON.parse(content);
    if (!j || typeof j !== "object") return emptyData();
    if (!j.items || typeof j.items !== "object") j.items = {};
    if (!j.version) j.version = 1;
    return j;
  } catch {
    return emptyData();
  }
}

export const loadoutsEnabled = () => githubConfigured();

/** Tum loadout kayitlarini getirir (bellek cache'li). */
export async function loadoutsRead() {
  if (!loadoutsEnabled()) return emptyData();
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.data;
  try {
    const file = await ghGetFile(FILE);
    const data = parse(file && file.content);
    cache = { data, sha: (file && file.sha) || null, at: now };
    return data;
  } catch (e) {
    console.error("[loadouts] okunamadi:", e && e.message);
    if (cache) return cache.data;
    return emptyData();
  }
}

/** Tek bir steamid'nin kaydini getirir. */
export async function loadoutGet(steamid) {
  const data = await loadoutsRead();
  return data.items[String(steamid)] || null;
}

/** Kayit yazar (write-behind): hizli bellek + kirli isareti. */
export async function loadoutSet(steamid, enc, nick = "") {
  const sid = String(steamid);
  if (!sid) return false;
  if (!loadoutsEnabled()) return false;

  const data = await loadoutsRead();
  data.items[sid] = {
    enc: enc || null,
    nick: String(nick || "").slice(0, 64),
    updated: Date.now(),
  };
  data.updated = new Date().toISOString();
  if (cache) {
    cache.data = data;
    cache.at = Date.now();
  }
  dirty.set(sid, data.items[sid]);
  return true;
}

/** Kayit siler. */
export async function loadoutDelete(steamid) {
  const sid = String(steamid);
  const data = await loadoutsRead();
  if (!data.items[sid]) return false;
  delete data.items[sid];
  data.updated = new Date().toISOString();
  if (cache) {
    cache.data = data;
    cache.at = Date.now();
  }
  dirty.set(sid, null); // null = sil
  return true;
}

/** Kirli kayitlari GitHub'a yazar (artan sirali, tek commit). */
export async function loadoutsFlush() {
  if (!loadoutsEnabled()) return { ok: false, reason: "github yok" };
  if (flushing) return { ok: false, reason: "zaten yaziliyor" };
  if (!dirty.size) return { ok: true, written: 0 };

  flushing = true;
  try {
    // Her zaman en guncel dosyayi oku (baska bir islem yazmis olabilir)
    const file = await ghGetFile(FILE);
    const data = parse(file && file.content);

    for (const [sid, rec] of dirty.entries()) {
      if (rec === null) delete data.items[sid];
      else data.items[sid] = rec;
    }
    const count = dirty.size;
    dirty.clear();

    data.updated = new Date().toISOString();
    await ghPutFile(FILE, JSON.stringify(data, null, 2), `loadouts: ${count} kayit guncellendi`);
    cache = { data, sha: null, at: Date.now() };
    return { ok: true, written: count };
  } catch (e) {
    console.error("[loadouts] yazilamadi:", e && e.message);
    return { ok: false, reason: String((e && e.message) || e) };
  } finally {
    flushing = false;
  }
}

/** Manuel (panel) senkron — bekleyen degisiklikleri zorla yazar. */
export async function loadoutsSync() {
  if (!dirty.size) {
    // yine de dosyayi tazele
    cache = null;
    const data = await loadoutsRead();
    return { ok: true, written: 0, total: Object.keys(data.items).length };
  }
  const r = await loadoutsFlush();
  const data = await loadoutsRead();
  return { ...r, total: Object.keys(data.items).length };
}
