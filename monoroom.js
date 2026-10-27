'use strict';
// دعوات ملك المدينة: دعوة صديق أو زميل نادٍ إلى غرفتك مباشرة، ومشاركة غرفتك مع ناديك.
// لا نلمس وحدة اللعبة: كود الغرفة نأخذه مما أثبتته رسائل الخادم نفسه (voice._state.codeOf).

const SHARE_TTL = 30 * 60 * 1000;

function init(deps) {
    // deps: getDb, codeOf(Map socketId->code), emitTo, uname, statusOf, clubOf(token), socketIdOf(token), now?
    const now = deps.now || Date.now;
    const shared = new Map();            // clubId -> { code, by, token, at }

    function liveShare(clubId) {
        const s = shared.get(clubId);
        if (!s) return null;
        const sid = deps.socketIdOf(s.token);
        if (now() - s.at > SHARE_TTL || !sid || deps.codeOf.get(sid) !== s.code) { shared.delete(clubId); return null; }
        return s;
    }
    const pub = (s) => (s ? { code: s.code, by: s.by } : null);
    function pushClub(c) {
        const p = pub(liveShare(c.id));
        c.members.forEach((t) => deps.emitTo(t, 'mp_club_room', p));
    }

    function register(socket) {
        const db = () => deps.getDb();
        function me() {
            const token = socket.data && socket.data.token;
            const rec = token && db().players[token];
            if (!rec || !rec.user) { socket.emit('mp_room_error', 'سجّل الدخول أولًا.'); return null; }
            const code = deps.codeOf.get(socket.id);
            return { token, rec, code };
        }
        const fail = (m) => socket.emit('mp_room_error', m);

        socket.on('mp_invite', (d) => {
            const a = me(); if (!a) return;
            if (!a.code) return fail('ادخل غرفة ملك المدينة أولًا.');
            const name = String((d && d.username) || '').toLowerCase().replace(/^@/, '').slice(0, 20);
            const target = db().users[name];
            if (!target || target === a.token) return fail('لا يوجد لاعب بهذا الاسم.');
            const club = deps.clubOf(a.token);
            const ok = (a.rec.friends || []).includes(target) || (club && club.members.includes(target));
            if (!ok) return fail('يمكنك دعوة أصدقائك وأعضاء ناديك فقط.');
            if (deps.statusOf(target) === 'offline') return fail('اللاعب غير متصل الآن.');
            const t = now();
            socket.data.invAt = socket.data.invAt || {};
            if (t - (socket.data.invAt[target] || 0) < 10000) return fail('انتظر قليلًا قبل دعوته مرة أخرى.');
            socket.data.invAt[target] = t;
            deps.emitTo(target, 'mp_invite', { from: a.rec.user, code: a.code });
            socket.emit('mp_room_ok', 'أُرسلت الدعوة إلى ' + deps.uname(target) + '.');
        });

        socket.on('mp_share_club', () => {
            const a = me(); if (!a) return;
            if (!a.code) return fail('ادخل غرفة ملك المدينة أولًا.');
            const c = deps.clubOf(a.token);
            if (!c) return fail('أنت لست عضوًا في نادٍ.');
            shared.set(c.id, { code: a.code, by: a.rec.user, token: a.token, at: now() });
            pushClub(c);
            socket.emit('mp_room_ok', 'شاركت غرفتك مع ناديك.');
        });

        socket.on('mp_unshare_club', () => {
            const a = me(); if (!a) return;
            const c = deps.clubOf(a.token);
            const s = c && shared.get(c.id);
            if (s && s.token === a.token) { shared.delete(c.id); pushClub(c); }
        });

        socket.on('mp_club_room_get', () => {
            const token = socket.data && socket.data.token;
            const c = token && deps.clubOf(token);
            socket.emit('mp_club_room', c ? pub(liveShare(c.id)) : null);
        });
    }

    return { register, _shared: shared };
}

module.exports = { init };
