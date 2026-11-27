// /api/list — panel verisi: anahtarlar + kullanıcılar + özet (giriş korumalı)

import { store, sessionValid, json, err, kvGet, kvListKeys } from "./_lib.mjs";

export default async (req) => {
  if (!(await sessionValid(req.headers.get("cookie"))))
    return err("unauthorized", 401);

  const kv = store();
  const keys = [];
  const users = [];

  // Anahtarları doğrudan store üzerinden (key: prefix) tararız.
  // Eski key:index listesi read-modify-write yarışlarında "index'te var
  // ama kayıt yok" artıkları bırakabiliyordu; index artık okunmuyor.
  const rawKeyList = await kvListKeys(kv, "key:");
  const bareList = rawKeyList
    .map((full) => full.slice(4)) // "key:" öneki
    .filter((bare) => bare && bare !== "index");
  // Tek batch (D1 sorgu limiti: invocation basina 50 sorgu)
  const keyMap = await kv.getMany(bareList.map((b) => "key:" + b));
  for (const bare of bareList) {
    const v = keyMap.get("key:" + bare);
    if (v) keys.push(v);
  }

  // Kullanıcıları index üzerinden topla
  const userIndex = await kvGet(kv, "user:index", []);
  const userMap = await kv.getMany(userIndex.map((ip) => "user:" + ip));
  for (const ip of userIndex) {
    const u = userMap.get("user:" + ip);
    if (u) users.push(u);
  }

  users.sort((a, b) => b.last - a.last);
  keys.sort((a, b) => (b.created || 0) - (a.created || 0));

  const now = Date.now();
  const summary = {
    users: users.length,
    hwids: new Set(users.map((u) => u.hwid).filter(Boolean)).size,
    keys_total: keys.length,
    keys_active: keys.filter(
      (k) => k.status !== "revoked" && (k.expiry || 0) > now
    ).length,
    reports: (await kvGet(kv, "stats", {})).reports || 0,
  };

  return json({ keys, users, summary });
};
