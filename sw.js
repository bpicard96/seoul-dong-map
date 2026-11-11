const CACHE='seoul-map-v2';
const SHELL=['./','index.html','sync.js','firebase-config.js','manifest.webmanifest','icon-192.png','icon-512.png','icon-180.png'];
const OK_HOSTS=['www.gstatic.com','fonts.googleapis.com','fonts.gstatic.com'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  // only the app's own files, the Firebase SDK and fonts; never the sync traffic itself
  if(e.request.method!=='GET'||(u.origin!==self.location.origin&&!OK_HOSTS.includes(u.hostname)))return;
  e.respondWith(fetch(e.request).then(r=>{
    if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}
    return r;
  }).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||(e.request.mode==='navigate'?caches.match('index.html'):Response.error()))));
});
