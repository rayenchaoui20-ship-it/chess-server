'use strict';
// الدردشة الصوتية لغرف ملك المدينة عبر WebRTC (اتصال مباشر بين اللاعبين).
// الخادم هنا يمرّر «إشارات» التعارف فقط (SDP) ولا يمرّ الصوت عبره.
//
// الأمان: لا نثق بما يدّعيه العميل عن غرفته. نتتبّع رسائل mp_update التي يرسلها الخادم نفسه
// إلى كل لاعب (وفيها كود الغرفة)، ولا يُقبل الانضمام الصوتي إلا لغرفة ثبت أن الخادم أدخله فيها.

const MAX_VOICE = 8;
const MAX_SDP = 8000;

function iceFromEnv(env) {
    const servers = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
    if (env.TURN_URL) {
        servers.push({ urls: env.TURN_URL.split(',').map((s) => s.trim()).filter(Boolean), username: env.TURN_USER || '', credential: env.TURN_PASS || '' });
    }
    return servers;
}

function init({ io, nameOf, iceServers }) {
    const ice = iceServers || iceFromEnv(process.env);
    const codeOf = new Map();    // socketId -> كود غرفة ملك المدينة (من رسائل الخادم نفسه)
    const rooms = new Map();     // كود -> Map(socketId -> اسم)
    const joined = new Map();    // socketId -> كود الغرفة الصوتية

    function leave(sid) {
        const code = joined.get(sid);
        if (!code) return;
        joined.delete(sid);
        const r = rooms.get(code);
        if (!r) return;
        r.delete(sid);
        r.forEach((_, other) => io.to(other).emit('voice_left', { id: sid }));
        if (!r.size) rooms.delete(code);
    }

    function onEmit(target, ev, args) {
        if (typeof target !== 'string') return;
        if (ev === 'mp_update' && args[0] && typeof args[0].code === 'string') {
            codeOf.set(target, args[0].code);
            if (joined.has(target) && joined.get(target) !== args[0].code) leave(target);   // انتقل إلى غرفة أخرى
        } else if (ev === 'mp_none') {
            codeOf.delete(target);
            leave(target);
        }
    }

    // يغلّف io الممرَّر لوحدة ملك المدينة ليرى الخادم من أدخل من في أي غرفة، دون تعديل تلك الوحدة
    function wrapIo(real) {
        return new Proxy(real, {
            get(t, k) {
                if (k === 'to' || k === 'in') {
                    return (...a) => {
                        const op = t[k](...a);
                        return new Proxy(op, {
                            get(o, kk) {
                                if (kk === 'emit') return (ev, ...args) => { try { onEmit(a[0], ev, args); } catch (e) { /* ignore */ } return o.emit(ev, ...args); };
                                const v = o[kk];
                                return typeof v === 'function' ? v.bind(o) : v;
                            }
                        });
                    };
                }
                const v = t[k];
                return typeof v === 'function' ? v.bind(t) : v;
            }
        });
    }

    function register(socket) {
        const sid = () => socket.id;
        socket.on('voice_join', () => {
            const code = codeOf.get(sid());
            if (!code) return socket.emit('voice_error', 'ادخل غرفة ملك المدينة أولًا.');
            leave(sid());
            let r = rooms.get(code);
            if (!r) { r = new Map(); rooms.set(code, r); }
            if (r.size >= MAX_VOICE) return socket.emit('voice_error', 'غرفة الصوت ممتلئة.');
            const name = String(nameOf(socket.data && socket.data.token) || 'لاعب').slice(0, 20);
            const peers = [...r.entries()].map(([id, n]) => ({ id, name: n }));
            r.set(sid(), name);
            joined.set(sid(), code);
            socket.emit('voice_peers', { peers, ice });
        });

        socket.on('voice_signal', (d) => {
            const code = joined.get(sid());
            if (!code || !d || typeof d.to !== 'string' || !d.data || typeof d.data !== 'object') return;
            const r = rooms.get(code);
            if (!r || !r.has(d.to) || d.to === sid()) return;
            const t = d.data.type;
            if ((t !== 'offer' && t !== 'answer') || typeof d.data.sdp !== 'string' || d.data.sdp.length > MAX_SDP) return;
            const now = Date.now();
            socket.data.vlog = (socket.data.vlog || []).filter((x) => now - x < 10000);
            if (socket.data.vlog.length >= 40) return;
            socket.data.vlog.push(now);
            io.to(d.to).emit('voice_signal', { from: sid(), name: r.get(sid()), data: { type: t, sdp: d.data.sdp } });
        });

        socket.on('voice_leave', () => leave(sid()));
        socket.on('mp_leave', () => { codeOf.delete(sid()); leave(sid()); });
        socket.on('disconnect', () => { codeOf.delete(sid()); leave(sid()); });
    }

    return { wrapIo, register, _state: { codeOf, rooms, joined } };
}

module.exports = { init, iceFromEnv };
