/* عامل خدمة خفيف: يجعل الموقع قابلًا للتثبيت فقط.
   لا يعترض أي طلب إلا فتح الصفحة الرئيسية (للعرض عند انقطاع الاتصال). السكربتات والصور وSocket.IO تذهب للشبكة مباشرة. */
var CACHE = 'chess-shell-v4';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
    e.waitUntil(caches.keys().then(function (ks) {
        return Promise.all(ks.map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); }).then(function () {
        // الصفحات التي فُتحت تحت النسخة القديمة المعطوبة تُعاد تحميلها مرة واحدة تلقائيًا
        return self.clients.matchAll({ type: 'window' }).then(function (cs) { cs.forEach(function (c) { try { c.navigate(c.url); } catch (e) { /* */ } }); });
    }));
});
self.addEventListener('fetch', function (e) {
    var r = e.request;
    if (r.mode !== 'navigate' || r.method !== 'GET') return;     // كل ما عدا فتح الصفحة: الشبكة مباشرة
    e.respondWith(fetch(r).then(function (res) {
        if (res && res.ok) { var c = res.clone(); caches.open(CACHE).then(function (ch) { ch.put('/', c); }).catch(function () {}); }
        return res;
    }).catch(function () {
        return caches.match('/').then(function (m) { return m || new Response('لا يوجد اتصال بالإنترنت.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); });
    }));
});

// إشعارات الهاتف
self.addEventListener('push', function (e) {
    var d = {};
    try { d = e.data ? e.data.json() : {}; } catch (x) { d = {}; }
    e.waitUntil(self.registration.showNotification(d.title || 'شطرنج', {
        body: d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url || '/' }, lang: 'ar', dir: 'rtl', tag: d.tag || undefined
    }));
});
self.addEventListener('notificationclick', function (e) {
    e.notification.close();
    var url = (e.notification.data && e.notification.data.url) || '/';
    e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
        for (var i = 0; i < cs.length; i++) { if ('focus' in cs[i]) return cs[i].focus(); }
        return self.clients.openWindow(url);
    }));
});
