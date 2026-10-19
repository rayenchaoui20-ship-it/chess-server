'use strict';
// محرك شطرنج احتياطي بسيط (negamax + alpha-beta) يُستخدم عند تعذّر Stockfish.
// يعمل داخل worker_thread حتى لا يحجب الخادم أثناء التفكير.
const { Chess } = require('chess.js');

const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 100000;
const TIMEOUT = { timeout: true };

let deadline = 0;
let nodes = 0;
let quiesce = false;      // بحث الالتقاطات في نهاية العمق (يُفعَّل في التحليل فقط)

// التقييم من منظور الأبيض
function evaluate(chess) {
    const board = chess.board();
    let s = 0;
    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            const p = board[r][f];
            if (!p) continue;
            let v = VAL[p.type];
            const cf = 3.5 - Math.abs(f - 3.5);
            const cr = 3.5 - Math.abs(r - 3.5);
            if (p.type === 'p') {
                const adv = p.color === 'w' ? 6 - r : r - 1;   // r=0 هو الصف الثامن
                v += adv * 8 + cf * 3;
            } else if (p.type !== 'k') {
                v += (cf + cr) * 5;
            }
            s += p.color === 'w' ? v : -v;
        }
    }
    return s;
}

function orderMoves(moves) {
    return moves.sort((a, b) => score(b) - score(a));
    function score(m) {
        let x = 0;
        if (m.captured) x += 10 * VAL[m.captured] - VAL[m.piece] / 10;
        if (m.promotion) x += VAL[m.promotion];
        return x;
    }
}

function qsearch(chess, alpha, beta, ply) {
    if ((++nodes & 255) === 0 && Date.now() > deadline) throw TIMEOUT;
    const stand = (chess.turn() === 'w' ? 1 : -1) * evaluate(chess);
    if (ply >= 8) return stand;
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    const caps = orderMoves(chess.moves({ verbose: true }).filter((m) => m.captured || m.promotion));
    for (const m of caps) {
        chess.move({ from: m.from, to: m.to, promotion: m.promotion });
        let v;
        try {
            v = -qsearch(chess, -beta, -alpha, ply + 1);
        } finally {
            chess.undo();
        }
        if (v >= beta) return beta;
        if (v > alpha) alpha = v;
    }
    return alpha;
}

function negamax(chess, depth, alpha, beta, ply) {
    if ((++nodes & 255) === 0 && Date.now() > deadline) throw TIMEOUT;
    const moves = chess.moves({ verbose: true });
    if (!moves.length) return chess.inCheck() ? -MATE + ply : 0;
    if (depth === 0) return quiesce ? qsearch(chess, alpha, beta, ply) : (chess.turn() === 'w' ? 1 : -1) * evaluate(chess);

    let best = -Infinity;
    for (const m of orderMoves(moves)) {
        chess.move({ from: m.from, to: m.to, promotion: m.promotion });
        let val;
        try {
            val = -negamax(chess, depth - 1, -beta, -alpha, ply + 1);
        } finally {
            chess.undo();
        }
        if (val > best) best = val;
        if (val > alpha) alpha = val;
        if (alpha >= beta) break;
    }
    return best;
}

// level: 1..15، timeMs: الحد الأقصى للتفكير
function pickMove(fen, level, timeMs) {
    const chess = new Chess(fen);
    const root = chess.moves({ verbose: true });
    if (!root.length) return null;

    const lvl = Math.min(15, Math.max(1, Number(level) || 8));
    const maxDepth = lvl <= 4 ? 1 : lvl <= 9 ? 2 : lvl <= 13 ? 3 : 4;
    const noise = Math.max(0, (11 - lvl)) * 18;          // المستويات الضعيفة ترتكب أخطاء
    deadline = Date.now() + (timeMs || 1500);
    nodes = 0;

    let scored = root.map((m) => ({ m, s: 0 }));
    for (let depth = 1; depth <= maxDepth; depth++) {
        const cur = [];
        try {
            for (const m of orderMoves(root.slice())) {
                chess.move({ from: m.from, to: m.to, promotion: m.promotion });
                let val;
                try {
                    val = -negamax(chess, depth - 1, -Infinity, Infinity, 1);
                } finally {
                    chess.undo();
                }
                cur.push({ m, s: val });
            }
            scored = cur;
        } catch (e) {
            if (e !== TIMEOUT) throw e;
            break;                                       // نستخدم آخر عمق مكتمل
        }
    }

    let best = null;
    for (const x of scored) {
        const v = x.s + Math.random() * noise;
        if (!best || v > best.v) best = { m: x.m, v };
    }
    const m = best.m;
    return { from: m.from, to: m.to, promotion: m.promotion };
}

// تقييم مركز للتحليل: cp من منظور الأبيض + أفضل حركة (UCI)
function analyse(fen, depth, timeMs) {
    const chess = new Chess(fen);
    const root = chess.moves({ verbose: true });
    if (!root.length) return { cp: chess.inCheck() ? (chess.turn() === 'w' ? -10000 : 10000) : 0, best: null };
    quiesce = true;
    deadline = Date.now() + (timeMs || 400);
    nodes = 0;
    let best = null;
    try {
        for (let d = 1; d <= (depth || 3); d++) {
            let cur = null;
            let alpha = -Infinity;
            try {
                for (const m of orderMoves(root.slice())) {
                    chess.move({ from: m.from, to: m.to, promotion: m.promotion });
                    let v;
                    try {
                        v = -negamax(chess, d - 1, -Infinity, -alpha, 1);
                    } finally {
                        chess.undo();
                    }
                    if (!cur || v > cur.v) cur = { m, v };
                    if (v > alpha) alpha = v;
                }
            } catch (err) {
                if (err !== TIMEOUT) throw err;
                break;
            }
            best = cur;
        }
    } finally {
        quiesce = false;
    }
    if (!best) best = { m: root[0], v: 0 };
    const cp = Math.max(-10000, Math.min(10000, (chess.turn() === 'w' ? 1 : -1) * best.v));
    return { cp, best: best.m.from + best.m.to + (best.m.promotion || '') };
}

module.exports = { pickMove, analyse };
