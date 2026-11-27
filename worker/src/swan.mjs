// /api/swan — loader dağıtımı (DLL güncelleme)
//   GET  /api/swan/manifest        → { version, build, sha256, size, url, published }
//   GET  /api/swan/dll             → DLL binary (application/octet-stream)
//   POST /api/swan/publish         → (admin) manifest'i yaz (JSON gövde)
//   POST /api/swan/publish/start   → (admin) upload id
//   POST /api/swan/publish/chunk   → (admin) tek parça (raw binary)
//   POST /api/swan/publish/commit  → (admin) parçaları birleştir, manifest'i yaz
//
// Loader her açılışta manifest'i çeker, sha256'ya göre cache kontrolü yapar,
// gerekirse DLL'i indirip doğrular. Böylece kullanıcı EXE'yi güncellemek zorunda kalmaz.
//
// DLL kaynağı: GitHub (raw.githubusercontent) — Worker yalnızca STREAM proxy'sidir,
// böylece Worker CPU limitine takılmaz. Kaynak URL'i DLL_SOURCE_URL env'i ile
// verilir; yoksa D1'deki "swan:dll" blob'una düşülür.

import {
  store,
  json,
  err,
  unauthorized,
  sessionValid,
  getEnv,
  ADMIN_KEY,
} from "./_lib.mjs";

const MANIFEST_KEY = "swan:manifest";
const DLL_KEY = "swan:dll";
const PART_PREFIX = "swan:up:";

const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

function toHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function isAdmin(req) {
  const header = req.headers.get("x-swan-admin");
  if (header && header === ADMIN_KEY()) return true;
  return await sessionValid(req.headers.get("cookie"));
}

// D1'deki DLL blob'unu okur (yedek yol)
async function readDllFromStore(kv) {
  try {
    const j = await kv.get(DLL_KEY, { type: "json" });
    if (j && typeof j.b64 === "string") return fromBase64(j.b64);
  } catch {
    /* JSON yok */
  }
  return new Uint8Array(0);
}

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  const action = path.endsWith("/manifest")
    ? "manifest"
    : path.endsWith("/dll")
      ? "dll"
      : path.endsWith("/publish/start")
        ? "start"
        : path.endsWith("/publish/chunk")
          ? "chunk"
          : path.endsWith("/publish/commit")
            ? "commit"
            : path.endsWith("/publish")
              ? "publish"
              : "";

  if (!action) return err("not found", 404);

  const kv = store();

  // ───────────────────────────────────────────── manifest
  if ((req.method === "GET" || req.method === "HEAD") && action === "manifest") {
    let manifest = null;
    try {
      manifest = await kv.get(MANIFEST_KEY, { type: "json" });
    } catch {
      manifest = null;
    }
    if (!manifest) {
      return json({ ok: false, build: "none", message: "no release yet" }, { status: 404 });
    }
    const payload = { ok: true, ...manifest };
    if (req.method === "HEAD") return new Response(null, { status: 200, headers: { "cache-control": "no-store, max-age=0" } });
    return json(payload, { headers: { "cache-control": "no-store, max-age=0" } });
  }

  // ───────────────────────────────────────────── dll
  // Loader, manifest icindeki "url" adresini dogrudan indirir. Bu adres
  // Worker'in kendi static asset'ine (/downloads/SwanChanger.dll) isaret eder;
  // boylece indirme CDN'den gelir, Worker CPU limiti devreye girmez.
  // /api/swan/dll ise geriye donuk uyumluluk icin ayni adrese 302 yonlendirir.
  if ((req.method === "GET" || req.method === "HEAD") && action === "dll") {
    let manifest = null;
    try {
      manifest = await kv.get(MANIFEST_KEY, { type: "json" });
    } catch {
      manifest = null;
    }

    const assetUrl = `${url.origin}/downloads/SwanChanger.dll`;

    if (manifest && manifest.sha256) {
      const target = `${assetUrl}?v=${manifest.sha256}`;
      const headers = new Headers({
        location: target,
        "cache-control": "public, max-age=300",
        "x-swan-sha256": manifest.sha256,
      });
      if (manifest.size) headers.set("content-length", String(0));
      return new Response(null, { status: 302, headers });
    }

    // Manifest yoksa: GitHub kaynagini stream proxy ile dene
    const source = getEnv("DLL_SOURCE_URL", "");
    if (source) {
      try {
        const up = await fetch(source, {
          headers: { "user-agent": "SwanChanger-Worker/1.0" },
        });
        if (up.ok && up.body) {
          const headers = new Headers();
          headers.set("content-type", "application/octet-stream");
          const len = up.headers.get("content-length");
          if (len) headers.set("content-length", len);
          headers.set("cache-control", "public, max-age=300");
          return new Response(req.method === "HEAD" ? null : up.body, { status: 200, headers });
        }
      } catch {
        /* kaynak yok */
      }
    }

    // 2) yedek: D1'deki blob
    const buf = await readDllFromStore(kv);
    if (!buf.byteLength) return err("no dll published", 404);

    let sha = "";
    try {
      const meta = await kv.get(DLL_KEY, { type: "metadata" });
      sha = meta?.metadata?.sha256 || "";
    } catch {
      sha = "";
    }

    return new Response(req.method === "HEAD" ? null : buf, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(buf.byteLength),
        "cache-control": "public, max-age=300",
        "x-swan-sha256": sha,
      },
    });
  }

  // ───────────────────────────────────────────── publish (admin)
  if (req.method === "POST" && action === "publish") {
    if (!(await isAdmin(req))) return unauthorized();

    let body = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const version = Number(body.version || 0);
    const build = String(body.build || "");
    const sha256 = String(body.sha256 || "").toLowerCase();
    const size = Number(body.size || 0);
    const notes = String(body.notes || "");
    if (!sha256 || !/^[0-9a-f]{64}$/.test(sha256)) return err("bad sha256", 400);
    if (!size || size <= 0) return err("bad size", 400);

    const manifest = {
      version,
      build,
      sha256,
      size,
      url: `${url.origin}/downloads/SwanChanger.dll?v=${sha256}`,
      published: new Date().toISOString(),
      notes,
    };
    await kv.setJSON(MANIFEST_KEY, manifest);
    return json({ ok: true, ...manifest });
  }

  if (req.method === "POST" && (action === "start" || action === "chunk" || action === "commit")) {
    if (!(await isAdmin(req))) return unauthorized();

    // ---- start: upload id ver
    if (action === "start") {
      const id = toHex(crypto.getRandomValues(new Uint8Array(8)));
      return json({ ok: true, upload: id, max_chunk: MAX_CHUNK_BYTES });
    }

    // ---- chunk: tek parcayi sakla
    if (action === "chunk") {
      const upload = req.headers.get("x-swan-upload") || "";
      const index = Number(req.headers.get("x-swan-index") || "-1");
      if (!upload || !Number.isInteger(index) || index < 0)
        return err("missing upload/index", 400);

      const body = new Uint8Array(await req.arrayBuffer());
      if (!body.byteLength) return err("empty chunk", 400);
      if (body.byteLength > MAX_CHUNK_BYTES) return err("chunk too large", 413);

      await kv.setJSON(`${PART_PREFIX}${upload}:${index}`, { b64: toBase64(body) });
      return json({ ok: true, index, size: body.byteLength });
    }

    // ---- commit: parcalari birlestir + manifest yaz
    if (action === "commit") {
      const upload = req.headers.get("x-swan-upload") || "";
      const version = Number(req.headers.get("x-swan-version") || "0");
      const build = req.headers.get("x-swan-build") || "";
      const notes = req.headers.get("x-swan-notes") || "";
      if (!upload) return err("missing upload", 400);

      const { blobs } = await kv.list({ prefix: `${PART_PREFIX}${upload}:` });
      const parts = blobs
        .map((b) => ({ key: b.key, idx: Number(b.key.split(":").pop()) }))
        .filter((p) => Number.isInteger(p.idx))
        .sort((a, b) => a.idx - b.idx);

      if (!parts.length) return err("no parts uploaded", 400);

      const chunks = [];
      let total = 0;
      for (const p of parts) {
        let buf = new Uint8Array(0);
        try {
          const part = await kv.get(p.key, { type: "json" });
          if (part && typeof part.b64 === "string") buf = fromBase64(part.b64);
        } catch {
          buf = new Uint8Array(0);
        }
        if (!buf.byteLength) continue;
        chunks.push(buf);
        total += buf.byteLength;
      }
      if (!total) return err("chunks empty", 400);

      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
      }

      const digest = await crypto.subtle.digest("SHA-256", merged);
      const sha256 = toHex(digest);

      await kv.setJSON(DLL_KEY, {
        b64: toBase64(merged),
        sha256,
        size: merged.byteLength,
      });

      const manifest = {
        version,
        build,
        sha256,
        size: merged.byteLength,
        url: `${url.origin}/downloads/SwanChanger.dll?v=${sha256}`,
        published: new Date().toISOString(),
        notes,
      };
      await kv.setJSON(MANIFEST_KEY, manifest);

      // parcalari temizle
      for (const p of parts) {
        try {
          await kv.delete(p.key);
        } catch {
          /* temizlik kritik degil */
        }
      }

      return json({ ok: true, ...manifest });
    }
  }

  return err("method", 405);
};
