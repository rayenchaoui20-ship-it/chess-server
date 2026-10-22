'use strict';
// مونوبولي: محرك اللعبة (دوال نقية بلا اعتماديات) + ربط Socket.IO.
// القواعد المبسّطة: بدون مزادات وبدون تبادل بين اللاعبين.

const crypto = require('crypto');

const P = (n, g, p, h, r) => ({ t: 'prop', n, g, p, h, r });
const RAIL = (n) => ({ t: 'rail', n, p: 200 });
const UTIL = (n) => ({ t: 'util', n, p: 150 });
const BOARD = [
    { t: 'go', n: 'انطلاق' },
    P('مراكش', 'brown', 60, 50, [2, 10, 30, 90, 160, 250]),
    { t: 'chest', n: 'صندوق الحظ' },
    P('فاس', 'brown', 60, 50, [4, 20, 60, 180, 320, 450]),
    { t: 'tax', n: 'ضريبة الدخل', amt: 200 },
    RAIL('محطة الشمال'),
    P('طنجة', 'lblue', 100, 50, [6, 30, 90, 270, 400, 550]),
    { t: 'chance', n: 'فرصة' },
    P('أكادير', 'lblue', 100, 50, [6, 30, 90, 270, 400, 550]),
    P('تطوان', 'lblue', 120, 50, [8, 40, 100, 300, 450, 600]),
    { t: 'jail', n: 'السجن / زيارة' },
    P('الرباط', 'pink', 140, 100, [10, 50, 150, 450, 625, 750]),
    UTIL('شركة الكهرباء'),
    P('سلا', 'pink', 140, 100, [10, 50, 150, 450, 625, 750]),
    P('القنيطرة', 'pink', 160, 100, [12, 60, 180, 500, 700, 900]),
    RAIL('محطة الشرق'),
    P('بيروت', 'orange', 180, 100, [14, 70, 200, 550, 750, 950]),
    { t: 'chest', n: 'صندوق الحظ' },
    P('دمشق', 'orange', 180, 100, [14, 70, 200, 550, 750, 950]),
    P('عمّان', 'orange', 200, 100, [16, 80, 220, 600, 800, 1000]),
    { t: 'free', n: 'موقف مجاني' },
    P('القاهرة', 'red', 220, 150, [18, 90, 250, 700, 875, 1050]),
    { t: 'chance', n: 'فرصة' },
    P('الإسكندرية', 'red', 220, 150, [18, 90, 250, 700, 875, 1050]),
    P('الجيزة', 'red', 240, 150, [20, 100, 300, 750, 925, 1100]),
    RAIL('محطة الجنوب'),
    P('الدوحة', 'yellow', 260, 150, [22, 110, 330, 800, 975, 1150]),
    P('أبوظبي', 'yellow', 260, 150, [22, 110, 330, 800, 975, 1150]),
    UTIL('شركة المياه'),
    P('المنامة', 'yellow', 280, 150, [24, 120, 360, 850, 1025, 1200]),
    { t: 'gojail', n: 'اذهب إلى السجن' },
    P('الرياض', 'green', 300, 200, [26, 130, 390, 900, 1100, 1275]),
    P('جدة', 'green', 300, 200, [26, 130, 390, 900, 1100, 1275]),
    { t: 'chest', n: 'صندوق الحظ' },
    P('الكويت', 'green', 320, 200, [28, 150, 450, 1000, 1200, 1400]),
    RAIL('محطة الغرب'),
    { t: 'chance', n: 'فرصة' },
    P('تونس', 'blue', 350, 200, [35, 175, 500, 1100, 1300, 1500]),
    { t: 'tax', n: 'ضريبة الرفاهية', amt: 100 },
    P('الجزائر', 'blue', 400, 200, [50, 200, 600, 1400, 1700, 2000])
];
const GROUPS = {};
BOARD.forEach((s, i) => { if (s.g) (GROUPS[s.g] = GROUPS[s.g] || []).push(i); });
const RAILS = BOARD.map((s, i) => (s.t === 'rail' ? i : -1)).filter((i) => i >= 0);
const UTILS = BOARD.map((s, i) => (s.t === 'util' ? i : -1)).filter((i) => i >= 0);

const START_CASH = 1500, GO_PAY = 200, JAIL_FEE = 50, JAIL_POS = 10;
// البطاقات: كل بطاقة {k: نص, ...الأثر}
const CHANCE = [
    { k: 'تقدّم إلى «انطلاق» واستلم 200', go: 0 },
    { k: 'اذهب إلى السجن مباشرة', jail: true },
    { k: 'البنك يدفع لك 50', cash: 50 },
    { k: 'ادفع غرامة سرعة 15', cash: -15 },
    { k: 'ارجع 3 خانات', back: 3 },
    { k: 'تقدّم إلى «الجيزة»', go: 24 },
    { k: 'تقدّم إلى «تونس»', go: 37 },
    { k: 'بطاقة الخروج من السجن مجانًا', card: true }
];
const CHEST = [
    { k: 'خطأ مصرفي لصالحك: استلم 200', cash: 200 },
    { k: 'أتعاب الطبيب: ادفع 50', cash: -50 },
    { k: 'بعت أسهمًا واستلمت 45', cash: 45 },
    { k: 'ورثت مبلغ 100', cash: 100 },
    { k: 'ادفع رسوم المدرسة 50', cash: -50 },
    { k: 'عيد ميلادك: كل لاعب يعطيك 10', birthday: 10 },
    { k: 'اذهب إلى السجن مباشرة', jail: true },
    { k: 'بطاقة الخروج من السجن مجانًا', card: true }
];

function rnd(n) { return crypto.randomInt(n); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function createGame(names) {
    return {
        players: names.map((name) => ({ name, cash: START_CASH, pos: 0, jail: false, jt: 0, cards: 0, out: false })),
        owner: {}, houses: {}, mort: {},
        turn: 0, phase: 'roll', dice: [0, 0], dbl: 0, again: false,
        pending: null, drawn: null, winner: null, log: [],
        deckC: shuffle(CHANCE.map((_, i) => i)), deckH: shuffle(CHEST.map((_, i) => i))
    };
}

function log(g, k, p) { g.log.push([k, p || {}]); if (g.log.length > 40) g.log.shift(); }
const cur = (g) => g.players[g.turn];
const ownsAll = (g, pi, grp) => GROUPS[grp].every((s) => g.owner[s] === pi);
const countOwned = (g, pi, list) => list.filter((s) => g.owner[s] === pi).length;
const groupHouses = (g, grp) => GROUPS[grp].map((s) => g.houses[s] || 0);

function netWorthCash(g, pi) { return g.players[pi].cash; }

function rentMult(g) { const r = g.round || 0; return r < 60 ? 1 : Math.pow(2, Math.min(4, 1 + Math.floor((r - 60) / 20))); }
function rentOf(g, sq, diceSum) { return rentBase(g, sq, diceSum) * rentMult(g); }
function rentBase(g, sq, diceSum) {
    const s = BOARD[sq], o = g.owner[sq];
    if (o === undefined || g.mort[sq]) return 0;
    if (s.t === 'prop') {
        const h = g.houses[sq] || 0;
        if (h > 0) return s.r[h];
        return ownsAll(g, o, s.g) ? s.r[0] * 2 : s.r[0];
    }
    if (s.t === 'rail') return 25 * Math.pow(2, countOwned(g, o, RAILS) - 1);
    if (s.t === 'util') return diceSum * (countOwned(g, o, UTILS) === 2 ? 10 : 4);
    return 0;
}

function nextPhase(g) {
    g.pending = null;
    g.phase = g.again && !cur(g).jail ? 'roll' : 'end';
}

// تحصيل مبلغ من لاعب؛ إن لم يكفِ رصيده تُفتح مرحلة «دَين»
function charge(g, pi, amount, to) {
    if (amount <= 0) return true;
    const p = g.players[pi];
    if (p.cash >= amount) {
        p.cash -= amount;
        if (to !== null && to !== undefined) g.players[to].cash += amount;
        return true;
    }
    g.pending = { amount, to: to === undefined ? null : to, pi };
    g.phase = 'debt';
    return false;
}

function sendToJail(g, pi) {
    const p = g.players[pi];
    p.pos = JAIL_POS; p.jail = true; p.jt = 0;
    g.again = false; g.dbl = 0;
    log(g, '{n} ذهب إلى السجن', { n: p.name });
}

function moveBy(g, pi, steps) {
    const p = g.players[pi];
    const np = (p.pos + steps + 40) % 40;
    if (steps > 0 && np < p.pos) { p.cash += GO_PAY; log(g, '{n} مرّ بـ«انطلاق» واستلم {a}', { n: p.name, a: GO_PAY }); }
    p.pos = np;
}
function moveTo(g, pi, sq) {
    const p = g.players[pi];
    if (sq < p.pos) { p.cash += GO_PAY; log(g, '{n} مرّ بـ«انطلاق» واستلم {a}', { n: p.name, a: GO_PAY }); }
    p.pos = sq;
}

function land(g, pi, diceSum) {
    const p = g.players[pi], s = BOARD[p.pos];
    g.drawn = null;
    switch (s.t) {
        case 'gojail': sendToJail(g, pi); return nextPhase(g);
        case 'tax':
            log(g, '{n} دفع {s} {a}', { n: p.name, s: s.n, a: s.amt });
            if (!charge(g, pi, s.amt, null)) return;
            return nextPhase(g);
        case 'chance': case 'chest': {
            const deck = s.t === 'chance' ? g.deckC : g.deckH;
            const cards = s.t === 'chance' ? CHANCE : CHEST;
            const idx = deck.shift(); deck.push(idx);
            const c = cards[idx];
            g.drawn = { type: s.t, k: c.k };
            log(g, '{n} سحب بطاقة: {c}', { n: p.name, c: c.k });
            if (c.jail) { sendToJail(g, pi); return nextPhase(g); }
            if (c.card) { p.cards++; return nextPhase(g); }
            if (c.birthday) {
                g.players.forEach((o, i) => { if (i !== pi && !o.out) { const a = Math.min(c.birthday, o.cash); o.cash -= a; p.cash += a; } });
                return nextPhase(g);
            }
            if (c.cash) {
                if (c.cash > 0) { p.cash += c.cash; return nextPhase(g); }
                if (!charge(g, pi, -c.cash, null)) return;
                return nextPhase(g);
            }
            if (c.go !== undefined) { moveTo(g, pi, c.go); return land(g, pi, diceSum); }
            if (c.back) { moveBy(g, pi, -c.back); return land(g, pi, diceSum); }
            return nextPhase(g);
        }
        case 'prop': case 'rail': case 'util': {
            const o = g.owner[p.pos];
            if (o === undefined) { g.phase = 'buy'; g.pending = null; return; }
            if (o === pi || g.mort[p.pos]) return nextPhase(g);
            const rent = rentOf(g, p.pos, diceSum);
            log(g, '{n} دفع إيجار {a} لـ{o}', { n: p.name, a: rent, o: g.players[o].name });
            if (!charge(g, pi, rent, o)) return;
            return nextPhase(g);
        }
        default: return nextPhase(g);
    }
}


// ───────── المزاد ─────────
const actorOf = (g) => (g.phase === 'auction' && g.auction ? g.auction.order[g.auction.i] : g.turn);

function startAuction(g) {
    const sq = cur(g).pos;
    const order = [];
    for (let k = 0; k < g.players.length; k++) { const j = (g.turn + k) % g.players.length; if (!g.players[j].out) order.push(j); }
    g.auction = { sq, bid: 0, high: null, order, i: 0, passed: [] };
    g.phase = 'auction'; g.pending = null;
    log(g, 'بدأ مزاد على {s}', { s: BOARD[sq].n });
}

function finishAuction(g) {
    const au = g.auction;
    if (au.high !== null) {
        g.players[au.high].cash -= au.bid; g.owner[au.sq] = au.high;
        log(g, '{n} ربح مزاد {s} بـ{a}', { n: g.players[au.high].name, s: BOARD[au.sq].n, a: au.bid });
    } else log(g, 'انتهى المزاد دون مشترٍ');
    g.auction = null;
    nextPhase(g);
}

function auctionNext(g) {
    const au = g.auction;
    const active = au.order.filter((j) => !au.passed.includes(j));
    if (active.length === 0 || (active.length === 1 && au.high === active[0])) return finishAuction(g);
    let i = au.i;
    do { i = (i + 1) % au.order.length; } while (au.passed.includes(au.order[i]));
    au.i = i;
}

function auctionDrop(g, pi) {
    const au = g.auction;
    if (!au || au.passed.includes(pi) || !au.order.includes(pi)) return;
    const wasCur = au.order[au.i] === pi;
    au.passed.push(pi);
    if (au.high === pi) { au.high = null; au.bid = 0; }
    if (wasCur) auctionNext(g);
    else if (au.order.filter((j) => !au.passed.includes(j)).length === 0) finishAuction(g);
}

function auctionAct(g, pi, a) {
    const au = g.auction;
    if (!au) return 'لا يوجد مزاد.';
    if (au.order[au.i] !== pi) return 'ليس دورك في المزاد.';
    if (a.a === 'pass') { au.passed.push(pi); return auctionNext(g) || null; }
    const amt = Number.isInteger(a.amt) ? a.amt : -1;
    if (amt <= au.bid) return 'يجب أن يكون العرض أعلى من العرض الحالي.';
    if (amt > g.players[pi].cash) return 'رصيدك لا يكفي.';
    au.bid = amt; au.high = pi;
    log(g, '{n} عرض {a}', { n: g.players[pi].name, a: amt });
    auctionNext(g); return null;
}

function advanceTurn(g) {
    const alive = g.players.filter((p) => !p.out).length;
    if (alive <= 1) { g.winner = g.players.findIndex((p) => !p.out); g.phase = 'over'; return; }
    const prev = g.turn;
    do { g.turn = (g.turn + 1) % g.players.length; } while (g.players[g.turn].out);
    if (g.turn <= prev) {
        const m0 = rentMult(g);
        g.round = (g.round || 0) + 1;
        if (rentMult(g) !== m0) log(g, 'ارتفعت الإيجارات إلى ×{m} لإنهاء اللعبة', { m: rentMult(g) });
    }
    g.phase = 'roll'; g.dbl = 0; g.again = false; g.pending = null; g.drawn = null; g.auction = null; delete g.afterJailMove;
}

function bankrupt(g, pi, creditor) {
    const p = g.players[pi];
    log(g, '{n} أفلس!', { n: p.name });
    for (let sq = 0; sq < 40; sq++) {
        if (g.owner[sq] !== pi) continue;
        delete g.houses[sq];
        if (creditor !== null && creditor !== undefined) g.owner[sq] = creditor;
        else { delete g.owner[sq]; delete g.mort[sq]; }
    }
    if (creditor !== null && creditor !== undefined) { g.players[creditor].cash += Math.max(0, p.cash); g.players[creditor].cards += p.cards; }
    p.cash = 0; p.cards = 0; p.out = true;
    auctionDrop(g, pi);
    if (g.turn === pi) advanceTurn(g);
    else if (g.players.filter((q) => !q.out).length <= 1) { g.winner = g.players.findIndex((q) => !q.out); g.phase = 'over'; }
}

function groupAllowsBuild(g, sq) {
    const s = BOARD[sq];
    return s.t === 'prop' && GROUPS[s.g].every((q) => !g.mort[q]) && ownsAll(g, g.turn, s.g);
}

// تنفيذ فعل؛ يعيد null عند النجاح أو مفتاح خطأ عربي
function act(g, pi, a) {
    if (g.phase === 'over') return 'انتهت اللعبة.';
    if (g.phase === 'auction' && (a.a === 'bid' || a.a === 'pass')) return auctionAct(g, pi, a);
    if (pi !== g.turn) return 'ليس دورك.';
    if (g.phase === 'auction') return 'المزاد جارٍ.';
    const p = cur(g);
    const sq = Number.isInteger(a.sq) ? a.sq : -1;
    const owned = sq >= 0 && sq < 40 && g.owner[sq] === pi;
    switch (a.a) {
        case 'roll': {
            if (g.phase !== 'roll') return 'لا يمكنك رمي النرد الآن.';
            const d1 = 1 + rnd(6), d2 = 1 + rnd(6);
            g.dice = [d1, d2]; g.drawn = null;
            const dbl = d1 === d2, sum = d1 + d2;
            log(g, '{n} رمى النرد: {a} + {b}', { n: p.name, a: d1, b: d2 });
            if (p.jail) {
                if (dbl) { p.jail = false; p.jt = 0; g.again = false; log(g, '{n} خرج من السجن بالتعادل', { n: p.name }); }
                else {
                    p.jt++;
                    if (p.jt < 3) { g.again = false; g.phase = 'end'; return null; }
                    // الدور الثالث: غرامة إجبارية ثم الحركة
                    p.jail = false; p.jt = 0; g.again = false;
                    g.afterJailMove = sum;
                    if (!charge(g, pi, JAIL_FEE, null)) return null;
                    delete g.afterJailMove;
                }
            } else if (dbl) {
                g.dbl++;
                if (g.dbl >= 3) { sendToJail(g, pi); g.phase = 'end'; return null; }
                g.again = true;
            } else g.again = false;
            moveBy(g, pi, sum);
            land(g, pi, sum);
            return null;
        }
        case 'buy': {
            if (g.phase !== 'buy') return 'لا يوجد ما يُشترى.';
            const s = BOARD[p.pos];
            if (p.cash < s.p) return 'رصيدك لا يكفي.';
            p.cash -= s.p; g.owner[p.pos] = pi;
            log(g, '{n} اشترى {s} بـ{a}', { n: p.name, s: s.n, a: s.p });
            nextPhase(g); return null;
        }
        case 'decline': {
            if (g.phase !== 'buy') return 'لا يوجد ما يُشترى.';
            startAuction(g); return null;
        }
        case 'end': {
            if (g.phase !== 'end') return 'أنهِ حركتك أولًا.';
            advanceTurn(g); return null;
        }
        case 'payjail': {
            if (g.phase !== 'roll' || !p.jail) return 'لست في السجن.';
            if (p.cash < JAIL_FEE) return 'رصيدك لا يكفي.';
            p.cash -= JAIL_FEE; p.jail = false; p.jt = 0;
            log(g, '{n} دفع غرامة الخروج من السجن', { n: p.name });
            return null;
        }
        case 'jailcard': {
            if (g.phase !== 'roll' || !p.jail) return 'لست في السجن.';
            if (p.cards < 1) return 'لا تملك بطاقة خروج.';
            p.cards--; p.jail = false; p.jt = 0;
            log(g, '{n} استعمل بطاقة الخروج من السجن', { n: p.name });
            return null;
        }
        case 'paydebt': {
            if (g.phase !== 'debt' || !g.pending) return 'لا يوجد دَين.';
            const d = g.pending;
            if (p.cash < d.amount) return 'رصيدك لا يكفي بعد، بِع أو ارهن ممتلكات.';
            p.cash -= d.amount;
            if (d.to !== null) g.players[d.to].cash += d.amount;
            if (g.afterJailMove) { const sum = g.afterJailMove; delete g.afterJailMove; g.pending = null; moveBy(g, pi, sum); land(g, pi, sum); return null; }
            nextPhase(g); return null;
        }
        case 'bankrupt': {
            if (g.phase !== 'debt' || !g.pending) return 'الإفلاس متاح فقط عند وجود دَين.';
            bankrupt(g, pi, g.pending.to); return null;
        }
        case 'build': {
            if (g.phase === 'debt' || g.phase === 'over') return 'غير متاح الآن.';
            if (!owned || !groupAllowsBuild(g, sq)) return 'تحتاج إلى امتلاك كل المجموعة دون رهن.';
            const s = BOARD[sq], h = g.houses[sq] || 0;
            if (h >= 5) return 'وصلت إلى فندق.';
            if (h > Math.min(...groupHouses(g, s.g))) return 'ابنِ بالتساوي على المجموعة.';
            if (p.cash < s.h) return 'رصيدك لا يكفي.';
            p.cash -= s.h; g.houses[sq] = h + 1;
            log(g, '{n} بنى في {s}', { n: p.name, s: s.n }); return null;
        }
        case 'sell': {
            if (g.phase === 'over') return 'انتهت اللعبة.';
            const s = BOARD[sq];
            if (!owned || !s || s.t !== 'prop') return 'غير متاح.';
            const h = g.houses[sq] || 0;
            if (h < 1) return 'لا توجد مبانٍ للبيع.';
            if (h < Math.max(...groupHouses(g, s.g))) return 'بِع بالتساوي من المجموعة.';
            p.cash += Math.floor(s.h / 2); g.houses[sq] = h - 1;
            if (!g.houses[sq]) delete g.houses[sq];
            return null;
        }
        case 'mortgage': {
            if (g.phase === 'over') return 'انتهت اللعبة.';
            const s = BOARD[sq];
            if (!owned || !s || !s.p) return 'غير متاح.';
            if (g.mort[sq]) return 'مرهونة بالفعل.';
            if (s.g && GROUPS[s.g].some((q) => (g.houses[q] || 0) > 0)) return 'بِع المباني أولًا.';
            g.mort[sq] = true; p.cash += s.p / 2; return null;
        }
        case 'unmortgage': {
            if (g.phase === 'over') return 'انتهت اللعبة.';
            const s = BOARD[sq];
            if (!owned || !s || !g.mort[sq]) return 'غير متاح.';
            const cost = Math.ceil((s.p / 2) * 1.1);
            if (p.cash < cost) return 'رصيدك لا يكفي.';
            p.cash -= cost; delete g.mort[sq]; return null;
        }
        default: return 'فعل غير معروف.';
    }
}

function publicState(g) {
    return {
        players: g.players, owner: g.owner, houses: g.houses, mort: g.mort,
        turn: g.turn, phase: g.phase, dice: g.dice, pending: g.pending, drawn: g.drawn,
        winner: g.winner, log: g.log.slice(-12), again: g.again, auction: g.auction, mult: rentMult(g), round: g.round || 0
    };
}

// ───────────────────────── ربط Socket.IO ─────────────────────────
const COLORS = ['#e5484d', '#3b82f6', '#22c55e', '#f5a524', '#a855f7', '#14b8a6'];
const MAX_PLAYERS = 6;
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
    for (let t = 0; t < 50; t++) {
        let c = '';
        for (let i = 0; i < 4; i++) c += CODE_CHARS[rnd(CODE_CHARS.length)];
        if (!rooms.has(c)) return c;
    }
    return null;
}


// ───────── الحاسوب ─────────
function botChoose(g, pi) {
    const p = g.players[pi];
    if (g.phase === 'roll') {
        if (p.jail) {
            if (p.cards > 0) return { a: 'jailcard' };
            if (p.cash >= 300) return { a: 'payjail' };
        }
        return { a: 'roll' };
    }
    if (g.phase === 'auction') {
        const au = g.auction, s = BOARD[au.sq];
        const completes = s.g && GROUPS[s.g].filter((q) => q !== au.sq).every((q) => g.owner[q] === pi);
        const value = Math.min(p.cash - 40, Math.floor(s.p * (completes ? 1.3 : 0.9)));
        const step = Math.max(10, Math.round(s.p / 20 / 10) * 10);
        const amt = au.bid + step;
        return amt <= value ? { a: 'bid', amt } : { a: 'pass' };
    }
    if (g.phase === 'buy') {
        const s = BOARD[p.pos];
        const completes = s.g && GROUPS[s.g].filter((q) => q !== p.pos).every((q) => g.owner[q] === pi);
        const reserve = 40;
        return { a: p.cash - s.p >= reserve || (completes && p.cash >= s.p) ? 'buy' : 'decline' };
    }
    if (g.phase === 'debt') {
        if (p.cash >= g.pending.amount) return { a: 'paydebt' };
        return { a: 'raise' };
    }
    if (g.phase === 'end') return { a: 'improve' };
    return null;
}

// يُنفّذ خطوة واحدة للحاسوب؛ يعيد false إذا لم يبقَ ما يفعله
function botStep(g, pi) {
    const p = g.players[pi];
    let c = botChoose(g, pi);
    if (!c) return false;
    if (c.a === 'improve') {
        if (p.cash > 500) {
            for (let sq = 0; sq < 40; sq++) if (g.mort[sq] && g.owner[sq] === pi && act(g, pi, { a: 'unmortgage', sq }) === null) return true;
        }
        const cand = [];
        for (let sq = 0; sq < 40; sq++) if (g.owner[sq] === pi && BOARD[sq].t === 'prop') cand.push(sq);
        cand.sort((x, y) => BOARD[y].h - BOARD[x].h);
        for (const sq of cand) {
            if (p.cash - BOARD[sq].h < 100) continue;
            if (act(g, pi, { a: 'build', sq }) === null) return true;
        }
        c = { a: 'end' };
    }
    if (c.a === 'raise') {
        const mine = [];
        for (let sq = 0; sq < 40; sq++) if (g.owner[sq] === pi) mine.push(sq);
        for (const sq of mine) if ((g.houses[sq] || 0) > 0 && act(g, pi, { a: 'sell', sq }) === null) return true;
        for (const sq of mine) if (!g.mort[sq] && act(g, pi, { a: 'mortgage', sq }) === null) return true;
        c = { a: 'bankrupt' };
    }
    return act(g, pi, c) === null;
}

function attach(io, { nameOf }) {
    const emitRoom = (room) => {
        room.players.forEach((pl, i) => {
            if (!pl.sid) return;
            io.to(pl.sid).emit('mp_update', {
                code: room.code, me: i, host: 0,
                players: room.players.map((q, j) => ({ name: q.name, color: COLORS[j % COLORS.length], on: !!q.sid || !!q.bot, bot: !!q.bot })),
                started: !!room.game, game: room.game ? publicState(room.game) : null
            });
        });
        runBots(room);
    };
    const dropRoom = (room) => { rooms.delete(room.code); };

    // تشغيل أدوار الحاسوب بتأنٍّ، ويتوقف إن لم يبقَ لاعب بشري متصل
    function runBots(room) {
        if (room.botTimer || !room.game || room.game.phase === 'over') return;
        const g = room.game;
        const ai0 = actorOf(g);
        if (!room.players[ai0] || !room.players[ai0].bot) return;
        if (!room.players.some((q) => !q.bot && q.sid)) return;
        room.botTimer = setTimeout(() => {
            room.botTimer = null;
            if (!rooms.has(room.code) || room.game !== g || g.phase === 'over') return;
            const i = actorOf(g);
            if (room.players[i] && room.players[i].bot) {
                let ok = false;
                try { ok = botStep(g, i); } catch (e) { ok = false; }
                if (!ok && g.phase !== 'over') { act(g, i, { a: g.phase === 'auction' ? 'pass' : g.phase === 'debt' ? 'bankrupt' : 'end' }); }
            }
            emitRoom(room);
        }, 900);
        room.botTimer.unref && room.botTimer.unref();
    }

    function findByToken(token) {
        for (const room of rooms.values()) {
            const i = room.players.findIndex((p) => p.token === token);
            if (i >= 0) return { room, i };
        }
        return null;
    }

    // مهلة الإفلاس للمنقطعين، وتنظيف الغرف الفارغة
    const sweep = setInterval(() => {
        const now = Date.now();
        for (const room of [...rooms.values()]) {
            if (room.players.every((p) => !p.sid) && now - room.t > 10 * 60 * 1000) { dropRoom(room); continue; }
            if (!room.game) continue;
            let changed = false;
            room.players.forEach((p, i) => {
                const gp = room.game.players[i];
                if (!p.sid && p.off && now - p.off > 120000 && !gp.out && room.game.phase !== 'over') { bankrupt(room.game, i, null); changed = true; }
            });
            if (changed) emitRoom(room);
        }
    }, 15000);
    sweep.unref();

    io.on('connection', (socket) => {
        const tok = () => socket.data.token;
        const err = (k) => socket.emit('mp_error', k);
        const mine = () => (tok() ? findByToken(tok()) : null);

        socket.on('mp_create', () => {
            if (!tok()) return;
            if (mine()) return err('أنت في غرفة بالفعل.');
            const code = newCode();
            if (!code) return err('تعذّر إنشاء الغرفة.');
            const room = { code, players: [{ token: tok(), name: nameOf(tok()), sid: socket.id, off: 0 }], game: null, t: Date.now() };
            rooms.set(code, room);
            emitRoom(room);
        });

        socket.on('mp_create_ai', (d) => {
            if (!tok()) return;
            if (mine()) return err('أنت في غرفة بالفعل.');
            const n = Math.min(3, Math.max(1, parseInt(d && d.bots, 10) || 1));
            const code = newCode();
            if (!code) return err('تعذّر إنشاء الغرفة.');
            const players = [{ token: tok(), name: nameOf(tok()), sid: socket.id, off: 0 }];
            for (let k = 1; k <= n; k++) players.push({ token: null, name: 'الحاسوب ' + k, sid: null, off: 0, bot: true });
            const room = { code, players, game: null, t: Date.now(), ai: true };
            room.game = createGame(players.map((q) => q.name));
            rooms.set(code, room);
            emitRoom(room);
        });

        socket.on('mp_join', (d) => {
            if (!tok()) return;
            const code = String((d && d.code) || '').toUpperCase().trim().slice(0, 8);
            const room = rooms.get(code);
            if (!room) return err('الغرفة غير موجودة.');
            const ex = room.players.findIndex((p) => p.token === tok());
            if (ex >= 0) { room.players[ex].sid = socket.id; room.players[ex].off = 0; return emitRoom(room); }
            if (mine()) return err('أنت في غرفة بالفعل.');
            if (room.ai) return err('هذه غرفة ضد الحاسوب.');
            if (room.game) return err('بدأت اللعبة في هذه الغرفة.');
            if (room.players.length >= MAX_PLAYERS) return err('الغرفة ممتلئة.');
            let nm = nameOf(tok());
            if (room.players.some((p) => p.name === nm)) nm = nm + ' ' + (room.players.length + 1);
            room.players.push({ token: tok(), name: nm, sid: socket.id, off: 0 });
            emitRoom(room);
        });

        socket.on('mp_rejoin', () => {
            const f = mine();
            if (!f) return socket.emit('mp_none');
            f.room.players[f.i].sid = socket.id; f.room.players[f.i].off = 0; f.room.t = Date.now();
            emitRoom(f.room);
        });

        socket.on('mp_leave', () => {
            const f = mine();
            if (!f) return;
            const { room, i } = f;
            socket.emit('mp_none');
            if (room.ai) { clearTimeout(room.botTimer); return dropRoom(room); }
            if (!room.game) {
                room.players.splice(i, 1);
                if (!room.players.length) return dropRoom(room);
                return emitRoom(room);
            }
            const gp = room.game.players[i];
            if (!gp.out && room.game.phase !== 'over') bankrupt(room.game, i, null);
            room.players[i].sid = null; room.players[i].token = null; room.players[i].left = true;
            if (room.players.every((p) => !p.sid)) return dropRoom(room);
            emitRoom(room);
        });

        socket.on('mp_start', () => {
            const f = mine();
            if (!f || f.i !== 0) return err('المضيف فقط يبدأ اللعبة.');
            if (f.room.game) return;
            if (f.room.players.length < 2) return err('تحتاج إلى لاعبين اثنين على الأقل.');
            f.room.game = createGame(f.room.players.map((p) => p.name));
            emitRoom(f.room);
        });

        socket.on('mp_act', (d) => {
            const f = mine();
            if (!f || !f.room.game || !d || typeof d !== 'object') return;
            const e = act(f.room.game, f.i, { a: String(d.a || ''), sq: d.sq, amt: d.amt });
            if (e) err(e);
            emitRoom(f.room);
        });

        socket.on('disconnect', () => {
            const f = tok() ? findByToken(tok()) : null;
            if (!f || f.room.players[f.i].sid !== socket.id) return;
            const { room, i } = f;
            room.players[i].sid = null; room.players[i].off = Date.now();
            if (!room.game) {
                room.players.splice(i, 1);
                if (!room.players.length) return dropRoom(room);
            }
            emitRoom(room);
        });
    });
}

module.exports = { actorOf, botStep, attach, createGame, act, BOARD, publicState, rooms };
