// Firebase Cloud Functions - tek giriş noktası.
//
// Netlify'de her dosya ayrı bir fonksiyondu ve /api/* -> /.netlify/functions/*
// yönlendirmesi vardı. Firebase'de tek bir "api" fonksiyonu var ve yönlendirme
// swanchanger.web.app/api/** -> api olacak (firebase.json). Bu dosya gelen
// isteği yola göre eski handler'a dağıtır.
//
// Handler'lar (req) => Response biçiminde yazıldı; burada express req'i Web
// Request'e çevirip dönen Response'u express res'e yazıyoruz — böylece Netlify
// sürümündeki davranış birebir korunuyor.

import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";

import report from "./report.mjs";
import keys from "./keys.mjs";
import peer from "./peer.mjs";
import community from "./community.mjs";
import site from "./site.mjs";
import list from "./list.mjs";
import users from "./users.mjs";
import ban from "./ban.mjs";
import swan from "./swan.mjs";
import auth from "./auth.mjs";
import migrate from "./migrate.mjs";

setGlobalOptions({
  region: "europe-west1",
  maxInstances: 10,
  memory: "256MiB",
  timeoutSeconds: 60,
  concurrency: 40,
});

// ── Ayarlar ───────────────────────────────────────────────────────────────
//   Hassas degerler functions/.env dosyasinda durur (deploy paketine GIRMEZ);
//   Firebase CLI bu .env dosyasini okuyup degerleri parametre olarak cozumler ve
//   fonksiyonun runtime ortamina (process.env) yazar.
//   Not: Billing acildiktan sonra daha guclu kullanim icin Secret Manager'a
//   tasiyabilirsin: firebase functions:secrets:set ADMIN_KEY  (ve digerleri)
//   ADMIN_KEY           : panel giriş şifresi (boşsa giriş kapalı - fail closed)
//   SITE_SESSION_SECRET : session cookie HMAC anahtarı (boşsa ADMIN_KEY kullanılır)
//   LOADOUT_KEY         : skin/loadout şifreleme anahtarı (32 bayt, base64/hex)
//   PUBLIC_SITE_URL     : panelin kendi adresi (Discord OAuth geri dönüşü)
const ADMIN_KEY = defineString("ADMIN_KEY", { default: "" });
const SITE_SESSION_SECRET = defineString("SITE_SESSION_SECRET", { default: "" });
const LOADOUT_KEY = defineString("LOADOUT_KEY", { default: "" });
const DISCORD_CLIENT_ID = defineString("DISCORD_CLIENT_ID", { default: "" });
const DISCORD_CLIENT_SECRET = defineString("DISCORD_CLIENT_SECRET", { default: "" });
const DISCORD_INVITE = defineString("DISCORD_INVITE", { default: "" });
const DISCORD_WEBHOOK = defineString("DISCORD_WEBHOOK", { default: "" });
const PUBLIC_SITE_URL = defineString("PUBLIC_SITE_URL", { default: "https://swanchanger.web.app" });

const routes = {
  report,
  keys,
  peer,
  community,
  site,
  list,
  users,
  ban,
  swan,
  auth,
  migrate,
};

function buildHeaders(expressHeaders, clientIp) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(expressHeaders || {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, String(item));
    } else {
      headers.set(key, String(value));
    }
  }
  // IP: Hosting -> Function proxy'sinde x-forwarded-for gelir; dogrudan cagri
  // (emulator / test) express'in req.ip'sini kullanir.
  const forwarded = headers.get("x-forwarded-for");
  if ((!forwarded || !forwarded.trim()) && clientIp) {
    headers.set("x-forwarded-for", String(clientIp));
  }
  return headers;
}

export const api = onRequest(async (req, res) => {
  const host = req.headers.host || "swanchanger.web.app";
  const originalUrl = req.originalUrl || req.url || "/";
  const url = new URL(originalUrl, `https://${host}`);

  const head = url.pathname.replace(/^\/+/, "").replace(/^api\//, "").split("/")[0].toLowerCase();
  const handler = routes[head];

  if (!handler) {
    res.status(404).json({ error: "not found" });
    return;
  }

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const method = (req.method || "GET").toUpperCase();
  const withBody = !["GET", "HEAD"].includes(method);

  let body;
  if (withBody) {
    // firebase-functions v2 ham gövdeyi req.rawBody olarak verir
    body = req.rawBody && req.rawBody.length ? req.rawBody : Buffer.alloc(0);
  }

  const webRequest = new Request(url.toString(), {
    method,
    headers: buildHeaders(req.headers, req.ip || req.socket?.remoteAddress),
    body,
  });

  try {
    const response = await handler(webRequest);
    res.status(response.status);

    // Birden fazla Set-Cookie ayrı ayrı yazılmalı (Headers.forEach hepsini
    // virgülle birleştirir ve tarayıcı cookie'yi bozar).
    const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    for (const [key, value] of response.headers) {
      if (key.toLowerCase() === "set-cookie") continue;
      res.setHeader(key, value);
    }
    for (const cookie of setCookies) res.append("set-cookie", cookie);

    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (error) {
    console.error("[api] handler error:", error);
    res.status(500).json({ error: "internal" });
  }
});
