/* CareerPrep: placement portal for IBS Jaipur.
   Plain JavaScript, no build step. Everything typed by users is written with textContent (via h()),
   never as HTML. Access rules live in the database (row-level security); this file only shows
   people what they are allowed to see. */
(function () {
  'use strict';

  var cfg = window.CAREERPREP_CONFIG;
  var sb = window.supabase.createClient(cfg.url, cfg.key);
  var app = document.getElementById('app');
  var nav = document.getElementById('nav');
  var bandEl = document.getElementById('band');
  var noticeEl = document.getElementById('notice');
  var session = null, me = null, recovering = false, flash = null, uid = 0, lastHash = null;
  var BASE = location.origin + '/ibsj/careerprep/';

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
  var STATUS = {
    submitted: ['Applied', ''], shortlisted: ['Shortlisted', 'warn'], selected: ['Selected', 'good'],
    not_selected: ['Not selected', 'bad'], withdrawn: ['Withdrawn', 'draft']
  };
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
    if (/Database error saving new user/i.test(m)) return 'Please sign up with your @' + cfg.studentDomain + ' email address.';
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
  function isStaff() { return me && (me.role === 'manager' || me.role === 'admin'); }
  function isAdmin() { return me && me.role === 'admin'; }
  function profileComplete(p) { return !!(p && p.full_name && p.roll_no && p.programme && p.batch && p.phone); }
  function safe(s) { return String(s || '').normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'file'; }
  function answerText(f, v) {
    if (v == null || v === '') return '';
    if (Array.isArray(v)) return v.join('; ');
    return String(v);
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
    if (isStaff()) {
      nav.append(link('#/', 'Jobs'), link('#/manage/new', 'Post a job'), link('#/archive', 'Open an archive'));
      if (isAdmin()) nav.append(link('#/team', 'Team'));
    } else {
      nav.append(link('#/', 'Opportunities'), link('#/my', 'My applications'));
    }
    nav.append(link('#/profile', 'Profile'),
      h('button', { type: 'button', onclick: async function () { await sb.auth.signOut(); go('#/signin', 'You are signed out.'); } }, 'Sign out'));
  }

  // ---------- router ----------
  var routes = [
    [/^#\/?$/, home],
    [/^#\/signin$/, signInView], [/^#\/signup$/, signUpView], [/^#\/reset$/, resetView], [/^#\/newpass$/, newPassView],
    [/^#\/profile$/, profileView],
    [/^#\/job\/([0-9a-f-]{36})$/, jobView], [/^#\/apply\/([0-9a-f-]{36})$/, applyView], [/^#\/my$/, myView],
    [/^#\/manage\/new$/, function () { return editJobView(null); }],
    [/^#\/manage\/edit\/([0-9a-f-]{36})$/, editJobView],
    [/^#\/manage\/job\/([0-9a-f-]{36})$/, jobAdminView],
    [/^#\/archive$/, archiveView], [/^#\/team$/, teamView]
  ];
  var PUBLIC = /^#\/(signin|signup|reset|newpass)?$/;
  async function render() {
    var hash = location.hash || '#/';
    if (/^#(access_token|error|type=)/.test(hash)) return; // Supabase is reading a sign-in link
    // A message survives a repeat render of the same page (for example right after signing in).
    if (flash || hash !== lastHash) notice(flash && flash.replace(/^!/, ''), flash && flash.indexOf('!') === 0 ? 'err' : 'ok');
    flash = null; lastHash = hash;
    drawNav();
    if (!session && !PUBLIC.test(hash)) { return go('#/signin', 'Please sign in to continue.'); }
    if (session && !me) { await loadMe(); drawNav(); }
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
    if (isStaff()) return manageView();
    return studentHome();
  }
  function welcome() {
    show(h('div', { class: 'band big' }, h('div', { class: 'wrap' },
      h('p', { class: 'label' }, 'ICFAI Business School Jaipur · Placement Cell'),
      h('h1', null, 'CareerPrep'),
      h('p', { class: 'tagline' }, 'Find the role that fits you, and apply in minutes.'),
      h('ul', { class: 'facts' }, h('li', null, 'Sign up with your @' + cfg.studentDomain + ' email'), h('li', null, 'One profile for every application'), h('li', null, 'Edit until the closing date')),
      h('div', { class: 'row', style: 'margin-top:26px' }, h('a', { class: 'btn', href: '#/signup' }, 'Create your account'), h('a', { class: 'btn alt', href: '#/signin' }, 'Sign in')))),
      h('div', { class: 'head' }, h('div', null, h('p', { class: 'label' }, 'How it works'), h('h2', null, 'Four steps to every opportunity'))),
      h('ol', { class: 'steps' },
        h('li', null, h('strong', null, 'Create your account'), h('span', null, 'Use your institute email address and confirm it from your inbox.')),
        h('li', null, h('strong', null, 'Complete your profile once'), h('span', null, 'Name, roll number, programme, batch and phone. They are added to every application for you.')),
        h('li', null, h('strong', null, 'Apply to the openings you want'), h('span', null, 'Read the job description, answer the company’s questions and upload your resume as a PDF.')),
        h('li', null, h('strong', null, 'Track your status'), h('span', null, 'See when you are shortlisted or selected. You can update an application until its closing date.'))));
  }

  async function studentHome() {
    var jobs = ok(await sb.from('jobs').select('*').order('closes_at'));
    var mine = ok(await sb.from('applications').select('job_id,status'));
    var applied = {}; mine.forEach(function (a) { applied[a.job_id] = a.status; });
    var open = jobs.filter(function (j) { var s = jobState(j); return s === 'open' || s === 'upcoming'; });
    var past = jobs.filter(function (j) { var s = jobState(j); return (s === 'closed' || s === 'exported') && applied[j.id]; });
    var first = (me.full_name || '').split(' ')[0];
    show(band('Placement opportunities', first ? 'Hello, ' + first : 'Welcome', open.length ? open.length + ' opening' + (open.length === 1 ? ' is' : 's are') + ' waiting for you.' : 'New openings appear here as soon as the placement team posts them.'),
      !profileComplete(me) ? h('div', { class: 'note', style: 'margin-bottom:18px' }, h('strong', null, 'Complete your profile before you apply. '), 'It takes a minute, and is added to every application. ', h('a', { href: '#/profile' }, 'Complete my profile')) : null,
      open.length ? h('ul', { class: 'jobs' }, open.map(function (j) { return jobCard(j, applied[j.id]); })) : h('div', { class: 'empty' }, 'No openings right now. Please check back soon.'),
      past.length ? h('div', { style: 'margin-top:30px' }, h('h2', { style: 'margin-bottom:14px' }, 'Closed openings you applied to'), h('ul', { class: 'jobs' }, past.map(function (j) { return jobCard(j, applied[j.id]); }))) : null);
  }
  function jobCard(j, myStatus) {
    var st = jobState(j), soon = st === 'open' && (new Date(j.closes_at) - Date.now()) < 48 * 3600000;
    return h('li', { class: 'job' + (soon ? ' soon' : '') },
      h('span', { class: 'co' }, j.company_name), h('h3', null, j.title),
      h('div', { class: 'meta' }, h('span', null, j.job_type), j.location ? h('span', null, j.location) : null, j.ctc ? h('span', null, j.ctc) : null),
      h('div', { class: 'meta' }, st === 'upcoming' ? h('span', null, 'Opens ' + when(j.opens_at)) : h('span', null, 'Closes ' + when(j.closes_at) + (st === 'open' ? ' (' + left(j.closes_at) + ')' : ''))),
      h('div', { class: 'go' }, h('a', { class: 'btn tiny indigo', href: '#/job/' + j.id }, myStatus ? 'View' : 'View and apply'),
        myStatus ? tag(STATUS, myStatus) : null, st !== 'open' ? tag(STATE, st) : null));
  }

  // ---------- account ----------
  function authBand(title, sub) { return band('CareerPrep account', title, sub); }
  function signInView() {
    if (session) return go('#/');
    var email = inp({ type: 'email', autocomplete: 'email', required: true }), pw = inp({ type: 'password', autocomplete: 'current-password', required: true });
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Sign in');
    show(authBand('Sign in', 'Students use their @' + cfg.studentDomain + ' email. The placement team uses the address they were invited with.'),
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
    show(authBand('Create your account', 'Only @' + cfg.studentDomain + ' addresses can register as students.'),
      h('form', { class: 'card auth stack', onsubmit: function (e) {
        e.preventDefault();
        var em = email.value.trim().toLowerCase();
        if (!/@/.test(em)) return fail('Please enter your email address.');
        busy(btn, async function () {
          var r = ok(await sb.auth.signUp({ email: em, password: pw.value, options: { data: { full_name: name.value.trim() }, emailRedirectTo: BASE } }));
          if (r.session) go('#/profile', 'Account created. Please complete your profile.');
          else show(authBand('Check your inbox', ''), h('div', { class: 'card auth' }, h('p', null, 'We have sent a confirmation link to ' + em + '. Open it to activate your account, then sign in.'), h('p', { class: 'hint' }, 'No email after a few minutes? Check the spam folder.')));
        });
      } }, field('Full name', name, null, true), field('Institute email', email, 'For example: firstname.lastname@' + cfg.studentDomain, true),
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
        busy(btn, async function () { ok(await sb.auth.updateUser({ password: pw.value })); recovering = false; go('#/', 'Your password has been changed.'); });
      } }, field('New password', pw, 'At least 8 characters.', true), btn));
  }

  async function profileView() {
    await loadMe();
    var p = me || {};
    var f = {
      full_name: inp({ value: p.full_name, required: true, autocomplete: 'name' }),
      roll_no: inp({ value: p.roll_no, required: !isStaff() }),
      programme: sel(Object.assign({ '': 'Choose your programme' }, PROGRAMMES.reduce(function (o, x) { o[x] = x; return o; }, {})), p.programme || '', { required: !isStaff() }),
      batch: inp({ value: p.batch, placeholder: 'For example: 2025–27', required: !isStaff() }),
      specialisation: inp({ value: p.specialisation, placeholder: 'For example: Finance and Marketing' }),
      phone: inp({ type: 'tel', value: p.phone, autocomplete: 'tel', required: !isStaff() })
    };
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Save profile');
    show(band('Your profile', p.full_name || 'Your profile', isStaff() ? 'You are signed in as ' + (p.role === 'admin' ? 'an admin' : 'a placement manager') + '.' : 'These details are attached to every application you make.'),
      h('form', { class: 'card stack', style: 'max-width:760px', onsubmit: function (e) {
        e.preventDefault();
        busy(btn, async function () {
          var v = {}; Object.keys(f).forEach(function (k) { v[k] = f[k].value.trim() || null; });
          v.full_name = v.full_name || '';
          ok(await sb.from('profiles').update(v).eq('id', me.id));
          await loadMe();
          go('#/', 'Profile saved.');
        });
      } },
        field('Email', inp({ value: p.email, disabled: true }), 'Your sign-in address. It cannot be changed here.'),
        h('div', { class: 'grid2' }, field('Full name', f.full_name, 'As it should appear to recruiters.', true), field('Roll number', f.roll_no, null, !isStaff())),
        h('div', { class: 'grid3' }, field('Programme', f.programme, null, !isStaff()), field('Batch', f.batch, null, !isStaff()), field('Phone', f.phone, null, !isStaff())),
        field('Specialisation', f.specialisation), h('div', null, btn)));
  }

  // ---------- job page (students and staff) ----------
  function jobDetails(j) {
    var rows = [['Company', j.company_name], ['Role', j.title], ['Type', j.job_type], ['Location', j.location], ['Compensation', j.ctc],
      ['Applications open', when(j.opens_at)], ['Applications close', when(j.closes_at)], ['Company website', j.company_website]];
    return h('dl', { class: 'kv' }, rows.filter(function (r) { return r[1]; }).map(function (r) {
      var v = r[0] === 'Company website' && /^https?:\/\//i.test(r[1]) ? h('a', { href: r[1], target: '_blank', rel: 'noopener' }, r[1]) : r[1];
      return [h('dt', null, r[0]), h('dd', null, v)];
    }));
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
    if (!isStaff()) mine = ok(await sb.from('applications').select('*').eq('job_id', id).maybeSingle());
    var action;
    if (isStaff()) action = h('a', { class: 'btn indigo', href: '#/manage/job/' + id }, 'Manage this job');
    else if (st === 'open') action = profileComplete(me)
      ? h('a', { class: 'btn', href: '#/apply/' + id }, mine ? 'Update my application' : 'Apply now')
      : h('a', { class: 'btn', href: '#/profile' }, 'Complete your profile to apply');
    else if (st === 'upcoming') action = h('p', null, 'Applications open on ' + when(j.opens_at) + '.');
    else action = h('p', null, 'Applications for this opening are closed.');
    show(band(j.company_name, j.title, [j.job_type, j.location, j.ctc].filter(Boolean).join(' · '),
      h('ul', { class: 'facts' }, h('li', null, st === 'upcoming' ? 'Opens ' + when(j.opens_at) : 'Closes ' + when(j.closes_at)), st === 'open' ? h('li', null, left(j.closes_at)) : null)),
      h('div', { class: 'two' },
        h('div', null, jobSections(j).length ? jobSections(j) : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'The placement team will share more details soon.'))),
        h('div', null,
          h('div', { class: 'card key' }, h('h3', null, mine ? 'Your application' : 'Apply'),
            mine ? h('p', { style: 'margin-bottom:12px' }, tag(STATUS, mine.status), ' Submitted ' + when(mine.submitted_at) + (mine.updated_at && mine.updated_at !== mine.submitted_at ? ', last updated ' + when(mine.updated_at) : '')) : null,
            action),
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
    if (isStaff()) return go('#/manage/job/' + id);
    if (!profileComplete(me)) return go('#/profile', '!Please complete your profile before applying.');
    var j = ok(await sb.from('jobs').select('*').eq('id', id).maybeSingle());
    if (!j) return go('#/', '!That opening is no longer available.');
    if (jobState(j) !== 'open') return go('#/job/' + id, '!Applications for this opening are not open.');
    var mine = ok(await sb.from('applications').select('*').eq('job_id', id).maybeSingle());
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
        h('div', { class: 'card' }, h('div', { class: 'choice' }, agree, h('label', { for: 'agree' }, 'I confirm that the information I have given is accurate, and I agree to share it and my resume with the placement team and ' + j.company_name + '.'))),
        h('div', { class: 'spread' }, h('div', { class: 'row' }, btn, h('a', { class: 'btn ghost', href: '#/job/' + id }, 'Cancel')), withdraw)));
  }
  async function myView() {
    if (isStaff()) return go('#/');
    var rows = ok(await sb.from('applications').select('*, jobs(id,company_name,title,closes_at,opens_at,published,archived_at,exported_at)').order('submitted_at', { ascending: false }));
    show(band('My applications', 'Your applications', 'Status updates from the placement team appear here.'),
      rows.length ? h('div', { class: 'scroll' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'Company and role'), h('th', null, 'Status'), h('th', null, 'Submitted'), h('th', null, 'Closes'), h('th', null, ''))),
        h('tbody', null, rows.map(function (a) {
          var j = a.jobs || {};
          return h('tr', null, h('td', null, h('strong', null, j.company_name), h('br'), j.title), h('td', null, tag(STATUS, a.status)),
            h('td', null, when(a.submitted_at)), h('td', null, when(j.closes_at)),
            h('td', null, h('a', { class: 'btn tiny ghost', href: '#/job/' + a.job_id }, jobState(j) === 'open' ? 'View or edit' : 'View')));
        })))) : h('div', { class: 'empty' }, 'You have not applied yet. ', h('a', { href: '#/' }, 'See open opportunities')));
  }

  // ---------- staff: jobs overview ----------
  async function manageView() {
    var jobs = ok(await sb.from('jobs').select('*').order('closes_at', { ascending: false }));
    var apps = ok(await sb.from('applications').select('job_id'));
    var count = {}; apps.forEach(function (a) { count[a.job_id] = (count[a.job_id] || 0) + 1; });
    var groups = { open: [], upcoming: [], draft: [], closed: [], exported: [], archived: [] };
    jobs.forEach(function (j) { groups[jobState(j)].push(j); });
    function list(title, items, hint) {
      if (!items.length) return null;
      return h('div', { style: 'margin-bottom:26px' }, h('h2', { style: 'margin-bottom:4px' }, title), hint ? h('p', { class: 'muted small', style: 'margin-bottom:12px' }, hint) : null,
        h('div', { class: 'scroll' }, h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'Company and role'), h('th', null, 'Status'), h('th', null, 'Closes'), h('th', null, 'Applications'), h('th', null, ''))),
          h('tbody', null, items.map(function (j) {
            var st = jobState(j);
            return h('tr', null, h('td', null, h('strong', null, j.company_name), h('br'), j.title), h('td', null, tag(STATE, st)), h('td', null, when(j.closes_at)),
              h('td', null, st === 'archived' ? String((j.archive_summary || {}).applications || 0) + ' (cleared)' : String(count[j.id] || 0)),
              h('td', null, h('div', { class: 'row' }, h('a', { class: 'btn tiny indigo', href: '#/manage/job/' + j.id }, 'Open'),
                st !== 'archived' ? h('a', { class: 'btn tiny ghost', href: '#/manage/edit/' + j.id }, 'Edit') : null)));
          })))));
    }
    show(band('Placement team', 'Jobs and applications', 'Post an opening, follow applications as they arrive, and download everything once the closing date has passed.',
      h('div', { class: 'row', style: 'margin-top:20px' }, h('a', { class: 'btn', href: '#/manage/new' }, 'Post a job'), h('a', { class: 'btn alt', href: '#/archive' }, 'Open an archive file'))),
      h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('b', null, String(groups.open.length)), h('span', null, 'Open now')),
        h('div', { class: 'tile' }, h('b', null, String(groups.upcoming.length + groups.draft.length)), h('span', null, 'Drafts and upcoming')),
        h('div', { class: 'tile' }, h('b', null, String(groups.closed.length + groups.exported.length)), h('span', null, 'Closed, awaiting clean-up')),
        h('div', { class: 'tile' }, h('b', null, String(apps.length)), h('span', null, 'Applications on the server'))),
      jobs.length ? null : h('div', { class: 'empty' }, 'No jobs yet. ', h('a', { href: '#/manage/new' }, 'Post the first one')),
      list('Open now', groups.open),
      list('Closed: download pending', groups.closed, 'Download the archive, then clear the data from the server.'),
      list('Downloaded: ready to clear', groups.exported, 'The archive has been downloaded at least once. Clear the data when you are sure you have it saved.'),
      list('Upcoming', groups.upcoming, 'Published, but not yet open for applications.'),
      list('Drafts', groups.draft, 'Only the placement team can see drafts.'),
      list('Cleared', groups.archived, 'Applications and files have been removed from the server. Open the archive file to view them again.'));
  }

  // ---------- staff: post or edit a job ----------
  function newFieldId() { return 'q' + Math.random().toString(36).slice(2, 8); }
  async function editJobView(id) {
    if (!isStaff()) return go('#/');
    var j = id ? ok(await sb.from('jobs').select('*').eq('id', id).maybeSingle()) : null;
    if (id && !j) return go('#/', '!Job not found.');
    if (j && j.archived_at) return go('#/manage/job/' + id, '!This job has been cleared and can no longer be edited.');
    var appCount = id ? ((await sb.from('applications').select('id', { count: 'exact', head: true }).eq('job_id', id)).count || 0) : 0;
    j = j || { job_type: 'Full-time', form: [], published: false, opens_at: new Date().toISOString(), closes_at: new Date(Date.now() + 7 * 86400000).toISOString() };
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
    var published = h('input', { type: 'checkbox', id: 'pub', checked: j.published });
    var jd = h('input', { type: 'file', accept: '.pdf,.doc,.docx' });
    var removeJd = h('input', { type: 'checkbox', id: 'rmjd' });
    var questions = (Array.isArray(j.form) ? j.form : []).map(function (q) { return Object.assign({}, q); });
    var qBox = h('div', { class: 'stack' });

    function drawQuestions() {
      qBox.replaceChildren();
      if (!questions.length) qBox.appendChild(h('div', { class: 'empty' }, 'No questions yet. Students will only send their profile and resume. Add questions below if the company needs more.'));
      questions.forEach(function (q, i) {
        var label = inp({ value: q.label, placeholder: 'Question shown to students' });
        var type = sel(FIELD_TYPES, q.type || 'short_text');
        var req = h('input', { type: 'checkbox', id: 'req' + i, checked: !!q.required });
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
        function move(d) { var k = i + d; if (k < 0 || k >= questions.length) return; var t = questions[i]; questions[i] = questions[k]; questions[k] = t; drawQuestions(); }
        qBox.appendChild(h('div', { class: 'q' },
          h('div', { class: 'spread' }, h('span', { class: 'qn' }, 'QUESTION ' + (i + 1)), h('div', { class: 'row' },
            h('button', { class: 'btn tiny ghost', type: 'button', onclick: function () { move(-1); }, disabled: i === 0, 'aria-label': 'Move question up' }, '↑'),
            h('button', { class: 'btn tiny ghost', type: 'button', onclick: function () { move(1); }, disabled: i === questions.length - 1, 'aria-label': 'Move question down' }, '↓'),
            h('button', { class: 'btn tiny danger', type: 'button', onclick: function () { questions.splice(i, 1); drawQuestions(); } }, 'Remove'))),
          h('div', { class: 'grid2' }, field('Question', label), field('Answer type', type)),
          optsWrap, field('Hint', help), h('div', { class: 'choice' }, req, h('label', { for: 'req' + i }, 'Answer required'))));
      });
    }
    drawQuestions();
    var quick = h('div', { class: 'quick' }, QUICK.map(function (q) {
      return h('button', { class: 'btn tiny ghost', type: 'button', onclick: function () { questions.push(Object.assign({ id: newFieldId() }, q)); drawQuestions(); } }, '+ ' + q.label);
    }));
    var btn = h('button', { class: 'btn', type: 'submit' }, id ? 'Save changes' : 'Save job');

    show(band('Placement team', id ? 'Edit: ' + j.title : 'Post a job opportunity', id ? j.company_name : 'Fill in the company and the role, choose the dates, and add any questions the company wants answered.'),
      appCount ? h('div', { class: 'note', style: 'margin-bottom:18px' }, appCount + ' student' + (appCount === 1 ? ' has' : 's have') + ' already applied. If you add a required question, they will be asked to answer it only if they edit their application.') : null,
      h('form', { class: 'stack', onsubmit: function (e) {
        e.preventDefault();
        var bad = questions.filter(function (q) { return !String(q.label || '').trim() || ((q.type === 'single' || q.type === 'multi') && !(q.options || []).length); });
        if (bad.length) return fail('Every question needs a label, and list questions need at least one option.');
        var o = new Date(f.opens_at.value), c = new Date(f.closes_at.value);
        if (!(c > o)) return fail('The closing date must be after the opening date.');
        if (jd.files[0] && jd.files[0].size > 10 * 1024 * 1024) return fail('The job description file is larger than 10 MB.');
        busy(btn, async function () {
          var v = {};
          ['company_name', 'company_website', 'company_about', 'title', 'job_type', 'location', 'ctc', 'description', 'eligibility', 'process', 'other_info'].forEach(function (k) { v[k] = f[k].value.trim() || null; });
          v.opens_at = o.toISOString(); v.closes_at = c.toISOString(); v.published = published.checked;
          v.form = questions.map(function (q) { return { id: q.id || newFieldId(), label: q.label.trim(), type: q.type, required: !!q.required, help: q.help, options: q.options }; });
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
          field('Selection process', f.process, 'For example: online test, group discussion, two interviews.'), field('Other information', f.other_info),
          field(j.jd_file_path ? 'Replace the job description file' : 'Job description file (optional)', jd, 'PDF or Word, up to 10 MB. Students can open it from the job page.' + (j.jd_file_name ? ' Current file: ' + j.jd_file_name + '.' : '')),
          j.jd_file_path ? h('div', { class: 'choice' }, removeJd, h('label', { for: 'rmjd' }, 'Remove the current file')) : null),
        h('div', { class: 'card key stack' }, h('h3', null, 'Dates (India time)'),
          h('div', { class: 'grid2' }, field('Applications open', f.opens_at, null, true), field('Applications close', f.closes_at, 'Students can apply and edit until this moment. Downloads unlock after it.', true)),
          h('div', { class: 'choice' }, published, h('label', { for: 'pub' }, 'Publish: students can see this opening (from the opening date, they can apply)'))),
        h('div', { class: 'card stack' }, h('h3', null, 'Application form'),
          h('p', { class: 'muted small' }, 'Every application already includes the student’s name, email, roll number, programme, batch, specialisation, phone and resume. Add only what this company needs.'),
          qBox, h('div', null, h('p', { class: 'small', style: 'font-weight:600;margin-bottom:8px' }, 'Quick add'), quick),
          h('div', null, h('button', { class: 'btn ghost', type: 'button', onclick: function () { questions.push({ id: newFieldId(), label: '', type: 'short_text', required: false }); drawQuestions(); } }, '+ Add your own question'))),
        h('div', { class: 'row' }, btn, h('a', { class: 'btn ghost', href: id ? '#/manage/job/' + id : '#/' }, 'Cancel'))));
  }

  // ---------- staff: one job, its applicants, export and clean-up ----------
  async function loadJobData(id) {
    var j = ok(await sb.from('jobs').select('*').eq('id', id).maybeSingle());
    if (!j) return null;
    var apps = ok(await sb.from('applications').select('*, profiles(full_name,email,roll_no,programme,batch,specialisation,phone)').eq('job_id', id).order('submitted_at'));
    return { job: j, apps: apps };
  }
  async function jobAdminView(id) {
    if (!isStaff()) return go('#/job/' + id);
    var d = await loadJobData(id);
    if (!d) return go('#/', '!Job not found.');
    var j = d.job, apps = d.apps, st = jobState(j), form = Array.isArray(j.form) ? j.form : [];
    var counts = {}; apps.forEach(function (a) { counts[a.status] = (counts[a.status] || 0) + 1; });
    var filter = sel({ '': 'All statuses', submitted: 'Applied', shortlisted: 'Shortlisted', selected: 'Selected', not_selected: 'Not selected' }, '');
    var search = inp({ type: 'search', placeholder: 'Search name, email or roll number' });
    var tbody = h('tbody');
    function drawRows() {
      tbody.replaceChildren();
      var q = search.value.trim().toLowerCase();
      var list = apps.filter(function (a) {
        var p = a.profiles || {};
        return (!filter.value || a.status === filter.value) && (!q || [p.full_name, p.email, p.roll_no].join(' ').toLowerCase().indexOf(q) >= 0);
      });
      if (!list.length) tbody.appendChild(h('tr', null, h('td', { colspan: '6' }, h('span', { class: 'muted' }, apps.length ? 'No applications match.' : 'No applications yet.'))));
      list.forEach(function (a) {
        var p = a.profiles || {};
        var status = sel({ submitted: 'Applied', shortlisted: 'Shortlisted', selected: 'Selected', not_selected: 'Not selected' }, a.status, { 'aria-label': 'Status for ' + p.full_name, disabled: st === 'archived' });
        status.addEventListener('change', async function () {
          try { ok(await sb.from('applications').update({ status: status.value }).eq('id', a.id)); a.status = status.value; notice('Status updated for ' + p.full_name + '.'); }
          catch (e) { fail(e); status.value = a.status; }
        });
        var detail = h('tr', { class: 'open-row', hidden: true }, h('td', { colspan: '6' },
          form.length ? h('dl', { class: 'kv' }, form.map(function (f) { return [h('dt', null, f.label), h('dd', null, answerText(f, a.answers[f.id]) || '—')]; })) : h('span', { class: 'muted' }, 'This job has no extra questions.'),
          h('p', { class: 'hint', style: 'margin-top:8px' }, [p.specialisation, p.phone].filter(Boolean).join(' · '))));
        tbody.append(h('tr', null,
          h('td', null, h('strong', null, p.full_name || '—'), h('br'), h('span', { class: 'small muted' }, p.email)),
          h('td', null, p.roll_no || '', h('br'), h('span', { class: 'small muted' }, [p.programme, p.batch].filter(Boolean).join(' '))),
          h('td', { class: 'small' }, when(a.submitted_at)),
          h('td', null, a.resume_path ? h('button', { class: 'btn tiny ghost', type: 'button', onclick: function () { openFile('resumes', a.resume_path).catch(fail); } }, 'Resume') : '—'),
          h('td', null, status),
          h('td', null, h('button', { class: 'btn tiny ghost', type: 'button', 'aria-expanded': 'false', onclick: function (e) { detail.hidden = !detail.hidden; e.target.setAttribute('aria-expanded', String(!detail.hidden)); } }, 'Answers'))), detail);
      });
    }
    filter.addEventListener('change', drawRows); search.addEventListener('input', drawRows);
    drawRows();

    var pubBtn = st === 'archived' ? null : h('button', { class: 'btn ghost', type: 'button', onclick: function () {
      busy(pubBtn, async function () { ok(await sb.from('jobs').update({ published: !j.published }).eq('id', id)); go('#/manage/job/' + id, j.published ? 'Unpublished. Students can no longer see it.' : 'Published.'); });
    } }, j.published ? 'Unpublish' : 'Publish');

    show(band(j.company_name, j.title, [j.job_type, j.location, j.ctc].filter(Boolean).join(' · '),
      h('ul', { class: 'facts' }, h('li', null, STATE[st][0]), h('li', null, 'Opens ' + when(j.opens_at)), h('li', null, 'Closes ' + when(j.closes_at)))),
      h('div', { class: 'row', style: 'margin-bottom:18px' },
        st !== 'archived' ? h('a', { class: 'btn indigo', href: '#/manage/edit/' + id }, 'Edit job') : null, pubBtn,
        st !== 'archived' && st !== 'draft' ? h('a', { class: 'btn ghost', href: '#/job/' + id }, 'Student view') : null,
        h('a', { class: 'btn ghost', href: '#/' }, 'All jobs')),
      st === 'archived' ? archivedCard(j) : null,
      st !== 'archived' ? h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('b', null, String(apps.length)), h('span', null, 'Applications')),
        h('div', { class: 'tile' }, h('b', null, String(counts.shortlisted || 0)), h('span', null, 'Shortlisted')),
        h('div', { class: 'tile' }, h('b', null, String(counts.selected || 0)), h('span', null, 'Selected')),
        h('div', { class: 'tile' }, h('b', null, String(form.length)), h('span', null, 'Questions in the form'))) : null,
      st !== 'archived' ? exportCard(j, apps, st) : null,
      st !== 'archived' ? h('div', { class: 'card' }, h('div', { class: 'spread', style: 'margin-bottom:12px' }, h('h3', null, 'Applicants'), h('div', { class: 'row' }, h('div', { style: 'min-width:240px' }, search), filter)),
        h('div', { class: 'scroll', style: 'border:0' }, h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'Student'), h('th', null, 'Roll and programme'), h('th', null, 'Applied'), h('th', null, 'Resume'), h('th', null, 'Status'), h('th', null, ''))), tbody))) : null);
  }
  function archivedCard(j) {
    var s = j.archive_summary || {}, by = s.by_status || {};
    return h('div', { class: 'card key' }, h('h3', null, 'Cleared from the server'),
      h('p', null, 'On ' + when(s.cleared_at || j.archived_at) + ', ' + (s.applications || 0) + ' application' + (s.applications === 1 ? '' : 's') + ' and their resumes were removed after the archive was downloaded.'),
      Object.keys(by).length ? h('p', { class: 'muted', style: 'margin-top:6px' }, Object.keys(by).map(function (k) { return (STATUS[k] ? STATUS[k][0] : k) + ': ' + by[k]; }).join(' · ')) : null,
      h('div', { class: 'row', style: 'margin-top:14px' }, h('a', { class: 'btn indigo', href: '#/archive' }, 'Open the archive file'),
        h('button', { class: 'btn danger', type: 'button', onclick: async function (e) {
          if (!window.confirm('Delete this record permanently? The archive file on your computer is not affected.')) return;
          busy(e.target, async function () { ok(await sb.from('jobs').delete().eq('id', j.id)); go('#/', 'Record deleted.'); });
        } }, 'Delete this record')));
  }
  function exportCard(j, apps, st) {
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
        h('strong', null, 'Clear this job from the server. '), 'Downloaded ' + when(j.exported_at) + '. Clearing removes every application, answer and resume for this job, and the job description file. A short record stays so you know it was done. This cannot be undone; you can still view everything by opening the archive file.',
        h('div', { class: 'row', style: 'margin-top:12px' }, h('div', { style: 'max-width:180px' }, confirmIn), bClear));
    }
    return h('div', { class: 'card key' }, h('h3', null, 'Download and clean-up'),
      h('p', { class: 'muted', style: 'margin-bottom:12px' }, closed
        ? 'The complete archive holds the Excel sheet of every form, all resumes, a PDF of the job post, and a data file the portal can reopen later.'
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
  var PROFILE_COLS = [['full_name', 'Name'], ['email', 'Email'], ['roll_no', 'Roll number'], ['programme', 'Programme'], ['batch', 'Batch'], ['specialisation', 'Specialisation'], ['phone', 'Phone']];
  function excelBlob(j, apps, names) {
    var XLSX = window.XLSX, form = Array.isArray(j.form) ? j.form : [];
    var head = ['S. no.'].concat(PROFILE_COLS.map(function (c) { return c[1]; }), ['Status', 'Applied on', 'Last updated', 'Resume file'], form.map(function (f) { return f.label; }));
    var rows = apps.map(function (a, i) {
      var p = a.profiles || {};
      return [i + 1].concat(PROFILE_COLS.map(function (c) { return p[c[0]] || ''; }), [STATUS[a.status] ? STATUS[a.status][0] : a.status, when(a.submitted_at), when(a.updated_at), names[a.id] || ''],
        form.map(function (f) { var v = a.answers[f.id]; return f.type === 'number' && v !== '' && v != null && !isNaN(v) ? Number(v) : answerText(f, v); }));
    });
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet([head].concat(rows));
    ws['!cols'] = head.map(function (t) { return { wch: Math.min(40, Math.max(10, String(t).length + 2)) }; });
    XLSX.utils.book_append_sheet(wb, ws, 'Applications');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(jobRows(j)), 'Job details');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Question', 'Answer type', 'Required', 'Options']].concat(form.map(function (f) { return [f.label, FIELD_TYPES[f.type] || f.type, f.required ? 'Yes' : 'No', (f.options || []).join('; ')]; }))), 'Form');
    return new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function jobRows(j) {
    return [['Company', j.company_name], ['Website', j.company_website || ''], ['About the company', j.company_about || ''], ['Role', j.title], ['Type', j.job_type],
      ['Location', j.location || ''], ['Compensation', j.ctc || ''], ['Applications opened', when(j.opens_at)], ['Applications closed', when(j.closes_at)],
      ['Job description', j.description || ''], ['Eligibility', j.eligibility || ''], ['Selection process', j.process || ''], ['Other information', j.other_info || ''],
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
      doc.setTextColor(217, 216, 246); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('IBS JAIPUR · CAREERPREP · JOB POST', M, 30);
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
    [['About the company', j.company_about], ['Job description', j.description], ['Eligibility', j.eligibility], ['Selection process', j.process], ['Other information', j.other_info]]
      .forEach(function (s) { if (s[1]) { heading(s[0]); para(s[1]); } });
    var form = Array.isArray(j.form) ? j.form : [];
    heading('Application form');
    para('Standard fields: name, email, roll number, programme, batch, specialisation, phone and resume (PDF).');
    form.forEach(function (f, i) { para((i + 1) + '. ' + f.label + (f.required ? ' (required)' : '') + ' - ' + (FIELD_TYPES[f.type] || f.type) + ((f.options || []).length ? ': ' + f.options.join(', ') : '')); });
    var by = {}; apps.forEach(function (a) { by[a.status] = (by[a.status] || 0) + 1; });
    heading('Applications at the time of export');
    para(apps.length + ' application' + (apps.length === 1 ? '' : 's') + (apps.length ? ' (' + Object.keys(by).map(function (k) { return STATUS[k][0] + ': ' + by[k]; }).join(', ') + ')' : '') + '. Exported ' + when(new Date().toISOString()) + '.');
    var n = doc.getNumberOfPages();
    for (var p = 1; p <= n; p++) { doc.setPage(p); doc.setFontSize(8.5); doc.setTextColor(95, 98, 106); doc.text('Page ' + p + ' of ' + n, W - M, H - 24, { align: 'right' }); doc.text('CareerPrep, IBS Jaipur', M, H - 24); }
    return doc.output('blob');
  }
  async function buildArchive(j, apps, progress) {
    var JSZip = window.JSZip, z = new JSZip(), names = resumeNames(apps), list = apps.filter(function (a) { return a.resume_path; }), missing = [];
    for (var i = 0; i < list.length; i++) {
      progress(i, list.length + 2, 'Downloading resume ' + (i + 1) + ' of ' + list.length + '…');
      var r = await sb.storage.from('resumes').download(list[i].resume_path);
      if (r.error) missing.push((list[i].profiles || {}).full_name || list[i].id); else z.file(names[list[i].id], r.data);
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
      format: 'careerprep-archive', version: 1, exported_at: new Date().toISOString(), exported_by: me.email,
      job: Object.assign({}, j, { jd_file_in_archive: jdName }),
      applications: apps.map(function (a) { return { id: a.id, profile: a.profiles || {}, status: a.status, answers: a.answers, submitted_at: a.submitted_at, updated_at: a.updated_at, resume_file: names[a.id] || null, resume_name: a.resume_name }; })
    };
    z.file('archive.json', JSON.stringify(data, null, 2));
    z.file('README.txt', 'CareerPrep archive: ' + j.company_name + ', ' + j.title + '\r\nExported ' + when(data.exported_at) + ' by ' + me.email + '\r\n\r\n' +
      'applications.xlsx   every application with the form answers\r\nresumes/            one PDF per student\r\njob-details.pdf     the job post\r\narchive.json        data file: open it again in CareerPrep (Open an archive) to view everything\r\n' +
      (missing.length ? '\r\nResumes that could not be downloaded: ' + missing.join(', ') + '\r\n' : ''));
    progress(list.length + 1, list.length + 2, 'Compressing…');
    return z.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }

  // ---------- staff: open an archive file (stays on this computer) ----------
  function archiveView() {
    if (!isStaff()) return go('#/');
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
    show(band('Placement team', 'Open an archive file', 'Choose a CareerPrep archive (.zip) from your computer to view a cleared job with every application and resume. The file is read in your browser; nothing is uploaded to the server.'),
      h('div', { class: 'card accent', style: 'max-width:640px' }, field('Archive file (.zip)', input)), out);
  }
  function renderArchive(data, z, prefix, fileName) {
    var j = data.job || {}, apps = data.applications || [], form = Array.isArray(j.form) ? j.form : [];
    async function openInZip(path, type) {
      var f = z.file(prefix + path); if (!f) return fail('That file is not in the archive.');
      var blob = new Blob([await f.async('arraybuffer')], { type: type });
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    }
    async function saveFromZip(path, name) { var f = z.file(prefix + path); if (f) saveBlob(await f.async('blob'), name); }
    var tbody = h('tbody'), search = inp({ type: 'search', placeholder: 'Search name, email or roll number' });
    function draw() {
      tbody.replaceChildren();
      var q = search.value.trim().toLowerCase();
      apps.filter(function (a) { var p = a.profile || {}; return !q || [p.full_name, p.email, p.roll_no].join(' ').toLowerCase().indexOf(q) >= 0; }).forEach(function (a) {
        var p = a.profile || {};
        var detail = h('tr', { class: 'open-row', hidden: true }, h('td', { colspan: '6' },
          form.length ? h('dl', { class: 'kv' }, form.map(function (f) { return [h('dt', null, f.label), h('dd', null, answerText(f, (a.answers || {})[f.id]) || '—')]; })) : h('span', { class: 'muted' }, 'No extra questions.'),
          h('p', { class: 'hint', style: 'margin-top:8px' }, [p.specialisation, p.phone].filter(Boolean).join(' · '))));
        tbody.append(h('tr', null,
          h('td', null, h('strong', null, p.full_name || '—'), h('br'), h('span', { class: 'small muted' }, p.email || '')),
          h('td', null, p.roll_no || '', h('br'), h('span', { class: 'small muted' }, [p.programme, p.batch].filter(Boolean).join(' '))),
          h('td', { class: 'small' }, when(a.submitted_at)),
          h('td', null, a.resume_file ? h('button', { class: 'btn tiny ghost', type: 'button', onclick: function () { openInZip(a.resume_file, 'application/pdf').catch(fail); } }, 'Resume') : '—'),
          h('td', null, tag(STATUS, a.status)),
          h('td', null, h('button', { class: 'btn tiny ghost', type: 'button', onclick: function () { detail.hidden = !detail.hidden; } }, 'Answers'))), detail);
      });
      if (!tbody.children.length) tbody.appendChild(h('tr', null, h('td', { colspan: '6' }, h('span', { class: 'muted' }, 'No applications match.'))));
    }
    search.addEventListener('input', draw); draw();
    var details = [['About the company', j.company_about], ['Job description', j.description], ['Eligibility', j.eligibility], ['Selection process', j.process], ['Other information', j.other_info]].filter(function (s) { return s[1]; });
    return h('div', null,
      h('div', { class: 'note info', style: 'margin:6px 0 18px' }, 'Viewing ', h('strong', null, fileName), ', exported ' + when(data.exported_at) + (data.exported_by ? ' by ' + data.exported_by : '') + '. Read-only, on this computer only.'),
      h('div', { class: 'head' }, h('div', null, h('p', { class: 'label' }, j.company_name), h('h2', null, j.title), h('p', { class: 'muted' }, [j.job_type, j.location, j.ctc].filter(Boolean).join(' · '))),
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost tiny', type: 'button', onclick: function () { saveFromZip('applications.xlsx', safe(j.company_name) + '_applications.xlsx'); } }, 'Excel'),
          h('button', { class: 'btn ghost tiny', type: 'button', onclick: function () { openInZip('job-details.pdf', 'application/pdf').catch(fail); } }, 'Job PDF'),
          j.jd_file_in_archive ? h('button', { class: 'btn ghost tiny', type: 'button', onclick: function () { saveFromZip(j.jd_file_in_archive, j.jd_file_name || 'job-description'); } }, 'JD file') : null)),
      h('div', { class: 'tiles' }, h('div', { class: 'tile' }, h('b', null, String(apps.length)), h('span', null, 'Applications')),
        h('div', { class: 'tile' }, h('b', null, String(apps.filter(function (a) { return a.status === 'shortlisted'; }).length)), h('span', null, 'Shortlisted')),
        h('div', { class: 'tile' }, h('b', null, String(apps.filter(function (a) { return a.status === 'selected'; }).length)), h('span', null, 'Selected')),
        h('div', { class: 'tile' }, h('b', null, day(j.closes_at)), h('span', null, 'Closed on'))),
      h('div', { class: 'card' }, h('div', { class: 'spread', style: 'margin-bottom:12px' }, h('h3', null, 'Applicants'), h('div', { style: 'min-width:240px' }, search)),
        h('div', { class: 'scroll', style: 'border:0' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Student'), h('th', null, 'Roll and programme'), h('th', null, 'Applied'), h('th', null, 'Resume'), h('th', null, 'Status'), h('th', null, ''))), tbody))),
      h('details', { class: 'card' }, h('summary', null, h('strong', null, 'Job post as published')),
        h('div', { style: 'margin-top:14px' }, jobDetails(j), details.map(function (s) { return h('div', { style: 'margin-top:14px' }, h('h3', null, s[0]), h('p', { class: 'prose' }, s[1])); }))));
  }

  // ---------- admin: the placement team ----------
  async function teamView() {
    if (!isAdmin()) return go('#/');
    var invites = ok(await sb.from('staff_invites').select('*').order('created_at'));
    var staff = ok(await sb.from('profiles').select('email,full_name,role').neq('role', 'student'));
    var students = (await sb.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student')).count || 0;
    var byEmail = {}; staff.forEach(function (p) { byEmail[p.email] = p; });
    var email = inp({ type: 'email', required: true, placeholder: 'name@example.com' }), role = sel({ manager: 'Placement manager', admin: 'Admin (can also manage the team)' }, 'manager');
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Add to the team');
    show(band('Admin', 'Placement team', 'Placement managers post jobs and handle applications. Admins can also add or remove team members. Students register themselves with their @' + cfg.studentDomain + ' email.'),
      h('div', { class: 'tiles' }, h('div', { class: 'tile' }, h('b', null, String(students)), h('span', null, 'Registered students')), h('div', { class: 'tile' }, h('b', null, String(invites.length)), h('span', null, 'Team members'))),
      h('div', { class: 'two' },
        h('div', { class: 'card' }, h('h3', null, 'Team members'),
          h('div', { class: 'scroll', style: 'border:0' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Email'), h('th', null, 'Role'), h('th', null, 'Account'), h('th', null, ''))),
            h('tbody', null, invites.map(function (i) {
              var p = byEmail[i.email];
              var rm = i.email === me.email ? h('span', { class: 'small muted' }, 'You') : h('button', { class: 'btn tiny danger', type: 'button', onclick: function () {
                if (!window.confirm('Remove ' + i.email + ' from the placement team?')) return;
                busy(rm, async function () { ok(await sb.rpc('remove_staff', { p_email: i.email })); go('#/team', 'Removed.'); });
              } }, 'Remove');
              return h('tr', null, h('td', null, i.email, p && p.full_name ? h('div', { class: 'small muted' }, p.full_name) : null), h('td', null, i.role === 'admin' ? 'Admin' : 'Manager'),
                h('td', null, p ? tag({ y: ['Active', 'good'] }, 'y') : tag({ n: ['Not signed up yet', 'draft'] }, 'n')), h('td', null, rm));
            }))))),
        h('form', { class: 'card stack', onsubmit: function (e) {
          e.preventDefault();
          busy(btn, async function () {
            ok(await sb.from('staff_invites').upsert({ email: email.value.trim().toLowerCase(), role: role.value, invited_by: me.id }));
            go('#/team', 'Added. Ask them to create an account at wisewizard.app/ibsj/careerprep with this email address.');
          });
        } }, h('h3', null, 'Add a team member'), field('Email address', email, 'Any address works for the team, not only @' + cfg.studentDomain + '.', true), field('Role', role), btn,
          h('p', { class: 'hint' }, 'If they already have an account, the new role applies at once. Otherwise they create an account with this address and get the role automatically.'))));
  }

  // ---------- start ----------
  sb.auth.onAuthStateChange(function (event, s) {
    var was = session && session.user.id;
    session = s;
    if (event === 'PASSWORD_RECOVERY') { recovering = true; loadMe().then(function () { location.hash = '#/newpass'; }); return; }
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
