/* CareerPrep: placement portal for IBS Jaipur (version 2: roles and selection rounds).
   Plain JavaScript, no build step. Everything typed by users is written with textContent (via h()),
   never as HTML. Access rules live in the database (row-level security); this file only shows
   people what they are allowed to see. */
(function () {
  'use strict';

  var cfg = window.CAREERPREP_CONFIG;
  var DOMAINS = cfg.studentDomains || [];
  var DOMAIN_TEXT = DOMAINS.map(function (d) { return '@' + d; }).join(' or ');
  var sb = window.supabase.createClient(cfg.url, cfg.key);
  var app = document.getElementById('app');
  var nav = document.getElementById('nav');
  var bandEl = document.getElementById('band');
  var noticeEl = document.getElementById('notice');
  var session = null, me = null, flash = null, uid = 0, lastHash = null;
  var BASE = location.origin + '/ibsj/careerprep/';

  var ROLE = {
    student: 'Student', mentor: 'Mentor', placement_manager: 'Placement Manager', deputy_pco: 'Deputy PCO', pco: 'PCO',
    maintenance: 'Maintenance', manager: 'Manager', inactive: 'No access'
  };
  var PLACEMENT = ['placement_manager', 'deputy_pco', 'pco', 'maintenance', 'manager'];
  var HEADS = ['deputy_pco', 'pco', 'manager'];
  var GRANTS = {
    manager: ['pco', 'deputy_pco', 'placement_manager', 'mentor', 'maintenance', 'manager'],
    pco: ['deputy_pco', 'placement_manager', 'mentor'],
    deputy_pco: ['placement_manager', 'mentor']
  };
  var FIELD_TYPES = {
    short_text: 'Short answer', long_text: 'Paragraph', number: 'Number', email: 'Email address', phone: 'Phone number',
    date: 'Date', url: 'Link (URL)', single: 'One choice from a list', multi: 'Several choices from a list', yes_no: 'Yes or No'
  };
  var QUICK = [
    { label: 'CGPA (10-point scale)', type: 'number', required: true },
    { label: 'Class 10 percentage', type: 'number', required: true },
    { label: 'Class 12 percentage', type: 'number', required: true },
    { label: 'Graduation percentage', type: 'number', required: true },
    { label: 'Work experience (months)', type: 'number', required: true },
    { label: 'Any active backlogs?', type: 'yes_no', required: true },
    { label: 'Willing to relocate?', type: 'yes_no', required: true },
    { label: 'Preferred job locations', type: 'short_text' },
    { label: 'Why are you interested in this role?', type: 'long_text', required: true },
    { label: 'LinkedIn profile', type: 'url' }
  ];
  var QUICK_ROUNDS = ['Resume shortlisting', 'Aptitude test', 'Group discussion', 'Case study', 'Technical interview', 'HR interview', 'Final interview'];
  var RESULT = { in_process: ['In process', ''], selected: ['Selected', 'good'], not_cleared: ['Not cleared', 'bad'] };
  var ACTION = { clear: 'Cleared', not_clear: 'Not cleared', select: 'Selected', reopen: 'Reopened', back: 'Moved back a round' };
  var STATE = {
    draft: ['Draft', 'draft'], upcoming: ['Opens soon', 'warn'], open: ['Open', 'good'],
    closed: ['Closed, download pending', 'bad'], exported: ['Downloaded, ready to clear', 'warn'], archived: ['Cleared', 'draft']
  };
  var PROGRAMMES = ['MBA', 'BBA', 'PhD', 'Other'];

  // ---------- small helpers ----------
  function h(tag, attrs) {
    var e = document.createElement(tag), k, v, i, kid;
    for (k in (attrs || {})) {
      v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'required' || k === 'selected' || k === 'multiple') e[k] = !!v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (i = 2; i < arguments.length; i++) {
      kid = arguments[i];
      if (Array.isArray(kid)) kid.forEach(add); else add(kid);
    }
    function add(c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) { c.forEach(add); return; }
      e.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return e;
  }
  function notice(msg, kind) {
    noticeEl.replaceChildren();
    if (msg) noticeEl.appendChild(h('div', { class: kind || 'ok' }, msg));
  }
  function friendly(e) {
    var m = (e && (e.message || e.error_description)) || String(e);
    if (/Database error saving new user/i.test(m)) return 'Please sign up with your ' + DOMAIN_TEXT + ' email address. Team members use the address they were invited with.';
    if (/Invalid login credentials/i.test(m)) return 'That email and password do not match. Please try again, or reset your password.';
    if (/Email not confirmed/i.test(m)) return 'Please confirm your email first: open the link we sent to your inbox.';
    if (/row-level security|permission denied/i.test(m)) return 'You do not have permission to do that.';
    if (/mime type|invalid_mime/i.test(m)) return 'Please upload a PDF file.';
    if (/exceeded the maximum allowed size|Payload too large/i.test(m)) return 'That file is too large.';
    return m;
  }
  function fail(e) { notice(friendly(e), 'err'); window.scrollTo(0, 0); }
  function ok(res) { if (res.error) throw res.error; return res.data; }
  function band(label, title, sub, extra, big) {
    return h('div', { class: 'band' + (big ? ' big' : '') }, h('div', { class: 'wrap' },
      label ? h('p', { class: 'label' }, label) : null, h('h1', null, title),
      sub ? h('p', { class: 'sub' }, sub) : null, extra || null));
  }
  function show(bandNode) {
    bandEl.replaceChildren();
    if (bandNode) bandEl.appendChild(bandNode);
    var kids = Array.prototype.slice.call(arguments, 1).filter(function (n) { return n != null && n !== false; });
    app.replaceChildren.apply(app, kids);
    window.scrollTo(0, 0);
  }
  function field(label, input, hint, required) {
    input.id = input.id || ('f' + (++uid));
    return h('div', null, h('label', { for: input.id }, label, required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null),
      input, hint ? h('p', { class: 'hint' }, hint) : null);
  }
  function inp(attrs) { return h('input', Object.assign({ type: 'text' }, attrs || {})); }
  function sel(options, value, attrs) {
    var s = h('select', attrs || {});
    Object.keys(options).forEach(function (k) { s.appendChild(h('option', { value: k, selected: k === value }, options[k])); });
    return s;
  }
  async function busy(btn, fn) {
    var t = btn.textContent; btn.disabled = true; btn.textContent = 'Please wait…';
    try { await fn(); } catch (e) { fail(e); } finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = t; } }
  }
  function go(hash, msg) { flash = msg || null; if (location.hash === hash) render(); else location.hash = hash; }
  function tag(map, key) { var s = map[key] || [key, '']; return h('span', { class: 'tag ' + s[1] }, s[0]); }
  function chip(text, kind) { return h('span', { class: 'tag ' + (kind || '') }, text); }
  var IST = { timeZone: 'Asia/Kolkata' };
  function when(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-IN', Object.assign({ day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }, IST));
  }
  function day(iso) { return iso ? new Date(iso).toLocaleDateString('en-IN', Object.assign({ day: 'numeric', month: 'short', year: 'numeric' }, IST)) : ''; }
  function toLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function left(iso) {
    var ms = new Date(iso) - Date.now();
    if (ms <= 0) return 'closed';
    var hrs = Math.floor(ms / 3600000);
    if (hrs < 1) return 'closes in under an hour';
    if (hrs < 48) return 'closes in ' + hrs + ' hours';
    return 'closes in ' + Math.floor(hrs / 24) + ' days';
  }
  function jobState(j) {
    if (j.archived_at) return 'archived';
    if (!j.published) return 'draft';
    var now = Date.now();
    if (now < new Date(j.opens_at)) return 'upcoming';
    if (now < new Date(j.closes_at)) return 'open';
    return j.exported_at ? 'exported' : 'closed';
  }
  function role() { return me ? me.role : null; }
  function isPlacement() { return PLACEMENT.indexOf(role()) >= 0; }
  function isHead() { return HEADS.indexOf(role()) >= 0; }
  function isMentor() { return role() === 'mentor'; }
  function isStudent() { return role() === 'student'; }
  function canPost() { return ['placement_manager', 'deputy_pco', 'pco', 'manager'].indexOf(role()) >= 0; }
  function canManage(j) { return isHead() || (role() === 'placement_manager' && j && j.owner_id === me.id); }
  function grantable() { return GRANTS[role()] || []; }
  function profileComplete(p) { return !!(p && p.full_name && p.roll_no && p.programme && p.batch && p.phone); }
  function safe(s) { return String(s || '').normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'file'; }
  function answerText(f, v) {
    if (v == null || v === '') return '';
    if (Array.isArray(v)) return v.join('; ');
    return String(v);
  }
  function rounds(j) { return Array.isArray(j && j.rounds) ? j.rounds : []; }
  function stageText(j, a) {
    var r = rounds(j), n = r.length;
    if (a.result === 'selected') return 'Selected';
    var cur = r[Math.min(a.stage, Math.max(n - 1, 0))];
    if (a.result === 'not_cleared') return 'Not cleared' + (cur ? ' at ' + cur.name : '');
    if (!n) return 'Applied, in process';
    return 'Round ' + (Math.min(a.stage, n - 1) + 1) + ' of ' + n + ': ' + (cur ? cur.name : '');
  }
  function stageTag(j, a) { return chip(stageText(j, a), RESULT[a.result] ? RESULT[a.result][1] : ''); }
  function roundsCleared(j, a) { return a.result === 'selected' ? rounds(j).length : Math.min(a.stage, rounds(j).length); }
  // The round-by-round tracker students, mentors and the placement team see.
  function tracker(j, a) {
    var r = rounds(j);
    var items = r.map(function (round, i) {
      var st;
      if (a.result === 'selected' || i < a.stage) st = ['done', 'Cleared'];
      else if (i === a.stage) st = a.result === 'not_cleared' ? ['stop', 'Not cleared'] : ['now', 'In progress'];
      else st = ['next', a.result === 'not_cleared' ? '' : 'Upcoming'];
      return h('li', { class: 'tr-' + st[0] }, h('span', { class: 'dot', 'aria-hidden': 'true' }, st[0] === 'done' ? '✓' : st[0] === 'stop' ? '✕' : String(i + 1)),
        h('div', null, h('strong', null, round.name), round.note ? h('span', { class: 'hint' }, round.note) : null, st[1] ? h('span', { class: 'st' }, st[1]) : null));
    });
    items.push(h('li', { class: a.result === 'selected' ? 'tr-done tr-final' : 'tr-next' }, h('span', { class: 'dot', 'aria-hidden': 'true' }, '★'),
      h('div', null, h('strong', null, 'Selected'), a.result === 'selected' ? h('span', { class: 'st' }, 'Congratulations') : null)));
    return h('ol', { class: 'tracker', 'aria-label': 'Selection rounds' }, items);
  }
  function historyList(a) {
    var hs = Array.isArray(a.history) ? a.history : [];
    if (!hs.length) return h('p', { class: 'hint' }, 'No round updates yet.');
    return h('ul', { class: 'hist' }, hs.slice().reverse().map(function (x) {
      return h('li', null, h('strong', null, (ACTION[x.action] || x.action) + (x.round ? ': ' + x.round : '')), ' · ' + when(x.at) + (x.by ? ' · ' + x.by : ''), x.note ? h('div', { class: 'hint' }, x.note) : null);
    }));
  }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      if (document.querySelector('script[data-src="' + src + '"]')) return res();
      var s = h('script', { src: src, 'data-src': src }); s.onload = function () { res(); }; s.onerror = function () { rej(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function libs() { return Promise.all(['vendor/jszip.min.js', 'vendor/xlsx.mini.min.js', 'vendor/jspdf.umd.min.js'].map(loadScript)); }
  function saveBlob(blob, name) {
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
  }
  async function openFile(bucket, path) {
    var r = ok(await sb.storage.from(bucket).createSignedUrl(path, 300));
    window.open(r.signedUrl, '_blank', 'noopener');
  }
  function byId(list) { var o = {}; list.forEach(function (x) { o[x.id] = x; }); return o; }

  // ---------- session ----------
  async function loadMe() {
    me = null;
    if (!session) return;
    var r = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    me = r.data || null;
  }
  function drawNav() {
    nav.replaceChildren();
    var here = location.hash || '#/';
    function link(href, text) { return h('a', { href: href, class: here === href ? 'on' : null }, text); }
    if (!session) {
      nav.append(link('#/signin', 'Sign in'), link('#/signup', 'Create account'));
      return;
    }
    if (isPlacement()) {
      nav.append(link('#/', 'Jobs'));
      if (canPost()) nav.append(link('#/manage/new', 'Post a job'));
      if (isHead()) nav.append(link('#/mentors', 'Mentors'));
      if (grantable().length || isPlacement()) nav.append(link('#/team', 'Team'));
      nav.append(link('#/archive', 'Archives'));
    } else if (isMentor()) {
      nav.append(link('#/', 'My mentees'));
    } else if (isStudent()) {
      nav.append(link('#/', 'Opportunities'), link('#/my', 'My applications'));
    }
    if (me && me.role !== 'inactive') nav.append(link('#/profile', 'Profile'));
    if (me) nav.append(h('span', { class: 'who' }, ROLE[me.role]));
    nav.append(h('button', { type: 'button', onclick: async function () { await sb.auth.signOut(); go('#/signin', 'You are signed out.'); } }, 'Sign out'));
  }

  // ---------- router ----------
  var routes = [
    [/^#\/?$/, home],
    [/^#\/signin$/, signInView], [/^#\/signup$/, signUpView], [/^#\/reset$/, resetView], [/^#\/newpass$/, newPassView],
    [/^#\/profile$/, profileView],
    [/^#\/job\/([0-9a-f-]{36})$/, jobView], [/^#\/apply\/([0-9a-f-]{36})$/, applyView], [/^#\/my$/, myView],
    [/^#\/student\/([0-9a-f-]{36})$/, studentDetailView],
    [/^#\/manage\/new$/, function () { return editJobView(null); }],
    [/^#\/manage\/edit\/([0-9a-f-]{36})$/, editJobView],
    [/^#\/manage\/job\/([0-9a-f-]{36})$/, jobAdminView],
    [/^#\/mentors$/, mentorsView], [/^#\/archive$/, archiveView], [/^#\/team$/, teamView]
  ];
  var PUBLIC = /^#\/(signin|signup|reset|newpass)?$/;
  async function render() {
    var hash = location.hash || '#/';
    if (/^#(access_token|error|type=)/.test(hash)) return; // Supabase is reading a sign-in link
    if (flash || hash !== lastHash) notice(flash && flash.replace(/^!/, ''), flash && flash.indexOf('!') === 0 ? 'err' : 'ok');
    flash = null; lastHash = hash;
    if (session && !me) await loadMe();
    drawNav();
    if (!session && !PUBLIC.test(hash)) { return go('#/signin', 'Please sign in to continue.'); }
    if (session && me && me.role === 'inactive' && hash !== '#/') return go('#/');
    for (var i = 0; i < routes.length; i++) {
      var m = hash.match(routes[i][0]);
      if (m) {
        try { await routes[i][1](m[1]); } catch (e) { fail(e); }
        app.focus({ preventScroll: true });
        return;
      }
    }
    show(band('', 'Page not found'), h('p', null, h('a', { href: '#/' }, 'Go to the home page')));
  }
  window.addEventListener('hashchange', render);

  // ---------- home ----------
  async function home() {
    if (!session) return welcome();
    if (!me) return show(band('CareerPrep', 'Setting up your account'), h('p', null, 'Please refresh the page in a moment.'));
    if (me.role === 'inactive') return show(band('CareerPrep', 'Your access has ended'), h('div', { class: 'card' }, 'Your placement-team access has been removed. If you think this is a mistake, please contact the Placement Office.'));
    if (isPlacement()) return manageView();
    if (isMentor()) return menteesView();
    return studentHome();
  }
  function welcome() {
    show(h('div', { class: 'band big' }, h('div', { class: 'wrap' },
      h('p', { class: 'label' }, 'ICFAI Business School Jaipur · Placement Cell'),
      h('h1', null, 'CareerPrep'),
      h('p', { class: 'tagline' }, 'Find the role that fits you, and follow every round of your selection.'),
      h('ul', { class: 'facts' }, h('li', null, 'Sign up with your ' + DOMAIN_TEXT + ' email'), h('li', null, 'One profile for every application'), h('li', null, 'Round-by-round status')),
      h('div', { class: 'row', style: 'margin-top:26px' }, h('a', { class: 'btn', href: '#/signup' }, 'Create your account'), h('a', { class: 'btn alt', href: '#/signin' }, 'Sign in')))),
      h('div', { class: 'head' }, h('div', null, h('p', { class: 'label' }, 'How it works'), h('h2', null, 'Four steps to every opportunity'))),
      h('ol', { class: 'steps' },
        h('li', null, h('strong', null, 'Create your account'), h('span', null, 'Use your institute email address and confirm it from your inbox.')),
        h('li', null, h('strong', null, 'Complete your profile once'), h('span', null, 'Name, roll number, programme, batch and phone. They are added to every application for you.')),
        h('li', null, h('strong', null, 'Apply to the openings you want'), h('span', null, 'Read the job description, answer the company’s questions and upload your resume as a PDF.')),
        h('li', null, h('strong', null, 'Follow each round'), h('span', null, 'See which rounds you have cleared and which comes next. Your mentor can follow your progress too.'))),
      h('p', { class: 'muted small', style: 'margin-top:18px' }, 'Placement team members and mentors are invited by the Placement Office and sign in with the address they were invited with.'));
  }

  async function studentHome() {
    var jobs = ok(await sb.from('jobs').select('*').order('closes_at'));
    var mine = ok(await sb.from('applications').select('*'));
    var applied = {}; mine.forEach(function (a) { applied[a.job_id] = a; });
    var open = jobs.filter(function (j) { var s = jobState(j); return s === 'open' || s === 'upcoming'; });
    var past = jobs.filter(function (j) { var s = jobState(j); return (s === 'closed' || s === 'exported') && applied[j.id]; });
    var first = (me.full_name || '').split(' ')[0];
    show(band('Placement opportunities', first ? 'Hello, ' + first : 'Welcome', open.length ? open.length + ' opening' + (open.length === 1 ? ' is' : 's are') + ' waiting for you.' : 'New openings appear here as soon as the placement team posts them.'),
      !profileComplete(me) ? h('div', { class: 'note', style: 'margin-bottom:18px' }, h('strong', null, 'Complete your profile before you apply. '), 'It takes a minute, and is added to every application. ', h('a', { href: '#/profile' }, 'Complete my profile')) : null,
      open.length ? h('ul', { class: 'jobs' }, open.map(function (j) { return jobCard(j, applied[j.id]); })) : h('div', { class: 'empty' }, 'No openings right now. Please check back soon.'),
      past.length ? h('div', { style: 'margin-top:30px' }, h('h2', { style: 'margin-bottom:14px' }, 'Selection in progress'), h('ul', { class: 'jobs' }, past.map(function (j) { return jobCard(j, applied[j.id]); }))) : null);
  }
  function jobCard(j, mine) {
    var st = jobState(j), soon = st === 'open' && (new Date(j.closes_at) - Date.now()) < 48 * 3600000;
    return h('li', { class: 'job' + (soon ? ' soon' : '') },
      h('span', { class: 'co' }, j.company_name), h('h3', null, j.title),
      h('div', { class: 'meta' }, h('span', null, j.job_type), j.location ? h('span', null, j.location) : null, j.ctc ? h('span', null, j.ctc) : null),
      h('div', { class: 'meta' }, st === 'upcoming' ? h('span', null, 'Opens ' + when(j.opens_at)) : h('span', null, (st === 'open' ? 'Closes ' : 'Closed ') + when(j.closes_at) + (st === 'open' ? ' (' + left(j.closes_at) + ')' : '')),
        rounds(j).length ? h('span', null, rounds(j).length + ' round' + (rounds(j).length === 1 ? '' : 's')) : null),
      h('div', { class: 'go' }, h('a', { class: 'btn tiny indigo', href: '#/job/' + j.id }, mine ? 'View' : 'View and apply'),
        mine ? stageTag(j, mine) : null, st !== 'open' && !mine ? tag(STATE, st) : null));
  }

  // ---------- account ----------
  function authBand(title, sub) { return band('CareerPrep account', title, sub); }
  function signInView() {
    if (session) return go('#/');
    var email = inp({ type: 'email', autocomplete: 'email', required: true }), pw = inp({ type: 'password', autocomplete: 'current-password', required: true });
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Sign in');
    show(authBand('Sign in', 'Students use their ' + DOMAIN_TEXT + ' email. Team members and mentors use the address they were invited with.'),
      h('form', { class: 'card auth stack', onsubmit: function (e) {
        e.preventDefault();
        busy(btn, async function () {
          ok(await sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value }));
          go('#/', 'Signed in. Welcome back.');
        });
      } }, field('Email', email, null, true), field('Password', pw, null, true), btn,
        h('p', { class: 'small' }, h('a', { href: '#/reset' }, 'Forgot your password?'), ' · New here? ', h('a', { href: '#/signup' }, 'Create an account'))));
  }
  function signUpView() {
    if (session) return go('#/');
    var name = inp({ autocomplete: 'name', required: true }), email = inp({ type: 'email', autocomplete: 'email', required: true });
    var pw = inp({ type: 'password', autocomplete: 'new-password', minlength: '8', required: true });
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Create account');
    show(authBand('Create your account', 'Students register with their ' + DOMAIN_TEXT + ' address. Invited team members and mentors register with the address they were invited with.'),
      h('form', { class: 'card auth stack', onsubmit: function (e) {
        e.preventDefault();
        var em = email.value.trim().toLowerCase();
        if (!/@/.test(em)) return fail('Please enter your email address.');
        busy(btn, async function () {
          var r = ok(await sb.auth.signUp({ email: em, password: pw.value, options: { data: { full_name: name.value.trim() }, emailRedirectTo: BASE } }));
          if (r.session) go('#/profile', 'Account created. Please complete your profile.');
          else show(authBand('Check your inbox', ''), h('div', { class: 'card auth' }, h('p', null, 'We have sent a confirmation link to ' + em + '. Open it to activate your account, then sign in.'), h('p', { class: 'hint' }, 'No email after a few minutes? Check the spam folder.')));
        });
      } }, field('Full name', name, null, true), field('Email', email, 'Students: firstname.lastname' + (DOMAINS[0] ? '@' + DOMAINS[0] : ''), true),
        field('Password', pw, 'At least 8 characters.', true), btn,
        h('p', { class: 'small' }, 'Already registered? ', h('a', { href: '#/signin' }, 'Sign in'))));
  }
  function resetView() {
    var email = inp({ type: 'email', autocomplete: 'email', required: true }), btn = h('button', { class: 'btn', type: 'submit' }, 'Send reset link');
    show(authBand('Reset your password', 'We will email you a link to choose a new password.'),
      h('form', { class: 'card auth stack', onsubmit: function (e) {
        e.preventDefault();
        busy(btn, async function () {
          ok(await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: BASE }));
          notice('If an account exists for that address, a reset link is on its way.');
        });
      } }, field('Email', email, null, true), btn));
  }
  function newPassView() {
    if (!session) return go('#/reset', '!The reset link has expired. Please ask for a new one.');
    var pw = inp({ type: 'password', autocomplete: 'new-password', minlength: '8', required: true }), btn = h('button', { class: 'btn', type: 'submit' }, 'Save new password');
    show(authBand('Choose a new password', ''),
      h('form', { class: 'card auth stack', onsubmit: function (e) {
        e.preventDefault();
        busy(btn, async function () { ok(await sb.auth.updateUser({ password: pw.value })); go('#/', 'Your password has been changed.'); });
      } }, field('New password', pw, 'At least 8 characters.', true), btn));
  }

  async function profileView() {
    await loadMe();
    var p = me || {}, student = isStudent();
    var mentor = null;
    if (student) {
      var link = ok(await sb.from('mentor_assignments').select('mentor_id').eq('student_id', p.id).maybeSingle());
      if (link) mentor = ok(await sb.from('profiles').select('full_name,email,phone,department').eq('id', link.mentor_id).maybeSingle());
    }
    var f = {
      full_name: inp({ value: p.full_name, required: true, autocomplete: 'name' }),
      roll_no: inp({ value: p.roll_no, required: student }),
      programme: sel(Object.assign({ '': 'Choose your programme' }, PROGRAMMES.reduce(function (o, x) { o[x] = x; return o; }, {})), p.programme || '', { required: student }),
      batch: inp({ value: p.batch, placeholder: 'For example: 2025–27', required: student }),
      specialisation: inp({ value: p.specialisation, placeholder: 'For example: Finance and Marketing' }),
      phone: inp({ type: 'tel', value: p.phone, autocomplete: 'tel', required: student }),
      department: inp({ value: p.department, placeholder: 'For example: Finance area, Placement Office' })
    };
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Save profile');
    var fields = student
      ? [h('div', { class: 'grid2' }, field('Full name', f.full_name, 'As it should appear to recruiters.', true), field('Roll number', f.roll_no, null, true)),
         h('div', { class: 'grid3' }, field('Programme', f.programme, null, true), field('Batch', f.batch, null, true), field('Phone', f.phone, null, true)),
         field('Specialisation', f.specialisation)]
      : [h('div', { class: 'grid2' }, field('Full name', f.full_name, null, true), field('Phone', f.phone)), field('Department or area', f.department)];
    show(band('Your profile', p.full_name || 'Your profile', student ? 'These details are attached to every application you make.' : 'You are signed in as ' + ROLE[p.role] + '.'),
      h('div', { class: 'two' },
        h('form', { class: 'card stack', onsubmit: function (e) {
          e.preventDefault();
          busy(btn, async function () {
            var keys = student ? ['full_name', 'roll_no', 'programme', 'batch', 'specialisation', 'phone'] : ['full_name', 'phone', 'department'];
            var v = {}; keys.forEach(function (k) { v[k] = f[k].value.trim() || null; });
            v.full_name = v.full_name || '';
            ok(await sb.from('profiles').update(v).eq('id', me.id));
            await loadMe();
            go('#/', 'Profile saved.');
          });
        } }, field('Email', inp({ value: p.email, disabled: true }), 'Your sign-in address. It cannot be changed here.'), fields, h('div', null, btn)),
        h('div', null,
          h('div', { class: 'card accent' }, h('h3', null, 'Your role'), h('p', null, ROLE[p.role]),
            h('p', { class: 'hint', style: 'margin-top:6px' }, {
              student: 'You can apply to openings and follow your rounds.',
              mentor: 'You can follow the applications and rounds of the students assigned to you.',
              placement_manager: 'You post jobs and update the rounds of the jobs you own.',
              deputy_pco: 'You can act on every job, assign mentors and invite placement managers and mentors.',
              pco: 'You can act on every job, assign mentors and invite Deputy PCOs, placement managers and mentors.',
              maintenance: 'You can see everything for support and upkeep.',
              manager: 'You have full access and can invite anyone.'
            }[p.role] || '')),
          student ? h('div', { class: 'card' }, h('h3', null, 'Your mentor'),
            mentor ? h('dl', { class: 'kv' }, [['Name', mentor.full_name], ['Email', mentor.email], ['Phone', mentor.phone], ['Area', mentor.department]].filter(function (r) { return r[1]; }).map(function (r) { return [h('dt', null, r[0]), h('dd', null, r[1])]; }))
              : h('p', { class: 'muted' }, 'A mentor has not been assigned to you yet.')) : null)));
  }

  // ---------- job page ----------
  function jobDetails(j) {
    var rows = [['Company', j.company_name], ['Role', j.title], ['Type', j.job_type], ['Location', j.location], ['Compensation', j.ctc],
      ['Applications open', when(j.opens_at)], ['Applications close', when(j.closes_at)], ['Company website', j.company_website]];
    return h('dl', { class: 'kv' }, rows.filter(function (r) { return r[1]; }).map(function (r) {
      var v = r[0] === 'Company website' && /^https?:\/\//i.test(r[1]) ? h('a', { href: r[1], target: '_blank', rel: 'noopener' }, r[1]) : r[1];
      return [h('dt', null, r[0]), h('dd', null, v)];
    }));
  }
  function roundsCard(j) {
    var r = rounds(j);
    if (!r.length) return null;
    return h('div', { class: 'card' }, h('h3', null, 'Selection rounds'),
      h('ol', { class: 'roundlist' }, r.map(function (x) { return h('li', null, h('strong', null, x.name), x.note ? h('span', { class: 'hint' }, ' ' + x.note) : null); })),
      h('p', { class: 'hint', style: 'margin-top:8px' }, 'Only students who clear a round move on to the next. Your status updates here as each round is decided.'));
  }
  function jobSections(j) {
    return [['About the company', j.company_about], ['Job description', j.description], ['Eligibility', j.eligibility], ['Selection process', j.process], ['Other information', j.other_info]]
      .filter(function (s) { return s[1]; })
      .map(function (s) { return h('div', { class: 'card' }, h('h3', null, s[0]), h('p', { class: 'prose' }, s[1])); });
  }
  async function jobView(id) {
    var j = ok(await sb.from('jobs').select('*').eq('id', id).maybeSingle());
    if (!j) return show(band('', 'Opening not found'), h('p', null, 'This opening may have closed and been cleared. ', h('a', { href: '#/' }, 'See current openings')));
    var st = jobState(j), mine = null;
    if (isStudent()) mine = ok(await sb.from('applications').select('*').eq('job_id', id).maybeSingle());
    var action;
    if (isPlacement()) action = h('a', { class: 'btn indigo', href: '#/manage/job/' + id }, 'Manage this job');
    else if (!isStudent()) action = null;
    else if (mine && (mine.history || []).length) action = h('p', { class: 'hint' }, 'Your application is being evaluated, so it can no longer be changed.');
    else if (st === 'open') action = profileComplete(me)
      ? h('a', { class: 'btn', href: '#/apply/' + id }, mine ? 'Update my application' : 'Apply now')
      : h('a', { class: 'btn', href: '#/profile' }, 'Complete your profile to apply');
    else if (st === 'upcoming') action = h('p', null, 'Applications open on ' + when(j.opens_at) + '.');
    else action = mine ? null : h('p', null, 'Applications for this opening are closed.');
    show(band(j.company_name, j.title, [j.job_type, j.location, j.ctc].filter(Boolean).join(' · '),
      h('ul', { class: 'facts' }, h('li', null, st === 'upcoming' ? 'Opens ' + when(j.opens_at) : (st === 'open' ? 'Closes ' : 'Closed ') + when(j.closes_at)), st === 'open' ? h('li', null, left(j.closes_at)) : null,
        rounds(j).length ? h('li', null, rounds(j).length + ' selection round' + (rounds(j).length === 1 ? '' : 's')) : null)),
      h('div', { class: 'two' },
        h('div', null, jobSections(j).length ? jobSections(j) : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'The placement team will share more details soon.'))),
        h('div', null,
          isStudent() ? h('div', { class: 'card key' }, h('h3', null, mine ? 'Your application' : 'Apply'),
            mine ? [h('p', { style: 'margin-bottom:6px' }, stageTag(j, mine)), h('p', { class: 'hint', style: 'margin-bottom:12px' }, 'Submitted ' + when(mine.submitted_at)), tracker(j, mine),
              (mine.history || []).length ? h('div', { style: 'margin-top:12px' }, h('h4', { style: 'margin:0 0 6px;font-size:14px' }, 'Updates from the placement team'), historyList(mine)) : null] : null,
            action ? h('div', { style: 'margin-top:12px' }, action) : null) : (action ? h('div', { class: 'card key' }, action) : null),
          !mine ? roundsCard(j) : null,
          h('div', { class: 'card accent' }, h('h3', null, 'At a glance'), jobDetails(j),
            j.jd_file_path ? h('p', { style: 'margin-top:14px' }, h('button', { class: 'btn ghost tiny', type: 'button', onclick: function () { openFile('jobfiles', j.jd_file_path).catch(fail); } }, 'Open the job description file')) : null))));
  }

  // ---------- applying ----------
  function answerInput(f, value, disabled) {
    var id = 'q_' + f.id, el;
    if (f.type === 'long_text') el = h('textarea', { id: id, disabled: disabled }, value || '');
    else if (f.type === 'single') {
      el = h('select', { id: id, disabled: disabled }, h('option', { value: '' }, 'Choose one'),
        (f.options || []).map(function (o) { return h('option', { value: o, selected: o === value }, o); }));
    } else if (f.type === 'multi') {
      var vals = Array.isArray(value) ? value : [];
      el = h('div', { id: id, role: 'group' }, (f.options || []).map(function (o, i) {
        var cb = h('input', { type: 'checkbox', id: id + '_' + i, value: o, checked: vals.indexOf(o) >= 0, disabled: disabled });
        return h('div', { class: 'choice' }, cb, h('label', { for: id + '_' + i }, o));
      }));
      el.getValue = function () { return Array.prototype.filter.call(el.querySelectorAll('input'), function (c) { return c.checked; }).map(function (c) { return c.value; }); };
    } else if (f.type === 'yes_no') {
      el = h('div', { id: id, role: 'radiogroup' }, ['Yes', 'No'].map(function (o) {
        var r = h('input', { type: 'radio', name: id, id: id + o, value: o, checked: value === o, disabled: disabled });
        return h('div', { class: 'choice' }, r, h('label', { for: id + o }, o));
      }));
      el.getValue = function () { var c = el.querySelector('input:checked'); return c ? c.value : ''; };
    } else {
      var t = { number: 'number', email: 'email', phone: 'tel', date: 'date', url: 'url' }[f.type] || 'text';
      el = h('input', { id: id, type: t, value: value == null ? '' : value, step: t === 'number' ? 'any' : null, disabled: disabled });
    }
    if (!el.getValue) el.getValue = function () { return el.value.trim(); };
    return el;
  }
  function labelled(f, el) {
    var isGroup = f.type === 'multi' || f.type === 'yes_no';
    return h('div', null,
      isGroup ? h('p', { style: 'font-size:13.5px;font-weight:600;margin-bottom:5px' }, f.label, f.required ? h('span', { class: 'req', style: 'color:var(--red)' }, ' *') : null)
        : h('label', { for: el.id }, f.label, f.required ? h('span', { class: 'req' }, ' *') : null),
      el, f.help ? h('p', { class: 'hint' }, f.help) : null);
  }
  async function applyView(id) {
    if (!isStudent()) return go('#/job/' + id);
    if (!profileComplete(me)) return go('#/profile', '!Please complete your profile before applying.');
    var j = ok(await sb.from('jobs').select('*').eq('id', id).maybeSingle());
    if (!j) return go('#/', '!That opening is no longer available.');
    if (jobState(j) !== 'open') return go('#/job/' + id, '!Applications for this opening are not open.');
    var mine = ok(await sb.from('applications').select('*').eq('job_id', id).maybeSingle());
    if (mine && (mine.history || []).length) return go('#/job/' + id, '!Your application is being evaluated and can no longer be changed.');
    var form = Array.isArray(j.form) ? j.form : [];
    var inputs = form.map(function (f) { return { f: f, el: answerInput(f, mine && mine.answers ? mine.answers[f.id] : null) }; });
    var file = h('input', { type: 'file', accept: 'application/pdf,.pdf' });
    var agree = h('input', { type: 'checkbox', id: 'agree', checked: !!mine });
    var btn = h('button', { class: 'btn', type: 'submit' }, mine ? 'Save changes' : 'Submit application');
    var withdraw = mine ? h('button', { class: 'btn danger', type: 'button', onclick: function () {
      if (!window.confirm('Withdraw your application for ' + j.title + ' at ' + j.company_name + '? You can apply again while the opening is open.')) return;
      busy(withdraw, async function () {
        if (mine.resume_path) await sb.storage.from('resumes').remove([mine.resume_path]);
        ok(await sb.from('applications').delete().eq('id', mine.id));
        go('#/job/' + id, 'Your application has been withdrawn.');
      });
    } }, 'Withdraw application') : null;
    show(band(j.company_name, 'Apply: ' + j.title, 'Applications close ' + when(j.closes_at) + ' (' + left(j.closes_at) + '). You can edit your application until then.'),
      h('form', { class: 'stack', style: 'max-width:780px', onsubmit: function (e) {
        e.preventDefault();
        var answers = {}, missing = [];
        inputs.forEach(function (x) {
          var v = x.el.getValue();
          if (x.f.required && (v === '' || (Array.isArray(v) && !v.length))) missing.push(x.f.label);
          answers[x.f.id] = v;
        });
        var fl = file.files[0];
        if (!fl && !(mine && mine.resume_path)) missing.push('Resume (PDF)');
        if (!agree.checked) missing.push('the declaration');
        if (missing.length) return fail('Please complete: ' + missing.join(', ') + '.');
        if (fl && (fl.type !== 'application/pdf' && !/\.pdf$/i.test(fl.name))) return fail('Please upload your resume as a PDF file.');
        if (fl && fl.size > 5 * 1024 * 1024) return fail('Your resume is larger than 5 MB. Please upload a smaller PDF.');
        busy(btn, async function () {
          var v = { answers: answers };
          if (fl) {
            var path = id + '/' + me.id + '/resume.pdf';
            ok(await sb.storage.from('resumes').upload(path, fl, { upsert: true, contentType: 'application/pdf' }));
            v.resume_path = path; v.resume_name = fl.name; v.resume_size = fl.size;
          }
          if (mine) ok(await sb.from('applications').update(v).eq('id', mine.id));
          else ok(await sb.from('applications').insert(Object.assign({ job_id: id }, v)));
          go('#/job/' + id, mine ? 'Your changes are saved.' : 'Application submitted. Good luck!');
        });
      } },
        h('div', { class: 'card accent' }, h('h3', null, 'Your details'),
          h('dl', { class: 'kv' }, [['Name', me.full_name], ['Email', me.email], ['Roll number', me.roll_no], ['Programme', me.programme + ' · ' + me.batch], ['Phone', me.phone]].map(function (r) { return [h('dt', null, r[0]), h('dd', null, r[1])]; })),
          h('p', { class: 'hint', style: 'margin-top:10px' }, 'Need to change these? ', h('a', { href: '#/profile' }, 'Edit your profile'), ' first.')),
        form.length ? h('div', { class: 'card stack' }, h('h3', null, 'Questions from the company'), inputs.map(function (x) { return labelled(x.f, x.el); })) : null,
        h('div', { class: 'card stack' }, h('h3', null, 'Resume'),
          mine && mine.resume_path ? h('p', null, 'Current file: ', h('button', { class: 'btn ghost tiny', type: 'button', onclick: function () { openFile('resumes', mine.resume_path).catch(fail); } }, mine.resume_name || 'resume.pdf'), ' Choose a new file below only if you want to replace it.') : null,
          field(mine && mine.resume_path ? 'Replace resume (PDF, up to 5 MB)' : 'Upload resume (PDF, up to 5 MB)', file, null, !(mine && mine.resume_path))),
        h('div', { class: 'card' }, h('div', { class: 'choice' }, agree, h('label', { for: 'agree' }, 'I confirm that the information I have given is accurate, and I agree to share it and my resume with the placement team, my mentor and ' + j.company_name + '.'))),
        h('div', { class: 'spread' }, h('div', { class: 'row' }, btn, h('a', { class: 'btn ghost', href: '#/job/' + id }, 'Cancel')), withdraw)));
  }
  function applicationsTable(rows, opts) {
    opts = opts || {};
    if (!rows.length) return h('div', { class: 'empty' }, opts.empty || 'No applications yet.');
    var tbody = h('tbody');
    rows.forEach(function (a) {
      var j = a.jobs || {};
      var detail = h('tr', { class: 'open-row', hidden: true }, h('td', { colspan: '5' }, tracker(j, a), h('h4', { style: 'margin:12px 0 4px;font-size:14px' }, 'Updates'), historyList(a)));
      tbody.append(h('tr', null,
        h('td', null, h('strong', null, j.company_name), h('br'), j.title),
        h('td', null, stageTag(j, a)),
        h('td', { class: 'small' }, when(a.submitted_at)),
        h('td', { class: 'small' }, when(j.closes_at)),
        h('td', null, h('div', { class: 'row' },
          h('button', { class: 'btn tiny ghost', type: 'button', onclick: function () { detail.hidden = !detail.hidden; } }, 'Rounds'),
          opts.student ? h('a', { class: 'btn tiny ghost', href: '#/job/' + a.job_id }, jobState(j) === 'open' && !(a.history || []).length ? 'View or edit' : 'View') : null))), detail);
    });
    return h('div', { class: 'scroll' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'Company and role'), h('th', null, 'Where things stand'), h('th', null, 'Applied'), h('th', null, 'Applications closed'), h('th', null, ''))), tbody));
  }
  async function myView() {
    if (!isStudent()) return go('#/');
    var rows = ok(await sb.from('applications').select('*, jobs(*)').order('submitted_at', { ascending: false }));
    show(band('My applications', 'Your applications', 'Each round result appears here as soon as the placement team records it.'),
      applicationsTable(rows, { student: true, empty: 'You have not applied yet.' }),
      rows.length ? null : h('p', { style: 'margin-top:12px' }, h('a', { href: '#/' }, 'See open opportunities')));
  }

  // ---------- mentors: their mentees ----------
  async function menteeRows(studentIds) {
    if (!studentIds.length) return { profiles: [], apps: [] };
    var profiles = ok(await sb.from('profiles').select('*').in('id', studentIds).order('full_name'));
    var apps = ok(await sb.from('applications').select('*, jobs(*)').in('student_id', studentIds));
    return { profiles: profiles, apps: apps };
  }
  async function menteesView() {
    var links = ok(await sb.from('mentor_assignments').select('student_id').eq('mentor_id', me.id));
    var d = await menteeRows(links.map(function (l) { return l.student_id; }));
    var per = {}; d.apps.forEach(function (a) { (per[a.student_id] = per[a.student_id] || []).push(a); });
    var search = inp({ type: 'search', placeholder: 'Search name or roll number', 'aria-label': 'Search mentees' });
    var tbody = h('tbody');
    function draw() {
      tbody.replaceChildren();
      var q = search.value.trim().toLowerCase();
      d.profiles.filter(function (p) { return !q || [p.full_name, p.roll_no, p.email].join(' ').toLowerCase().indexOf(q) >= 0; }).forEach(function (p) {
        var list = per[p.id] || [];
        var c = { in_process: 0, selected: 0, not_cleared: 0 }; list.forEach(function (a) { c[a.result]++; });
        tbody.append(h('tr', null, h('td', null, h('strong', null, p.full_name || p.email), h('br'), h('span', { class: 'small muted' }, p.email)),
          h('td', null, p.roll_no || '', h('br'), h('span', { class: 'small muted' }, [p.programme, p.batch].filter(Boolean).join(' '))),
          h('td', null, String(list.length)), h('td', null, String(c.in_process)), h('td', null, c.selected ? chip(String(c.selected), 'good') : '0'),
          h('td', null, h('a', { class: 'btn tiny indigo', href: '#/student/' + p.id }, 'Open'))));
      });
      if (!tbody.children.length) tbody.appendChild(h('tr', null, h('td', { colspan: '6' }, h('span', { class: 'muted' }, d.profiles.length ? 'No mentees match.' : 'No students have been assigned to you yet. The PCO or Deputy PCO assigns mentees.'))));
    }
    search.addEventListener('input', draw); draw();
    var total = d.apps.length, sel = d.apps.filter(function (a) { return a.result === 'selected'; }).length;
    show(band('Mentor', 'Your mentees', 'Follow every opportunity your mentees apply for, and where they stand in each selection process.'),
      h('div', { class: 'tiles' }, h('div', { class: 'tile' }, h('b', null, String(d.profiles.length)), h('span', null, 'Mentees')),
        h('div', { class: 'tile' }, h('b', null, String(total)), h('span', null, 'Applications')),
        h('div', { class: 'tile' }, h('b', null, String(d.apps.filter(function (a) { return a.result === 'in_process'; }).length)), h('span', null, 'In process')),
        h('div', { class: 'tile' }, h('b', null, String(sel)), h('span', null, 'Selected'))),
      h('div', { class: 'card' }, h('div', { class: 'spread', style: 'margin-bottom:12px' }, h('h3', null, 'Mentees'), h('div', { style: 'min-width:240px' }, search)),
        h('div', { class: 'scroll', style: 'border:0' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Student'), h('th', null, 'Roll and programme'), h('th', null, 'Applications'), h('th', null, 'In process'), h('th', null, 'Selected'), h('th', null, ''))), tbody))));
  }
  async function studentDetailView(id) {
    if (!isPlacement() && !isMentor()) return go('#/');
    var p = ok(await sb.from('profiles').select('*').eq('id', id).maybeSingle());
    if (!p) return go('#/', '!Student not found, or not one of your mentees.');
    var apps = ok(await sb.from('applications').select('*, jobs(*)').eq('student_id', id).order('submitted_at', { ascending: false }));
    var link = ok(await sb.from('mentor_assignments').select('mentor_id').eq('student_id', id).maybeSingle());
    var mentor = link ? ok(await sb.from('profiles').select('full_name,email').eq('id', link.mentor_id).maybeSingle()) : null;
    show(band(isMentor() ? 'Mentee' : 'Student', p.full_name || p.email, [p.roll_no, p.programme, p.batch, p.specialisation].filter(Boolean).join(' · ')),
      h('div', { class: 'row', style: 'margin-bottom:16px' }, h('a', { class: 'btn ghost', href: isMentor() ? '#/' : '#/mentors' }, isMentor() ? 'All mentees' : 'Mentor assignments')),
      h('div', { class: 'card accent' }, h('dl', { class: 'kv' }, [['Email', p.email], ['Phone', p.phone], ['Mentor', mentor ? mentor.full_name + ' (' + mentor.email + ')' : 'Not assigned']].filter(function (r) { return r[1]; }).map(function (r) { return [h('dt', null, r[0]), h('dd', null, r[1])]; }))),
      h('h2', { style: 'margin:22px 0 12px' }, 'Applications'),
      applicationsTable(apps, { empty: 'No applications yet.' }));
  }

  // ---------- heads: assign mentors ----------
  async function mentorsView() {
    if (!isHead()) return go('#/');
    var mentors = ok(await sb.from('profiles').select('id,full_name,email,department').eq('role', 'mentor').order('full_name'));
    var students = ok(await sb.from('profiles').select('id,full_name,email,roll_no,programme,batch').eq('role', 'student').order('roll_no'));
    var links = ok(await sb.from('mentor_assignments').select('*'));
    var mentorOf = {}; links.forEach(function (l) { mentorOf[l.student_id] = l.mentor_id; });
    var count = {}; links.forEach(function (l) { count[l.mentor_id] = (count[l.mentor_id] || 0) + 1; });
    var opts = { '': '— No mentor —' }; mentors.forEach(function (m) { opts[m.id] = (m.full_name || m.email); });
    var search = inp({ type: 'search', placeholder: 'Search name, email or roll number', 'aria-label': 'Search students' });
    var filterOpts = { all: 'All students', none: 'Without a mentor' }; mentors.forEach(function (m) { filterOpts[m.id] = 'Mentees of ' + (m.full_name || m.email); });
    var filter = sel(filterOpts, 'all', { 'aria-label': 'Filter students' });
    var tbody = h('tbody');
    async function setMentor(sid, mid, selEl) {
      try {
        if (!mid) ok(await sb.from('mentor_assignments').delete().eq('student_id', sid));
        else ok(await sb.from('mentor_assignments').upsert({ student_id: sid, mentor_id: mid, assigned_by: me.id }));
        if (mentorOf[sid]) count[mentorOf[sid]]--; if (mid) count[mid] = (count[mid] || 0) + 1;
        mentorOf[sid] = mid || undefined; notice('Mentor updated.'); drawCounts();
      } catch (e) { fail(e); selEl.value = mentorOf[sid] || ''; }
    }
    function draw() {
      tbody.replaceChildren();
      var q = search.value.trim().toLowerCase(), f = filter.value;
      students.filter(function (s) {
        return (!q || [s.full_name, s.email, s.roll_no].join(' ').toLowerCase().indexOf(q) >= 0)
          && (f === 'all' || (f === 'none' ? !mentorOf[s.id] : mentorOf[s.id] === f));
      }).forEach(function (s) {
        var m = sel(opts, mentorOf[s.id] || '', { 'aria-label': 'Mentor for ' + (s.full_name || s.email) });
        m.addEventListener('change', function () { setMentor(s.id, m.value, m); });
        tbody.append(h('tr', null, h('td', null, h('strong', null, s.full_name || '—'), h('br'), h('span', { class: 'small muted' }, s.email)),
          h('td', null, s.roll_no || '', h('br'), h('span', { class: 'small muted' }, [s.programme, s.batch].filter(Boolean).join(' '))),
          h('td', null, m), h('td', null, h('a', { class: 'btn tiny ghost', href: '#/student/' + s.id }, 'Applications'))));
      });
      if (!tbody.children.length) tbody.appendChild(h('tr', null, h('td', { colspan: '4' }, h('span', { class: 'muted' }, students.length ? 'No students match.' : 'No students have registered yet.'))));
    }
    var counts = h('div', { class: 'row' });
    function drawCounts() {
      counts.replaceChildren.apply(counts, mentors.length ? mentors.map(function (m) { return chip((m.full_name || m.email) + ': ' + (count[m.id] || 0)); }) : [h('span', { class: 'muted' }, 'No mentors yet. Invite them from the Team page.')]);
    }
    search.addEventListener('input', draw); filter.addEventListener('change', draw); draw(); drawCounts();
    // bulk assignment by roll numbers or emails
    var bulkMentor = sel(opts, '', { 'aria-label': 'Mentor for the list' });
    var bulkList = h('textarea', { placeholder: 'One roll number or email per line', style: 'min-height:110px' });
    var bulkBtn = h('button', { class: 'btn indigo', type: 'button', onclick: function () {
      if (!bulkMentor.value) return fail('Choose a mentor first.');
      var keys = bulkList.value.split(/[\n,;]+/).map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
      var found = students.filter(function (s) { return keys.indexOf((s.roll_no || '').toLowerCase()) >= 0 || keys.indexOf((s.email || '').toLowerCase()) >= 0; });
      var missing = keys.filter(function (k) { return !found.some(function (s) { return (s.roll_no || '').toLowerCase() === k || s.email === k; }); });
      if (!found.length) return fail('None of those roll numbers or emails belong to a registered student.');
      busy(bulkBtn, async function () {
        ok(await sb.from('mentor_assignments').upsert(found.map(function (s) { return { student_id: s.id, mentor_id: bulkMentor.value, assigned_by: me.id }; })));
        go('#/mentors', found.length + ' student' + (found.length === 1 ? '' : 's') + ' assigned.' + (missing.length ? ' Not found: ' + missing.join(', ') + '.' : ''));
      });
    } }, 'Assign these students');
    show(band('PCO office', 'Mentor assignments', 'Each student can have one mentor. Mentors see their mentees’ applications and round status, read-only.'),
      h('div', { class: 'card accent' }, h('h3', null, 'Mentees per mentor'), counts),
      h('div', { class: 'two' },
        h('div', { class: 'card' }, h('div', { class: 'spread', style: 'margin-bottom:12px' }, h('h3', null, 'Students'), h('div', { class: 'row' }, h('div', { style: 'min-width:220px' }, search), filter)),
          h('div', { class: 'scroll', style: 'border:0' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Student'), h('th', null, 'Roll and programme'), h('th', null, 'Mentor'), h('th', null, ''))), tbody))),
        h('div', { class: 'card stack' }, h('h3', null, 'Assign a list'), field('Mentor', bulkMentor), field('Roll numbers or emails', bulkList, 'Paste from Excel: one per line.'), h('div', null, bulkBtn))));
  }

  // ---------- placement team: jobs overview ----------
  async function teamNames() {
    var staff = ok(await sb.from('profiles').select('id,full_name,email,role').in('role', ['placement_manager', 'deputy_pco', 'pco', 'manager']));
    return byId(staff);
  }
  async function manageView() {
    var jobs = ok(await sb.from('jobs').select('*').order('closes_at', { ascending: false }));
    var apps = ok(await sb.from('applications').select('job_id,result'));
    var names = await teamNames();
    var count = {}; apps.forEach(function (a) { count[a.job_id] = (count[a.job_id] || 0) + 1; });
    var groups = { open: [], upcoming: [], draft: [], closed: [], exported: [], archived: [] };
    jobs.forEach(function (j) { groups[jobState(j)].push(j); });
    var mineOnly = role() === 'placement_manager';
    function list(title, items, hint) {
      if (!items.length) return null;
      return h('div', { style: 'margin-bottom:26px' }, h('h2', { style: 'margin-bottom:4px' }, title), hint ? h('p', { class: 'muted small', style: 'margin-bottom:12px' }, hint) : null,
        h('div', { class: 'scroll' }, h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'Company and role'), h('th', null, 'Status'), h('th', null, 'Placement manager'), h('th', null, 'Closes'), h('th', null, 'Applications'), h('th', null, ''))),
          h('tbody', null, items.map(function (j) {
            var st = jobState(j), owner = names[j.owner_id];
            return h('tr', null, h('td', null, h('strong', null, j.company_name), h('br'), j.title), h('td', null, tag(STATE, st)),
              h('td', { class: 'small' }, owner ? (owner.id === me.id ? 'You' : owner.full_name || owner.email) : '—'), h('td', { class: 'small' }, when(j.closes_at)),
              h('td', null, st === 'archived' ? String((j.archive_summary || {}).applications || 0) + ' (cleared)' : String(count[j.id] || 0)),
              h('td', null, h('div', { class: 'row' }, h('a', { class: 'btn tiny indigo', href: '#/manage/job/' + j.id }, 'Open'),
                st !== 'archived' && canManage(j) ? h('a', { class: 'btn tiny ghost', href: '#/manage/edit/' + j.id }, 'Edit') : null)));
          })))));
    }
    var mine = jobs.filter(function (j) { return j.owner_id === me.id && !j.archived_at; });
    show(band(ROLE[role()], 'Jobs and applications', mineOnly ? 'You can see every job. You post jobs and decide rounds for the ones you own; your heads can act on all of them.' : 'Post openings, follow every selection process, and download everything once a job is complete.',
      h('div', { class: 'row', style: 'margin-top:20px' }, canPost() ? h('a', { class: 'btn', href: '#/manage/new' }, 'Post a job') : null, h('a', { class: 'btn alt', href: '#/archive' }, 'Open an archive file'))),
      h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('b', null, String(groups.open.length)), h('span', null, 'Open now')),
        mineOnly ? h('div', { class: 'tile' }, h('b', null, String(mine.length)), h('span', null, 'Your jobs')) : h('div', { class: 'tile' }, h('b', null, String(groups.upcoming.length + groups.draft.length)), h('span', null, 'Drafts and upcoming')),
        h('div', { class: 'tile' }, h('b', null, String(apps.filter(function (a) { return a.result === 'in_process'; }).length)), h('span', null, 'Students in process')),
        h('div', { class: 'tile' }, h('b', null, String(apps.filter(function (a) { return a.result === 'selected'; }).length)), h('span', null, 'Selected'))),
      jobs.length ? null : h('div', { class: 'empty' }, 'No jobs yet. ', canPost() ? h('a', { href: '#/manage/new' }, 'Post the first one') : null),
      list('Open now', groups.open),
      list('Closed: selection under way or download pending', groups.closed, 'Record each round as it is decided. When the process is complete, download the archive and clear the data.'),
      list('Downloaded: ready to clear', groups.exported, 'The archive has been downloaded at least once. Clear the data when you are sure you have it saved.'),
      list('Upcoming', groups.upcoming, 'Published, but not yet open for applications.'),
      list('Drafts', groups.draft, 'Students cannot see drafts.'),
      list('Cleared', groups.archived, 'Applications and files have been removed from the server. Open the archive file to view them again.'));
  }

  // ---------- post or edit a job ----------
  function newId(prefix) { return prefix + Math.random().toString(36).slice(2, 8); }
  function listEditor(items, render, emptyText) {
    var box = h('div', { class: 'stack' });
    function draw() {
      box.replaceChildren();
      if (!items.length) box.appendChild(h('div', { class: 'empty' }, emptyText));
      items.forEach(function (it, i) {
        function move(d) { var k = i + d; if (k < 0 || k >= items.length) return; var t = items[i]; items[i] = items[k]; items[k] = t; draw(); }
        var tools = h('div', { class: 'row' },
          h('button', { class: 'btn tiny ghost', type: 'button', onclick: function () { move(-1); }, disabled: i === 0, 'aria-label': 'Move up' }, '↑'),
          h('button', { class: 'btn tiny ghost', type: 'button', onclick: function () { move(1); }, disabled: i === items.length - 1, 'aria-label': 'Move down' }, '↓'),
          h('button', { class: 'btn tiny danger', type: 'button', onclick: function () { items.splice(i, 1); draw(); } }, 'Remove'));
        box.appendChild(render(it, i, tools));
      });
    }
    draw();
    box.redraw = draw;
    return box;
  }
  async function editJobView(id) {
    if (!isPlacement()) return go('#/');
    var j = id ? ok(await sb.from('jobs').select('*').eq('id', id).maybeSingle()) : null;
    if (id && !j) return go('#/', '!Job not found.');
    if (id && !canManage(j)) return go('#/manage/job/' + id, '!Only this job’s placement manager or a head can edit it.');
    if (!id && !canPost()) return go('#/', '!Your role cannot post jobs.');
    if (j && j.archived_at) return go('#/manage/job/' + id, '!This job has been cleared and can no longer be edited.');
    var progressed = id ? ok(await sb.from('applications').select('id,stage,result').eq('job_id', id)) : [];
    var moved = progressed.filter(function (a) { return a.stage > 0 || a.result !== 'in_process'; }).length;
    j = j || { job_type: 'Full-time', form: [], rounds: [], published: false, owner_id: me.id, opens_at: new Date().toISOString(), closes_at: new Date(Date.now() + 7 * 86400000).toISOString() };
    var f = {
      company_name: inp({ value: j.company_name, required: true }), company_website: inp({ type: 'url', value: j.company_website, placeholder: 'https://' }),
      company_about: h('textarea', null, j.company_about || ''),
      title: inp({ value: j.title, required: true, placeholder: 'For example: Management Trainee, Finance' }),
      job_type: sel({ 'Full-time': 'Full-time', 'Internship': 'Internship', 'Internship with PPO': 'Internship with pre-placement offer', 'Live project': 'Live project', 'Part-time': 'Part-time' }, j.job_type),
      location: inp({ value: j.location, placeholder: 'For example: Jaipur, Gurugram' }), ctc: inp({ value: j.ctc, placeholder: 'For example: Rs. 6–8 lakh per year' }),
      description: h('textarea', { style: 'min-height:180px' }, j.description || ''), eligibility: h('textarea', null, j.eligibility || ''),
      process: h('textarea', null, j.process || ''), other_info: h('textarea', null, j.other_info || ''),
      opens_at: inp({ type: 'datetime-local', value: toLocalInput(j.opens_at), required: true }), closes_at: inp({ type: 'datetime-local', value: toLocalInput(j.closes_at), required: true })
    };
    var owner = null;
    if (isHead()) {
      var staff = ok(await sb.from('profiles').select('id,full_name,email,role').in('role', ['placement_manager', 'deputy_pco', 'pco', 'manager']).order('full_name'));
      var oo = {}; staff.forEach(function (s) { oo[s.id] = (s.full_name || s.email) + ' (' + ROLE[s.role] + ')'; });
      owner = sel(oo, j.owner_id || me.id);
    }
    var published = h('input', { type: 'checkbox', id: 'pub', checked: j.published });
    var jd = h('input', { type: 'file', accept: '.pdf,.doc,.docx' });
    var removeJd = h('input', { type: 'checkbox', id: 'rmjd' });

    var roundItems = rounds(j).map(function (r) { return Object.assign({}, r); });
    var roundBox = listEditor(roundItems, function (r, i, tools) {
      var name = inp({ value: r.name, placeholder: 'For example: Group discussion', 'aria-label': 'Round ' + (i + 1) + ' name' });
      var note = inp({ value: r.note, placeholder: 'Optional: date, venue or mode', 'aria-label': 'Round ' + (i + 1) + ' note' });
      name.addEventListener('input', function () { r.name = name.value; });
      note.addEventListener('input', function () { r.note = note.value.trim() || undefined; });
      return h('div', { class: 'q round' }, h('div', { class: 'spread' }, h('span', { class: 'qn' }, 'ROUND ' + (i + 1)), tools),
        h('div', { class: 'grid2' }, field('Round', name), field('Note for students', note)));
    }, 'No rounds yet. Add each stage of this company’s process, in order. Students see them and their result in each.');
    var quickRounds = h('div', { class: 'quick' }, QUICK_ROUNDS.map(function (n) {
      return h('button', { class: 'btn tiny ghost', type: 'button', onclick: function () { roundItems.push({ id: newId('r'), name: n }); roundBox.redraw(); } }, '+ ' + n);
    }));

    var questions = (Array.isArray(j.form) ? j.form : []).map(function (q) { return Object.assign({}, q); });
    var qBox = listEditor(questions, function (q, i, tools) {
      var label = inp({ value: q.label, placeholder: 'Question shown to students' });
      var type = sel(FIELD_TYPES, q.type || 'short_text');
      var req = h('input', { type: 'checkbox', id: 'req' + i + Math.random().toString(36).slice(2, 5), checked: !!q.required });
      var help = inp({ value: q.help, placeholder: 'Optional hint, e.g. "Out of 10, to two decimals"' });
      var opts = h('textarea', { style: 'min-height:90px', placeholder: 'One option per line' }, (q.options || []).join('\n'));
      var optsWrap = field('Options', opts, 'One per line.');
      function sync() {
        q.label = label.value; q.type = type.value; q.required = req.checked; q.help = help.value.trim() || undefined;
        q.options = (q.type === 'single' || q.type === 'multi') ? opts.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean) : undefined;
        optsWrap.style.display = (q.type === 'single' || q.type === 'multi') ? '' : 'none';
      }
      [label, help, opts].forEach(function (x) { x.addEventListener('input', sync); });
      type.addEventListener('change', sync); req.addEventListener('change', sync); sync();
      return h('div', { class: 'q' }, h('div', { class: 'spread' }, h('span', { class: 'qn' }, 'QUESTION ' + (i + 1)), tools),
        h('div', { class: 'grid2' }, field('Question', label), field('Answer type', type)),
        optsWrap, field('Hint', help), h('div', { class: 'choice' }, req, h('label', { for: req.id }, 'Answer required')));
    }, 'No questions yet. Students will only send their profile and resume. Add questions if the company needs more.');
    var quick = h('div', { class: 'quick' }, QUICK.map(function (q) {
      return h('button', { class: 'btn tiny ghost', type: 'button', onclick: function () { questions.push(Object.assign({ id: newId('q') }, q)); qBox.redraw(); } }, '+ ' + q.label);
    }));
    var btn = h('button', { class: 'btn', type: 'submit' }, id ? 'Save changes' : 'Save job');

    show(band('Placement team', id ? 'Edit: ' + j.title : 'Post a job opportunity', id ? j.company_name : 'Fill in the company and the role, list the selection rounds, choose the dates, and add any questions the company wants answered.'),
      progressed.length ? h('div', { class: 'note', style: 'margin-bottom:18px' }, progressed.length + ' student' + (progressed.length === 1 ? ' has' : 's have') + ' applied' + (moved ? ', and ' + moved + ' already have round results' : '') + '. Changing or reordering rounds changes what they see; add rounds at the end where possible.') : null,
      h('form', { class: 'stack', onsubmit: function (e) {
        e.preventDefault();
        var badQ = questions.filter(function (q) { return !String(q.label || '').trim() || ((q.type === 'single' || q.type === 'multi') && !(q.options || []).length); });
        if (badQ.length) return fail('Every question needs a label, and list questions need at least one option.');
        if (roundItems.some(function (r) { return !String(r.name || '').trim(); })) return fail('Every round needs a name.');
        var o = new Date(f.opens_at.value), c = new Date(f.closes_at.value);
        if (!(c > o)) return fail('The closing date must be after the opening date.');
        if (jd.files[0] && jd.files[0].size > 10 * 1024 * 1024) return fail('The job description file is larger than 10 MB.');
        busy(btn, async function () {
          var v = {};
          ['company_name', 'company_website', 'company_about', 'title', 'job_type', 'location', 'ctc', 'description', 'eligibility', 'process', 'other_info'].forEach(function (k) { v[k] = f[k].value.trim() || null; });
          v.opens_at = o.toISOString(); v.closes_at = c.toISOString(); v.published = published.checked;
          v.rounds = roundItems.map(function (r) { return { id: r.id || newId('r'), name: r.name.trim(), note: r.note }; });
          v.form = questions.map(function (q) { return { id: q.id || newId('q'), label: q.label.trim(), type: q.type, required: !!q.required, help: q.help, options: q.options }; });
          if (owner) v.owner_id = owner.value; else if (!id) v.owner_id = me.id;
          var row = id ? ok(await sb.from('jobs').update(v).eq('id', id).select().single()) : ok(await sb.from('jobs').insert(v).select().single());
          if (removeJd.checked && row.jd_file_path) {
            await sb.storage.from('jobfiles').remove([row.jd_file_path]);
            ok(await sb.from('jobs').update({ jd_file_path: null, jd_file_name: null }).eq('id', row.id));
          }
          if (jd.files[0]) {
            var file = jd.files[0], path = row.id + '/' + Date.now() + '-' + safe(file.name);
            ok(await sb.storage.from('jobfiles').upload(path, file, { upsert: false }));
            if (row.jd_file_path && !removeJd.checked) await sb.storage.from('jobfiles').remove([row.jd_file_path]);
            ok(await sb.from('jobs').update({ jd_file_path: path, jd_file_name: file.name }).eq('id', row.id));
          }
          go('#/manage/job/' + row.id, v.published ? 'Saved and published.' : 'Saved as a draft. Students cannot see it until you publish it.');
        });
      } },
        h('div', { class: 'card accent stack' }, h('h3', null, 'Company'),
          h('div', { class: 'grid2' }, field('Company name', f.company_name, null, true), field('Website', f.company_website)),
          field('About the company', f.company_about)),
        h('div', { class: 'card accent stack' }, h('h3', null, 'Role'),
          h('div', { class: 'grid2' }, field('Job title', f.title, null, true), field('Type', f.job_type)),
          h('div', { class: 'grid2' }, field('Location', f.location), field('Compensation', f.ctc)),
          field('Job description', f.description), field('Eligibility', f.eligibility, 'For example: MBA 2025–27, minimum CGPA 6.5, no active backlogs.'),
          field('Other information', f.other_info),
          field(j.jd_file_path ? 'Replace the job description file' : 'Job description file (optional)', jd, 'PDF or Word, up to 10 MB. Students can open it from the job page.' + (j.jd_file_name ? ' Current file: ' + j.jd_file_name + '.' : '')),
          j.jd_file_path ? h('div', { class: 'choice' }, removeJd, h('label', { for: 'rmjd' }, 'Remove the current file')) : null),
        h('div', { class: 'card key stack' }, h('h3', null, 'Selection rounds'),
          h('p', { class: 'muted small' }, 'List this company’s rounds in order. Only students who clear a round go on to the next; each student sees their own result for every round.'),
          roundBox, h('div', null, h('p', { class: 'small', style: 'font-weight:600;margin-bottom:8px' }, 'Quick add'), quickRounds),
          h('div', null, h('button', { class: 'btn ghost', type: 'button', onclick: function () { roundItems.push({ id: newId('r'), name: '' }); roundBox.redraw(); } }, '+ Add your own round')),
          field('Selection process notes (optional)', f.process, 'Anything else about the process, such as dress code or documents to carry.')),
        h('div', { class: 'card key stack' }, h('h3', null, 'Dates (India time) and ownership'),
          h('div', { class: 'grid2' }, field('Applications open', f.opens_at, null, true), field('Applications close', f.closes_at, 'Students can apply and edit until this moment.', true)),
          owner ? field('Placement manager for this job', owner, 'They post updates and decide rounds for this job. Heads can act on every job.') : h('p', { class: 'hint' }, 'You will be this job’s placement manager.'),
          h('div', { class: 'choice' }, published, h('label', { for: 'pub' }, 'Publish: students can see this opening (from the opening date, they can apply)'))),
        h('div', { class: 'card stack' }, h('h3', null, 'Application form'),
          h('p', { class: 'muted small' }, 'Every application already includes the student’s name, email, roll number, programme, batch, specialisation, phone and resume. Add only what this company needs.'),
          qBox, h('div', null, h('p', { class: 'small', style: 'font-weight:600;margin-bottom:8px' }, 'Quick add'), quick),
          h('div', null, h('button', { class: 'btn ghost', type: 'button', onclick: function () { questions.push({ id: newId('q'), label: '', type: 'short_text', required: false }); qBox.redraw(); } }, '+ Add your own question'))),
        h('div', { class: 'row' }, btn, h('a', { class: 'btn ghost', href: id ? '#/manage/job/' + id : '#/' }, 'Cancel'))));
  }

  // ---------- one job: applicants, rounds, export, clean-up ----------
  async function loadJobData(id) {
    var j = ok(await sb.from('jobs').select('*').eq('id', id).maybeSingle());
    if (!j) return null;
    var apps = ok(await sb.from('applications').select('*').eq('job_id', id).order('submitted_at'));
    var ids = apps.map(function (a) { return a.student_id; });
    var people = ids.length ? byId(ok(await sb.from('profiles').select('id,full_name,email,roll_no,programme,batch,specialisation,phone').in('id', ids))) : {};
    apps.forEach(function (a) { a.profiles = people[a.student_id] || {}; });
    return { job: j, apps: apps };
  }
  async function jobAdminView(id) {
    if (!isPlacement()) return go('#/job/' + id);
    var d = await loadJobData(id);
    if (!d) return go('#/', '!Job not found.');
    var j = d.job, apps = d.apps, st = jobState(j), form = Array.isArray(j.form) ? j.form : [], r = rounds(j), can = canManage(j);
    var names = await teamNames(), ownerP = names[j.owner_id];
    var res = { in_process: 0, selected: 0, not_cleared: 0 }; apps.forEach(function (a) { res[a.result]++; });
    var atRound = r.map(function (_, i) { return apps.filter(function (a) { return a.result === 'in_process' && Math.min(a.stage, r.length - 1) === i; }).length; });
    var fo = { '': 'Everyone' }; r.forEach(function (x, i) { fo['r' + i] = 'In round ' + (i + 1) + ': ' + x.name; }); fo.selected = 'Selected'; fo.not_cleared = 'Not cleared';
    if (!r.length) fo.in_process = 'In process';
    var filter = sel(fo, '', { 'aria-label': 'Show' });
    var search = inp({ type: 'search', placeholder: 'Search name, email or roll number', 'aria-label': 'Search applicants' });
    var tbody = h('tbody'), picked = {};
    var allBox = h('input', { type: 'checkbox', 'aria-label': 'Select all shown' });
    var shown = [];
    var bar = h('div', { class: 'bulk', hidden: true });
    var countLabel = h('strong');
    function refreshBar() {
      var n = Object.keys(picked).filter(function (k) { return picked[k]; }).length;
      bar.hidden = !can || !n; countLabel.textContent = n + ' selected';
      allBox.checked = shown.length > 0 && shown.every(function (a) { return picked[a.id]; });
    }
    function matches(a) {
      var p = a.profiles || {}, q = search.value.trim().toLowerCase(), f = filter.value;
      if (q && [p.full_name, p.email, p.roll_no].join(' ').toLowerCase().indexOf(q) < 0) return false;
      if (!f) return true;
      if (f[0] === 'r') return a.result === 'in_process' && Math.min(a.stage, r.length - 1) === Number(f.slice(1));
      return a.result === f;
    }
    function drawRows() {
      tbody.replaceChildren();
      shown = apps.filter(matches);
      if (!shown.length) tbody.appendChild(h('tr', null, h('td', { colspan: '7' }, h('span', { class: 'muted' }, apps.length ? 'No applications match.' : 'No applications yet.'))));
      shown.forEach(function (a) {
        var p = a.profiles || {};
        var cb = can ? h('input', { type: 'checkbox', checked: !!picked[a.id], 'aria-label': 'Select ' + (p.full_name || p.email), onchange: function () { picked[a.id] = cb.checked; refreshBar(); } }) : null;
        var detail = h('tr', { class: 'open-row', hidden: true }, h('td', { colspan: '7' },
          h('div', { class: 'two' },
            h('div', null, h('h4', { style: 'margin:0 0 8px;font-size:14px' }, 'Answers'),
              form.length ? h('dl', { class: 'kv' }, form.map(function (f) { return [h('dt', null, f.label), h('dd', null, answerText(f, a.answers[f.id]) || '—')]; })) : h('span', { class: 'muted' }, 'This job has no extra questions.'),
              h('p', { class: 'hint', style: 'margin-top:8px' }, [p.specialisation, p.phone].filter(Boolean).join(' · '))),
            h('div', null, h('h4', { style: 'margin:0 0 8px;font-size:14px' }, 'Rounds'), r.length ? tracker(j, a) : null, h('h4', { style: 'margin:12px 0 4px;font-size:14px' }, 'Updates'), historyList(a)))));
        tbody.append(h('tr', null,
          h('td', null, cb),
          h('td', null, h('a', { href: '#/student/' + a.student_id }, h('strong', null, p.full_name || '—')), h('br'), h('span', { class: 'small muted' }, p.email)),
          h('td', null, p.roll_no || '', h('br'), h('span', { class: 'small muted' }, [p.programme, p.batch].filter(Boolean).join(' '))),
          h('td', { class: 'small' }, when(a.submitted_at)),
          h('td', null, a.resume_path ? h('button', { class: 'btn tiny ghost', type: 'button', onclick: function () { openFile('resumes', a.resume_path).catch(fail); } }, 'Resume') : '—'),
          h('td', null, stageTag(j, a)),
          h('td', null, h('button', { class: 'btn tiny ghost', type: 'button', onclick: function () { detail.hidden = !detail.hidden; } }, 'Details'))), detail);
      });
      refreshBar();
    }
    allBox.addEventListener('change', function () { shown.forEach(function (a) { picked[a.id] = allBox.checked; }); drawRows(); });
    filter.addEventListener('change', drawRows); search.addEventListener('input', drawRows);
    var noteIn = inp({ placeholder: 'Optional note shown to students, e.g. "Interviews on 3 Dec, Room 204"', 'aria-label': 'Note with this update' });
    function act(action, label) {
      var b = h('button', { class: 'btn tiny ' + (action === 'not_clear' ? 'danger' : action === 'clear' || action === 'select' ? 'indigo' : 'ghost'), type: 'button', onclick: function () {
        var ids = Object.keys(picked).filter(function (k) { return picked[k]; });
        if (!ids.length) return;
        if (action === 'not_clear' && !window.confirm('Mark ' + ids.length + ' student' + (ids.length === 1 ? '' : 's') + ' as not cleared? They will see this on their account.')) return;
        busy(b, async function () {
          var n = ok(await sb.rpc('update_round', { p_apps: ids, p_action: action, p_note: noteIn.value.trim() || null }));
          go('#/manage/job/' + id, n + ' updated' + (ids.length - n ? '; ' + (ids.length - n) + ' skipped because the change did not apply to them' : '') + '.');
        });
      } }, label);
      return b;
    }
    bar.append(h('div', { class: 'row' }, countLabel,
      act('clear', r.length ? 'Cleared this round' : 'Selected'), act('not_clear', 'Not cleared'), r.length > 1 ? act('select', 'Selected (final)') : null,
      act('back', 'Move back a round'), act('reopen', 'Reopen')), h('div', { style: 'margin-top:8px' }, noteIn));
    drawRows();

    var pubBtn = st === 'archived' || !can ? null : h('button', { class: 'btn ghost', type: 'button', onclick: function () {
      busy(pubBtn, async function () { ok(await sb.from('jobs').update({ published: !j.published }).eq('id', id)); go('#/manage/job/' + id, j.published ? 'Unpublished. Students can no longer see it.' : 'Published.'); });
    } }, j.published ? 'Unpublish' : 'Publish');

    show(band(j.company_name, j.title, [j.job_type, j.location, j.ctc].filter(Boolean).join(' · ') + (ownerP ? ' · Placement manager: ' + (ownerP.full_name || ownerP.email) : ''),
      h('ul', { class: 'facts' }, h('li', null, STATE[st][0]), h('li', null, 'Opens ' + when(j.opens_at)), h('li', null, 'Closes ' + when(j.closes_at)))),
      h('div', { class: 'row', style: 'margin-bottom:18px' },
        st !== 'archived' && can ? h('a', { class: 'btn indigo', href: '#/manage/edit/' + id }, 'Edit job') : null, pubBtn,
        st !== 'archived' && st !== 'draft' ? h('a', { class: 'btn ghost', href: '#/job/' + id }, 'Student view') : null,
        h('a', { class: 'btn ghost', href: '#/' }, 'All jobs')),
      !can && st !== 'archived' ? h('div', { class: 'note info', style: 'margin-bottom:18px' }, 'You can view this job. Round results and downloads are handled by its placement manager or a head.') : null,
      st === 'archived' ? archivedCard(j, can) : null,
      st !== 'archived' ? h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('b', null, String(apps.length)), h('span', null, 'Applications')),
        h('div', { class: 'tile' }, h('b', null, String(res.in_process)), h('span', null, 'In process')),
        h('div', { class: 'tile' }, h('b', null, String(res.selected)), h('span', null, 'Selected')),
        h('div', { class: 'tile' }, h('b', null, String(res.not_cleared)), h('span', null, 'Not cleared'))) : null,
      st !== 'archived' && r.length ? h('div', { class: 'card accent' }, h('h3', null, 'Rounds'),
        h('ol', { class: 'pipeline' }, r.map(function (x, i) {
          return h('li', null, h('button', { type: 'button', class: 'pipe', onclick: function () { filter.value = 'r' + i; drawRows(); } }, h('span', { class: 'n' }, String(atRound[i])), h('span', null, (i + 1) + '. ' + x.name)));
        }).concat([h('li', null, h('button', { type: 'button', class: 'pipe final', onclick: function () { filter.value = 'selected'; drawRows(); } }, h('span', { class: 'n' }, String(res.selected)), h('span', null, 'Selected')))])),
        h('p', { class: 'hint', style: 'margin-top:8px' }, 'Numbers show students currently in each round. Click one to list them.')) : null,
      st !== 'archived' ? h('div', { class: 'card' }, h('div', { class: 'spread', style: 'margin-bottom:12px' }, h('h3', null, 'Applicants'), h('div', { class: 'row' }, h('div', { style: 'min-width:240px' }, search), filter)),
        can ? h('p', { class: 'hint', style: 'margin-bottom:10px' }, 'Tick students, then record the result of their current round. "Cleared this round" moves them to the next round, and after the last round marks them Selected.') : null,
        bar,
        h('div', { class: 'scroll', style: 'border:0' }, h('table', null,
          h('thead', null, h('tr', null, h('th', null, can ? allBox : ''), h('th', null, 'Student'), h('th', null, 'Roll and programme'), h('th', null, 'Applied'), h('th', null, 'Resume'), h('th', null, 'Where things stand'), h('th', null, ''))), tbody))) : null,
      st !== 'archived' && can ? exportCard(j, apps, st, res) : null);
  }
  function archivedCard(j, can) {
    var s = j.archive_summary || {}, by = s.by_result || {};
    return h('div', { class: 'card key' }, h('h3', null, 'Cleared from the server'),
      h('p', null, 'On ' + when(s.cleared_at || j.archived_at) + ', ' + (s.applications || 0) + ' application' + (s.applications === 1 ? '' : 's') + ' and their resumes were removed after the archive was downloaded.'),
      Object.keys(by).length ? h('p', { class: 'muted', style: 'margin-top:6px' }, Object.keys(by).map(function (k) { return (RESULT[k] ? RESULT[k][0] : k) + ': ' + by[k]; }).join(' · ')) : null,
      h('div', { class: 'row', style: 'margin-top:14px' }, h('a', { class: 'btn indigo', href: '#/archive' }, 'Open the archive file'),
        can ? h('button', { class: 'btn danger', type: 'button', onclick: async function (e) {
          if (!window.confirm('Delete this record permanently? The archive file on your computer is not affected.')) return;
          busy(e.target, async function () { ok(await sb.from('jobs').delete().eq('id', j.id)); go('#/', 'Record deleted.'); });
        } }, 'Delete this record') : null));
  }
  function exportCard(j, apps, st, res) {
    var closed = st === 'closed' || st === 'exported';
    var status = h('p', { class: 'hint', role: 'status' }), bar = h('div', { class: 'progress', hidden: true }, h('i'));
    function progress(done, total, text) { bar.hidden = false; bar.firstChild.style.width = Math.round(100 * done / Math.max(total, 1)) + '%'; status.textContent = text; }
    function done() { bar.hidden = true; }
    var base = safe(j.company_name) + '_' + safe(j.title);
    var bFull = h('button', { class: 'btn indigo', type: 'button', disabled: !closed, onclick: function () {
      busy(bFull, async function () {
        await libs();
        var zip = await buildArchive(j, apps, progress);
        saveBlob(zip, base + '_archive.zip'); done();
        if (!j.exported_at) { ok(await sb.rpc('mark_exported', { p_job: j.id })); }
        go('#/manage/job/' + j.id, 'Archive downloaded. Keep it safe; you can now clear the data from the server.');
      });
    } }, 'Download complete archive (.zip)');
    var bXls = h('button', { class: 'btn ghost', type: 'button', onclick: function () { busy(bXls, async function () { await libs(); saveBlob(excelBlob(j, apps, resumeNames(apps)), base + '_applications.xlsx'); }); } }, 'Excel only');
    var bPdf = h('button', { class: 'btn ghost', type: 'button', onclick: function () { busy(bPdf, async function () { await libs(); saveBlob(jobPdf(j, apps), base + '_job_details.pdf'); }); } }, 'Job details (PDF)');
    var bRes = h('button', { class: 'btn ghost', type: 'button', disabled: !apps.some(function (a) { return a.resume_path; }), onclick: function () {
      busy(bRes, async function () {
        await libs();
        var z = new window.JSZip(), names = resumeNames(apps), list = apps.filter(function (a) { return a.resume_path; });
        for (var i = 0; i < list.length; i++) {
          progress(i, list.length, 'Downloading resume ' + (i + 1) + ' of ' + list.length + '…');
          z.file(names[list[i].id], ok(await sb.storage.from('resumes').download(list[i].resume_path)));
        }
        saveBlob(await z.generateAsync({ type: 'blob' }), base + '_resumes.zip'); done(); status.textContent = 'Resumes downloaded.';
      });
    } }, 'Resumes only (.zip)');
    var clear = null;
    if (st === 'exported') {
      var confirmIn = inp({ placeholder: 'Type CLEAR', 'aria-label': 'Type CLEAR to confirm' });
      var bClear = h('button', { class: 'btn danger', type: 'button', onclick: function () {
        if (confirmIn.value.trim().toUpperCase() !== 'CLEAR') return fail('Type CLEAR in the box to confirm.');
        busy(bClear, async function () {
          progress(0, 1, 'Removing files…');
          var paths = await listJobResumes(j.id);
          apps.forEach(function (a) { if (a.resume_path && paths.indexOf(a.resume_path) < 0) paths.push(a.resume_path); });
          for (var i = 0; i < paths.length; i += 100) ok(await sb.storage.from('resumes').remove(paths.slice(i, i + 100)));
          if (j.jd_file_path) await sb.storage.from('jobfiles').remove([j.jd_file_path]);
          ok(await sb.rpc('clear_job', { p_job: j.id }));
          go('#/manage/job/' + j.id, 'Cleared. The applications and files are no longer on the server.');
        });
      } }, 'Clear from server');
      clear = h('div', { class: 'note', style: 'margin-top:16px' },
        h('strong', null, 'Clear this job from the server. '), 'Downloaded ' + when(j.exported_at) + '. Clearing removes every application, answer, round result and resume for this job, and the job description file. A short record stays. This cannot be undone; you can still view everything by opening the archive file.',
        res.in_process ? h('p', { style: 'margin-top:8px;color:var(--red-dark);font-weight:600' }, res.in_process + ' student' + (res.in_process === 1 ? ' is' : 's are') + ' still in process. Record their final results and download again before clearing.') : null,
        h('div', { class: 'row', style: 'margin-top:12px' }, h('div', { style: 'max-width:180px' }, confirmIn), bClear));
    }
    return h('div', { class: 'card key' }, h('h3', null, 'Download and clean-up'),
      h('p', { class: 'muted', style: 'margin-bottom:12px' }, closed
        ? 'When the selection process is complete, download the complete archive: an Excel sheet of every form and round result, all resumes, a PDF of the job post, and a data file the portal can reopen later.'
        : 'The complete archive unlocks after the closing date (' + when(j.closes_at) + '). Until then you can download the current list and the job details.'),
      h('div', { class: 'row' }, bFull, bXls, bRes, bPdf), bar, status, clear);
  }
  async function listJobResumes(jobId) {
    var out = [], top = ok(await sb.storage.from('resumes').list(jobId, { limit: 1000 }));
    for (var i = 0; i < top.length; i++) {
      if (top[i].id) { out.push(jobId + '/' + top[i].name); continue; }
      var inner = ok(await sb.storage.from('resumes').list(jobId + '/' + top[i].name, { limit: 100 }));
      inner.forEach(function (f) { out.push(jobId + '/' + top[i].name + '/' + f.name); });
    }
    return out;
  }
  function resumeNames(apps) {
    var used = {}, out = {};
    apps.forEach(function (a) {
      if (!a.resume_path) return;
      var p = a.profiles || {}, n = 'resumes/' + safe(p.roll_no || 'no-roll') + '_' + safe(p.full_name || 'student'), k = n, i = 2;
      while (used[k]) k = n + '_' + (i++);
      used[k] = 1; out[a.id] = k + '.pdf';
    });
    return out;
  }
  function historyText(a) {
    return (Array.isArray(a.history) ? a.history : []).map(function (x) { return day(x.at) + ' ' + (ACTION[x.action] || x.action) + (x.round ? ' (' + x.round + ')' : '') + (x.by ? ' by ' + x.by : '') + (x.note ? ': ' + x.note : ''); }).join('; ');
  }
  var PROFILE_COLS = [['full_name', 'Name'], ['email', 'Email'], ['roll_no', 'Roll number'], ['programme', 'Programme'], ['batch', 'Batch'], ['specialisation', 'Specialisation'], ['phone', 'Phone']];
  function excelBlob(j, apps, names) {
    var XLSX = window.XLSX, form = Array.isArray(j.form) ? j.form : [], r = rounds(j);
    var head = ['S. no.'].concat(PROFILE_COLS.map(function (c) { return c[1]; }), ['Result', 'Where things stand', 'Rounds cleared', 'Applied on', 'Last updated', 'Resume file'], form.map(function (f) { return f.label; }), ['Round history']);
    var rows = apps.map(function (a, i) {
      var p = a.profiles || {};
      return [i + 1].concat(PROFILE_COLS.map(function (c) { return p[c[0]] || ''; }),
        [RESULT[a.result] ? RESULT[a.result][0] : a.result, stageText(j, a), roundsCleared(j, a) + (r.length ? ' of ' + r.length : ''), when(a.submitted_at), when(a.updated_at), names[a.id] || ''],
        form.map(function (f) { var v = a.answers[f.id]; return f.type === 'number' && v !== '' && v != null && !isNaN(v) ? Number(v) : answerText(f, v); }), [historyText(a)]);
    });
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet([head].concat(rows));
    ws['!cols'] = head.map(function (t) { return { wch: Math.min(40, Math.max(10, String(t).length + 2)) }; });
    XLSX.utils.book_append_sheet(wb, ws, 'Applications');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(jobRows(j)), 'Job details');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Round', 'Name', 'Note', 'Students still in this round', 'Students not cleared here']].concat(r.map(function (x, i) {
      return [i + 1, x.name, x.note || '', apps.filter(function (a) { return a.result === 'in_process' && Math.min(a.stage, r.length - 1) === i; }).length, apps.filter(function (a) { return a.result === 'not_cleared' && Math.min(a.stage, r.length - 1) === i; }).length];
    }))), 'Rounds');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Question', 'Answer type', 'Required', 'Options']].concat(form.map(function (f) { return [f.label, FIELD_TYPES[f.type] || f.type, f.required ? 'Yes' : 'No', (f.options || []).join('; ')]; }))), 'Form');
    return new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function jobRows(j) {
    return [['Company', j.company_name], ['Website', j.company_website || ''], ['About the company', j.company_about || ''], ['Role', j.title], ['Type', j.job_type],
      ['Location', j.location || ''], ['Compensation', j.ctc || ''], ['Applications opened', when(j.opens_at)], ['Applications closed', when(j.closes_at)],
      ['Selection rounds', rounds(j).map(function (x, i) { return (i + 1) + '. ' + x.name; }).join('; ')],
      ['Job description', j.description || ''], ['Eligibility', j.eligibility || ''], ['Selection process notes', j.process || ''], ['Other information', j.other_info || ''],
      ['Job description file', j.jd_file_name || ''], ['Posted on', when(j.created_at)]];
  }
  function pdfText(s) {
    return String(s == null ? '' : s).replace(/₹\s*/g, 'Rs. ').replace(/[‐-―]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .replace(/…/g, '...').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
  }
  function jobPdf(j, apps) {
    var doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' }), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 50, y = 0;
    function header() {
      doc.setFillColor(47, 46, 122); doc.rect(0, 0, W, 86, 'F');
      doc.setTextColor(217, 216, 246); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('IBS JAIPUR - CAREERPREP - JOB POST', M, 30);
      doc.setTextColor(255, 255, 255); doc.setFontSize(18); doc.text(doc.splitTextToSize(pdfText(j.company_name + ': ' + j.title), W - 2 * M)[0], M, 56);
      doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.text(pdfText([j.job_type, j.location, j.ctc].filter(Boolean).join('  |  ')), M, 74);
      y = 116; doc.setTextColor(30, 30, 34);
    }
    function need(hh) { if (y + hh > H - 50) { doc.addPage(); header(); } }
    function heading(t) { need(34); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(63, 61, 158); doc.text(pdfText(t), M, y); y += 8; doc.setDrawColor(227, 227, 231); doc.line(M, y, W - M, y); y += 16; doc.setTextColor(30, 30, 34); }
    function para(t) { doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.splitTextToSize(pdfText(t), W - 2 * M).forEach(function (line) { need(15); doc.text(line, M, y); y += 15; }); y += 8; }
    function kv(k, v) { if (!v) return; doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); need(15); doc.text(pdfText(k), M, y); doc.setFont('helvetica', 'normal');
      var lines = doc.splitTextToSize(pdfText(v), W - 2 * M - 150); lines.forEach(function (line, i) { if (i) need(15); doc.text(line, M + 150, y); y += 15; }); }
    header();
    heading('Key details');
    kv('Company', j.company_name); kv('Website', j.company_website); kv('Role', j.title); kv('Type', j.job_type); kv('Location', j.location); kv('Compensation', j.ctc);
    kv('Applications opened', when(j.opens_at)); kv('Applications closed', when(j.closes_at)); kv('Posted on', when(j.created_at)); kv('Job description file', j.jd_file_name); y += 10;
    [['About the company', j.company_about], ['Job description', j.description], ['Eligibility', j.eligibility]].forEach(function (s) { if (s[1]) { heading(s[0]); para(s[1]); } });
    var r = rounds(j);
    if (r.length) {
      heading('Selection rounds');
      r.forEach(function (x, i) {
        var inR = apps.filter(function (a) { return a.result === 'in_process' && Math.min(a.stage, r.length - 1) === i; }).length;
        var out = apps.filter(function (a) { return a.result === 'not_cleared' && Math.min(a.stage, r.length - 1) === i; }).length;
        para((i + 1) + '. ' + x.name + (x.note ? ' (' + x.note + ')' : '') + ' - at export: ' + inR + ' in this round, ' + out + ' not cleared here.');
      });
    }
    [['Selection process notes', j.process], ['Other information', j.other_info]].forEach(function (s) { if (s[1]) { heading(s[0]); para(s[1]); } });
    var form = Array.isArray(j.form) ? j.form : [];
    heading('Application form');
    para('Standard fields: name, email, roll number, programme, batch, specialisation, phone and resume (PDF).');
    form.forEach(function (f, i) { para((i + 1) + '. ' + f.label + (f.required ? ' (required)' : '') + ' - ' + (FIELD_TYPES[f.type] || f.type) + ((f.options || []).length ? ': ' + f.options.join(', ') : '')); });
    var by = {}; apps.forEach(function (a) { by[a.result] = (by[a.result] || 0) + 1; });
    heading('Applications at the time of export');
    para(apps.length + ' application' + (apps.length === 1 ? '' : 's') + (apps.length ? ' (' + Object.keys(by).map(function (k) { return RESULT[k][0] + ': ' + by[k]; }).join(', ') + ')' : '') + '. Exported ' + when(new Date().toISOString()) + '.');
    var n = doc.getNumberOfPages();
    for (var p = 1; p <= n; p++) { doc.setPage(p); doc.setFontSize(8.5); doc.setTextColor(95, 98, 106); doc.text('Page ' + p + ' of ' + n, W - M, H - 24, { align: 'right' }); doc.text('CareerPrep, IBS Jaipur', M, H - 24); }
    return doc.output('blob');
  }
  async function buildArchive(j, apps, progress) {
    var JSZip = window.JSZip, z = new JSZip(), names = resumeNames(apps), list = apps.filter(function (a) { return a.resume_path; }), missing = [];
    for (var i = 0; i < list.length; i++) {
      progress(i, list.length + 2, 'Downloading resume ' + (i + 1) + ' of ' + list.length + '…');
      var rr = await sb.storage.from('resumes').download(list[i].resume_path);
      if (rr.error) missing.push((list[i].profiles || {}).full_name || list[i].id); else z.file(names[list[i].id], rr.data);
    }
    var jdName = null;
    if (j.jd_file_path) {
      var jd = await sb.storage.from('jobfiles').download(j.jd_file_path);
      if (!jd.error) { jdName = 'job-description-file/' + safe(j.jd_file_name || 'job-description'); z.file(jdName, jd.data); }
    }
    progress(list.length, list.length + 2, 'Building the Excel sheet and PDF…');
    z.file('applications.xlsx', excelBlob(j, apps, names));
    z.file('job-details.pdf', jobPdf(j, apps));
    var data = {
      format: 'careerprep-archive', version: 2, exported_at: new Date().toISOString(), exported_by: me.email,
      job: Object.assign({}, j, { jd_file_in_archive: jdName }),
      applications: apps.map(function (a) { return { id: a.id, profile: a.profiles || {}, stage: a.stage, result: a.result, history: a.history, answers: a.answers, submitted_at: a.submitted_at, updated_at: a.updated_at, resume_file: names[a.id] || null, resume_name: a.resume_name }; })
    };
    z.file('archive.json', JSON.stringify(data, null, 2));
    z.file('README.txt', 'CareerPrep archive: ' + j.company_name + ', ' + j.title + '\r\nExported ' + when(data.exported_at) + ' by ' + me.email + '\r\n\r\n' +
      'applications.xlsx   every application with form answers and round results\r\nresumes/            one PDF per student\r\njob-details.pdf     the job post and its rounds\r\narchive.json        data file: open it again in CareerPrep (Archives) to view everything\r\n' +
      (missing.length ? '\r\nResumes that could not be downloaded: ' + missing.join(', ') + '\r\n' : ''));
    progress(list.length + 1, list.length + 2, 'Compressing…');
    return z.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }

  // ---------- open an archive file (stays on this computer) ----------
  function archiveView() {
    if (!isPlacement()) return go('#/');
    var input = h('input', { type: 'file', accept: '.zip,application/zip' });
    var out = h('div');
    input.addEventListener('change', async function () {
      var file = input.files[0]; if (!file) return;
      out.replaceChildren(h('p', { class: 'muted' }, 'Opening ' + file.name + '…'));
      try {
        await libs();
        var z = await window.JSZip.loadAsync(file);
        var key = Object.keys(z.files).filter(function (k) { return /(^|\/)archive\.json$/.test(k); })[0];
        if (!key) throw new Error('This zip is not a CareerPrep archive: archive.json is missing.');
        var prefix = key.slice(0, key.length - 'archive.json'.length);
        var data = JSON.parse(await z.file(key).async('string'));
        if (data.format !== 'careerprep-archive') throw new Error('This zip is not a CareerPrep archive.');
        out.replaceChildren(renderArchive(data, z, prefix, file.name));
      } catch (e) { out.replaceChildren(); fail(e); }
    });
    show(band('Placement team', 'Open an archive file', 'Choose a CareerPrep archive (.zip) from your computer to view a cleared job with every application, round result and resume. The file is read in your browser; nothing is uploaded to the server.'),
      h('div', { class: 'card accent', style: 'max-width:640px' }, field('Archive file (.zip)', input)), out);
  }
  function renderArchive(data, z, prefix, fileName) {
    var j = data.job || {}, apps = (data.applications || []).map(function (a) {
      if (!a.result) a.result = a.status === 'selected' ? 'selected' : a.status === 'not_selected' ? 'not_cleared' : 'in_process'; // version 1 archives
      if (a.stage == null) a.stage = 0;
      return a;
    }), form = Array.isArray(j.form) ? j.form : [];
    async function openInZip(path, type) {
      var f = z.file(prefix + path); if (!f) return fail('That file is not in the archive.');
      var blob = new Blob([await f.async('arraybuffer')], { type: type });
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    }
    async function saveFromZip(path, name) { var f = z.file(prefix + path); if (f) saveBlob(await f.async('blob'), name); }
    var tbody = h('tbody'), search = inp({ type: 'search', placeholder: 'Search name, email or roll number', 'aria-label': 'Search applicants' });
    function draw() {
      tbody.replaceChildren();
      var q = search.value.trim().toLowerCase();
      apps.filter(function (a) { var p = a.profile || {}; return !q || [p.full_name, p.email, p.roll_no].join(' ').toLowerCase().indexOf(q) >= 0; }).forEach(function (a) {
        var p = a.profile || {};
        var detail = h('tr', { class: 'open-row', hidden: true }, h('td', { colspan: '6' }, h('div', { class: 'two' },
          h('div', null, form.length ? h('dl', { class: 'kv' }, form.map(function (f) { return [h('dt', null, f.label), h('dd', null, answerText(f, (a.answers || {})[f.id]) || '—')]; })) : h('span', { class: 'muted' }, 'No extra questions.'),
            h('p', { class: 'hint', style: 'margin-top:8px' }, [p.specialisation, p.phone].filter(Boolean).join(' · '))),
          h('div', null, rounds(j).length ? tracker(j, a) : null, h('h4', { style: 'margin:12px 0 4px;font-size:14px' }, 'Updates'), historyList(a)))));
        tbody.append(h('tr', null,
          h('td', null, h('strong', null, p.full_name || '—'), h('br'), h('span', { class: 'small muted' }, p.email || '')),
          h('td', null, p.roll_no || '', h('br'), h('span', { class: 'small muted' }, [p.programme, p.batch].filter(Boolean).join(' '))),
          h('td', { class: 'small' }, when(a.submitted_at)),
          h('td', null, a.resume_file ? h('button', { class: 'btn tiny ghost', type: 'button', onclick: function () { openInZip(a.resume_file, 'application/pdf').catch(fail); } }, 'Resume') : '—'),
          h('td', null, stageTag(j, a)),
          h('td', null, h('button', { class: 'btn tiny ghost', type: 'button', onclick: function () { detail.hidden = !detail.hidden; } }, 'Details'))), detail);
      });
      if (!tbody.children.length) tbody.appendChild(h('tr', null, h('td', { colspan: '6' }, h('span', { class: 'muted' }, 'No applications match.'))));
    }
    search.addEventListener('input', draw); draw();
    var details = [['About the company', j.company_about], ['Job description', j.description], ['Eligibility', j.eligibility], ['Selection process notes', j.process], ['Other information', j.other_info]].filter(function (s) { return s[1]; });
    return h('div', null,
      h('div', { class: 'note info', style: 'margin:6px 0 18px' }, 'Viewing ', h('strong', null, fileName), ', exported ' + when(data.exported_at) + (data.exported_by ? ' by ' + data.exported_by : '') + '. Read-only, on this computer only.'),
      h('div', { class: 'head' }, h('div', null, h('p', { class: 'label' }, j.company_name), h('h2', null, j.title), h('p', { class: 'muted' }, [j.job_type, j.location, j.ctc].filter(Boolean).join(' · '))),
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost tiny', type: 'button', onclick: function () { saveFromZip('applications.xlsx', safe(j.company_name) + '_applications.xlsx'); } }, 'Excel'),
          h('button', { class: 'btn ghost tiny', type: 'button', onclick: function () { openInZip('job-details.pdf', 'application/pdf').catch(fail); } }, 'Job PDF'),
          j.jd_file_in_archive ? h('button', { class: 'btn ghost tiny', type: 'button', onclick: function () { saveFromZip(j.jd_file_in_archive, j.jd_file_name || 'job-description'); } }, 'JD file') : null)),
      h('div', { class: 'tiles' }, h('div', { class: 'tile' }, h('b', null, String(apps.length)), h('span', null, 'Applications')),
        h('div', { class: 'tile' }, h('b', null, String(apps.filter(function (a) { return a.result === 'selected'; }).length)), h('span', null, 'Selected')),
        h('div', { class: 'tile' }, h('b', null, String(apps.filter(function (a) { return a.result === 'not_cleared'; }).length)), h('span', null, 'Not cleared')),
        h('div', { class: 'tile' }, h('b', null, day(j.closes_at)), h('span', null, 'Closed on'))),
      h('div', { class: 'card' }, h('div', { class: 'spread', style: 'margin-bottom:12px' }, h('h3', null, 'Applicants'), h('div', { style: 'min-width:240px' }, search)),
        h('div', { class: 'scroll', style: 'border:0' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Student'), h('th', null, 'Roll and programme'), h('th', null, 'Applied'), h('th', null, 'Resume'), h('th', null, 'Result'), h('th', null, ''))), tbody))),
      h('details', { class: 'card' }, h('summary', null, h('strong', null, 'Job post as published')),
        h('div', { style: 'margin-top:14px' }, jobDetails(j), roundsCard(j), details.map(function (s) { return h('div', { style: 'margin-top:14px' }, h('h3', null, s[0]), h('p', { class: 'prose' }, s[1])); }))));
  }

  // ---------- the team ----------
  async function teamView() {
    if (!isPlacement()) return go('#/');
    var invites = ok(await sb.from('staff_invites').select('*').order('created_at'));
    var people = ok(await sb.from('profiles').select('email,full_name,role,department').in('role', ['mentor', 'placement_manager', 'deputy_pco', 'pco', 'maintenance', 'manager']));
    var students = (await sb.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student')).count || 0;
    var byEmail = {}; people.forEach(function (p) { byEmail[p.email] = p; });
    var can = grantable();
    var order = ['manager', 'maintenance', 'pco', 'deputy_pco', 'placement_manager', 'mentor'];
    invites.sort(function (a, b) { return order.indexOf(a.role) - order.indexOf(b.role) || (a.email < b.email ? -1 : 1); });
    var email = inp({ type: 'email', required: true, placeholder: 'name@example.com' });
    var ro = {}; can.forEach(function (r) { ro[r] = ROLE[r]; });
    var roleSel = sel(ro, can.indexOf('placement_manager') >= 0 ? 'placement_manager' : can[0]);
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Invite');
    var perRole = {}; invites.forEach(function (i) { perRole[i.role] = (perRole[i.role] || 0) + 1; });
    show(band('Placement Office', 'The team', 'Everyone other than students joins by invitation. PCO invites Deputy PCOs, placement managers and mentors; a Deputy PCO invites placement managers and mentors.'),
      h('div', { class: 'tiles' }, h('div', { class: 'tile' }, h('b', null, String(students)), h('span', null, 'Registered students')),
        ['pco', 'deputy_pco', 'placement_manager', 'mentor'].map(function (r) { return h('div', { class: 'tile' }, h('b', null, String(perRole[r] || 0)), h('span', null, ROLE[r] + (r === 'pco' ? '' : 's'))); })),
      h('div', { class: 'two' },
        h('div', { class: 'card' }, h('h3', null, 'Team members'),
          h('div', { class: 'scroll', style: 'border:0' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Name and email'), h('th', null, 'Role'), h('th', null, 'Account'), h('th', null, ''))),
            h('tbody', null, invites.map(function (i) {
              var p = byEmail[i.email];
              var rm = i.email === me.email ? h('span', { class: 'small muted' }, 'You') : can.indexOf(i.role) >= 0 ? h('button', { class: 'btn tiny danger', type: 'button', onclick: function () {
                if (!window.confirm('Remove ' + i.email + ' (' + ROLE[i.role] + ') from the team? Their access ends at once.')) return;
                busy(rm, async function () { ok(await sb.rpc('remove_staff', { p_email: i.email })); go('#/team', 'Removed.'); });
              } }, 'Remove') : null;
              return h('tr', null, h('td', null, p && p.full_name ? h('strong', null, p.full_name) : null, p && p.full_name ? h('br') : null, h('span', { class: 'small' }, i.email)),
                h('td', null, ROLE[i.role]), h('td', null, p ? chip('Active', 'good') : chip('Not signed up yet', 'draft')), h('td', null, rm));
            }))))),
        can.length ? h('form', { class: 'card stack', onsubmit: function (e) {
          e.preventDefault();
          busy(btn, async function () {
            ok(await sb.from('staff_invites').upsert({ email: email.value.trim().toLowerCase(), role: roleSel.value, invited_by: me.id }));
            go('#/team', 'Invited. Ask them to create an account at wisewizard.app/ibsj/careerprep with this email address.');
          });
        } }, h('h3', null, 'Invite someone'), field('Email address', email, 'Any address works for the team.', true), field('Role', roleSel), btn,
          h('p', { class: 'hint' }, 'If they already have an account, the new role applies at once. Otherwise they create an account with this address and get the role automatically.'))
          : h('div', { class: 'card' }, h('h3', null, 'Invitations'), h('p', { class: 'muted' }, 'Your PCO or Deputy PCO invites new team members.'))));
  }

  // ---------- start ----------
  sb.auth.onAuthStateChange(function (event, s) {
    var was = session && session.user.id;
    session = s;
    if (event === 'PASSWORD_RECOVERY') { loadMe().then(function () { location.hash = '#/newpass'; }); return; }
    if (event === 'SIGNED_IN' && /^#(access_token|type=)/.test(location.hash)) { loadMe().then(function () { location.hash = '#/'; }); return; }
    if ((s && s.user.id) !== was) { me = null; loadMe().then(render); }
  });
  sb.auth.getSession().then(async function (r) {
    session = r.data.session;
    await loadMe();
    if (!/^#(access_token|error|type=)/.test(location.hash)) render();
    else if (/^#error/.test(location.hash)) { location.hash = '#/signin'; flash = '!That link has expired or was already used. Please sign in or ask for a new link.'; }
  });
})();
