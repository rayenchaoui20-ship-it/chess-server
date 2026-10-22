/* مونوبولي: واجهة العميل. الخادم هو المرجع الوحيد لحالة اللعبة. */
(function () {
    'use strict';
    var APP = window.APP;
    if (!APP) return;
    var socket = APP.socket;
    var T = window.tr || function (s, p) { return p ? s.replace(/\{(\w+)\}/g, function (m, k) { return p[k] == null ? m : p[k]; }) : s; };
    var $ = window.jQuery;

    var BOARD = null;
    var boardBuilt = false;
    var last = null;         // آخر حالة من الخادم
    var selSq = null;
    var GCOL = { brown: '#8b5a3c', lblue: '#7dd3fc', pink: '#f472b6', orange: '#fb923c', red: '#ef4444', yellow: '#facc15', green: '#22c55e', blue: '#2563eb' };
    var TOKEN = ['🚗', '🎩', '🐕', '🚢', '👢', '🛵'];
    var ICON = { go: '➜', chest: '🎁', chance: '❓', tax: '💸', jail: '⛓', free: '🅿', gojail: '👮', rail: '🚆', util: '💡' };

    function loadBoard(cb) {
        if (BOARD) return cb();
        fetch('/monopoly-board.json').then(function (r) { return r.json(); }).then(function (b) { BOARD = b; cb(); })
            .catch(function () { err(T('تعذّر تحميل اللوحة.')); });
    }
    function err(m) { $('#mp-error').text(m || ''); }
    function view(v) {
        ['home', 'lobby', 'game'].forEach(function (x) { $('#mp-' + x).toggleClass('hidden', x !== v); });
        $('#mp-leave').text(v === 'home' ? T('رجوع') : T('غادر'));
    }
    function pos(i) {
        if (i <= 10) return [11, 11 - i];
        if (i <= 20) return [21 - i, 1];
        if (i <= 30) return [1, i - 19];
        return [i - 29, 11];
    }
    function short(n) { n = T(n); return n.length > 9 ? n.slice(0, 8) + '…' : n; }
    function money(n) { return '$' + n; }

    function buildBoard() {
        var b = $('#mp-board').empty();
        BOARD.forEach(function (s, i) {
            var p = pos(i);
            var c = $('<button type="button" class="mp-sq">').attr({ 'data-sq': i, 'aria-label': T(s.n) }).css({ gridRow: p[0], gridColumn: p[1] });
            if (i % 10 === 0) c.addClass('corner');
            var band = $('<span class="band">');
            if (s.g) band.css('background', GCOL[s.g]); else band.addClass('none');
            c.append(band);
            c.append($('<span class="nm">').text(ICON[s.t] && s.t !== 'prop' ? ICON[s.t] + ' ' + (s.t === 'rail' || s.t === 'util' ? '' : '') + short(s.n) : short(s.n)));
            if (s.p) c.append($('<span class="pr">').text(s.p));
            c.append($('<span class="tk">'));
            b.append(c);
        });
        b.append($('<div class="mp-center">').append($('<div class="mp-logo">').text(T('مونوبولي')), $('<div class="mp-dice" id="mp-dice" dir="ltr">'), $('<div class="mp-event" id="mp-event">')));
        boardBuilt = true;
    }

    function colorOf(i) { return last.players[i].color; }

    function render() {
        if (!last) return;
        if (!last.started) {
            view('lobby');
            $('#mp-roomcode').text(last.code);
            var ul = $('#mp-players').empty();
            last.players.forEach(function (p, i) {
                ul.append($('<li>').append($('<span class="dot">').css('background', p.color), $('<span>').text(p.name + (i === 0 ? ' ★' : '') + (i === last.me ? ' (' + T('أنت') + ')' : ''))));
            });
            var host = last.me === 0;
            $('#mp-start').toggleClass('hidden', !host);
            $('#mp-wait').toggleClass('hidden', host);
            return;
        }
        view('game');
        loadBoard(function () { if (!boardBuilt) buildBoard(); paint(); });
    }

    function paint() {
        var g = last.game, me = last.me;
        var cells = {};
        $('#mp-board .mp-sq').each(function () { cells[+this.dataset.sq] = $(this); });
        for (var i = 0; i < 40; i++) {
            var c = cells[i];
            if (!c) continue;
            var o = g.owner[i];
            c.css('box-shadow', o !== undefined ? 'inset 0 -4px 0 ' + last.players[o].color : 'none');
            c.toggleClass('mort', !!g.mort[i]).toggleClass('sel', selSq === i);
            var h = g.houses[i] || 0;
            c.find('.band').text(h >= 5 ? '🏨' : h > 0 ? new Array(h + 1).join('▪') : '');
            var tk = c.find('.tk').empty();
            g.players.forEach(function (p, pi) {
                if (!p.out && p.pos === i) tk.append($('<i>').text(TOKEN[pi % 6]).css('background', last.players[pi].color).toggleClass('me', pi === me).toggleClass('cur', pi === g.turn));
            });
        }
        // حالة الدور
        var cp = g.players[g.turn];
        var st;
        var actor = g.phase === 'auction' && g.auction ? g.auction.order[g.auction.i] : g.turn;
        if (g.phase === 'over') st = '🏆 ' + T('انتهت اللعبة. الفائز: {n}', { n: g.players[g.winner].name });
        else if (g.phase === 'auction') st = (actor === me ? T('دورك في المزاد') : T('دور {n} في المزاد', { n: g.players[actor].name }));
        else if (g.turn === me) st = T('دورك') + ' — ' + phaseText(g);
        else st = T('دور {n}', { n: cp.name }) + (last.players[g.turn].bot ? ' 🤖…' : '');
        if (g.mult > 1 && g.phase !== 'over') st += ' · ' + T('الإيجارات ×{m}', { m: g.mult });
        $('#mp-status').text(st).css('border-color', g.phase === 'over' ? '#e2b14b' : colorOf(g.turn));
        showDice(g);
        $('#mp-event').text(g.log.length ? T(g.log[g.log.length - 1][0], tp(g.log[g.log.length - 1][1])) : '');
        // البطاقة المسحوبة
        var cd = $('#mp-card');
        if (g.drawn) cd.removeClass('hidden').text((g.drawn.type === 'chance' ? '❓ ' : '🎁 ') + T(g.drawn.k)); else cd.addClass('hidden');
        // الأزرار
        var A = $('#mp-actions').empty();
        function btn(label, act, cls, sq) {
            A.append($('<button class="btn ' + (cls || 'secondary') + '">').text(label).attr({ 'data-mp': act }).data('sq', sq));
        }
        var mine = g.turn === me && g.phase !== 'over' && g.phase !== 'auction';
        var mp = g.players[me];
        if (g.phase === 'auction' && g.auction) {
            var au = g.auction, as = BOARD[au.sq];
            A.append($('<div class="mp-auction">').append(
                $('<b>').text(T(as.n) + ' — ' + money(as.p)),
                $('<div>').text(au.high === null ? T('لا عروض بعد') : T('أعلى عرض: {a} من {n}', { a: money(au.bid), n: g.players[au.high].name }))));
            if (actor === me) {
                [10, 50, 100].forEach(function (inc) {
                    var amt = au.bid + inc;
                    btn(T('عرض {a}', { a: money(amt) }), 'bid', 'primary');
                    $('#mp-actions button').last().data('amt', amt).prop('disabled', amt > mp.cash);
                });
                btn(T('انسحب'), 'pass', 'ghost');
            }
        } else if (g.phase === 'over') {
            btn(T('العودة إلى مونوبولي'), 'x', 'primary');
            $('#mp-actions button').last().removeAttr('data-mp').attr('data-action', 'monoLeave');
        }
        if (mine) {
            if (g.phase === 'roll') {
                if (mp.jail) {
                    btn(T('ارمِ النرد (تعادل = خروج)'), 'roll', 'primary');
                    if (mp.cash >= 50) btn(T('ادفع 50 للخروج'), 'payjail');
                    if (mp.cards > 0) btn(T('استعمل بطاقة الخروج'), 'jailcard');
                } else btn(T('ارمِ النرد'), 'roll', 'primary');
            } else if (g.phase === 'buy') {
                var s = BOARD[mp.pos];
                btn(T('اشترِ {n} بـ{p}', { n: T(s.n), p: money(s.p) }), 'buy', 'primary');
                $('#mp-actions button').last().prop('disabled', mp.cash < s.p);
                btn(T('اطرح للمزاد'), 'decline', 'ghost');
            } else if (g.phase === 'debt') {
                btn(T('ادفع الدَّين {a}', { a: money(g.pending.amount) }), 'paydebt', 'primary');
                btn(T('أعلن الإفلاس'), 'bankrupt', 'danger');
            } else if (g.phase === 'end') {
                btn(T('أنهِ الدور'), 'end', 'primary');
            }
        }
        // لاعبون
        var pl = $('#mp-plist').empty();
        g.players.forEach(function (p, pi) {
            var n = 0; for (var k in g.owner) if (g.owner[k] === pi) n++;
            var li = $('<li>').toggleClass('out', p.out).toggleClass('cur', pi === g.turn && g.phase !== 'over');
            li.append($('<span class="dot">').css('background', last.players[pi].color),
                $('<span class="nm">').text(p.name + (pi === me ? ' (' + T('أنت') + ')' : '') + (!last.players[pi].on ? ' ⚠' : '')),
                $('<span class="mc">').text((TOKEN[pi % 6]) + ' ' + (p.out ? T('مُفلس') : money(p.cash) + ' · ' + T('{n} ملكية', { n: n }) + (p.jail ? ' ⛓' : '') + (p.cards ? ' 🎟' + p.cards : ''))));
            var chips = $('<span class="chips">');
            for (var sq2 = 0; sq2 < 40; sq2++) if (g.owner[sq2] === pi) chips.append($('<i>').css('background', BOARD[sq2].g ? GCOL[BOARD[sq2].g] : '#8a94ad').toggleClass('mort', !!g.mort[sq2]).attr('data-sq', sq2));
            if (chips.children().length) li.append(chips);
            pl.append(li);
        });
        // السجل
        var lg = $('#mp-log').empty();
        g.log.slice().reverse().forEach(function (e) {
            var p = {}; for (var k in e[1]) p[k] = typeof e[1][k] === 'string' ? T(e[1][k]) : e[1][k];
            lg.append($('<li>').text(T(e[0], p)));
        });
        paintSel();
    }

    function tp(pr) { var p = {}; for (var k in (pr || {})) p[k] = typeof pr[k] === 'string' ? T(pr[k]) : pr[k]; return p; }

    // ───────── النرد والصوت ─────────
    var diceTimer = null, lastDiceKey = '';
    function showDice(g) {
        var dc = $('#mp-dice');
        if (!g.dice[0]) { dc.empty(); return; }
        var key = g.dice.join('-') + '|' + g.turn + '|' + g.log.length;
        if (key === lastDiceKey) return;
        var fresh = lastDiceKey !== '' && g.log.length && /رمى النرد/.test(g.log[g.log.length - 1][0] || '');
        lastDiceKey = key;
        function put(a, b, cls) { dc.empty().append($('<b class="die ' + (cls || '') + '">').text(a), $('<b class="die ' + (cls || '') + '">').text(b)); }
        clearInterval(diceTimer);
        if (!fresh) return put(g.dice[0], g.dice[1]);
        var n = 0;
        diceTimer = setInterval(function () {
            n++;
            if (n >= 7) { clearInterval(diceTimer); put(g.dice[0], g.dice[1], 'land'); return; }
            put(1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6), 'shake');
        }, 70);
    }
    var muted = false, actx = null;
    try { muted = localStorage.getItem('mp-mute') === '1'; } catch (e) { /* ignore */ }
    function tone(f, d, type, when, vol) {
        if (muted) return;
        try {
            actx = actx || new (window.AudioContext || window.webkitAudioContext)();
            if (actx.state === 'suspended') actx.resume();
            var o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + (when || 0);
            o.type = type || 'sine'; o.frequency.value = f;
            g.gain.setValueAtTime(vol || 0.08, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
            o.connect(g); g.connect(actx.destination); o.start(t0); o.stop(t0 + d + 0.02);
        } catch (e) { /* ignore */ }
    }
    var SND = {
        roll: function () { for (var i = 0; i < 6; i++) tone(180 + Math.random() * 120, 0.05, 'square', i * 0.07, 0.04); },
        turn: function () { tone(660, 0.12, 'sine', 0); tone(880, 0.18, 'sine', 0.12); },
        buy: function () { tone(520, 0.08, 'triangle', 0); tone(780, 0.14, 'triangle', 0.08); },
        pay: function () { tone(300, 0.12, 'sawtooth', 0, 0.05); tone(200, 0.18, 'sawtooth', 0.1, 0.05); },
        win: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.2, 'triangle', i * 0.13); }); }
    };
    function soundBtn() { $('#mp-snd').text(muted ? '🔇' : '🔊'); }
    function diffSounds(prev, next) {
        if (!next.game) return;
        var g = next.game, pg = prev && prev.game;
        if (!pg) return;
        if (g.phase === 'over' && pg.phase !== 'over') return SND.win();
        if (g.log.length && JSON.stringify(g.log[g.log.length - 1]) !== JSON.stringify(pg.log[pg.log.length - 1] || null)) {
            var k = g.log[g.log.length - 1][0] || '';
            if (/رمى النرد/.test(k)) SND.roll();
            else if (/اشترى|ربح مزاد/.test(k)) SND.buy();
            else if (/دفع|أفلس/.test(k)) SND.pay();
        }
        if (g.turn === next.me && (pg.turn !== g.turn) && g.phase !== 'over') setTimeout(SND.turn, 350);
    }

    function phaseText(g) {
        return { roll: T('ارمِ النرد'), buy: T('هل تشتري هذه الخانة؟'), debt: T('عليك دَين: بِع أو ارهن ثم ادفع'), end: T('أنهِ دورك أو أدِر ممتلكاتك') }[g.phase] || '';
    }

    function paintSel() {
        var box = $('#mp-sel');
        if (selSq === null || !last || !last.game) return box.addClass('hidden');
        var g = last.game, s = BOARD[selSq], me = last.me, o = g.owner[selSq];
        box.removeClass('hidden').empty();
        box.append($('<div class="t">').text(T(s.n)));
        var lines = [];
        if (s.p) lines.push(T('السعر: {p}', { p: money(s.p) }));
        if (s.t === 'prop') {
            lines.push(T('الإيجار: {r}', { r: s.r.slice(0, 1) + ' / ' + s.r.slice(1).join(' / ') }));
            lines.push(T('سعر البناء: {p}', { p: money(s.h) }));
        } else if (s.t === 'rail') lines.push(T('الإيجار: 25 / 50 / 100 / 200 حسب عدد المحطات'));
        else if (s.t === 'util') lines.push(T('الإيجار: 4× أو 10× النرد'));
        else if (s.t === 'tax') lines.push(T('ادفع {p}', { p: money(s.amt) }));
        if (o !== undefined) lines.push(T('المالك: {n}', { n: g.players[o].name }) + (g.mort[selSq] ? ' (' + T('مرهونة') + ')' : ''));
        else if (s.p) lines.push(T('بلا مالك'));
        lines.forEach(function (l) { box.append($('<div class="l">').text(l)); });
        if (o === me && g.turn === me && g.phase !== 'over') {
            var row = $('<div class="mp-actions">');
            var h = g.houses[selSq] || 0;
            if (s.t === 'prop' && g.phase !== 'debt') row.append($('<button class="btn secondary">').text(T('ابنِ') + ' ' + money(s.h)).attr('data-mp', 'build').data('sq', selSq));
            if (s.t === 'prop' && h > 0) row.append($('<button class="btn secondary">').text(T('بِع مبنى')).attr('data-mp', 'sell').data('sq', selSq));
            if (!g.mort[selSq] && h === 0) row.append($('<button class="btn secondary">').text(T('ارهن') + ' +' + money(s.p / 2)).attr('data-mp', 'mortgage').data('sq', selSq));
            if (g.mort[selSq]) row.append($('<button class="btn secondary">').text(T('فك الرهن') + ' ' + money(Math.ceil(s.p / 2 * 1.1))).attr('data-mp', 'unmortgage').data('sq', selSq));
            box.append(row);
        }
    }

    // ───────── الأحداث ─────────
    function translateErr(k) { return T(k); }
    socket.on('mp_update', function (d) {
        err('');
        var prevState = last;
        last = d;
        diffSounds(prevState, d);
        try { sessionStorage.setItem('mp-in', '1'); } catch (e) { /* ignore */ }
        if (!$('#mono-screen').is(':visible')) APP.show('mono-screen');
        render();
    });
    socket.on('mp_error', function (k) { err(translateErr(k)); });
    socket.on('mp_none', function () {
        last = null; selSq = null;
        try { sessionStorage.removeItem('mp-in'); } catch (e) { /* ignore */ }
        view('home');
    });
    socket.on('welcome', function () {
        var inRoom = false;
        try { inRoom = sessionStorage.getItem('mp-in') === '1'; } catch (e) { /* ignore */ }
        if (inRoom) socket.emit('mp_rejoin');
    });

    document.addEventListener('click', function (e) {
        var sq = e.target.closest && e.target.closest('.mp-sq');
        if (sq && last && last.game) { selSq = +sq.dataset.sq; paint(); return; }
        var mpb = e.target.closest && e.target.closest('[data-mp]');
        if (mpb) { socket.emit('mp_act', { a: mpb.getAttribute('data-mp'), sq: $(mpb).data('sq'), amt: $(mpb).data('amt') }); return; }
        var el = e.target.closest && e.target.closest('[data-action]');
        if (!el) return;
        var a = el.getAttribute('data-action');
        if (a === 'monoCreate') { err(''); socket.emit('mp_create'); }
        else if (a === 'monoSound') { muted = !muted; try { localStorage.setItem('mp-mute', muted ? '1' : '0'); } catch (e2) { /* ignore */ } soundBtn(); if (!muted) SND.buy(); }
        else if (a === 'monoAI') { err(''); socket.emit('mp_create_ai', { bots: +$('#mp-bots').val() || 1 }); }
        else if (a === 'monoJoin') {
            var c = String($('#mp-code').val() || '').trim().toUpperCase();
            if (c.length !== 4) return err(T('أدخل كود الغرفة المكوّن من 4 رموز.'));
            err(''); socket.emit('mp_join', { code: c });
        } else if (a === 'monoStart') socket.emit('mp_start');
        else if (a === 'monoCopy') {
            var code = last && last.code;
            if (code && navigator.clipboard) navigator.clipboard.writeText(code).then(function () { $('#mp-copy').text(T('تم النسخ')); setTimeout(function () { $('#mp-copy').text(T('انسخ الكود')); }, 1500); }).catch(function () {});
        } else if (a === 'monoLeave') {
            if (!last) return APP.toMenu();
            var started = last.started && last.game && last.game.phase !== 'over';
            if (started && !window.confirm(T('مغادرة اللعبة الجارية تعني الإفلاس. هل تريد المغادرة؟'))) return;
            socket.emit('mp_leave');
            APP.toMenu();
        }
    });

    window.Mono = {
        open: function () { err(''); soundBtn(); if (!last) view('home'); else render(); }
    };
})();
