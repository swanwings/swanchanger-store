// /api/diag — TEK SEFERLIK teşhis (admin only). Anahtar degerleri ASLA yazılmaz,
// sadece uzunluk/format/hazir bilgisi.
import {
  json,
  err,
  unauthorized,
  sessionValid,
  getEnv,
  ADMIN_KEY,
  ADMIN_USER,
  loadoutEncryptionReady,
} from "./_lib.mjs";

function keyInfo(raw) {
  if (!raw) return { present: false };
  const out = { present: true, length: raw.length };
  out.isHex64 = /^[0-9a-f]{64}$/i.test(raw);
  out.isBase64 = /^[A-Za-z0-9+/=_-]+$/.test(raw);
  try {
    const bin = atob(raw);
    out.b64Bytes = bin.length;
    out.b64Is32 = bin.length === 32;
  } catch {
    out.b64Bytes = -1;
  }
  out.looksLikeBase64Url = /^[A-Za-z0-9_-]+$/.test(raw) && !out.isHex64;
  return out;
}

export default async (req) => {
  const header = req.headers.get("x-swan-admin");
  if (!(header && header === ADMIN_KEY()) && !(await sessionValid(req.headers.get("cookie")))) {
    return unauthorized();
  }
  if (req.method !== "GET") return err("method", 405);

  let ready = false;
  let errMsg = null;
  try {
    ready = await loadoutEncryptionReady();
  } catch (e) {
    errMsg = String((e && e.message) || e);
  }

  return json({
    ok: true,
    env: {
      ADMIN_KEY: !!getEnv("ADMIN_KEY", ""),
      ADMIN_USER: !!getEnv("ADMIN_USER", ""),
      SITE_SESSION_SECRET: !!getEnv("SITE_SESSION_SECRET", ""),
      LOADOUT_KEY: !!getEnv("LOADOUT_KEY", ""),
      GITHUB_TOKEN: !!getEnv("GITHUB_TOKEN", ""),
      GITHUB_REPO: getEnv("GITHUB_REPO", ""),
    },
    loadoutKey: keyInfo(getEnv("LOADOUT_KEY", "")),
    sessionSecret: keyInfo(getEnv("SITE_SESSION_SECRET", "") || getEnv("ADMIN_KEY", "")),
    encryptionReady: ready,
    encryptionError: errMsg,
  });
};
