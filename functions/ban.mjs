// /api/ban — v33 anti-crack: DLL koruması ölümcül saldırı yakaladığında anahtar + HWID yasaklar
// POST /api/ban { k, h, reason, ts, sig }
//   sig = HMAC-SHA256(k:h:ts, BAN_SECRET)  — BAN_SECRET DLL'deki k_ban_sig_secret ile aynı.
// Yanıt: { ok: true, banned: true }
// Yan etkiler:
//   1) hwid:<hex> kara listeye alınır (report.mjs bundan sonra bu makineyi "banned_hwid" der)
//   2) key:<bare> durumu "revoked" yapılır
//   3) user:<ip> durumu "banned" yapılır
//   4) Discord'a kırmızı embed düşer
// Admin kurtarma: DELETE /api/ban?hwid=<hex>  (oturum korumalı — kara liste kaydını siler)

import {
  store,
  formatKey,
  parseKey,
  json,
  err,
  clientIp,
  kvGet,
  kvSet,
  kvDel,
  sessionValid,
  discordNotify,
} from "./_lib.mjs";

const BAN_SECRET = "SwanChanger|ban|sig|v1";
const SIG_WINDOW = 300; // saniye
const ADMIN_HWIDS = new Set(["419184FC97CBE662D94F9E7E5A28E517"]);

async function hmacHex(keyStr, msg) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keyStr),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function ctEq(a, b) {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  const kv = store();

  // Admin kurtarma: HWID kara liste kaydını sil
  if (req.method === "DELETE") {
    if (!(await sessionValid(req.headers.get("cookie")))) return err("unauthorized", 401);
    const u = new URL(req.url);
    const hwid = (u.searchParams.get("hwid") || "").toUpperCase().slice(0, 64);
    if (!hwid) return err("no hwid", 400);
    await kvDel(kv, "hwid:" + hwid);
    return json({ ok: true, removed: hwid });
  }

  if (req.method !== "POST") return err("method", 405);

  let body = {};
  try {
    body = await req.json();
  } catch {}

  const k = String(body.k || "");
  const h = String(body.h || "").toUpperCase().slice(0, 64);
  const reason = String(body.reason || "unknown").slice(0, 120);
  const ts = Number(body.ts);
  const sig = String(body.sig || "");

  if (!k || !h) return err("missing fields", 400);
  if (!Number.isFinite(ts) || !/^[0-9a-f]{64}$/.test(sig)) return err("missing signature", 401);

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > SIG_WINDOW) return err("stale timestamp", 401);
  if (!ctEq(await hmacHex(BAN_SECRET, k + ":" + h + ":" + ts), sig)) return err("bad signature", 401);

  if (ADMIN_HWIDS.has(h)) {
    await kvDel(kv, "hwid:" + h);
    return json({ ok: true, banned: false, admin_exempt: true });
  }

  const ip = clientIp(req);
  const parsed = parseKey(k);

  // 1) HWID kara listesi (bir kez yazılır; tekrar gelen raporlar ezmez)
  const hwidKey = "hwid:" + h;
  const existing = await kvGet(kv, hwidKey, null);
  if (!existing) {
    await kvSet(kv, hwidKey, {
      banned: true,
      reason: "protection:" + reason,
      key: parsed ? formatKey(parsed.bare) : "-",
      ip: ip || "-",
      at: Date.now(),
    });
  }

  // 2) Anahtar iptali
  let keyStatus = "unknown_key";
  if (parsed) {
    const rec = await kvGet(kv, "key:" + parsed.bare, null);
    if (rec) {
      if (rec.status !== "revoked") {
        rec.status = "revoked";
        rec.revoked_reason = "protection:" + reason;
        rec.revoked_at = Date.now();
        await kvSet(kv, "key:" + parsed.bare, rec);
      }
      keyStatus = "revoked";
    }
  }

  // 3) Kullanıcı (IP) kaydı ban
  let userStatus = "no-record";
  if (ip && ip !== "0.0.0.0") {
    const ukey = "user:" + ip;
    const urec = await kvGet(kv, ukey, null);
    if (urec) {
      urec.status = "banned";
      urec.ban_reason = "protection:" + reason;
      urec.last = Date.now();
      await kvSet(kv, ukey, urec);
      userStatus = "banned";
    } else {
      await kvSet(kv, ukey, {
        ip,
        hwid: h,
        key: parsed ? formatKey(parsed.bare) : "-",
        nick: "-",
        status: "banned",
        ban_reason: "protection:" + reason,
        first: Date.now(),
        last: Date.now(),
        hits: 1,
      });
      const index = await kvGet(kv, "user:index", []);
      if (!index.includes(ip)) {
        index.push(ip);
        await kvSet(kv, "user:index", index);
      }
      userStatus = "banned";
    }
  }

  // 4) Discord: kırmızı saldırı bildirimi
  discordNotify({
    title: "🚫 SALDIRI — otomatik ban",
    color: 0xed4245,
    fields: [
      { name: "Sebep", value: reason, inline: false },
      { name: "Anahtar", value: parsed ? formatKey(parsed.bare) : k.slice(0, 24), inline: true },
      { name: "HWID", value: h, inline: true },
      { name: "IP", value: ip || "-", inline: true },
      { name: "Anahtar durumu", value: keyStatus, inline: true },
      { name: "Kullanıcı durumu", value: userStatus, inline: true },
    ],
    timestamp: new Date().toISOString(),
  });

  return json({ ok: true, banned: true });
};
