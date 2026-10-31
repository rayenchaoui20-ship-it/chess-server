/* دردشة صوتية لغرف ملك المدينة (WebRTC بين اللاعبين مباشرة، والخادم يمرّر الإشارات فقط). */
(function () {
    'use strict';
    var APP = window.APP, Mono = window.Mono, $ = window.jQuery;
    if (!APP || !Mono || !$) return;
    var socket = APP.socket;
    var T = window.tr || function (s, p) { return p ? s.replace(/\{(\w+)\}/g, function (m, k) { return p[k] == null ? m : p[k]; }) : s; };

    var peers = {};              // id -> { pc, audio, name, level }
    var local = null;            // MediaStream الميكروفون
    var joined = false, muted = false, busy = false;
    var iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    var myName = '';
    var speaking = {};           // اسم -> true
    var inVoice = {};            // اسم -> true
    var ctx = null, meter = null, localLevel = null;

    function say(msg) { $('#mp-error').text(msg || ''); }
    function supported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection); }

    // ───────── قياس مستوى الصوت (من يتكلم الآن) ─────────
    function level(stream) {
        try {
            ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
            if (ctx.state === 'suspended') ctx.resume();
            var an = ctx.createAnalyser();
            an.fftSize = 256;
            ctx.createMediaStreamSource(stream).connect(an);
            var buf = new Uint8Array(an.fftSize);
            return function () {
                an.getByteTimeDomainData(buf);
                var peak = 0;
                for (var i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
                return peak;
            };
        } catch (e) { return null; }
    }
    function tick() {
        var changed = false;
        function mark(name, on) { if (!!speaking[name] !== on) { changed = true; if (on) speaking[name] = true; else delete speaking[name]; } }
        if (localLevel && myName) mark(myName, !muted && localLevel() > 14);
        Object.keys(peers).forEach(function (id) { var p = peers[id]; if (p.level) mark(p.name, p.level() > 14); });
        if (changed) decorate();
    }

    // ───────── واجهة ─────────
    function renderClubRoomSafe() { try { if (typeof renderClubRoom === 'function') renderClubRoom(); } catch (e) { /* */ } }
    function buttons() {
        var st = Mono.state && Mono.state();
        // ضد الحاسوب وحدك: لا معنى للصوت ولا للتفاعلات ولا للدعوات
        var solo = !!st && !!st.started && (st.players || []).filter(function (p) { return !p.bot; }).length < 2;
        $('#mp-voice').toggleClass('hidden', !st || solo).text(joined ? '📴 ' + T('اترك الصوت') : '🎙 ' + T('انضم للصوت')).attr('aria-pressed', String(joined));
        $('#mp-reactbar').toggleClass('hidden', !st || solo);
        $('#mp-invite, #mp-share').toggleClass('hidden', !st || solo);
        if (!st) $('#mp-invite-box').addClass('hidden');
        renderClubRoomSafe();
        $('#mp-mic').toggleClass('hidden', !joined || solo).text(muted ? '🔇 ' + T('مكتوم') : '🎤 ' + T('يعمل')).attr('aria-pressed', String(!muted));
    }
    function decorate() {
        buttons();
        var st = Mono.state && Mono.state();
        if (!st || !st.game) return;
        $('#mp-plist li').each(function () {
            var pi = +this.getAttribute('data-pi');
            var p = st.players[pi];
            if (!p) return;
            var li = $(this);
            li.toggleClass('speaking', !!speaking[p.name]);
            li.find('.vx').remove();
            if (inVoice[p.name]) li.find('.nm').first().append($('<span class="vx">').text(' 🎙'));
        });
    }

    // ───────── WebRTC ─────────
    function waitGather(pc) {
        return new Promise(function (resolve) {
            if (pc.iceGatheringState === 'complete') return resolve();
            var done = false;
            function fin() { if (!done) { done = true; resolve(); } }
            pc.addEventListener('icegatheringstatechange', function () { if (pc.iceGatheringState === 'complete') fin(); });
            setTimeout(fin, 3000);
        });
    }
    function makePeer(id, name) {
        if (peers[id]) dropPeer(id, true);
        var pc = new RTCPeerConnection({ iceServers: iceServers });
        var p = peers[id] = { pc: pc, name: name, audio: null, level: null };
        local.getTracks().forEach(function (t) { pc.addTrack(t, local); });
        pc.ontrack = function (e) {
            if (p.audio) return;
            var a = document.createElement('audio');
            a.autoplay = true; a.setAttribute('playsinline', '');
            a.srcObject = e.streams[0];
            document.body.appendChild(a);
            p.audio = a;
            p.level = level(e.streams[0]);
            var pr = a.play(); if (pr && pr.catch) pr.catch(function () { /* المتصفح قد يؤجل التشغيل حتى لمسة */ });
        };
        pc.onconnectionstatechange = function () {
            if (pc.connectionState === 'failed') { say(T('تعذّر الاتصال الصوتي بـ{n}. قد تمنعه شبكته.', { n: name })); dropPeer(id); }
        };
        inVoice[name] = true;
        decorate();
        return p;
    }
    function dropPeer(id, keepName) {
        var p = peers[id];
        if (!p) return;
        try { p.pc.close(); } catch (e) { /* ignore */ }
        if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
        delete peers[id];
        if (!keepName) { delete inVoice[p.name]; delete speaking[p.name]; }
        decorate();
    }
    function offerTo(id, name) {
        var p = makePeer(id, name);
        p.pc.createOffer().then(function (o) { return p.pc.setLocalDescription(o); })
            .then(function () { return waitGather(p.pc); })
            .then(function () { socket.emit('voice_signal', { to: id, data: { type: 'offer', sdp: p.pc.localDescription.sdp } }); })
            .catch(function () { dropPeer(id); });
    }
    function onSignal(d) {
        if (!joined || !d || !d.data) return;
        if (d.data.type === 'offer') {
            var p = makePeer(d.from, d.name || T('لاعب'));
            p.pc.setRemoteDescription({ type: 'offer', sdp: d.data.sdp })
                .then(function () { return p.pc.createAnswer(); })
                .then(function (a) { return p.pc.setLocalDescription(a); })
                .then(function () { return waitGather(p.pc); })
                .then(function () { socket.emit('voice_signal', { to: d.from, data: { type: 'answer', sdp: p.pc.localDescription.sdp } }); })
                .catch(function () { dropPeer(d.from); });
        } else if (d.data.type === 'answer' && peers[d.from]) {
            peers[d.from].pc.setRemoteDescription({ type: 'answer', sdp: d.data.sdp }).catch(function () { dropPeer(d.from); });
        }
    }

    function join() {
        if (joined || busy) return;
        if (!supported()) return say(T('متصفحك لا يدعم الدردشة الصوتية.'));
        busy = true; say('');
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
            .then(function (stream) {
                local = stream; joined = true; busy = false; muted = false;
                var st = Mono.state && Mono.state();
                myName = st && st.players[st.me] ? st.players[st.me].name : '';
                if (myName) inVoice[myName] = true;
                localLevel = level(stream);
                meter = meter || setInterval(tick, 150);
                socket.emit('voice_join');
                decorate();
            })
            .catch(function (e) {
                busy = false;
                say(e && e.name === 'NotAllowedError' ? T('لم يُسمح بالميكروفون. فعّله من إعدادات المتصفح ثم حاول مجددًا.') : T('تعذّر تشغيل الميكروفون.'));
                buttons();
            });
    }
    function leave(silent) {
        Object.keys(peers).forEach(function (id) { dropPeer(id); });
        if (local) { local.getTracks().forEach(function (t) { t.stop(); }); local = null; }
        if (joined && !silent) socket.emit('voice_leave');
        joined = false; muted = false; busy = false; localLevel = null;
        inVoice = {}; speaking = {};
        if (meter) { clearInterval(meter); meter = null; }
        decorate();
    }
    function toggleMute() {
        if (!local) return;
        muted = !muted;
        local.getAudioTracks().forEach(function (t) { t.enabled = !muted; });
        buttons();
    }

    socket.on('voice_peers', function (d) {
        if (!joined) return;
        if (d && Array.isArray(d.ice) && d.ice.length) iceServers = d.ice;
        (d.peers || []).forEach(function (p) { offerTo(p.id, p.name); });
        decorate();
    });
    socket.on('voice_signal', onSignal);
    socket.on('voice_left', function (d) { if (d && d.id) dropPeer(d.id); });
    socket.on('voice_error', function (m) { say(m); leave(true); });
    socket.on('mp_none', function () { leave(true); });
    socket.on('disconnect', function () { leave(true); });
    socket.on('mp_update', function () { setTimeout(decorate, 0); });

    document.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-voice]');
        if (!b) return;
        if (b.getAttribute('data-voice') === 'toggle') { if (joined) leave(); else join(); }
        else if (b.getAttribute('data-voice') === 'mute') toggleMute();
    });
    window.addEventListener('pagehide', function () { leave(); });

    // ───────── دعوات الأصدقاء والنادي ─────────
    var known = {};                       // اسم -> متصل الآن؟ (أصدقاء وأعضاء النادي)
    function fillNames() {
        var dl = $('#mp-inv-list').empty();
        Object.keys(known).forEach(function (n) { dl.append($('<option>').attr('value', n)); });
        // أزرار سريعة للمتصلين: ضغطة واحدة ترسل الدعوة
        [['#mp-inv-chips', 'mp'], ['#snk-inv-chips', 'snk']].forEach(function (c) {
            var box = $(c[0]).empty();
            Object.keys(known).filter(function (n) { return known[n]; }).slice(0, 8).forEach(function (n) {
                box.append($('<button type="button" class="btn ghost inv-chip">').attr({ 'data-g': c[1], 'data-u': n }).text('🟢 ' + n));
            });
        });
    }
    $(document).on('click', '.inv-chip', function () {
        var u = $(this).attr('data-u');
        socket.emit($(this).attr('data-g') === 'snk' ? 'sl_invite' : 'mp_invite', { username: u });
    });
    socket.on('friends', function (d) { (d && d.friends || []).forEach(function (f) { known[f.username] = f.status && f.status !== 'offline'; }); fillNames(); });
    socket.on('club', function (d) { if (d && d.club) d.club.members.forEach(function (m) { known[m.username] = known[m.username] || (m.status ? m.status !== 'offline' : false); }); fillNames(); });

    function inRoom() { return !!(Mono.state && Mono.state()); }
    function joinCode(code) {
        function go() { APP.show('mono-screen'); if (Mono.open) Mono.open(); socket.emit('mp_join', { code: code }); }
        if (inRoom()) { socket.emit('mp_leave'); setTimeout(go, 250); } else go();
    }
    $(document).on('click', '#mp-invite', function () { $('#mp-invite-box').toggleClass('hidden'); $('#mp-inv-msg').text(''); $('#mp-inv-user').trigger('focus'); });
    function sendInvite() {
        var u = $('#mp-inv-user').val().trim();
        if (!u) return;
        socket.emit('mp_invite', { username: u });
    }
    $(document).on('click', '#mp-inv-send', sendInvite);
    $(document).on('keydown', '#mp-inv-user', function (e) { if (e.key === 'Enter') { e.preventDefault(); sendInvite(); } });
    $(document).on('click', '#mp-share', function () { socket.emit('mp_share_club'); });
    socket.on('mp_room_ok', function (m) { $('#mp-inv-msg').text(m).css('color', 'var(--win)'); say(''); });
    socket.on('mp_room_error', function (m) { $('#mp-inv-msg').text(m).css('color', 'var(--loss)'); say(m); });

    socket.on('mp_invite', function (d) {
        if (!d || typeof d.code !== 'string' || !/^[A-Z0-9]{3,8}$/i.test(d.code)) return;
        var el = $('#mp-invite-toast').removeClass('hidden').empty().append(
            $('<span>').text('🎲 ' + T('{u} يدعوك إلى ملك المدينة', { u: String(d.from || '') })),
            $('<button class="btn primary" type="button">').text(T('انضم')).on('click', function () { el.addClass('hidden'); joinCode(d.code); }),
            $('<button class="btn ghost" type="button">').text('✕').on('click', function () { el.addClass('hidden'); })
        );
        try { if (window.SFX && localStorage.getItem('chess-sound') !== 'off') window.SFX.play('notify'); } catch (e) { /* */ }
        setTimeout(function () { el.addClass('hidden'); }, 45000);
    });

    var clubRoom = null;
    function renderClubRoom() {
        var box = $('#mp-clubroom');
        if (!clubRoom || inRoom()) return box.addClass('hidden').empty();
        box.removeClass('hidden').empty().append(
            $('<span>').text('🛡 ' + T('{u} فتح غرفة لناديك', { u: clubRoom.by })),
            $('<button class="btn primary" type="button">').text(T('انضم')).on('click', function () { joinCode(clubRoom.code); })
        );
    }
    socket.on('mp_club_room', function (d) { clubRoom = d && d.code ? d : null; renderClubRoom(); });
    setInterval(function () {
        if (!socket.connected || $('#mono-screen').hasClass('hidden')) return;
        if (!inRoom()) socket.emit('mp_club_room_get'); else renderClubRoom();
    }, 8000);
    socket.on('connect', function () { socket.emit('mp_club_room_get'); });

    // ───────── تفاعلات إيموجي ─────────
    $(document).on('click', '#mp-reactbar [data-react]', function () { socket.emit('mp_react', { e: $(this).attr('data-react') }); });
    socket.on('mp_react', function (d) {
        if (!d || typeof d.e !== 'string') return;
        var el = $('<div class="mp-react">').append($('<span class="re">').text(d.e), $('<span class="rn">').text(String(d.from || '')));
        var box = $('#mp-reacts').append(el);
        while (box.children().length > 6) box.children().first().remove();
        try { if (window.SFX && localStorage.getItem('mp-mute') !== '1') window.SFX.play('tick'); } catch (e) { /* */ }
        setTimeout(function () { el.remove(); }, 2800);
    });

    window.Voice = { decorate: decorate, leave: leave, active: function () { return joined; } };
    buttons();
})();
