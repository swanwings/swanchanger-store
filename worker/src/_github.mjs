// GitHub Contents API istemcisi (private repo icin)
// Worker tarafinda kullanilir: token Worker SECRET olarak tutulur, hicbir
// sekilde istemciya (panel/DLL) sizmaz.
//
// Ayarlar (Worker):
//   GITHUB_TOKEN   -> secret (PAT/OAuth, sadece o repo icin Contents: R/W)
//   GITHUB_REPO    -> "owner/repo"  (vars)
//   GITHUB_BRANCH  -> "main"        (vars)

const API = "https://api.github.com";

function cfg() {
  const env = globalThis.__SWAN_ENV || {};
  return {
    token: env.GITHUB_TOKEN || "",
    repo: env.GITHUB_REPO || "",
    branch: env.GITHUB_BRANCH || "main",
  };
}

export const githubConfigured = () => {
  const c = cfg();
  return !!(c.token && c.repo && c.repo.includes("/"));
};

function headers(extra = {}) {
  const { token } = cfg();
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "SwanChanger-Worker/1.0",
    ...extra,
  };
}

// base64 <-> UTF-8 string (tarayici/worker uyumlu)
export function b64encode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function b64decode(b64) {
  const bin = atob(String(b64 || "").replace(/\n/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Tek dosyayi okur: { content, sha } | null (yoksa)
export async function ghGetFile(path) {
  const { repo, branch } = cfg();
  if (!githubConfigured()) return null;
  const url = `${API}/repos/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`;
  const r = await fetch(url, { headers: headers() });
  if (r.status === 404) return null;
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`github GET ${path} -> ${r.status}: ${t.slice(0, 160)}`);
  }
  const j = await r.json();
  const content = j.encoding === "base64" ? b64decode(j.content) : j.content;
  return { content, sha: j.sha, path: j.path };
}

// Dosyayi yazar (yoksa olusturur). SHA cakismasinda (409) bir kez tekrar dener.
export async function ghPutFile(path, content, message) {
  const { repo, branch } = cfg();
  if (!githubConfigured()) throw new Error("github yapilandirilmadi");

  for (let attempt = 0; attempt < 2; attempt++) {
    let sha = null;
    try {
      const existing = await ghGetFile(path);
      if (existing) sha = existing.sha;
    } catch {
      /* yoksay */
    }
    const r = await fetch(`${API}/repos/${repo}/contents/${encodeURI(path)}`, {
      method: "PUT",
      headers: headers({ "content-type": "application/json" }),
      body: JSON.stringify({
        message,
        content: b64encode(content),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (r.ok) {
      const j = await r.json();
      return { sha: (j.content && j.content.sha) || sha, commit: j.commit };
    }
    if (r.status === 409 && attempt === 0) continue; // cakisma -> tekrar dene
    if (r.status === 404 && attempt === 0) {
      // Parent dizin yok -> olustur ve tekrar dene
      const made = await ensureParentDirs(path);
      if (made) continue;
    }
    const t = await r.text();
    throw new Error(`github PUT ${path} -> ${r.status}: ${t.slice(0, 160)}`);
  }
  throw new Error("github PUT: cakisma cozulemedi");
}

// Eksik parent dizinleri olusturur (.gitkeep ile).
async function ensureParentDirs(path) {
  const parts = String(path || "").split("/").slice(0, -1);
  if (!parts.length) return false;
  let made = false;
  let cur = "";
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    const keep = `${cur}/.gitkeep`;
    try {
      const existing = await ghGetFile(keep);
      if (existing) continue;
      const r = await fetch(`${API}/repos/${cfg().repo}/contents/${encodeURI(keep)}`, {
        method: "PUT",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          message: `mkdir ${cur}`,
          content: b64encode(""),
          branch: cfg().branch,
        }),
      });
      if (r.ok) made = true;
    } catch {
      /* yoksay */
    }
  }
  return made;
}
