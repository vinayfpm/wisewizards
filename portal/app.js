/* WiseWizard submission portal, stage 1.
   Plain JavaScript, no build step. All text from the database is written with
   textContent (via h()), never as HTML, so nothing a user types can run as code. */
(function () {
  'use strict';

  var cfg = window.PORTAL_CONFIG;
  var sb = window.supabase.createClient(cfg.url, cfg.key);
  var app = document.getElementById('app');
  var nav = document.getElementById('nav');
  var noticeEl = document.getElementById('notice');
  var session = null, profile = null, recovering = false, flash = null, lastUser = undefined, uid = 0, after = null;

  var STATUS = {
    draft: ['Draft', 'draft'], submitted: ['Submitted', ''], under_review: ['Under review', ''],
    revision_requested: ['Revision requested', 'warn'], revision_submitted: ['Revision submitted', ''],
    accepted: ['Accepted', 'good'], rejected: ['Not accepted', 'bad'], withdrawn: ['Withdrawn', 'draft']
  };
  var ARTICLE = { research_article: 'Research article', case_study: 'Case study', short_case: 'Short or graphic case', conference_paper: 'Conference paper',
    abstract: 'Abstract', extended_abstract: 'Extended abstract', full_paper: 'Full paper', review_paper: 'Review paper', poster: 'Poster presentation' };
  var JOURNAL_TYPES = ['research_article', 'case_study', 'short_case'];
  var CONF_TYPES = ['abstract', 'extended_abstract', 'full_paper', 'review_paper', 'case_study', 'poster'];
  var GUIDE = {
    abstract: '200 to 250 words covering the objective, methodology, key findings and implications. Type it in the abstract box; no file is needed at this stage.',
    extended_abstract: '500 to 2,000 words with background, problem statement, objectives, methodology, preliminary findings and key contributions. Upload it as a file.',
    full_paper: '4,000 to 9,000 words, excluding references and appendices. Upload the blinded manuscript and a separate title page.',
    review_paper: 'Systematic, bibliometric or narrative reviews. State the review protocol, synthesise the literature, identify gaps and outline future directions.',
    case_study: 'Describe the context, the problem or decision situation, and the implications. Teaching cases should come with teaching notes.',
    poster: 'Describe your poster in the abstract box. No file is needed at this stage.',
    research_article: 'Upload the blinded manuscript and a separate title page.',
    short_case: 'A short or graphic case on an Indian business. Upload the blinded manuscript and a separate title page.'
  };
  var VENUE = { journal_issue: 'Journal issue', special_call: 'Special call for papers', conference: 'Partner conference' };
  var KIND = { blinded_manuscript: 'Blinded manuscript', title_page: 'Title page', supplementary: 'Supplementary file', similarity_report: 'Similarity report' };

  // ---------- small helpers ----------
  function h(tag, attrs) {
    var e = document.createElement(tag), k, v, i, kid;
    for (k in (attrs || {})) {
      v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'required' || k === 'selected') e[k] = !!v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (i = 2; i < arguments.length; i++) {
      kid = arguments[i];
      if (Array.isArray(kid)) kid.forEach(add); else add(kid);
    }
    function add(c) {
      if (c == null || c === false) return;
      e.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return e;
  }
  function notice(msg, kind) {
    noticeEl.replaceChildren();
    if (msg) noticeEl.appendChild(h('div', { class: kind || 'ok' }, msg));
  }
  function fail(e) { notice((e && e.message) || String(e), 'err'); }
  function show() {
    app.replaceChildren.apply(app, Array.prototype.filter.call(arguments, function (n) { return n != null && n !== false; }));
    window.scrollTo(0, 0);
  }
  function field(label, input, hint) {
    input.id = 'f' + (++uid);
    return h('div', null, h('label', { for: input.id }, label), input, hint ? h('p', { class: 'small muted' }, hint) : null);
  }
  function select(options, value, attrs) {
    var s = h('select', attrs || {});
    Object.keys(options).forEach(function (k) { s.appendChild(h('option', { value: k, selected: k === value }, options[k])); });
    return s;
  }
  function hasRole(r) { return !!profile && profile.roles.indexOf(r) >= 0; }
  function isStaff() { return hasRole('editor') || hasRole('admin'); }
  function day(d) { return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }
  function tag(status) { var s = STATUS[status] || [status, '']; return h('span', { class: 'tag ' + s[1] }, s[0]); }
  function ok(r) { if (r.error) throw r.error; return r.data; }
  function go(hash, msg) { flash = msg || null; if (location.hash === hash) route(); else location.hash = hash; }
  async function busy(btn, fn) {
    btn.disabled = true;
    try { await fn(); } catch (e) { fail(e); } finally { btn.disabled = false; }
  }

  // ---------- session ----------
  async function loadProfile() {
    profile = null;
    if (!session) return;
    var r = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    if (!r.error) profile = r.data;
  }
  sb.auth.onAuthStateChange(function (event, s) {
    session = s;
    if (event === 'PASSWORD_RECOVERY') recovering = true;
    var user = s ? s.user.id : null;
    if (user === lastUser && event !== 'PASSWORD_RECOVERY') return; // token refresh: keep the page as it is
    lastUser = user;
    setTimeout(async function () {
      await loadProfile();
      if (session && after) { var a = after; after = null; if (location.hash !== a) { location.hash = a; return; } }
      route();
    }, 0);
  });

  // ---------- navigation ----------
  function drawNav(hash) {
    function link(to, text) { return h('a', { href: to, class: hash === to ? 'on' : null }, text); }
    var items = [link('#/calls', 'Calls for papers')];
    if (session) {
      items.unshift(link('#/', 'My submissions'));
      if (isStaff()) items.push(link('#/admin/submissions', 'All submissions'));
      if (hasRole('admin')) items.push(link('#/admin/calls', 'Manage calls'), link('#/admin/people', 'People'));
      items.push(link('#/profile', 'Profile'));
      items.push(h('span', { class: 'who' }, (profile && profile.full_name) || session.user.email));
      items.push(h('button', { type: 'button', onclick: function () { sb.auth.signOut(); } }, 'Sign out'));
    } else {
      items.push(link('#/login', 'Sign in'));
    }
    nav.replaceChildren.apply(nav, items);
  }
  var routes = [
    [/^#\/?$/, function () { return session ? dashboard() : loginView(); }],
    [/^#\/login$/, function () { return session ? go('#/') : loginView(); }],
    [/^#\/signup$/, function () { return session ? go('#/') : signupView(); }], [/^#\/calls$/, callsView],
    [/^#\/call\/([A-Z0-9]{2,10})$/, callView],
    [/^#\/profile$/, guard(profileView)],
    [/^#\/submission\/([0-9a-f-]{36})$/, guard(submissionView)],
    [/^#\/admin\/calls$/, guard(adminCalls)], [/^#\/admin\/submissions$/, guard(adminSubmissions)],
    [/^#\/admin\/people$/, guard(adminPeople)]
  ];
  function guard(fn) { return function (a) { return session ? fn(a) : loginView(); }; }
  async function route() {
    notice(flash); flash = null;
    if (recovering) { drawNav(''); return newPasswordView(); }
    var hash = location.hash || '#/', i, m;
    if (/access_token|error_description|type=/.test(hash)) hash = '#/';
    for (i = 0; i < routes.length; i++) {
      m = hash.match(routes[i][0]);
      if (m) {
        drawNav(hash);
        try { await routes[i][1](m[1]); } catch (e) { fail(e); }
        return;
      }
    }
    location.hash = '#/';
  }
  window.addEventListener('hashchange', route);

  // ---------- sign in, sign up, password ----------
  function loginView() {
    var email = h('input', { type: 'email', autocomplete: 'email', required: true });
    var pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Sign in');
    var form = h('form', { class: 'card auth stack', onsubmit: function (e) {
      e.preventDefault();
      busy(btn, async function () { ok(await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value })); });
    } },
      h('h1', null, 'Sign in'), h('p', { class: 'muted' }, 'Welcome back. Your drafts are where you left them.'),
      field('Email', email), field('Password', pass), btn,
      h('p', { class: 'small' }, h('a', { href: '#/signup' }, 'Create an account'), ' · ',
        h('a', { href: '#', onclick: function (e) {
          e.preventDefault();
          if (!email.value) return notice('Type your email above first, then choose "Forgot password".', 'err');
          sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + '/portal/' })
            .then(function (r) { if (r.error) fail(r.error); else notice('If that email has an account, a reset link is on its way.'); });
        } }, 'Forgot password?')));
    show(form);
  }
  function signupView() {
    var name = h('input', { type: 'text', autocomplete: 'name', required: true });
    var email = h('input', { type: 'email', autocomplete: 'email', required: true });
    var pass = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '8' });
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Create account');
    show(h('form', { class: 'card auth stack', onsubmit: function (e) {
      e.preventDefault();
      busy(btn, async function () {
        var d = ok(await sb.auth.signUp({ email: email.value.trim(), password: pass.value,
          options: { data: { full_name: name.value.trim() }, emailRedirectTo: location.origin + '/portal/' } }));
        if (!d.session) show(h('div', { class: 'card auth' }, h('h1', null, 'Check your email'),
          h('p', { class: 'muted' }, 'We sent a confirmation link to ' + email.value.trim() + '. Open it to finish creating your account.')));
      });
    } },
      h('h1', null, 'Create an account'), h('p', { class: 'muted' }, 'One account works for submitting, reviewing and editing.'),
      field('Full name', name), field('Email', email), field('Password', pass, 'At least 8 characters.'), btn,
      h('p', { class: 'small' }, 'Already registered? ', h('a', { href: '#/login' }, 'Sign in'))));
  }
  function newPasswordView() {
    var pass = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '8' });
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Save new password');
    show(h('form', { class: 'card auth stack', onsubmit: function (e) {
      e.preventDefault();
      busy(btn, async function () {
        ok(await sb.auth.updateUser({ password: pass.value }));
        recovering = false; go('#/', 'Password updated.');
      });
    } }, h('h1', null, 'Choose a new password'), field('New password', pass, 'At least 8 characters.'), btn));
  }

  // ---------- author: dashboard ----------
  async function dashboard() {
    var rows = ok(await sb.from('submissions')
      .select('id,paper_id,title,status,version,updated_at,venues(name),tracks(code)')
      .eq('owner_id', session.user.id).order('updated_at', { ascending: false }));
    var groups = [
      ['Drafts', ['draft']], ['Needs your revision', ['revision_requested']],
      ['Being processed', ['submitted', 'under_review', 'revision_submitted']],
      ['Decided', ['accepted', 'rejected', 'withdrawn']]
    ];
    var out = [h('div', { class: 'head' },
      h('div', null, h('h1', null, 'My submissions'), h('p', { class: 'muted' }, 'Everything you have started or submitted.')),
      h('a', { class: 'btn', href: '#/calls' }, 'Start a new submission'))];
    if (profile && !profile.institution) {
      out.push(h('div', { class: 'card' }, h('p', null, 'Your profile is missing your institution. ',
        h('a', { href: '#/profile' }, 'Complete your profile'), ' so editors know who you are.')));
    }
    if (!rows.length) out.push(h('div', { class: 'empty' }, 'Nothing here yet. Pick an open call to begin.'));
    groups.forEach(function (g) {
      var mine = rows.filter(function (r) { return g[1].indexOf(r.status) >= 0; });
      if (!mine.length) return;
      out.push(h('h2', { style: 'margin:22px 0 10px' }, g[0] + ' (' + mine.length + ')'));
      out.push(h('ul', { class: 'list' }, mine.map(function (r) {
        return h('li', { class: 'item' },
          h('div', null,
            h('div', { class: 't' }, r.title || 'Untitled draft'),
            h('div', { class: 'm' }, [r.paper_id, r.venues && r.venues.name, 'Version ' + r.version, 'Updated ' + day(r.updated_at)].filter(Boolean).join(' · '))),
          h('div', { class: 'row' }, tag(r.status), h('a', { class: 'btn ghost tiny', href: '#/submission/' + r.id }, r.status === 'draft' || r.status === 'revision_requested' ? 'Continue' : 'View')));
      })));
    });
    show.apply(null, out);
  }

  // ---------- calls for papers ----------
  async function callsView() {
    var venues = ok(await sb.from('venues')
      .select('id,code,name,type,partner_name,description,opens_on,closes_on,tracks(id,code,name)')
      .eq('status', 'open').order('closes_on'));
    var out = [h('div', { class: 'head' }, h('div', null, h('h1', null, 'Calls for papers'),
      h('p', { class: 'muted' }, 'Open issues, special calls and partner conferences.')))];
    if (!venues.length) out.push(h('div', { class: 'empty' }, 'No calls are open right now. Please check back soon.'));
    venues.forEach(function (v) { out.push(callCard(v)); });
    show.apply(null, out);
  }
  async function callView(code) {
    var v = ok(await sb.from('venues')
      .select('id,code,name,type,partner_name,description,opens_on,closes_on,tracks(id,code,name)')
      .eq('code', code).eq('status', 'open').maybeSingle());
    show(v ? callCard(v) : h('div', { class: 'empty' }, 'This call is not open for submissions right now.'),
      h('p', null, h('a', { href: '#/calls' }, 'See all open calls')));
  }
  function callCard(v) {
      var btn = h('button', { class: 'btn', type: 'button', onclick: function () { busy(btn, function () { return startSubmission(v); }); } }, 'Start a submission');
      return h('div', { class: 'card stack' },
        h('div', null, h('span', { class: 'label' }, VENUE[v.type] + (v.partner_name ? ' · with ' + v.partner_name : '')), h('h2', null, v.name)),
        v.description ? h('p', { style: 'white-space:pre-line' }, v.description) : null,
        h('p', { class: 'small muted' }, v.closes_on ? 'Closes ' + day(v.closes_on) : 'Open until further notice'),
        h('div', { class: 'row' }, v.tracks.map(function (t) { return h('span', { class: 'tag' }, t.code + ' · ' + t.name); })),
        h('div', null, btn));
  }
  async function startSubmission(v) {
    if (!session) { after = location.hash; return go('#/login', 'Sign in or create an account to start a submission.'); }
    if (!v.tracks.length) throw new Error('This call has no tracks yet. Please try again later.');
    var s = ok(await sb.from('submissions').insert({ venue_id: v.id, track_id: v.tracks[0].id, article_type: v.type === 'conference' ? 'abstract' : 'research_article' }).select('id').single());
    ok(await sb.from('submission_authors').insert({
      submission_id: s.id, position: 1, full_name: (profile && profile.full_name) || session.user.email,
      email: session.user.email, affiliation: profile && profile.institution, country: profile && profile.country, is_corresponding: true
    }));
    go('#/submission/' + s.id);
  }

  // ---------- submission editor ----------
  async function submissionView(id) {
    var s = ok(await sb.from('submissions').select('*, venues(id,code,name,type,status,closes_on)').eq('id', id).maybeSingle());
    if (!s) { show(h('div', { class: 'empty' }, 'That submission was not found.')); return; }
    var authors = ok(await sb.from('submission_authors').select('*').eq('submission_id', id).order('position'));
    var tracks = ok(await sb.from('tracks').select('id,code,name').eq('venue_id', s.venue_id).order('code'));
    var editable = s.owner_id === session.user.id && (s.status === 'draft' || s.status === 'revision_requested');
    var off = !editable;

    var trackOpts = {}; tracks.forEach(function (t) { trackOpts[t.id] = t.code + ' · ' + t.name; });
    var track = select(trackOpts, s.track_id, { disabled: off });
    var isConf = s.venues.type === 'conference';
    var typeOpts = {};
    (isConf ? CONF_TYPES : JOURNAL_TYPES).forEach(function (k) { typeOpts[k] = ARTICLE[k]; });
    if (!typeOpts[s.article_type]) typeOpts[s.article_type] = ARTICLE[s.article_type];
    var type = select(typeOpts, s.article_type, { disabled: off });
    var guide = h('p', { class: 'small muted' });
    function drawGuide() { guide.textContent = GUIDE[type.value] || ''; }
    type.addEventListener('change', drawGuide); drawGuide();
    var mode = select({ '': 'Choose one', on_site: 'On-site (in person)', online: 'Online' }, s.attendance_mode || '', { disabled: off });
    var title = h('input', { type: 'text', value: s.title, disabled: off, maxlength: '300' });
    var abstract = h('textarea', { disabled: off }); abstract.value = s.abstract;
    var count = h('p', { class: 'count' });
    function words() { var n = (abstract.value.trim().match(/\S+/g) || []).length; count.textContent = n + (n === 1 ? ' word' : ' words'); }
    abstract.addEventListener('input', words); words();
    var keywords = h('input', { type: 'text', value: s.keywords.join(', '), disabled: off });
    var d1 = h('input', { type: 'checkbox', checked: s.declared_original, disabled: off });
    var d2 = h('input', { type: 'checkbox', checked: s.declared_ai_use, disabled: off });
    var d3 = h('input', { type: 'checkbox', checked: s.declared_consent, disabled: off });
    var ai = h('textarea', { disabled: off, style: 'min-height:80px' }); ai.value = s.ai_use_statement || '';

    // authors
    var authorBox = h('div', { class: 'stack' });
    function drawAuthors() {
      authorBox.replaceChildren.apply(authorBox, authors.map(function (a, i) {
        function bind(key, type) {
          return h('input', { type: type || 'text', value: a[key] || '', disabled: off, oninput: function (e) { a[key] = e.target.value; } });
        }
        var radio = h('input', { type: 'radio', name: 'corr', checked: a.is_corresponding, disabled: off, onchange: function () {
          authors.forEach(function (x) { x.is_corresponding = x === a; });
        } });
        radio.id = 'f' + (++uid);
        return h('div', { class: 'author' },
          h('div', { class: 'row', style: 'justify-content:space-between' },
            h('strong', null, 'Author ' + (i + 1)),
            editable ? h('div', { class: 'row' },
              i > 0 ? h('button', { class: 'btn ghost tiny', type: 'button', onclick: function () { authors.splice(i - 1, 0, authors.splice(i, 1)[0]); drawAuthors(); } }, 'Move up') : null,
              authors.length > 1 ? h('button', { class: 'btn ghost tiny', type: 'button', onclick: function () { authors.splice(i, 1); drawAuthors(); } }, 'Remove') : null) : null),
          h('div', { class: 'grid2' }, field('Full name', bind('full_name')), field('Email', bind('email', 'email'))),
          h('div', { class: 'grid2' }, field('Institution', bind('affiliation')), field('Country', bind('country'))),
          h('div', { class: 'check' }, radio, h('label', { for: radio.id }, 'Corresponding author')));
      }));
    }
    drawAuthors();

    // files
    var fileBox = h('div', { class: 'stack' });
    async function drawFiles() {
      var files = ok(await sb.from('submission_files').select('*').eq('submission_id', id).order('created_at'));
      fileBox.replaceChildren(files.length ? h('ul', { class: 'list' }, files.map(function (f) {
        return h('li', { class: 'item' },
          h('div', null, h('div', { class: 't' }, f.file_name), h('div', { class: 'm' }, KIND[f.kind] + ' · version ' + f.version + ' · ' + day(f.created_at))),
          h('div', { class: 'row' },
            h('button', { class: 'btn ghost tiny', type: 'button', onclick: async function () {
              try { var u = ok(await sb.storage.from('manuscripts').createSignedUrl(f.storage_path, 120, { download: f.file_name })); location.assign(u.signedUrl); } catch (e) { fail(e); }
            } }, 'Download'),
            editable ? h('button', { class: 'btn ghost tiny', type: 'button', onclick: async function () {
              try { ok(await sb.storage.from('manuscripts').remove([f.storage_path])); ok(await sb.from('submission_files').delete().eq('id', f.id)); drawFiles(); } catch (e) { fail(e); }
            } }, 'Remove') : null));
      })) : h('div', { class: 'empty' }, 'No files uploaded yet.'));
    }
    await drawFiles();
    var kind = select({ blinded_manuscript: KIND.blinded_manuscript, title_page: KIND.title_page, supplementary: KIND.supplementary }, 'blinded_manuscript');
    var picker = h('input', { type: 'file', accept: '.pdf,.doc,.docx' });
    var upBtn = h('button', { class: 'btn ghost', type: 'button', onclick: function () {
      busy(upBtn, async function () {
        var f = picker.files[0];
        if (!f) throw new Error('Choose a file first.');
        if (f.size > 20 * 1024 * 1024) throw new Error('Files can be up to 20 MB.');
        var path = id + '/' + Date.now() + '-' + f.name.replace(/[^A-Za-z0-9._-]+/g, '_');
        ok(await sb.storage.from('manuscripts').upload(path, f));
        ok(await sb.from('submission_files').insert({ submission_id: id, kind: kind.value, version: s.version, storage_path: path, file_name: f.name, size_bytes: f.size }));
        picker.value = ''; notice('File uploaded.'); drawFiles();
      });
    } }, 'Upload');

    async function save() {
      var list = authors.map(function (a, i) {
        if (!(a.full_name || '').trim() || !(a.email || '').trim()) throw new Error('Author ' + (i + 1) + ' needs a name and an email.');
        return { submission_id: id, position: i + 1, full_name: a.full_name.trim(), email: a.email.trim(),
          affiliation: a.affiliation || null, country: a.country || null, is_corresponding: !!a.is_corresponding };
      });
      if (list.filter(function (a) { return a.is_corresponding; }).length !== 1) throw new Error('Mark exactly one corresponding author.');
      var kw = keywords.value.split(',').map(function (k) { return k.trim(); }).filter(Boolean);
      if (isConf && kw.length > 5) throw new Error('Please use at most 5 keywords.');
      ok(await sb.from('submissions').update({
        attendance_mode: isConf ? (mode.value || null) : null,
        track_id: track.value, article_type: type.value, title: title.value.trim(), abstract: abstract.value.trim(),
        keywords: kw,
        declared_original: d1.checked, declared_ai_use: d2.checked, declared_consent: d3.checked,
        ai_use_statement: ai.value.trim() || null
      }).eq('id', id));
      ok(await sb.from('submission_authors').delete().eq('submission_id', id));
      ok(await sb.from('submission_authors').insert(list));
    }
    var saveBtn = h('button', { class: 'btn ghost', type: 'button', onclick: function () { busy(saveBtn, async function () { await save(); notice('Draft saved.'); }); } }, 'Save draft');
    var sendBtn = h('button', { class: 'btn', type: 'button', onclick: function () {
      busy(sendBtn, async function () {
        await save();
        var pid = ok(await sb.rpc('submit_submission', { p_submission: id }));
        go('#/', 'Submitted. Your paper ID is ' + pid + '.');
      });
    } }, 'Submit manuscript');
    var armed = false;
    var delBtn = h('button', { class: 'btn ghost', type: 'button', onclick: function () {
      if (!armed) { armed = true; delBtn.textContent = 'Click again to delete this draft'; return; }
      busy(delBtn, async function () {
        var files = ok(await sb.from('submission_files').select('storage_path').eq('submission_id', id));
        if (files.length) ok(await sb.storage.from('manuscripts').remove(files.map(function (f) { return f.storage_path; })));
        ok(await sb.from('submissions').delete().eq('id', id));
        go('#/', 'Draft deleted.');
      });
    } }, 'Delete draft');

    show(
      h('div', { class: 'head' }, h('div', null,
        h('span', { class: 'label' }, s.venues.name), h('h1', null, s.paper_id ? s.paper_id + ' · ' + (s.title || 'Untitled') : (s.title || 'New submission')),
        h('p', { class: 'muted' }, 'Version ' + s.version + (s.submitted_at ? ' · Submitted ' + day(s.submitted_at) : ''))), tag(s.status)),
      off ? h('div', { class: 'card' }, h('p', null, 'This submission is with the editorial office and can no longer be edited here.')) : null,
      h('div', { class: 'card stack' }, h('h2', null, 'Manuscript details'),
        h('div', { class: 'grid2' }, field('Track', track), field(isConf ? 'Submission type' : 'Article type', type)), guide,
        isConf ? field('How do you plan to take part?', mode) : null,
        field('Title', title), h('div', null, field('Abstract', abstract), count),
        field('Keywords', keywords, isConf ? 'Up to 5, separated with commas.' : 'Separate with commas.')),
      h('div', { class: 'card stack' }, h('h2', null, 'Authors'),
        h('p', { class: 'small muted' }, 'List authors in the order they should appear. Reviewers never see this section.'),
        authorBox,
        editable ? h('div', null, h('button', { class: 'btn ghost', type: 'button', onclick: function () {
          authors.push({ full_name: '', email: '', affiliation: '', country: '', is_corresponding: false }); drawAuthors();
        } }, 'Add co-author')) : null),
      h('div', { class: 'card stack' }, h('h2', null, 'Files'),
        h('p', { class: 'small muted' }, 'Upload a blinded manuscript with no author names or affiliations, and a separate title page. PDF or Word, up to 20 MB each.' + (isConf ? ' Format: MS Word, Times New Roman 12 pt, 1.5 line spacing, 1-inch margins.' : '')),
        fileBox,
        editable ? h('div', { class: 'grid2' }, field('File type', kind), field('File', picker)) : null,
        editable ? h('div', null, upBtn) : null),
      h('div', { class: 'card stack' }, h('h2', null, 'Declarations'),
        h('div', { class: 'check' }, d1, h('label', { for: (d1.id = 'f' + (++uid)) }, 'This work is original, is not plagiarised, and is not published or under review elsewhere.')),
        h('div', { class: 'check' }, d2, h('label', { for: (d2.id = 'f' + (++uid)) }, 'Any AI tools were used only for assistance, are disclosed below, and are not listed as authors.')),
        h('div', { class: 'check' }, d3, h('label', { for: (d3.id = 'f' + (++uid)) }, 'All authors have approved this submission and agree to double-blind peer review.')),
        field('How AI tools were used, if at all', ai, 'For example: "Grammar checking only". Leave blank if none were used.')),
      editable ? h('div', { class: 'row' }, sendBtn, saveBtn, s.status === 'draft' ? delBtn : null) : null
    );
  }

  // ---------- profile ----------
  function profileView() {
    var p = profile || {};
    function txt(k, attrs) { var a = attrs || {}; a.type = a.type || 'text'; a.value = p[k] == null ? '' : p[k]; return h('input', a); }
    function area(k, px) { var t = h('textarea', { style: 'min-height:' + (px || 90) + 'px' }); t.value = p[k] || ''; return t; }
    function list(k, ph) { return h('input', { type: 'text', value: (p[k] || []).join(', '), placeholder: ph || '' }); }
    var text = {
      full_name: txt('full_name', { required: true }), designation: txt('designation'), department: txt('department'),
      institution: txt('institution'), city: txt('city'), country: txt('country'), phone: txt('phone', { type: 'tel' }),
      orcid: txt('orcid', { placeholder: '0000-0000-0000-0000' }), scholar_url: txt('scholar_url', { type: 'url', placeholder: 'https://' }),
      bio: area('bio', 100), review_experience: area('review_experience', 80)
    };
    var pick = {
      salutation: select({ '': 'Choose', 'Dr.': 'Dr.', 'Prof.': 'Prof.', 'Mr.': 'Mr.', 'Ms.': 'Ms.', 'Mx.': 'Mx.' }, p.salutation || ''),
      highest_qualification: select({ '': 'Choose', 'Doctorate (PhD, FPM or equivalent)': 'Doctorate (PhD, FPM or equivalent)', 'Pursuing a doctorate': 'Pursuing a doctorate',
        "Master's degree": "Master's degree", "Bachelor's degree": "Bachelor's degree", 'Other': 'Other' }, p.highest_qualification || '')
    };
    var lists = {
      research_areas: list('research_areas', 'e.g. sustainable finance, ESG reporting, fintech'),
      methods: list('methods', 'e.g. PLS-SEM, panel data, case study, bibliometrics'),
      review_interests: list('review_interests', 'e.g. corporate governance, consumer analytics')
    };
    var nums = { experience_years: txt('experience_years', { type: 'number', min: '0', max: '70' }), reviews_per_year: txt('reviews_per_year', { type: 'number', min: '0', max: '50' }) };
    var willing = h('input', { type: 'checkbox', checked: !!p.willing_to_review });
    willing.id = 'f' + (++uid);
    var revBox = h('div', { class: 'stack' },
      field('Topics you are comfortable reviewing', lists.review_interests, 'Separate with commas. Editors use this to match papers to you.'),
      h('div', { class: 'grid2' }, field('Papers you can review in a year', nums.reviews_per_year), field('Methods you can assess', lists.methods, 'Separate with commas.')),
      field('Reviewing experience (optional)', text.review_experience, 'Journals or conferences you have reviewed for, if any. First-time reviewers are welcome.'));
    function toggle() { revBox.style.display = willing.checked ? '' : 'none'; }
    willing.addEventListener('change', toggle); toggle();
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Save profile');
    show(h('div', { class: 'head' }, h('div', null, h('h1', null, 'My profile'),
        h('p', { class: 'muted' }, 'Roles: ' + (p.roles || ['author']).join(', ') + ' · ' + (p.email || '')))),
      h('form', { onsubmit: function (e) {
        e.preventDefault();
        busy(btn, async function () {
          var upd = { willing_to_review: willing.checked }, k, n;
          for (k in text) upd[k] = text[k].value.trim() || (k === 'full_name' ? '' : null);
          for (k in pick) upd[k] = pick[k].value || null;
          for (k in lists) upd[k] = lists[k].value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
          for (k in nums) { n = parseInt(nums[k].value, 10); upd[k] = isNaN(n) ? null : n; }
          ok(await sb.from('profiles').update(upd).eq('id', session.user.id));
          await loadProfile(); drawNav('#/profile'); notice('Profile saved.');
        });
      } },
        h('div', { class: 'card stack' }, h('h2', null, 'About you'),
          h('div', { class: 'grid2' }, field('Title', pick.salutation), field('Full name', text.full_name)),
          h('div', { class: 'grid2' }, field('Designation', text.designation, 'For example: Assistant Professor, Research Scholar, Manager.'), field('Department or area', text.department)),
          h('div', { class: 'grid2' }, field('Institution or organisation', text.institution), field('City', text.city)),
          h('div', { class: 'grid2' }, field('Country', text.country), field('Phone (optional)', text.phone))),
        h('div', { class: 'card stack' }, h('h2', null, 'Academic background'),
          h('div', { class: 'grid2' }, field('Highest qualification', pick.highest_qualification), field('Years of research or teaching experience', nums.experience_years)),
          h('div', { class: 'grid2' }, field('ORCID (optional)', text.orcid), field('Google Scholar or profile link (optional)', text.scholar_url)),
          field('Short bio (optional)', text.bio, 'Two or three sentences. Shown to editors only.')),
        h('div', { class: 'card stack' }, h('h2', null, 'Research interests'),
          field('Your research areas', lists.research_areas, 'Separate with commas.')),
        h('div', { class: 'card stack' }, h('h2', null, 'Reviewing'),
          h('p', { class: 'muted' }, 'Good reviewers make good journals. If you are willing, editors may invite you for a few papers a year in your own areas. You can always decline an invitation.'),
          h('div', { class: 'check' }, willing, h('label', { for: willing.id }, 'Yes, I would like to be considered as a reviewer.')),
          revBox),
        h('div', null, btn)));
  }

  // ---------- admin ----------
  function staffOnly(role) {
    if (role === 'admin' ? hasRole('admin') : isStaff()) return true;
    show(h('div', { class: 'empty' }, 'This page is for the editorial office.'));
    return false;
  }
  async function adminCalls() {
    if (!staffOnly('admin')) return;
    var venues = ok(await sb.from('venues').select('*, tracks(id,code,name)').order('created_at', { ascending: false }));
    var f = {
      code: h('input', { type: 'text', required: true, placeholder: 'IBC0101', maxlength: '10' }),
      name: h('input', { type: 'text', required: true }),
      type: select(VENUE, 'journal_issue'),
      partner_name: h('input', { type: 'text' }),
      opens_on: h('input', { type: 'date' }), closes_on: h('input', { type: 'date' }),
      description: h('textarea', { style: 'min-height:90px' })
    };
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Create call (as draft)');
    var out = [h('div', { class: 'head' }, h('div', null, h('h1', null, 'Manage calls'),
        h('p', { class: 'muted' }, 'A call can be a journal issue, a special call for papers or a partner conference. Authors only see calls marked Open.'))),
      h('form', { class: 'card stack', onsubmit: function (e) {
        e.preventDefault();
        busy(btn, async function () {
          ok(await sb.from('venues').insert({ code: f.code.value.trim().toUpperCase(), name: f.name.value.trim(), type: f.type.value,
            partner_name: f.partner_name.value.trim() || null, opens_on: f.opens_on.value || null, closes_on: f.closes_on.value || null,
            description: f.description.value.trim() || null }));
          go('#/admin/calls', 'Call created. Add tracks, then set it to Open.');
        });
      } }, h('h2', null, 'New call'),
        h('div', { class: 'grid2' }, field('Short code', f.code, 'Capital letters and digits. It starts every paper ID, e.g. IBC0101-FIN-001.'), field('Name', f.name)),
        h('div', { class: 'grid2' }, field('Type', f.type), field('Partner (conferences only)', f.partner_name)),
        h('div', { class: 'grid2' }, field('Opens on', f.opens_on), field('Closes on', f.closes_on)),
        field('Description shown to authors', f.description), h('div', null, btn))];
    venues.forEach(function (v) {
      var status = select({ draft: 'Draft (hidden)', open: 'Open', closed: 'Closed', archived: 'Archived (hidden)' }, v.status, { onchange: async function () {
        try { ok(await sb.from('venues').update({ status: status.value }).eq('id', v.id)); notice(v.name + ' is now ' + status.value + '.'); } catch (e) { fail(e); }
      } });
      var tc = h('input', { type: 'text', placeholder: 'FIN', maxlength: '5' }), tn = h('input', { type: 'text', placeholder: 'Finance and accounting' });
      var add = h('button', { class: 'btn ghost', type: 'button', onclick: function () {
        busy(add, async function () {
          ok(await sb.from('tracks').insert({ venue_id: v.id, code: tc.value.trim().toUpperCase(), name: tn.value.trim() }));
          go('#/admin/calls', 'Track added.');
        });
      } }, 'Add track');
      var en = h('input', { type: 'text', value: v.name }), ep = h('input', { type: 'text', value: v.partner_name || '' });
      var eo = h('input', { type: 'date', value: v.opens_on || '' }), ec = h('input', { type: 'date', value: v.closes_on || '' });
      var ed = h('textarea', { style: 'min-height:90px' }); ed.value = v.description || '';
      var es = h('button', { class: 'btn ghost', type: 'button', onclick: function () {
        busy(es, async function () {
          ok(await sb.from('venues').update({ name: en.value.trim(), partner_name: ep.value.trim() || null,
            opens_on: eo.value || null, closes_on: ec.value || null, description: ed.value.trim() || null }).eq('id', v.id));
          go('#/admin/calls', 'Details saved.');
        });
      } }, 'Save details');
      out.push(h('div', { class: 'card stack' },
        h('div', { class: 'row', style: 'justify-content:space-between' },
          h('div', null, h('span', { class: 'label' }, v.code + ' · ' + VENUE[v.type]), h('h2', null, v.name)),
          h('div', { style: 'min-width:190px' }, field('Status', status))),
        h('ul', { class: 'list' }, v.tracks.map(function (t) {
          return h('li', { class: 'item' }, h('div', { class: 't' }, t.code + ' · ' + t.name),
            h('button', { class: 'btn ghost tiny', type: 'button', onclick: async function () {
              var r = await sb.from('tracks').delete().eq('id', t.id);
              if (r.error) fail(new Error('This track already has submissions and cannot be removed.')); else go('#/admin/calls', 'Track removed.');
            } }, 'Remove'));
        })),
        h('div', { class: 'grid2' }, field('Track code (2 to 5 letters)', tc), field('Track name', tn)),
        h('div', null, add),
        h('p', { class: 'small muted' }, 'Direct link for authors: ' + location.origin + '/portal/#/call/' + v.code),
        h('details', null, h('summary', null, 'Edit details'),
          h('div', { class: 'stack', style: 'margin-top:12px' },
            h('div', { class: 'grid2' }, field('Name', en), field('Partner', ep)),
            h('div', { class: 'grid2' }, field('Opens on', eo), field('Closes on', ec)),
            field('Description shown to authors', ed), h('div', null, es)))));
    });
    show.apply(null, out);
  }
  async function adminSubmissions() {
    if (!staffOnly('staff')) return;
    var rows = ok(await sb.from('submissions')
      .select('id,paper_id,title,status,submitted_at,venues(code),tracks(code),profiles(full_name,email)')
      .neq('status', 'draft').order('submitted_at', { ascending: false }));
    show(h('div', { class: 'head' }, h('div', null, h('h1', null, 'All submissions'),
        h('p', { class: 'muted' }, 'Read-only for now. Assigning reviewers and recording decisions arrive in the next stage.'))),
      rows.length ? h('div', { class: 'card scroll' }, h('table', null,
        h('thead', null, h('tr', null, ['Paper ID', 'Title', 'Submitted by', 'Submitted', 'Status', ''].map(function (t) { return h('th', null, t); }))),
        h('tbody', null, rows.map(function (r) {
          return h('tr', null, h('td', null, r.paper_id), h('td', null, r.title),
            h('td', null, r.profiles ? (r.profiles.full_name || r.profiles.email) : ''), h('td', null, day(r.submitted_at)),
            h('td', null, tag(r.status)), h('td', null, h('a', { href: '#/submission/' + r.id }, 'Open')));
        })))) : h('div', { class: 'empty' }, 'No submissions yet.'));
  }
  async function adminPeople() {
    if (!staffOnly('admin')) return;
    var people = ok(await sb.from('profiles').select('id,full_name,email,institution,department,roles,willing_to_review,review_interests').order('created_at'));
    show(h('div', { class: 'head' }, h('div', null, h('h1', null, 'People'),
        h('p', { class: 'muted' }, 'Everyone is an author. Tick extra roles to make someone a reviewer, editor or admin.'))),
      h('div', { class: 'card scroll' }, h('table', null,
        h('thead', null, h('tr', null, ['Name', 'Institution', 'Reviewer', 'Editor', 'Admin'].map(function (t) { return h('th', null, t); }))),
        h('tbody', null, people.map(function (p) {
          function box(role) {
            var c = h('input', { type: 'checkbox', checked: p.roles.indexOf(role) >= 0, 'aria-label': role + ' role for ' + (p.full_name || p.email),
              disabled: role === 'admin' && p.id === session.user.id, onchange: async function () {
                var roles = p.roles.filter(function (r) { return r !== role; });
                if (c.checked) roles.push(role);
                var r = await sb.rpc('set_user_roles', { p_user: p.id, p_roles: roles });
                if (r.error) { c.checked = !c.checked; fail(r.error); } else { p.roles = roles; notice('Roles updated for ' + (p.full_name || p.email) + '.'); }
              } });
            return h('td', null, c);
          }
          return h('tr', null, h('td', null, h('div', { class: 't' }, p.full_name || '(no name yet)'), h('div', { class: 'small muted' }, p.email),
              p.willing_to_review ? h('div', { class: 'small' }, h('span', { class: 'tag good' }, 'Wants to review'), ' ', (p.review_interests || []).join(', ')) : null),
            h('td', null, [p.department, p.institution].filter(Boolean).join(', ')), box('reviewer'), box('editor'), box('admin'));
        })))));
  }
})();
