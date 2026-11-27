// Cloudflare Worker - tek giriş noktası.
//
// Netlify'de her dosya ayrı bir fonksiyondu ve /api/* -> /.netlify/functions/*
// yönlendirmesi vardı. Cloudflare'de tek bir Worker var: /api/** handler'lara
// dağıtılır, geri kalan her şey static asset olarak sunulur (Workers Static
// Assets). Böylece mağaza + panel + API aynı origin'de çalışır (session cookie
// sorunu yaşanmaz).
//
// Handler'lar (req) => Response biçiminde yazıldı; Worker'da aynen kullanilir.
//
// Ayarlar (vars + secret):
//   ADMIN_KEY           : panel giriş şifresi (bos -> giris kapali, fail closed)
//   SITE_SESSION_SECRET : session cookie HMAC anahtari (bos -> ADMIN_KEY)
//   LOADOUT_KEY         : skin/loadout sifreleme anahtari (32 bayt, base64/hex)
//   PUBLIC_SITE_URL     : panelin kendi adresi (Discord OAuth geri donusu)
//   D1 binding: KV      : veritabani (kv tablosu)
//   ASSETS binding      : public/ klasoru (statik dosyalar)

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
import { setEnv } from "./_lib.mjs";

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

function notFound() {
  return new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}

export default {
  async fetch(request, env) {
    // binding'leri _lib'e ver (getEnv oradan okuyor)
    setEnv(env);

    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === "/api" || pathname.startsWith("/api/")) {
      const head = pathname.replace(/^\/+/, "").replace(/^api\//, "").split("/")[0].toLowerCase();
      const handler = routes[head];

      if (!handler) return notFound();
      if (request.method === "OPTIONS") return new Response(null, { status: 204 });

      try {
        const response = await handler(request);
        // Her API yanitinda "private, no-store" olmali (cache + Set-Cookie)
        const headers = new Headers(response.headers);
        if (!headers.has("cache-control")) headers.set("cache-control", "private, no-store");
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

    // statik dosyalar (mağaza, panel, assets)
    if (env.ASSETS) {
      const res = await env.ASSETS.fetch(request);
      const headers = new Headers(res.headers);

      // Panel güvenlik başlıkları (Firebase Hosting'de de aynı ayar vardı)
      if (pathname === "/admin.html" || pathname === "/admin" || pathname.startsWith("/admin/")) {
        headers.set("X-Robots-Tag", "noindex, nofollow");
        headers.set("X-Frame-Options", "DENY");
        headers.set("Referrer-Policy", "no-referrer");
        headers.set("Cache-Control", "no-cache, must-revalidate");
      }
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
};
