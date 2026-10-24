'use strict';
// الأندية: كل حساب مسجّل يستطيع الانضمام إلى نادٍ واحد (ينشئه أو ينضم لنادٍ مفتوح).
// البيانات في db.clubs، والعضوية في rec.club. الوحدة لا تعتمد على Express أو Socket.IO مباشرة.

const crypto = require('crypto');

const MAX_MEMBERS = 50;
const MAX_CLUBS = 500;
const CHAT_KEEP = 50;
const NAME_RE = /^[\w؀-ۿ][\w؀-ۿ \-]{1,22}[\w؀-ۿ]$/;

function clubsOf(db) {
    if (!db.clubs || typeof db.clubs !== 'object') db.clubs = {};
    return db.clubs;
}
const cleanText = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f‪-‮]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const same = (a, b) => a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();

// ───────────────────────── منطق البيانات ─────────────────────────
function create(db, token, rawName, rawDesc, safety) {
    const clubs = clubsOf(db);
    const rec = db.players[token];
    if (!rec || !rec.user) return { error: 'سجّل الدخول أولًا لإنشاء نادٍ.' };
    if (rec.club && clubs[rec.club]) return { error: 'أنت عضو في نادٍ بالفعل. غادره أولًا.' };
    const name = cleanText(rawName, 24);
    if (!NAME_RE.test(name)) return { error: 'اسم النادي من 3 إلى 24 حرفًا (حروف وأرقام ومسافة وشرطة فقط).' };
    if (safety && safety.filterText(name).flagged) return { error: 'اسم النادي غير مناسب.' };
    if (Object.values(clubs).some((c) => same(c.name, name))) return { error: 'يوجد نادٍ بهذا الاسم، اختر اسمًا آخر.' };
    if (Object.keys(clubs).length >= MAX_CLUBS) return { error: 'بلغت المنصة الحد الأقصى من الأندية حاليًا.' };
    let desc = cleanText(rawDesc, 80);
    if (safety && desc) desc = safety.filterText(desc).text;
    let id;
    do { id = crypto.randomBytes(4).toString('hex'); } while (clubs[id]);
    clubs[id] = { id, name, desc, owner: token, created: Date.now(), members: [token], chat: [] };
    rec.club = id;
    return { club: clubs[id] };
}

function join(db, token, id) {
    const clubs = clubsOf(db);
    const rec = db.players[token];
    if (!rec || !rec.user) return { error: 'سجّل الدخول أولًا للانضمام إلى نادٍ.' };
    if (rec.club && clubs[rec.club]) return { error: 'أنت عضو في نادٍ بالفعل. غادره أولًا.' };
    const c = clubs[String(id)];
    if (!c) return { error: 'هذا النادي لم يعد موجودًا.' };
    if (c.members.length >= MAX_MEMBERS) return { error: 'النادي ممتلئ.' };
    c.members.push(token);
    rec.club = c.id;
    return { club: c };
}

// يغادر العضو؛ إن كان المالك تنتقل الملكية لأقدم عضو، وإن كان الأخير يُحذف النادي
function leave(db, token) {
    const clubs = clubsOf(db);
    const rec = db.players[token];
    const c = rec && rec.club && clubs[rec.club];
    if (rec) rec.club = null;
    if (!c) return { club: null };
    c.members = c.members.filter((t) => t !== token);
    if (!c.members.length) { delete clubs[c.id]; return { club: null, deleted: true }; }
    if (c.owner === token) c.owner = c.members[0];
    return { club: c };
}

function kick(db, ownerToken, targetToken) {
    const clubs = clubsOf(db);
    const owner = db.players[ownerToken];
    const c = owner && owner.club && clubs[owner.club];
    if (!c || c.owner !== ownerToken) return { error: 'هذا الإجراء لمالك النادي فقط.' };
    if (targetToken === ownerToken) return { error: 'لا يمكنك طرد نفسك. استعمل «غادر النادي».' };
    if (!c.members.includes(targetToken)) return { error: 'هذا اللاعب ليس عضوًا في ناديك.' };
    c.members = c.members.filter((t) => t !== targetToken);
    if (db.players[targetToken]) db.players[targetToken].club = null;
    return { club: c };
}

function addChat(db, token, text) {
    const clubs = clubsOf(db);
    const rec = db.players[token];
    const c = rec && rec.club && clubs[rec.club];
    if (!c || !c.members.includes(token)) return { error: 'يجب أن تكون عضوًا في النادي.' };
    const msg = { u: rec.user, t: text, ts: Date.now() };
    c.chat.push(msg);
    if (c.chat.length > CHAT_KEEP) c.chat.splice(0, c.chat.length - CHAT_KEEP);
    return { club: c, msg };
}

function clubOf(db, token) {
    const rec = db.players[token];
    const c = rec && rec.club && clubsOf(db)[rec.club];
    return c && c.members.includes(token) ? c : null;
}

// درجة النادي: متوسط أعلى 10 تصنيفات بليتز بين الأعضاء
function score(c, ratingOf) {
    const rs = c.members.map((t) => ratingOf(t, 'blitz')).sort((a, b) => b - a).slice(0, 10);
    return rs.length ? Math.round(rs.reduce((a, b) => a + b, 0) / rs.length) : 0;
}

function view(db, c, token, h) {
    const rows = c.members
        .filter((t) => h.uname(t))
        .map((t) => ({ username: h.uname(t), rating: h.ratingOf(t, 'blitz'), status: h.statusOf(t), owner: t === c.owner }))
        .sort((a, b) => b.rating - a.rating);
    return {
        id: c.id, name: c.name, desc: c.desc, count: c.members.length, max: MAX_MEMBERS, score: score(c, h.ratingOf),
        isOwner: c.owner === token, members: rows, chat: c.chat.slice(-CHAT_KEEP)
    };
}

function list(db, h, q) {
    const needle = cleanText(q, 24).toLowerCase();
    return Object.values(clubsOf(db))
        .filter((c) => !needle || c.name.toLowerCase().includes(needle))
        .map((c) => ({ id: c.id, name: c.name, desc: c.desc, count: c.members.length, max: MAX_MEMBERS, score: score(c, h.ratingOf) }))
        .sort((a, b) => b.score - a.score || b.count - a.count)
        .slice(0, 30);
}

// ───────────────────────── ربط Socket.IO ─────────────────────────
// deps: getDb, saveSoon, playerCtx(socket), emitTo(token, ev, payload), tokenOfUser(name),
//       uname, ratingOf, statusOf, safety, challenge(socket, token, targetToken) -> نص خطأ أو null
function init(deps) {
    const db = () => deps.getDb();
    const helpers = { uname: deps.uname, ratingOf: deps.ratingOf, statusOf: deps.statusOf };

    function push(token) {
        const d = db();
        const c = clubOf(d, token);
        deps.emitTo(token, 'club', c ? { club: view(d, c, token, helpers) } : { club: null, list: list(d, helpers, '') });
    }
    function pushAll(c) { c.members.forEach(push); }

    function register(socket) {
        function me() {
            const ctx = deps.playerCtx(socket);
            const rec = ctx && db().players[ctx.token];
            if (!rec || !rec.user) { socket.emit('club_error', 'سجّل الدخول أولًا لاستخدام الأندية.'); return null; }
            return { token: ctx.token, rec };
        }
        const fail = (e) => socket.emit('club_error', e);

        socket.on('club_get', () => { const a = me(); if (a) push(a.token); });
        socket.on('club_list', (d) => {
            const a = me();
            if (a) socket.emit('club_list', list(db(), helpers, d && d.q));
        });
        socket.on('club_create', (d) => {
            const a = me(); if (!a) return;
            const r = create(db(), a.token, d && d.name, d && d.desc, deps.safety);
            if (r.error) return fail(r.error);
            deps.saveSoon(); push(a.token);
        });
        socket.on('club_join', (d) => {
            const a = me(); if (!a) return;
            const r = join(db(), a.token, d && d.id);
            if (r.error) return fail(r.error);
            deps.saveSoon(); pushAll(r.club);
            r.club.members.forEach((t) => { if (t !== a.token) deps.emitTo(t, 'notify', { text: a.rec.user + ' انضم إلى النادي.' }); });
        });
        socket.on('club_leave', () => {
            const a = me(); if (!a) return;
            const r = leave(db(), a.token);
            deps.saveSoon(); push(a.token);
            if (r.club) pushAll(r.club);
        });
        socket.on('club_kick', (d) => {
            const a = me(); if (!a) return;
            const target = deps.tokenOfUser(d && d.username);
            if (!target) return fail('لا يوجد مستخدم بهذا الاسم.');
            const r = kick(db(), a.token, target);
            if (r.error) return fail(r.error);
            deps.saveSoon(); pushAll(r.club); push(target);
            deps.emitTo(target, 'notify', { text: 'تم إخراجك من النادي «' + r.club.name + '».' });
        });
        socket.on('club_chat', (d) => {
            const a = me(); if (!a) return;
            const now = Date.now();
            socket.data.clubLog = (socket.data.clubLog || []).filter((t) => now - t < 8000);
            if (socket.data.clubLog.length >= 5) return fail('تكتب بسرعة كبيرة، تمهّل قليلًا.');
            let text = cleanText(d && d.message, 200);
            if (!text) return;
            if (deps.safety.isMuted(a.rec, now)) return fail('تم تقييد الدردشة لحسابك مؤقتًا بسبب بلاغات من لاعبين.');
            socket.data.spam = socket.data.spam || {};
            if (deps.safety.isSpam(socket.data.spam, text, now)) return fail('لا تكرر الرسالة نفسها.');
            text = deps.safety.filterText(text).text;
            socket.data.clubLog.push(now);
            const r = addChat(db(), a.token, text);
            if (r.error) return fail(r.error);
            deps.saveSoon();
            r.club.members.forEach((t) => deps.emitTo(t, 'club_chat', r.msg));
        });
        socket.on('club_challenge', (d) => {
            const a = me(); if (!a) return;
            const c = clubOf(db(), a.token);
            const target = deps.tokenOfUser(d && d.username);
            if (!c || !target || target === a.token || !c.members.includes(target)) return fail('هذا اللاعب ليس عضوًا في ناديك.');
            const e = deps.challenge(socket, a.token, target);
            if (e) fail(e);
        });
    }

    return { register, push };
}

module.exports = { init, create, join, leave, kick, addChat, clubOf, list, view, score, MAX_MEMBERS };
