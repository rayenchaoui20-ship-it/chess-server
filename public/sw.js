/* عامل خدمة بسيط: يجعل الموقع قابلًا للتثبيت، ويُبقي الصفحة الأساسية متاحة إن انقطع الاتصال لحظة.
   الشبكة أولًا دائمًا، فلا تظهر نسخ قديمة من الموقع. لا يمسّ Socket.IO ولا واجهات الخادم. */
var CACHE = 'chess-shell-v1';
var SKIP = /^\/(socket\.io|api|admin|healthz|vendor\/stockfish)/;
self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
    e.waitUntil(caches.keys().then(function (ks) {
        return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
    var r = e.request, u = new URL(r.url);
    if (r.method !== 'GET' || u.origin !== location.origin || SKIP.test(u.pathname)) return;
    e.respondWith(fetch(r).then(function (res) {
        if (res && res.ok && res.type === 'basic') { var c = res.clone(); caches.open(CACHE).then(function (ch) { ch.put(r, c); }); }
        return res;
    }).catch(function () {
        return caches.match(r).then(function (m) { return m || (r.mode === 'navigate' ? caches.match('/') : Response.error()); });
    }));
});
