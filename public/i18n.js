/* تبديل اللغة: عربي ⇄ English ⇄ Français. يترجم نصوص الصفحة تلقائيًا من قاموس i18n-data.js. */
(function () {
    'use strict';
    var DATA = window.I18N_DATA || {};
    var ORDER = ['ar', 'en', 'fr'];
    var LABEL = { ar: 'ع', en: 'EN', fr: 'FR' };
    var NAME = { ar: 'العربية', en: 'English', fr: 'Français' };
    var ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
    var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, NOSCRIPT: 1 };
    var lang = 'ar';
    try { var sv = localStorage.getItem('chess-lang'); if (ORDER.indexOf(sv) >= 0) lang = sv; } catch (e) { /* */ }

    var tables = {};            // لغة -> { exact: Map, pats: [] }
    function table(l) {
        if (tables[l]) return tables[l];
        var t = { exact: Object.create(null), pats: [] }, src = DATA[l] || {};
        Object.keys(src).forEach(function (k) {
            var nk = k.replace(/\s+/g, ' ').trim();
            if (/\{\w+\}/.test(nk)) {
                var names = [];
                var re = nk.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, function (m, n) { names.push(n); return '(.+?)'; });
                try { t.pats.push({ re: new RegExp('^' + re + '$'), names: names, out: src[k] }); } catch (e) { /* */ }
            } else t.exact[nk] = src[k];
        });
        t.pats.sort(function (a, b) { return b.re.source.length - a.re.source.length; });
        return (tables[l] = t);
    }
    // ترجمة جزئية: نستبدل العبارات المعروفة داخل جملة لم تُطابَق كاملة (الأطول أولًا)
    function partial(core, t) {
        if (!t.keys) t.keys = Object.keys(t.exact).filter(function (k) { return k.length >= 3 && /[\u0600-\u06FF]/.test(k); }).sort(function (a, b) { return b.length - a.length; });
        var out = core, changed = false;
        for (var i = 0; i < t.keys.length && /[\u0600-\u06FF]/.test(out); i++) {
            var k = t.keys[i];
            if (out.indexOf(k) >= 0) { out = out.split(k).join(t.exact[k]); changed = true; }
        }
        return changed ? out : null;
    }
    function conv(s, l) {
        if (l === 'ar' || !s) return s;
        var m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
        var core = m[2].replace(/\s+/g, ' ');
        if (!core || !/[؀-ۿ]/.test(core)) return s;
        var t = table(l), hit = t.exact[core];
        if (hit == null) {
            for (var i = 0; i < t.pats.length; i++) {
                var p = t.pats[i], r = p.re.exec(core);
                if (r) {
                    var vals = {}; p.names.forEach(function (n, k) { vals[n] = r[k + 1]; });
                    hit = p.out.replace(/\{(\w+)\}/g, function (x, n) { return vals[n] != null ? conv(vals[n], l) : x; });
                    break;
                }
            }
        }
        if (hit == null) hit = partial(core, t);
        return hit == null ? s : m[1] + hit + m[3];
    }

    var textMap = new WeakMap();    // نص -> { o: الأصلي العربي, x: ما كتبناه }
    var attrMap = new WeakMap();    // عنصر -> { attr: {o,x} }
    function doText(n) {
        var cur = n.nodeValue, rec = textMap.get(n);
        if (rec && cur === rec.x) { if (lang === 'ar') { n.nodeValue = rec.o; textMap.delete(n); } else { var v = conv(rec.o, lang); if (v !== cur) { rec.x = v; n.nodeValue = v; } } return; }
        if (lang === 'ar') return;
        var out = conv(cur, lang);
        if (out !== cur) { textMap.set(n, { o: cur, x: out }); n.nodeValue = out; }
    }
    function doAttrs(el) {
        var rec = attrMap.get(el);
        ATTRS.forEach(function (a) {
            if (!el.hasAttribute(a)) return;
            var cur = el.getAttribute(a), r = rec && rec[a];
            if (r && cur === r.x) {
                var nv = lang === 'ar' ? r.o : conv(r.o, lang);
                if (nv !== cur) { r.x = nv; el.setAttribute(a, nv); }
                return;
            }
            if (lang === 'ar') return;
            var out = conv(cur, lang);
            if (out !== cur) { rec = rec || {}; rec[a] = { o: cur, x: out }; attrMap.set(el, rec); el.setAttribute(a, out); }
        });
    }
    function walk(root) {
        if (!root) return;
        if (root.nodeType === 3) { if (!(root.parentNode && SKIP[root.parentNode.nodeName])) doText(root); return; }
        if (root.nodeType !== 1 || SKIP[root.nodeName]) return;
        doAttrs(root);
        for (var c = root.firstChild; c; c = c.nextSibling) walk(c);
    }
    var busy = false;
    var mo = window.MutationObserver ? new MutationObserver(function (list) {
        if (busy) return;
        busy = true;
        try {
            list.forEach(function (m) {
                if (m.type === 'characterData') { if (!(m.target.parentNode && SKIP[m.target.parentNode.nodeName])) doText(m.target); }
                else if (m.type === 'attributes') doAttrs(m.target);
                else m.addedNodes.forEach(walk);
            });
        } finally { busy = false; }
    }) : null;
    function observe() { if (mo) mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS }); }

    function btn() { return document.getElementById('lang-btn'); }
    function paintBtn() {
        var b = btn(); if (!b) return;
        var nx = ORDER[(ORDER.indexOf(lang) + 1) % ORDER.length];
        b.textContent = LABEL[nx];
        b.setAttribute('aria-label', NAME[nx]); b.setAttribute('title', NAME[nx]);
        b.setAttribute('lang', nx);
    }
    function apply() {
        var h = document.documentElement;
        h.setAttribute('lang', lang); h.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        if (mo) mo.disconnect();
        busy = true; walk(document.body); busy = false;
        observe();
        paintBtn();
        try { document.dispatchEvent(new CustomEvent('langchange', { detail: lang })); } catch (e) { /* */ }
    }
    function set(l) {
        if (ORDER.indexOf(l) < 0 || l === lang) return;
        lang = l;
        try { localStorage.setItem('chess-lang', l); } catch (e) { /* */ }
        apply();
    }
    document.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('#lang-btn')) set(ORDER[(ORDER.indexOf(lang) + 1) % ORDER.length]);
    });
    function start() { apply(); }
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
    window.Lang = { get: function () { return lang; }, set: set, t: function (s) { return conv(s, lang); } };
})();
