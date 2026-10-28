(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var KEY = '';
  try { KEY = sessionStorage.getItem('adm') || ''; } catch (e) { /* */ }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function say(t) { $('msg').textContent = t || ''; }
  function api(name, body, raw) {
    return fetch('/admin/api/' + name, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': KEY }, body: JSON.stringify(body || {}) })
      .then(function (r) {
        if (r.status === 404 && name !== 'backup-get') throw new Error('مفتاح خاطئ أو الإدارة غير مفعّلة');
        return raw ? r : r.json();
      });
  }
  function ago(t) {
    if (!t) return '—';
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'الآن';
    if (m < 60) return 'قبل ' + m + ' د';
    if (m < 1440) return 'قبل ' + Math.round(m / 60) + ' س';
    return 'قبل ' + Math.round(m / 1440) + ' يوم';
  }
  function confirmDo(t, fn) { if (window.confirm(t)) fn(); }

  function loadStats() {
    return api('stats').then(function (s) {
      var items = [['متصلون الآن', s.online], ['حسابات', s.accounts], ['نشطون 24س', s.active24h], ['جدد 24س', s.new24h], ['غرف', s.rooms], ['أندية', s.clubs], ['بطولات', s.tourneys], ['موقوفون', s.banned], ['التخزين', s.storage === 'mongodb' ? 'MongoDB' : 'ملف'], ['تشغيل (د)', s.uptimeMin]];
      $('stats').innerHTML = items.map(function (x) { return '<div class="stat"><b>' + esc(x[1]) + '</b><span>' + x[0] + '</span></div>'; }).join('');
    });
  }
  function loadReports() {
    return api('reports').then(function (r) {
      var h = '';
      if (r.flagged && r.flagged.length) {
        h += '<table><tr><th>لاعب مُبلَّغ عنه</th><th>علامات</th><th>بلاغات</th><th></th></tr>' + r.flagged.map(function (f) {
          return '<tr><td>' + esc(f.user) + (f.muted ? '<span class="tag red">مكتوم</span>' : '') + '</td><td>' + esc(f.flags) + '</td><td>' + esc(f.reports) + '</td><td><button data-a="mute" data-u="' + esc(f.user) + '" data-h="24">كتم 24س</button> <button class="danger" data-a="ban" data-u="' + esc(f.user) + '">حظر</button></td></tr>';
        }).join('') + '</table>';
      }
      h += '<h2 style="margin-top:12px">آخر البلاغات</h2>';
      h += r.reports.length ? '<table><tr><th>الوقت</th><th>من</th><th>ضد</th><th>السبب</th></tr>' + r.reports.map(function (x) {
        return '<tr><td>' + ago(x.t) + '</td><td>' + esc(x.by) + '</td><td>' + esc(x.to) + ' <button data-a="mute" data-u="' + esc(x.to) + '" data-h="24">كتم</button> <button class="danger" data-a="ban" data-u="' + esc(x.to) + '">حظر</button></td><td>' + esc(x.why) + '</td></tr>';
      }).join('') + '</table>' : '<div class="msg">لا توجد بلاغات 👌</div>';
      $('reports').innerHTML = h;
    });
  }
  function userRows(rows) {
    if (!rows.length) return '<div class="msg">لا نتائج.</div>';
    return '<table><tr><th>المستخدم</th><th>آخر ظهور</th><th>مباريات</th><th>أعلى تصنيف</th><th>نادٍ</th><th></th></tr>' + rows.map(function (u) {
      return '<tr><td>' + esc(u.user) + (u.online ? '<span class="tag green">متصل</span>' : '') + (u.muted ? '<span class="tag red">مكتوم</span>' : '') + (u.banned ? '<span class="tag red">محظور</span>' : '') + '</td><td>' + ago(u.last) + '</td><td>' + u.games + '</td><td>' + u.best + '</td><td>' + esc(u.club || '—') + '</td><td>' +
        (u.muted ? '<button class="good" data-a="mute" data-u="' + esc(u.user) + '" data-h="0">فك الكتم</button> ' : '<button data-a="mute" data-u="' + esc(u.user) + '" data-h="24">كتم 24س</button> ') +
        (u.banned ? '<button class="good" data-a="unban" data-u="' + esc(u.user) + '">فك الحظر</button> ' : '<button class="danger" data-a="ban" data-u="' + esc(u.user) + '">حظر</button> ') +
        '<button data-a="pw" data-u="' + esc(u.user) + '">كلمة مرور</button></td></tr>';
    }).join('') + '</table>';
  }
  function search() { return api('users', { q: $('q').value }).then(function (r) { $('users').innerHTML = userRows(r.rows) + '<div class="msg">' + r.total + ' حسابًا' + (r.total > 25 ? ' (يظهر 25 فقط، ضيّق البحث)' : '') + '</div>'; }); }
  function loadClubs() {
    return api('clubs').then(function (r) {
      $('clubs').innerHTML = r.rows.length ? '<table><tr><th>النادي</th><th>الأعضاء</th><th>المالك</th><th></th></tr>' + r.rows.map(function (c) {
        return '<tr><td>' + esc(c.name) + '</td><td>' + c.count + '</td><td>' + esc(c.owner) + '</td><td><button class="danger" data-a="delclub" data-id="' + esc(c.id) + '" data-n="' + esc(c.name) + '">حذف</button></td></tr>';
      }).join('') + '</table>' : '<div class="msg">لا أندية.</div>';
    });
  }
  function loadBackups() {
    return api('backups').then(function (r) {
      $('backups').innerHTML = r.days && r.days.length ? r.days.map(function (d) { return '<button data-a="bk" data-d="' + esc(d) + '" style="margin:6px 0 0 6px">' + esc(d) + '</button>'; }).join('') : '<div class="msg">لا نسخ بعد.</div>';
    });
  }
  function download(day) {
    api('backup-get', { day: day }, true).then(function (r) {
      if (!r.ok) return say('لا توجد نسخة.');
      return r.blob().then(function (b) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = 'chess-backup-' + (day || 'now') + '.json';
        document.body.appendChild(a); a.click(); a.remove();
      });
    }).catch(function (e) { say(e.message); });
  }
  function all() { return Promise.all([loadStats(), loadReports(), search(), loadClubs(), loadBackups()]); }

  function enter() {
    all().then(function () {
      $('login').classList.add('hidden');
      $('main').classList.remove('hidden');
      try { sessionStorage.setItem('adm', KEY); } catch (e) { /* */ }
    }).catch(function (e) { $('lmsg').textContent = e.message; KEY = ''; });
  }
  $('go').onclick = function () { KEY = $('key').value.trim(); if (KEY) enter(); };
  $('key').onkeydown = function (e) { if (e.key === 'Enter') $('go').click(); };
  $('refresh').onclick = function () { all().then(function () { say('تم التحديث.'); }); };
  $('search').onclick = search;
  $('q').onkeydown = function (e) { if (e.key === 'Enter') search(); };
  $('bknow').onclick = function () { api('backup-now').then(function (r) { say(r.ok ? 'تم حفظ نسخة.' : 'فشل النسخ.'); loadBackups(); }); };
  $('bkcur').onclick = function () { download(''); };
  $('out').onclick = function () { try { sessionStorage.removeItem('adm'); } catch (e) { /* */ } location.reload(); };

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button[data-a]');
    if (!b) return;
    var a = b.dataset.a, u = b.dataset.u;
    var done = function (t) { return function (r) { say(r && r.ok === false ? (r.error || 'فشل') : t); all(); }; };
    var fail = function (er) { say(er.message); };
    if (a === 'mute') api('mute', { user: u, hours: Number(b.dataset.h) }).then(done(Number(b.dataset.h) ? 'تم كتم ' + u : 'فُكّ الكتم عن ' + u)).catch(fail);
    else if (a === 'ban') confirmDo('حظر ' + u + ' وطرده الآن؟', function () { api('ban', { user: u, on: true }).then(done('تم حظر ' + u)).catch(fail); });
    else if (a === 'unban') api('ban', { user: u, on: false }).then(done('فُكّ الحظر عن ' + u)).catch(fail);
    else if (a === 'pw') {
      var pw = window.prompt('كلمة مرور مؤقتة جديدة لـ ' + u + ' (6 أحرف على الأقل). أعطها للاعب ليغيّرها.');
      if (pw) api('resetpw', { user: u, password: pw }).then(done('تم تعيين كلمة المرور')).catch(fail);
    } else if (a === 'delclub') confirmDo('حذف النادي «' + b.dataset.n + '» وبطولاته نهائيًا؟', function () { api('club-delete', { id: b.dataset.id }).then(done('تم حذف النادي')).catch(fail); });
    else if (a === 'bk') download(b.dataset.d);
  });

  if (KEY) enter();
})();
