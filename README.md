# SwanChanger Store

Ayrı Netlify projesinde yayınlanan herkese açık satış/lisans vitrini.

- Statik arayüz: `public/`
- Kalıcı API ve lisans verisi: `https://nihujohiuhjiuoj.netlify.app/api/*`
- Proxy tanımı: `netlify.toml`
- Admin paneli: `https://nihujohiuhjiuoj.netlify.app/`

`/api/*` istekleri admin projesine same-origin proxy ile aktarılır. Bu sayede
Discord session cookie, lisans kayıtları, güncel manifest ve DLL tek veri
kaynağından gelir.

## Canlı dağıtım

- Netlify projesi: `swanchanger`
- Site ID: `38b4a5c6-63cf-4d84-8775-6a61f2ea352e`
- GitHub kaynağı: `swanwings/swanchanger-store`
- Production branch: `main`
- Publish dizini: `public`

`main` dalına yapılan push'lar Netlify continuous deployment akışını tetikler.
