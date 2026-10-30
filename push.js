'use strict';
// إشعارات الهاتف (Web Push). تحتاج مكتبة web-push ومتغيّرين: VAPID_PUBLIC و VAPID_PRIVATE.
// إن غابت المكتبة أو المفاتيح يعمل الموقع بصورة طبيعية بلا إشعارات (enabled=false).

function init({ env, lib, log }) {
    const e = env || process.env;
    const say = log || (() => {});
    let wp = lib || null;
    if (!wp) { try { wp = require('web-push'); } catch (err) { wp = null; } }
    const pub = String(e.VAPID_PUBLIC || '').trim(), prv = String(e.VAPID_PRIVATE || '').trim();
    if (!wp || !pub || !prv) {
        say(wp ? 'Push: VAPID keys missing, disabled' : 'Push: web-push package missing, disabled');
        return { enabled: false, publicKey: null, send: async () => 'off' };
    }
    try { wp.setVapidDetails(e.VAPID_SUBJECT || 'mailto:noreply@example.com', pub, prv); }
    catch (err) { say('Push: invalid VAPID keys, disabled (' + err.message + ')'); return { enabled: false, publicKey: null, send: async () => 'off' }; }
    return {
        enabled: true,
        publicKey: pub,
        // 'ok' | 'gone' (الاشتراك منتهٍ فيُحذف) | 'err'
        async send(sub, payload) {
            try {
                await wp.sendNotification(sub, JSON.stringify(payload), { TTL: 3600, urgency: 'normal' });
                return 'ok';
            } catch (err) {
                return err && (err.statusCode === 404 || err.statusCode === 410) ? 'gone' : 'err';
            }
        }
    };
}

// تحقق من شكل الاشتراك القادم من المتصفح
function validSub(s) {
    if (!s || typeof s !== 'object') return null;
    const ep = String(s.endpoint || '');
    if (!/^https:\/\/[^\s]{10,500}$/.test(ep)) return null;
    const k = s.keys || {};
    if (typeof k.p256dh !== 'string' || typeof k.auth !== 'string' || k.p256dh.length > 200 || k.auth.length > 100) return null;
    return { endpoint: ep, keys: { p256dh: k.p256dh, auth: k.auth } };
}

module.exports = { init, validSub };
