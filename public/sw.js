const C='near-cash-v10';
const F=['./','index.html','offline.html','styles.css','app.js','live.js','config.js','manifest.webmanifest','icons/logo.svg','icons/icon-96.png','icons/icon-192.png','icons/icon-512.png','icons/favicon.png','icons/icon-48.png','icons/icon-180.png','icons/apple-touch-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(async c=>{await Promise.all(F.map(x=>c.add(x).catch(()=>{})));await self.skipWaiting()}))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('message',e=>{if(e.data&&e.data.type==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/'))return;
  e.respondWith(fetch(e.request).then(r=>{if(r.ok){const x=r.clone();caches.open(C).then(c=>c.put(e.request,x)).catch(()=>{})}return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('offline.html')||caches.match('index.html'))));
});
