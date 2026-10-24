/* محرك الأصوات المشترك بين الشطرنج وملك المدينة (Web Audio، بلا ملفات صوت).
   الاستعمال: SFX.play('move') . الكتم يقرره المستدعي (لكل لعبة زر كتم خاص بها). */
(function () {
    'use strict';
    var ctx = null, out = null, noiseBuf = null;

    function ac() {
        try {
            if (!ctx) {
                var C = window.AudioContext || window.webkitAudioContext;
                if (!C) return null;
                ctx = new C();
                var comp = ctx.createDynamicsCompressor();
                comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 6;
                comp.attack.value = 0.003; comp.release.value = 0.12;
                out = ctx.createGain();
                out.gain.value = 0.9;
                out.connect(comp); comp.connect(ctx.destination);
            }
            if (ctx.state === 'suspended') ctx.resume();
            return ctx;
        } catch (e) { return null; }
    }
    // المتصفحات تمنع الصوت قبل أول لمسة: نفتح السياق عند أول تفاعل
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, ac, { passive: true }); });

    function rnd(a, b) { return a + Math.random() * (b - a); }
    // نغمة: f التردد، d المدة، o: {t نوع الموجة، v الشدة، at التأخير، to تردد النهاية، atk زمن الصعود}
    function tone(f, d, o) {
        var c = ac(); if (!c) return;
        o = o || {};
        var t0 = c.currentTime + (o.at || 0);
        var osc = c.createOscillator(), g = c.createGain();
        osc.type = o.t || 'sine';
        osc.frequency.setValueAtTime(f, t0);
        if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + d);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(o.v || 0.2, t0 + (o.atk || 0.004));
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
        osc.connect(g); g.connect(out);
        osc.start(t0); osc.stop(t0 + d + 0.03);
    }
    // ضجيج مُرشَّح (طقطقة خشب، نرد، حفيف): o: {f تردد المرشح، q، ft نوع المرشح، v، at، to تردد نهاية المرشح}
    function noise(d, o) {
        var c = ac(); if (!c) return;
        o = o || {};
        if (!noiseBuf) {
            noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
            var data = noiseBuf.getChannelData(0);
            for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        }
        var t0 = c.currentTime + (o.at || 0);
        var src = c.createBufferSource();
        src.buffer = noiseBuf;
        var filt = c.createBiquadFilter();
        filt.type = o.ft || 'bandpass';
        filt.frequency.setValueAtTime(o.f || 1500, t0);
        if (o.to) filt.frequency.exponentialRampToValueAtTime(o.to, t0 + d);
        filt.Q.value = o.q || 1;
        var g = c.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(o.v || 0.3, t0 + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
        src.connect(filt); filt.connect(g); g.connect(out);
        src.start(t0, Math.random() * 0.5, d + 0.02);
    }

    // نقرة قطعة على خشب
    function wood(at, power, pitch) {
        var p = pitch || rnd(0.94, 1.06);
        noise(0.045, { f: 1500 * p, q: 1.4, v: 0.55 * power, at: at });
        tone(200 * p, 0.08, { t: 'triangle', to: 110 * p, v: 0.4 * power, at: at });
    }
    function coin(at, f, v) {
        tone(f, 0.28, { t: 'sine', v: v || 0.16, at: at, atk: 0.002 });
        tone(f * 2.01, 0.18, { t: 'sine', v: (v || 0.16) * 0.35, at: at });
    }
    function bell(at, f, v) {
        tone(f, 0.7, { t: 'sine', v: v || 0.2, at: at });
        tone(f * 2.76, 0.4, { t: 'sine', v: (v || 0.2) * 0.25, at: at });
    }

    var S = {
        // ───── الشطرنج ─────
        move: function () { wood(0, 1); },
        capture: function () { wood(0, 1.5, 0.85); noise(0.07, { f: 800, q: 0.8, v: 0.5, at: 0.035 }); tone(130, 0.14, { t: 'triangle', to: 60, v: 0.45 }); },
        castle: function () { wood(0, 1, 0.95); wood(0.12, 1, 1.1); },
        promote: function () { wood(0, 1); [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.16, { t: 'triangle', v: 0.16, at: 0.08 + i * 0.07 }); }); },
        check: function () { wood(0, 1.1); tone(740, 0.14, { v: 0.2, at: 0.06 }); tone(988, 0.2, { v: 0.2, at: 0.15 }); },
        start: function () { tone(440, 0.12, { t: 'triangle', v: 0.16 }); tone(660, 0.2, { t: 'triangle', v: 0.16, at: 0.1 }); },
        end: function () { S.win(); },
        win: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.32, { t: 'triangle', v: 0.2, at: i * 0.11 }); tone(f / 2, 0.32, { v: 0.1, at: i * 0.11 }); }); },
        lose: function () { [392, 330, 262].forEach(function (f, i) { tone(f, 0.38, { t: 'sine', v: 0.2, at: i * 0.16 }); }); },
        draw: function () { tone(494, 0.3, { v: 0.18 }); tone(494, 0.3, { v: 0.18, at: 0.2 }); },
        good: function () { coin(0, 1175, 0.14); coin(0.09, 1568, 0.14); },
        wrong: function () { tone(210, 0.2, { t: 'sawtooth', to: 130, v: 0.16 }); noise(0.12, { f: 400, q: 0.7, v: 0.25 }); },
        notify: function () { tone(660, 0.12, { v: 0.2 }); tone(880, 0.18, { v: 0.2, at: 0.11 }); },
        tick: function () { tone(1250, 0.04, { t: 'square', v: 0.06 }); },

        // ───── ملك المدينة ─────
        dice: function () {
            var i, t = 0;
            for (i = 0; i < 9; i++) { noise(0.035, { f: rnd(1700, 3000), q: 2.2, v: rnd(0.35, 0.6), at: t }); t += 0.045 + i * 0.006; }
            noise(0.05, { f: 1300, q: 1.6, v: 0.7, at: t + 0.02 }); tone(170, 0.07, { t: 'triangle', to: 100, v: 0.35, at: t + 0.02 });
            noise(0.05, { f: 1900, q: 1.6, v: 0.5, at: t + 0.09 });
        },
        step: function (k) { var p = 1 + Math.min(k || 0, 12) * 0.012; tone(380 * p, 0.05, { t: 'triangle', v: 0.17 }); noise(0.02, { f: 2400, q: 1.2, v: 0.14 }); },
        jump: function () { noise(0.28, { f: 400, to: 3000, q: 1.2, v: 0.35 }); tone(300, 0.26, { t: 'sine', to: 900, v: 0.12 }); },
        buy: function () { coin(0, 1318, 0.15); coin(0.08, 1760, 0.15); noise(0.1, { f: 5000, ft: 'highpass', v: 0.12, at: 0.05 }); },
        pay: function () { tone(392, 0.28, { t: 'triangle', to: 196, v: 0.32 }); coin(0.04, 988, 0.08); coin(0.12, 740, 0.08); },
        receive: function () { coin(0, 1319, 0.14); coin(0.07, 1568, 0.14); coin(0.14, 2093, 0.14); },
        build: function () { wood(0, 1.3, 0.8); wood(0.13, 1.3, 0.75); noise(0.1, { f: 2500, q: 0.8, v: 0.15, at: 0.2 }); },
        mortgage: function () { tone(110, 0.22, { t: 'triangle', to: 70, v: 0.5 }); noise(0.08, { f: 600, q: 0.8, v: 0.4 }); },
        unmortgage: function () { tone(70, 0.1, { t: 'triangle', to: 110, v: 0.35 }); coin(0.08, 1175, 0.12); },
        jail: function () { tone(150, 0.55, { t: 'square', to: 120, v: 0.1 }); bell(0, 880, 0.14); bell(0.1, 830, 0.12); noise(0.2, { f: 1200, q: 3, v: 0.25 }); },
        card: function () { noise(0.2, { f: 500, to: 4200, q: 1, v: 0.35 }); tone(880, 0.16, { v: 0.1, at: 0.16 }); },
        bid: function () { bell(0, 1318, 0.18); },
        auction: function () { bell(0, 1318, 0.2); bell(0.18, 1318, 0.2); },
        trade: function () { tone(523, 0.14, { t: 'triangle', v: 0.18 }); tone(659, 0.14, { t: 'triangle', v: 0.18, at: 0.1 }); tone(784, 0.22, { t: 'triangle', v: 0.18, at: 0.2 }); },
        turn: function () { tone(660, 0.1, { v: 0.2 }); tone(880, 0.18, { v: 0.2, at: 0.1 }); },
        bankrupt: function () { tone(330, 0.7, { t: 'sawtooth', to: 55, v: 0.18 }); noise(0.3, { f: 300, q: 0.7, v: 0.3, at: 0.1 }); }
    };

    window.SFX = {
        play: function (name, arg) {
            var fn = S[name];
            if (!fn) return;
            try { if (ac()) fn(arg); } catch (e) { /* الصوت كماليّ: لا نكسر اللعبة */ }
        },
        names: Object.keys(S)
    };
})();
