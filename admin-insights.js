/* ==========================================================================
   admin-insights.js: four admin screens (English).
     - Dashboard  (#ad-dash)    tiles, week chart, alerts feed, teams today, visits due
     - Clients    (#ad-clients) WhatsApp-style: client list on the left, the open
                                client on the right as a chat timeline
     - Payments   (#ad-pay)     ledger with area filter, add done jobs, recent collections
     - Overtime   (#ad-ot)      today / week / month, by team, overtime jobs, late bookings

   How it works: each screen asks the server (api.js) for what it needs, then
   draws HTML. Buttons use data-act="..." and the handlers are at the bottom
   of each section. Everything sits inside one function so names here never
   clash with the other admin file (admin-orders.js).
   The WhatsApp-style pieces (WA.row, WA.bubble ...) come from chat.js.
   Added 2026-10-08: Dashboard "Quotations" (survey quotations waiting) and AMC
   visits in "Visits due"; the AMC box on the client card; survey / multi-day /
   AMC / price-locked details on order bubbles.
   Styles for these screens are in admin.css.

   Shared action other screens can use:
     <button data-act="open-client" data-phone="919825041031">Open client</button>
   switches to the Clients tab and opens that client.
   ========================================================================== */

(function () {
  'use strict';

  /* ======================================================================
     SMALL HELPERS
     ====================================================================== */

  // What each screen remembers while the app is open (filters, open client...)
  const S = {
    clients: { q: '', phone: '', all: null },  // search text, open client's phone ('' = none), full client list for instant search
    pay: { area: '' },                // area filter on the ledger ('' = all)
    ot: { range: 'today', team: '' }  // overtime range and team filter
  };

  const setup = () => App.setup || {};
  const settings = () => setup().settings || {};
  const teamKeys = () => (setup().teams || []).map(t => t.team);
  // Names from the Setup tabs: key -> English name
  const svcName = k => ((setup().services || []).find(s => s.key === k) || { name_en: k }).name_en;
  const areaName = k => k ? ((setup().areas || []).find(a => a.key === k) || { name_en: k }).name_en : 'Other';
  const typeName = k => ((setup().client_types || []).find(c => c.key === k) || { name_en: k || '-' }).name_en;
  const svcList = arr => (arr || []).map(svcName).join(', ');
  // "Overhead tank cleaning" -> "Overhead" (short, for one-line previews)
  const svcShortList = arr => (arr || []).map(k => svcName(k).split(' ')[0]).join(', ');

  // Coloured "Team A" label. No team = grey "Unassigned".
  const tchip = (k, withDriver) => {
    const t = (setup().teams || []).find(x => x.team === k);
    return '<span class="tchip" style="--tc:' + teamColor(k, teamKeys()) + '"><i class="tdot"></i>' +
      (k ? 'Team ' + esc(k) + (withDriver && t ? ' · ' + esc(t.driver_name) : '') : 'Unassigned') + '</span>';
  };

  // Grey "No WhatsApp · call" pill for a client / order with whatsapp 'no' (blank = yes: nothing shown)
  const noWa = x => !!x && String(x.whatsapp || '').toLowerCase() === 'no';
  const noWaPill = () => '<span class="pill ins-nowa" title="This client does not use WhatsApp: nothing is sent to them, staff call instead">No WhatsApp · call</span>';
  App.noWaPill = noWaPill;   // also used by admin-orders.js

  // Small round initials next to a client name in tables
  const nameCell = (name, inner) => '<span class="ins-who">' + WA.avatar(name, { small: true }) + '<span class="ins-who-t">' + inner + '</span></span>';

  // Order status as a coloured pill (same words as the mockup)
  function statusPill(o) {
    if (o.kind === 'survey') return o.status === 'done' ? '<span class="pill ok">Measured</span>' : '<span class="pill">Not measured yet</span>';
    const m = { new: ['Unassigned', ''], assigned: ['Assigned', 'info'], delayed: ['Running late', 'warn'],
      reached: ['At site', 'ok'], done: ['Done', 'ok'], moved: ['Moved', 'warn'], ongoing: ['In progress', 'info'] }[o.status] || [o.status, ''];
    return '<span class="pill ' + m[1] + '">' + esc(m[0]) + '</span>' +
      (o.moved_from ? ' <span class="pill warn">Moved from ' + esc(lab(o.moved_from)) + '</span>' : '');
  }

  // "2026-10-06T11:40:00" -> "Tue 6 Oct, 11:40 AM"
  const when = ts => ts ? lab(String(ts).slice(0, 10)) + ', ' + fm(mins(ts)) : '';
  // Short date with year when it is not this year: "Thu 10 Apr 2025"
  const dateLab = s => s ? lab(s) + (s.slice(0, 4) !== todayIso().slice(0, 4) ? ' ' + s.slice(0, 4) : '') : '-';
  // Chat-list style date: "Today", "Yesterday", "6 Oct", "10 Apr 25"
  function shortDay(s) {
    if (!s) return '';
    const t = todayIso();
    if (s === t) return 'Today';
    if (s === addD(t, -1)) return 'Yesterday';
    if (s === addD(t, 1)) return 'Tomorrow';
    const d = pd(s);
    return d.getDate() + ' ' + MON[d.getMonth()] + (s.slice(0, 4) !== t.slice(0, 4) ? ' ' + s.slice(2, 4) : '');
  }
  // Time spot of a feed line: today -> "11:40 AM", other days -> "6 Oct"
  const feedTime = ts => !ts ? '' : String(ts).slice(0, 10) === todayIso() ? fm(mins(ts)) : shortDay(String(ts).slice(0, 10));
  // Date chip in the chat: "Today", "Yesterday" or "Tue 6 Oct"
  function dayChip(s) {
    const t = todayIso();
    return s === t ? 'Today' : s === addD(t, -1) ? 'Yesterday' : dateLab(s);
  }

  // Office hours from Settings, in minutes since midnight
  const officeStart = () => mins(settings().office_start || '10:00');
  const officeEnd = () => mins(settings().office_end || '17:00');
  const outsideHours = t => { const m = mins(t); return m != null && (m < officeStart() || m >= officeEnd()); };

  // A friendly error text from a server error code
  function errText(e) {
    const m = (e && e.message) || '';
    // Server errors read "CODE: message". Only the code before the colon decides the wording.
    const code = (e && e.code) || m.split(':')[0].trim();
    if (code === 'BAD_INPUT') return m.slice(m.indexOf(':') + 1).trim() || 'Please check the details.';
    if (code === 'NETWORK' || code === 'TIMEOUT') return 'No network. Check the internet and try again.';
    if (code === 'FORBIDDEN') return 'You are not allowed to do this.';
    if (code === 'NOT_FOUND') return 'Not found. It may have been deleted.';
    return 'Something went wrong (' + m + '). Try again.';
  }

  /* ---------- speed: each trip to Apps Script takes 1-2 seconds ----------
     batchCalls: several requests in ONE trip (apiBatch in api.js). If the server does not
     know "batch" yet, it falls back to separate calls. An item that failed comes back as an Error. */
  async function batchCalls(calls) {
    try { return await apiBatch(calls); }
    catch (e) {
      if (e.code !== 'UNKNOWN_ACTION') throw e;
      return Promise.all(calls.map(c => api(c[0], c[1]).catch(err => { if (err.message === 'AUTH') throw err; return err; })));
    }
  }

  // Small "updating…" note in the screen title while fresh data is on its way
  // (App.updNote comes from admin-orders.js, so every admin screen shows the same note)
  function setUpdating(el, on) {
    const h = el.querySelector(':scope > header > div');
    if (!h) return;
    let n = h.querySelector('.upd');
    if (on && !n) h.insertAdjacentHTML('beforeend', App.updNote());
    if (!on && n) n.remove();
  }

  /* Load a screen in ONE trip, then draw it.
     - calls: [[action, params], ...] sent together. drawFn(el, results) gets the answers in the same order.
     - The last answer is saved (as "screen.<tab>"), so next time the screen draws at once
       and then quietly updates. "updating…" shows meanwhile.
     - partial = true: draw even if some parts failed (those parts are Error objects).
     - If the admin has moved to another tab meanwhile, the answer is ignored.
     - On error with nothing saved, shows a "Try again" button. */
  const loadCount = {};
  async function loadScreen(el, tab, title, calls, drawFn, partial) {
    const my = loadCount[tab] = (loadCount[tab] || 0) + 1;
    const key = cacheKey('screen.' + tab, calls);
    const old = cacheGet(key);
    if (old) drawFn(el, old);
    else if (!el.innerHTML.trim()) el.innerHTML = '<header><div><h2>' + esc(title) + '</h2></div></header><div class="empty">Loading…</div>';
    setUpdating(el, true);
    try {
      const res = await batchCalls(calls);
      if (loadCount[tab] !== my || App.adminTab !== tab) return;   // an older or hidden request: ignore
      const errs = res.filter(x => x instanceof Error);
      if (errs.length === res.length || (!partial && errs.length)) throw errs[0];
      if (!errs.length) cachePut(key, res);                          // only save complete answers
      if (!old || JSON.stringify(old) !== JSON.stringify(res)) drawFn(el, res);
      setUpdating(el, false);
      if (errs.length) toast('Some parts could not load. ' + errText(errs[0]));
    } catch (e) {
      if (e.message === 'AUTH' || loadCount[tab] !== my) return;  // AUTH: app.js already shows the PIN screen
      if (old) { setUpdating(el, false); toast(errText(e)); return; }   // keep showing the saved copy
      el.innerHTML = '<header><div><h2>' + esc(title) + '</h2></div></header>' +
        '<div class="empty">' + esc(errText(e)) + '<br><br><button class="btn pri" data-act="ins-retry">Try again</button></div>';
    }
  }
  // Draw the open admin tab again (fetches fresh data)
  const refresh = () => renderAdmin();
  onAct('ins-retry', refresh);

  // A few extra line icons for the alerts feed (same style as WA.icons in chat.js)
  const ICON = {
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
    half: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 7h14M5 12h9M5 17h5"/></svg>',
    cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>'
  };

  /* ======================================================================
     1. DASHBOARD
     ====================================================================== */

  // Bar chart for the week: solid = done, dashed = booked but not done (copied from the mockup)
  function weekChart(byDay) {
    const t = todayIso();
    const data = byDay.map(x => ({ d: x.date, done: x.done, open: Math.max(0, x.booked - x.done) }));
    const mx = Math.max(...data.map(x => x.done + x.open), 2000), top = Math.ceil(mx / 2000) * 2000;
    const n = data.length || 7;
    const W = 520, H = 240, pl = 46, pr = 10, pt = 14, pb = 40, pw = W - pl - pr, ph = H - pt - pb, bw = pw / n * 0.56;
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Revenue this week, done and booked">';
    for (let i = 0; i <= 4; i++) {
      const v = top / 4 * i, y = pt + ph - (v / top) * ph;
      s += '<line class="svgl" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y + '" y2="' + y + '"/>' +
        '<text class="svgt" x="' + (pl - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + (v === 0 ? '0' : '₹' + (v / 1000) + 'k') + '</text>';
    }
    data.forEach((x, i) => {
      const cx = pl + pw / n * i + pw / n / 2, h1 = (x.done / top) * ph, h2 = (x.open / top) * ph, isToday = x.d === t;
      s += '<rect x="' + (cx - bw / 2) + '" y="' + (pt + ph - h1) + '" width="' + bw + '" height="' + h1 + '" rx="3" fill="var(--accent)"><title>' + esc(lab(x.d)) + ': done ' + inr(x.done) + '</title></rect>';
      s += '<rect x="' + (cx - bw / 2) + '" y="' + (pt + ph - h1 - h2) + '" width="' + bw + '" height="' + h2 + '" rx="3" fill="var(--accent-soft)" stroke="var(--accent)" stroke-dasharray="3 3"><title>' + esc(lab(x.d)) + ': booked, not done ' + inr(x.open) + '</title></rect>';
      s += '<text class="svgt" x="' + cx + '" y="' + (H - 22) + '" text-anchor="middle" style="font-weight:' + (isToday ? 700 : 400) + '">' + DAYS[pd(x.d).getDay()] + '</text>' +
        '<text class="svgt" x="' + cx + '" y="' + (H - 9) + '" text-anchor="middle">' + pd(x.d).getDate() + '</text>';
    });
    return s + '</svg>';
  }

  // "in 10 days" / "due today" / "3 days overdue", with the right pill colour
  function dueText(daysLeft) {
    if (daysLeft < 0) return '<span class="pill bad">' + (-daysLeft) + ' day' + (daysLeft === -1 ? '' : 's') + ' overdue</span>';
    if (daysLeft === 0) return '<span class="pill warn">Due today</span>';
    return '<span class="pill ' + (daysLeft <= 7 ? 'warn' : 'info') + '">in ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + '</span>';
  }
  // The same as plain words, for the time spot of a chat-list row
  const dueWords = d => d < 0 ? (-d) + ' day' + (d === -1 ? '' : 's') + ' overdue' : d === 0 ? 'Due today' : 'in ' + d + ' day' + (d === 1 ? '' : 's');

  // One client in "Visits due": a chat-list row (opens the client) with two buttons under it
  function dueItem(r, i) {
    const over = r.days_left < 0;
    // An AMC visit (not booked yet): "AMC visit 2/4 · due 11 Oct", Book order fills in the contract
    if (r.kind === 'amc') {
      return '<div class="ins-dueit ins-amcdue' + (over ? ' over' : r.days_left === 0 ? ' today' : '') + '">' +
        WA.row({
          name: r.client_name, time: dueWords(r.days_left), act: 'open-client', data: { phone: r.phone },
          preview: '<span class="pill ok">AMC visit ' + esc(r.visit_no) + '/' + esc(r.visits) + '</span> · due ' + esc(lab(r.due_date)) + ' · ' + esc(areaName(r.area)) +
            ' · ' + esc(r.amc_id)
        }) +
        '<div class="acts"><button class="btn sm pri" data-act="ins-book-amc" data-i="' + i + '">' + word('Book order') + '</button>' +
        '<button class="btn sm" data-act="open-client" data-phone="' + esc(r.phone) + '">Open client</button></div></div>';
    }
    return '<div class="ins-dueit' + (over ? ' over' : r.days_left === 0 ? ' today' : '') + '">' +
      WA.row({
        name: r.client_name, time: dueWords(r.days_left), act: 'open-client', data: { phone: r.phone },
        preview: esc(areaName(r.area)) + ' · next visit ' + esc(lab(r.next_visit)) + ' · last ' + esc(shortDay(r.last_date)) + ' (' + esc(svcShortList(r.last_services)) + ')'
      }) +
      '<div class="acts"><button class="btn sm pri" data-act="ins-book" data-phone="' + esc(r.phone) + '">' + word('Book order') + '</button>' +
      '<button class="btn sm" data-act="open-client" data-phone="' + esc(r.phone) + '">Open client</button></div></div>';
  }

  function renderDash(el) {
    const t = todayIso();
    // Add-ons: "Visits due" needs Clients, "Quotations" needs Survey and quotation.
    // An add-on that is off: its card and tile are left out and its data is not asked for.
    const withDue = hasMod('clients'), withQuotes = hasMod('quotation');
    const calls = [
      ['report.revenue', { range: 'week' }],
      ['alerts.list', {}],
      ['ledger.get', {}],
      ['report.overtime', { range: 'today' }],
      ['order.list', { from: t, to: t }]
    ];
    if (withDue) calls.push(['reminders.list', {}]);
    if (withQuotes) calls.push(['order.list', { kind: 'survey' }]);   // survey visits and their quotations
    // Everything in ONE trip. A part that fails shows "could not load"; the rest still shows.
    loadScreen(el, 'dash', 'Dashboard', calls, (el, r) => {
      const ok = x => (x && !(x instanceof Error)) ? x : null;
      const rev = ok(r[0]), al = ok(r[1]), led = ok(r[2]), ot = ok(r[3]), ol = ok(r[4]);
      const rem = withDue ? ok(r[5]) : null, svl = withQuotes ? ok(r[withDue ? 6 : 5]) : null;
      const na = '<span class="ins-red">could not load</span>', dash = '–';
      // a survey visit is not a job (no team, no money)
      const td = ol ? ol.orders.filter(o => o.status !== 'moved' && o.kind !== 'survey') : [], dn = td.filter(o => o.status === 'done');
      // Quotations waiting: measured surveys with a draft or sent quotation
      const quotes = svl ? svl.orders.filter(o => o.status === 'done' && (o.quote_status === 'draft' || o.quote_status === 'sent')) : [];
      const toMeasure = svl ? svl.orders.filter(o => o.status !== 'done').length : 0;
      const quoteValue = quotes.reduce((a, o) => a + (Number(o.quote_amount) || 0), 0);
      const revenue = dn.reduce((a, o) => a + Number(o.amount || 0), 0), booked = td.reduce((a, o) => a + Number(o.amount || 0), 0);
      const owing = led ? led.rows.filter(x => x.balance > 0) : [], owingClients = new Set(owing.map(x => x.phone)).size;
      const due = rem ? rem.reminders || [] : [], overdue = due.filter(x => x.days_left < 0).length;
      S.due = due;   // for "Book order" on an AMC row
      const remDays = rem ? rem.reminder_days : (Number(settings().reminder_days) || 20);
      const unseen = al ? al.unseen : 0;
      if (al && App.setAlertBadge) App.setAlertBadge(unseen);   // keep the menu badge in step, no extra trip

      el.innerHTML = '<header><div><h2>Dashboard</h2><p class="sub">' + esc(lab(t)) + ' · live from the field</p></div>' +
        '<button class="btn sm" data-act="ins-retry">Refresh</button></header>' +

        // Tiles
        '<div class="tiles">' +
        tile('Revenue today', ol ? inr(revenue) : dash, ol ? dn.length + ' of ' + td.length + ' jobs done' : na) +
        tile('Booked today', ol ? inr(booked) : dash, ol ? td.filter(o => o.status === 'new').length + ' still need a team' : na) +
        tile('To collect', led ? inr(led.total) : dash, led ? owingClients + ' client' + (owingClients === 1 ? '' : 's') + ' in ledger' : na) +
        tile('Needs attention', al ? unseen : dash, al ? 'unseen alert' + (unseen === 1 ? '' : 's') : na, unseen ? 'bad' : '') +
        tile('Overtime today', ot ? dur(ot.total_min || 0) : dash, 'office hours ' + fm(officeStart()) + ' to ' + fm(officeEnd())) +
        (withDue ? tile('Visits due', rem ? due.length : dash, !rem ? na : overdue ? '<span class="ins-red">' + overdue + ' overdue</span>' : 'next ' + remDays + ' days') : '') +
        (withQuotes ? tile('Quotations', svl ? quotes.length : dash, !svl ? na : inr(quoteValue) + ' waiting' + (toMeasure ? ' · ' + toMeasure + ' to measure' : '')) : '') +
        '</div>' +

        // Week chart + alerts
        '<div class="two"><div class="card"><h3>This week</h3>' + (rev ? '<div class="ins-chart">' + weekChart(rev.by_day) + '</div>' +
        '<div class="chips sub ins-legend"><span><i class="tdot" style="--tc:var(--accent)"></i> Done ' + inr(rev.done_total) + '</span>' +
        '<span><i class="tdot" style="--tc:var(--accent-soft);outline:1px dashed var(--accent)"></i> Booked, not done ' + inr(rev.booked_total - rev.done_total) + '</span>' +
        '<span>Collected ' + inr(rev.collected) + '</span></div>' : '<div class="empty">The week chart could not load. <button class="lnk" data-act="ins-retry">Try again</button></div>') + '</div>' +
        '<div class="card ins-flush"><div class="ins-h3"><h3>Alerts' + (unseen ? ' <span class="pill bad">' + unseen + ' new</span>' : '') + '</h3>' +
        (unseen ? '<button class="lnk" style="font-size:12px" data-act="ins-seen">Mark all seen</button>' : '') + '</div>' +
        (al ? alertFeed(al.alerts, 'Alerts from the field show up here.') : '<div class="empty ins-m">Alerts could not load.</div>') + '</div></div>' +

        // Teams today + visits due (without Clients: Teams today on its own)
        (withDue ? '<div class="two">' : '') + '<div class="card' + (withDue ? '' : ' ins-sec') + '"><h3>Teams today</h3><div class="tl">' + (ol ? teamsToday(td, ot ? ot.by_team : []) : '<div class="sub">Today\'s jobs could not load.</div>') + '</div></div>' +
        (!withDue ? '' : '<div class="card ins-flush" id="ins-due"><div class="ins-h3"><h3>Visits due <span class="sub">(next ' + esc(remDays) + ' days)</span></h3></div>' +
        (!rem ? '<div class="empty ins-m">Visits due could not load.</div>'
          : due.length ? '<div class="wa-list ins-due">' + due.map(dueItem).join('') + '</div>'
          : '<div class="empty ins-m">No visits due. Set a next visit date on a client page or on New order.</div>') +
        '</div></div>') +

        // Quotations: surveys measured, quotation not answered yet (draft or sent)
        (!withQuotes ? '' : '<div class="card ins-flush ins-sec" id="ins-quotes"><div class="ins-h3"><h3>Quotations <span class="sub">(draft and sent' +
        (toMeasure ? ' · ' + toMeasure + ' survey' + (toMeasure === 1 ? '' : 's') + ' still to measure' : '') + ')</span></h3></div>' +
        (!svl ? '<div class="empty ins-m">Quotations could not load.</div>'
          : quotes.length ? '<div class="wa-list ins-due">' + quotes.map(quoteItem).join('') + '</div>'
          : '<div class="empty ins-m">No quotations waiting. Book a survey visit on New order (Type: Survey visit).</div>') + '</div>');
    });
  }

  // One quotation waiting: client, status, amount; opens the client; Quotation button opens the panel
  function quoteItem(o) {
    const sent = o.quote_status === 'sent';
    return '<div class="ins-dueit">' + WA.row({
      name: o.client_name, time: sent ? 'Sent ' + shortDay(String(o.quote_sent_at).slice(0, 10)) : 'Draft', act: 'open-client', data: { phone: o.phone },
      preview: '<b class="num">' + inr(o.quote_amount) + '</b> · measured ' + esc(shortDay(String(o.done_at).slice(0, 10))) + ' · ' + esc(areaName(o.area)) +
        (noWa(o) ? ' · ' + noWaPill() : '')
    }) + '<div class="acts">' + (App.quoteBtn ? App.quoteBtn(o) : '') +
      '<button class="btn sm" data-act="open-client" data-phone="' + esc(o.phone) + '">Open client</button></div></div>';
  }

  // One number tile. cls 'bad' makes the number red.
  const tile = (k, v, sub, cls) => '<div class="tile' + (cls ? ' ' + cls : '') + '"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div><div class="sub">' + sub + '</div></div>';

  // Alerts as a chat-list feed: coloured icon circle, the text, time on the right.
  const SEV_WORD = { bad: 'Act now', warn: 'Check', ok: 'Info', info: 'Info' };
  const SEV_COLOR = { bad: 'var(--bad)', warn: 'var(--warn)', ok: 'var(--accent)', info: 'var(--accent)' };
  function alertIcon(type) {
    return type === 'delay' || type === 'overtime' ? ICON.clock : type === 'partial' ? ICON.half : type === 'dispute' || type === 'quote_no' ? ICON.cross
      : type === 'call' ? WA.icons.call   // 'call' = a client without WhatsApp must be phoned
      : type === 'price_diff' ? WA.icons.pay   // measured tanks differ from the locked (quoted) price
      : type === 'quote_yes' ? ICON.chat : ICON.alert;
  }
  function alertFeed(alerts, emptyText) {
    if (!alerts || !alerts.length) return '<div class="empty ins-m">' + esc(emptyText) + '</div>';
    return '<div class="ins-feed">' + alerts.map(a => {
      const sev = SEV_WORD[a.sev] ? a.sev : 'ok';
      return '<div class="ins-fi' + (a.seen === false ? ' new' : '') + '">' +
        WA.avatar('', { small: true, color: SEV_COLOR[sev], icon: alertIcon(a.type) }) +
        '<div class="mid"><div class="l1"><span class="tx">' + esc(a.text) + '</span><time>' + esc(feedTime(a.created_at)) + '</time></div>' +
        '<div class="l2"><span class="sub">' + SEV_WORD[sev] + (a.order_id ? ' · order #' + esc(a.order_id) : '') + '</span>' +
        (a.seen === false ? '<span class="bd bad">new</span>' : '') + '</div></div></div>';
    }).join('') + '</div>';
  }

  /* One row per team: the live status line (same words as Team routes, from
     App.teamLiveStatus in admin-orders.js), "1 of 3 done" and overtime.
     The progress bar shows only once at least one job is done (an empty bar looks broken). */
  function teamsToday(orders, byTeam) {
    const teams = (setup().teams || []).filter(t => t.active !== false);
    if (!teams.length) return '<div class="sub">No teams in the Setup sheet.</div>';
    return teams.map(t => {
      const os = orders.filter(o => o.team === t.team), done = os.filter(o => o.status === 'done').length;
      const otm = ((byTeam || []).find(x => x.team === t.team) || {}).minutes || 0;
      const st = App.teamLiveStatus ? App.teamLiveStatus(os) : { cls: 'idle', text: os.length ? '' : 'No jobs today' };
      return '<div class="row ins-tr" style="--tc:' + teamColor(t.team, teamKeys()) + '">' + tchip(t.team, true) +
        '<div class="ins-trm">' + (st.text ? '<div class="ao-live ' + st.cls + '"><i></i><span>' + esc(st.text) + '</span></div>' : '') +
        (done ? '<div class="prog"><i style="width:' + (done / os.length * 100) + '%"></i></div>' : '') + '</div>' +
        '<span class="sub num">' + (os.length ? done + ' of ' + os.length + ' done' : '') + (otm ? ' · OT ' + dur(otm) : '') + '</span></div>';
    }).join('');
  }

  onAct('ins-seen', async () => {
    try { await api('alerts.seen', {}); cacheDrop(['screen.dash', 'alerts.list']); if (App.setAlertBadge) App.setAlertBadge(0); refresh(); }
    catch (e) { if (e.message !== 'AUTH') toast(errText(e)); }
  });

  // "Book order" on an AMC visit: New order with the contract's visit, tanks and price filled in
  onAct('ins-book-amc', el => {
    const r = (S.due || [])[Number(el.dataset.i)];
    if (!r || !App.openNewOrder) return;
    App.openNewOrder({ phone: r.phone, client_name: r.client_name, address: r.address, area: r.area, client_type: r.client_type,
      amc: { amc_id: r.amc_id, visit_no: r.visit_no, visits: r.visits, visit_amount: r.visit_amount, tanks: r.tanks || [], due_date: r.due_date } });
  });

  // "Book order": opens the New order form with this phone (form lives in admin-orders.js)
  onAct('ins-book', el => {
    const phone = el.dataset.phone;
    if (App.openNewOrder) App.openNewOrder({ phone: phone });
    else { App.adminTab = 'new'; renderAdmin(); toast('New order for ' + phoneText(phone)); }
  });

  registerScreen('admin', 'dash', renderDash);

  /* ======================================================================
     2. CLIENTS: like WhatsApp on a computer.
        Left: search bar + client list. Right: the open client as a chat.
        On a phone-width screen only one side shows at a time
        (the list, or the client with a back arrow).
     ====================================================================== */

  function renderClients(el) {
    // Build the two panes once. Later calls keep the search box (so typing is never lost).
    if (!el.querySelector('#ins-split')) {
      el.innerHTML = '<header><div><h2>Clients</h2><p class="sub">One client = one phone number. The history comes from orders, payments, alerts and WhatsApp messages.</p></div></header>' +
        '<div class="ins-split" id="ins-split">' +
        '<div class="ins-lp"><div class="ins-sbar"><label class="ins-sbox">' + WA.icons.search +
        '<input type="search" id="ins-clq" data-inp="ins-clq" placeholder="Search by name or phone" aria-label="Search clients by name or phone"></label></div>' +
        '<div class="ins-cnt sub" id="ins-cl-cnt"></div>' +
        '<div class="wa-list" id="ins-cl-list"><div class="empty ins-m">Loading…</div></div></div>' +
        '<div class="ins-cp" id="ins-cl-chat"></div></div>';
      $('#ins-clq').value = S.clients.q;
    }
    loadClientList();
    showClientPane();
  }

  // Show the open client on the right (or the "pick a client" panel), and mark it in the list
  function showClientPane() {
    const el = $('#ad-clients');
    const open = !!S.clients.phone;
    el.classList.toggle('ins-open', open);
    showClientPaneMark();
    if (open) loadClientChat(S.clients.phone);
    else {
      ++chatSeq;   // forget any client still loading
      $('#ins-cl-chat').dataset.phone = '';
      $('#ins-cl-chat').innerHTML = '<div class="ins-intro">' + WA.avatar('', { icon: ICON.chat, color: 'var(--accent)' }) +
        '<h3>Pick a client</h3><p class="sub">Their orders, WhatsApp messages, payments and alerts show here like a chat, oldest at the top.</p></div>';
    }
  }

  // Draw the client rows and the count ("24 clients · updating…")
  function drawClientList(list, updating) {
    const box = $('#ins-cl-list');
    if (!box) return;
    const n = list.length;
    $('#ins-cl-cnt').innerHTML = (n ? n + ' client' + (n === 1 ? '' : 's') : '') + (updating ? ' ' + App.updNote() : '');
    box.innerHTML = clientRows(list);
  }
  // Search in the browser, in the full list we already have (same rule as the server: name or phone)
  function filterClients(all, q) {
    const t = String(q || '').trim().toLowerCase(), d = t.replace(/\D/g, '');
    if (!t) return all;
    return all.filter(c => String(c.client_name || '').toLowerCase().includes(t) || (d && String(c.phone).includes(d)));
  }

  let clientSeq = 0;
  async function loadClientList() {
    const my = ++clientSeq;
    const q = S.clients.q;
    // Instant answer first: the saved full list, filtered here (the server's answer replaces it)
    if (S.clients.all) drawClientList(filterClients(S.clients.all, q), true);
    try {
      await apiCached('client.list', { q: q }, r => {
        if (my !== clientSeq || !$('#ins-cl-list') || App.adminTab !== 'clients') return;
        if (!q) S.clients.all = r.clients;
        drawClientList(r.clients, true);
      });
      if (my !== clientSeq || !$('#ins-cl-list')) return;
      const c = $('#ins-cl-cnt .upd'); if (c) c.remove();
      showClientPaneMark();
    } catch (e) {
      if (e.message === 'AUTH' || my !== clientSeq || !$('#ins-cl-list')) return;
      if (S.clients.all) { const c = $('#ins-cl-cnt .upd'); if (c) c.remove(); toast(errText(e)); return; }   // keep the list we have
      $('#ins-cl-list').innerHTML = '<div class="empty ins-m">' + esc(errText(e)) + '<br><br><button class="btn pri" data-act="ins-cl-relist">Try again</button></div>';
    }
  }
  // Mark the open client in the list
  function showClientPaneMark() {
    $$('#ins-cl-list .wa-row').forEach(r => {
      if (r.dataset.phone === S.clients.phone) r.setAttribute('aria-current', 'true'); else r.removeAttribute('aria-current');
    });
  }
  onAct('ins-cl-relist', () => loadClientList());

  // One chat-list row per client: initials, name, last service date,
  // a preview line (area · last services · balance due) and a badge for disputes or a due visit
  function clientRows(list) {
    if (!list.length) return '<div class="empty ins-m">' + (S.clients.q ? 'No client matches "' + esc(S.clients.q) + '".' : 'No clients yet.') + '</div>';
    const t = todayIso(), remDays = Number(settings().reminder_days) || 20;
    return list.map(c => {
      const nvLeft = c.next_visit ? daysBetween(t, c.next_visit) : null;
      let badge = '', badgeCls = '';
      if (c.disputes) { badge = c.disputes === 1 ? 'Dispute' : c.disputes + ' disputes'; badgeCls = 'bad'; }
      else if (nvLeft != null && nvLeft < 0) { badge = 'Overdue'; badgeCls = 'bad'; }
      else if (nvLeft != null && nvLeft <= remDays) { badge = 'Visit due'; badgeCls = 'warn'; }
      return WA.row({
        name: c.client_name, time: shortDay(c.last_date), act: 'open-client', data: { phone: c.phone },
        current: c.phone === S.clients.phone, badge: badge, badgeCls: badgeCls,
        preview: (noWa(c) ? noWaPill() + ' ' : '') + esc(areaName(c.area)) + ' · ' + esc(svcShortList(c.last_services)) +
          (c.balance > 0 ? ' · <b class="ins-red">' + inr(c.balance) + ' due</b>' : '')
      });
    }).join('');
  }

  // Typing in the search box: filter the loaded list at once, then ask the server
  // when the admin stops typing for 300 ms
  let searchTimer = null;
  onInp('ins-clq', el => {
    S.clients.q = el.value;
    if (S.clients.all) drawClientList(filterClients(S.clients.all, S.clients.q), true);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadClientList, 300);
  });

  /* ---------- one client as a chat ---------- */
  let chatSeq = 0;
  async function loadClientChat(phone) {
    const my = ++chatSeq;
    const pane = $('#ins-cl-chat');
    // A different client was on screen: show "Loading…" so old details never show
    if (pane.dataset.phone !== phone) {
      pane.dataset.phone = phone;
      pane.innerHTML = '<div class="ins-intro"><p class="sub">Loading…</p></div>';
    }
    try {
      let shown = false;
      await apiCached('client.history', { phone: phone }, h => {
        if (my !== chatSeq || S.clients.phone !== phone || !$('#ins-cl-chat')) return;
        drawClientChat($('#ins-cl-chat'), h);
        shown = true;
      });
      if (shown || my !== chatSeq) return;
    } catch (e) {
      if (e.message === 'AUTH' || my !== chatSeq || !$('#ins-cl-chat')) return;
      if ($('#ins-msgs')) { toast(errText(e)); return; }   // keep the chat we are showing
      $('#ins-cl-chat').innerHTML = '<div class="ins-intro"><p>' + esc(errText(e)) + '</p>' +
        '<button class="btn pri" data-act="ins-cl-rechat">Try again</button> <button class="btn" data-act="ins-cl-back">Back to list</button></div>';
    }
  }
  onAct('ins-cl-rechat', () => { if (S.clients.phone) loadClientChat(S.clients.phone); });

  function drawClientChat(pane, h) {
    const c = h.client;
    const tel = 'tel:+' + c.phone;
    // Header: back arrow (phone width only), initials, name, phone and area; Call, Map, Book new order
    const head = WA.chatHead({
      title: c.client_name, back: 'ins-cl-back',
      sub: phoneText(c.phone) + ' · ' + areaName(c.area) + ' · ' + typeName(c.client_type),
      right: '<a class="wa-ib" href="' + esc(tel) + '" aria-label="Call" title="Call ' + esc(phoneText(c.phone)) + '">' + WA.icons.call + '</a>' +
        '<a class="wa-ib" href="' + esc(mapUrl(c)) + '" target="_blank" rel="noopener" aria-label="Map" title="Open the address in Google Maps">' + WA.icons.map + '</a>' +
        '<button class="ins-hbtn" data-act="ins-book" data-phone="' + esc(c.phone) + '" title="' + word('Book new order') + '">' + WA.icons.plus + '<span>' + word('Book new order') + '</span></button>'
    });
    S.clients.lastH = h;   // for redrawing only the card (AMC box)
    pane.innerHTML = head + pinnedCard(c, h) + '<div class="wa-msgs ins-msgs" id="ins-msgs">' + timeline(h) + '</div>';
    // Like a real chat: start at the newest message (the bottom)
    const m = $('#ins-msgs'); if (m) m.scrollTop = m.scrollHeight;
  }

  // Small card pinned at the top of the chat: totals, address, editable next visit
  function pinnedCard(c, h) {
    const remDays = Number(settings().reminder_days) || 20;
    const stat = (v, k, red) => '<div class="st"><b class="num' + (red ? ' ins-red' : '') + '">' + v + '</b><span>' + k + '</span></div>';
    return '<div class="ins-pin">' +
      '<div class="ins-stats">' +
      stat(esc(c.done) + '<small> / ' + esc(c.orders) + '</small>', 'jobs done') +
      stat(inr(c.billed), 'billed') +
      stat(inr(c.paid), 'paid · ' + h.payments.length) +
      stat(inr(c.balance), c.balance > 0 ? 'to collect' : 'balance', c.balance > 0) +
      stat(esc(c.disputes), 'dispute' + (c.disputes === 1 ? '' : 's'), c.disputes > 0) +
      '</div>' +
      '<div class="ins-addr sub">' + esc(c.address) + ' · client since ' + esc(dateLab(c.first_date)) + '</div>' +
      // Log book: the tank sizes saved at the last visit (pre-filled for the driver next time)
      ((c.tanks || []).length ? '<div class="ins-tanks"><b>Tanks</b> ' + c.tanks.map(t => '<span class="num">' + esc(tankText(t)) + '</span>').join('') +
        (c.tanks.length > 1 ? '<span class="sub">total ' + esc(litresText(tanksTotal(c.tanks))) + ' L</span>' : '') + '</div>' : '') +
      // Uses WhatsApp? Yes / No. No = nothing is sent to this client; drivers and the office call instead.
      '<div class="ins-nv ins-wa"><span class="ins-nvl">' + ICON.chat + 'WhatsApp</span>' +
      '<span class="chips" role="group" aria-label="Does this client use WhatsApp?">' +
      ['yes', 'no'].map(v => '<button type="button" class="chip" data-act="ins-wa" data-v="' + v + '" data-phone="' + esc(c.phone) + '" aria-pressed="' +
        ((noWa(c) ? 'no' : 'yes') === v) + '">' + (v === 'yes' ? 'Yes' : 'No') + '</button>').join('') + '</span>' +
      '<span class="sub">' + (noWa(c) ? 'No messages are sent. Drivers and the office call: <a class="lnk" href="tel:+' + esc(c.phone) + '">' + esc(phoneText(c.phone)) + '</a>'
        : 'Gets the WhatsApp updates.') + '</span></div>' +
      '<div class="ins-nv"><span class="ins-nvl">' + ICON.cal + 'Next visit</span>' +
      '<input class="fsel" type="date" id="ins-nv" aria-label="Next visit date" value="' + esc(c.next_visit || '') + '">' +
      '<button class="btn pri sm" data-act="ins-nv-save" data-phone="' + esc(c.phone) + '">Save</button>' +
      (c.next_visit ? '<button class="btn sm" data-act="ins-nv-clear" data-phone="' + esc(c.phone) + '">Clear</button> ' + dueText(daysBetween(todayIso(), c.next_visit))
        : '<span class="sub">Not set. Shows in "Visits due" ' + remDays + ' days before.</span>') +
      '</div>' + amcBox(c, h) + '</div>';
  }
  /* ---------- AMC box on the client card (added 2026-10-08) ----------
     No contract: [Start AMC] opens a small form: start date, visits a year (1-12),
     discount %, the price of one visit from the saved tanks (price.quote), the total
     and an editable final amount. No saved tanks: "Book a survey first".
     Active: "AMC1001 · 1 of 4 done · next due 12 Jan · ends 7 Oct 2027 · ₹3,600" + [Cancel AMC].
     Visits are not booked automatically: they show in "Visits due" on the Dashboard. */
  // "12 Jan" (adds the year when it is not this year); with year: "7 Oct 2027"
  const dShort = s => { const d = pd(s); return d.getDate() + ' ' + MON[d.getMonth()] + (s.slice(0, 4) !== todayIso().slice(0, 4) ? ' ' + s.slice(0, 4) : ''); };
  const dLong = s => { const d = pd(s); return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + s.slice(0, 4); };
  // The AMC form state, for the open client
  function amcState(phone) {
    if (!S.clients.amc || S.clients.amc.phone !== phone) S.clients.amc = { phone: phone, open: false, cancel: false, vp: null, typed: false };
    return S.clients.amc;
  }
  function amcBox(c, h) {
    if (!hasMod('amc')) return '';   // AMC contracts are an add-on
    const st = amcState(c.phone), a = c.amc, ph = esc(c.phone);
    const past = (h.contracts || []).filter(x => !a || x.amc_id !== a.amc_id);
    let inner;
    if (a) {
      inner = '<span class="ins-amct"><b>' + esc(a.amc_id) + '</b> · ' + esc(a.done) + ' of ' + esc(a.visits) + ' done · ' +
        (a.next_due ? 'next due ' + esc(dShort(a.next_due)) : 'all visits booked') + ' · ends ' + esc(dLong(a.end_date)) + ' · <b class="num">' + inr(a.amount) + '</b></span>' +
        (st.cancel
          ? '<span class="ins-amcx"><input class="fsel" id="ins-amc-why" maxlength="150" placeholder="Reason (optional)" aria-label="Reason for cancelling the AMC">' +
            '<button class="btn sm danger" data-act="ins-amc-cxgo" data-id="' + esc(a.amc_id) + '" data-phone="' + ph + '">Cancel AMC</button>' +
            '<button class="btn sm" data-act="ins-amc-cxno">Keep</button></span>'
          : '<button class="btn sm" data-act="ins-amc-cx">Cancel AMC</button>');
    } else if (!(c.tanks || []).length) {
      inner = '<span class="sub">No contract. Book a survey first: the AMC price comes from the measured tanks.</span>' +
        '<button class="btn sm" disabled title="No saved tank sizes yet">Start AMC</button>' +
        (hasMod('quotation') ? '<button class="btn sm pri" data-act="ins-survey" data-phone="' + ph + '">Book survey</button>' : '');
    } else if (!st.open) {
      inner = '<span class="sub">No contract.</span><button class="btn sm pri" data-act="ins-amc-open" data-phone="' + ph + '">Start AMC</button>';
    } else {
      inner = '<div class="ins-amcf"><div class="form-grid">' +
        '<div class="fld"><label for="ins-amc-start">Start date</label><input id="ins-amc-start" type="date" value="' + todayIso() + '"></div>' +
        '<div class="fld"><label for="ins-amc-visits">Visits a year</label><select id="ins-amc-visits" data-chg="ins-amc-calc">' +
        Array.from({ length: 12 }, (x, i) => '<option value="' + (i + 1) + '"' + (i === 3 ? ' selected' : '') + '>' + (i + 1) + '</option>').join('') + '</select></div>' +
        '<div class="fld"><label for="ins-amc-disc">Discount %</label><input id="ins-amc-disc" inputmode="decimal" value="0" data-inp="ins-amc-calc"></div>' +
        '<div class="fld"><label for="ins-amc-amt">Final amount (₹)</label><input id="ins-amc-amt" inputmode="numeric" data-inp="ins-amc-amt"></div>' +
        '</div><div class="sub" id="ins-amc-calc"></div>' +
        '<div class="ins-amcb"><button class="btn sm pri" data-act="ins-amc-save" data-phone="' + ph + '">Save AMC</button>' +
        '<button class="btn sm" data-act="ins-amc-close">Cancel</button></div></div>';
    }
    return '<div class="ins-nv ins-amc"><span class="ins-nvl">' + ICON.cal + 'AMC</span>' + inner + '</div>' +
      (past.length ? '<div class="ins-amch sub">Earlier: ' + past.map(x => esc(x.amc_id) + ' ' + esc(x.status) + (x.cancel_reason ? ' (' + esc(x.cancel_reason) + ')' : '') +
        ', ' + esc(dShort(x.start_date)) + ' to ' + esc(dLong(x.end_date))).join(' · ') + '</div>' : '');
  }
  // The price line under the AMC form: one visit x visits - discount = total (the final amount follows until typed)
  function amcCalc() {
    const st = S.clients.amc, box = $('#ins-amc-calc');
    if (!st || !box) return;
    if (st.vp === null) { box.textContent = 'Working out the price of one visit from the saved tanks…'; return; }
    const n = Number($('#ins-amc-visits').value) || 1, dRaw = Number($('#ins-amc-disc').value) || 0, d = Math.min(50, Math.max(0, dRaw));
    const total = Math.round(st.vp * n * (1 - d / 100));
    box.innerHTML = 'One visit (cleaning, from the saved tanks): <b>' + inr(st.vp) + '</b> × ' + n + ' visit' + (n === 1 ? '' : 's') +
      (d ? ' − ' + d + '%' : '') + ' = <b>' + inr(total) + '</b>. Billed per visit (' + inr(Math.round(total / n)) + ' each).' +
      (dRaw > 50 ? ' <span class="ins-red">Discount is at most 50%.</span>' : '');
    if (!st.typed) $('#ins-amc-amt').value = total;
  }
  // Redraw only the card at the top of the client chat (the chat keeps its scroll position)
  function redrawPin() {
    const h = S.clients.lastH, pin = $('#ins-cl-chat .ins-pin');
    if (h && pin) { pin.outerHTML = pinnedCard(h.client, h); amcCalc(); }
  }
  onAct('ins-amc-open', async el => {
    const h = S.clients.lastH;
    if (!h) return;
    const st = amcState(el.dataset.phone);
    st.open = true; st.typed = false;
    redrawPin();
    if (st.vp !== null) return;
    try {
      // priced as cleaning: ot / ug from the tank positions (a price.quote without a cleaning service has no tank price)
      const svcs = Array.from(new Set(h.client.tanks.map(t => t.type === 'UG' ? 'ug' : 'ot')));
      const q = await api('price.quote', { tanks: h.client.tanks, services: svcs });
      st.vp = q.tanks_total;
      amcCalc();
    } catch (e) { if (e.message !== 'AUTH') { const b = $('#ins-amc-calc'); if (b) b.textContent = errText(e); } }
  });
  onAct('ins-amc-close', () => { if (S.clients.amc) S.clients.amc.open = false; redrawPin(); });
  onChg('ins-amc-calc', () => amcCalc());
  onInp('ins-amc-calc', () => amcCalc());
  onInp('ins-amc-amt', el => { if (S.clients.amc) S.clients.amc.typed = !!el.value.trim(); if (!el.value.trim()) amcCalc(); });
  onAct('ins-amc-save', async el => {
    const st = S.clients.amc, phone = el.dataset.phone;
    const body = { phone: phone, start_date: $('#ins-amc-start').value, visits: Number($('#ins-amc-visits').value), discount_pct: Number($('#ins-amc-disc').value) || 0 };
    if (st && st.typed) body.amount = Number(String($('#ins-amc-amt').value).replace(/[^\d.]/g, ''));
    if (!body.start_date) { toast('Pick the start date.'); return; }
    el.disabled = true; el.textContent = 'Saving…';
    try {
      const r = await api('amc.create', body);
      toast('AMC ' + r.contract.amc_id + ' started: ' + r.contract.visits + ' visits, ' + inr(r.contract.amount) + '. Visits show in "Visits due".');
      if (st) st.open = false;
      cacheDrop(['client.list', 'client.history', 'client.lookup', 'reminders.list', 'screen.dash']);
      loadClientChat(phone);
    } catch (e) { el.disabled = false; el.textContent = 'Save AMC'; if (e.message !== 'AUTH') toast(errText(e)); }
  });
  onAct('ins-amc-cx', () => { const st = S.clients.amc; if (st) { st.cancel = true; redrawPin(); const i = $('#ins-amc-why'); if (i) i.focus(); } });
  onAct('ins-amc-cxno', () => { const st = S.clients.amc; if (st) { st.cancel = false; redrawPin(); } });
  onAct('ins-amc-cxgo', async el => {
    el.disabled = true;
    try {
      await api('amc.cancel', { amc_id: el.dataset.id, reason: ($('#ins-amc-why').value || '').trim() });
      toast('AMC ' + el.dataset.id + ' cancelled. Booked visit orders stay; cancel them in Orders if needed.');
      if (S.clients.amc) S.clients.amc.cancel = false;
      cacheDrop(['client.list', 'client.history', 'client.lookup', 'reminders.list', 'screen.dash']);
      loadClientChat(el.dataset.phone);
    } catch (e) { el.disabled = false; if (e.message !== 'AUTH') toast(errText(e)); }
  });
  // "Book survey": New order as a survey visit for this client
  onAct('ins-survey', el => { if (App.openNewOrder) App.openNewOrder({ phone: el.dataset.phone, kind: 'survey' }); });



  /* The history as one chat, oldest at the top:
       order   -> white bubble on the left ("Order #1045")
       message -> from the business on the right (with ticks), customer replies on the left
       payment -> right bubble "₹X received · mode"
       alert   -> note in the middle (red when bad)
     A date chip is put in whenever the day changes. */
  function timeline(h) {
    const ev = [];
    // order: 0, message: 1, payment: 2, alert: 3 (when two things have the same time, this is the order)
    h.orders.forEach(o => ev.push({ ts: o.sched_date + 'T' + (o.sched_time || '00:00') + ':00', k: 0, html: orderBubble(o) }));
    h.messages.forEach(m => ev.push({ ts: m.ts, k: 1, html: messageBubble(m) }));
    h.payments.forEach(p => ev.push({ ts: p.date, k: 2, html: paymentBubble(p) }));
    h.alerts.forEach(a => ev.push({ ts: a.created_at, k: 3, html: alertNote(a) }));
    ev.sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.k - b.k);
    if (!ev.length) return '<div class="wa-sys">No history yet.</div>';
    let day = '', out = '';
    ev.forEach(e => {
      const d = String(e.ts).slice(0, 10);
      if (d !== day) { day = d; out += WA.day(dayChip(d)); }
      out += e.html;
    });
    return out;
  }

  // "cash 1000 + upi 500" (pay_modes of an archived order) -> "Cash ₹1,000 + UPI ₹500"
  const payModesText = t => esc(t).replace(/\b([a-z]+) (\d+(?:\.\d+)?)\b/gi,
    (all, m, n) => esc((MODE[m.toLowerCase()] || { en: m }).en) + ' ' + inr(n));

  // One order as a bubble: services, team, amount, status, done / not done, notes, moved, delay.
  // An ARCHIVED order (o.archived, a month long over, from the OrderHistory tab) keeps only
  // the history: grey "Archived" pill, no ⋯ menu (it can no longer be changed), no work times,
  // the driver's name as it was then, and "Paid by" (how it was paid).
  function orderBubble(o) {
    const arch = !!o.archived;
    const bal = Number(o.amount || 0) - Number(o.paid || 0);
    const done = o.done_checklist || [], notDone = o.not_done || [];
    const kv = [];
    const row = (k, v) => kv.push('<dt>' + k + '</dt><dd>' + v + '</dd>');
    const sv = o.kind === 'survey', cx = o.status === 'cancelled';
    // A survey visit: the supervisor measured the tanks for a quotation (no team, no bill)
    if (sv) row('Survey', '<span class="pill ao-sv">Survey visit</span> ' + (App.quotePill ? App.quotePill(o) : '') +
      (o.status === 'done' && !cx && App.quoteBtn ? ' ' + App.quoteBtn(o) : ''));
    row(sv ? 'Wants' : 'Services', esc(svcList(o.services)) || '<span class="sub">not said</span>');
    if (!sv) row('Team', arch ? tchip(o.team) + (o.driver_name ? ' <span class="sub">' + esc(o.driver_name) + '</span>' : '') : tchip(o.team, true));
    if (sv) row('Quotation', Number(o.quote_amount) ? '<b class="num">' + inr(o.quote_amount) + '</b>' +
      (o.quote_sent_at ? ' <span class="sub">sent ' + esc(shortDay(String(o.quote_sent_at).slice(0, 10))) + '</span>' : '') : '<span class="sub">not measured yet</span>');
    else row('Amount', '<b class="num">' + inr(o.amount) + '</b>' +
      (o.price_locked ? ' <span class="pill" title="The price stays as agreed">Price locked</span>' : '') +
      (cx ? ' <span class="sub">cancelled, not billed</span>' : o.status === 'done' ? ' <span class="sub">paid ' + inr(o.paid) + '</span>' + (bal > 0 ? ' <b class="ins-red num">' + inr(bal) + ' due</b>' : ' <span class="pill ok">Fully paid</span>')
        : ' <span class="sub">not billed yet</span>'));
    // Several days, AMC visit, made from a quotation
    const plan = [];
    if (jobDays(o) > 1) plan.push(jobDays(o) + ' days · ' + esc(lab(o.sched_date)) + ' to ' + esc(lab(jobEnd(o))));
    if (o.amc_id) plan.push('<span class="pill ok">AMC ' + esc(o.amc_id) + ' · visit ' + esc(o.amc_visit) + '</span>');
    if (o.from_quote) plan.push('From survey #' + esc(o.from_quote) + ' (quotation)');
    if (plan.length) row('Booking', plan.join(' · '));
    const wd = workDays(o);
    if (wd.length) row('Days worked', wd.map((w, i) => 'Day ' + (i + 1) + ' · ' + esc(dayChip(w.date)) + ' · ' + fm(mins(w.reached)) + ' to ' +
      (w.left ? fm(mins(w.left)) : 'in progress') + (Number(w.overtime_min) > 0 ? ' · OT ' + esc(dur(Number(w.overtime_min))) : '')).join('<br>'));
    row('Status', (cx && App.cancelPill ? App.cancelPill(o) : statusPill(o)) +
      (cx && o.cancelled_by ? ' <span class="ins-by">Cancelled by ' + esc(o.cancelled_by) + '</span>' : '') +
      (o.customer_confirm === 'yes' ? ' <span class="pill ok">Customer confirmed</span>'
        : o.customer_confirm === 'no' ? ' <span class="pill bad">Customer said no</span>'
        : o.status === 'done' && !sv ? ' <span class="pill">No reply yet</span>' : '') +
      (o.dispute ? ' <span class="pill bad">Dispute</span>' : '') +
      (o.overtime_min > 0 ? ' <span class="pill warn">OT ' + esc(dur(o.overtime_min)) + '</span>' : '') +
      (arch ? ' <span class="pill">Archived</span>' : ''));
    if (arch && o.pay_modes) row('Paid by', payModesText(o.pay_modes));
    if (noWa(o)) row('WhatsApp', noWaPill());
    if (o.status === 'done' && !sv) {
      row('Done', done.length ? esc(svcList(done)) : '-');
      if (notDone.length) row('Not done', '<span class="ins-red">' + esc(svcList(notDone)) + '</span>');
      // Work window: reached -> done. Older jobs may only have the finish time.
      // Log book: who did the job (names the driver tapped)
      if ((o.crew || []).length) row('Crew', esc(o.crew.join(', ')));
      if (o.done_at && !arch) row('Worked', (o.reached_at ? fm(mins(o.reached_at)) + ' to ' : 'finished at ') + fm(mins(o.done_at)));
    }
    if (o.moved_from) row('Moved from', esc(dateLab(o.moved_from)) +
      (o.delay_reason && REASON[o.delay_reason] && !(o.delay_min > 0) ? ' · ' + esc(REASON[o.delay_reason].en) : ''));
    if (o.delay_min > 0) row('Delay', 'about ' + esc(o.delay_min) + ' min' + (o.delay_reason && REASON[o.delay_reason] ? ' · ' + esc(REASON[o.delay_reason].en) : ''));
    // Log book: tank sizes (measured by the driver, or copied from the last visit)
    if ((o.tanks || []).length) row('Tanks', o.tanks.map(t => '<span class="ins-tk num">' + esc(tankText(t)) + '</span>').join(''));
    if (o.customer_time) row('Customer says', 'finished at ' + esc(o.customer_time));
    if (o.notes) row('Notes', esc(o.notes));
    if (o.next_visit) row('Next visit', esc(dateLab(o.next_visit)));

    // Cancelled orders stay in the history, greyed out
    const cls = (cx ? 'ins-cx' : o.dispute ? 'bad' : (notDone.length || o.delay_min > 0) ? 'warn' : '') + (arch ? ' ins-arch' : '');
    // "⋯" menu (Edit / Reschedule / Cancel / Restore), from admin-orders.js. Not for archived orders.
    const menu = App.orderMenuBtn && !arch ? '<span class="ins-om">' + App.orderMenuBtn(o) + '</span>' : '';
    // Who did what (admin names; blank on older orders, then nothing is shown)
    const by = [];
    if (o.created_by) by.push('Booked by ' + esc(o.created_by));
    if (o.updated_by && o.updated_by !== o.created_by) by.push('Edited by ' + esc(o.updated_by));
    const byLine = by.length ? '<div class="ins-by ins-byl">' + by.join(' · ') + '</div>' : '';
    return WA.bubble('in', menu + '<dl class="kv">' + kv.join('') + '</dl>' + byLine, fm(mins(o.sched_time)),
      { who: 'Order #' + o.order_id, cls: ('ins-ob ' + cls).trim() });
  }

  // WhatsApp log. Template keys are shown in plain words.
  const TEMPLATE_EN = {
    arrival_confirm: 'Arrival confirm', work_done_checklist: 'Work done checklist', delay: 'Delay',
    arrival_time: 'Arrival time', rescheduled: 'Rescheduled', payment_thanks: 'Payment thanks',
    quotation: 'Quotation'
  };
  // Message text: plain text as is; template values ({"amount":1200}) as "amount 1200 · ..."
  function bodyText(body) {
    if (!body) return '';
    try {
      const p = JSON.parse(body);
      if (p && typeof p === 'object') {
        // Show names, not codes: services "ot" -> "Overhead tank cleaning", mode "upi" -> "UPI"
        const nice = (k, v) => /amount|balance|total/.test(k) ? inr(v)
          : Array.isArray(v) ? (v.length ? v.map(svcName).join(', ') : 'none')
          : k === 'mode' && MODE[v] ? MODE[v].en
          : typeof v === 'boolean' ? (v ? 'yes' : 'no') : v;
        return Object.keys(p).map(k => esc(k.replace(/_/g, ' ')) + ' <b>' + esc(nice(k, p[k])) + '</b>').join(' · ');
      }
    } catch (e) { /* not JSON: plain text */ }
    return esc(body);
  }
  /* ---------- "In English: …" under each message (added 2026-10-08) ----------
     Customers get Gujarati only. The owner's helpers may not read Gujarati, so every
     message in the history gets a muted line with its meaning in English.
     - From the business: the English of the template, with the values filled in.
       The values come from the logged params (demo mode: {"mins":30,...}) or are read
       out of the Gujarati text the server logged (live: the same words as the templates
       in apps-script/whatsapp.gs, copied below; if a wording changes there, the line
       still shows, only without the values).
     - From the customer: the meaning of the buttons and common answers; anything else
       typed by the customer is not translated. */
  const WA_GU = {
    arrival_confirm: 'નમસ્તે! {{1}} ની ટીમ ટાંકીની સફાઈ માટે તમારા ઘરે પહોંચી ગઈ છે. શું ટીમ પહોંચી ગઈ છે? કૃપા કરીને જણાવો.',
    work_done_checklist: 'તમારી ટાંકીનું કામ પૂર્ણ થયું છે. થયું: {{1}}. બાકી: {{2}}. આ બરાબર છે?',
    delay: 'માફ કરજો, અમારી ટીમ લગભગ {{1}} મિનિટ મોડી પહોંચશે. કારણ: {{2}}. અમે લગભગ {{3}} સુધીમાં પહોંચી જઈશું.',
    arrival_time: 'નમસ્તે! અમારી ટીમ પહેલાનું કામ પૂર્ણ કરીને તમારી તરફ નીકળી છે. લગભગ {{1}} સુધીમાં પહોંચી જઈશું.',
    rescheduled: 'નમસ્તે! તમારી ટાંકીની સફાઈ હવે {{1}} ના રોજ {{2}} વાગ્યે રાખી છે. કારણ: {{3}}. આ સમય ન ફાવે તો અમને જવાબ આપજો.',
    quotation: 'નમસ્તે {{1}}! {{2}} તરફથી ટાંકી સફાઈનો ભાવ: ટાંકી: {{3}}. વધારાની સેવા: {{4}}. કુલ રકમ: {{5}}. મંજૂર હોય તો હા દબાવો, તારીખ નક્કી કરવા અમે તમને ફોન કરીશું.',
    payment_thanks: 'ચુકવણી બદલ આભાર! અમને {{1}} {{2}} દ્વારા મળ્યા છે. બાકી રકમ: {{3}}.'
  };
  const WA_EN = {
    arrival_confirm: 'Hello! The {1} team has reached your home to clean the tank. Has the team arrived? Please reply. [Yes / No]',
    work_done_checklist: 'Your tank work is finished. Done: {1}. Pending: {2}. Is this right? [Yes, fine / No, not fine]',
    delay: 'Sorry, our team will reach about {1} minutes late. Reason: {2}. We will reach by about {3}.',
    arrival_time: 'Hello! Our team has finished the previous job and is on the way to you. We will reach by about {1}.',
    rescheduled: 'Hello! Your tank cleaning is now on {1} at {2}. Reason: {3}. If this time does not suit you, please reply.',
    quotation: 'Hello {1}! Tank cleaning price from {2}: Tanks: {3}. Extra services: {4}. Total: {5}. Press Yes to accept; we will call you to fix the date. [Yes / No]',
    payment_thanks: 'Thank you for your payment! We received {1} by {2}. Balance: {3}.',
    // follow-ups inside the 24-hour window (whatsapp.gs WA_SESSION)
    arrive_no: 'Sorry. We are checking now and will call you soon.',
    time_ask: 'Sorry. When was the work finished? [before 12 / 12 to 3 / after 3]',
    noted: 'Thank you. We have noted it; the owner will call you.'
  };
  // The same meaning when the log has no values (e.g. old sample rows with an empty body)
  const WA_EN_NOVAL = {
    arrival_confirm: 'Hello! Our team has reached your home to clean the tank. Has the team arrived? Please reply. [Yes / No]',
    work_done_checklist: 'Your tank work is finished. Is this right? [Yes, fine / No, not fine]',
    delay: 'Sorry, our team will be late. We will reach soon.',
    arrival_time: 'Hello! Our team has finished the previous job and is on the way to you.',
    rescheduled: 'Hello! Your tank cleaning has a new date. If this time does not suit you, please reply.',
    quotation: 'Hello! Here is the price for your tank cleaning. Press Yes to accept; we will call you to fix the date. [Yes / No]',
    payment_thanks: 'Thank you for your payment!'
  };
  // Customer answers (buttons and common words) -> English
  const REPLY_EN = {
    'હા': 'Yes', 'હાં': 'Yes', 'ના': 'No', 'હા, બરાબર': 'Yes, fine', 'ના, બરાબર નથી': 'No, not fine',
    '12 પહેલાં': 'before 12 PM', '12 થી 3': 'between 12 and 3 PM', '3 પછી': 'after 3 PM'
  };
  const hasGu = t => /[\u0A80-\u0AFF]/.test(String(t || ''));
  // Gujarati words that appear inside template values -> English (longest first)
  function guWordsEn(v) {
    let t = String(v == null ? '' : v);
    if (!hasGu(t)) return t;
    const pairs = [['કંઈ નહીં, બધું ચૂકવાઈ ગયું', 'nothing, all paid'], ['કંઈ નહીં', 'none'], ['અન્ય રીતે', 'other']];
    Object.keys(REASON).forEach(k => pairs.push([REASON[k].gu, REASON[k].en]));
    Object.keys(MODE).forEach(k => pairs.push([MODE[k].gu, MODE[k].en]));
    (setup().services || []).forEach(x => { if (x.name_gu) pairs.push([x.name_gu, x.name_en || x.key]); });
    pairs.push(['તમારી વિનંતી મુજબ', 'as you requested'], ['અમારી ટીમ ઉપલબ્ધ નથી', 'our team is not available'], ['ખરાબ હવામાન', 'bad weather']);
    ['રવિવાર', 'સોમવાર', 'મંગળવાર', 'બુધવાર', 'ગુરુવાર', 'શુક્રવાર', 'શનિવાર'].forEach((d, i) =>
      pairs.push([d, ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]]));
    pairs.push(['સિમેન્ટ ટાંકી', 'cement tank(s)'], ['પ્લાસ્ટિક ટાંકી', 'plastic tank(s)'], ['લિ.', 'L'], ['ટાંકી સફાઈ સેવા', 'tank cleaning service'], ['ગ્રાહક', 'customer']);
    pairs.sort((a, b) => b[0].length - a[0].length).forEach(p => { if (p[0]) t = t.split(p[0]).join(p[1]); });
    return t;
  }
  // The values {{1}}, {{2}}… read out of the Gujarati text the server logged (null if it does not match)
  function valuesFromText(tpl, text) {
    const b = WA_GU[tpl];
    if (!b) return null;
    const reEsc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^' + b.split(/\{\{\d+\}\}/).map(reEsc).join('(.*?)') + '$');
    const mm = String(text || '').replace(/\s*\[ERROR:[\s\S]*\]\s*$/, '').trim().match(re);
    return mm ? mm.slice(1) : null;
  }
  // The values from the params the demo server logs ({"mins":30,"reason":"traffic","time":"11:05"})
  function valuesFromParams(tpl, p) {
    const agency = (setup().settings || {}).agency_name || 'our';
    const t12 = v => (v && /^\d{1,2}:\d{2}$/.test(String(v)) ? fm(mins(v)) : v);
    const list = a => (Array.isArray(a) ? (a.length ? a.map(svcName).join(', ') : 'none') : a);
    switch (tpl) {
      case 'arrival_confirm': return [agency];
      case 'work_done_checklist': return [list(p.done), list(p.not_done)];
      case 'delay': return [p.mins, REASON[p.reason] ? REASON[p.reason].en : p.reason, t12(p.time)];
      case 'arrival_time': return [t12(p.time)];
      case 'rescheduled': return [p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? lab(p.date) : p.date, t12(p.time), p.reason];
      case 'quotation': return [p.client_name, agency, p.tanks, list(p.addons || p.services || []), p.total !== undefined ? inr(p.total) : ''];
      case 'payment_thanks': return [inr(p.amount), MODE[p.mode] ? MODE[p.mode].en : p.mode, Number(p.balance) > 0 ? inr(p.balance) : 'nothing, all paid'];
    }
    return [];
  }
  // The English meaning of one logged message (text, not HTML), or '' when there is nothing to say
  function messageEn(m) {
    if (m.direction === 'in') {
      const t = String(m.body || '').trim();
      if (REPLY_EN[t]) return REPLY_EN[t];
      return hasGu(t) ? "(the customer's own words, not translated)" : '';
    }
    const en = WA_EN[m.template];
    if (!en) return '';
    let vals = null;
    try { const p = JSON.parse(m.body); if (p && typeof p === 'object') vals = valuesFromParams(m.template, p); } catch (e) { /* plain text */ }
    if (!vals) vals = valuesFromText(m.template, m.body) || [];
    if (!vals.some(v => v !== undefined && v !== null && v !== '') && WA_EN_NOVAL[m.template]) return WA_EN_NOVAL[m.template];
    return en.replace(/\{(\d)\}/g, (all, n) => {
      const v = vals[Number(n) - 1];
      return v === undefined || v === null || v === '' ? '…' : guWordsEn(v);
    });
  }

  function messageBubble(m) {
    const time = fm(mins(m.ts)) + (m.order_id ? ' · #' + m.order_id : '');
    const en = enMeanAlways(esc(messageEn(m)));   // "In English: …" (muted)
    if (m.direction === 'in') {
      // Customer reply: left side, like the other person in a chat
      return WA.bubble('in', (bodyText(m.body) || '<span class="sub">(no text)</span>') + en, time, { who: 'Customer', cls: 'ins-cust' });
    }
    // From the business: right side. 1 tick = sent, 2 ticks = delivered / read (blue when read)
    const st = m.status || '';
    // Client without WhatsApp: logged, never sent. Grey, no ticks: what the customer should have been told.
    if (st === 'skipped_no_wa') {
      const tp = m.template ? '<span class="ins-tpl">' + ICON.chat + esc(TEMPLATE_EN[m.template] || m.template) + '</span>' : '';
      const bd = bodyText(m.body);
      return WA.bubble('out', tp + (bd ? '<div>' + bd + '</div>' : '') + en + '<div class="ins-skip">Not sent · no WhatsApp</div>', time, { cls: 'ins-skipped' });
    }
    const ticks = st === 'delivered' || st === 'read' ? 2 : st === 'failed' ? 0 : 1;
    const tpl = m.template ? '<span class="ins-tpl">' + ICON.chat + esc(TEMPLATE_EN[m.template] || m.template) + '</span>' : '';
    const body = bodyText(m.body);
    return WA.bubble('out', tpl + (body ? '<div>' + body + '</div>' : (tpl ? '' : '<span class="sub">(template text)</span>')) + en +
      (st === 'failed' ? '<div class="ins-red">Not sent</div>' : ''),
      time, { ticks: ticks, cls: (st === 'failed' ? 'bad' : st === 'read' ? 'ins-read' : 'ins-unread') });
  }
  function paymentBubble(p) {
    return WA.bubble('out', '<b class="ins-paid">' + inr(p.amount) + ' received</b> · ' + esc((MODE[p.mode] || { en: p.mode }).en) +
      '<div class="sub">Order #' + esc(p.order_id) + (p.note ? ' · ' + esc(p.note) : '') + '</div>',
      fm(mins(p.date)), { cls: 'ins-pb' });
  }
  // Alert: a note in the middle. Red for "Act now", yellow for "Check", blue for info.
  function alertNote(a) {
    const sev = a.sev === 'bad' ? 'ins-bad' : a.sev === 'warn' ? '' : 'ins-info';
    return '<div class="wa-sys ' + sev + '">' + esc(fm(mins(a.created_at))) + ' · ' + esc(a.text) + '</div>';
  }

  // Save or clear the next visit date
  async function saveNextVisit(phone, date) {
    try {
      await api('client.setNextVisit', { phone: phone, next_visit: date });
      cacheDrop(['client.list', 'client.history', 'reminders.list', 'screen.dash']);
      toast(date ? 'Next visit saved: ' + lab(date) : 'Next visit cleared');
      refresh();
    } catch (e) { if (e.message !== 'AUTH') toast(errText(e)); }
  }
  onAct('ins-nv-save', el => {
    const v = ($('#ins-nv') || {}).value || '';
    if (!v) { toast('Pick a date first, or use Clear.'); return; }
    saveNextVisit(el.dataset.phone, v);
  });
  onAct('ins-nv-clear', el => saveNextVisit(el.dataset.phone, ''));

  // WhatsApp Yes / No on the client card (saved on the client's latest order, client.setWhatsapp)
  onAct('ins-wa', async el => {
    const phone = el.dataset.phone, v = el.dataset.v === 'no' ? 'no' : 'yes';
    if (el.getAttribute('aria-pressed') === 'true') return;   // already this value
    // Show the choice at once; put it back if saving fails
    const btns = $$('[data-act="ins-wa"]');
    btns.forEach(b => { b.setAttribute('aria-pressed', String(b === el)); b.disabled = true; });
    try {
      await api('client.setWhatsapp', { phone: phone, whatsapp: v });
      cacheDrop(['client.list', 'client.history', 'client.lookup', 'order.list', 'screen.dash']);
      toast(v === 'no' ? 'Saved: no WhatsApp. Nothing will be sent; staff will see "call".' : 'Saved: uses WhatsApp.');
      refresh();
    } catch (e) {
      btns.forEach(b => { b.setAttribute('aria-pressed', String(b !== el)); b.disabled = false; });
      if (e.message !== 'AUTH') toast(errText(e));
    }
  });

  // Back arrow (phone width): close the client, show the list again

  onAct('ins-cl-back', () => { S.clients.phone = ''; showClientPane(); window.scrollTo(0, 0); });

  // Global: open one client's page from any screen
  function openClient(phone) {
    S.clients.phone = phone;
    if (App.adminTab === 'clients' && $('#ins-split')) showClientPane();   // already on Clients: just open the chat
    else { App.adminTab = 'clients'; renderAdmin(); }
    // On a phone-width screen, bring the chat to the top of the screen
    const pane = $('#ins-cl-chat');
    if (pane && window.matchMedia('(max-width:979px)').matches) pane.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 0);
  }
  App.openClient = openClient;
  onAct('open-client', (el, e) => {
    if (e) e.stopPropagation();
    if (!hasMod('clients')) return;   // no client pages without the Clients add-on
    if (el.dataset.phone) openClient(el.dataset.phone);
  });

  registerScreen('admin', 'clients', renderClients);

  /* ======================================================================
     3. PAYMENTS
     ====================================================================== */

  function renderPay(el) {
    const area = S.pay.area;
    // ONE trip for the whole screen
    const calls = [
      ['ledger.get', {}],                    // the whole ledger (for the tiles)
      ['order.list', { status: 'done' }],    // done jobs (to find ones not in the ledger yet)
      ['payment.list', {}]                   // last 30 days of collections
    ];
    if (area) calls.push(['ledger.get', { area: area }]);   // the table, if an area is picked
    loadScreen(el, 'pay', 'Payments', calls, (el, r) => {
      const all = r[0], shown = r[3] || all, doneOrders = r[1].orders, pays = r[2].payments;
      const inLedger = new Set(all.rows.map(x => Number(x.order_id)));
      const ready = doneOrders.filter(o => !inLedger.has(Number(o.order_id)) && o.kind !== 'survey');   // a survey is never billed
      const readyTotal = ready.reduce((a, o) => a + Number(o.balance != null ? o.balance : o.amount), 0);
      const owing = all.rows.filter(x => x.balance > 0), owingClients = new Set(owing.map(x => x.phone)).size;
      const todayTotal = all.today_payments.reduce((a, p) => a + p.amount, 0);
      const monthTotal = pays.reduce((a, p) => a + p.amount, 0);
      const dateOf = {};
      doneOrders.forEach(o => { dateOf[o.order_id] = o.sched_date; });
      const rows = shown.rows.slice().sort((a, b) => (dateOf[a.order_id] || a.week_start) < (dateOf[b.order_id] || b.week_start) ? -1 : 1);

      el.innerHTML = '<header><div><h2>Payments</h2><p class="sub">The ledger is created every ' + esc(dayName(settings().ledger_day)) + '. The collector sees only name, phone, address and amount.</p></div>' +
        '<button class="btn pri" data-act="ins-ledger-build"' + (ready.length ? '' : ' disabled') + '>Add ' + ready.length + ' completed job' + (ready.length === 1 ? '' : 's') + ' to ledger (' + inr(readyTotal) + ')</button></header>' +

        '<div class="tiles">' +
        tile('In ledger, to collect', inr(all.total), owingClients + ' client' + (owingClients === 1 ? '' : 's')) +
        tile('Completed, not in ledger yet', inr(readyTotal), ready.length + ' job' + (ready.length === 1 ? '' : 's')) +
        tile('Collected today', inr(todayTotal), all.today_payments.length + ' payment' + (all.today_payments.length === 1 ? '' : 's')) +
        tile('Collected, last 30 days', inr(monthTotal), pays.length + ' payment' + (pays.length === 1 ? '' : 's')) +
        '</div>' +

        '<div class="ins-h3 ins-bar"><h3>Ledger</h3>' +
        '<select class="fsel" style="width:auto" data-chg="ins-pay-area" aria-label="Filter by area"><option value="">All areas</option>' +
        (setup().areas || []).map(a => '<option value="' + esc(a.key) + '"' + (area === a.key ? ' selected' : '') + '>' + esc(a.name_en) + '</option>').join('') +
        '<option value="other"' + (area === 'other' ? ' selected' : '') + '>Other</option></select></div>' +
        '<div class="tw"><table class="tbl"><thead><tr><th>Client</th><th>Phone</th><th>Area</th><th>Invoice</th><th>Collected</th><th>Balance</th><th>Status</th></tr></thead><tbody>' +
        (rows.length ? rows.map(x => '<tr><td>' + nameCell(x.client_name, '<button class="lnk ins-cl" data-act="open-client" data-phone="' + esc(x.phone) + '">' + esc(x.client_name) + '</button>' +
          '<div class="sub">' + esc(dateOf[x.order_id] ? dateLab(dateOf[x.order_id]) : 'Week of ' + dateLab(x.week_start)) + ' · #' + esc(x.order_id) + '</div>') + '</td>' +
          '<td class="num">' + esc(phoneText(x.phone)) + '</td><td>' + esc(areaName(x.area)) + '</td>' +
          '<td class="num">' + inr(x.billed) + '</td><td class="num">' + inr(x.paid) + '</td><td class="num"><b>' + inr(x.balance) + '</b></td>' +
          '<td><span class="pill ' + (x.balance <= 0 ? 'ok' : x.paid > 0 ? 'warn' : '') + '">' + (x.balance <= 0 ? 'Paid' : x.paid > 0 ? 'Partly paid' : 'Pending') + '</span></td></tr>').join('')
          : '<tr><td colspan="7"><div class="empty">' + (area ? 'Nothing in the ledger for this area.' : 'Nothing in the ledger yet.') + '</div></td></tr>') +
        '</tbody></table></div>' +

        // Recent collections as a chat list: client initials, amount and mode, date on the right
        '<div class="card ins-flush ins-sec"><div class="ins-h3"><h3>Recent collections <span class="sub">(last 30 days)</span></h3></div>' +
        (pays.length ? '<div class="wa-list">' + pays.map(p => WA.row({
          name: p.client_name, time: shortDay(String(p.date).slice(0, 10)) + ', ' + fm(mins(p.date)),
          act: 'ins-pay-client', data: { order: p.order_id },
          preview: '<b class="ins-paid">' + inr(p.amount) + '</b> · ' + esc((MODE[p.mode] || { en: p.mode }).en) + ' · order #' + esc(p.order_id) +
            (p.collector ? ' · by ' + esc(p.collector) : '') + (p.note ? ' · ' + esc(p.note) : '')
        })).join('') + '</div>'
          : '<div class="empty ins-m">No collections in the last 30 days.</div>') + '</div>';

      // Remember phones by order id so a click on a collection can open the client
      payPhones = {};
      all.rows.forEach(x => { payPhones[x.order_id] = x.phone; });
      doneOrders.forEach(o => { payPhones[o.order_id] = o.phone; });
    });
  }
  let payPhones = {};
  const dayName = d => ({ Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' }[d] || 'Friday');

  onChg('ins-pay-area', el => { S.pay.area = el.value; refresh(); });

  onAct('ins-pay-client', el => {
    const phone = payPhones[el.dataset.order];
    if (phone) openClient(phone);
  });

  onAct('ins-ledger-build', async el => {
    el.disabled = true;
    try {
      const r = await api('ledger.build', {});
      cacheDrop(['ledger.get', 'screen.pay', 'screen.dash']);
      toast(r.added + ' job' + (r.added === 1 ? '' : 's') + ' added. The collector can see them now.');
      refresh();
    } catch (e) { el.disabled = false; if (e.message !== 'AUTH') toast(errText(e)); }
  });

  registerScreen('admin', 'pay', renderPay);

  /* ======================================================================
     4. OVERTIME
     ====================================================================== */

  // 'today' | 'week' (Mon-Sun) | 'month' -> [from, to]. Same rule as the server.
  function rangeDates(range) {
    const t = todayIso();
    if (range === 'week') { const m = addD(t, -((pd(t).getDay() + 6) % 7)); return [m, addD(m, 6)]; }
    if (range === 'month') { const f = t.slice(0, 8) + '01', n = pd(f); n.setMonth(n.getMonth() + 1); return [f, addD(isoOf(n), -1)]; }
    return [t, t];
  }

  function renderOT(el) {
    const range = S.ot.range, rd = rangeDates(range);
    loadScreen(el, 'ot', 'Overtime', [
      ['report.overtime', { range: range }],
      ['order.list', { from: rd[0], to: rd[1] }]
    ], (el, r) => {
      const rep = r[0], orders = r[1].orders;
      const doneJobs = rep.by_team.reduce((a, x) => a + x.jobs, 0);
      const otJobs = rep.orders;
      const list = otJobs.filter(o => !S.ot.team || o.team === S.ot.team);
      // Jobs booked outside office hours that are not done yet (and not moved away)
      const later = orders.filter(o => o.status !== 'done' && o.status !== 'moved' && o.kind !== 'survey' && outsideHours(o.sched_time));
      const chip = (k, txt) => '<button class="chip" aria-pressed="' + (range === k) + '" data-act="ins-otr" data-r="' + k + '">' + txt + '</button>';
      const rangeText = rd[0] === rd[1] ? lab(rd[0]) : lab(rd[0]) + ' to ' + lab(rd[1]);

      el.innerHTML = '<header><div><h2>Overtime</h2><p class="sub">Office hours are ' + fm(officeStart()) + ' to ' + fm(officeEnd()) +
        ' (change in the Settings tab of the Google Sheet). Time worked outside them counts as overtime.</p></div>' +
        '<div class="chips">' + chip('today', 'Today') + chip('week', 'This week') + chip('month', 'This month') + '</div></header>' +

        '<div class="tiles">' +
        tile('Overtime worked', dur(rep.total_min || 0), otJobs.length + ' job' + (otJobs.length === 1 ? '' : 's') + ' · ' + esc(rangeText)) +
        tile('Jobs done', doneJobs, 'in this range') +
        tile('Booked outside hours', later.length, 'not done yet') +
        '</div>' +

        '<div class="ins-h3 ins-bar"><h3>By team</h3></div><div class="tw"><table class="tbl"><thead><tr><th>Team</th><th>Jobs done</th><th>Jobs with overtime</th><th>Overtime</th></tr></thead><tbody>' +
        rep.by_team.map(x => '<tr><td>' + tchip(x.team, true) + '</td><td class="num">' + x.jobs + '</td><td class="num">' + x.ot_jobs + '</td>' +
          '<td class="num"><b>' + (x.minutes ? dur(x.minutes) : 'none') + '</b></td></tr>').join('') + '</tbody></table></div>' +

        '<div class="ins-h3 ins-bar ins-sec"><h3>Overtime jobs</h3>' +
        '<select class="fsel" style="width:auto" data-chg="ins-ot-team" aria-label="Filter by team"><option value="">All teams</option>' +
        teamKeys().map(k => '<option value="' + esc(k) + '"' + (S.ot.team === k ? ' selected' : '') + '>Team ' + esc(k) + '</option>').join('') + '</select></div>' +
        '<div class="tw"><table class="tbl"><thead><tr><th>Date</th><th>Client</th><th>Team</th><th>Worked</th><th>Overtime</th></tr></thead><tbody>' +
        (list.length ? list.map(o => {
          const end = mins(o.done_at), start = o.reached_at ? mins(o.reached_at) : end - 60;
          return '<tr><td class="num">' + esc(lab(o.sched_date)) + '</td><td>' + nameCell(o.client_name, '<b>' + esc(o.client_name) + '</b><div class="sub">' + esc(areaName(o.area)) + ' · #' + esc(o.order_id) + '</div>') + '</td>' +
            '<td>' + tchip(o.team) + '</td><td class="num">' + fm(start) + ' to ' + fm(end) + '</td>' +
            '<td class="num"><span class="pill warn">' + esc(dur(o.overtime_min)) + '</span></td></tr>';
        }).join('') : '<tr><td colspan="5"><div class="empty">No overtime in this range.</div></td></tr>') + '</tbody></table></div>' +

        '<div class="ins-h3 ins-bar ins-sec"><h3>Booked outside office hours</h3></div>' +
        (later.length ? '<div class="daylist">' + later.map(o => '<div class="dl"><b class="tm">' + fm(mins(o.sched_time)) + '</b>' +
          nameCell(o.client_name, '<b>' + esc(o.client_name) + '</b><div class="sub">' + esc(lab(o.sched_date)) + ' · ' + esc(areaName(o.area)) + '</div>') +
          tchip(o.team) + '</div>').join('') + '</div>'
          : '<div class="empty">No open jobs booked outside office hours in this range.</div>');
    });
  }

  onAct('ins-otr', el => { S.ot.range = el.dataset.r; refresh(); });
  onChg('ins-ot-team', el => { S.ot.team = el.value; refresh(); });

  registerScreen('admin', 'ot', renderOT);

  /* ---------- shared with admin-reports.js (Reports screen) ----------
     The same helpers, so the Reports screen looks and loads like these screens. */
  App.ins = {
    loadScreen: loadScreen, tile: tile, tchip: tchip, nameCell: nameCell, errText: errText,
    svcName: svcName, areaName: areaName, typeName: typeName, icon: ICON
  };
})();
