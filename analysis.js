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
function classify(loss, isBest, sac, before, after) {
    const good = isBest || loss <= 2;
    if (good && sac && after >= 40 && before <= 92) return 'brilliant';
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
async function analyzeGame(startFen, history, onProgress) {
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
        moves.push({ san: mv.san, from: mv.from, to: mv.to, promotion: mv.promotion, color: mv.color, before });
        fens.push(g.fen());
        terminal.push(terminalValue(g));
    }
    const total = fens.length;
    let step = 0;
    const tick = () => { step++; if (onProgress) onProgress(Math.min(step, total), total); };

    let evals = await evalWithStockfish(fens, terminal, tick);
    let source = 'stockfish';
    if (!evals || evals.some((e) => !e)) {
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
        const loss = Math.max(0, before - after);
        const uci = m.from + m.to + (m.promotion || '');
        const isBest = !!e0.best && e0.best === uci && loss <= 5;   // فرق كبير = ضجيج تقييم لا «أفضل حركة»
        const sac = loss <= 2 && isSacrifice(m.before, m.from, m.to, m.promotion);
        const cls = classify(loss, isBest, sac, before, after);
        let bestSan = null;
        if (e0.best && !isBest) {
            try {
                const t = new Chess(m.before);
                const bm = t.move({ from: e0.best.slice(0, 2), to: e0.best.slice(2, 4), promotion: e0.best[4] });
                bestSan = bm && bm.san;
            } catch (err) { bestSan = null; }
        }
        acc[m.color].push(moveAccuracy(loss));
        counts[m.color][cls] = (counts[m.color][cls] || 0) + 1;
        out.push({ san: m.san, color: m.color, cls, loss: Math.round(loss * 10) / 10, cp: e1.cp, best: bestSan });
    });
    const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
    return { source, plies: out, accuracy: { w: avg(acc.w), b: avg(acc.b) }, counts, startCp: evals[0].cp };
}

module.exports = { analyzeGame, winPct, moveAccuracy, classify, isSacrifice, materialPawns };
