// Cloudflare Worker - tek giriş noktası.
//
// Netlify'de her dosya ayrı bir fonksiyondu ve /api/* -> /.netlify/functions/*
// yönlendirmesi vardı. Cloudflare'de tek bir Worker var: /api/** handler'lara
// dağıtılır, mağaza static asset olarak sunulur, PANEL ise private GitHub
// reposundan çekilir (panel kodu herkese açık depoda değil).
//
// Handler'lar (req) => Response biçiminde yazıldı; Worker'da aynen kullanilir.
//
// Ayarlar (vars + secret):
//   ADMIN_KEY           : panel giriş sifresi (bos -> giris kapali, fail closed)
//   SITE_SESSION_SECRET : session cookie HMAC anahtari (bos -> ADMIN_KEY)
//   LOADOUT_KEY         : skin/loadout sifreleme anahtari (32 bayt, base64/hex)
//   PUBLIC_SITE_URL     : panelin kendi adresi (Discord OAuth geri donusu)
//   GITHUB_TOKEN        : secret (private repo icin PAT)
//   GITHUB_REPO         : "owner/repo" (panel + loadout deposu)
//   GITHUB_BRANCH       : "main"
//   D1 binding: KV      : veritabani (kv tablosu) - lisans/kullanici/stats
//   ASSETS binding      : public/ klasoru (magaza + indirmeler)

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
import loadouts from "./loadouts.mjs";
import { setEnv, csrfOk, PANEL_ORIGINS } from "./_lib.mjs";
import { ghGetFile } from "./_github.mjs";
import { loadoutsFlush, loadoutsEnabled } from "./_loadouts.mjs";

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
  loadouts,
};

// Panel dosyasi private GitHub reposunda: "docs/index.html".
// Ayni dosya GitHub Pages'inin kok dosyasi olarak da sunulur
// (Pages kaynagi: main /docs) -> tek kopya, iki yerde ayni icerik.
const PANEL_FILE = "docs/index.html";

// Herkese acik (cookie gerektirmeyen) API'ler — CORS "*" ile calisir.
const PUBLIC_API = new Set(["report", "community", "peer", "swan"]);

// Panel API'leri — CORS "credentials: true" ile, izinli Origin'lere.
const ADMIN_API = new Set(["auth", "keys", "users", "ban", "loadouts", "list", "migrate"]);

function notFound() {
  return new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}

// Panel sayfasini private GitHub reposundan getirir.
async function panelFromGithub() {
  try {
    const file = await ghGetFile(PANEL_FILE);
    if (!file || !file.content) return null;
    return file.content;
  } catch (e) {
    console.error("[panel] github okunamadi:", e && e.message);
    return null;
  }
}

export default {
  async fetch(request, env, ctx) {
    // binding'leri _lib'e ver (getEnv oradan okuyor)
    setEnv(env);

    const url = new URL(request.url);
    const pathname = url.pathname;

    // ── Panel (private GitHub reposundan)
    if (
      (pathname === "/admin.html" || pathname === "/admin" || pathname === "/admin/") &&
      request.method === "GET"
    ) {
      const html = await panelFromGithub();
      const headers = new Headers({
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache, must-revalidate",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'",
      });
      if (html) return new Response(html, { status: 200, headers });

      // GitHub erisilemiyorsa: panel herkese acik depoda DEGIL (ozel repo
      // kurali) -> 503 ver. (Asset fallback'i sonsuz redirect dongusu yaratir:
      // run_worker_first yuzünden ASSETS.fetch tekrar Worker'a cagirir.)
      const h503 = new Headers({
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-cache, must-revalidate",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
      });
      return new Response(
        JSON.stringify({
          error: "panel kaynak dosyasi alinamadi",
          hint: "GITHUB_TOKEN / GITHUB_REPO secret-varlari kontrol et",
        }),
        { status: 503, headers: h503 }
      );
    }

    if (pathname === "/api" || pathname.startsWith("/api/")) {
      const head = pathname.replace(/^\/+/, "").replace(/^api\//, "").split("/")[0].toLowerCase();
      const handler = routes[head];

      if (!handler) return notFound();

      // ── Origin / CORS
      const origin = (request.headers.get("origin") || "").replace(/\/+$/, "");
      const selfOrigin = url.origin.replace(/\/+$/, "");
      const originKnown = !origin || origin === selfOrigin || PANEL_ORIGINS().includes(origin);

      if (request.method === "OPTIONS") {
        const h = new Headers({
          "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
          "access-control-allow-headers": "content-type,x-swan-admin",
          "access-control-max-age": "600",
          vary: "Origin",
        });
        if (!originKnown) {
          return new Response(null, { status: 403, headers: h });
        }
        if (PUBLIC_API.has(head)) {
          h.set("access-control-allow-origin", "*");
        } else if (origin) {
          h.set("access-control-allow-origin", origin);
          h.set("access-control-allow-credentials", "true");
        } else {
          h.set("access-control-allow-origin", "*");
        }
        return new Response(null, { status: 204, headers: h });
      }

      // ── CSRF: durum degistiren panel isteklerinde izinli Origin zorunlu
      // (CLI/script ise x-swan-admin basligi ile geçer).
      if (
        ADMIN_API.has(head) &&
        request.method !== "GET" &&
        request.method !== "HEAD" &&
        !csrfOk(request)
      ) {
        return new Response(JSON.stringify({ error: "forbidden origin" }), {
          status: 403,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "private, no-store",
          },
        });
      }

      try {
        const response = await handler(request);
        // Her API yanitinda "private, no-store" olmali (cache + Set-Cookie)
        const headers = new Headers(response.headers);
        if (!headers.has("cache-control")) headers.set("cache-control", "private, no-store");

        // Magaza swanchanger.web.app (Firebase Hosting) uzerinden cross-origin
        // /api/report cagirir -> CORS gerekli (cookie yok, public endpoint).
        if (PUBLIC_API.has(head)) {
          headers.set("access-control-allow-origin", "*");
          headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
          headers.set("access-control-allow-headers", "content-type");
        } else if (origin && originKnown) {
          // Panel (Worker veya GitHub Pages) -> credentialed CORS
          headers.set("access-control-allow-origin", origin);
          headers.set("access-control-allow-credentials", "true");
          headers.set("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
          headers.set("access-control-allow-headers", "content-type,x-swan-admin");
          headers.append("vary", "Origin");
        }

        // Arka planda: bekleyen loadout degisikliklerini GitHub'a yaz
        if (ctx && ctx.waitUntil && loadoutsEnabled()) {
          ctx.waitUntil(loadoutsFlush().catch(() => {}));
        }

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch (error) {
        console.error("[api] handler error:", error);
        return new Response(JSON.stringify({ error: "internal" }), {
          status: 500,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "private, no-store",
          },
        });
      }
    }

    // statik dosyalar (mağaza, indirmeler)
    if (env.ASSETS) {
      const res = await env.ASSETS.fetch(request);
      const headers = new Headers(res.headers);

      if (pathname === "/" || pathname === "/index.html") {
        headers.set("Cache-Control", "no-cache, must-revalidate");
      }
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    }

    return new Response("not found", { status: 404 });
  },

  // Cron: 5 dakikada bir bekleyen loadout degisikliklerini GitHub'a yaz
  // (yedek ag — write-behind zaten istek sonrasi yaziyor)
  async scheduled(event, env, ctx) {
    setEnv(env);
    if (!loadoutsEnabled()) return;
    const r = await loadoutsFlush();
    console.log("[cron] loadout senkron:", JSON.stringify(r));
  },
};
