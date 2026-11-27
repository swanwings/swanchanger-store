// /api/swan — loader dağıtımı (DLL güncelleme)
//   GET  /api/swan/manifest        → { version, build, sha256, size, url, published }
//   GET  /api/swan/dll             → DLL binary (application/octet-stream)
//   POST /api/swan/publish/start   → (admin) upload id
//   POST /api/swan/publish/chunk   → (admin) tek parça (raw binary)
//   POST /api/swan/publish/commit  → (admin) parçaları birleştir, manifest'i yaz
//
// Loader her açılışta manifest'i çeker, sha256'ya göre cache kontrolü yapar,
// gerekirse DLL'i indirip doğrular. Böylece kullanıcı EXE'yi güncellemek zorunda kalmaz.
//
// NOT: büyük binary'ler base64 metin olarak saklanır (JSON blob) — runtime'ın
// binary blob okuma davranışından bağımsız, her ortamda aynı sonucu verir.

import {
  store,
  json,
  err,
  unauthorized,
  sessionValid,
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

// DLL blob'unu okur: once JSON {b64}, olmazsa ham binary
async function readDll(kv) {
  try {
    const j = await kv.get(DLL_KEY, { type: "json" });
    if (j && typeof j.b64 === "string") return fromBase64(j.b64);
  } catch {
    /* JSON yok -> binary dene */
  }
  try {
    const res = await kv.get(DLL_KEY, { type: "arrayBuffer" });
    const data = res?.data;
    if (!data) return new Uint8Array(0);
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data))
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } catch {
    /* yok */
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
            : "";

  if (!action) return err("not found", 404);

  const kv = store();

  // ───────────────────────────────────────────── manifest
  if (req.method === "GET" && action === "manifest") {
    let manifest = null;
    try {
      manifest = await kv.get(MANIFEST_KEY, { type: "json" });
    } catch {
      manifest = null;
    }
    if (!manifest) {
      return json({ ok: false, build: "none", message: "no release yet" }, { status: 404 });
    }
    return json(
      { ok: true, ...manifest },
      { headers: { "cache-control": "no-store, max-age=0" } }
    );
  }

  // ───────────────────────────────────────────── dll
  if (req.method === "GET" && action === "dll") {
    const buf = await readDll(kv);
    if (!buf.byteLength) return err("no dll published", 404);

    let sha = "";
    try {
      const meta = await kv.get(DLL_KEY, { type: "metadata" });
      sha = meta?.metadata?.sha256 || "";
    } catch {
      sha = "";
    }

    return new Response(buf, {
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
        url: `${url.origin}/api/swan/dll?v=${sha256}`,
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
