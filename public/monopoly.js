/* ملك المدينة: واجهة العميل. الخادم هو المرجع الوحيد لحالة اللعبة. */
(function () {
    'use strict';
    var APP = window.APP;
    if (!APP) return;
    var socket = APP.socket;
    var T = window.tr || function (s, p) { return p ? s.replace(/\{(\w+)\}/g, function (m, k) { return p[k] == null ? m : p[k]; }) : s; };
    var $ = window.jQuery;

    var BOARD = null, BASE = null, MAPS = {}, curMap = null;
    var boardBuilt = false;
    var last = null;         // آخر حالة من الخادم
    var selSq = null;
    var GCOL = { brown: '#8b5a3c', lblue: '#7dd3fc', pink: '#f472b6', orange: '#fb923c', red: '#ef4444', yellow: '#facc15', green: '#22c55e', blue: '#2563eb' };
    var TOKEN = ['🚗', '🎩', '🐕', '🚢', '👢', '🛵', '🚀', '🐴'];
    var ICON = { go: '➜', chest: '🎁', chance: '❓', tax: '💸', jail: '⛓', free: '🅿', gojail: '👮', rail: '🚆', util: '💡' };

    function loadBoard(cb) {
        if (BASE) return cb();
        Promise.all([
            fetch('/monopoly-board.json').then(function (r) { return r.json(); }),
            fetch('/monopoly-maps.json').then(function (r) { return r.json(); }).catch(function () { return { coast: { title: '', art: '/monopoly-bg.webp', names: {} } }; })
        ]).then(function (r) { BASE = r[0]; MAPS = r[1]; applyMap('coast'); cb(); })
            .catch(function () { err(T('تعذّر تحميل اللوحة.')); });
    }
    function applyMap(id) {
        if (!MAPS[id]) id = 'coast';
        var names = (MAPS[id] && MAPS[id].names) || {};
        BOARD = BASE.map(function (s, i) { return Object.assign({}, s, { n: names[i] || s.n }); });
        curMap = id; boardBuilt = false;
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
        var mp = MAPS[curMap] || {};
        b.attr('data-map', curMap);
        b.append($('<div class="mp-center">').attr('data-title', curMap === 'coast' ? '' : (mp.title || '')).css('background-image', mp.art ? 'url(' + mp.art + ')' : '').append($('<div class="mp-logo">').text(T('ملك المدينة')), $('<div class="mp-dice" id="mp-dice" dir="ltr">'), $('<div class="mp-event" id="mp-event">')));
        boardBuilt = true;
    }

    var cdAt = null, cdTimer = null;
    function tickCd() {
        clearTimeout(cdTimer);
        if (!last || last.started || !last.pub) return;
        var el = $('#mp-cd');
        if (!cdAt) { el.text(T('بانتظار لاعبين...')); return; }
        var s = Math.max(0, Math.ceil((cdAt.end - Date.now()) / 1000));
        el.text(cdAt.kind === 'start' ? T('تبدأ اللعبة خلال {s} ث', { s: s }) : T('نبحث عن لاعبين... إن لم نجد أحدًا نكمل بالحاسوب بعد {s} ث', { s: s }));
        cdTimer = setTimeout(tickCd, 500);
    }
    function mapTitle(id) { var m = MAPS[id]; return m && m.title ? T('اللوحة: {t}', { t: m.title }) : ''; }
    function colorOf(i) { return last.players[i].color; }

    function render() {
        if (!last) return;
        if (!last.started) {
            view('lobby');
            $('#mp-roomcode').text(last.code);
            $('#mp-mapname').text(mapTitle(last.map));
            var ul = $('#mp-players').empty();
            last.players.forEach(function (p, i) {
                ul.append($('<li>').append($('<span class="dot">').css('background', p.color), $('<span>').text(p.name + (i === 0 ? ' ★' : '') + (i === last.me ? ' (' + T('أنت') + ')' : ''))));
            });
            var pub = !!last.pub;
            var host = last.me === 0 && !pub;
            $('#mp-start').toggleClass('hidden', !host);
            $('#mp-wait').toggleClass('hidden', host || pub);
            $('.mp-codebox').toggleClass('hidden', pub);
            $('#mp-lead').text(pub ? T('غرفة عامة: لاعبون عشوائيون') : T('أرسل هذا الكود لأصدقائك'));
            cdAt = last.cd ? { kind: last.cd.kind, end: Date.now() + last.cd.ms } : null;
            $('#mp-cd').toggleClass('hidden', !pub);
            tickCd();
            return;
        }
        view('game');
        loadBoard(function () { var id = (last.game && last.game.map) || last.map || 'coast'; if (id !== curMap) applyMap(id); if (!boardBuilt) buildBoard(); paint(); });
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
        }
        // حالة الدور
        var cp = g.players[g.turn];
        var st;
        var actor = g.phase === 'auction' && g.auction ? g.auction.order[g.auction.i] : g.turn;
        if (g.phase === 'over') st = '🏆 ' + T('انتهت اللعبة. الفائز: {n}', { n: g.players[g.winner].name });
        else if (g.phase === 'trade' && g.trade) st = g.trade.to === me ? T('وصلك عرض تبادل من {n}', { n: g.players[g.trade.from].name }) : T('عرض تبادل بين {a} و{b}', { a: g.players[g.trade.from].name, b: g.players[g.trade.to].name });
        else if (g.phase === 'auction') st = (actor === me ? T('دورك في المزاد') : T('دور {n} في المزاد', { n: g.players[actor].name }));
        else if (g.turn === me) st = T('دورك') + ' — ' + phaseText(g);
        else st = T('دور {n}', { n: cp.name }) + (last.players[g.turn].bot ? ' 🤖…' : '');
        if (g.mult > 1 && g.phase !== 'over') st += ' · ' + T('الإيجارات ×{m}', { m: g.mult });
        $('#mp-status').text(st);
        $('#mp-status')[0].style.setProperty('border-inline-start-color', g.phase === 'over' ? '#e2b14b' : colorOf(g.turn));
        showDice(g);
        syncShown(g);
        paintTokens();
        if (needsWalk(g)) startWalk(diceFresh ? DICE_MS : 0);
        diceFresh = false;
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
            btn(T('العودة إلى ملك المدينة'), 'x', 'primary');
            $('#mp-actions button').last().removeAttr('data-mp').attr('data-action', 'monoLeave');
        }
        if (mine && (g.phase === 'roll' || g.phase === 'end') && g.players.filter(function (q, qi) { return !q.out && qi !== me; }).length) {
            btn('🤝 ' + T('تبادل'), 'x', 'secondary');
            $('#mp-actions button').last().removeAttr('data-mp').attr('data-action', 'trOpen');
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
            var li = $('<li>').attr('data-pi', pi).toggleClass('out', p.out).toggleClass('cur', pi === g.turn && g.phase !== 'over');
            li.append($('<span class="dot">').css('background', last.players[pi].color),
                $('<span class="nm">').text(p.name + (pi === me ? ' (' + T('أنت') + ')' : '') + (!last.players[pi].on ? ' ⚠' : '')),
                $('<span class="mc">').text((TOKEN[pi % 8]) + ' ' + (p.out ? T('مُفلس') : money(p.cash) + ' · ' + T('{n} ملكية', { n: n }) + (p.jail ? ' ⛓' : '') + (p.cards ? ' 🎟' + p.cards : ''))));
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
        paintTrade(g, me);
        applyFloats();
        if (window.Voice) window.Voice.decorate();
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
        diceFresh = fresh;
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
    var muted = false;
    try { muted = localStorage.getItem('mp-mute') === '1'; } catch (e) { /* ignore */ }
    function sfx(name, arg) { if (!muted && window.SFX) window.SFX.play(name, arg); }
    function soundBtn() { $('#mp-snd').text(muted ? '🔇' : '🔊').attr('aria-pressed', String(!muted)); }

    // أرقام المال الطافية فوق صف اللاعب بعد كل تغيّر في الرصيد
    var pendingFloats = [];
    function applyFloats() {
        var rows = $('#mp-plist li');
        pendingFloats.forEach(function (f) {
            var li = rows.eq(f.pi);
            if (!li.length) return;
            var el = $('<span class="mp-float">').addClass(f.d > 0 ? 'pos' : 'neg').text((f.d > 0 ? '+' : '−') + '$' + Math.abs(f.d));
            li.append(el);
            setTimeout(function () { el.remove(); }, 1600);
        });
        pendingFloats = [];
    }

    // مدة مشي الرموز بعد هذا التحديث (لنؤخر أصوات النتيجة حتى يصل الرمز)
    function walkMs(pg, g, fresh) {
        var ms = 0;
        g.players.forEach(function (p, pi) {
            var q = pg.players[pi];
            if (!q || p.out || q.pos === p.pos) return;
            var d = (p.pos - q.pos + 40) % 40;
            ms = Math.max(ms, d > WALK_MAX ? 450 : d * STEP_MS);
        });
        return ms + (fresh ? DICE_MS : 0);
    }

    function diffSounds(prev, next) {
        pendingFloats = [];
        if (!next.game) return;
        var g = next.game, pg = prev && prev.game;
        if (!pg) return;
        var me = next.me, k, i;
        if (g.phase === 'over' && pg.phase !== 'over') { setTimeout(function () { sfx(g.winner === me ? 'win' : 'lose'); }, 300); return; }

        var lastNew = g.log.length ? g.log[g.log.length - 1] : null;
        var lastOld = pg.log.length ? pg.log[pg.log.length - 1] : null;
        var fresh = !!lastNew && JSON.stringify(lastNew) !== JSON.stringify(lastOld) && /رمى النرد/.test(lastNew[0] || '');
        if (fresh) sfx('dice');

        var bought = false, tradeDone = pg.phase === 'trade' && g.phase !== 'trade', built = 0, mort = 0, jailed = false, broke = false, auctionStart = false, bid = false, card = false;
        for (k in g.owner) if (pg.owner[k] !== g.owner[k]) bought = true;
        for (i = 0; i < 40; i++) {
            var h1 = g.houses[i] || 0, h0 = pg.houses[i] || 0;
            if (h1 > h0) built = 1; else if (h1 < h0 && !built) built = -1;
            var m1 = !!g.mort[i], m0 = !!pg.mort[i];
            if (m1 && !m0) mort = 1; else if (!m1 && m0) mort = -1;
        }
        g.players.forEach(function (p, pi) {
            var q = pg.players[pi];
            if (!q) return;
            if (p.jail && !q.jail) jailed = true;
            if (p.out && !q.out) broke = true;
            var d = p.cash - q.cash;
            if (d !== 0) pendingFloats.push({ pi: pi, d: d });
        });
        if (g.phase === 'auction' && pg.phase !== 'auction') auctionStart = true;
        if (g.phase === 'auction' && g.auction && pg.auction && g.auction.bid > pg.auction.bid) bid = true;
        if (g.drawn && (!pg.drawn || g.drawn.k !== pg.drawn.k)) card = true;
        var myDelta = 0;
        pendingFloats.forEach(function (f) { if (f.pi === me) myDelta = f.d; });

        var name = null;
        if (broke) name = 'bankrupt';
        else if (jailed) name = 'jail';
        else if (tradeDone && bought) name = 'trade';
        else if (bought) name = 'buy';
        else if (built) name = 'build';
        else if (mort) name = mort > 0 ? 'mortgage' : 'unmortgage';
        else if (card) name = 'card';
        else if (auctionStart) name = 'auction';
        else if (bid) name = 'bid';
        else if (g.phase === 'trade' && pg.phase !== 'trade' && g.trade && g.trade.to === me) name = 'notify';
        else if (myDelta > 0) name = 'receive';
        else if (myDelta < 0) name = 'pay';

        var delay = walkMs(pg, g, fresh);
        if (name) setTimeout(function () { sfx(name); }, name === 'bid' || name === 'auction' || name === 'notify' ? 0 : delay);
        if (g.turn === me && pg.turn !== g.turn && g.phase !== 'over') setTimeout(function () { sfx('turn'); }, Math.max(delay, 0) + 450);
    }

    // ───────── مشي الرموز خانة خانة ─────────
    var shown = {}, shownKey = '', walking = false, diceFresh = false;
    var STEP_MS = 115, DICE_MS = 560, WALK_MAX = 14;
    function syncShown(g) {
        var key = last.code + '|' + (g.map || '');
        if (key !== shownKey) { shownKey = key; shown = {}; }
        g.players.forEach(function (p, pi) { if (shown[pi] === undefined) shown[pi] = p.pos; });
    }
    function paintTokens() {
        if (!last || !last.game) return;
        var g = last.game, me = last.me;
        $('#mp-board .mp-sq .tk').empty();
        g.players.forEach(function (p, pi) {
            if (p.out) return;
            var sq = shown[pi] === undefined ? p.pos : shown[pi];
            $('#mp-board .mp-sq[data-sq="' + sq + '"] .tk').append(
                $('<i>').text(TOKEN[pi % 8]).css('background', last.players[pi].color)
                    .toggleClass('me', pi === me).toggleClass('cur', pi === g.turn).toggleClass('hop', sq !== p.pos));
        });
    }
    function needsWalk(g) { return g.players.some(function (p, pi) { return !p.out && shown[pi] !== undefined && shown[pi] !== p.pos; }); }
    function stepWalk() {
        walking = false;
        if (!last || !last.game) return;
        var moving = false;
        last.game.players.forEach(function (p, pi) {
            var cur = shown[pi];
            if (p.out || cur === undefined || cur === p.pos) { shown[pi] = p.pos; return; }
            var d = (p.pos - cur + 40) % 40;
            if (d > WALK_MAX) { shown[pi] = p.pos; sfx('jump'); return; }
            shown[pi] = (cur + 1) % 40;
            moving = true;
            sfx('step', d);
        });
        paintTokens();
        if (moving) { walking = true; setTimeout(stepWalk, STEP_MS); }
    }
    function startWalk(delay) {
        if (walking) return;
        walking = true;
        setTimeout(stepWalk, delay || 0);
    }

    // ───────── التبادل ─────────
    var draft = { open: false, to: null, gp: {}, tp: {}, gc: 0, tc: 0, gk: 0, tk: 0 };
    function canTrade(g, pi, sq) {
        var s = BOARD[sq];
        if (!s || !s.p || g.owner[sq] !== pi) return false;
        if (s.g) for (var q = 0; q < 40; q++) if (BOARD[q].g === s.g && (g.houses[q] || 0) > 0) return false;
        return true;
    }
    function propChip(sq, g, on, sel) {
        var s = BOARD[sq];
        var c = $('<button type="button" class="tr-chip">').attr('data-trsq', sq).toggleClass('on', !!on);
        c.append($('<i>').css('background', s.g ? GCOL[s.g] : '#8a94ad'), $('<span>').text(s.n + (g.mort[sq] ? ' ⛔' : '')));
        return c;
    }
    function describe(side, g) {
        var parts = [];
        side.props.forEach(function (sq) { parts.push(BOARD[sq].n); });
        if (side.cash) parts.push(money(side.cash));
        if (side.cards) parts.push('🎟×' + side.cards);
        return parts.length ? parts.join('، ') : T('لا شيء');
    }
    function paintTrade(g, me) {
        var box = $('#mp-trade');
        if (g.phase === 'trade' && g.trade) {
            var t = g.trade;
            box.removeClass('hidden').empty().append(
                $('<div class="t">').text('🤝 ' + T('عرض تبادل')),
                $('<div class="l">').text(T('{n} يعطي: {x}', { n: g.players[t.from].name, x: describe(t.give, g) })),
                $('<div class="l">').text(T('{n} يعطي: {x}', { n: g.players[t.to].name, x: describe(t.take, g) })));
            var row = $('<div class="mp-actions">');
            if (t.to === me) {
                row.append($('<button class="btn primary">').text(T('اقبل العرض')).attr('data-mp', 'taccept'), $('<button class="btn ghost">').text(T('ارفض')).attr('data-mp', 'tdecline'));
            } else if (t.from === me) {
                row.append($('<div class="muted small">').text(T('بانتظار رد {n}...', { n: g.players[t.to].name })), $('<button class="btn ghost">').text(T('ألغِ العرض')).attr('data-mp', 'tcancel'));
            }
            box.append(row);
            draft.open = false;
            return;
        }
        var mineTurn = g.turn === me && (g.phase === 'roll' || g.phase === 'end');
        if (!draft.open || !mineTurn) { draft.open = false; box.addClass('hidden').empty(); return; }
        var others = [];
        g.players.forEach(function (p, i) { if (!p.out && i !== me) others.push(i); });
        if (draft.to === null || others.indexOf(draft.to) < 0) { draft.to = others[0]; draft.tp = {}; }
        box.removeClass('hidden').empty().append($('<div class="t">').text('🤝 ' + T('اقترح تبادلًا')));
        var sel = $('<select id="tr-to" class="field">');
        others.forEach(function (i) { sel.append($('<option>').val(i).text(g.players[i].name).prop('selected', i === draft.to)); });
        box.append($('<label class="small muted">').text(T('مع')), sel);
        function side(title, pi, props, cashKey, cardKey, owner) {
            var col = $('<div class="tr-col">').append($('<b>').text(title));
            var list = $('<div class="tr-list">');
            var any = false;
            for (var sq = 0; sq < 40; sq++) if (canTrade(g, pi, sq)) { any = true; list.append(propChip(sq, g, props[sq]).attr('data-side', owner)); }
            if (!any) list.append($('<span class="muted small">').text(T('لا عقارات قابلة للتبادل')));
            col.append(list);
            col.append($('<label class="small muted">').text(T('مال')), $('<input type="number" min="0" step="10" class="field tr-cash">').attr('data-side', owner).val(draft[cashKey] || ''));
            if (g.players[pi].cards > 0) col.append($('<label class="small muted">').text(T('بطاقات الخروج')), $('<input type="number" min="0" class="field tr-cards">').attr({ 'data-side': owner, max: g.players[pi].cards }).val(draft[cardKey] || ''));
            return col;
        }
        box.append($('<div class="tr-grid">').append(side(T('أنت تعطي'), me, draft.gp, 'gc', 'gk', 'g'), side(T('أنت تأخذ'), draft.to, draft.tp, 'tc', 'tk', 't')));
        box.append($('<div class="mp-actions">').append($('<button class="btn primary">').text(T('أرسل العرض')).attr('data-action', 'trSend'), $('<button class="btn ghost">').text(T('إغلاق')).attr('data-action', 'trClose')));
    }
    function sideData(props, cash, cards) {
        var arr = []; for (var k in props) if (props[k]) arr.push(+k);
        return { props: arr, cash: Math.max(0, parseInt(cash, 10) || 0), cards: Math.max(0, parseInt(cards, 10) || 0) };
    }

    function phaseText(g) {
        return { roll: T('ارمِ النرد'), buy: T('هل تشتري هذه الخانة؟'), debt: T('عليك دَين: بِع أو ارهن ثم ادفع'), end: T('أنهِ دورك أو أدِر ممتلكاتك'), trade: T('عرض تبادل معلّق') }[g.phase] || '';
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
        last = null; selSq = null; shown = {}; shownKey = '';
        try { sessionStorage.removeItem('mp-in'); } catch (e) { /* ignore */ }
        view('home');
    });
    socket.on('welcome', function () {
        var inRoom = false;
        try { inRoom = sessionStorage.getItem('mp-in') === '1'; } catch (e) { /* ignore */ }
        if (inRoom) socket.emit('mp_rejoin');
    });

    document.addEventListener('change', function (e) {
        var t = e.target;
        if (!draft.open || !t) return;
        if (t.id === 'tr-to') { draft.to = +t.value; draft.tp = {}; draft.tc = 0; draft.tk = 0; paintTrade(last.game, last.me); }
        else if (t.classList.contains('tr-cash')) draft[t.dataset.side === 'g' ? 'gc' : 'tc'] = parseInt(t.value, 10) || 0;
        else if (t.classList.contains('tr-cards')) draft[t.dataset.side === 'g' ? 'gk' : 'tk'] = parseInt(t.value, 10) || 0;
    });
    document.addEventListener('input', function (e) {
        var t = e.target;
        if (!draft.open || !t) return;
        if (t.classList.contains('tr-cash')) draft[t.dataset.side === 'g' ? 'gc' : 'tc'] = parseInt(t.value, 10) || 0;
        else if (t.classList.contains('tr-cards')) draft[t.dataset.side === 'g' ? 'gk' : 'tk'] = parseInt(t.value, 10) || 0;
    });
    document.addEventListener('click', function (e) {
        var sq = e.target.closest && e.target.closest('.mp-sq');
        if (sq && last && last.game) { selSq = +sq.dataset.sq; paint(); return; }
        var chip = e.target.closest && e.target.closest('.tr-chip');
        if (chip) { var sq0 = +chip.dataset.trsq, d0 = chip.dataset.side === 'g' ? draft.gp : draft.tp; d0[sq0] = !d0[sq0]; chip.classList.toggle('on', !!d0[sq0]); return; }
        var mpb = e.target.closest && e.target.closest('[data-mp]');
        if (mpb) { socket.emit('mp_act', { a: mpb.getAttribute('data-mp'), sq: $(mpb).data('sq'), amt: $(mpb).data('amt') }); return; }
        var el = e.target.closest && e.target.closest('[data-action]');
        if (!el) return;
        var a = el.getAttribute('data-action');
        if (a === 'trOpen') { draft = { open: true, to: null, gp: {}, tp: {}, gc: 0, tc: 0, gk: 0, tk: 0 }; paintTrade(last.game, last.me); return; }
        if (a === 'trClose') { draft.open = false; paintTrade(last.game, last.me); return; }
        if (a === 'trSend') {
            var gv = sideData(draft.gp, draft.gc, draft.gk), tv = sideData(draft.tp, draft.tc, draft.tk);
            socket.emit('mp_act', { a: 'tpropose', to: draft.to, give: gv, take: tv });
            return;
        }
        if (a === 'monoQuick') { err(''); socket.emit('mp_quick'); return; }
        if (a === 'monoCreate') { err(''); socket.emit('mp_create', { map: $('#mp-map').val() }); }
        else if (a === 'monoSound') { muted = !muted; try { localStorage.setItem('mp-mute', muted ? '1' : '0'); } catch (e2) { /* ignore */ } soundBtn(); if (!muted) sfx('buy'); }
        else if (a === 'monoAI') { err(''); socket.emit('mp_create_ai', { bots: +$('#mp-bots').val() || 1, map: $('#mp-map').val() }); }
        else if (a === 'monoJoin') {
            var c = String($('#mp-code').val() || '').trim().toUpperCase();
            if (c.length !== 4) return err(T('أدخل كود الغرفة المكوّن من 4 رموز.'));
            err(''); socket.emit('mp_join', { code: c });
        } else if (a === 'monoStart') socket.emit('mp_start');
        else if (a === 'monoCopy') {
            var code = last && last.code;
            if (code && navigator.clipboard) navigator.clipboard.writeText(code).then(function () { $('#mp-copy').text(T('تم النسخ')); setTimeout(function () { $('#mp-copy').text(T('انسخ الكود')); }, 1500); }).catch(function () {});
        } else if (a === 'monoLeave') {
            if (!last) return APP.show('world-screen');
            var started = last.started && last.game && last.game.phase !== 'over';
            if (started && !window.confirm(T('مغادرة اللعبة الجارية تعني الإفلاس. هل تريد المغادرة؟'))) return;
            socket.emit('mp_leave');
        }
    });

    fetch('/monopoly-maps.json').then(function (r) { return r.json(); }).then(function (m) { MAPS = m; }).catch(function () {});

    window.Mono = {
        state: function () { return last; },
        busy: function () { return !!(last && last.started && last.game && last.game.phase !== 'over'); },
        leave: function () { if (last) socket.emit('mp_leave'); },
        open: function () { err(''); soundBtn(); if (window.Voice) window.Voice.decorate(); if (!last) view('home'); else render(); }
    };
})();
