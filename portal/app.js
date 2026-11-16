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
  var ARTICLE = { research_article: 'Research article', case_study: 'Case study', short_case: 'Short case', conference_paper: 'Conference paper',
    research_note: 'Research note', perspective: 'Perspective (by invitation)', graphic_case: 'Graphic teaching case',
    abstract: 'Abstract', extended_abstract: 'Extended abstract', full_paper: 'Full paper', review_paper: 'Review paper', poster: 'Poster presentation' };
  var JOURNAL_TYPES = ['research_article', 'review_paper', 'research_note', 'perspective', 'case_study', 'short_case', 'graphic_case'];
  // Journal tracks offer only the article types that belong to them (IBC: RES, TC, GC).
  var TRACK_TYPES = { RES: ['research_article', 'review_paper', 'research_note', 'perspective'], TC: ['case_study', 'short_case'], GC: ['graphic_case'] };
  var JLABEL = { case_study: 'Teaching case' };
  var JGUIDE = {
    research_article: '6,000 to 9,000 words, excluding references. Original empirical or conceptual work with a clear theoretical contribution. Upload the blinded manuscript and a separate title page.',
    review_paper: '7,000 to 10,000 words. A systematic, bibliometric or integrative review that concludes with a research agenda. Upload the blinded manuscript and a separate title page.',
    research_note: '3,000 to 4,000 words: a focused finding, a new dataset or a replication. Upload the blinded manuscript and a separate title page.',
    perspective: '2,000 to 3,000 words. Perspectives are published by invitation of the editors. Upload the blinded manuscript and a separate title page.',
    case_study: '3,000 to 6,000 words plus exhibits, built around a clear decision point. Upload the blinded case, a title page and the teaching note (2,500 to 5,000 words). Field cases also need a signed release, uploaded as a supplementary file.',
    short_case: '1,500 to 2,500 words for a single class discussion or examination. Upload the blinded case, a title page and its teaching note.',
    graphic_case: '12 to 30 pages of sequential art. For first submission, upload the full script with a storyboard or rough panels as one PDF, a title page and the teaching note. Final artwork follows acceptance in principle.'
  };
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
  var VENUE = { journal_issue: 'Journal', special_call: 'Special call for papers', conference: 'Partner conference' };
  var KIND = { blinded_manuscript: 'Blinded manuscript', title_page: 'Title page', supplementary: 'Supplementary file', similarity_report: 'Similarity report', teaching_note: 'Teaching note' };

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
  function isStaff() { return isManager() || hasRole('associate_editor') || hasRole('editor') || hasRole('eic') || hasRole('maintenance') || myRoles.length > 0; }
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
    await loadStaff();
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
    var items = [];
    if (!session) {
      items.push(link('#/calls', 'Calls for papers'), link('#/login', 'Sign in'));
    } else {
      var L = lens(), all = lenses(), staff = STAFF_LENSES.indexOf(L) >= 0;
      if (L === 'author') items.push(link('#/', 'My submissions'), link('#/calls', 'Calls for papers'));
      else if (L === 'reviewer') items.push(link('#/', 'My reviews'));
      else {
        items.push(link('#/', 'Desk'));
        if (L === 'venue_editor' || L === 'eic' || L === 'manager') items.push(link('#/team', 'Editorial team'));
        if (L === 'manager') items.push(link('#/admin/calls', 'Manage calls'), link('#/admin/people', 'People'));
        if (L === 'manager' || L === 'maintenance') items.push(link('#/system', 'System'));
      }
      items.push(link('#/inbox', unread ? 'Inbox (' + unread + ')' : 'Inbox'), link('#/profile', 'Profile'));
      if (all.length > 1) {
        var opts = {}; all.forEach(function (k) { opts[k] = LENS[k]; });
        var pick = select(opts, L, { 'aria-label': 'View as', onchange: function () { store('ww_lens', pick.value); go('#/'); } });
        items.push(h('label', { class: 'viewas' }, h('span', null, 'View as'), pick));
        if (staff) {
          var vo = { '': 'All calls' }; scopedVenues(L).forEach(function (v) { vo[v.id] = v.code; });
          var vp = select(vo, venueFilter(L), { 'aria-label': 'Call', onchange: function () { store('ww_venue', vp.value); route(); } });
          items.push(vp);
        }
      }
      items.push(h('span', { class: 'who' }, (profile && profile.full_name) || session.user.email));
      items.push(h('button', { type: 'button', onclick: function () { sb.auth.signOut(); } }, 'Sign out'));
    }
    nav.replaceChildren.apply(nav, items);
  }
  function home() {
    if (!session) return loginView();
    var L = lens();
    return L === 'author' ? dashboard() : L === 'reviewer' ? reviewsView() : deskView();
  }
  var routes = [
    [/^#\/?$/, home],
    [/^#\/login$/, function () { return session ? go('#/') : loginView(); }],
    [/^#\/signup$/, function () { return session ? go('#/') : signupView(); }], [/^#\/calls$/, callsView],
    [/^#\/call\/([A-Z0-9]{2,10})(?:\/([A-Z]{2,5}))?$/, callView],
    [/^#\/profile$/, guard(profileView)],
    [/^#\/submission\/([0-9a-f-]{36})$/, guard(submissionView)],
    [/^#\/desk$/, guard(deskView)], [/^#\/paper\/([0-9a-f-]{36})$/, guard(paperView)],
    [/^#\/reviews$/, guard(reviewsView)], [/^#\/review\/([0-9a-f-]{36})$/, guard(reviewForm)],
    [/^#\/inbox$/, guard(inboxView)], [/^#\/team$/, guard(teamView)], [/^#\/system$/, guard(systemView)],
    [/^#\/admin\/calls$/, guard(adminCalls)], [/^#\/admin\/people$/, guard(adminPeople)]
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
        try { await routes[i][1](m[1], m[2]); } catch (e) { fail(e); }
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
      .select('id,paper_id,title,status,version,article_type,updated_at,venues(name,type),tracks(code)')
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
          h('div', { class: 'row' }, tag(r.status), h('a', { class: 'btn ghost tiny', href: '#/submission/' + r.id }, r.status === 'draft' || r.status === 'revision_requested' ? 'Continue' : (r.status === 'accepted' && r.article_type === 'abstract' && r.venues && r.venues.type === 'conference' ? 'Upload full paper' : 'View'))));
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
  async function callView(code, trk) {
    var v = ok(await sb.from('venues')
      .select('id,code,name,type,partner_name,description,opens_on,closes_on,tracks(id,code,name)')
      .eq('code', code).eq('status', 'open').maybeSingle());
    show(v ? callCard(v, trk) : h('div', { class: 'empty' }, 'This call is not open for submissions right now.'),
      h('p', null, h('a', { href: '#/calls' }, 'See all open calls')));
  }
  function callCard(v, trk) {
      var pick = trk && v.tracks.filter(function (t) { return t.code === trk; })[0];
      var btn = h('button', { class: 'btn', type: 'button', onclick: function () { busy(btn, function () { return startSubmission(v, pick); }); } },
        pick ? 'Start a submission: ' + pick.name : 'Start a submission');
      return h('div', { class: 'card stack' },
        h('div', null, h('span', { class: 'label' }, VENUE[v.type] + (v.partner_name ? ' · with ' + v.partner_name : '')), h('h2', null, v.name)),
        v.description ? h('p', { style: 'white-space:pre-line' }, v.description) : null,
        h('p', { class: 'small muted' }, v.closes_on ? 'Closes ' + day(v.closes_on) : 'Open until further notice'),
        h('div', { class: 'row' }, v.tracks.map(function (t) { return h('span', { class: 'tag' }, t.code + ' · ' + t.name); })),
        h('div', null, btn));
  }
  async function startSubmission(v, pick) {
    if (!session) { after = location.hash; return go('#/login', 'Sign in or create an account to start a submission.'); }
    if (!v.tracks.length) throw new Error('This call has no tracks yet. Please try again later.');
    var t = pick || v.tracks.slice().sort(function (a, b) { return a.code === 'RES' ? -1 : b.code === 'RES' ? 1 : a.code < b.code ? -1 : 1; })[0];
    var first = v.type === 'conference' ? 'abstract' : ((TRACK_TYPES[t.code] || ['research_article'])[0]);
    var s = ok(await sb.from('submissions').insert({ venue_id: v.id, track_id: t.id, article_type: first }).select('id').single());
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
    var mineOwn = s.owner_id === session.user.id;
    var fullStage = mineOwn && s.status === 'accepted' && s.article_type === 'abstract' && s.venues.type === 'conference';
    var editable = mineOwn && (s.status === 'draft' || s.status === 'revision_requested' || fullStage);
    var off = !editable;

    var trackOpts = {}; tracks.forEach(function (t) { trackOpts[t.id] = t.code + ' · ' + t.name; });
    var track = select(trackOpts, s.track_id, { disabled: off });
    var isConf = s.venues.type === 'conference';
    var trackCode = {}; tracks.forEach(function (t) { trackCode[t.id] = t.code; });
    var type = h('select', { disabled: off });
    var guide = h('p', { class: 'small muted' });
    function drawGuide() { guide.textContent = (!isConf && JGUIDE[type.value]) || GUIDE[type.value] || ''; }
    function fillTypes(keep) {
      var list = (isConf ? CONF_TYPES : (TRACK_TYPES[trackCode[track.value]] || JOURNAL_TYPES)).slice();
      if (off && list.indexOf(keep) < 0) list.push(keep);
      type.replaceChildren.apply(type, list.map(function (k) {
        return h('option', { value: k, selected: k === keep }, (!isConf && JLABEL[k]) || ARTICLE[k] || k);
      }));
      drawGuide();
    }
    fillTypes(s.article_type);
    type.addEventListener('change', drawGuide);
    track.addEventListener('change', function () { fillTypes(type.value); });
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
    var kindOpts = { blinded_manuscript: KIND.blinded_manuscript, title_page: KIND.title_page };
    if (!isConf) kindOpts.teaching_note = KIND.teaching_note;
    kindOpts.supplementary = KIND.supplementary;
    var kind = select(kindOpts, 'blinded_manuscript');
    var picker = h('input', { type: 'file', accept: '.pdf,.doc,.docx' });
    var upBtn = h('button', { class: 'btn ghost', type: 'button', onclick: function () {
      busy(upBtn, async function () {
        var f = picker.files[0];
        if (!f) throw new Error('Choose a file first.');
        if (f.size > 20 * 1024 * 1024) throw new Error('Files can be up to 20 MB.');
        var path = id + '/' + Date.now() + '-' + f.name.replace(/[^A-Za-z0-9._-]+/g, '_');
        ok(await sb.storage.from('manuscripts').upload(path, f));
        ok(await sb.from('submission_files').insert({ submission_id: id, kind: kind.value, version: s.status === 'draft' ? s.version : s.version + 1, storage_path: path, file_name: f.name, size_bytes: f.size }));
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
    var revBtn = h('button', { class: 'btn', type: 'button', onclick: function () {
      busy(revBtn, async function () { await save(); ok(await sb.rpc('submit_revision', { p_submission: id })); go('#/', 'Revision submitted. Thank you.'); });
    } }, 'Submit revision');
    var fpType = select({ full_paper: ARTICLE.full_paper, extended_abstract: ARTICLE.extended_abstract, review_paper: ARTICLE.review_paper, case_study: ARTICLE.case_study }, 'full_paper');
    var fpBtn = h('button', { class: 'btn', type: 'button', onclick: function () {
      busy(fpBtn, async function () { await save(); ok(await sb.rpc('submit_full_paper', { p_submission: id, p_type: fpType.value })); go('#/', 'Full paper submitted. Thank you.'); });
    } }, 'Submit full paper');
    var feedback = mineOwn && s.status !== 'draft' ? await feedbackCard(id) : null;
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
      off ? h('div', { class: 'card' }, h('p', null, 'This submission is with the editorial office and can no longer be edited here. You will see a notice in your Inbox when there is news.')) : null,
      feedback,
      mineOwn && s.status === 'revision_requested' ? h('div', { class: 'card' }, h('p', null, 'A revision has been requested. Update the details below, upload your revised files, then choose "Submit revision".')) : null,
      fullStage ? h('div', { class: 'card' }, h('p', null, 'Your abstract has been accepted. Upload the blinded manuscript and a title page in the Files section, choose the paper type at the bottom, then submit your full paper.')) : null,
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
        h('p', { class: 'small muted' }, 'Upload a blinded manuscript with no author names or affiliations, and a separate title page. PDF or Word, up to 20 MB each.' + (isConf ? ' Format: MS Word, Times New Roman 12 pt, 1.5 line spacing, 1-inch margins.' : ' Teaching cases also need a teaching note, which only verified instructors will see once published.')),
        fileBox,
        editable ? h('div', { class: 'grid2' }, field('File type', kind), field('File', picker)) : null,
        editable ? h('div', null, upBtn) : null),
      h('div', { class: 'card stack' }, h('h2', null, 'Declarations'),
        h('div', { class: 'check' }, d1, h('label', { for: (d1.id = 'f' + (++uid)) }, 'This work is original, is not plagiarised, and is not published or under review elsewhere.')),
        h('div', { class: 'check' }, d2, h('label', { for: (d2.id = 'f' + (++uid)) }, 'Any AI tools were used only for assistance, are disclosed below, and are not listed as authors.')),
        h('div', { class: 'check' }, d3, h('label', { for: (d3.id = 'f' + (++uid)) }, 'All authors have approved this submission and agree to double-blind peer review.')),
        field('How AI tools were used, if at all', ai, 'For example: "Grammar checking only". Leave blank if none were used.')),
      !editable ? null : s.status === 'draft' ? h('div', { class: 'row' }, sendBtn, saveBtn, delBtn)
        : s.status === 'revision_requested' ? h('div', { class: 'row' }, revBtn, saveBtn)
        : h('div', { class: 'card stack' }, h('h2', null, 'Submit your full paper'), field('Paper type', fpType), h('div', { class: 'row' }, fpBtn, saveBtn))
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
    if (role === 'admin' ? isManager() : isStaff()) return true;
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
  async function adminPeople() {
    if (!staffOnly('admin')) return;
    var people = ok(await sb.from('profiles').select('id,full_name,email,institution,department,roles,willing_to_review,review_interests').order('created_at'));
    show(h('div', { class: 'head' }, h('div', null, h('h1', null, 'People'),
        h('p', { class: 'muted' }, 'Everyone is an author. Tick the journal-wide roles here. Track editors and conference editors are set per call on the Editorial team page.'))),
      h('div', { class: 'card scroll' }, h('table', null,
        h('thead', null, h('tr', null, ['Name', 'Institution', 'Reviewer', 'Associate Editor', 'Editor-in-Chief', 'Manager', 'Maintenance'].map(function (t) { return h('th', null, t); }))),
        h('tbody', null, people.map(function (p) {
          function box(role) {
            var c = h('input', { type: 'checkbox', checked: p.roles.indexOf(role) >= 0, 'aria-label': role + ' role for ' + (p.full_name || p.email),
              disabled: role === 'manager' && p.id === session.user.id, onchange: async function () {
                var roles = p.roles.filter(function (r) { return r !== role; });
                if (c.checked) roles.push(role);
                var r = await sb.rpc('set_user_roles', { p_user: p.id, p_roles: roles });
                if (r.error) { c.checked = !c.checked; fail(r.error); } else { p.roles = roles; notice('Roles updated for ' + (p.full_name || p.email) + '.'); }
              } });
            return h('td', null, c);
          }
          return h('tr', null, h('td', null, h('div', { class: 't' }, p.full_name || '(no name yet)'), h('div', { class: 'small muted' }, p.email),
              p.willing_to_review ? h('div', { class: 'small' }, h('span', { class: 'tag good' }, 'Wants to review'), ' ', (p.review_interests || []).join(', ')) : null),
            h('td', null, [p.department, p.institution].filter(Boolean).join(', ')), box('reviewer'), box('associate_editor'), box('eic'), box('manager'), box('maintenance'));
        })))));
  }

  // =====================================================================
  // Stage 2: roles, the editorial desk, reviewing, inbox, team, system
  // =====================================================================
  var LENS = { author: 'Author', reviewer: 'Reviewer', track_editor: 'Track Editor', venue_editor: 'Conference / CFP Editor',
    associate_editor: 'Associate Editor', eic: 'Editor-in-Chief', manager: 'Manager', maintenance: 'Maintenance' };
  var STAFF_LENSES = ['track_editor', 'venue_editor', 'associate_editor', 'eic', 'manager', 'maintenance'];
  var OUTCOME = { accept: 'Accept', minor_revision: 'Minor revision', major_revision: 'Major revision', reject: 'Not accepted' };
  var ASSIGN = { invited: ['Invited', 'warn'], accepted: ['Reviewing', ''], declined: ['Declined', 'draft'], completed: ['Review received', 'good'], cancelled: ['Cancelled', 'draft'] };
  var SCORES = { originality: 'Originality', relevance: 'Relevance to the track', methodology: 'Methodology', clarity: 'Clarity of writing', contribution: 'Contribution' };
  var PROTOCOL = {
    reviewer: ['Answer each invitation within 5 days, even if the answer is no.', 'You see the blinded manuscript only. Please do not try to identify the authors.',
      'Submit your review within 21 days of accepting.', 'Be specific and kind: say what works, what does not, and how to fix it.', 'Keep the paper confidential and tell the editor about any conflict of interest.'],
    track_editor: ['You see papers in your own track only.', 'Abstracts and posters: read them yourself and recommend an outcome.', 'Full papers: invite two reviewers, and invite a replacement when one declines.',
      'When the reviews are in, recommend an outcome with a letter for the authors.', 'The conference or call editor records the final decision.'],
    venue_editor: ['You see every paper in your call.', 'Appoint track editors on the Editorial team page.', 'Read each recommendation and record the final decision; the author is notified at once.',
      'You may decide without a recommendation when a track has no editor.', 'Watch for overdue reviews and nudge the track editor.'],
    associate_editor: ['You handle journal papers; the ones assigned to you are marked.', 'Invite three reviewers for each paper, and replace any who decline.', 'Record the decision once the reviews are in, with a letter for the authors.',
      'Never handle a paper where you have a conflict of interest; tell the Editor-in-Chief.'],
    eic: ['Assign each new journal paper to an Associate Editor.', 'You may record or override a decision on any journal paper.', 'Keep an eye on papers with no handling editor and on overdue reviews.'],
    manager: ['You can open every role\'s dashboard with the "View as" menu, for all calls or one.', 'The portal shows you what that role sees. Your own papers stay hidden from your editorial view.',
      'Grant roles on the People page and call-specific roles on the Editorial team page.', 'Everything you do is recorded in the activity log on the System page.'],
    maintenance: ['This account can open every dashboard and paper, and can change nothing.', 'Manuscripts and reviews here are confidential. Do not copy them out of the portal.', 'Use the System page for counts and the activity log.']
  };
  var myRoles = [], venues = [], unread = 0;

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* private window */ } return null; }
  function isManager() { return hasRole('manager') || hasRole('admin'); }
  function holds(role) { return myRoles.some(function (r) { return r.role === role; }); }
  function lenses() {
    var l = ['author'], m = isManager();
    if (m || hasRole('reviewer')) l.push('reviewer');
    if (m || holds('track_editor')) l.push('track_editor');
    if (m || holds('venue_editor')) l.push('venue_editor');
    if (m || hasRole('associate_editor') || hasRole('editor')) l.push('associate_editor');
    if (m || hasRole('eic')) l.push('eic');
    if (m) l.push('manager');
    if (m || hasRole('maintenance')) l.push('maintenance');
    return l;
  }
  function bestStaffLens() {
    var all = lenses(), i;
    if (all.indexOf('manager') >= 0) return 'manager';
    for (i = STAFF_LENSES.length - 1; i >= 0; i--) if (all.indexOf(STAFF_LENSES[i]) >= 0) return STAFF_LENSES[i];
    return null;
  }
  function lens() { var l = store('ww_lens'); return lenses().indexOf(l) >= 0 ? l : (bestStaffLens() || 'author'); }
  function staffLens() { var l = lens(); return STAFF_LENSES.indexOf(l) >= 0 ? l : bestStaffLens(); }
  function scopedVenues(L) {
    var m = isManager();
    return venues.filter(function (v) {
      if (L === 'manager' || L === 'maintenance') return true;
      if (L === 'associate_editor' || L === 'eic') return v.type !== 'conference';
      return m || myRoles.some(function (r) { return r.role === L && r.venue_id === v.id; });
    });
  }
  function venueFilter(L) { var v = store('ww_venue') || ''; return scopedVenues(L).some(function (x) { return x.id === v; }) ? v : ''; }
  function inScope(s, L) {
    var vf = venueFilter(L), m = isManager();
    if (vf && s.venue_id !== vf) return false;
    if (L === 'manager' || L === 'maintenance') return true;
    if (L === 'associate_editor' || L === 'eic') return s.venues.type !== 'conference';
    if (m) return true;
    return myRoles.some(function (r) { return r.role === L && r.venue_id === s.venue_id && (L === 'venue_editor' || r.track_id === s.track_id); });
  }
  async function loadStaff() {
    myRoles = []; venues = []; unread = 0;
    if (!session) return;
    var a = await sb.from('venue_roles').select('id,venue_id,role,track_id').eq('user_id', session.user.id);
    if (!a.error) myRoles = a.data;
    var v = await sb.from('venues').select('id,code,name,type,status,tracks(id,code,name)').order('created_at');
    if (!v.error) venues = v.data;
    var n = await sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
    unread = n.count || 0;
  }
  function protocolBox(L) {
    return h('details', { class: 'card protocol' }, h('summary', null, 'Your protocol as ' + LENS[L]),
      h('ol', null, (PROTOCOL[L] || []).map(function (t) { return h('li', null, t); })));
  }
  function needed(s) {
    if (s.venues.type !== 'conference') return 3;
    return s.article_type === 'abstract' || s.article_type === 'poster' ? 0 : 2;
  }
  function progress(s) {
    var cur = (s.review_assignments || []).filter(function (a) { return a.version === s.version; });
    var today = new Date().toISOString().slice(0, 10);
    return {
      need: needed(s),
      done: cur.filter(function (a) { return a.status === 'completed'; }).length,
      active: cur.filter(function (a) { return a.status === 'invited' || a.status === 'accepted'; }).length,
      overdue: cur.some(function (a) { return (a.status === 'accepted' && a.due_on < today) || (a.status === 'invited' && a.respond_by < today); }),
      rec: (s.decisions || []).some(function (d) { return d.kind === 'recommendation' && d.version === s.version; })
    };
  }
  function nextStep(s) {
    var p = progress(s), conf = s.venues.type === 'conference';
    if (s.status === 'revision_requested') return ['With the authors for revision', 'authors'];
    if (s.status === 'accepted') return s.article_type === 'abstract' && conf ? ['Abstract accepted; awaiting the full paper', 'authors'] : ['Accepted', 'decided'];
    if (s.status === 'rejected' || s.status === 'withdrawn') return [STATUS[s.status][0], 'decided'];
    if (p.rec) return ['Recommendation made; awaiting the final decision', 'action'];
    if (p.need === 0) return ['Editor to read and recommend', 'action'];
    if (p.done >= p.need) return ['Reviews are in; ready for an outcome', 'action'];
    if (p.done + p.active < p.need) return ['Invite reviewers (' + (p.done + p.active) + ' of ' + p.need + ' in place)', 'action'];
    return [(p.overdue ? 'Review overdue: ' : 'Awaiting reviews: ') + p.done + ' of ' + p.need + ' received', p.overdue ? 'action' : 'reviewers'];
  }
  function letterFor(outcome, s, name) {
    var hello = 'Dear ' + (name || 'Author') + ',\n\nThank you for submitting "' + s.title + '" (' + s.paper_id + ') to ' + s.venues.name + '. ';
    var bye = '\n\nWith warm regards,\nThe editorial team';
    if (outcome === 'accept') return hello + 'We are pleased to let you know that it has been accepted.' +
      (s.article_type === 'abstract' && s.venues.type === 'conference' ? '\n\nThe next step is to upload your full paper or extended abstract. Open this submission in the portal and you will find the upload section waiting for you.' : '') +
      '\n\nCongratulations, and thank you for sharing your work with us.' + bye;
    if (outcome === 'minor_revision') return hello + 'The reviewers found much to appreciate and have asked for a few small changes.\n\nTheir comments are shown in the portal alongside this letter. Please upload your revised version there and add a short note on how you addressed each point.\n\nWe look forward to the revised paper.' + bye;
    if (outcome === 'major_revision') return hello + 'The reviewers see promise in the work and have asked for substantial revisions before it can be considered further.\n\nTheir comments are shown in the portal alongside this letter. We know a major revision takes real effort, and we would be glad to see the paper again once you have addressed the points raised.' + bye;
    return hello + 'After careful consideration, we are sorry to say that we are unable to accept it on this occasion.\n\nThis is never an easy message to send. We hope the comments shown in the portal are useful as you take the work forward, and we thank you sincerely for considering us.' + bye;
  }
  function download(path, name) {
    return async function () {
      try { var u = ok(await sb.storage.from('manuscripts').createSignedUrl(path, 120, { download: name })); location.assign(u.signedUrl); } catch (e) { fail(e); }
    };
  }
  function kv(pairs) {
    var kids = [];
    pairs.forEach(function (p) { if (p[1]) kids.push(h('dt', null, p[0]), h('dd', null, p[1])); });
    return h('dl', { class: 'kv' }, kids);
  }
  function personSearch(label, onPick, pickText) {
    var q = h('input', { type: 'search', placeholder: 'Name or institution' }), out = h('div', { class: 'stack' });
    async function run() {
      var term = q.value.replace(/[%,()*]/g, ' ').trim(), req = sb.from('profiles').select('id,full_name,email,institution,department,review_interests,willing_to_review');
      req = term ? req.or('full_name.ilike.%' + term + '%,institution.ilike.%' + term + '%') : req.eq('willing_to_review', true);
      var people = ok(await req.order('willing_to_review', { ascending: false }).limit(12));
      out.replaceChildren(people.length ? h('ul', { class: 'list' }, people.map(function (p) {
        var b = h('button', { class: 'btn ghost tiny', type: 'button', onclick: function () { busy(b, function () { return onPick(p); }); } }, pickText);
        return h('li', { class: 'item' }, h('div', null, h('div', { class: 't' }, p.full_name || p.email, p.willing_to_review ? h('span', { class: 'tag good', style: 'margin-left:8px' }, 'Wants to review') : null),
          h('div', { class: 'm' }, [p.department, p.institution].filter(Boolean).join(', ')), (p.review_interests || []).length ? h('div', { class: 'm' }, 'Reviews: ' + p.review_interests.join(', ')) : null), b);
      })) : h('div', { class: 'empty' }, 'Nobody matches. People must have an account on the portal before they can be added.'));
    }
    var go1 = h('button', { class: 'btn ghost', type: 'button', onclick: function () { busy(go1, run); } }, 'Search');
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go1.click(); } });
    return h('div', { class: 'stack' }, h('div', { class: 'row' }, h('div', { style: 'flex:1;min-width:200px' }, field(label, q)), h('div', { style: 'align-self:flex-end' }, go1)),
      h('p', { class: 'small muted' }, 'Leave the box empty and search to list everyone who has volunteered to review.'), out);
  }

  // ---------- editorial desk ----------
  async function deskView() {
    var L = staffLens();
    if (!L) { show(h('div', { class: 'empty' }, 'This page is for the editorial team.')); return; }
    var me = session.user.id;
    var rows = ok(await sb.from('submissions')
      .select('id,paper_id,title,status,version,article_type,submitted_at,owner_id,venue_id,track_id,handling_editor_id,venues(code,name,type),tracks(code,name),review_assignments(status,version,due_on,respond_by),decisions(kind,outcome,version)')
      .neq('status', 'draft').order('submitted_at', { ascending: false }));
    rows = rows.filter(function (r) { return r.owner_id !== me && inScope(r, L); });
    rows.forEach(function (r) { r.step = nextStep(r); });
    var buckets = { action: 'Needs action', reviewers: 'With reviewers', authors: 'With authors', decided: 'Decided', all: 'All papers' };
    var current = 'action', search = h('input', { type: 'search', placeholder: 'Paper ID or title', 'aria-label': 'Search papers' }), listBox = h('div'), tiles = h('div', { class: 'tiles' });
    if (!rows.some(function (r) { return r.step[1] === 'action'; })) current = 'all';
    function draw() {
      tiles.replaceChildren.apply(tiles, Object.keys(buckets).map(function (k) {
        var n = k === 'all' ? rows.length : rows.filter(function (r) { return r.step[1] === k; }).length;
        return h('button', { type: 'button', class: 'tile' + (k === current ? ' on' : ''), 'aria-pressed': k === current ? 'true' : 'false', onclick: function () { current = k; draw(); } }, h('b', null, n), h('span', null, buckets[k]));
      }));
      var term = search.value.trim().toLowerCase();
      var shown = rows.filter(function (r) { return (current === 'all' || r.step[1] === current) && (!term || ((r.paper_id || '') + ' ' + r.title).toLowerCase().indexOf(term) >= 0); });
      listBox.replaceChildren(shown.length ? h('ul', { class: 'list' }, shown.map(function (r) {
        var p = progress(r);
        return h('li', { class: 'item' }, h('div', { style: 'flex:1;min-width:240px' },
          h('div', { class: 'm' }, [r.paper_id, r.tracks.name, ARTICLE[r.article_type], 'Version ' + r.version].join(' · ')),
          h('div', { class: 't' }, r.title), h('div', { class: 'm' }, h('strong', null, 'Next: '), r.step[0]),
          h('div', { class: 'm' }, 'Submitted ' + day(r.submitted_at) + (p.need ? ' · Reviews ' + p.done + ' of ' + p.need : '') +
            (L === 'associate_editor' && r.handling_editor_id === me ? ' · Assigned to you' : '') + (r.venues.type !== 'conference' && !r.handling_editor_id ? ' · No handling editor yet' : ''))),
          h('div', { class: 'row' }, tag(r.status), h('a', { class: 'btn ghost tiny', href: '#/paper/' + r.id }, 'Open')));
      })) : h('div', { class: 'empty' }, rows.length ? 'Nothing in this view.' : 'No papers here yet. They appear as soon as authors submit.'));
    }
    search.addEventListener('input', draw); draw();
    show(h('div', { class: 'head' }, h('div', null, h('span', { class: 'label' }, LENS[L] + ' desk'), h('h1', null, 'Papers in your care'),
        h('p', { class: 'muted' }, L === 'maintenance' ? 'Read-only view of every paper.' : 'Each paper shows whose turn it is. Start with "Needs action".'))),
      protocolBox(L), tiles, h('div', { style: 'margin:14px 0' }, search), listBox,
      isManager() ? h('p', { class: 'small muted', style: 'margin-top:14px' }, 'Papers you wrote yourself are not shown on any editorial desk.') : null);
  }

  // ---------- one paper, as the editorial team sees it ----------
  async function paperView(id) {
    var L = staffLens(), me = session.user.id;
    if (!L) { show(h('div', { class: 'empty' }, 'This page is for the editorial team.')); return; }
    var s = ok(await sb.from('submissions').select('*, venues(id,code,name,type), tracks(code,name), owner:profiles!submissions_owner_id_fkey(full_name,email,institution), handler:profiles!submissions_handling_editor_id_fkey(full_name)').eq('id', id).maybeSingle());
    if (!s || s.owner_id === me) { show(h('div', { class: 'empty' }, 'This paper is not available on your desk. Papers you wrote are handled by other editors.'), h('p', null, h('a', { href: '#/' }, 'Back to the desk'))); return; }
    var authors = ok(await sb.from('submission_authors').select('*').eq('submission_id', id).order('position'));
    var files = ok(await sb.from('submission_files').select('*').eq('submission_id', id).order('created_at'));
    var asg = ok(await sb.from('review_assignments').select('id,status,version,respond_by,due_on,invited_at,reviewer:profiles!review_assignments_reviewer_id_fkey(id,full_name,institution),reviews(*)').eq('submission_id', id).order('invited_at'));
    var decisions = ok(await sb.from('decisions').select('*, by:profiles!decisions_decided_by_fkey(full_name)').eq('submission_id', id).order('created_at'));
    s.review_assignments = asg; s.decisions = decisions;
    var p = progress(s), step = nextStep(s), conf = s.venues.type === 'conference';
    var open = ['submitted', 'under_review', 'revision_submitted'].indexOf(s.status) >= 0;
    var canWrite = L !== 'maintenance';
    var canDecide = canWrite && L !== 'track_editor';
    function reload(msg) { flash = msg || null; route(); }

    var reviewerCard = h('div', { class: 'card stack' }, h('h2', null, 'Reviewers'),
      h('p', { class: 'muted small' }, p.need ? 'This paper needs ' + p.need + ' completed reviews; ' + p.done + ' received so far. Reviewers never see the authors.' : 'An abstract or poster is judged by the editor; reviewers are optional.'),
      asg.length ? h('ul', { class: 'list' }, asg.map(function (a) {
        var st = ASSIGN[a.status], cancel = h('button', { class: 'btn ghost tiny', type: 'button', onclick: function () {
          busy(cancel, async function () { ok(await sb.rpc('cancel_invitation', { p_assignment: a.id })); reload('Invitation cancelled and the reviewer notified.'); });
        } }, 'Cancel');
        return h('li', { class: 'item' }, h('div', null, h('div', { class: 't' }, a.reviewer ? a.reviewer.full_name : 'Reviewer'),
          h('div', { class: 'm' }, [a.reviewer && a.reviewer.institution, 'Version ' + a.version, a.status === 'invited' ? 'Answer due ' + day(a.respond_by) : a.status === 'accepted' ? 'Review due ' + day(a.due_on) : null].filter(Boolean).join(' · '))),
          h('div', { class: 'row' }, h('span', { class: 'tag ' + st[1] }, st[0]), canWrite && (a.status === 'invited' || a.status === 'accepted') ? cancel : null));
      })) : h('div', { class: 'empty' }, 'No reviewers invited yet.'),
      canWrite && open ? personSearch('Find a reviewer', async function (person) {
        ok(await sb.rpc('invite_reviewer', { p_submission: id, p_reviewer: person.id }));
        reload('Invitation sent to ' + (person.full_name || person.email) + '.');
      }, 'Invite') : null);

    var done = asg.filter(function (a) { return a.status === 'completed'; });
    var reviewsCard = h('div', { class: 'card stack' }, h('h2', null, 'Reviews received'),
      done.length ? done.map(function (a, i) {
        var r = Array.isArray(a.reviews) ? a.reviews[0] : a.reviews;
        if (!r) return null;
        return h('div', { class: 'author' }, h('div', { class: 'row', style: 'justify-content:space-between' },
            h('strong', null, 'Reviewer ' + (i + 1) + (a.reviewer ? ' · ' + a.reviewer.full_name : '') + ' · version ' + a.version), h('span', { class: 'tag' }, OUTCOME[r.recommendation])),
          h('div', { class: 'row' }, Object.keys(SCORES).map(function (k) { return h('span', { class: 'tag draft' }, SCORES[k] + ' ' + r[k] + '/5'); })),
          h('div', null, h('div', { class: 'label' }, 'For the authors'), h('p', { style: 'white-space:pre-line' }, r.comments_author)),
          r.comments_editor ? h('div', null, h('div', { class: 'label' }, 'Confidential, for the editor'), h('p', { style: 'white-space:pre-line' }, r.comments_editor)) : null);
      }) : h('div', { class: 'empty' }, 'No completed reviews yet.'));

    var outcomeCard = null;
    if (canWrite && open) {
      var pick = select(OUTCOME, 'accept'), letter = h('textarea', { style: 'min-height:260px' }), touched = false;
      letter.value = letterFor('accept', s, s.owner && s.owner.full_name);
      letter.addEventListener('input', function () { touched = true; });
      pick.addEventListener('change', function () { if (!touched) letter.value = letterFor(pick.value, s, s.owner && s.owner.full_name); });
      var recBtn = h('button', { class: 'btn ghost', type: 'button', onclick: function () {
        busy(recBtn, async function () { ok(await sb.rpc('record_outcome', { p_submission: id, p_outcome: pick.value, p_letter: letter.value, p_final: false })); reload('Recommendation recorded. The deciding editor has been notified.'); });
      } }, conf ? 'Send recommendation to the conference editor' : 'Record a recommendation');
      var decBtn = h('button', { class: 'btn', type: 'button', onclick: function () {
        busy(decBtn, async function () { ok(await sb.rpc('record_outcome', { p_submission: id, p_outcome: pick.value, p_letter: letter.value, p_final: true })); reload('Decision recorded and the author notified.'); });
      } }, 'Record decision and notify the author');
      outcomeCard = h('div', { class: 'card stack' }, h('h2', null, canDecide ? 'Decision' : 'Recommendation'),
        p.need && p.done < p.need ? h('p', { class: 'small', style: 'color:#6B5200' }, 'Usual practice is to wait for ' + p.need + ' reviews; ' + p.done + ' are in. You may still proceed if you have good reason.') : null,
        !canDecide ? h('p', { class: 'muted small' }, 'As track editor you recommend; the conference or call editor records the final decision and the author hears only then.') : null,
        field('Outcome', pick), field('Letter to the author', letter, 'A pre-written letter you can edit. The author sees it only when the final decision is recorded.'),
        h('div', { class: 'row' }, canDecide ? decBtn : null, recBtn));
    }

    var handlerCard = null;
    if (!conf) {
      handlerCard = h('div', { class: 'card stack' }, h('h2', null, 'Handling editor'), h('p', null, s.handler ? s.handler.full_name : 'Not assigned yet.'));
      if (canWrite && (L === 'eic' || L === 'manager')) {
        var eds = ok(await sb.from('profiles').select('id,full_name').overlaps('roles', ['associate_editor', 'eic']).order('full_name'));
        var eo = { '': 'Choose an editor' }; eds.forEach(function (e) { eo[e.id] = e.full_name; });
        var ep = select(eo, s.handling_editor_id || ''), eb = h('button', { class: 'btn ghost', type: 'button', onclick: function () {
          busy(eb, async function () { ok(await sb.rpc('assign_handling_editor', { p_submission: id, p_user: ep.value || null })); reload('Handling editor updated.'); });
        } }, 'Assign');
        handlerCard.appendChild(h('div', { class: 'row' }, h('div', { style: 'flex:1;min-width:200px' }, field('Assign to', ep)), h('div', { style: 'align-self:flex-end' }, eb)));
      }
    }

    show(h('p', null, h('a', { href: '#/' }, '← Back to the desk')),
      h('div', { class: 'head' }, h('div', null, h('span', { class: 'label' }, s.venues.name), h('h1', null, s.paper_id + ' · ' + s.title),
        h('p', { class: 'muted' }, 'Version ' + s.version + ' · Submitted ' + day(s.submitted_at)), h('p', null, h('strong', null, 'Next: '), step[0])), tag(s.status)),
      L === 'maintenance' ? h('div', { class: 'card' }, h('p', null, 'Maintenance view: you can read this paper but not change it.')) : null,
      h('div', { class: 'card stack' }, h('h2', null, 'Submission'),
        kv([['Track', s.tracks.code + ' · ' + s.tracks.name], ['Type', ARTICLE[s.article_type]], ['Keywords', s.keywords.join(', ')],
          ['Taking part', s.attendance_mode === 'on_site' ? 'On-site' : s.attendance_mode === 'online' ? 'Online' : ''], ['AI use statement', s.ai_use_statement]]),
        h('div', null, h('div', { class: 'label' }, 'Abstract'), h('p', { style: 'white-space:pre-line' }, s.abstract))),
      h('div', { class: 'card stack' }, h('h2', null, 'Authors'), h('p', { class: 'muted small' }, 'Visible to editors only.'),
        h('ul', { class: 'list' }, authors.map(function (a) {
          return h('li', { class: 'item' }, h('div', null, h('div', { class: 't' }, a.position + '. ' + a.full_name + (a.is_corresponding ? ' (corresponding)' : '')),
            h('div', { class: 'm' }, [a.affiliation, a.country, a.email].filter(Boolean).join(' · '))));
        }))),
      h('div', { class: 'card stack' }, h('h2', null, 'Files'), files.length ? h('ul', { class: 'list' }, files.map(function (f) {
        return h('li', { class: 'item' }, h('div', null, h('div', { class: 't' }, f.file_name), h('div', { class: 'm' }, KIND[f.kind] + ' · version ' + f.version + ' · ' + day(f.created_at))),
          h('button', { class: 'btn ghost tiny', type: 'button', onclick: download(f.storage_path, f.file_name) }, 'Download'));
      })) : h('div', { class: 'empty' }, 'No files. Abstracts and posters are typed into the form.')),
      handlerCard, reviewerCard, reviewsCard, outcomeCard,
      h('div', { class: 'card stack' }, h('h2', null, 'History'), decisions.length ? h('ul', { class: 'list' }, decisions.map(function (d) {
        return h('li', { class: 'item' }, h('div', { style: 'flex:1' }, h('div', { class: 't' }, (d.kind === 'decision' ? 'Decision: ' : 'Recommendation: ') + OUTCOME[d.outcome]),
          h('div', { class: 'm' }, [d.by && d.by.full_name, 'Version ' + d.version, day(d.created_at)].filter(Boolean).join(' · ')),
          d.letter ? h('details', null, h('summary', null, 'Letter'), h('p', { style: 'white-space:pre-line;margin-top:8px' }, d.letter)) : null));
      })) : h('div', { class: 'empty' }, 'No recommendations or decisions yet.')));
  }

  // ---------- reviewer ----------
  async function reviewsView() {
    var rows = ok(await sb.rpc('my_reviews')), today = new Date().toISOString().slice(0, 10);
    function group(status) { return rows.filter(function (r) { return r.status === status; }); }
    function card(r, actions) {
      return h('li', { class: 'card stack' }, h('div', null, h('span', { class: 'label' }, r.venue + ' · ' + r.track), h('h3', null, r.title),
          h('p', { class: 'm small muted' }, [ARTICLE[r.article_type], 'Version ' + r.version, r.keywords.join(', ')].filter(Boolean).join(' · '))),
        h('details', null, h('summary', null, 'Read the abstract'), h('p', { style: 'white-space:pre-line;margin-top:8px' }, r.abstract)), actions);
    }
    var out = [h('div', { class: 'head' }, h('div', null, h('span', { class: 'label' }, 'Reviewer'), h('h1', null, 'My reviews'),
      h('p', { class: 'muted' }, 'Thank you for reviewing. Your care is what makes the feedback worth reading.'))), protocolBox('reviewer')];
    var inv = group('invited'), act = group('accepted'), fin = group('completed');
    if (!rows.length) out.push(h('div', { class: 'empty' }, 'No invitations yet. Editors will reach you here when a paper matches your interests.'));
    if (inv.length) out.push(h('h2', { style: 'margin:18px 0 10px' }, 'Invitations (' + inv.length + ')'), h('ul', { class: 'list' }, inv.map(function (r) {
      function answer(yes) { return function (e) { busy(e.target, async function () { ok(await sb.rpc('respond_invitation', { p_assignment: r.assignment_id, p_accept: yes })); flash = yes ? 'Thank you. The review is due in three weeks.' : 'Thank you for letting us know.'; route(); }); }; }
      return card(r, h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: answer(true) }, 'Accept'), h('button', { class: 'btn ghost', type: 'button', onclick: answer(false) }, 'Decline'),
        h('span', { class: 'small muted' }, 'Please answer by ' + day(r.respond_by))));
    })));
    if (act.length) out.push(h('h2', { style: 'margin:18px 0 10px' }, 'To review (' + act.length + ')'), h('ul', { class: 'list' }, act.map(function (r) {
      return card(r, h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/review/' + r.assignment_id }, 'Open the review form'),
        h('span', { class: 'tag ' + (r.due_on < today ? 'bad' : '') }, (r.due_on < today ? 'Overdue since ' : 'Due ') + day(r.due_on))));
    })));
    if (fin.length) out.push(h('h2', { style: 'margin:18px 0 10px' }, 'Completed (' + fin.length + ')'), h('ul', { class: 'list' }, fin.map(function (r) {
      return h('li', { class: 'item' }, h('div', null, h('div', { class: 't' }, r.title), h('div', { class: 'm' }, r.venue)), h('a', { class: 'btn ghost tiny', href: '#/review/' + r.assignment_id }, 'View'));
    })));
    show.apply(null, out);
  }
  async function reviewForm(aid) {
    var rows = ok(await sb.rpc('my_reviews')), r = rows.filter(function (x) { return x.assignment_id === aid; })[0];
    if (!r || (r.status !== 'accepted' && r.status !== 'completed')) { show(h('div', { class: 'empty' }, 'This review is not open.'), h('p', null, h('a', { href: '#/' }, 'Back to my reviews'))); return; }
    var files = ok(await sb.rpc('review_files', { p_assignment: aid }));
    var mine = r.status === 'completed' ? ok(await sb.from('reviews').select('*').eq('assignment_id', aid).maybeSingle()) : null, ro = !!mine;
    var scale = { '': 'Choose', 1: '1 · Poor', 2: '2 · Fair', 3: '3 · Good', 4: '4 · Very good', 5: '5 · Excellent' }, sc = {};
    Object.keys(SCORES).forEach(function (k) { sc[k] = select(scale, mine ? String(mine[k]) : '', { disabled: ro, required: true }); });
    var rec = select({ '': 'Choose', accept: 'Accept', minor_revision: 'Minor revision', major_revision: 'Major revision', reject: 'Do not accept' }, mine ? mine.recommendation : '', { disabled: ro, required: true });
    var ca = h('textarea', { disabled: ro, required: true, style: 'min-height:200px' }), ce = h('textarea', { disabled: ro, style: 'min-height:90px' });
    ca.value = mine ? mine.comments_author : ''; ce.value = mine ? (mine.comments_editor || '') : '';
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Submit review');
    show(h('p', null, h('a', { href: '#/' }, '← Back to my reviews')),
      h('div', { class: 'head' }, h('div', null, h('span', { class: 'label' }, r.venue + ' · ' + r.track), h('h1', null, r.title), h('p', { class: 'muted' }, ARTICLE[r.article_type] + ' · Version ' + r.version + (ro ? '' : ' · Due ' + day(r.due_on))))),
      h('div', { class: 'card stack' }, h('h2', null, 'The paper'), h('p', { style: 'white-space:pre-line' }, r.abstract),
        files.length ? h('ul', { class: 'list' }, files.map(function (f) {
          return h('li', { class: 'item' }, h('div', { class: 't' }, 'Blinded manuscript'), h('button', { class: 'btn ghost tiny', type: 'button', onclick: download(f.storage_path, f.file_name) }, 'Download'));
        })) : h('p', { class: 'muted small' }, 'No manuscript file: please review the abstract above.')),
      h('form', { class: 'card stack', onsubmit: function (e) {
        e.preventDefault();
        busy(btn, async function () {
          ok(await sb.rpc('submit_review', { p_assignment: aid, p_originality: +sc.originality.value, p_relevance: +sc.relevance.value, p_methodology: +sc.methodology.value,
            p_clarity: +sc.clarity.value, p_contribution: +sc.contribution.value, p_recommendation: rec.value, p_comments_author: ca.value, p_comments_editor: ce.value }));
          go('#/', 'Thank you. Your review has been submitted.');
        });
      } }, h('h2', null, ro ? 'Your review' : 'Your review'),
        h('div', { class: 'grid2' }, Object.keys(SCORES).map(function (k) { return field(SCORES[k], sc[k]); }), field('Your recommendation', rec)),
        field('Comments for the authors', ca, 'What works, what does not, and how to improve it. The authors see this without your name.'),
        field('Confidential comments for the editor (optional)', ce), ro ? null : h('div', null, btn)));
  }

  // ---------- inbox ----------
  async function inboxView() {
    var rows = ok(await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(60));
    show(h('div', { class: 'head' }, h('div', null, h('h1', null, 'Inbox'), h('p', { class: 'muted' }, 'Invitations, decisions and updates addressed to you.'))),
      rows.length ? h('ul', { class: 'list' }, rows.map(function (n) {
        return h('li', { class: 'card stack', style: n.read_at ? '' : 'border-left:4px solid #C8102E' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h3', null, n.title), h('span', { class: 'small muted' }, day(n.created_at))),
          n.body ? h('p', { style: 'white-space:pre-line' }, n.body) : null, n.link ? h('div', null, h('a', { class: 'btn ghost tiny', href: n.link }, 'Open')) : null);
      })) : h('div', { class: 'empty' }, 'Nothing yet.'));
    if (unread) { await sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null); unread = 0; drawNav('#/inbox'); }
  }

  // ---------- editorial team for one call ----------
  async function teamView() {
    var L = staffLens();
    if (['venue_editor', 'eic', 'manager'].indexOf(L) < 0) { show(h('div', { class: 'empty' }, 'This page is for conference editors, the Editor-in-Chief and managers.')); return; }
    var mine = scopedVenues(L), vid = venueFilter(L) || (mine[0] && mine[0].id), v = mine.filter(function (x) { return x.id === vid; })[0];
    if (!v) { show(h('div', { class: 'empty' }, 'No call is available to you here.')); return; }
    var team = ok(await sb.from('venue_roles').select('id,role,track_id,user:profiles!venue_roles_user_id_fkey(full_name,email,institution),tracks(code,name)').eq('venue_id', v.id).order('role', { ascending: false }));
    var ro = { track_editor: 'Track editor' }; if (L === 'manager') ro.venue_editor = 'Conference / CFP editor (decides)';
    var role = select(ro, 'track_editor'), to = {}; v.tracks.forEach(function (t) { to[t.id] = t.code + ' · ' + t.name; });
    var track = select(to, v.tracks[0] && v.tracks[0].id), trackWrap = field('Track', track);
    role.addEventListener('change', function () { trackWrap.style.display = role.value === 'track_editor' ? '' : 'none'; });
    var vo = {}; mine.forEach(function (x) { vo[x.id] = x.code + ' · ' + x.name; });
    var vpick = select(vo, v.id, { onchange: function () { store('ww_venue', vpick.value); route(); } });
    show(h('div', { class: 'head' }, h('div', null, h('span', { class: 'label' }, 'Editorial team'), h('h1', null, v.name),
        h('p', { class: 'muted' }, 'Track editors recommend; the conference or call editor decides. Journal-wide roles are set on the People page.')), h('div', { style: 'min-width:240px' }, field('Call', vpick))),
      h('div', { class: 'card stack' }, h('h2', null, 'Current team'), team.length ? h('ul', { class: 'list' }, team.map(function (m) {
        var rm = h('button', { class: 'btn ghost tiny', type: 'button', onclick: function () { busy(rm, async function () { ok(await sb.rpc('revoke_venue_role', { p_id: m.id })); flash = 'Role removed.'; await loadStaff(); route(); }); } }, 'Remove');
        return h('li', { class: 'item' }, h('div', null, h('div', { class: 't' }, m.user ? (m.user.full_name || m.user.email) : ''),
          h('div', { class: 'm' }, (m.role === 'venue_editor' ? 'Conference / CFP editor' : 'Track editor · ' + (m.tracks ? m.tracks.code + ' · ' + m.tracks.name : '')) + (m.user && m.user.institution ? ' · ' + m.user.institution : ''))),
          m.role === 'track_editor' || L === 'manager' ? rm : null);
      })) : h('div', { class: 'empty' }, 'Nobody has a role in this call yet.')),
      h('div', { class: 'card stack' }, h('h2', null, 'Add someone'), h('div', { class: 'grid2' }, field('Role', role), trackWrap),
        personSearch('Find a person', async function (person) {
          ok(await sb.rpc('grant_venue_role', { p_user: person.id, p_venue: v.id, p_role: role.value, p_track: role.value === 'track_editor' ? track.value : null }));
          flash = (person.full_name || person.email) + ' added and notified.'; await loadStaff(); route();
        }, 'Add')));
  }

  // ---------- system (manager and maintenance) ----------
  async function systemView() {
    if (!(isManager() || hasRole('maintenance') || hasRole('eic'))) { show(h('div', { class: 'empty' }, 'This page is for managers and the maintenance account.')); return; }
    var st = ok(await sb.rpc('system_stats'));
    var log = ok(await sb.from('activity_log').select('at,action,detail,submission_id,actor:profiles!activity_log_actor_id_fkey(full_name)').order('at', { ascending: false }).limit(60));
    function tile(n, label) { return h('div', { class: 'tile' }, h('b', null, n), h('span', null, label)); }
    function spread(o) { return Object.keys(o).map(function (k) { return k.replace(/_/g, ' ') + ': ' + o[k]; }).join(' · ') || 'none'; }
    show(h('div', { class: 'head' }, h('div', null, h('span', { class: 'label' }, 'System'), h('h1', null, 'Health and activity'), h('p', { class: 'muted' }, 'Counts across the portal and the latest recorded actions.'))),
      hasRole('maintenance') && !isManager() ? protocolBox('maintenance') : null,
      h('div', { class: 'tiles' }, tile(st.people, 'Accounts'), tile(st.calls_open, 'Open calls'), tile(st.files, 'Files stored'),
        tile((st.file_bytes / 1048576).toFixed(1) + ' MB', 'of 1,024 MB file space'), tile(st.overdue_reviews, 'Overdue reviews'), tile(st.unanswered_invitations, 'Unanswered invitations')),
      h('div', { class: 'card stack' }, h('h2', null, 'Totals'), kv([['Submissions', spread(st.submissions)], ['Review assignments', spread(st.reviews)], ['Unread notifications', String(st.unread_notifications)]])),
      h('div', { class: 'card scroll' }, h('h2', null, 'Activity log'), log.length ? h('table', null,
        h('thead', null, h('tr', null, ['When', 'Who', 'Action', 'Detail'].map(function (t) { return h('th', null, t); }))),
        h('tbody', null, log.map(function (l) {
          return h('tr', null, h('td', null, new Date(l.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })), h('td', null, l.actor ? l.actor.full_name : ''),
            h('td', null, l.action.replace(/_/g, ' ')), h('td', { class: 'small muted' }, l.detail ? JSON.stringify(l.detail) : ''));
        }))) : h('div', { class: 'empty' }, 'Nothing recorded yet.')));
  }

  // ---------- author: decision letters, reviewer comments, revision and full paper ----------
  async function feedbackCard(id) {
    var r = await sb.rpc('author_feedback', { p_submission: id });
    if (r.error || !r.data || !r.data.decisions.length) return null;
    var fb = r.data;
    return h('div', { class: 'card stack' }, h('h2', null, 'Decision and reviewer comments'),
      fb.decisions.map(function (d) {
        var rv = fb.reviews.filter(function (x) { return x.version === d.version; });
        return h('div', { class: 'author' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('strong', null, 'Version ' + d.version + ' · ' + OUTCOME[d.outcome]), h('span', { class: 'small muted' }, day(d.at))),
          d.letter ? h('p', { style: 'white-space:pre-line' }, d.letter) : null,
          rv.map(function (x, i) { return h('div', null, h('div', { class: 'label' }, 'Reviewer ' + (i + 1)), h('p', { style: 'white-space:pre-line' }, x.comments)); }));
      }));
  }
})();
