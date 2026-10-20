'use strict';
// تحليل المباراة: يقيّم كل مركز ثم يصنّف كل حركة (بريليانت، الأفضل، ...، بلندر).
// المصدر الأول Stockfish عبر الـ API، وعند تعذره نستخدم المحرك المحلي (أضعف) داخل worker.
const path = require('path');
const axios = require('axios');
const { Worker } = require('worker_threads');
const { Chess } = require('chess.js');

const STOCKFISH_URL = 'https://stockfish.online/api/s/v2.php';
const SF_DEPTH = 12;
const PV = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const MATE_CP = 10000;
const MAX_PLIES = 400;

// قاعدة افتتاحيات صغيرة: كل بادئة من هذه الخطوط تُعدّ «نظرية»
const BOOK_LINES = `e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3
e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5 Qxd8+ Kxd8
e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O
e4 e5 Nf3 Nc6 Bc4 Nf6 d4 exd4 O-O Nxe4 Re1 d5 Bxd5 Qxd5 Nc3 Qa5
e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6 Be2 h6
e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5
e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3 Nc6 O-O Be7
e4 e5 f4 exf4 Nf3 g5 h4 g4 Ng5 h6
e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3 Be7
e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7 Qd2 O-O O-O-O
e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Bg5 e6 f4 Be7 Qf3 Qc7 O-O-O Nbd7
e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3 O-O Qd2 Nc6
e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6 Bg5 a6 Na3 b5
e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6 Bd3 Nf6 O-O Qc7 Qe2 d6
e4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 d3 d6 Be3 e6
e4 c5 c3 d5 exd5 Qxd5 d4 Nf6 Nf3 e6 Be2 Nc6 O-O cxd4 cxd4 Be7
e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7 e5 Nfd7 Bxe7 Qxe7 f4 O-O Nf3 c5
e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7 Qg4 O-O
e4 e6 d4 d5 Nd2 Nf6 e5 Nfd7 Bd3 c5 c3 Nc6 Ne2 cxd4 cxd4 f6
e4 e6 d4 d5 exd5 exd5 Nf3 Nf6 Bd3 Bd6 O-O O-O
e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6
e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nf6 Nxf6+ exf6 c3 Bd6 Bd3 O-O Qc2 h6
e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3 Nd7 O-O Ne7
e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4 Bf5 Bd2 e6
e4 d5 exd5 Nf6 d4 Nxd5 Nf3 Bg4 Be2 e6 O-O Be7
e4 d6 d4 Nf6 Nc3 g6 f4 Bg7 Nf3 O-O Bd3 Na6
e4 g6 d4 Bg7 Nc3 d6 Nf3 Nf6 Be2 O-O O-O Bg4
e4 Nf6 e5 Nd5 d4 d6 Nf3 Bg4 Be2 e6 O-O Be7
d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 Nbd7 Rc1 c6 Bd3 dxc4 Bxc4 Nd5
d4 d5 c4 e6 Nc3 Nf6 Nf3 Be7 Bf4 O-O e3 c5 dxc5 Bxc5 a3 Nc6
d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4 Bb4 O-O Nbd7
d4 d5 c4 c6 Nf3 Nf6 Nc3 e6 e3 Nbd7 Bd3 dxc4 Bxc4 b5 Bd3 a6 e4 c5
d4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5 O-O a6 Bb3 cxd4 exd4 Nc6
d4 d5 c4 Nc6 Nc3 e5 dxe5 d4 Ne4 Qd5
d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5 O-O Nc6 a3 Bxc3 bxc3 dxc4 Bxc4 Qc7
d4 Nf6 c4 e6 Nf3 b6 g3 Ba6 b3 Bb4+ Bd2 Be7 Bg2 c6 Bc3 d5 Ne5 Nfd7
d4 Nf6 c4 e6 Nf3 d5 Nc3 Be7 Bg5 h6 Bh4 O-O e3 Ne4 Bxe7 Qxe7
d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7
d4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7 Nf3 c5 Be3 Qa5 Qd2 O-O Rc1
d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f3 O-O Be3 e5 Nge2 c6 Qd2 Nbd7
d4 Nf6 Nf3 g6 Bf4 Bg7 e3 O-O Be2 d6 h3 Nbd7 O-O b6
d4 Nf6 Bg5 Ne4 Bf4 c5 f3 Qa5+ c3 Nf6 dxc5 e6 e4 Bxc5
d4 d5 Nf3 Nf6 Bf4 e6 e3 Bd6 Bg3 O-O Nbd2 c5 c3 Nc6 Bd3 Qe7
d4 d5 Bf4 Nf6 e3 c5 c3 Nc6 Nd2 e6 Ngf3 Bd6 Bg3 O-O Bd3 Qe7
c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5 Bg2 Nb6 O-O Be7
c4 e5 Nc3 Nc6 g3 g6 Bg2 Bg7 d3 d6 Rb1 a5 a3 Be6
c4 c5 Nf3 Nf6 Nc3 Nc6 g3 d5 cxd5 Nxd5 Bg2 Nc7 O-O e5
c4 Nf6 Nc3 e6 e4 d5 e5 d4 exf6 dxc3 bxc3 Qxf6 d4 c5 Nf3 Nc6
c4 e6 Nf3 d5 g3 Nf6 Bg2 Be7 O-O O-O d4 dxc4 Qc2 a6 Qxc4 b5 Qc2 Bb7 Bd2 Nbd7
Nf3 d5 g3 Nf6 Bg2 e6 O-O Be7 d3 O-O Nbd2 c5 e4 Nc6 Re1 b5
Nf3 Nf6 c4 g6 g3 Bg7 Bg2 O-O O-O d6 d4 Nbd7 Nc3 e5 e4 c6
Nf3 d5 d4 Nf6 c4 e6 Nc3 Be7 Bg5 O-O e3 h6 Bh4 Ne4
f4 d5 Nf3 Nf6 e3 g6 Be2 Bg7 O-O O-O d3 c5
b3 e5 Bb2 Nc6 e3 d5 Bb5 Bd6 Nf3 Qe7 Bxc6+ bxc6 d3 Nf6 Nbd2 O-O
g3 d5 Bg2 Nf6 Nf3 e6 O-O Be7 d3 O-O Nbd2 c5
e4 e5 Nf3 d6 d4 exd4 Nxd4 Nf6 Nc3 Be7 Be2 O-O O-O Re8
d4 f5 g3 Nf6 Bg2 e6 Nf3 Be7 O-O O-O c4 d6
d4 d5 Nf3 Nf6 c4 e6 Nc3 c6 e3 Nbd7 Bd3 dxc4 Bxc4 b5 Bd3 Bb7 O-O a6 e4 c5
e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Nxe4 d4 b5 Bb3 d5 dxe5 Be6 c3 Be7 Nbd2 Nc5
e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 O-O c3 d5 exd5 Nxd5 Nxe5 Nxe5 Rxe5 c6
e4 e5 Nf3 Nc6 Nc3 Nf6 Bb5 Bb4 O-O O-O d3 d6 Bg5 Bxc3 bxc3 Qe7
e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5 c3 d6 O-O a6 Bb3 Ba7 Re1 O-O
e4 e5 Bc4 Nf6 d3 c6 Nf3 d5 Bb3 Bd6 Nbd2 O-O
e4 c5 Nf3 d6 Bb5+ Bd7 Bxd7+ Qxd7 c4 Nc6 Nc3 Nf6 O-O g6 d4 cxd4 Nxd4 Bg7
e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Nf3 d6 Bc4 e6 O-O Nf6 Qe2 Be7 Rd1 e5
d4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O O-O dxc4 Qc2 a6 a4 Bd7 Qxc4 Bc6 Bg5 Bd5
d4 Nf6 c4 e6 Nc3 Bb4 Qc2 O-O a3 Bxc3+ Qxc3 b6 Bg5 Bb7 e3 d6 f3 Nbd7
d4 Nf6 c4 e6 Nc3 Bb4 Qc2 d5 a3 Bxc3+ Qxc3 Ne4 Qc2 Nc6 e3 e5 cxd5 exd4
d4 d5 c4 e6 Nc3 Nf6 cxd5 exd5 Bg5 c6 e3 Be7 Bd3 Nbd7 Qc2 O-O Nge2 Re8
d4 e6 c4 Nf6 Nc3 Bb4 Nf3 c5 e3 Nc6 Bd3 Bxc3+ bxc3 d6 e4 e5`;
const BOOK = new Set();
BOOK_LINES.split('\n').forEach((line) => {
    const mv = line.trim().split(/\s+/).map((m) => m.replace(/[+#]/g, ''));
    for (let i = 1; i <= mv.length; i++) BOOK.add(mv.slice(0, i).join(' '));
});
function inBook(sans, i) {
    return i < 24 && BOOK.has(sans.slice(0, i + 1).map((m) => m.replace(/[+#]/g, '')).join(' '));
}

// ───────────────────────── الرياضيات (بدون اعتماد على مكتبة الشطرنج) ─────────────────────────
// احتمال الفوز (0..100) من منظور الجهة التي تقيَّم، انطلاقًا من cp
function winPct(cp) {
    const c = Math.max(-1500, Math.min(1500, cp));
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}
// دقة الحركة (0..100) من خسارة احتمال الفوز
function moveAccuracy(loss) {
    const a = 103.1668 * Math.exp(-0.04354 * loss) - 3.1669;
    return Math.max(0, Math.min(100, a));
}
// loss: خسارة احتمال الفوز بالنقاط المئوية. isBest: لعب أفضل حركة للمحرك.
// sac: تضحية حقيقية. before/after: احتمال فوز اللاعب قبل الحركة وبعدها.
function classify(loss, isBest, sac, before, after, great) {
    const good = isBest || loss <= 2;
    if (good && sac && after >= 40 && before <= 92) return 'brilliant';
    if (isBest && great) return 'great';
    if (isBest) return 'best';
    if (loss <= 2) return 'excellent';
    if (loss <= 5) return 'good';
    if (loss <= 10) return 'inaccuracy';
    if (loss <= 20) return 'mistake';
    return 'blunder';
}
function materialPawns(fen) {
    let s = 0;
    for (const ch of fen.split(' ')[0]) {
        const t = ch.toLowerCase();
        if (PV[t]) s += (ch === t ? -1 : 1) * PV[t];
    }
    return s;
}

// ───────────────────────── تضحية؟ ─────────────────────────
// بعد حركة اللاعب: هل يستطيع الخصم كسب مادة صافية (≥ 2) بالأخذ ثم إعادة الأخذ؟
function isSacrifice(fenBefore, from, to, promotion) {
    try {
        const g = new Chess(fenBefore);
        const mv = g.move({ from, to, promotion });
        if (!mv) return false;
        const gained = mv.captured ? PV[mv.captured] : 0;
        let worst = 0;
        for (const c of g.moves({ verbose: true })) {
            if (!c.captured) continue;
            const take = PV[c.captured];
            g.move({ from: c.from, to: c.to, promotion: c.promotion });
            let back = 0;
            for (const r of g.moves({ verbose: true })) {
                if (r.to === c.to && r.captured) back = Math.max(back, PV[r.captured]);
            }
            g.undo();
            worst = Math.max(worst, take - back);
        }
        return worst - gained >= 2;
    } catch (e) {
        return false;
    }
}

// ───────────────────────── التقييم ─────────────────────────
const cache = new Map();   // fen -> { cp, best } من Stockfish (cp من منظور الأبيض)
function remember(fen, v) {
    if (cache.size > 3000) cache.delete(cache.keys().next().value);
    cache.set(fen, v);
}

// يعيد { cp, best, stm } حيث cp كما ورد من الـ API (قد يكون من منظور الأبيض أو الجهة التي عليها الدور)
async function sfRaw(fen) {
    const res = await axios.get(STOCKFISH_URL, { params: { fen, depth: SF_DEPTH }, timeout: 9000 });
    const d = res.data;
    if (!d || !d.success) throw new Error('stockfish: bad response');
    let cp;
    let mate = false;
    if (typeof d.mate === 'number') { cp = d.mate > 0 ? MATE_CP : -MATE_CP; mate = true; }
    else if (typeof d.evaluation === 'number') cp = Math.round(d.evaluation * 100);
    else throw new Error('stockfish: no eval');
    const m = /bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/.exec(String(d.bestmove || ''));
    return { cp, mate, best: m ? m[1] : null };
}

async function pool(items, limit, fn) {
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            await fn(items[i], i);
        }
    });
    await Promise.all(workers);
}

async function evalWithStockfish(fens, terminal, onStep) {
    const raw = new Array(fens.length).fill(null);
    let failed = 0;
    await pool(fens.map((f, i) => i), 2, async (i) => {
        if (terminal[i] === null) {
            const c = cache.get(fens[i]);
            if (c && c.raw) raw[i] = c.raw;
            else {
                for (let attempt = 0; attempt < 2 && !raw[i]; attempt++) {
                    try { raw[i] = await sfRaw(fens[i]); } catch (e) { /* نعيد المحاولة مرة */ }
                }
                if (raw[i]) remember(fens[i], { raw: raw[i] }); else failed++;
            }
        }
        onStep();
    });
    const need = terminal.filter((t) => t === null).length;
    if (!need || failed > Math.max(2, need * 0.25)) return null;
    // الـ API قد يعيد التقييم من منظور الأبيض أو من منظور الجهة التي عليها الدور؛ نحدد ذلك بمقارنته بالمادة
    const turnOf = (fen) => fen.split(' ')[1];
    const score = (asWhite) => {
        let ok = 0;
        let bad = 0;
        raw.forEach((r, i) => {
            if (!r || r.mate) return;
            const mat = materialPawns(fens[i]);
            const cp = asWhite ? r.cp : (turnOf(fens[i]) === 'w' ? r.cp : -r.cp);
            if (Math.abs(mat) >= 5 && Math.abs(cp) >= 200) { if (Math.sign(mat) === Math.sign(cp)) ok++; else bad++; }
        });
        return ok - bad;
    };
    const whitePov = score(true) >= score(false);
    return raw.map((r, i) => {
        if (terminal[i] !== null) return { cp: terminal[i], best: null };
        if (!r) return null;
        const cp = whitePov || r.mate ? r.cp : (turnOf(fens[i]) === 'w' ? r.cp : -r.cp);
        return { cp, best: r.best };
    });
}

function evalLocal(fens, terminal) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
        let w;
        const todo = fens.map((f, i) => (terminal[i] === null ? f : 'k7/8/8/8/8/8/8/K7 w - - 0 1'));
        try {
            w = new Worker(path.join(__dirname, 'engine-worker.js'), { workerData: { fens: todo, depth: 3, timeMs: 350 } });
        } catch (e) { return resolve(null); }
        const t = setTimeout(() => { w.terminate(); finish(null); }, 90000);
        w.once('message', (m) => finish(m && Array.isArray(m.evals) ? m.evals : null));
        w.once('error', () => finish(null));
        w.once('exit', () => finish(null));
    });
}

function terminalValue(g) {
    if (g.isCheckmate()) return g.turn() === 'w' ? -MATE_CP : MATE_CP;
    if (g.isDraw() || g.isStalemate() || g.isInsufficientMaterial()) return 0;
    return null;
}

// history: قائمة SAN، startFen: مركز البداية (أو null). onProgress(done, total)
async function analyzeGame(startFen, history, onProgress, clientEvals) {
    if (!Array.isArray(history) || !history.length || history.length > MAX_PLIES) throw new Error('bad history');
    const g = startFen ? new Chess(startFen) : new Chess();
    const fens = [g.fen()];
    const terminal = [terminalValue(g)];
    const moves = [];
    for (const san of history) {
        const before = g.fen();
        let mv;
        try { mv = g.move(san); } catch (e) { mv = null; }
        if (!mv) throw new Error('bad move');
        moves.push({ san: mv.san, from: mv.from, to: mv.to, promotion: mv.promotion, color: mv.color, captured: mv.captured || null, before });
        fens.push(g.fen());
        terminal.push(terminalValue(g));
    }
    const total = fens.length;
    let step = 0;
    const tick = () => { step++; if (onProgress) onProgress(Math.min(step, total), total); };

    let evals = null;
    let source = 'browser';
    if (Array.isArray(clientEvals) && clientEvals.length === fens.length) {
        evals = clientEvals.map((e, i) => (terminal[i] !== null ? { cp: terminal[i], best: null, alt: null } : { cp: e.cp, best: e.best || null, alt: Number.isFinite(e.alt) ? e.alt : null }));
    } else {
        source = 'stockfish';
        evals = await evalWithStockfish(fens, terminal, tick);
    }
    if (!evals || evals.some((e) => !e)) {
        source = 'stockfish';
        if (onProgress) onProgress(total, total);
        const loc = await evalLocal(fens, terminal);
        if (!loc) throw new Error('analysis failed');
        evals = loc.map((e, i) => (terminal[i] !== null ? { cp: terminal[i], best: null } : e));
        source = 'local';
    }

    const out = [];
    const acc = { w: [], b: [] };
    const counts = { w: {}, b: {} };
    moves.forEach((m, i) => {
        const e0 = evals[i];
        const e1 = evals[i + 1];
        const sign = m.color === 'w' ? 1 : -1;
        const before = winPct(sign * e0.cp);
        const after = winPct(sign * e1.cp);
        let loss = Math.max(0, before - after);
        const uci = m.from + m.to + (m.promotion || '');
        const isBest = !!e0.best && e0.best === uci && loss <= 5;   // فرق كبير = ضجيج تقييم لا «أفضل حركة»
        const sac = loss <= 2 && isSacrifice(m.before, m.from, m.to, m.promotion);
        // «رائعة جدًا»: أفضل حركة وحيدة تقريبًا (البديل الثاني أسوأ بكثير) في مركز ليس محسومًا
        const recapture = i > 0 && !!m.captured && moves[i - 1].to === m.to;   // إعادة الأخذ البديهية ليست «رائعة جدًا»
        const great = isBest && !recapture && e0.alt != null && before <= 92 && (before - winPct(sign * e0.alt)) >= 15;
        let cls = classify(loss, isBest, sac, before, after, great);
        const book = !startFen && inBook(history, i);
        if (book) cls = 'book';
        let bestSan = null;
        if (e0.best && !isBest) {
            try {
                const t = new Chess(m.before);
                const bm = t.move({ from: e0.best.slice(0, 2), to: e0.best.slice(2, 4), promotion: e0.best[4] });
                bestSan = bm && bm.san;
            } catch (err) { bestSan = null; }
        }
        if (cls === 'book') loss = 0;
        acc[m.color].push(moveAccuracy(loss));
        counts[m.color][cls] = (counts[m.color][cls] || 0) + 1;
        out.push({ san: m.san, color: m.color, cls, loss: Math.round(loss * 10) / 10, cp: e1.cp, best: bestSan });
    });
    const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
    return { source, plies: out, accuracy: { w: avg(acc.w), b: avg(acc.b) }, counts, startCp: evals[0].cp };
}

module.exports = { analyzeGame, winPct, moveAccuracy, classify, isSacrifice, materialPawns };
