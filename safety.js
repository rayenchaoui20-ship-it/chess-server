'use strict';
// الحماية من الإساءة والغش: فلتر نصوص، بلاغات، كشف مؤشرات الغش (للمراجعة وليس للحظر التلقائي).
// دوال نقية بلا اعتماديات، تعمل على كائن قاعدة البيانات db الذي يمرّره الخادم.

// ───────────── فلتر النصوص ─────────────
// كلمات (مطابقة لكلمة كاملة بعد التطبيع) وجذور (مطابقة جزئية للكلمات الطويلة فقط)
const BAD_WORDS = new Set([
    // عربي
    'شرموط', 'شرموطه', 'عاهر', 'عاهره', 'قحبه', 'قحاب', 'منيوك', 'منيك', 'متناك', 'ينعل', 'كسمك', 'كسختك', 'كسام', 'زب', 'زبي', 'طيز', 'خنزير', 'ابن الحرام', 'ولد الزنا', 'ولدالزنا', 'زانيه', 'لوطي', 'ديوث',
    // إنجليزي
    'fuck', 'fck', 'shit', 'bitch', 'asshole', 'cunt', 'dick', 'pussy', 'whore', 'slut', 'bastard', 'nigger', 'nigga', 'faggot', 'retard',
    // فرنسي
    'merde', 'putain', 'connard', 'connasse', 'salope', 'encule', 'enculer', 'nique', 'niquer', 'batard', 'pute'
]);
const BAD_STEMS = ['شرموط', 'قحب', 'منيوك', 'متناك', 'كسمك', 'fuck', 'shit', 'bitch', 'asshole', 'nigg', 'faggot', 'putain', 'connard', 'salope', 'encul'];

function normalize(s) {
    return String(s)
        .toLowerCase()
        .normalize('NFKD').replace(/[ً-ٰٟـ​-‏‪-‮]/g, '')   // تشكيل وتطويل
        .replace(/[̀-ͯ]/g, '')                                                            // علامات لاتينية
        .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
        .replace(/[@4]/g, 'a').replace(/[1!|]/g, 'i').replace(/0/g, 'o').replace(/[$5]/g, 's').replace(/3/g, 'e')
        .replace(/[^a-zء-ي\s]/g, '')                                                      // أبقِ الحروف فقط
        .replace(/(.)\1{2,}/g, '$1$1');                                                             // aaaa -> aa
}
const squash = (s) => s.replace(/(.)\1+/g, '$1');

function isBadToken(tok) {
    const n = normalize(tok).replace(/\s+/g, '');
    if (!n) return false;
    if (BAD_WORDS.has(n) || BAD_WORDS.has(squash(n))) return true;
    if (n.length >= 5) { const q = squash(n); for (const st of BAD_STEMS) if (n.includes(st) || q.includes(squash(st))) return true; }
    return false;
}

const URL_RE = /((https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|io|me|ly|tk|ml|gg|xyz|ru|info)\b\S*)/gi;
const MAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/g;

// يعيد {text, flagged}: النص بعد التنقية، وهل تم تغييره
function filterText(input) {
    const src = String(input == null ? '' : input);
    let out = src.replace(MAIL_RE, '***').replace(URL_RE, '[رابط]').replace(PHONE_RE, '***');
    out = out.split(/(\s+)/).map((tok) => (/\s/.test(tok) || !tok ? tok : (isBadToken(tok) ? '***' : tok))).join('');
    // عبارة من كلمتين
    const joined = normalize(out).replace(/\s+/g, ' ');
    if (/ابن الحرام|ولد الزنا|ابن الكلب/.test(joined)) out = out.replace(/\S+\s+\S+\s+\S+|\S+\s+\S+/g, (m) => (/ابن الحرام|ولد الزنا|ابن الكلب/.test(normalize(m).replace(/\s+/g, ' ')) ? '***' : m));
    return { text: out, flagged: out !== src };
}

// اسم لاعب: إن احتوى إساءة يُستبدل باسم محايد
function safeName(name, fallback) {
    const n = String(name == null ? '' : name);
    if (!n) return n;
    if (filterText(n).flagged) return fallback || 'لاعب';
    return n;
}

// كشف تكرار الرسالة نفسها (سبام)
function isSpam(log, msg, now) {
    const key = normalize(msg).replace(/\s+/g, '');
    log.entries = (log.entries || []).filter((e) => now - e.t < 30000);
    const same = log.entries.filter((e) => e.k === key).length;
    log.entries.push({ t: now, k: key });
    return same >= 2;
}

// ───────────── البلاغات ─────────────
const REASONS = { abuse: 'إساءة في الدردشة', cheat: 'غش (استخدام محرك)', behavior: 'سلوك مزعج' };
const DAY = 24 * 3600 * 1000;
const MAX_REPORTS = 600;
const MUTE_THRESHOLD = 3;            // عدد المبلّغين المختلفين خلال 24 ساعة لتقييد الدردشة تلقائيًا
const MUTE_MS = 60 * 60 * 1000;

function ensure(db) {
    if (!Array.isArray(db.reports)) db.reports = [];
    return db;
}

// يعيد {ok, error?, muted?}
function addReport(db, { reporter, target, reason, gameId, now }) {
    ensure(db);
    now = now || Date.now();
    if (!reporter || !target || reporter === target) return { ok: false, error: 'بلاغ غير صالح.' };
    if (!REASONS[reason]) return { ok: false, error: 'سبب غير صالح.' };
    const recent = db.reports.filter((r) => now - r.t < DAY);
    if (recent.filter((r) => r.by === reporter).length >= 8) return { ok: false, error: 'وصلت إلى حد البلاغات اليومي.' };
    if (recent.some((r) => r.by === reporter && r.to === target && r.why === reason)) return { ok: false, error: 'سبق أن أبلغت عن هذا اللاعب بنفس السبب.' };
    db.reports.push({ t: now, by: reporter, to: target, why: reason, g: gameId || null });
    if (db.reports.length > MAX_REPORTS) db.reports.splice(0, db.reports.length - MAX_REPORTS);
    let muted = false;
    if (reason === 'abuse') {
        const reps = new Set(db.reports.filter((r) => now - r.t < DAY && r.to === target && r.why === 'abuse').map((r) => r.by));
        const rec = db.players && db.players[target];
        if (reps.size >= MUTE_THRESHOLD && rec && !(rec.mutedUntil > now)) { rec.mutedUntil = now + MUTE_MS; muted = true; }
    }
    return { ok: true, muted };
}

const isMuted = (rec, now) => !!(rec && rec.mutedUntil && rec.mutedUntil > (now || Date.now()));

// ───────────── مؤشرات الغش ─────────────
// moves: أزمنة تفكير اللاعب بالمللي ثانية لكل حركة له (بدون أول حركتين)
function timingStats(moves) {
    const a = moves.filter((x) => Number.isFinite(x) && x >= 0);
    const n = a.length;
    if (!n) return { n: 0 };
    const mean = a.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(a.reduce((s, x) => s + (x - mean) * (x - mean), 0) / n);
    const sorted = [...a].sort((x, y) => x - y);
    const median = sorted[Math.floor(n / 2)];
    return { n, mean, sd, cv: mean ? sd / mean : 0, median, fast: a.filter((x) => x < 1000).length / n };
}

// يعيد قائمة إشارات: [{kind, detail}] (فارغة إن لم يُشتبه بشيء)
function gameSignals({ moves, baseMs, rated }) {
    const out = [];
    if (!rated || !moves || moves.length < 20) return out;
    const st = timingStats(moves);
    if (st.mean >= 1500 && st.mean <= 20000 && st.cv < 0.25) out.push({ kind: 'steady_timing', detail: `n=${st.n} mean=${Math.round(st.mean)}ms cv=${st.cv.toFixed(2)}` });
    if (baseMs >= 180000 && st.n >= 25 && st.median < 900) out.push({ kind: 'too_fast', detail: `n=${st.n} median=${Math.round(st.median)}ms` });
    return out;
}

// ارتفاع تصنيف سريع: آخر 10 مباريات مصنَّفة، 9 فوز فأكثر وزيادة 200+ نقطة
function risingSignals(hist) {
    const rated = (hist || []).filter((g) => g.rated && g.res).slice(0, 10);
    if (rated.length < 10) return [];
    const wins = rated.filter((g) => g.res.winner === g.c).length;
    return wins >= 9 ? [{ kind: 'win_streak', detail: `wins=${wins}/10` }] : [];
}

function addFlags(rec, signals, gameId, now) {
    if (!rec || !signals.length) return 0;
    if (!Array.isArray(rec.flags)) rec.flags = [];
    for (const s of signals) {
        if (rec.flags.some((f) => f.g === gameId && f.kind === s.kind)) continue;
        rec.flags.push({ t: now || Date.now(), kind: s.kind, detail: s.detail, g: gameId || null });
    }
    if (rec.flags.length > 40) rec.flags.splice(0, rec.flags.length - 40);
    return signals.length;
}

// ملخّص للمراجعة (لوحة المشرف): بلا رموز سرية، أسماء فقط
function summary(db, now) {
    ensure(db);
    now = now || Date.now();
    const label = (tok) => { const r = db.players && db.players[tok]; return r ? (r.user ? '@' + r.user : (r.name || 'ضيف')) : '؟'; };
    const rows = [];
    for (const [tok, rec] of Object.entries(db.players || {})) {
        const reps = db.reports.filter((r) => r.to === tok);
        if ((rec.flags && rec.flags.length) || isMuted(rec, now) || reps.length) {
            rows.push({ user: label(tok), flags: (rec.flags || []).slice(-8), muted: isMuted(rec, now), reports: reps.length });
        }
    }
    rows.sort((a, b) => (b.flags.length + b.reports) - (a.flags.length + a.reports));
    return {
        reports: db.reports.slice(-60).reverse().map((r) => ({ t: new Date(r.t).toISOString(), by: label(r.by), to: label(r.to), why: REASONS[r.why] || r.why, game: r.g })),
        flagged: rows.slice(0, 50)
    };
}

module.exports = { filterText, safeName, isSpam, addReport, isMuted, gameSignals, risingSignals, addFlags, timingStats, summary, REASONS, normalize };
