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
    function buttons() {
        var st = Mono.state && Mono.state();
        $('#mp-voice').toggleClass('hidden', !st).text(joined ? '📴 ' + T('اترك الصوت') : '🎙 ' + T('انضم للصوت')).attr('aria-pressed', String(joined));
        $('#mp-mic').toggleClass('hidden', !joined).text(muted ? '🔇 ' + T('مكتوم') : '🎤 ' + T('يعمل')).attr('aria-pressed', String(!muted));
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
