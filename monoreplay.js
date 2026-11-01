'use strict';
// إعادة مشاهدة «ملك المدينة»: نسجّل لقطات الحالة العامة أثناء اللعب، ثم نخزّنها مضغوطة بعد النهاية.
// التخزين: فروق بين اللقطات المتتالية ثم gzip. الحد الأقصى للقطات 300 (نُخفّف بالتساوي مع إبقاء الأخيرة).
const zlib = require('zlib');

const MAX_FRAMES = 300;
const slim = (s) => Object.assign({}, s, { log: (s.log || []).slice(-4) });

class Recorder {
    constructor() { this.frames = []; this.key = ''; }
    add(state) {
        const f = slim(state), k = JSON.stringify(f);
        if (k === this.key) return false;
        this.key = k; this.frames.push(JSON.parse(k));   // نسخة عميقة: الحالة الأصلية تتغير لاحقًا
        if (this.frames.length > MAX_FRAMES * 3) this.frames = thin(this.frames, MAX_FRAMES * 2);
        return true;
    }
}

function thin(frames, max) {
    if (frames.length <= max) return frames;
    const out = [], step = (frames.length - 1) / (max - 1);
    for (let i = 0; i < max; i++) out.push(frames[Math.round(i * step)]);
    return out;
}

// لقطات كاملة -> [كامل, فرق, فرق...]
function toDeltas(frames) {
    const out = [];
    let prev = null;
    frames.forEach((f) => {
        if (!prev) out.push(f);
        else {
            const d = {};
            Object.keys(f).forEach((k) => { if (JSON.stringify(f[k]) !== JSON.stringify(prev[k])) d[k] = f[k]; });
            Object.keys(prev).forEach((k) => { if (!(k in f)) d[k] = null; });
            out.push(d);
        }
        prev = f;
    });
    return out;
}
function fromDeltas(deltas) {
    const out = [];
    let cur = null;
    deltas.forEach((d) => {
        if (!cur) cur = Object.assign({}, d);
        else { cur = Object.assign({}, cur, d); Object.keys(d).forEach((k) => { if (d[k] === null && !(k in { auction: 1, trade: 1, pending: 1, drawn: 1, winner: 1 })) delete cur[k]; }); }
        out.push(cur);
    });
    return out;
}

function pack(frames) {
    return zlib.gzipSync(Buffer.from(JSON.stringify(toDeltas(thin(frames, MAX_FRAMES))))).toString('base64');
}
function unpackDeltas(z) {
    try { const a = JSON.parse(zlib.gunzipSync(Buffer.from(String(z), 'base64')).toString()); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
}
const unpack = (z) => fromDeltas(unpackDeltas(z));

module.exports = { Recorder, pack, unpack, unpackDeltas, fromDeltas, toDeltas, thin, MAX_FRAMES };
