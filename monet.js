'use strict';
// الربح من الموقع: عضوية داعمة (VIP) عبر Lemon Squeezy، وإعلانات AdSense اختيارية، وزر دعم.
// كل شيء يُفعَّل بمتغيّرات بيئة؛ بدونها يبقى الموقع كما هو بلا أي إعلان أو دفع.
//   LS_CHECKOUT_URL   رابط الدفع من Lemon Squeezy (يُضاف إليه معرّف اللاعب تلقائيًا)
//   LS_WEBHOOK_SECRET السرّ الذي تكتبه عند إنشاء الـ webhook في Lemon Squeezy
//   VIP_PRICE         نص السعر للعرض فقط (مثال: «3$ شهريًا»)
//   ADSENSE_CLIENT    مثال: ca-pub-1234567890123456
//   ADSENSE_SLOT      رقم وحدة الإعلان
//   LS_CHECKOUT_URL_YEAR / VIP_PRICE_YEAR  خطة سنوية اختيارية (نفس الـ webhook)
//   SPONSOR_NAME, SPONSOR_TEXT, SPONSOR_URL, SPONSOR_CTA  راعٍ مباشر يظهر كبطاقة «برعاية» (بلا تتبّع)
//   SPONSOR_CONTACT   رابط https أو mailto: لزر «أعلن معنا» عندما لا يوجد راعٍ
//   LS_PACK_ARAB_URL / LS_PACK_ROYAL_URL / LS_PACK_ALL_URL + PRICE_PACK_ARAB / _ROYAL / _ALL  حزم مظاهر تُشترى مرة واحدة
//   LS_SCHOOL_URL + PRICE_SCHOOL  ترخيص المدرّب/المدرسة (اشتراك سنوي)
//   TOURNEY_SPONSOR, TOURNEY_SPONSOR_URL  راعي «بطولة الأسبوع» (اسم ورابط https)
//   SUPPORT_URL       رابط دعم اختياري (Ko-fi أو PayPal.me أو Buy Me a Coffee)
const crypto = require('crypto');
const DAY = 864e5;
const PACKS = ['arab', 'royal', 'all'];

function config(env) {
    const e = env || {};
    const url = (v) => (typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v.trim()) ? v.trim() : null);
    const client = typeof e.ADSENSE_CLIENT === 'string' && /^ca-pub-\d{10,20}$/.test(e.ADSENSE_CLIENT.trim()) ? e.ADSENSE_CLIENT.trim() : null;
    const slot = typeof e.ADSENSE_SLOT === 'string' && /^\d{6,20}$/.test(e.ADSENSE_SLOT.trim()) ? e.ADSENSE_SLOT.trim() : null;
    const clip = (v, n) => String(v || '').replace(/[<>\u0000-\u001f]/g, ' ').trim().slice(0, n);
    const contact = typeof e.SPONSOR_CONTACT === 'string' && /^(https:\/\/|mailto:)[^\s]+$/.test(e.SPONSOR_CONTACT.trim()) ? e.SPONSOR_CONTACT.trim().slice(0, 200) : null;
    const sUrl = url(e.SPONSOR_URL), sName = clip(e.SPONSOR_NAME, 40);
    return {
        sponsor: sUrl && sName ? { name: sName, text: clip(e.SPONSOR_TEXT, 120), url: sUrl, cta: clip(e.SPONSOR_CTA, 24) || 'Visit' } : null,
        contact,
        ads: client && slot ? { client, slot } : null,
        support: url(e.SUPPORT_URL),
        packs: PACKS.reduce((o, id) => { const U = id.toUpperCase(); o[id] = { enabled: !!(url(e['LS_PACK_' + U + '_URL']) && e.LS_WEBHOOK_SECRET), price: clip(e['PRICE_PACK_' + U], 40) }; return o; }, {}),
        school: { enabled: !!(url(e.LS_SCHOOL_URL) && e.LS_WEBHOOK_SECRET), price: clip(e.PRICE_SCHOOL, 40) },
        tourney: url(e.TOURNEY_SPONSOR_URL) && clip(e.TOURNEY_SPONSOR, 40) ? { name: clip(e.TOURNEY_SPONSOR, 40), url: url(e.TOURNEY_SPONSOR_URL) } : null,
        vip: { enabled: !!(url(e.LS_CHECKOUT_URL) && e.LS_WEBHOOK_SECRET), price: String(e.VIP_PRICE || '').slice(0, 40), year: !!(url(e.LS_CHECKOUT_URL_YEAR) && e.LS_WEBHOOK_SECRET), priceYear: String(e.VIP_PRICE_YEAR || '').slice(0, 40) }
    };
}
function checkoutUrl(env, token, plan) {
    let raw, extra = '';
    if (typeof plan === 'string' && plan.startsWith('pack:') && PACKS.includes(plan.slice(5))) { raw = env && env['LS_PACK_' + plan.slice(5).toUpperCase() + '_URL']; extra = '&checkout[custom][pack]=' + plan.slice(5); }
    else if (plan === 'school') { raw = env && env.LS_SCHOOL_URL; extra = '&checkout[custom][kind]=school'; }
    else raw = env && (plan === 'year' ? env.LS_CHECKOUT_URL_YEAR : env.LS_CHECKOUT_URL);
    const base = typeof raw === 'string' ? raw.trim() : '';
    if (!/^https:\/\/[^\s]+$/.test(base)) return null;
    return base + (base.includes('?') ? '&' : '?') + 'checkout[custom][uid]=' + encodeURIComponent(token) + extra;
}
function verify(raw, signature, secret) {
    if (!secret || !signature || !Buffer.isBuffer(raw)) return false;
    const mac = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(mac), b = Buffer.from(String(signature).trim());
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const iso = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
// يطبّق حدث دفع على حساب اللاعب. يعيد { token, kind, until | pack, owned } أو null إن لم يكن الحدث ذا صلة
function apply(db, body, now) {
    const meta = body && body.meta, attrs = body && body.data && body.data.attributes;
    const cd = meta && meta.custom_data;
    const ev = meta && meta.event_name, uid = cd && cd.uid;
    if (typeof ev !== 'string' || typeof uid !== 'string') return null;
    const rec = db.players[uid];
    if (!rec || !rec.user) return null;
    // حزمة مظاهر (شراء لمرة واحدة)
    if (typeof cd.pack === 'string') {
        if (!PACKS.includes(cd.pack)) return null;
        const have = new Set(Array.isArray(rec.pk) ? rec.pk : []);
        const ids = cd.pack === 'all' ? ['arab', 'royal'] : [cd.pack];
        if (ev === 'order_created' && attrs && attrs.status === 'paid') ids.forEach((i) => have.add(i));
        else if (ev === 'order_refunded') ids.forEach((i) => have.delete(i));
        else return null;
        rec.pk = [...have];
        return { token: uid, kind: 'pack', pack: cd.pack, owned: ev === 'order_created' };
    }
    const kind = cd.kind === 'school' ? 'school' : 'vip';
    const field = kind === 'school' ? 'sch' : 'vip';
    const orderDays = kind === 'school' ? 370 : 35;
    const cur = rec[field] && rec[field].until > now ? rec[field].until : 0;
    let until = null;
    if (ev === 'order_created' && attrs && attrs.status === 'paid') until = Math.max(cur, now + orderDays * DAY);
    else if (ev === 'subscription_payment_success' || ev === 'subscription_created' || ev === 'subscription_resumed') {
        const r = attrs && iso(attrs.renews_at);
        until = Math.max(cur, r && r > now ? r + 2 * DAY : now + orderDays * DAY);
    } else if (ev === 'subscription_cancelled') {
        const e = attrs && iso(attrs.ends_at);
        until = e && e > now ? e : cur;
    } else if (ev === 'subscription_expired' || ev === 'order_refunded') until = now;
    if (until === null) return null;
    rec[field] = { until, ev, at: now };
    return { token: uid, kind, until };
}
module.exports = { config, checkoutUrl, verify, apply, PACKS };
