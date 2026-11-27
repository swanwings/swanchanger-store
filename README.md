# SwanChanger — Store + Admin Panel + API

Tüm altyapı **Cloudflare** üzerinde çalışıyor (kart/ücret gerekmez):

| Katman | Ne | Nerede |
|---|---|---|
| Worker | API + statik site (mağaza + panel) | `https://swanchanger.swanwings.workers.dev` |
| D1 | Netlify Blobs (KV) yerine veritabanı | binding: `KV` → db `swanchanger` |
| Static Assets | `public/` klasoru (mağaza, panel, DLL/EXE) | ayni Worker, ayni origin |
| Eski alan adı | `swanchanger.web.app` → 302 ile Worker'a yönlendirir | Firebase Hosting |
| DLL dağıtımı | `/downloads/SwanChanger.dll` (CDN) + GitHub raw yedeği | manifest v40 |

Panel ile API **aynı origin**'dedir (`session` cookie sorunu yaşanmaz).

## Klasörler

```
public/            -> Worker static assets (index.html = magaza, admin.html = panel)
worker/src/        -> Worker kodu (13 handler + _lib.mjs)
worker/schema.sql  -> D1 semasi (kv tablosu)
wrangler.jsonc     -> Worker + D1 + assets yapilandirmasi
firebase.json      -> sadece eski alan adinin 302 yonlendirmesi
.dev.vars          -> GIZLI ayarlar (git'e GIRMEZ)
```

## Gizli ayarlar (`.dev.vars`)

```
ADMIN_KEY=...             panel giris sifresi
SITE_SESSION_SECRET=...   session cookie HMAC anahtari
LOADOUT_KEY=...           skin/loadout AES-256-GCM anahtari (32 bayt)
```

Uretimde bunlar Worker **secret** olarak tutulur:

```bash
npx wrangler secret put ADMIN_KEY
npx wrangler secret put SITE_SESSION_SECRET
npx wrangler secret put LOADOUT_KEY
```

> NOT: `wrangler deploy` secret'lari **silmez**, ama yeni bir Worker adi/hesabi
> kullanirsan secret'lar yeniden yuklenmelidir. `npx wrangler secret list` ile
> kontrol et.

## Komutlar

```bash
npx wrangler deploy                      # Worker + assets yayinla
npx wrangler d1 execute swanchanger --remote --file=./worker/schema.sql   # tablo olustur
npx wrangler d1 execute swanchanger --remote --command "SELECT COUNT(*) FROM kv"
npx wrangler tail                        # canli loglar
```

## API

| Uc | Aciklama |
|---|---|
| `POST /api/auth` | panel girisi (`{password}`) -> `swan_sess` cookie (12 saat) |
| `GET /api/auth/check` | oturum kontrolu |
| `GET /api/list` | panel verisi (lisanslar, kullanicilar, ozet) |
| `POST /api/keys` | anahtar uret (`{count,days,tier,note}`) |
| `PUT/DELETE /api/keys` | lisans iptal / geri al / sil |
| `GET /api/report?k=&h=` | lisans dogrulama (istemci heartbeat) |
| `POST /api/peer` | peer senkron (HMAC imzali) + loadout (sifreli) |
| `GET /api/community/status?h=` | topluluk durumu |
| `GET /api/swan/manifest` | loader manifesti (version, sha256, size, url) |
| `GET /api/swan/dll` | 302 -> `/downloads/SwanChanger.dll` |
| `POST /api/swan/publish` | (admin) manifest yaz |

## Loadout sifreleme

Skinler (`loadout`) veritabaninda **duz metin olarak tutulmaz**:

* `AES-256-GCM` (WebCrypto), 12 bayt IV, 128 bit tag
* anahtar: `LOADOUT_KEY` yoksa `SITE_SESSION_SECRET`/`ADMIN_KEY`'den HKDF-SHA256
* anahtar hicbir sekilde yoksa loadout **kaydedilmez** (fail-closed)
* D1 dökümünde yalnizca `loadoutEnc: {v,alg,iv,tag,ct}` görünür

## Notlar

* D1 satır limiti 2 MB, SQL ifadesi limiti 100 KB → büyük değerler `anahtar::part:i`
  satırlarına bölünür (şeffaf, `get()` birleştirir).
* Worker free plan: günlük 100k istek, invocation başına 50 sorgu → liste
  endpoint'leri D1 `batch()` kullanır.
* Firebase Functions **kullanılmıyor** (Blaze/billing gerekliyordu).
