# SwanChanger Store

Ayrı Netlify projesinde yayınlanan herkese açık satış/lisans vitrini.

- Statik arayüz: `public/`
- Kalıcı API ve lisans verisi: `https://nihujohiuhjiuoj.netlify.app/api/*`
- Proxy tanımı: `netlify.toml`
- Admin paneli: `https://nihujohiuhjiuoj.netlify.app/`

`/api/*` istekleri admin projesine same-origin proxy ile aktarılır. Bu sayede
Discord session cookie, lisans kayıtları, güncel manifest ve DLL tek veri
kaynağından gelir.
