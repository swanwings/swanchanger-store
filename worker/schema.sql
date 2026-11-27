-- SwanChanger D1 semasi
-- Netlify Blobs KV yerine geçer. Tek tablo: anahtar -> JSON deger.
-- Buyuk degerler (1 MiB+) otomatik olarak "<key>::part:<i>" satirlarina bölünür,
-- anahtar satirinda {__big:1, chunks:N, ...} isaretci durur.
CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  u INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS kv_k_idx ON kv (k);
