'use strict';
// الربح من الموقع: عضوية داعمة (VIP) عبر Lemon Squeezy، وإعلانات AdSense اختيارية، وزر دعم.
// كل شيء يُفعَّل بمتغيّرات بيئة؛ بدونها يبقى الموقع كما هو بلا أي إعلان أو دفع.
//   LS_CHECKOUT_URL   رابط الدفع من Lemon Squeezy (يُضاف إليه معرّف اللاعب تلقائيًا)
//   LS_WEBHOOK_SECRET السرّ الذي تكتبه عند إنشاء الـ webhook في Lemon Squeezy
//   VIP_PRICE         نص السعر للعرض فقط (مثال: «3$ شهريًا»)
//   ADSENSE_CLIENT    مثال: ca-pub-1234567890123456
//   ADSENSE_SLOT      رقم وحدة الإعلان
//   SUPPORT_URL       رابط دعم اختياري (Ko-fi أو PayPal.me أو Buy Me a Coffee)
const crypto = require('crypto');
const DAY = 864e5;

function config(env) {
    const e = env || {};
    const url = (v) => (typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v.trim()) ? v.trim() : null);
    const client = typeof e.ADSENSE_CLIENT === 'string' && /^ca-pub-\d{10,20}$/.test(e.ADSENSE_CLIENT.trim()) ? e.ADSENSE_CLIENT.trim() : null;
    const slot = typeof e.ADSENSE_SLOT === 'string' && /^\d{6,20}$/.test(e.ADSENSE_SLOT.trim()) ? e.ADSENSE_SLOT.trim() : null;
    return {
        ads: client && slot ? { client, slot } : null,
        support: url(e.SUPPORT_URL),
        vip: { enabled: !!(url(e.LS_CHECKOUT_URL) && e.LS_WEBHOOK_SECRET), price: String(e.VIP_PRICE || '').slice(0, 40) }
    };
}
function checkoutUrl(env, token) {
    const base = env && typeof env.LS_CHECKOUT_URL === 'string' ? env.LS_CHECKOUT_URL.trim() : '';
    if (!/^https:\/\/[^\s]+$/.test(base)) return null;
    return base + (base.includes('?') ? '&' : '?') + 'checkout[custom][uid]=' + encodeURIComponent(token);
}
function verify(raw, signature, secret) {
    if (!secret || !signature || !Buffer.isBuffer(raw)) return false;
    const mac = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(mac), b = Buffer.from(String(signature).trim());
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const iso = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
// يطبّق حدث دفع على حساب اللاعب. يعيد { token, until } أو null إن لم يكن الحدث ذا صلة
function apply(db, body, now) {
    const meta = body && body.meta, attrs = body && body.data && body.data.attributes;
    const ev = meta && meta.event_name, uid = meta && meta.custom_data && meta.custom_data.uid;
    if (typeof ev !== 'string' || typeof uid !== 'string') return null;
    const rec = db.players[uid];
    if (!rec || !rec.user) return null;
    const cur = rec.vip && rec.vip.until > now ? rec.vip.until : 0;
    let until = null;
    if (ev === 'order_created' && attrs && attrs.status === 'paid') until = Math.max(cur, now + 35 * DAY);
    else if (ev === 'subscription_payment_success' || ev === 'subscription_created' || ev === 'subscription_resumed') {
        const r = attrs && iso(attrs.renews_at);
        until = Math.max(cur, r && r > now ? r + 2 * DAY : now + 35 * DAY);
    } else if (ev === 'subscription_cancelled') {
        const e = attrs && iso(attrs.ends_at);
        until = e && e > now ? e : cur;
    } else if (ev === 'subscription_expired' || ev === 'order_refunded') until = now;
    if (until === null) return null;
    rec.vip = { until, ev, at: now };
    return { token: uid, until };
}
module.exports = { config, checkoutUrl, verify, apply };
