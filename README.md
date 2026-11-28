# SwanChanger — Mağaza + Panel + API

Bu depo **herkese açık** (public). İçinde mağaza, Worker (API) ve indirme
dosyaları var. **Panel kodu ve loadout (skin) verisi burada değil** — onlar
özel GitHub reposunda: `swanwings/swanchanger-private`.

## Mimari

```
        swanchanger.web.app                 (Firebase Hosting — 302)
        ├── /                      → Worker  (mağaza statik)
        ├── /admin, /admin.html    → Worker  (panel: private GitHub'dan)
        ├── /api/report            → Worker
        ├── /api/community/*       → Worker
        └── /downloads/*.exe       → GitHub raw (yedek dağıtım)

   swanchanger.swanwings.workers.dev        (Cloudflare Worker + D1 + Assets)
        ├── /                → public/index.html (mağaza)
        ├── /admin.html      → private GitHub reposundaki docs/index.html
        ├── /api/*           → Worker handler'ları (D1)
        └── /downloads/*     → DLL/EXE statik varlıklar

   swanwings/swanchanger-private            (ÖZEL GitHub repo — panel + loadout)
        ├── docs/index.html      → panel (aynı zamanda GitHub Pages kökü)
        └── data/loadouts.json   → skin'ler AES-256-GCM ŞİFRELİ
```

### Neden panel GitHub'da?

* Panel HTML'i **public depoda yok** → panelin kaynağı sadece private repoda.
* GitHub Pages paneli `https://swanwings.github.io/swanchanger-private/`
  adresinde yayınlar; Worker da aynı dosyayı `/admin.html` altında sunar
  (tek kopya, `sync_panel.mjs` ile senkron).
* Panel sayfası görünse bile **veri yok**: tüm veriler Worker API'sinden
  gelir ve isim+şifre olmadan dönmez.

### Panel koruması (isim + şifre)

| katman | koruma |
|---|---|
| repo | private |
| giriş | `ADMIN_USER` (isim) + `ADMIN_KEY` (şifre) → `swan_sess` cookie (HttpOnly, Secure, SameSite=None) |
| kaba kuvvet | IP hash'li sayaç: 10 başarısız deneme / 5 dk → `429` |
| CSRF | mutasyonlarda izinli `Origin` (veya `x-swan-admin`) şart |
| gizlilik | `X-Robots-Tag: noindex`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` |

## Loadout (skin) güvenliği

* `data/loadouts.json` içindeki her kayıt `{v, alg, iv, tag, ct}` — AES-256-GCM.
* Anahtar `LOADOUT_KEY` secret'ı → **sadece Worker'da**. Repo ele geçse bile
  skinler okunamaz. Anahtar yoksa kayıt yazılmaz (fail-closed).
* Yazma modeli: *write-behind* (hızlı yanıt + arka planda GitHub) ve 5 dakikada
  bir cron yedeği. Panelden "github senkron" ile anında yazılır.

## Deploy

```bash
npx wrangler deploy                      # Worker + D1 + Assets
npx wrangler secret list                 # secret'lar kontrol (olmali):
#   ADMIN_KEY, ADMIN_USER, SITE_SESSION_SECRET, LOADOUT_KEY, GITHUB_TOKEN

cd ../private-repo
node sync_panel.mjs                      # panel kaynagini kopyala
git add -A && git commit -m "panel" && git push
```

Mağaza (Firebase):

```bash
node "C:/Users/pc/AppData/Local/npm-cache/_npx/7750544ccf494d8b/node_modules/firebase-tools/lib/bin/firebase.js" \
  deploy --only hosting --project swanchanger
```

> Not: Firebase Hosting'de `**` glob'u `destination` içinde çalışmıyor; API
> yönlendirmeleri tek tek yazıldı (`/api/report`, `/api/community/:path*`, …).

## Dosya düzeni

```
worker/src/
  index.mjs      → yönlendirme, CORS/CSRF, panel servisi, cron
  _lib.mjs       → D1 KV shim, AES-256-GCM, session, origin/csrf
  _github.mjs    → GitHub Contents API istemcisi (private repo)
  _loadouts.mjs  → loadout deposu (GitHub, şifreli, write-behind)
  auth.mjs       → isim+şifre giriş, kaba kuvvet koruması
  loadouts.mjs   → /api/loadouts (admin)
  peer.mjs       → /api/peer (imzalı peer listesi + loadout senkron)
  report/keys/users/ban/community/list/site/swan/migrate
public/          → mağaza + indirmeler (panel YOK)
panel-src/       → panel kaynağının yerel kopyası (gitignore)
```

## 🔒 Güvenlik notları

* `ADMIN_KEY`, `ADMIN_USER`, `LOADOUT_KEY`, `SITE_SESSION_SECRET`,
  `GITHUB_TOKEN` → **asla** sohbete/chat'e/commit'e yazılmaz; sadece
  `wrangler secret` ve `.dev.vars` (gitignore) içinde tutulur.
* Loader DLL'i SHA-256 + boyut ile doğrular; GitHub raw yedeği de aynı
  dosyadır.
* Loadout anahtarı rotasyonu mevcut skin'leri geçersiz kılar.
* Bilinen borç: offline lisans cache'i DLL içindeki XOR anahtarıyla
  forge edilebilir → `C:\SwanChanger` ACL'si sıkılaştırılmalı, cache'e
  "sunucu doğruladı" bayrağı eklenmeli.
