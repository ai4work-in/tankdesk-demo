/* ==========================================================================
   admin-orders.js: the admin screens for booking and planning work (English).
     B4  New order          (#ad-new)
     B5  Orders and assign  (#ad-orders)
     B6a Calendar           (#ad-cal)
     B6b Team routes        (#ad-teams)

   How it works, in plain words:
   - Every screen asks the server for data with api('order.list', ...) and
     then draws itself. While it waits it shows "Loading…".
   - After every save (new order, assign team, smart assign) the list is
     loaded again from the server, so the screen always shows the truth.
   - Lists of services, areas, teams and client types come from the Sheet
     setup tabs (App.setup, loaded once at login).
   - Buttons use data-act="ao-..." and are handled by onAct() (see app.js).
     "ao" = admin orders, so the names never clash with other screens.
   - Other screens can open New order with a phone filled in:
       App.openNewOrder({ phone: '919825041031' })
     or a survey visit:  App.openNewOrder({ phone: '...', kind: 'survey' })
     or an AMC visit:    App.openNewOrder({ phone: '...', amc: {amc_id, visit_no, visits, visit_amount, tanks, due_date} })
   Added 2026-10-08: price by tank size (tank editor + live price breakdown from
   price.quote), survey visits and the quotation panel (Send / Approve & schedule /
   Declined), jobs over several days ("Day 2 of 3"), AMC visits.
   Everything sits inside one function so its helper names stay private.
   ========================================================================== */
(function () {
  'use strict';

  /* Switchable add-ons (added 2026-10-08): hasMod('orders') etc. come from common.js.
     Since the three packs (2026-10-08) orders and multiday are always on (core); the
     "off" paths below are kept for other industries. clients/amc follow the "repeat" pack.
     - orders off: the screens say "Task" instead of "Order" (word() in common.js),
       no prices, no client type, no "came from"; the amount is typed; services are
       an optional checklist.
     - quotation off: no "Type: Survey visit"; clients off: no returning-client card,
       no next visit; multiday off: no "How many days"; amc off: no AMC box.
     Every toast and dialog title of these screens goes through word(). */
  const toast = msg => window.toast(word(msg));

  /* ======================================================================
     SCREEN MEMORY (kept while the app is open; reloading the page resets it)
     ====================================================================== */
  const AO = {
    // Orders and assign: filters (same as the mockup)
    ord: { when: 'today', un: false, type: '', area: '', svc: '', team: '', group: '' },
    orders: null,        // last list from the server (null = not loaded yet)
    ordLoading: false, ordErr: false,
    sugg: {},            // order_id -> {team, why} for unassigned orders
    hi: null,            // order to highlight (just saved)
    // Calendar
    cal: '', calDay: '', calTeam: '', calOrders: [], calLoading: false, calErr: false,
    // Team routes
    routes: null, routesLoading: false, routesErr: false,
    // New order
    form: null,          // form flags, see freshForm()
    saved: null,         // the order just saved, shown above the form
    // Each load gets a number. If a newer load has started, the older answer is ignored.
    seq: { orders: 0, cal: 0, teams: 0, side: 0, lookup: 0, price: 0, eprice: 0 }
  };

  /* ======================================================================
     SMALL HELPERS (setup lookups, labels, formulas)
     ====================================================================== */
  const SET = () => App.setup || {};
  const settings = () => SET().settings || {};
  const areas = () => SET().areas || [];
  const services = () => (SET().services || []).filter(s => s.active !== false);
  const clientTypes = () => hasMod('orders') ? SET().client_types || [] : [];   // client types belong to the orders add-on
  const allTeams = () => SET().teams || [];
  const activeTeams = () => allTeams().filter(t => t.active !== false);
  const teamKeys = () => allTeams().map(t => t.team);
  const tc = k => teamColor(k, teamKeys());                       // team colour
  const teamRow = k => allTeams().find(t => t.team === k);
  const teamLabel = k => { const t = teamRow(k); return 'Team ' + k + (t && t.driver_name ? ' · ' + t.driver_name : ''); };

  const areaOf = k => areas().find(a => a.key === k);
  const areaName = k => (areaOf(k) || { name_en: 'Other' }).name_en;
  const svcOf = k => (SET().services || []).find(s => s.key === k);
  const svcName = k => (svcOf(k) || { name_en: k }).name_en;
  const svcShort = k => svcName(k).split(' ')[0];                 // "Overhead tank cleaning" -> "Overhead"
  const ctName = k => (clientTypes().find(c => c.key === k) || { name_en: k || '-' }).name_en;
  // true when the client does NOT use WhatsApp (order field whatsapp 'no'; blank = yes)
  const noWa = o => !!o && String(o.whatsapp || '').toLowerCase() === 'no';
  const isSurvey = o => !!o && o.kind === 'survey';
  // A multi-day job whose work for today is done ("today's work done" tapped): nothing more today
  const doneToday = o => o.status === 'done' || (o.status === 'ongoing' && workDays(o).some(w => w.date === todayIso() && w.left));

  /* ---------- price breakdown (from the server's priceOrder / price.quote) ----------
     p = {tanks:[{...tank, unit_price, price}], tanks_total, addons:[{key, price}], addons_total, total, by}
     by 'tanks' = price from tanks (+ add-ons), 'services' = no tank sizes yet, 'locked' = the amount stays. */
  function priceHtml(p, opt) {
    opt = opt || {};
    if (!p) return '';
    const head = p.by === 'services' ? 'Price from services' : p.by === 'locked' ? 'Price locked' : 'Price from tanks';
    const row = (a, b, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + a + '</td><td class="num">' + b + '</td></tr>';
    const byT = p.by !== 'services';   // 'services': the tanks do not set the price (no cleaning service chosen)
    const rows = (byT ? p.tanks || [] : []).map(t => row(esc(tankText(t)), (t.count > 1 ? '<span class="sub">' + inr(t.unit_price) + ' × ' + t.count + ' =</span> ' : '') + inr(t.price))).join('') +
      (p.addons || []).map(a => row(esc(svcName(a.key)) + (byT && (p.tanks || []).length ? ' <span class="sub">add-on</span>' : ''), inr(a.price))).join('');
    const calc = p.by === 'locked' ? round0((p.tanks_total || 0) + (p.addons_total || 0)) : p.total;
    return '<div class="ao-pb"><div class="ao-pbh"><b>' + head + '</b>' +
      (p.by === 'services' ? '<span class="sub">' + ((p.tanks || []).length ? 'no cleaning service chosen' : 'no tank sizes yet') + '</span>' : p.by === 'locked' && opt.why ? '<span class="sub">' + esc(opt.why) + '</span>' : '') + '</div>' +
      '<table class="ao-pbt">' + (rows || row('<span class="sub">Nothing priced yet</span>', '')) +
      (p.by === 'locked' && (p.tanks || []).length ? row('Rate card would give', inr(calc), 'ao-pbc') : '') +
      row('<b>' + (p.by === 'locked' ? 'Locked amount' : opt.totalLabel || 'Total') + '</b>', '<b>' + inr(p.total) + '</b>', 'ao-pbtot') + '</table>' +
      (opt.typed ? '<p class="sub ao-pbn">You typed ' + inr(opt.typed) + ': that amount is used and the price is locked.</p>' : '') + '</div>';
  }
  const round0 = n => Math.round(Number(n) || 0);
  App.priceHtml = priceHtml;   // also used on the client page (admin-insights.js)

  // Why an order's price is locked, in words
  const lockWhy = o => o.from_quote ? 'from the approved quotation (survey #' + o.from_quote + ')' : o.amc_id ? 'AMC ' + o.amc_id + ' visit ' + o.amc_visit : 'amount typed by the office';
  // "Day 2 of 3" for date d; "3 days" before the job starts
  function dayText(o, d) {
    const n = jobDays(o), k = jobDayNo(o, d || todayIso());
    return k < 1 ? n + ' days' : k > n ? 'Day ' + k + ' (planned ' + n + ')' : 'Day ' + k + ' of ' + n;
  }

  /* ---------- small pills for the new kinds of orders ----------
     Survey + quotation status, "Day 2 of 3", "Price locked (quote)", "AMC visit 2" */
  const QUOTE = { draft: ['Quote draft', 'warn'], sent: ['Quote sent', 'info'], approved: ['Approved', 'ok'], declined: ['Declined', 'bad'] };
  function quotePill(o) {
    if (!isSurvey(o)) return '';
    if (o.status !== 'done' && !o.quote_status) return '<span class="pill">Not measured yet</span>';
    const q = QUOTE[o.quote_status] || ['Measured', ''];
    return '<span class="pill ' + q[1] + '">' + q[0] + (o.quote_status === 'approved' && o.quote_order_id ? ' → #' + esc(o.quote_order_id) : '') + '</span>';
  }
  function kindPills(o, d) {
    let h = '';
    if (isSurvey(o)) h += ' <span class="pill ao-sv">Survey</span> ' + quotePill(o);
    if (jobDays(o) > 1) h += ' <span class="pill ao-days">' + esc(dayText(o, d)) + '</span>';
    if (o.amc_id) h += ' <span class="pill ao-amcp" title="' + esc(o.amc_id) + '">AMC visit ' + esc(o.amc_visit) + '</span>';
    if (o.price_locked && o.from_quote) h += ' <span class="pill ok" title="' + esc(lockWhy(o)) + '">Price locked (quote)</span>';
    else if (o.price_locked && !o.amc_id) h += ' <span class="pill" title="' + esc(lockWhy(o)) + '">Price locked</span>';
    return h;
  }
  App.kindPills = kindPills;
  App.quotePill = quotePill;

  // Office hours in minutes since midnight (from the Settings tab)
  const officeStart = () => mins(settings().office_start || '10:00');
  const officeEnd = () => mins(settings().office_end || '17:00');
  const outside = t => { const m = mins(t); return m != null && (m < officeStart() || m >= officeEnd()); };

  // Sort by date, then time
  const byDateTime = (a, b) => a.sched_date === b.sched_date
    ? (mins(a.sched_time) || 0) - (mins(b.sched_time) || 0)
    : (a.sched_date < b.sched_date ? -1 : 1);

  // Straight-line distance in km between two areas (x, y in the Areas tab are km)
  function dist(a, b) { const A = areaOf(a), B = areaOf(b); return Math.hypot(A.x - B.x, A.y - B.y); }
  // Rough travel minutes between two areas (same formula as the mockup and the server):
  // unknown area 20 min, same area 10 min, otherwise km x min_per_km + buffer.
  function travelMin(a, b) {
    const st = settings();
    if (!a || !b || !areaOf(a) || !areaOf(b)) return Number(st.unknown_area_min) || 20;
    if (a === b) return Number(st.same_area_min) || 10;
    return Math.round(dist(a, b) * (Number(st.min_per_km) || 3)) + (Number(st.buffer_min) || 5);
  }

  /* Team suggestion worked out in the browser from the orders already loaded,
     with the SAME rule as the server (order.suggest), so no extra trip is needed:
       1. a team already in the same area that day
       2. else the team at the nearest area that day, if within max_suggest_km (default 6)
       3. else the team with the fewest jobs that day
     "orders" must hold every order of that date (the Orders list always does). */
  function suggestLocal(o, orders) {
    const teams = activeTeams().map(t => t.team);
    if (!teams.length) return null;
    const same = orders.filter(x => x.sched_date === o.sched_date && x.team && teams.includes(x.team) && String(x.order_id) !== String(o.order_id) &&
      x.status !== 'cancelled');   // a cancelled job does not keep a team busy
    if (o.area && areaOf(o.area)) {
      const m = same.find(x => x.area === o.area);
      if (m) return { team: m.team, why: 'Already in ' + areaName(o.area) + ' that day' };
      let best = null, bd = 1e9;
      same.forEach(x => { if (areaOf(x.area)) { const k = dist(o.area, x.area); if (k < bd) { bd = k; best = x; } } });
      if (best && bd <= (Number(settings().max_suggest_km) || 6)) return { team: best.team, why: 'Nearby: ' + areaName(best.area) + ', ' + bd.toFixed(1) + ' km' };
    }
    const ld = teams.map(t => ({ t: t, n: same.filter(x => x.team === t).length })).sort((a, b) => a.n - b.n)[0];
    return { team: ld.t, why: 'Lightest day, ' + ld.n + ' job' + (ld.n === 1 ? '' : 's') };
  }

  // Guess the area from the address text: the first area whose name appears in it
  function guessArea(text) {
    const t = String(text || '').toLowerCase();
    if (!t) return '';
    const hit = areas().find(a => [a.key, a.name_en, a.name_gu].some(n => n && t.includes(String(n).toLowerCase())));
    return hit ? hit.key : '';
  }

  // "2026-10-06" -> "6 Oct" (adds the year when it is not this year)
  const shortDate = s => { const d = pd(s); return d.getDate() + ' ' + MON[d.getMonth()] + (s.slice(0, 4) !== todayIso().slice(0, 4) ? ' ' + s.slice(0, 4) : ''); };

  // Turn a server error into a sentence for the owner
  function errText(e) {
    const m = (e && e.message) || '';
    // Server errors read "CODE: message". Only the code before the colon decides the wording.
    const code = (e && e.code) || m.split(':')[0].trim();
    if (code === 'BAD_INPUT') return m.slice(m.indexOf(':') + 1).trim() || 'Please check the details.';
    if (code === 'NETWORK' || code === 'TIMEOUT') return 'No network. Please try again.';
    if (code === 'FORBIDDEN') return /not switched on/.test(m) ? 'This feature is not switched on.' : 'You are not allowed to do that.';
    if (code === 'NOT_FOUND') return word('That order was not found. The list has been refreshed.');
    // e.g. "This job is done; it cannot be cancelled." (the server's own words, when it gives them)
    if (code === 'BAD_STATUS') return m.slice(m.indexOf(':') + 1).trim() || word('This order can no longer be changed.');
    return 'Something went wrong (' + m + '). Please try again.';
  }
  // Show an error as a toast. Login problems are already handled by api.js.
  function fail(e) { if (e && e.message !== 'AUTH') toast(errText(e)); }

  /* ---------- speed helpers (each trip to Apps Script takes 1-2 seconds) ----------
     batchCalls: several requests in ONE trip (apiBatch in api.js). If the server does not
     know "batch" yet, it falls back to separate calls. An item that failed comes back as an Error.
     dropSaved: after a save, forget the saved copies that are now out of date. */
  async function batchCalls(calls) {
    try { return await apiBatch(calls); }
    catch (e) {
      if (e.code !== 'UNKNOWN_ACTION') throw e;
      return Promise.all(calls.map(c => api(c[0], c[1]).catch(err => { if (err.message === 'AUTH') throw err; return err; })));
    }
  }
  // Everything an order save or a team change can affect (lists, dashboard, client pages)
  const ORDER_CACHES = ['order.list', 'client.list', 'client.history', 'reminders.list', 'screen.dash', 'screen.pay', 'screen.ot'];
  const dropSaved = () => cacheDrop(ORDER_CACHES);

  /* The small "updating…" note shown while fresh data loads (the saved copy is already
     on screen). ONE helper for every admin screen, so they all look the same:
     muted text with a tiny spinning dot (styles: .upd in admin.css).
     admin-insights.js uses it too, through App.updNote(). */
  const updNote = () => '<span class="upd" role="status">updating…</span>';
  App.updNote = updNote;

  // Is this screen still the open one? (the owner may have clicked away while we waited)
  const isOpen = tab => App.session && App.session.role === 'admin' && App.adminTab === tab;

  // Status pill (same words and colours as the mockup)
  function stPill(o) {
    if (isSurvey(o)) return o.status === 'done' ? '<span class="pill ok">Measured</span>' : '<span class="pill">Survey visit</span>';
    const m = { new: ['Unassigned', ''], assigned: ['Assigned', 'info'], delayed: ['Running late', 'warn'],
      reached: ['At site', 'ok'], done: ['Done', 'ok'], moved: ['Moved', 'warn'], ongoing: ['In progress', 'info'] }[o.status] || [o.status, ''];
    return '<span class="pill ' + m[1] + '">' + esc(m[0]) + '</span>' +
      (o.moved_from && o.status !== 'moved' ? ' <span class="pill warn" title="Moved from ' + esc(lab(o.moved_from)) + '">Moved</span>' : '');
  }
  // "10:00 AM" -> "10 AM" (shorter, for pills)
  const fmShort = m => fm(m).replace(':00 ', ' ');
  // Overtime and "outside office hours" pills.
  // A job booked before office start says "Before 10 AM", after office end "After 5 PM".
  function hourPills(o) {
    const ot = Number(o.overtime_min) || 0, m = mins(o.sched_time);
    let hrs = '';
    if (o.status !== 'done' && outside(o.sched_time)) {
      hrs = m < officeStart() ? 'Before ' + fmShort(officeStart()) : 'After ' + fmShort(officeEnd());
    }
    return (ot > 0 ? ' <span class="pill warn">OT ' + dur(ot) + '</span>' : '') +
      (hrs ? ' <span class="pill hrs">' + hrs + '</span>' : '');
  }
  const teamChip = k => '<span class="tchip" style="--tc:' + tc(k) + '"><i class="tdot"></i>' + (k ? 'Team ' + esc(k) : 'Unassigned') + '</span>';
  // Client name as a link that opens the client page (the Clients screen handles "open-client")
  // (without the Clients add-on there are no client pages: just the name)
  const clientLink = o => hasMod('clients') ? '<button class="lnk ao-cl" data-act="open-client" data-phone="' + esc(o.phone) + '">' + esc(o.client_name) + '</button>'
    : '<b class="ao-cl">' + esc(o.client_name) + '</b>';
  // Round initials (like a chat photo) next to the client name; "inner" is the name and any lines under it
  const withAvatar = (o, inner) => '<span class="ao-who">' + WA.avatar(o.client_name, { small: true }) + '<span class="ao-who-t">' + inner + '</span></span>';

  /* ---------- schematic map of the areas, for New order (no live tracking) ----------
     Area x, y are in km. 25 screen units per km (the mockup's scale).
     focus = one area to pin. (Team routes draws its own map: routeStrip.) */
  function areaMap(opt) {
    opt = opt || {};
    const L = areas().filter(a => isFinite(a.x) && isFinite(a.y));
    if (!L.length) return '';
    const K = 25, xs = L.map(a => a.x * K), ys = L.map(a => a.y * K);
    const x0 = Math.min.apply(null, xs) - 50, x1 = Math.max.apply(null, xs) + 120;
    const y0 = Math.min.apply(null, ys) - 55, y1 = Math.max.apply(null, ys) + 35;
    const W = x1 - x0, H = y1 - y0;
    let s = '<svg viewBox="' + x0 + ' ' + y0 + ' ' + W + ' ' + H + '" role="img" aria-label="Schematic map of the service areas">' +
      '<rect x="' + x0 + '" y="' + y0 + '" width="' + W + '" height="' + H + '" fill="var(--map-bg)"/>';
    // faint grid every 2 km, just to give a sense of distance
    s += '<g stroke="var(--map-road)" stroke-width="1.5">';
    for (let gx = Math.ceil(x0 / 50) * 50; gx < x1; gx += 50) s += '<path d="M' + gx + ' ' + y0 + 'V' + y1 + '"/>';
    for (let gy = Math.ceil(y0 / 50) * 50; gy < y1; gy += 50) s += '<path d="M' + x0 + ' ' + gy + 'H' + x1 + '"/>';
    s += '</g>';
    L.forEach(a => {
      const x = a.x * K, y = a.y * K, on = a.key === opt.focus;
      s += '<circle cx="' + x + '" cy="' + y + '" r="' + (on ? 7 : 4) + '" fill="' + (on ? 'var(--bad)' : 'var(--muted)') + '"/>' +
        '<text class="svgt ao-mt" x="' + (x + 10) + '" y="' + (y + 4) + '" style="font-weight:' + (on ? 700 : 400) + '">' + esc(a.name_en) + '</text>';
    });
    const f = areaOf(opt.focus);
    if (f) {
      const x = f.x * K, y = f.y * K;
      s += '<path d="M' + x + ' ' + (y - 8) + 'c-14-20-14-34 0-34s14 14 0 34z" transform="translate(0,-2)" fill="var(--bad)" stroke="var(--surface)" stroke-width="2"/>' +
        '<circle cx="' + x + '" cy="' + (y - 32) + '" r="5" fill="var(--surface)"/>';
    }
    return s + '</svg>';
  }

  /* ======================================================================
     B4  NEW ORDER
     ====================================================================== */

  // Fresh form flags. prefill = {phone, client_name, address, area, client_type, services,
  //   kind: 'survey' (a survey visit), amc: {amc_id, visit_no, visits, visit_amount, tanks, due_date}}
  function freshForm(prefill) {
    prefill = prefill || {};
    const first = services()[0];
    const amc = hasMod('amc') ? prefill.amc || null : null;   // AMC visits only with the AMC add-on
    TankEd.reset(NEW_TK);   // a new form starts with fresh tanks
    // An AMC visit: the cleaning services that match the contract's tanks
    const amcSvcs = amc ? Array.from(new Set((amc.tanks || []).map(t => t.type === 'UG' ? 'ug' : 'ot'))).filter(k => svcOf(k)) : null;
    return {
      prefill: prefill,
      kind: prefill.kind === 'survey' && hasMod('quotation') ? 'survey' : 'cleaning',   // cleaning job or survey visit
      amc: amc,                      // booking an AMC visit (price and tanks from the contract)
      // (without "orders" the services are an optional checklist: nothing ticked to start with)
      svcs: amcSvcs && amcSvcs.length ? amcSvcs : Array.isArray(prefill.services) ? prefill.services.slice() : (first && hasMod('orders') ? [first.key] : []),
      manualAmt: false,              // true once the owner types the charge herself (then the price is locked)
      manualArea: !!prefill.area,    // true once the area is picked by hand (stop guessing)
      typeTouched: !!prefill.client_type,
      tkTouched: false,              // true once the tanks are changed by hand (then the client's saved tanks are not loaded over them)
      quote: null,                   // the last price breakdown from price.quote
      looked: '',                    // the phone number last looked up
      // Uses WhatsApp? 'yes' (default) or 'no' (nothing is sent; staff call instead).
      // Filled in from the client's past orders until the owner taps it herself.
      wa: prefill.whatsapp === 'no' ? 'no' : 'yes',
      waTouched: prefill.whatsapp === 'yes' || prefill.whatsapp === 'no',
      // Usability round (2026-10-08):
      svcTouched: Array.isArray(prefill.services),   // true once services are picked by hand (the last job's services are then not copied over them)
      pastOk: '',                    // "date|time" the owner confirmed although that time has passed today (second click on Save)
      amcNext: null,                 // the looked-up client's next AMC visit not booked yet ("Book as AMC visit 2/4")
      saving: false,
      rebuild: true
    };
  }

  /* ---------- services follow the tanks (usability round, 2026-10-08) ----------
     The cleaning services priced by tank size go on and off with the tank positions:
     an overhead tank (OH) -> 'ot', an underground tank (UG) -> 'ug'. Only tanks that have
     a size typed count; with no sizes at all the services are left as they are.
     svcs = the list of service keys to change (in place). Returns true if it changed. */
  const POS_SVC = { OH: 'ot', UG: 'ug' };
  function syncTankServices(svcs, key) {
    if (!hasMod('orders') || !TankEd.has(key)) return false;
    const filled = TankEd.list(key).filter(t => ['litres', 'l', 'w', 'h'].some(f => String(t[f] == null ? '' : t[f]).trim() !== ''));
    if (!filled.length) return false;
    // Only extras picked (e.g. leakage repair only): the tanks are just for the log book, leave it (same rule as the server)
    if (svcs.length && !svcs.some(k => (svcOf(k) || {}).priced_by === 'tanks')) return false;
    const pos = new Set(filled.map(t => t.type === 'UG' ? 'UG' : 'OH'));
    let changed = false;
    Object.keys(POS_SVC).forEach(p => {
      const k = POS_SVC[p], s = svcOf(k);
      if (!s || s.active === false || s.priced_by !== 'tanks') return;   // only cleaning services priced by tanks
      const i = svcs.indexOf(k);
      if (pos.has(p) && i < 0) { svcs.push(k); changed = true; }
      if (!pos.has(p) && i >= 0) { svcs.splice(i, 1); changed = true; }
    });
    return changed;
  }
  const NEW_TK = 'ao:new';   // the tank editor on New order

  // 30-minute time slots from 8:00 AM to 6:00 PM (as in the mockup)
  function slotOptions(cur) {
    let h = '';
    for (let m = 8 * 60; m <= 18 * 60; m += 30) h += '<option value="' + hhmm(m) + '"' + (hhmm(m) === cur ? ' selected' : '') + '>' + fm(m) + '</option>';
    return h;
  }
  // Days 1 to 10 for a job over several days
  const dayOptions = cur => Array.from({ length: 10 }, (x, i) => '<option value="' + (i + 1) + '"' + (Number(cur || 1) === i + 1 ? ' selected' : '') + '>' +
    (i + 1) + ' day' + (i ? 's' : '') + '</option>').join('');

  function buildForm(el) {
    const f = AO.form, p = f.prefill;
    f.rebuild = false;
    const days = Number(settings().reminder_days) || 20;
    const priced = hasMod('orders');   // prices, client types and "order came from"
    el.innerHTML =
      '<header><div><h2>' + word('New order') + '</h2><p class="sub">' + (priced
        ? 'Punch in a call or WhatsApp order. The map link, team suggestion and price fill in by themselves.'
        : 'Add a task. The map link and team suggestion fill in by themselves.') + '</p></div>' +
      // Clear form: start again with an empty form (usability round 2026-10-08)
      '<button type="button" class="btn sm" data-act="ao-clear">Clear form</button></header>' +
      '<div id="ao-saved"></div>' +
      '<div class="newgrid">' +
      '<form id="ao-f" autocomplete="off" novalidate>' +
      // Cleaning job or survey visit (the supervisor measures the tanks first, then a quotation is sent)
      '<div class="fld ao-kindf"' + (hasMod('quotation') ? '' : ' hidden') + '><span class="lbl" id="ao-kind-l">Type</span><div class="chips" role="group" aria-labelledby="ao-kind-l" id="ao-kind"></div>' +
      '<p class="sub" id="ao-kind-n"></p></div>' +
      '<div id="ao-amc" hidden></div>' +
      '<div class="form-grid">' +
      '<div class="fld"' + (priced ? '' : ' hidden') + '><label for="ao-src">Order came from</label><select id="ao-src" data-chg="ao-src"><option value="call">Phone call</option><option value="whatsapp">WhatsApp</option></select></div>' +
      '<div class="fld"' + (priced ? '' : ' hidden') + '><label for="ao-type">Client type</label><select id="ao-type" data-chg="ao-type">' +
      clientTypes().map(c => '<option value="' + esc(c.key) + '">' + esc(c.name_en) + '</option>').join('') + '</select></div>' +
      // Phone first: a returning client's details fill in from it (usability round 2026-10-08)
      '<div class="fld"><label for="ao-phone">Phone number</label><input id="ao-phone" inputmode="numeric" data-inp="ao-phone" placeholder="98250 12345"></div>' +
      '<div class="fld"><label for="ao-name">' + (priced ? 'Client name' : 'Client or task name') + '</label><input id="ao-name" placeholder="e.g. Hiren Patel"></div>' +
      '<div class="full" id="ao-ret" hidden></div>' +
      '<div class="fld full"><label for="ao-addr">Address</label><textarea id="ao-addr" rows="2" data-inp="ao-addr" placeholder="Flat or plot, society, landmark, area"></textarea></div>' +
      '<div class="fld"><label for="ao-area">Area (for team planning)</label><select id="ao-area" data-chg="ao-area"><option value="">Pick area</option>' +
      areas().map(a => '<option value="' + esc(a.key) + '">' + esc(a.name_en) + '</option>').join('') + '</select></div>' +
      '<div class="fld ao-wa"><span class="lbl" id="ao-wa-l">Uses WhatsApp</span><div id="ao-wa"></div></div>' +
      '</div>' +
      '<div class="fld" style="margin-bottom:12px"' + (services().length || priced ? '' : ' hidden') + '><span class="lbl" id="ao-svc-l">Service</span><div class="chips" id="ao-svcs"></div></div>' +
      // Tanks (cleaning job): pre-filled from the client's last visit; the price comes from them
      // (without "orders": optional, for the log book only)
      '<div class="fld ao-tkf" id="ao-tkf"><span class="lbl">Tanks <span class="sub">' + (priced ? '(the price comes from the tank sizes)' : '(optional, for the log book)') +
      '</span></span><div id="ao-tk"></div></div>' +
      '<div class="form-grid">' +
      // No date filled in by itself: Today / Tomorrow chips, or pick one (usability round 2026-10-08)
      '<div class="fld"><label for="ao-date">Service date</label><div class="chips ao-dq" role="group" aria-label="Quick date">' +
      '<button type="button" class="chip" data-act="ao-dq" data-n="0" aria-pressed="false">Today</button>' +
      '<button type="button" class="chip" data-act="ao-dq" data-n="1" aria-pressed="false">Tomorrow</button></div>' +
      '<input id="ao-date" type="date" data-inp="ao-date" aria-describedby="ao-date-n"><span class="sub" id="ao-date-n">or pick a date</span></div>' +
      '<div class="fld"><label for="ao-time">Time slot</label><select id="ao-time" data-chg="ao-time">' + slotOptions('11:00') + '</select></div>' +
      '<div class="fld" id="ao-days-f"' + (hasMod('multiday') ? '' : ' hidden') + '><label for="ao-days">How many days</label><select id="ao-days">' + dayOptions(1) + '</select></div>' +
      '<div class="fld" id="ao-amt-f"><label for="ao-amt">' + (priced ? 'Service charge (₹)' : 'Amount (₹, optional)') + '</label><input id="ao-amt" inputmode="numeric" data-inp="ao-amt" placeholder="0"></div>' +
      '<div class="full" id="ao-dup" aria-live="polite" hidden></div>' +   // "already booked that day" (added 2026-10-09)
      '<div class="full" id="ao-price" aria-live="polite"></div>' +
      // The hint sits right under Next visit (usability round 2026-10-08)
      (hasMod('clients') ? '<div class="fld"><label for="ao-nv">Next visit (optional)</label><input id="ao-nv" type="date" aria-describedby="ao-nv-n">' +
        '<span class="sub ao-nvn" id="ao-nv-n">The client shows in "Visits due" on the Dashboard ' + days + ' days before this date.</span></div>' : '') +
      '<div class="fld full"><label for="ao-notes">Note for the team</label><input id="ao-notes" placeholder="e.g. call before arriving"></div>' +
      '</div>' +
      // Phone only: the team suggestion right above Save (on a computer it is in the side panel)
      '<div class="ao-sgm" id="ao-sgm" aria-live="polite"></div>' +
      '<p class="err" id="ao-err" role="alert" hidden></p>' +
      '<button type="submit" class="btn pri" id="ao-submit">' + word('Save order') + '</button>' +
      '</form>' +
      '<aside class="card" id="ao-side"></aside>' +
      '</div>';

    // Pre-filled values (from "Book order" on a reminder, or a client page)
    // No silent default date: only a date that came with the prefill (or the AMC visit's due date)
    $('#ao-date').value = p.sched_date || (f.amc && f.amc.due_date >= todayIso() ? f.amc.due_date : '');
    paintDateChips();
    if (p.phone) $('#ao-phone').value = phoneText(p.phone);
    if (p.client_name) $('#ao-name').value = p.client_name;
    if (p.address) $('#ao-addr').value = p.address;
    if (p.area && areaOf(p.area)) $('#ao-area').value = p.area;
    if (p.client_type && hasMod('orders')) $('#ao-type').value = p.client_type;
    if (p.address && !f.manualArea) $('#ao-area').value = guessArea(p.address);

    // Pressing Enter or the Save button sends the form to saveOrder (not a page reload)
    $('#ao-f').addEventListener('submit', saveOrder);

    paintKind();
    paintChips();
    paintWa();
    paintSide(true);
    if (p.phone) lookup($('#ao-phone').value);   // (does nothing without the Clients add-on)
    if (p.phone) dupSoon();                        // already booked that day? (added 2026-10-09)
  }

  /* ---------- Type: cleaning job or survey visit; the AMC box ---------- */
  function paintKind() {
    const f = AO.form, sv = f.kind === 'survey', amc = !!f.amc;
    const box = $('#ao-kind');
    if (!box) return;
    box.innerHTML = [['cleaning', 'Cleaning job'], ['survey', 'Survey visit']].map(k => '<button type="button" class="chip" data-act="ao-kind" data-k="' + k[0] + '" aria-pressed="' +
      (f.kind === k[0]) + '"' + (amc && k[0] === 'survey' ? ' disabled' : '') + '>' + k[1] + '</button>').join('');
    $('#ao-kind-n').textContent = sv ? 'The surveyor visits and measures the tanks (no team, no charge). Then you send the quotation from Orders.'
      : amc ? 'An AMC visit: tanks and price come from the contract.' : 'Tanks and price fill in from the client\'s last visit. Type a charge only to change it (it is then locked).';
    $('#ao-svc-l').textContent = sv ? 'Services the client wants (optional)' : hasMod('orders') ? 'Service' : 'Checklist (optional)';
    $('#ao-tkf').hidden = sv || amc;
    $('#ao-days-f').hidden = sv || !hasMod('multiday');
    $('#ao-amt-f').hidden = sv || amc;
    $('#ao-price').hidden = sv || amc || !hasMod('orders');   // no price breakdown without "orders"
    $('#ao-submit').textContent = sv ? 'Save survey visit' : word('Save order');
    // AMC visit: read-only box with the contract's visit, price and tanks
    const ab = $('#ao-amc');
    ab.hidden = !amc;
    ab.innerHTML = amc ? '<div class="box ok ao-amcbox"><b>AMC ' + esc(f.amc.amc_id) + ' · visit ' + esc(f.amc.visit_no) + ' of ' + esc(f.amc.visits) + ' · ' +
      inr(f.amc.visit_amount) + ' (per visit)</b>' +
      '<div class="sub">Due ' + esc(lab(f.amc.due_date)) + '. Price fixed by the contract (price locked).</div>' +
      ((f.amc.tanks || []).length ? '<div class="ao-tanks">Tanks from the contract: ' + f.amc.tanks.map(t => '<span class="num">' + esc(tankText(t)) + '</span>').join('; ') + '</div>' : '') +
      '<button type="button" class="lnk" data-act="ao-amc-off">Book as a normal order instead</button></div>' : '';
    // Tank editor (cleaning only)
    if (!sv && !amc && !$('#ao-tk').innerHTML) $('#ao-tk').innerHTML = TankEd.html(NEW_TK, f.prefill.tanks || [], { lang: 'en', onChange: tanksChanged });
    if (!sv && !amc && hasMod('orders')) priceSoon();
  }
  onAct('ao-kind', el => { AO.form.kind = el.dataset.k === 'survey' ? 'survey' : 'cleaning'; paintKind(); paintChips(); paintSide(); });
  onAct('ao-amc-off', () => { AO.form.amc = null; paintKind(); paintChips(); });

  // Service chips: cleaning services are priced by tank size, add-ons have their own price
  function paintChips() {
    const box = $('#ao-svcs');
    if (!box) return;
    const sv = AO.form.kind === 'survey';
    box.innerHTML = services().map(s => '<button type="button" class="chip" data-act="ao-svc" data-k="' + esc(s.key) + '" aria-pressed="' +
      AO.form.svcs.includes(s.key) + '">' + esc(s.name_en) + (sv || !hasMod('orders') ? '' : s.priced_by === 'tanks' ? ' · by tank size' : ' · ' + inr(s.default_price)) + '</button>').join('') ||
      '<span class="sub">No services in the Services tab yet.</span>';
  }
  // "Uses WhatsApp" Yes / No. An order that came in on WhatsApp is always Yes (No is switched off).
  const waPicked = () => ($('#ao-src') && $('#ao-src').value === 'whatsapp') ? 'yes' : AO.form.wa;
  function paintWa() {
    const box = $('#ao-wa');
    if (!box) return;
    const fromWa = $('#ao-src').value === 'whatsapp', cur = waPicked();
    box.innerHTML = '<div class="chips" role="group" aria-labelledby="ao-wa-l">' +
      ['yes', 'no'].map(v => '<button type="button" class="chip" data-act="ao-wa" data-v="' + v + '" aria-pressed="' + (cur === v) + '"' +
        (fromWa && v === 'no' ? ' disabled title="The order came in on WhatsApp"' : '') + '>' + (v === 'yes' ? 'Yes' : 'No, call instead') + '</button>').join('') +
      '</div>' + (cur === 'no' ? '<p class="sub" style="margin-top:4px">Nothing is sent to this client. The driver and the office call instead.</p>' : '');
  }
  onAct('ao-wa', el => { AO.form.wa = el.dataset.v === 'no' ? 'no' : 'yes'; AO.form.waTouched = true; paintWa(); });
  onChg('ao-src', () => paintWa());

  /* ---------- live price: price.quote with the tanks and services on the form ----------
     The charge follows the price until the owner types her own amount (then it is locked). */
  let priceTimer = null;
  function priceSoon() { if (!hasMod('orders')) return; clearTimeout(priceTimer); priceTimer = setTimeout(paintPrice, 350); }   // no prices without the orders add-on
  function tanksChanged() {
    if (!AO.form) return;
    if (!AO.form.tkSilent) AO.form.tkTouched = true;
    // services follow the tanks: an overhead tank switches on 'ot', an underground one 'ug'
    if (AO.form.kind === 'cleaning' && !AO.form.amc && syncTankServices(AO.form.svcs, NEW_TK)) paintChips();
    priceSoon();
  }
  async function paintPrice() {
    const f = AO.form, box = $('#ao-price');
    if (!box || !f || f.kind !== 'cleaning' || f.amc) return;
    const tk = TankEd.out(NEW_TK);
    if (tk.error) { box.innerHTML = '<div class="ao-pb"><p class="err">' + esc(tk.error) + '</p></div>'; return; }
    const my = ++AO.seq.price;
    if (!f.quote) box.innerHTML = '<div class="ao-pb"><p class="sub">Working out the price…</p></div>';
    try {
      const q = await api('price.quote', { tanks: tk.tanks, services: f.svcs });
      if (my !== AO.seq.price || AO.form !== f || !$('#ao-price')) return;
      f.quote = q;
      const typed = f.manualAmt ? Number(String($('#ao-amt').value).replace(/[^\d.]/g, '')) : 0;
      $('#ao-price').innerHTML = priceHtml(q, { typed: typed && typed !== q.total ? typed : 0 });
      if (!f.manualAmt) $('#ao-amt').value = q.total || '';
    } catch (e) {
      if (my !== AO.seq.price || !$('#ao-price') || e.message === 'AUTH') return;
      $('#ao-price').innerHTML = '<div class="ao-pb"><p class="err">' + esc(errText(e)) + '</p></div>';
    }
  }

  /* ---------- side panel: map link, team suggestion, office-hours warning ---------- */
  let sideTimer = null;
  // Wait 400 ms after typing stops, so we do not ask the server on every key
  function refreshSide() { clearTimeout(sideTimer); sideTimer = setTimeout(() => paintSide(false), 400); }
  // Answers already fetched, by "area|date", so changing only the time slot needs no trip
  const sideMemo = {};

  async function paintSide() {
    const side = $('#ao-side');
    if (!side) return;
    const addr = $('#ao-addr').value.trim(), area = $('#ao-area').value, date = $('#ao-date').value;   // '' = no date picked yet
    const my = ++AO.seq.side;
    const sgm = $('#ao-sgm');   // the phone's copy of the suggestion, right above Save
    if (sgm) sgm.innerHTML = '';

    let h = '<h3>Location</h3>';
    if (addr) {
      h += '<div class="mapbox">' + areaMap({ focus: area }) + '</div>' +
        '<p class="sub">' + (area ? 'Area recognised: <b>' + esc(areaName(area)) + '</b>.' : 'Area not recognised. Pick it from the list.') +
        ' <a class="lnk" href="' + esc(mapUrl({ address: addr })) + '" target="_blank" rel="noopener">Open in Google Maps</a></p>' +
        '<p class="sub" style="margin-top:4px">The map is schematic (areas only). Google Maps opens the exact address.</p>';
    } else h += '<div class="empty">Type the address and the area and map link appear here.</div>';

    // A survey visit has no team: the supervisor goes
    if (AO.form && AO.form.kind === 'survey') {
      side.innerHTML = h + '<h3 style="margin-top:14px">Survey visit</h3><p class="sub">No team. The surveyor sees it on their phone (PIN login), ' +
        'measures every tank and sends the sizes. The quotation is then ready in Orders and on the Dashboard.</p>';
      return;
    }
    const memoKey = area + '|' + date;
    h += '<h3 style="margin-top:14px">Team suggestion</h3><div id="ao-sg">' +
      (!area ? '<p class="sub">Pick or detect the area to see which team is already nearby.</p>'
        : !date ? '<p class="sub">Pick the service date to see which team is nearby that day.</p>'
        : sideMemo[memoKey] ? sgHtml(sideMemo[memoKey], area, date) : '<p class="sub">Finding the best team…</p>') + '</div>';

    const tm = $('#ao-time').value;
    if (outside(tm)) {
      h += '<div class="box warn" style="margin-top:12px">This slot is outside office hours (' + fm(officeStart()) + ' to ' + fm(officeEnd()) +
        '). Work in this slot is tracked as overtime.</div>';
    }
    // A slot that has already passed today (usability round 2026-10-08)
    if (date === todayIso() && mins(tm) != null && mins(tm) < nowMin()) {
      h += '<div class="box warn" style="margin-top:12px">This time has already passed today (' + fm(mins(tm)) + ').</div>';
    }
    side.innerHTML = h;
    if (sgm && area && date && sideMemo[memoKey]) sgm.innerHTML = sgHtml(sideMemo[memoKey], area, date);
    if (!area || !date || sideMemo[memoKey]) return;

    // Ask the server in ONE trip: which team, and how many jobs are already in this area that day
    try {
      const res = await batchCalls([
        ['order.suggest', { area: area, sched_date: date }],
        ['order.list', { from: date, to: date, area: area }]
      ]);
      if (res[0] instanceof Error) throw res[0];
      const ans = { sg: res[0], same: res[1] instanceof Error ? 0 : (res[1].orders || []).filter(o => o.team).length };
      sideMemo[memoKey] = ans;
      if (my !== AO.seq.side || !$('#ao-sg')) return;
      $('#ao-sg').innerHTML = sgHtml(ans, area, date);
      if ($('#ao-sgm')) $('#ao-sgm').innerHTML = sgHtml(ans, area, date);
    } catch (e) {
      if (my !== AO.seq.side || !$('#ao-sg')) return;
      if (e.message === 'AUTH') return;
      $('#ao-sg').innerHTML = '<p class="sub">' + esc(errText(e)) + ' <button class="lnk" data-act="ao-side">Try again</button></p>';
    }
  }
  // The suggestion text: "Suggested: Team B · Kishan bhai. Already in Vesu that day. 1 job already in Vesu on Wed 7 Oct."
  function sgHtml(ans, area, date) {
    const sg = ans.sg, same = ans.same;
    return sg && sg.team
      ? '<p>Suggested: <span class="tchip" style="--tc:' + tc(sg.team) + '"><i class="tdot"></i>' + esc(teamLabel(sg.team)) + '</span></p>' +
        '<p class="sub">' + esc(sg.why) + (same ? '. ' + same + ' job' + (same > 1 ? 's' : '') + ' already in ' + esc(areaName(area)) + ' on ' + lab(date) + '.' : '.') + '</p>'
      : '<p class="sub">No team suggestion.</p>';
  }
  onAct('ao-side', () => paintSide());

  /* ---------- returning client: look up the phone number ---------- */
  async function lookup(raw) {
    const box = $('#ao-ret');
    if (!box || !hasMod('clients')) return;   // returning-client lookup is part of the Clients add-on
    const phone = normPhone(raw);
    if (!phone) { AO.form.looked = ''; ++AO.seq.lookup; box.hidden = true; box.innerHTML = ''; return; }
    if (phone === AO.form.looked) return;        // already looked up this number
    AO.form.looked = phone;
    const my = ++AO.seq.lookup;
    box.hidden = false;
    box.innerHTML = '<p class="sub">Checking past orders for this number…</p>';
    try {
      const c = await api('client.lookup', { phone: phone });
      if (my !== AO.seq.lookup || !$('#ao-ret')) return;
      if (!c) { box.innerHTML = '<p class="sub">New client: no past orders for this number.</p>'; return; }

      // Fill in only the fields that are still empty
      const filled = [];
      if (!$('#ao-name').value.trim() && c.client_name) { $('#ao-name').value = c.client_name; filled.push('name'); }
      if (!$('#ao-addr').value.trim() && c.address) { $('#ao-addr').value = c.address; filled.push('address'); }
      if (!$('#ao-area').value && c.area && areaOf(c.area)) { $('#ao-area').value = c.area; AO.form.manualArea = true; filled.push('area'); }
      if (!AO.form.typeTouched && c.client_type && clientTypes().some(t => t.key === c.client_type)) {
        if ($('#ao-type').value !== c.client_type) filled.push('client type');
        $('#ao-type').value = c.client_type; AO.form.typeTouched = true;
      }
      // Uses WhatsApp: from the client's past orders (unless already picked by hand)
      if (!AO.form.waTouched && (c.whatsapp === 'yes' || c.whatsapp === 'no')) {
        if (AO.form.wa !== c.whatsapp) filled.push('WhatsApp');
        AO.form.wa = c.whatsapp;
        paintWa();
      }
      // Services: the same as the client's last job, add-ons included (unless picked by hand already)
      const lj = c.last_job;
      if (lj && (lj.services || []).length && !AO.form.svcTouched && !AO.form.amc && AO.form.kind === 'cleaning') {
        const ks = lj.services.filter(k => services().some(s => s.key === k));
        if (ks.length) {
          if (ks.slice().sort().join() !== AO.form.svcs.slice().sort().join()) filled.push('services');
          AO.form.svcs = ks; paintChips(); priceSoon();
        }
      }
      // Pricing: the saved tank sizes go into the tank editor (unless changed by hand already)
      // (tanks filled in from an EARLIER looked-up number are taken out again when this client has none)
      if (!AO.form.tkTouched && !AO.form.amc && ((c.tanks || []).length || AO.form.tkFrom)) {
        AO.form.tkSilent = true; TankEd.load(NEW_TK, c.tanks || []); AO.form.tkSilent = false;
        AO.form.tkFrom = (c.tanks || []).length ? phone : '';
        priceSoon();
      }
      if (AO.form.kind === 'cleaning' && !AO.form.amc && syncTankServices(AO.form.svcs, NEW_TK)) { paintChips(); priceSoon(); }   // services follow the tanks
      // An AMC visit not booked yet: offer to book this order as that visit (prefilled like "Visits due")
      AO.form.amcNext = hasMod('amc') && c.amc_next && !AO.form.amc ? c.amc_next : null;
      const n = Number(c.orders) || 0;
      const svc = (c.last_services || []).map(svcName).join(', ');
      // Shown like a small chat: the client's initials and one bubble about the last service
      box.innerHTML = '<div class="ao-ret">' + WA.avatar(c.client_name || phone, { small: true }) +
        WA.bubble('in', '<b>Returning client</b> · ' + n + ' job' + (n === 1 ? '' : 's') + (c.whatsapp === 'no' && App.noWaPill ? ' ' + App.noWaPill() : '') +
          '<div>Last service: ' + (c.last_date ? esc(lab(c.last_date)) : '-') + (svc ? ' · ' + esc(svc) : '') + '</div>' +
          // Money still owed and past complaints (added 2026-10-09): a warning only, the order can still be booked
          (Number(c.balance) > 0 ? '<div class="ao-owes"><span class="pill bad">Owes ' + inr(c.balance) + '</span> from earlier jobs. Mention it on the phone.</div>' : '') +
          (Number(c.disputes) > 0 ? '<div class="ao-owes"><span class="pill warn">' + c.disputes + ' past complaint' + (c.disputes === 1 ? '' : 's') + '</span> The customer said "No" after a job. ' +
            'See the history in Open client.</div>' : '') +
          // Log book: the saved tank sizes are copied onto the new order (the driver checks them at the site)
          ((c.tanks || []).length ? '<div class="ao-tanks">Tanks from last visit: ' + c.tanks.map(t => '<span class="num">' + esc(tankText(t)) + '</span>').join('; ') +
            ' <span class="sub">(filled in below)</span></div>' : '') +
          (c.amc ? '<div class="ao-tanks"><span class="pill ok">AMC ' + esc(c.amc.amc_id) + '</span> ' + esc(c.amc.done) + ' of ' + esc(c.amc.visits) + ' visits done' +
            (c.amc.next_due ? ' · next due ' + esc(lab(c.amc.next_due)) : '') + '</div>' : '') +
          (AO.form.amcNext ? '<div class="ao-amcnext"><button type="button" class="btn sm pri" data-act="ao-amc-book">Book as AMC visit ' +
            esc(AO.form.amcNext.visit_no) + '/' + esc(AO.form.amcNext.visits) + '</button> <span class="sub">due ' + esc(lab(AO.form.amcNext.due_date)) +
            ' · ' + inr(AO.form.amcNext.visit_amount) + ' from the contract</span></div>' : '') +
          (filled.length ? '<div class="sub">Filled in ' + esc(filled.join(', ')) + ' from the last order.</div>' : '') +
          '<button type="button" class="lnk" data-act="open-client" data-phone="' + esc(phone) + '">Open client</button>',
          c.last_date ? shortDate(c.last_date) : '', { who: c.client_name || '' }) + '</div>';
      paintSide();
    } catch (e) {
      if (my !== AO.seq.lookup || !$('#ao-ret')) return;
      AO.form.looked = '';
      box.hidden = true;
      fail(e);
    }
  }

  // "Book as AMC visit 2/4": the form switches to that AMC visit (tanks and price from the
  // contract, like "Book order" in Visits due). What was typed (name, address...) stays.
  onAct('ao-amc-book', () => {
    const f = AO.form, n = f && f.amcNext;
    if (!n) return;
    const v = id => ($(id) ? $(id).value || '' : '').trim();
    App.openNewOrder({
      phone: normPhone(v('#ao-phone')), client_name: v('#ao-name'), address: v('#ao-addr'), area: v('#ao-area'),
      client_type: hasMod('orders') ? v('#ao-type') : '', whatsapp: f.waTouched ? f.wa : undefined,
      amc: { amc_id: n.amc_id, visit_no: n.visit_no, visits: n.visits, visit_amount: n.visit_amount, tanks: n.tanks || [], due_date: n.due_date }
    });
  });

  /* ---------- double booking (added 2026-10-09) ----------
     When the phone and the date are both filled in, the day's orders are fetched once
     (order.list, cancelled orders are never in it) and any order of the same phone that day
     is shown above the price: "Already booked: #1042, Thu 8 Oct, 11:00 AM, Team B".
     It is a warning: Save asks once more, then books it anyway (e.g. a second building). */
  const dayMemo = {};   // {date: [orders]} of the dates looked at; emptied after a save
  let dupTimer = null;
  const dupSoon = () => { clearTimeout(dupTimer); dupTimer = setTimeout(paintDup, 400); };
  // fresh = read the day again (on Save in Edit / Reschedule, so another admin's booking counts too)
  async function dayOrders(date, fresh) {
    if (!dayMemo[date] || fresh) dayMemo[date] = (await api('order.list', { from: date, to: date })).orders || [];
    return dayMemo[date];
  }
  // The client's orders that day. exceptId = the order being edited or moved (it never clashes with itself).
  async function sameDay(phone, date, exceptId, fresh) {
    if (!phone || !date) return [];
    return (await dayOrders(date, fresh)).filter(o => o.phone === phone && Number(o.order_id) !== Number(exceptId || 0));
  }
  // opts.btn = the Save button's words; opts.noOpen = no "Open" link (inside a dialog: it would close it)
  function dupHtml(list, opts) {
    opts = opts || {};
    return '<div class="box warn ao-dupb"><b>Already booked that day.</b> ' + list.map(o =>
      '<span class="ao-dupo">#' + esc(o.order_id) + ' · ' + esc(lab(o.sched_date)) + ', ' + fm(mins(o.sched_time)) + ' · ' +
      (isSurvey(o) ? 'survey visit' : o.team ? esc(teamLabel(o.team)) : 'no team yet') + (o.status === 'done' ? ' · done' : '') +
      (opts.noOpen ? '' : ' <button type="button" class="lnk" data-act="ao-dup-open" data-id="' + esc(o.order_id) + '" data-d="' + esc(o.sched_date) + '">Open</button>') + '</span>').join(' ') +
      '<div class="sub">' + (opts.btn ? 'Pick another date, or press ' + esc(opts.btn) + ' again to keep both jobs on the same day.'
        : 'Change the date, or press Save again to book a second job the same day.') + '</div></div>';
  }
  /* The same check in the Edit and Reschedule dialogs (added 2026-10-09). The box #ao-mdup
     shows while the date (or, in Edit, the phone) is changed; Save asks once, then saves. */
  let mdupTimer = null;
  function modalDupSoon(getPhone, getDate, btnWord) {
    clearTimeout(mdupTimer);
    mdupTimer = setTimeout(async () => {
      const box = $('#ao-mdup'), o = ED.o;
      if (!box || !o) return;
      const phone = getPhone(), date = getDate(), key = phone + '|' + date;
      const changed = date !== o.sched_date || phone !== o.phone;
      if (!phone || !date || !changed) { box.hidden = true; box.innerHTML = ''; return; }
      try {
        const list = await sameDay(phone, date, o.order_id);
        if (!$('#ao-mdup') || ED.o !== o || getPhone() + '|' + getDate() !== key) return;   // changed meanwhile
        box.hidden = !list.length;
        box.innerHTML = list.length ? dupHtml(list, { btn: btnWord, noOpen: true }) : '';
      } catch (e) { /* only a warning */ }
    }, 400);
  }
  // On Save: true = go on saving; false = the warning is shown, the next Save goes through
  async function modalDupOk(phone, date, btnWord) {
    const o = ED.o;
    if (!o || (date === o.sched_date && phone === o.phone)) return true;   // same day and phone: nothing new
    const key = o.order_id + '|' + phone + '|' + date;
    if (ED.dupOk === key) return true;
    let list = [];
    try { list = await sameDay(phone, date, o.order_id, true); } catch (e) { return true; }   // could not check: save
    if (!list.length) return true;
    ED.dupOk = key;
    const box = $('#ao-mdup');
    if (box) { box.hidden = false; box.innerHTML = dupHtml(list, { btn: btnWord, noOpen: true }); }
    modalErr('This client already has ' + (list.length === 1 ? 'order #' + list[0].order_id + ' at ' + fm(mins(list[0].sched_time)) : list.length + ' orders') +
      ' on ' + lab(date) + '. Press ' + btnWord + ' again to keep both.');
    return false;
  }
  async function paintDup() {
    const box = $('#ao-dup');
    if (!box) return;
    const phone = normPhone($('#ao-phone').value), date = $('#ao-date').value, key = phone + '|' + date;
    if (!phone || !date) { box.hidden = true; box.innerHTML = ''; return; }
    try {
      const list = await sameDay(phone, date);
      if (!$('#ao-dup') || normPhone($('#ao-phone').value) + '|' + $('#ao-date').value !== key) return;   // typed on meanwhile
      box.hidden = !list.length;
      box.innerHTML = list.length ? dupHtml(list) : '';
    } catch (e) { /* only a warning: the server still saves the order */ }
  }
  onAct('ao-dup-open', el => { if (App.openOrder) App.openOrder(el.dataset.id, el.dataset.d); });

  /* ---------- form typing and picking ---------- */
  onInp('ao-phone', el => { lookup(el.value); dupSoon(); });
  onInp('ao-addr', el => {
    if (!AO.form.manualArea) $('#ao-area').value = guessArea(el.value);
    refreshSide();
  });
  onInp('ao-date', () => { paintDateChips(); refreshSide(); dupSoon(); });
  // Today / Tomorrow chips above the date box (usability round 2026-10-08)
  function paintDateChips() {
    const d = $('#ao-date') ? $('#ao-date').value : '';
    $$('#ad-new [data-act="ao-dq"]').forEach(b => b.setAttribute('aria-pressed', String(!!d && d === addD(todayIso(), Number(b.dataset.n)))));
  }
  onAct('ao-dq', el => { $('#ao-date').value = addD(todayIso(), Number(el.dataset.n)); paintDateChips(); paintSide(); dupSoon(); });
  // Clear form: an empty form, as after a save (what was typed is gone)
  onAct('ao-clear', () => {
    AO.form = freshForm();
    AO.saved = null;
    const el = $('#ad-new');
    if (isOpen('new')) { buildForm(el); paintSaved(); window.scrollTo(0, 0); $('#ao-phone').focus(); }
  });
  // A typed charge is used as it is (and locked); clearing it goes back to the worked-out price
  onInp('ao-amt', el => { AO.form.manualAmt = !!el.value.trim(); priceSoon(); });
  onChg('ao-area', el => { AO.form.manualArea = !!el.value; refreshSide(); });
  onChg('ao-time', () => paintSide());   // only the office-hours warning changes: no server trip (the answer is remembered)
  onChg('ao-type', () => { AO.form.typeTouched = true; });
  onAct('ao-svc', el => {
    const s = AO.form.svcs, i = s.indexOf(el.dataset.k);
    if (i >= 0) s.splice(i, 1); else s.push(el.dataset.k);
    AO.form.svcTouched = true;
    paintChips(); priceSoon();
  });

  /* ---------- save ---------- */
  async function saveOrder(e) {
    e.preventDefault();
    const f = AO.form;
    if (f.saving) return;
    const name = $('#ao-name').value.trim(), phone = normPhone($('#ao-phone').value), addr = $('#ao-addr').value.trim();
    const amt = Number(String($('#ao-amt').value).replace(/[^\d.]/g, ''));
    const date = $('#ao-date').value, nv = $('#ao-nv') ? $('#ao-nv').value : '';   // no next visit without Clients
    const time = $('#ao-time').value;
    const priced = hasMod('orders');
    const err = $('#ao-err');
    const sv = f.kind === 'survey', amc = f.amc;
    const tk = sv || amc ? { tanks: [] } : TankEd.out(NEW_TK);

    // Same checks as the mockup (the server checks again)
    const bad = !name ? 'Enter the client name.'
      : !phone ? 'Enter a 10 digit phone number.'
      : !addr ? 'Enter the address.'
      : (!f.svcs.length && !sv && priced) ? 'Pick at least one service.'
      : tk.error ? tk.error
      : (!sv && !amc && priced && f.manualAmt && !(amt > 0)) ? 'Enter the service charge, or clear it to use the price from the tanks.'
      : !date ? 'Pick the service date: tap Today or Tomorrow, or choose a date.'   // no silent default date
      : (nv && nv <= date) ? 'Next visit must be after the service date.'
      : '';
    if (bad) { err.textContent = bad; err.hidden = false; if (!date && $('#ao-date')) $('#ao-date').focus(); return; }
    // A time that has already passed today: warn once; a second click on Save books it anyway
    // (a date before today too: e.g. a job typed in afterwards)
    const past = date < todayIso() || (date === todayIso() && mins(time) != null && mins(time) < nowMin());
    if (past && f.pastOk !== date + '|' + time) {
      f.pastOk = date + '|' + time;
      err.textContent = (date < todayIso() ? 'This date is in the past (' + lab(date) + ').' : 'This time has already passed today (' + fm(mins(time)) + ').') +
        ' Pick a later ' + (date < todayIso() ? 'date' : 'time slot') + ', or press ' + (sv ? 'Save survey visit' : word('Save order')) + ' again to book it anyway.';
      err.hidden = false;
      return;
    }
    // The same client already booked that day: warn once; a second click on Save books it anyway
    if (f.dupOk !== phone + '|' + date) {
      let same = [];
      try { same = await sameDay(phone, date); } catch (ex) { same = []; }   // could not check: save as normal
      if (same.length) {
        f.dupOk = phone + '|' + date;
        err.textContent = 'This client already has ' + (same.length === 1 ? 'order #' + same[0].order_id + ' at ' + fm(mins(same[0].sched_time))
          : same.length + ' orders') + ' on ' + lab(date) + '. Change the date, or press ' + (sv ? 'Save survey visit' : word('Save order')) + ' again to book it anyway.';
        err.hidden = false;
        const box = $('#ao-dup');
        if (box) { box.hidden = false; box.innerHTML = dupHtml(same); }
        return;
      }
    }
    err.hidden = true;

    const order = {
      client_name: name, phone: phone,
      address: addr, area: $('#ao-area').value, services: f.svcs.slice(),
      sched_date: date, sched_time: time, notes: $('#ao-notes').value.trim(),
      whatsapp: waPicked()   // 'yes' or 'no' (an order from WhatsApp is always 'yes')
    };
    // Fields of add-ons are sent only when that add-on is on (the server ignores or refuses them otherwise)
    if (hasMod('quotation')) order.kind = sv ? 'survey' : 'cleaning';
    if (priced) { order.source = $('#ao-src').value; order.client_type = $('#ao-type').value; }
    if (hasMod('clients')) order.next_visit = nv || '';
    if (!sv && hasMod('multiday')) order.days = Number($('#ao-days').value) || 1;
    if (amc) { order.amc_id = amc.amc_id; order.amc_visit = amc.visit_no; }   // price and tanks from the contract
    else if (!sv) {
      order.tanks = tk.tanks;                  // the price comes from these (server: priceOrder); without "orders": log book only
      if (f.manualAmt) order.amount = amt;     // typed by the owner: kept and locked (without "orders": simply the amount)
    }

    const btn = $('#ao-submit');
    f.saving = true; btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const r = await api('order.create', { order: order });
      dropSaved();
      Object.keys(sideMemo).forEach(k => delete sideMemo[k]);   // job counts per area changed
      Object.keys(dayMemo).forEach(k => delete dayMemo[k]);     // the day now has one more order
      AO.saved = { order: r.order, suggestion: isSurvey(r.order) ? null : r.suggestion || null, assigned: '' };
      AO.hi = r.order.order_id;
      toast('Order #' + r.order.order_id + ' saved.');
      // Empty form for the next call
      AO.form = freshForm();
      const el = $('#ad-new');
      if (isOpen('new')) { buildForm(el); paintSaved(); window.scrollTo(0, 0); }
    } catch (ex) {
      f.saving = false; btn.disabled = false; btn.textContent = sv ? 'Save survey visit' : word('Save order');
      if (ex.message !== 'AUTH') { err.textContent = errText(ex); err.hidden = false; fail(ex); }
    }
  }

  /* ---------- "saved" box above the form, with "Assign Team X" ---------- */
  function paintSaved() {
    const box = $('#ao-saved');
    if (!box) return;
    const s = AO.saved;
    if (!s) { box.innerHTML = ''; return; }
    const o = s.order, sg = s.suggestion;
    let h = '<div class="box ok ao-saved"><div>';
    if (isSurvey(o)) h += 'Survey visit <b>#' + o.order_id + '</b> saved for ' + esc(o.client_name) + ', ' + lab(o.sched_date) + ' at ' + fm(mins(o.sched_time)) +
      '. The surveyor sees it now.';
    else if (s.assigned) h += word('Order') + ' <b>#' + o.order_id + '</b> for ' + esc(o.client_name) + ' is assigned to <b>' + esc(teamLabel(s.assigned)) + '</b>.';
    else {
      h += word('Order') + ' <b>#' + o.order_id + '</b> saved for ' + esc(o.client_name) + ', ' + lab(o.sched_date) + ' at ' + fm(mins(o.sched_time)) +
        ', ' + inr(o.amount) + (o.price_locked ? ' (price locked)' : o.price && o.price.by === 'tanks' ? ' (from tanks)' : '') + '.';
      if (sg && sg.team) h += ' Suggested: <b>Team ' + esc(sg.team) + '</b> <span class="sub">(' + esc(sg.why) + ')</span>.';
    }
    h += '</div><div class="chips">';
    if (!s.assigned && sg && sg.team) h += '<button class="btn sm pri" data-act="ao-saved-assign">Assign Team ' + esc(sg.team) + '</button>';
    h += '<button class="btn sm" data-act="ao-goto" data-id="' + o.order_id + '" data-d="' + esc(o.sched_date) + '">' + word('See in Orders') + '</button>' +
      '<button class="btn sm" data-act="ao-saved-close" aria-label="Close this message">Close</button></div></div>';
    box.innerHTML = h;
  }

  onAct('ao-saved-assign', async btn => {
    const s = AO.saved;
    if (!s || !s.suggestion) return;
    btn.disabled = true; btn.textContent = 'Assigning…';
    try {
      await api('order.assign', { order_id: s.order.order_id, team: s.suggestion.team });
      dropSaved();
      s.assigned = s.suggestion.team;
      toast('Order #' + s.order.order_id + ' assigned to Team ' + s.assigned + '.');
    } catch (e) { fail(e); }
    paintSaved();
  });
  onAct('ao-saved-close', () => { AO.saved = null; paintSaved(); });

  // Open Orders and assign showing this order highlighted
  onAct('ao-goto', el => {
    const d = el.dataset.d, t = todayIso();
    AO.ord = { when: d === t ? 'today' : d === addD(t, 1) ? 'tomorrow' : 'all', un: false, type: '', area: '', svc: '', team: '', group: '' };
    AO.hi = Number(el.dataset.id);
    AO.orders = null;
    App.adminTab = 'orders';
    renderAdmin();
  });

  // The New order screen. The form is built once and keeps what was typed
  // when the owner switches to another screen and back.
  registerScreen('admin', 'new', el => {
    if (!AO.form) AO.form = freshForm();
    if (AO.form.rebuild || !el.querySelector('#ao-f')) buildForm(el);
    else paintSide();
    paintSaved();
  });

  // Other screens call this to open New order with some fields filled in,
  // e.g. "Book order" on a next-visit reminder: App.openNewOrder({phone: '9198...'})
  App.openNewOrder = function (prefill) {
    AO.form = freshForm(prefill || {});
    AO.saved = null;
    App.adminTab = 'new';
    renderAdmin();
    window.scrollTo(0, 0);
  };

  /* ======================================================================
     B5  ORDERS AND ASSIGN
     ====================================================================== */

  // Date range for the "when" chips
  function whenRange(w) {
    const t = todayIso();
    if (w === 'today') return { from: t, to: t };
    if (w === 'tomorrow') { const d = addD(t, 1); return { from: d, to: d }; }
    if (w === 'week') return { from: t, to: addD(t, 6) };
    return {};   // all
  }

  /* One server trip: apiCached draws the saved copy at once (if there is one),
     then draws again when the server's answer is different. "updating…" shows meanwhile. */
  async function loadOrders() {
    const my = ++AO.seq.orders;
    AO.ordLoading = true; AO.ordErr = false;
    // the all-dates copy used by the search is out of date too: load it again only while searching
    AO.all = null;
    if (searching() && AO.ord.when !== 'all') loadAllForSearch();
    paintOrders();
    try {
      await apiCached('order.list', ordParams(), r => {
        if (my !== AO.seq.orders) return;
        AO.orders = r.orders || [];
        makeSuggestions();
        paintOrders();
      });
      if (my !== AO.seq.orders) return;
      AO.ordLoading = false;
      paintOrders();
    } catch (e) {
      if (my !== AO.seq.orders) return;
      AO.ordLoading = false; AO.ordErr = true;
      paintOrders(); fail(e);
    }
  }

  // What to ask the server for. Only the 'All' view also shows cancelled orders (greyed out).
  function ordParams() {
    const p = whenRange(AO.ord.when);
    if (AO.ord.when === 'all') p.include_cancelled = true;
    return p;
  }

  // A team suggestion for each unassigned order, worked out in the browser (no server trips)
  function makeSuggestions() {
    AO.sugg = {};
    (AO.orders || []).filter(o => o.status === 'new' && !isSurvey(o)).forEach(o => {   // a survey has no team
      const sg = suggestLocal(o, AO.orders);
      if (sg && sg.team) AO.sugg[o.order_id] = sg;
    });
  }

  /* ---------- search by name or phone (usability round, 2026-10-08) ----------
     Instant, in the browser. While text is typed, the search also looks at other days:
     every order is loaded once (one order.list without dates) and searched too. */
  const searching = () => !!String(AO.ord.q || '').trim();
  const searchAll = () => searching() && AO.ord.when !== 'all' && !!AO.all;   // searching beyond the chosen days
  function searchHit(o, q) {
    const t = String(q || '').trim().toLowerCase(), d = t.replace(/\D/g, '');
    if (!t) return true;
    return String(o.client_name || '').toLowerCase().includes(t) || (d.length >= 3 && String(o.phone || '').includes(d)) ||
      String(o.order_id) === t.replace(/^#/, '');
  }
  async function loadAllForSearch() {
    if (AO.allLoading) return;
    AO.allLoading = true;
    try {
      await apiCached('order.list', { include_cancelled: true }, r => { AO.all = r.orders || []; if (searching() && isOpen('orders')) paintOrders(); });
    } catch (e) { fail(e); }
    AO.allLoading = false;
  }
  onInp('ao-q', el => {
    AO.ord.q = el.value;
    if (searching() && AO.ord.when !== 'all' && !AO.all) loadAllForSearch();
    paintOrders();
  });

  // The loaded list with the filters applied (same rules as the mockup)
  function ordList() {
    const f = AO.ord;
    let L = (searchAll() ? AO.all : AO.orders || []).slice();
    if (searching()) L = L.filter(o => searchHit(o, f.q));
    if (f.un) L = L.filter(o => o.status === 'new' && !isSurvey(o));
    if (f.type) L = L.filter(o => o.client_type === f.type);
    if (f.area) L = L.filter(o => (o.area || 'other') === f.area);
    if (f.svc === '__survey') L = L.filter(isSurvey);   // "Survey visits" in the Task filter
    else if (f.svc) L = L.filter(o => (o.services || []).includes(f.svc));
    if (f.team) L = L.filter(o => f.team === 'none' ? !o.team : o.team === f.team);
    return L.sort(byDateTime);
  }

  // A phone number as a tap-to-call link: "98250 41031" -> tel:+919825041031
  const telLink = p => { const d = dialNo(p); return d ? '<a class="ao-tel" href="tel:+' + d + '" aria-label="Call ' + esc(phoneText(p)) + '">' + esc(phoneText(p)) + '</a>' : esc(phoneText(p)); };
  App.telLink = telLink;   // also used by the Dashboard alerts (admin-insights.js)

  // "Team A · Ramesh" (first word of the driver name, so it stays short)
  const teamShort = k => { const t = teamRow(k); return 'Team ' + k + (t && t.driver_name ? ' · ' + String(t.driver_name).split(' ')[0] : ''); };
  // The teams to offer in a picker (active ones, plus the order's own team if it was switched off)
  function teamOpts(o) {
    const opts = activeTeams().slice();
    if (o.team && !opts.some(t => t.team === o.team) && teamRow(o.team)) opts.push(teamRow(o.team));
    return opts.map(t => '<option value="' + esc(t.team) + '"' + (o.team === t.team ? ' selected' : '') + '>' + esc(teamShort(t.team)) + '</option>').join('');
  }

  /* Status pills in the Orders table: only the ones that MEAN something.
     A team that is set needs no "Assigned" pill (the Team column already says so). */
  function ordPills(o) {
    if (o.status === 'cancelled') return cxPill(o);   // a cancelled order only needs this one pill
    // A survey: "Survey" + the quotation status, and the Quotation button once it is measured
    if (isSurvey(o)) return kindPills(o).trim() + (o.status === 'done' ? ' ' + quoteBtn(o) : '');
    const viewDay = AO.ord.when === 'tomorrow' ? addD(todayIso(), 1) : todayIso();
    const m = { new: ['Unassigned', 'warn'], reached: ['At site', 'ok'], done: ['Done ✓', 'ok'], moved: ['Moved', 'warn'], ongoing: ['In progress', 'info'] }[o.status];
    // Same two kinds of "late" as Team routes: what the driver reported, or only the clock
    const li = lateInfo(o);
    const late = li.said > 0 ? '<span class="pill bad" title="The driver reported this delay">Late · ' + esc(dur(li.said)) + '</span>'
      : li.overdue > 0 && o.sched_date === todayIso() ? '<span class="pill" title="Based on the clock only: the driver has not tapped Reached yet">Not reached yet</span>' : '';
    return (m ? '<span class="pill ' + m[1] + '">' + m[0] + '</span>' : '') + (late ? (m ? ' ' : '') + late : '') +
      (o.moved_from && o.status !== 'moved' ? ' <span class="pill warn" title="Moved from ' + esc(lab(o.moved_from)) + '">Moved</span>' : '') +
      hourPills(o) + kindPills(o, viewDay);
  }

  /* The Team cell:
     - done: just the team chip
     - team set: the chip IS a light dropdown, to change or remove the team
     - no team, with a suggestion: "Assign Team A" + a small ▾ to pick another team
     - no team, no suggestion: a light "Assign team…" dropdown */
  function teamCell(o) {
    if (isSurvey(o)) return '<span class="sub">Surveyor</span>';   // a survey has no team
    if (o.status === 'done' || o.status === 'cancelled') {
      return o.team ? '<span class="tchip" style="--tc:' + tc(o.team) + '"><i class="tdot"></i>' + esc(teamShort(o.team)) + '</span>' : '<span class="sub">No team</span>';
    }
    const lbl = ' aria-label="Team for order ' + o.order_id + '"';
    if (o.team) {
      return '<span class="ao-ts" style="--tc:' + tc(o.team) + '"><i class="tdot"></i><select data-chg="ao-assign" data-id="' + o.order_id + '"' + lbl + '>' +
        teamOpts(o) + '<option value="">No team</option></select></span>';
    }
    const sg = AO.sugg[o.order_id];
    const pick = '<option value="" selected>' + (sg ? 'Other team…' : 'Assign team…') + '</option>' + teamOpts(o);
    if (!sg) return '<span class="ao-ts ao-ts-none"><i class="tdot"></i><select data-chg="ao-assign" data-id="' + o.order_id + '"' + lbl + '>' + pick + '</select></span>';
    return '<span class="ao-ua"><button class="btn sm pri" data-act="ao-apply" data-id="' + o.order_id + '" data-t="' + esc(sg.team) +
      '" title="Suggested: ' + esc(sg.why) + '">Assign Team ' + esc(sg.team) + '</button>' +
      '<span class="ao-more" title="Pick another team"><i class="ao-chev" aria-hidden="true"></i><select data-chg="ao-assign" data-id="' + o.order_id + '" aria-label="Pick another team for order ' + o.order_id + '">' + pick + '</select></span></span>';
  }

  // One table row. On a phone the same row shows as a small card (see admin.css).
  function orderRow(o) {
    const oneDay = (AO.ord.when === 'today' || AO.ord.when === 'tomorrow') && !searchAll();   // one day: the time is enough
    const cls = [AO.hi === o.order_id ? 'hi' : '', o.status === 'cancelled' ? 'ao-cx' : ''].join(' ').trim();
    return '<tr class="' + cls + '" id="ao-row-' + o.order_id + '">' +
      // the phone number is a tap-to-call link (usability round 2026-10-08)
      '<td class="c-cl">' + withAvatar(o, clientLink(o) + '<div class="sub">#' + o.order_id + ' · ' + telLink(o.phone) + '</div>' +
        (noWa(o) && App.noWaPill ? App.noWaPill() : '')) + '</td>' +
      '<td class="c-area"><span class="ao-ar">' + esc(areaName(o.area)) +
      '<a class="ao-mapic" href="' + esc(mapUrl(o)) + '" target="_blank" rel="noopener" title="Open in Google Maps" aria-label="Open ' + esc(o.client_name) + ' in Google Maps">' + WA.icons.map + '</a></span>' +
      (hasMod('orders') ? '<div class="sub">' + esc(ctName(o.client_type)) + '</div>' : '') + '</td>' +
      '<td class="c-task sub">' + esc((o.services || []).map(svcShort).join(', ')) + '</td>' +
      '<td class="c-when">' + (oneDay ? '<b>' + fm(mins(o.sched_time)) + '</b>' : lab(o.sched_date) + '<div class="sub">' + fm(mins(o.sched_time)) + '</div>') + '</td>' +
      '<td class="c-amt num">' + (isSurvey(o) ? (Number(o.quote_amount) ? '<span class="sub">Quote</span> ' + inr(o.quote_amount) : '<span class="sub">–</span>') : inr(o.amount)) + '</td>' +
      '<td class="c-team">' + teamCell(o) + '</td>' +
      '<td class="c-st">' + ordPills(o) + '</td>' +
      '<td class="c-act">' + orderMenuBtn(o) + '</td></tr>';
  }

  function paintOrders() {
    if (!isOpen('orders')) return;
    const el = $('#ad-orders'), f = AO.ord;
    const L = ordList(), unN = L.filter(o => o.status === 'new' && !isSurvey(o)).length;
    const live = L.filter(o => o.status !== 'cancelled'), cxN = L.length - live.length;   // cancelled orders are not counted in the total
    const tot = live.reduce((a, o) => a + (Number(o.amount) || 0), 0);

    // Table body: plain, or grouped by area / task / team
    let body = '';
    if (!f.group) body = L.map(orderRow).join('');
    else {
      const keys = [], map = {};
      L.forEach(o => {
        const ks = f.group === 'area' ? [o.area || 'other'] : f.group === 'team' ? [o.team || 'none'] : (o.services || []);
        ks.forEach(k => { (map[k] = map[k] || []).push(o); if (!keys.includes(k)) keys.push(k); });
      });
      keys.sort();
      body = keys.map(k => {
        const g = map[k];
        const nm = f.group === 'area' ? (k === 'other' ? 'Other area' : areaName(k))
          : f.group === 'team' ? (k === 'none' ? 'Unassigned' : teamLabel(k)) : svcName(k);
        return '<tr class="grp"><td colspan="8"><b>' + esc(nm) + '</b> · ' + g.length + word(' order') + (g.length > 1 ? 's' : '') +
          (f.group === 'svc' ? '' : ' · ' + inr(g.filter(o => o.status !== 'cancelled').reduce((a, o) => a + (Number(o.amount) || 0), 0))) + '</td></tr>' + g.map(orderRow).join('');
      }).join('');
    }

    const sel = (k, label, opts) => '<select class="fsel" style="width:auto" data-chg="ao-f" data-k="' + k + '" aria-label="' + label + '">' +
      opts.map(x => '<option value="' + esc(x[0]) + '"' + (f[k] === x[0] ? ' selected' : '') + '>' + esc(x[1]) + '</option>').join('') + '</select>';
    const any = f.un || f.type || f.area || f.svc || f.team || f.group;
    // How many dropdown filters are in use (shown on the phone's "Filters" button)
    const nf = [f.area, f.svc, f.team, f.type, f.group].filter(Boolean).length;

    // Keep the cursor in the search box while the list redraws under it
    const qEl = document.activeElement && document.activeElement.id === 'ao-q' ? document.activeElement : null;
    const qPos = qEl ? qEl.selectionStart : 0;

    let tbody;
    if (AO.orders === null && !searchAll()) {
      tbody = '<tr><td colspan="8"><div class="empty">' + (AO.ordErr
        ? word('Could not load the orders.') + ' <button class="lnk" data-act="ao-reload">Try again</button>' : word('Loading orders…')) + '</div></td></tr>';
    } else tbody = L.length ? body : '<tr><td colspan="8"><div class="empty">' + (searching() ? 'No order matches "' + esc(f.q) + '".' : word('No orders for these filters.')) + '</div></td></tr>';

    el.innerHTML =
      '<header><div><h2>' + word('Orders and assign') + '</h2><p class="sub">Filter by area, task or team. Teams are suggested by area, so nearby jobs go to the same team.</p></div>' +
      '<button class="btn pri" data-act="ao-smart"' + (unN && !AO.ordLoading && !searchAll() ? '' : ' disabled') + '>Smart assign ' + unN + ' by area</button></header>' +
      // Search by name or phone (usability round 2026-10-08)
      '<div class="ao-search"><label class="ins-sbox">' + WA.icons.search +
      '<input type="search" id="ao-q" data-inp="ao-q" placeholder="Search name or phone" aria-label="Search orders by client name or phone" value="' + esc(f.q || '') + '"></label>' +
      (searching() ? '<span class="sub">' + (AO.ord.when === 'all' ? 'Searching all dates.' : searchAll() ? 'Searching all dates, not only the chosen days.'
        : 'Searching the chosen days… other dates are loading.') + '</span>' : '') + '</div>' +
      '<div class="chips" style="margin-bottom:8px">' +
      [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'Next 7 days'], ['all', 'All']].map(w =>
        '<button class="chip" aria-pressed="' + (f.when === w[0]) + '" data-act="ao-when" data-w="' + w[0] + '">' + w[1] + '</button>').join('') +
      '<button class="chip" aria-pressed="' + f.un + '" data-act="ao-unonly">Unassigned only</button>' +
      // Phone only: the dropdowns fold away behind one "Filters" button (see admin.css)
      '<button class="chip ao-ftoggle" aria-expanded="' + !!AO.fOpen + '" data-act="ao-ftoggle">Filters' + (nf ? ' · ' + nf : '') + ' ' + (AO.fOpen ? '▴' : '▾') + '</button></div>' +
      '<div class="chips ao-filters' + (AO.fOpen ? ' open' : '') + '" style="margin-bottom:10px">' +
      sel('area', 'Area', [['', 'All areas']].concat(areas().map(a => [a.key, a.name_en])).concat([['other', 'Other area']])) +
      sel('svc', 'Task', [['', 'All tasks']].concat(services().map(s => [s.key, s.name_en])).concat(hasMod('quotation') ? [['__survey', 'Survey visits']] : [])) +
      sel('team', 'Team', [['', 'All teams']].concat(activeTeams().map(t => [t.team, teamLabel(t.team)])).concat([['none', 'Unassigned']])) +
      (hasMod('orders') ? sel('type', 'Client type', [['', 'All client types']].concat(clientTypes().map(c => [c.key, c.name_en]))) : '') +
      sel('group', 'Group by', [['', 'No grouping'], ['area', 'Group by area'], ['svc', 'Group by task'], ['team', 'Group by team']]) +
      (any ? '<button class="btn sm" data-act="ao-clr">Clear filters</button>' : '') + '</div>' +
      '<p class="sub" style="margin-bottom:8px">' + (AO.orders === null ? '&nbsp;'
        : 'Showing <b>' + L.length + '</b>' + word(' order') + (L.length === 1 ? '' : 's') + ' · ' + inr(tot) +
          (cxN ? ' · ' + cxN + ' cancelled (greyed out, not in the total)' : '') +
          (f.group === 'svc' ? word(' (an order with several tasks appears under each task)') : '')) +
      (AO.ordLoading && AO.orders !== null ? ' ' + updNote() : '') + '</p>' +
      '<div class="tw"><table class="tbl ao-tbl"><thead><tr><th>Client</th><th>Area</th><th>Task</th><th>When</th><th class="num">Charge</th><th>Team</th><th>Status</th><th class="c-act"><span class="ao-vh">Actions</span></th></tr></thead><tbody>' +
      tbody + '</tbody></table></div>';
    if (qEl) { const q = $('#ao-q'); if (q) { q.focus(); try { q.setSelectionRange(qPos, qPos); } catch (e) { /* not a text box */ } } }
    // Opened from an alert ("Open order"): bring the highlighted row into view once
    if (AO.hiScroll && AO.hi && $('#ao-row-' + AO.hi)) { AO.hiScroll = false; $('#ao-row-' + AO.hi).scrollIntoView({ block: 'center' }); }
  }

  /* Other screens (Dashboard alerts) open an order (usability round 2026-10-08):
     App.openOrder(id, date)               Orders and assign on that day, the order highlighted
     App.orderAction('edit'|'move', id, date)  the Edit panel or the Reschedule dialog of that order
     The order is loaded with one order.list for its date (cancelled ones too). */
  App.openOrder = function (id, date) {
    const t = todayIso();
    AO.ord = { when: !date || date === t ? 'today' : date === addD(t, 1) ? 'tomorrow' : 'all', un: false, type: '', area: '', svc: '', team: '', group: '', q: '' };
    AO.hi = Number(id); AO.hiScroll = true;
    AO.orders = null;
    App.adminTab = 'orders';
    renderAdmin();
    window.scrollTo(0, 0);
  };
  App.orderAction = async function (act, id, date, btn) {
    id = Number(id);
    let o = known[id];
    if (!o) {
      try {
        const r = await api('order.list', date ? { from: date, to: date, include_cancelled: true } : { include_cancelled: true });
        o = (r.orders || []).find(x => x.order_id === id);
      } catch (e) { fail(e); return; }
    }
    if (!o) { toast(word('That order was not found. The list has been refreshed.')); return; }
    known[id] = o;
    // the same code as the "⋯" menu items: a fake menu button with the order id
    const fake = { dataset: { id: String(id) } };
    lastFocus = btn || null;
    if (act === 'move') {
      if (o.status === 'done' || o.status === 'cancelled' || o.status === 'ongoing' || workDays(o).length) { App.actions['ao-o-edit'](fake); return; }
      App.actions['ao-o-move'](fake);
    } else App.actions['ao-o-edit'](fake);
  };

  // Assign one order to a team ('' = take the team off)
  async function assign(id, team) {
    // Show the change at once; the list is checked against the server right after
    const o = (AO.orders || []).find(x => x.order_id === id);
    if (o && (o.status === 'new' || o.status === 'assigned')) { o.team = team; o.status = team ? 'assigned' : 'new'; makeSuggestions(); paintOrders(); }
    try {
      await api('order.assign', { order_id: id, team: team });
      dropSaved();
      if (team && AO.hi === id) AO.hi = null;
      toast(team ? 'Order #' + id + ' assigned to Team ' + team + '.' : 'Team removed from order #' + id + '.');
    } catch (e) { fail(e); }
    loadOrders();
  }

  onChg('ao-assign', el => {
    const id = Number(el.dataset.id), o = (AO.orders || []).find(x => x.order_id === id);
    if (!el.value && !(o && o.team)) return;            // "Other team…" picked again: nothing to do
    el.disabled = true; assign(id, el.value);
  });
  onAct('ao-apply', el => { el.disabled = true; assign(Number(el.dataset.id), el.dataset.t); });
  /* Smart assign (usability round 2026-10-08): first a preview, job -> team, with Confirm.
     The plan is worked out here, one job after the other (in time order), as if the jobs
     before it were already given their team, so jobs in the same area go to the same team.
     Each team can still be changed in the preview. Confirm sends all of them in ONE trip. */
  let smartPlan = [];
  onAct('ao-smart', btn => {
    const todo = ordList().filter(o => o.status === 'new' && !isSurvey(o)).sort(byDateTime);
    if (!todo.length) return;
    const work = (AO.orders || []).map(o => Object.assign({}, o));   // a copy: the plan is not saved yet
    smartPlan = todo.map(o => {
      const sg = suggestLocal(o, work);
      const w = work.find(x => x.order_id === o.order_id);
      if (sg && sg.team && w) { w.team = sg.team; w.status = 'assigned'; }
      return { o: o, team: sg ? sg.team : '', why: sg ? sg.why : 'No team to suggest' };
    });
    lastFocus = btn;
    const body = '<p class="sub">Each job gets the team already in its area that day, or the nearest, or the lightest. Change a team here if needed, then Confirm.</p>' +
      '<div class="ao-plan">' + smartPlan.map((p, i) => '<div class="ao-planr"><div class="ao-plan1"><b>' + esc(p.o.client_name) + '</b><div class="sub">' +
        (AO.ord.when === 'today' || AO.ord.when === 'tomorrow' ? '' : esc(lab(p.o.sched_date)) + ' · ') + fm(mins(p.o.sched_time)) + ' · ' + esc(areaName(p.o.area)) + '</div></div>' +
        '<span class="ao-arrow" aria-hidden="true">→</span>' +
        '<div class="ao-plan2"><select class="fsel" data-chg="ao-plan" data-i="' + i + '" aria-label="Team for ' + esc(p.o.client_name) + '">' +
        '<option value="">No team</option>' + activeTeams().map(t => '<option value="' + esc(t.team) + '"' + (t.team === p.team ? ' selected' : '') + '>' + esc(teamShort(t.team)) + '</option>').join('') +
        '</select><div class="sub">' + esc(p.why) + '</div></div></div>').join('') + '</div>' +
      '<p class="err" id="ao-merr" role="alert" hidden></p>';
    openModal('dlg', 'Smart assign: check the plan', body,
      '<button type="button" class="btn" data-act="ao-mclose">Cancel</button>' +
      '<button type="button" class="btn pri" data-act="ao-smart-go">Confirm ' + smartPlan.length + ' job' + (smartPlan.length === 1 ? '' : 's') + '</button>');
  });
  onChg('ao-plan', el => { const p = smartPlan[Number(el.dataset.i)]; if (p) { p.team = el.value; p.why = el.value ? 'Picked by you' : 'Stays without a team'; } });
  onAct('ao-smart-go', async btn => {
    const go = smartPlan.filter(p => p.team);
    if (!go.length) { modalErr('No team picked for any job.'); return; }
    busy(btn, 'Assigning…'); modalErr('');
    try {
      // at most 10 calls go in one trip (BATCH_MAX on the server), so a long plan takes a few trips
      let res = [];
      for (let i = 0; i < go.length; i += 10) {
        res = res.concat(await batchCalls(go.slice(i, i + 10).map(p => ['order.assign', { order_id: p.o.order_id, team: p.team }])));
      }
      const bad = res.filter(x => x instanceof Error);
      dropSaved();
      const n = go.length - bad.length;
      toast(n + ' order' + (n === 1 ? '' : 's') + ' assigned.' + (bad.length ? ' ' + bad.length + ' could not be assigned: ' + errText(bad[0]) : ''));
      closeModal();
    } catch (e) { unbusy(btn); if (e.message !== 'AUTH') modalErr(errText(e)); return; }
    loadOrders();
  });
  // "When" chips change the date range, so the list is loaded again
  onAct('ao-when', el => { if (AO.ord.when === el.dataset.w) return; AO.ord.when = el.dataset.w; AO.orders = null; loadOrders(); });
  // The other filters work on the list already loaded
  onAct('ao-unonly', () => { AO.ord.un = !AO.ord.un; paintOrders(); });
  onAct('ao-ftoggle', () => { AO.fOpen = !AO.fOpen; paintOrders(); });
  onAct('ao-clr', () => { Object.assign(AO.ord, { un: false, type: '', area: '', svc: '', team: '', group: '' }); paintOrders(); });
  onChg('ao-f', el => { AO.ord[el.dataset.k] = el.value; paintOrders(); });
  onAct('ao-reload', () => loadOrders());

  registerScreen('admin', 'orders', () => loadOrders());

  /* ======================================================================
     ORDER ACTIONS: Edit / Reschedule / Cancel / Restore
     - Every order in Orders and assign (and every order bubble on a client page)
       has a small "⋯" button. It opens a short menu:
         Edit        a side panel with the same fields as New order, filled in
         Reschedule  new date + time slot, a reason, "Notify customer on WhatsApp"
         Cancel      a reason, then a red "Cancel order" button (or "Keep order")
         Restore     only on a cancelled order: puts it back
     - A done job can only be edited (it cannot be moved or cancelled).
     - After every action: a short message (toast), the saved lists are dropped
       and the open screen loads fresh data in the background.
     - The panel and dialogs are drawn into one box (#ao-modal) added to the page.
       admin-insights.js uses the same "⋯" button through App.orderMenuBtn(order).
     ====================================================================== */
  const known = {};          // order_id -> the order last drawn with a "⋯" button
  let menuFor = 0;           // order_id whose menu is open (0 = none)
  let lastFocus = null;      // the button to give focus back to when a dialog closes
  const ED = {};             // the order being edited / moved / cancelled, and the form flags

  /* Clients WITHOUT WhatsApp (whatsapp 'no'): nothing is sent to them, so the dialogs say
     "No WhatsApp: call the customer" with the phone number instead of "Notify on WhatsApp". */
  const callBox = (o, what) => '<div class="box warn ao-callbox"><b>No WhatsApp: call the customer</b>' + (what ? ' ' + what : '') +
    ' <a href="tel:+' + esc(String(o.phone || '').replace(/\D/g, '')) + '">' + esc(phoneText(o.phone)) + '</a></div>';
  // "Customer messaged on WhatsApp." or the reminder to call (for the toasts)
  const toldText = (o, notify) => noWa(o) ? '. No WhatsApp: call ' + phoneText(o.phone) + '.' : notify ? '. Customer messaged on WhatsApp.' : '.';

  // Reasons for moving a job (keys match orders.gs MOVE_REASONS + 'other')
  const MOVE_WHY = [['customer', 'Customer asked'], ['team', 'Team not available'], ['weather', 'Weather'], ['other', 'Other']];
  // Reasons for cancelling (saved as the words themselves in cancel_reason)
  const CANCEL_WHY = ['Customer cancelled', 'Duplicate', 'Wrong entry', 'Other'];
  // Reasons where the customer is told on WhatsApp by default (added 2026-10-09). A duplicate or
  // a wrong entry was the office's own mistake: the customer still has a booking, so no message.
  const CANCEL_TELL = ['Customer cancelled', 'Other'];

  // "Cancelled · Customer cancelled" pill
  function cxPill(o) {
    return '<span class="pill ao-cxp" title="' + (o.cancelled_at ? 'Cancelled on ' + esc(lab(o.cancelled_at.slice(0, 10))) : 'Cancelled') + '">Cancelled' +
      (o.cancel_reason ? ' · ' + esc(o.cancel_reason) : '') + '</span>';
  }
  App.cancelPill = cxPill;

  // The small "⋯" button. Remembers the order so the menu and forms can use it.
  function orderMenuBtn(o) {
    known[o.order_id] = o;
    return '<button type="button" class="ao-om" data-act="ao-om" data-id="' + o.order_id + '" aria-haspopup="menu" aria-expanded="false" ' +
      'aria-label="Actions for order #' + o.order_id + '" title="Edit, reschedule or cancel">⋯</button>';
  }
  App.orderMenuBtn = orderMenuBtn;

  // One box on the page for the menu, and one for the panel / dialogs
  function box(id) {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('div'); el.id = id; el.hidden = true; document.body.appendChild(el); }
    return el;
  }

  /* ---------- the "⋯" menu ---------- */
  function closeMenu() {
    const pop = document.getElementById('ao-pop');
    if (pop) { pop.hidden = true; pop.innerHTML = ''; }
    $$('.ao-om[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
    menuFor = 0;
  }
  onAct('ao-om', btn => {
    const id = Number(btn.dataset.id), o = known[id];
    if (!o) return;
    if (menuFor === id) { closeMenu(); return; }   // second tap closes it
    closeMenu();
    menuFor = id; lastFocus = btn;
    btn.setAttribute('aria-expanded', 'true');
    const open = o.status !== 'done' && o.status !== 'cancelled';
    // a multi-day job that has started cannot be moved (it continues day by day)
    const movable = open && !(o.status === 'ongoing' || workDays(o).length);
    const item = (act, label, cls) => '<button type="button" role="menuitem" class="' + (cls || '') + '" data-act="' + act + '" data-id="' + id + '">' + label + '</button>';
    const pop = box('ao-pop');
    pop.className = 'ao-pop'; pop.setAttribute('role', 'menu');
    pop.innerHTML = '<div class="ao-poph">' + word('Order #') + id + '</div>' + item('ao-o-edit', 'Edit details') +
      (movable ? item('ao-o-move', 'Reschedule') : '') + (open ? item('ao-o-cancel', word('Cancel order'), 'bad') : '') +
      (o.status === 'cancelled' ? item('ao-o-restore', word('Restore order')) : '') +
      (o.status === 'done' ? '<div class="ao-popn sub">Done jobs can be edited, not moved or cancelled.</div>' : '');
    pop.hidden = false;
    // Put it under the button, inside the window (above it when there is no room below)
    const r = btn.getBoundingClientRect(), w = pop.offsetWidth, hgt = pop.offsetHeight;
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    const top = r.bottom + 4 + hgt > window.innerHeight - 8 ? Math.max(8, r.top - hgt - 4) : r.bottom + 4;
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    const first = pop.querySelector('[role="menuitem"]'); if (first) first.focus();
  });
  // A click anywhere else, scrolling, or Escape closes the menu
  document.addEventListener('click', e => {
    if (menuFor && !e.target.closest('#ao-pop') && !e.target.closest('.ao-om')) closeMenu();
  }, true);
  window.addEventListener('scroll', () => { if (menuFor) closeMenu(); }, true);
  window.addEventListener('resize', () => { if (menuFor) closeMenu(); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (menuFor) { closeMenu(); if (lastFocus) lastFocus.focus(); return; }
    if (!box('ao-modal').hidden) closeModal();
  });

  /* ---------- the panel / dialog box ---------- */
  // kind: 'ao-panel' (Edit panel, slides in from the right) or 'dlg' (small dialog in the middle)
  function openModal(kind, title, bodyHtml, footHtml) {
    const m = box('ao-modal');
    m.className = 'ao-modal ' + kind;
    m.innerHTML = '<div class="ao-scrim" data-act="ao-mclose"></div>' +
      '<section class="ao-dlg" role="dialog" aria-modal="true" aria-labelledby="ao-dlg-t">' +
      '<header class="ao-dlgh"><h3 id="ao-dlg-t">' + word(title) + '</h3>' +
      '<button type="button" class="ao-x" data-act="ao-mclose" aria-label="Close">×</button></header>' +
      '<div class="ao-dlgb">' + bodyHtml + '</div>' +
      '<footer class="ao-dlgf">' + word(footHtml) + '</footer></section>';
    m.hidden = false;
    document.body.classList.add('ao-noscroll');
    const f = m.querySelector('.ao-dlgb input, .ao-dlgb select, .ao-dlgb textarea, .ao-dlgb button');
    if (f) f.focus();
  }
  function closeModal() {
    const m = box('ao-modal');
    m.hidden = true; m.innerHTML = '';
    document.body.classList.remove('ao-noscroll');
    ED.last = ED.o;   // the order the dialog was about (afterChange forgets its old copy)
    ED.o = null;
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }
  onAct('ao-mclose', closeModal);

  // Small header line: "Hiren Patel · Wed 7 Oct · 10:30 AM · Team B"
  const orderLine = o => '<p class="ao-dlgs">' + WA.avatar(o.client_name, { small: true }) + '<span><b>' + esc(o.client_name) + '</b><span class="sub"> · #' + o.order_id + '</span>' +
    '<span class="sub ao-dlgw">' + esc(lab(o.sched_date)) + ' · ' + fm(mins(o.sched_time)) + ' · ' + (o.team ? 'Team ' + esc(o.team) : 'No team') + '</span></span></p>';
  // Reason chips (one can be picked)
  const reasonChips = (act, list, cur) => '<div class="chips" role="group">' + list.map(r => {
    const k = Array.isArray(r) ? r[0] : r, l = Array.isArray(r) ? r[1] : r;
    return '<button type="button" class="chip" data-act="' + act + '" data-k="' + esc(k) + '" aria-pressed="' + (k === cur) + '">' + esc(l) + '</button>';
  }).join('') + '</div>';
  function pickChip(el, key) {
    ED[key] = el.dataset.k;
    $$('#ao-modal [data-act="' + el.dataset.act + '"]').forEach(b => b.setAttribute('aria-pressed', String(b === el)));
  }
  // Time slots, plus the order's own time if it is not one of the slots (e.g. 7:00 AM)
  function slotsWith(cur) {
    let h = slotOptions(cur);
    if (cur && h.indexOf('value="' + cur + '"') < 0) h = '<option value="' + esc(cur) + '" selected>' + fm(mins(cur)) + '</option>' + h;
    return h;
  }
  const modalErr = text => { const e = $('#ao-merr'); if (e) { e.textContent = text; e.hidden = !text; } };
  const busy = (btn, text) => { if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = text; } };
  const unbusy = btn => { if (btn && btn.dataset.label) { btn.disabled = false; btn.textContent = btn.dataset.label; } };

  /* After any action: drop the saved lists and let the open screen load fresh data in the background */
  function afterChange(newPhone, oldPhone) {
    // The changed order's remembered copy is out of date (its date, status...): forget it, so the
    // next Edit / Reschedule fetches it again even when it is not on the list shown (fixed 2026-10-09)
    const was = ED.o || ED.last;
    if (was) delete known[was.order_id];
    ED.last = null;
    dropSaved();
    Object.keys(sideMemo).forEach(k => delete sideMemo[k]);   // job counts per area may have changed
    Object.keys(dayMemo).forEach(k => delete dayMemo[k]);     // the double-booking check reads the days again
    if (!App.session || App.session.role !== 'admin') return;
    // The open client page follows the order to its corrected phone number
    if (App.adminTab === 'clients' && newPhone && newPhone !== oldPhone && App.openClient) { App.openClient(newPhone); return; }
    if (App.adminTab !== 'new') renderAdmin();
    if (App.refreshAlertBadge) App.refreshAlertBadge();
  }

  /* ---------- Edit ---------- */
  onAct('ao-o-edit', el => {
    const o = known[Number(el.dataset.id)];
    closeMenu();
    if (!o) return;
    ED.o = o; ED.dupOk = '';
    ED.svcs = (o.services || []).slice();
    // The charge follows the price from the tanks / services (price.quote) until the owner
    // types a charge herself (then it is saved as typed and locked). A locked price stays.
    ED.manualAmt = false;
    ED.manualArea = true;
    const sv = isSurvey(o);
    TankEd.reset(EDK(o));   // the tank editor starts from the order's saved tanks
    const auto = mapUrl({ address: o.address });
    const custom = o.map_link && o.map_link !== auto ? o.map_link : '';
    const movable = o.status !== 'done' && o.status !== 'cancelled';
    const priced = hasMod('orders');
    const opt = (v, l, cur) => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(l) + '</option>';
    const teams = activeTeams().slice();
    if (o.team && !teams.some(t => t.team === o.team) && teamRow(o.team)) teams.push(teamRow(o.team));
    const body = orderLine(o) +
      (o.status === 'cancelled' ? '<div class="box ao-cxbox">This order is cancelled' + (o.cancel_reason ? ' (' + esc(o.cancel_reason) + ')' : '') + '. Use Restore to bring it back.</div>' : '') +
      (o.status === 'done' ? '<div class="box ok">This job is done. Changes here only correct the record; nobody is messaged.</div>' : '') +
      (sv ? '<div class="box">Survey visit: no team and no charge. The surveyor measures the tanks; then use Quotation.</div>' : '') +
      (o.price_locked && !sv ? '<div class="box">Price locked: ' + esc(lockWhy(o)) + '. Changing tanks or services does not change the charge; type a new charge to change it.' +
        '<label class="ao-ck" style="margin-top:6px"><input type="checkbox" id="ao-e-unlock"> Unlock: work the charge out from the tanks again</label></div>' : '') +
      '<form id="ao-ef" autocomplete="off" novalidate><div class="form-grid">' +
      // (without "orders": no "came from" and no client type)
      (!priced ? '' : '<div class="fld"><label for="ao-e-src">Order came from</label><select id="ao-e-src">' + opt('call', 'Phone call', o.source || 'call') + opt('whatsapp', 'WhatsApp', o.source) + '</select></div>' +
      '<div class="fld"><label for="ao-e-type">Client type</label><select id="ao-e-type">' + (o.client_type ? '' : opt('', '-', '')) +
      clientTypes().map(c => opt(c.key, c.name_en, o.client_type)).join('') + '</select></div>') +
      '<div class="fld"><label for="ao-e-name">Client name</label><input id="ao-e-name" value="' + esc(o.client_name) + '"></div>' +
      '<div class="fld"><label for="ao-e-phone">Phone number</label><input id="ao-e-phone" inputmode="numeric" data-inp="ao-e-phone" value="' + esc(phoneText(o.phone)) + '"></div>' +
      '<div class="fld full"><label for="ao-e-addr">Address</label><textarea id="ao-e-addr" rows="2" data-inp="ao-e-addr">' + esc(o.address) + '</textarea></div>' +
      '<div class="fld"><label for="ao-e-area">Area</label><select id="ao-e-area" data-chg="ao-e-area">' + opt('', 'Other area', o.area || '') +
      areas().map(a => opt(a.key, a.name_en, o.area)).join('') + '</select></div>' +
      '<div class="fld"><label for="ao-e-map">Map link (optional)</label><input id="ao-e-map" type="url" value="' + esc(custom) + '" placeholder="Made from the address"></div>' +
      '</div>' +
      '<div class="fld" style="margin-bottom:12px"' + (services().length || priced || (o.services || []).length ? '' : ' hidden') + '><span class="lbl">' +
      (sv ? 'Services the client wants' : priced ? 'Service' : 'Checklist (optional)') + '</span><div class="chips" id="ao-e-svcs"></div></div>' +
      (sv ? '' : '<div class="fld ao-tkf"><span class="lbl">Tanks' + (priced ? '' : ' <span class="sub">(optional, for the log book)</span>') + '</span>' + TankEd.html(EDK(o), o.tanks || [], { lang: 'en', onChange: eTanksChanged, hint: true }) + '</div>') +
      '<div class="form-grid">' +
      '<div class="fld"><label for="ao-e-date">Service date</label><input id="ao-e-date" type="date" data-inp="ao-e-when" value="' + esc(o.sched_date) + '"></div>' +
      '<div class="fld"><label for="ao-e-time">Time slot</label><select id="ao-e-time" data-chg="ao-e-when">' + slotsWith(o.sched_time) + '</select></div>' +
      (sv ? '' : '<div class="fld"><label for="ao-e-amt">' + (priced ? 'Service charge (₹)' : 'Amount (₹)') + '</label><input id="ao-e-amt" inputmode="numeric" data-inp="ao-e-amt" value="' + esc(o.amount) + '"></div>' +
        '<div class="fld"><label for="ao-e-team">Team</label><select id="ao-e-team">' + opt('', 'No team', o.team || '') +
        teams.map(t => opt(t.team, teamShort(t.team), o.team)).join('') + '</select></div>' +
        (hasMod('multiday') ? '<div class="fld"><label for="ao-e-days">How many days</label><select id="ao-e-days">' + dayOptions(jobDays(o)) + '</select></div>' : '') +
        (priced ? '<div class="full" id="ao-e-price" aria-live="polite"></div>' : '')) +
      (hasMod('clients') ? '<div class="fld"><label for="ao-e-nv">Next visit (optional)</label><input id="ao-e-nv" type="date" value="' + esc(o.next_visit || '') + '"></div>' : '') +
      '<div class="fld full"><label for="ao-e-notes">Note for the team</label><input id="ao-e-notes" value="' + esc(o.notes || '') + '"></div>' +
      '</div>' +
      (movable ? '<div class="box warn ao-mvbox" id="ao-e-mv" hidden><div id="ao-e-mvt"></div>' +
        (noWa(o)
          // No WhatsApp: no message can go; keep notify on so the office gets a "call" reminder alert
          ? '<input type="checkbox" id="ao-e-notify" checked hidden><div><b>No WhatsApp: call the customer</b> <a href="tel:+' + esc(o.phone) + '">' + esc(phoneText(o.phone)) + '</a></div>'
          : '<label class="ao-ck"><input type="checkbox" id="ao-e-notify" checked> Notify customer on WhatsApp</label>') + '</div>' : '') +
      '<div id="ao-mdup" aria-live="polite" hidden></div>' +   // "already booked that day" (added 2026-10-09)
      '<p class="err" id="ao-merr" role="alert" hidden></p></form>';
    openModal('ao-panel', sv ? 'Edit survey visit' : 'Edit order', body,
      '<button type="button" class="btn" data-act="ao-mclose">Close</button>' +
      '<button type="button" class="btn pri" data-act="ao-e-save" id="ao-e-save">Save changes</button>');
    paintEditChips();
    if (!sv) paintEPrice();
  });
  const EDK = o => 'ao:ed:' + o.order_id;   // the tank editor in the Edit panel

  /* Live price in the Edit panel (price.quote with the tanks and services on screen) */
  let ePriceTimer = null;
  // Tanks changed in the Edit panel: the cleaning services follow the tank positions, then the price
  function eTanksChanged() {
    const o = ED.o;
    if (o && !isSurvey(o) && !o.amc_id && syncTankServices(ED.svcs, EDK(o))) paintEditChips();
    ePriceSoon();
  }
  function ePriceSoon() { if (!hasMod('orders')) return; clearTimeout(ePriceTimer); ePriceTimer = setTimeout(paintEPrice, 350); }
  async function paintEPrice() {
    const o = ED.o, box = $('#ao-e-price');
    if (!o || !box || isSurvey(o) || !hasMod('orders')) return;   // no prices without the orders add-on
    const tk = TankEd.out(EDK(o));
    if (tk.error) { box.innerHTML = '<div class="ao-pb"><p class="err">' + esc(tk.error) + '</p></div>'; return; }
    const my = ++AO.seq.eprice;
    try {
      let q = await api('price.quote', { tanks: tk.tanks, services: ED.svcs });
      if (my !== AO.seq.eprice || ED.o !== o || !$('#ao-e-price')) return;
      const typed = ED.manualAmt ? Number(String($('#ao-e-amt').value).replace(/[^\d.]/g, '')) : 0;
      if (o.price_locked) q = Object.assign({}, q, { by: 'locked', total: Number(o.amount) || 0 });
      $('#ao-e-price').innerHTML = priceHtml(q, { why: o.price_locked ? lockWhy(o) : '', typed: typed && typed !== Number(o.amount) ? typed : 0 });
      if (!ED.manualAmt && !o.price_locked) $('#ao-e-amt').value = q.total;
    } catch (e) {
      if (my !== AO.seq.eprice || !$('#ao-e-price') || e.message === 'AUTH') return;
      $('#ao-e-price').innerHTML = '<div class="ao-pb"><p class="err">' + esc(errText(e)) + '</p></div>';
    }
  }
  // Tanks as a plain list, to see whether they were changed
  const tankKey = list => JSON.stringify((list || []).map(t => [t.type, tankMat(t), t.litres == null ? null : Number(t.litres), t.l == null ? null : Number(t.l),
    t.w == null ? null : Number(t.w), t.h == null ? null : Number(t.h), Number(t.count) || 1]));

  function paintEditChips() {
    const b = $('#ao-e-svcs');
    if (!b) return;
    // Services switched off in the Services tab still show if this order has them
    const list = services().slice();
    ED.svcs.forEach(k => { if (!list.some(s => s.key === k)) list.push(svcOf(k) || { key: k, name_en: k, default_price: 0 }); });
    b.innerHTML = list.map(s => '<button type="button" class="chip" data-act="ao-e-svc" data-k="' + esc(s.key) + '" aria-pressed="' +
      ED.svcs.includes(s.key) + '">' + esc(s.name_en) + (hasMod('orders') ? ' · ' + inr(s.default_price) : '') + '</button>').join('');
  }
  onAct('ao-e-svc', el => {
    const i = ED.svcs.indexOf(el.dataset.k);
    if (i >= 0) ED.svcs.splice(i, 1); else ED.svcs.push(el.dataset.k);
    paintEditChips();
    ePriceSoon();
  });
  onInp('ao-e-amt', () => { ED.manualAmt = true; ePriceSoon(); });
  onInp('ao-e-addr', el => { if (!$('#ao-e-area').value) { const g = guessArea(el.value); if (g) $('#ao-e-area').value = g; } });
  onChg('ao-e-area', () => {});
  // Show "this moves the job" as soon as the date or time is changed
  function editWhenNote() {
    const box2 = $('#ao-e-mv'), o = ED.o;
    if (!box2 || !o) return;
    const d = $('#ao-e-date').value, t = $('#ao-e-time').value;
    const moved = d !== o.sched_date || t !== o.sched_time;
    box2.hidden = !moved;
    if (moved && d) $('#ao-e-mvt').innerHTML = 'This moves the job from <b>' + esc(lab(o.sched_date)) + ', ' + fm(mins(o.sched_time)) + '</b> to <b>' +
      esc(lab(d)) + ', ' + fm(mins(t)) + '</b>. The team stays the same.';
  }
  const editDupSoon = () => modalDupSoon(() => normPhone(($('#ao-e-phone') || {}).value || ''), () => ($('#ao-e-date') || {}).value || '', 'Save changes');
  onInp('ao-e-when', () => { editWhenNote(); editDupSoon(); });
  onChg('ao-e-when', editWhenNote);
  onInp('ao-e-phone', editDupSoon);

  onAct('ao-e-save', async btn => {
    const o = ED.o;
    if (!o) return;
    const v = id => ($(id) ? $(id).value || '' : '').trim();   // a field that is not shown (survey) reads as ''
    const sv = isSurvey(o);
    const name = v('#ao-e-name'), phone = normPhone(v('#ao-e-phone')), addr = v('#ao-e-addr');
    const amtTxt = v('#ao-e-amt').replace(/[^\d.]/g, ''), amt = Number(amtTxt);
    const date = v('#ao-e-date'), time = v('#ao-e-time'), nv = v('#ao-e-nv');
    const tk = sv ? { tanks: [] } : TankEd.out(EDK(o));
    const bad = !name ? 'Enter the client name.'
      : !phone ? 'Enter a 10 digit phone number.'
      : !addr ? 'Enter the address.'
      : (!ED.svcs.length && !sv && hasMod('orders')) ? 'Pick at least one service.'
      : tk.error ? tk.error
      : (!sv && ED.manualAmt && hasMod('orders') && (amtTxt === '' || !(amt >= 0))) ? 'Enter the service charge.'
      : !date ? 'Pick the service date.'
      : (nv && nv <= date) ? 'Next visit must be after the service date.'
      : '';
    if (bad) { modalErr(bad); return; }
    // The client already has another order on the new day (or the corrected phone does): ask once
    if (!(await modalDupOk(phone, date, 'Save changes'))) return;

    // Send only what changed
    const patch = {};
    const put = (k, val, cur) => { if (String(val) !== String(cur == null ? '' : cur)) patch[k] = val; };
    if (hasMod('orders')) {   // fields of the "orders" add-on
      put('source', v('#ao-e-src'), o.source || 'call');
      put('client_type', v('#ao-e-type'), o.client_type || '');
    }
    put('client_name', name, o.client_name);
    put('phone', phone, o.phone);
    put('address', addr, o.address);
    put('area', v('#ao-e-area'), o.area || '');
    if (ED.svcs.slice().sort().join(',') !== (o.services || []).slice().sort().join(',')) patch.services = ED.svcs.slice();
    const unlock = $('#ao-e-unlock') && $('#ao-e-unlock').checked;
    if (unlock) patch.price_locked = false;                            // the server works the charge out again
    else if (!sv && ED.manualAmt) put('amount', amtTxt === '' ? 0 : amt, Number(o.amount));   // only a typed charge is sent (it is then locked if it differs; without "orders" it is simply the amount)
    if (!sv && tankKey(tk.tanks) !== tankKey(o.tanks)) patch.tanks = tk.tanks;
    if (!sv && hasMod('multiday')) put('days', Number(v('#ao-e-days')) || 1, jobDays(o));
    put('sched_date', date, o.sched_date);
    put('sched_time', time, o.sched_time);
    if (!sv) put('team', v('#ao-e-team'), o.team || '');
    put('notes', v('#ao-e-notes'), o.notes || '');
    if (hasMod('clients')) put('next_visit', nv, o.next_visit || '');
    // Map link: a typed link is kept; clearing a custom link goes back to the automatic one
    const ml = v('#ao-e-map'), auto = mapUrl({ address: o.address });
    const wasCustom = o.map_link && o.map_link !== auto;
    if (ml && ml !== o.map_link) patch.map_link = ml;
    else if (!ml && wasCustom) patch.map_link = mapUrl({ address: addr });
    if (!Object.keys(patch).length) { toast('Nothing changed.'); closeModal(); return; }

    const nb = $('#ao-e-notify');
    const body = { order_id: o.order_id, patch: patch, reason: 'other', notify: nb ? nb.checked : false };
    busy(btn, 'Saving…'); modalErr('');
    try {
      const r = await api('order.update', body);
      const n = r.order || {};
      toast(r.moved
        ? 'Order #' + o.order_id + ' moved to ' + lab(n.sched_date) + ', ' + fm(mins(n.sched_time)) + toldText(o, body.notify)
        : 'Order #' + o.order_id + ' saved.');
      AO.hi = o.order_id;
      closeModal();
      afterChange(n.phone, o.phone);
    } catch (e) {
      unbusy(btn);
      if (e.message !== 'AUTH') modalErr(errText(e));
    }
  });

  /* ---------- Reschedule ---------- */
  onAct('ao-o-move', el => {
    const o = known[Number(el.dataset.id)];
    closeMenu();
    if (!o) return;
    ED.o = o; ED.why = 'customer'; ED.dupOk = '';
    const t = todayIso();
    // No date chosen yet (usability round 2026-10-08): the owner picks it, nothing is pre-filled
    const body = orderLine(o) +
      '<div class="form-grid">' +
      '<div class="fld"><label for="ao-m-date">New date</label><input id="ao-m-date" type="date" data-inp="ao-m-date" min="' + t + '" value=""></div>' +
      '<div class="fld"><label for="ao-m-time">Time slot</label><select id="ao-m-time">' + slotsWith(o.sched_time) + '</select></div>' +
      '</div>' +
      '<div class="fld"><span class="lbl">Why is it moving?</span>' + reasonChips('ao-m-why', MOVE_WHY, ED.why) + '</div>' +
      (noWa(o)
        // No WhatsApp: nothing can be sent; notify stays on so the office gets a "call" reminder alert
        ? '<input type="checkbox" id="ao-m-notify" checked hidden>' + callBox(o, 'with the new date and time:')
        : '<label class="ao-ck"><input type="checkbox" id="ao-m-notify" checked> Notify customer on WhatsApp</label>') +
      '<p class="sub">The team stays the same; change it in Orders if needed.</p>' +
      '<div id="ao-mdup" aria-live="polite" hidden></div>' +   // "already booked that day" (added 2026-10-09)
      '<p class="err" id="ao-merr" role="alert" hidden></p>';
    openModal('dlg', 'Reschedule order', body,
      '<button type="button" class="btn" data-act="ao-mclose">Close</button>' +
      '<button type="button" class="btn pri" data-act="ao-m-save">Move order</button>');
  });
  onAct('ao-m-why', el => pickChip(el, 'why'));
  onInp('ao-m-date', () => modalDupSoon(() => (ED.o || {}).phone, () => ($('#ao-m-date') || {}).value || '', 'Move order'));
  onAct('ao-m-save', async btn => {
    const o = ED.o;
    if (!o) return;
    const date = $('#ao-m-date').value, time = $('#ao-m-time').value, notify = $('#ao-m-notify').checked;
    if (!date) { modalErr('Pick the new date.'); return; }
    if (date < todayIso()) { modalErr('The new date cannot be in the past.'); return; }
    if (date === o.sched_date && time === o.sched_time) { modalErr('Pick a different date or time.'); return; }
    if (!(await modalDupOk(o.phone, date, 'Move order'))) return;   // the client already has another order that day: ask once
    busy(btn, 'Moving…'); modalErr('');
    try {
      await api('order.reschedule', { items: [{ order_id: o.order_id, new_date: date, new_time: time, reason: ED.why || 'other', notify: notify }] });
      toast('Order #' + o.order_id + ' moved to ' + lab(date) + ', ' + fm(mins(time)) + toldText(o, notify));
      AO.hi = o.order_id;
      closeModal();
      afterChange();
    } catch (e) {
      unbusy(btn);
      if (e.message !== 'AUTH') modalErr(errText(e));
    }
  });

  /* ---------- Cancel ---------- */
  onAct('ao-o-cancel', el => {
    const o = known[Number(el.dataset.id)];
    closeMenu();
    if (!o) return;
    ED.o = o; ED.cx = CANCEL_WHY[0]; ED.cxTouched = false;
    const body = orderLine(o) +
      '<div class="fld"><span class="lbl">Reason</span>' + reasonChips('ao-c-why', CANCEL_WHY, ED.cx) + '</div>' +
      '<div class="fld"><label for="ao-c-note">Details (optional)</label><input id="ao-c-note" maxlength="150" placeholder="e.g. booked with another agency"></div>' +
      // Tell the customer (added 2026-10-09): WhatsApp "cancelled" with the booked date and time
      (noWa(o)
        ? '<input type="checkbox" id="ao-c-notify" hidden>' + callBox(o, 'if they need to know:')
        : '<label class="ao-ck"><input type="checkbox" id="ao-c-notify" data-chg="ao-c-notify"' + (CANCEL_TELL.includes(ED.cx) ? ' checked' : '') + '> Tell the customer on WhatsApp</label>') +
      '<p class="sub">The job disappears from the team\'s list, Team routes and the Calendar. You can restore it later.</p>' +

      '<p class="err" id="ao-merr" role="alert" hidden></p>';
    openModal('dlg', 'Cancel order #' + o.order_id + '?', body,
      '<button type="button" class="btn" data-act="ao-mclose">Keep order</button>' +
      '<button type="button" class="btn danger" data-act="ao-c-save">Cancel order</button>');
  });
  onAct('ao-c-why', el => {
    pickChip(el, 'cx');
    // the tick follows the reason until it is changed by hand
    const nb = $('#ao-c-notify');
    if (nb && !nb.hidden && !ED.cxTouched) nb.checked = CANCEL_TELL.includes(ED.cx);
  });
  onChg('ao-c-notify', () => { ED.cxTouched = true; });
  onAct('ao-c-save', async btn => {
    const o = ED.o;
    if (!o) return;
    const note = ($('#ao-c-note').value || '').trim();
    const reason = (ED.cx || 'Other') + (note ? ': ' + note : '');
    const nb = $('#ao-c-notify'), notify = !!(nb && !nb.hidden && nb.checked);
    busy(btn, 'Cancelling…'); modalErr('');
    try {
      const r = await api('order.cancel', { order_id: o.order_id, reason: reason, notify: notify });
      toast('Order #' + o.order_id + ' cancelled' + (r.whatsapp === 'yes' ? '. Customer messaged on WhatsApp' : r.whatsapp === 'no' ? '. No WhatsApp: call ' + phoneText(o.phone) : '') +
        '. It shows greyed out in Orders → All.');
      closeModal();
      afterChange();
    } catch (e) {
      unbusy(btn);
      if (e.message !== 'AUTH') modalErr(errText(e));
    }
  });

  /* ---------- Restore ---------- */
  onAct('ao-o-restore', async el => {
    const id = Number(el.dataset.id), o = known[id];
    closeMenu();
    if (!o) return;
    try {
      const r = await api('order.restore', { order_id: id });
      const n = r.order || o;
      toast('Order #' + id + ' restored' + (n.team ? ' for Team ' + n.team : ' (no team yet)') + ', ' + lab(n.sched_date) + '.');
      AO.hi = id;
      delete known[id];
      afterChange();
    } catch (e) { fail(e); }
  });

  /* ======================================================================
     QUOTATION (survey visits, added 2026-10-08)
     After the supervisor sends the measurements, the survey has a draft
     quotation (price from the tanks + the add-ons the client wants).
       Send quotation      WhatsApp to the client (Yes / No buttons). No WhatsApp:
                           nothing is sent, the dialog shows "Call: <phone>".
       Approve & schedule  makes the cleaning order (date, time, team, days, amount
                           prefilled with the quotation). Its price stays LOCKED.
       Declined            the client said no (a reason goes into the notes).
     The client's own WhatsApp "Yes" / "No" shows as an alert on the Dashboard.
     ====================================================================== */
  function quoteBtn(o) {
    known[o.order_id] = o;
    return '<button type="button" class="btn sm ao-qb" data-act="ao-quote" data-id="' + o.order_id + '">Quotation</button>';
  }
  App.quoteBtn = quoteBtn;
  onAct('ao-quote', el => {
    const o = known[Number(el.dataset.id)];
    closeMenu();
    if (!o) return;
    lastFocus = el;
    openQuote(o, '');
  });

  function openQuote(o, mode) {
    ED.o = o; ED.qmode = mode;
    const done = o.status === 'done', st = o.quote_status, open = done && (st === 'draft' || st === 'sent');
    let body = orderLine(o) + '<p class="ao-qst">' + quotePill(o) +
      (o.quote_sent_at ? ' <span class="sub">sent ' + esc(lab(String(o.quote_sent_at).slice(0, 10))) + ', ' + fm(mins(o.quote_sent_at)) + '</span>' : '') + '</p>';
    if (!done) body += '<div class="box">The surveyor has not sent the measurements yet. The quotation is ready as soon as they do.</div>';
    else {
      body += '<h4 class="ao-qh">Measured tanks</h4>' + priceHtml(o.price, { totalLabel: 'Quotation' }) +
        (Number(o.quote_amount) !== Number((o.price || {}).total) ? '<p class="sub">Quotation saved at the survey: <b>' + inr(o.quote_amount) + '</b></p>' : '');
      if (o.notes) body += '<p class="sub ao-qnote">Notes: ' + esc(o.notes) + '</p>';
      if (noWa(o) && open && mode === '') body += callBox(o, 'Call:');
    }
    if (st === 'approved') body += '<div class="box ok">Approved: cleaning order <b>#' + esc(o.quote_order_id) + '</b> (price locked).</div>';
    if (mode === 'approve') {
      const tm = addD(todayIso(), 1);
      body += '<h4 class="ao-qh">Schedule the cleaning</h4><div class="form-grid">' +
        '<div class="fld"><label for="ao-q-date">Date</label><input id="ao-q-date" type="date" min="' + todayIso() + '" value="' + tm + '" data-inp="ao-q-date"></div>' +
        '<div class="fld"><label for="ao-q-time">Time slot</label><select id="ao-q-time">' + slotOptions('10:00') + '</select></div>' +
        '<div class="fld"><label for="ao-q-team">Team</label><select id="ao-q-team"><option value="">No team yet</option>' +
        activeTeams().map(t => '<option value="' + esc(t.team) + '">' + esc(teamShort(t.team)) + '</option>').join('') + '</select>' +
        // the team suggestion for that day and area (usability round 2026-10-08)
        '<div class="sub ao-qsg" id="ao-q-sg" aria-live="polite"></div></div>' +
        '<div class="fld"><label for="ao-q-days">How many days</label><select id="ao-q-days">' + dayOptions(1) + '</select></div>' +
        '<div class="fld full"><label for="ao-q-amt">Amount (₹, locked)</label><input id="ao-q-amt" inputmode="numeric" value="' + esc(o.quote_amount) + '"></div>' +
        '</div><p class="sub">The cleaning order gets the client, tanks and services of this survey. Its price stays fixed even if the driver measures differently (you get an alert).</p>';
    }
    if (mode === 'decline') {
      body += '<div class="fld"><label for="ao-q-why">Reason (optional)</label><input id="ao-q-why" maxlength="150" placeholder="e.g. too costly, booked elsewhere"></div>';
    }
    // "Send quotation" asks first, in the dialog itself (usability round 2026-10-08)
    if (mode === 'send') {
      body += '<div class="box ' + (noWa(o) ? 'warn' : 'info') + ' ao-qconf"><b>' + (st === 'sent' ? 'Send the quotation again?' : 'Send the quotation?') + '</b><div>' +
        (noWa(o) ? 'No WhatsApp: nothing is sent. Call ' + esc(o.client_name) + ' on ' + telLink(o.phone) + ' and tell them ' + inr(o.quote_amount) + '.'
          : esc(o.client_name) + ' gets the quotation of <b>' + inr(o.quote_amount) + '</b> on WhatsApp (' + esc(phoneText(o.phone)) + '), with Yes / No buttons.') + '</div></div>';
    }
    body += '<p class="err" id="ao-merr" role="alert" hidden></p>';
    let foot;
    if (mode === 'approve') foot = '<button type="button" class="btn" data-act="ao-q-back">Back</button><button type="button" class="btn pri" data-act="ao-q-approve">Create cleaning order</button>';
    else if (mode === 'decline') foot = '<button type="button" class="btn" data-act="ao-q-back">Back</button><button type="button" class="btn danger" data-act="ao-q-decline">Mark declined</button>';
    else if (mode === 'send') foot = '<button type="button" class="btn" data-act="ao-q-back">Back</button><button type="button" class="btn pri" data-act="ao-q-send">' +
      (noWa(o) ? 'Mark as told' : st === 'sent' ? 'Yes, send again' : 'Yes, send') + '</button>';
    else {
      // Approve is the main (green) button only once the quotation has gone to the client;
      // before that, sending it is the main step.
      foot = '<button type="button" class="btn" data-act="ao-mclose">Close</button>';
      if (open) foot += '<button type="button" class="btn" data-act="ao-q-mode" data-m="decline">Declined</button>' +
        '<button type="button" class="btn' + (st === 'sent' ? '' : ' pri') + '" data-act="ao-q-mode" data-m="send">' + (st === 'sent' ? 'Send again' : 'Send quotation') + '</button>';
      if (open || (done && st === 'declined')) foot += '<button type="button" class="btn' + (st === 'sent' ? ' pri' : '') + '" data-act="ao-q-mode" data-m="approve">Approve &amp; schedule</button>';
      if (st === 'approved' && o.quote_order_id) foot += '<button type="button" class="btn pri" data-act="ao-q-open" data-id="' + esc(o.quote_order_id) + '">Open order #' + esc(o.quote_order_id) + '</button>';
    }
    openModal('dlg ao-qdlg', 'Quotation · ' + esc(o.client_name), body, foot);
    if (mode === 'approve') qSuggest();
  }

  /* The team suggestion in "Approve & schedule": order.suggest for the survey's area on the
     chosen date. "Use" puts it in the Team box (nothing is picked by itself). */
  async function qSuggest() {
    const o = ED.o, box = $('#ao-q-sg'), d = $('#ao-q-date') ? $('#ao-q-date').value : '';
    if (!o || !box) return;
    if (!d || !o.area) { box.textContent = o.area ? '' : 'No area on this survey: pick the team yourself.'; return; }
    const my = ++AO.seq.side;
    box.textContent = 'Finding the best team…';
    try {
      const sg = await api('order.suggest', { area: o.area, sched_date: d });
      if (my !== AO.seq.side || !$('#ao-q-sg') || ED.o !== o) return;
      $('#ao-q-sg').innerHTML = sg && sg.team ? 'Suggested: <b>' + esc(teamShort(sg.team)) + '</b> (' + esc(sg.why) + ') ' +
        '<button type="button" class="lnk" data-act="ao-q-use" data-t="' + esc(sg.team) + '">Use</button>' : 'No team suggestion.';
    } catch (e) { if (my === AO.seq.side && $('#ao-q-sg') && e.message !== 'AUTH') $('#ao-q-sg').textContent = errText(e); }
  }
  onInp('ao-q-date', () => qSuggest());
  onAct('ao-q-use', el => { const s = $('#ao-q-team'); if (s) s.value = el.dataset.t; });
  App.openQuote = o => { known[o.order_id] = o; openQuote(o, ''); };
  onAct('ao-q-mode', el => { if (ED.o) openQuote(ED.o, el.dataset.m); });
  onAct('ao-q-back', () => { if (ED.o) openQuote(ED.o, ''); });
  onAct('ao-q-open', el => {
    closeModal();
    AO.ord = { when: 'all', un: false, type: '', area: '', svc: '', team: '', group: '' };
    AO.hi = Number(el.dataset.id); AO.orders = null;
    App.adminTab = 'orders';
    renderAdmin();
  });

  onAct('ao-q-send', async btn => {
    const o = ED.o;
    if (!o) return;
    busy(btn, 'Sending…'); modalErr('');
    try {
      const r = await api('quote.send', { order_id: o.order_id });
      toast(r.call ? 'No WhatsApp: call ' + o.client_name + ' (' + phoneText(o.phone) + ') and tell them the quotation, ' + inr(o.quote_amount) + '.'
        : 'Quotation ' + inr(o.quote_amount) + ' sent to ' + o.client_name + ' on WhatsApp.');
      closeModal();
      afterChange();
    } catch (e) { unbusy(btn); if (e.message !== 'AUTH') modalErr(errText(e)); }
  });
  onAct('ao-q-approve', async btn => {
    const o = ED.o;
    if (!o) return;
    const date = $('#ao-q-date').value, amtTxt = String($('#ao-q-amt').value).replace(/[^\d.]/g, '');
    if (!date) { modalErr('Pick the date.'); return; }
    if (date < todayIso()) { modalErr('The date cannot be in the past.'); return; }
    if (amtTxt === '' || !(Number(amtTxt) >= 0)) { modalErr('Enter the amount.'); return; }
    busy(btn, 'Saving…'); modalErr('');
    try {
      const r = await api('quote.approve', { order_id: o.order_id, sched_date: date, sched_time: $('#ao-q-time').value,
        team: $('#ao-q-team').value, days: Number($('#ao-q-days').value) || 1, amount: Number(amtTxt) });
      toast('Cleaning order #' + r.order.order_id + ' for ' + o.client_name + ' on ' + lab(r.order.sched_date) + ', ' + inr(r.order.amount) + ' (price locked).');
      AO.hi = r.order.order_id;
      closeModal();
      afterChange();
    } catch (e) { unbusy(btn); if (e.message !== 'AUTH') modalErr(errText(e)); }
  });
  onAct('ao-q-decline', async btn => {
    const o = ED.o;
    if (!o) return;
    busy(btn, 'Saving…'); modalErr('');
    try {
      await api('quote.decline', { order_id: o.order_id, reason: ($('#ao-q-why').value || '').trim() });
      toast('Quotation for ' + o.client_name + ' marked declined.');
      closeModal();
      afterChange();
    } catch (e) { unbusy(btn); if (e.message !== 'AUTH') modalErr(errText(e)); }
  });

  /* ======================================================================
     B6a  CALENDAR
     ====================================================================== */
  const monthEnd = ym => { const p = ym.split('-').map(Number); return ym + '-' + pad2(new Date(p[0], p[1], 0).getDate()); };

  async function loadCal() {
    if (!AO.cal) { AO.calDay = todayIso(); AO.cal = AO.calDay.slice(0, 7); }
    const my = ++AO.seq.cal;
    AO.calLoading = true; AO.calErr = false;
    paintCal();
    try {
      await apiCached('order.list', { from: AO.cal + '-01', to: monthEnd(AO.cal) }, r => {
        if (my !== AO.seq.cal) return;
        AO.calOrders = r.orders || [];
        paintCal();
      });
      if (my !== AO.seq.cal) return;
      AO.calLoading = false;
      paintCal();
    } catch (e) {
      if (my !== AO.seq.cal) return;
      AO.calLoading = false; AO.calErr = true;
      paintCal(); fail(e);
    }
  }

  function paintCal() {
    if (!isOpen('cal')) return;
    const p = AO.cal.split('-').map(Number), y = p[0], m = p[1];
    const off = (new Date(y, m - 1, 1).getDay() + 6) % 7;   // Monday first
    const dim = new Date(y, m, 0).getDate(), today = todayIso();
    const ok = o => o.status !== 'moved' && (!AO.calTeam || (AO.calTeam === 'none' ? !o.team : o.team === AO.calTeam));
    // a multi-day job shows on each day of its span (jobOnDate in common.js)
    const dayOrders = iso => AO.calOrders.filter(o => jobOnDate(o, iso) && ok(o)).sort(byDateTime);

    let g = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => '<div class="dh">' + d + '</div>').join('');
    for (let i = 0; i < off; i++) g += '<div class="cell off"></div>';
    for (let d = 1; d <= dim; d++) {
      const iso = AO.cal + '-' + pad2(d), os = dayOrders(iso);
      g += '<button class="cell' + (iso === today ? ' today' : '') + (iso === AO.calDay ? ' sel' : '') + '" data-act="ao-calday" data-d="' + iso +
        '" aria-label="' + lab(iso) + ', ' + os.length + ' orders"><span class="d">' + d + '</span>' +
        os.slice(0, 3).map(o => '<span class="cchip' + (isSurvey(o) ? ' sv' : '') + '" style="--tc:' + tc(o.team) + '"><i class="tdot"></i><span class="txt">' +
          (isSurvey(o) ? 'Survey ' : jobDays(o) > 1 ? 'D' + jobDayNo(o, iso) + ' ' : fm(mins(o.sched_time)).replace(':00', '') + ' ') +
          esc(String(o.client_name).split(' ')[0]) + '</span></span>').join('') +
        (os.length > 3 ? '<span class="sub more">+' + (os.length - 3) + ' more</span>' : '') + '</button>';
    }

    const dl = dayOrders(AO.calDay);
    const dayOT = dl.reduce((a, o) => a + (Number(o.overtime_min) || 0), 0);
    const chip = (v, label, col) => '<button class="chip" aria-pressed="' + (AO.calTeam === v) + '" data-act="ao-calteam" data-t="' + esc(v) + '">' +
      (col ? '<i class="tdot" style="--tc:' + col + ';margin-right:6px"></i>' : '') + esc(label) + '</button>';
    const inMonth = AO.calDay.slice(0, 7) === AO.cal;

    let list;
    if (AO.calErr) list = '<div class="empty">Could not load this month. <button class="lnk" data-act="ao-calreload">Try again</button></div>';
    else if (AO.calLoading && !AO.calOrders.length) list = '<div class="empty">Loading…</div>';
    else if (!dl.length) list = '<div class="empty">' + word('No orders on this day') + (AO.calTeam ? ' for this team' : '') + '.</div>';
    else list = dl.map(o => '<div class="dl"><b class="tm">' + fm(mins(o.sched_time)) + '</b>' + withAvatar(o, clientLink(o) +
      (hasMod('orders') ? ' <span class="pill">' + esc(ctName(o.client_type)) + '</span>' : '') + hourPills(o) + kindPills(o, AO.calDay) +
      '<div class="sub">' + esc(areaName(o.area)) + ' · ' + (o.services || []).map(k => esc(svcShort(k))).join(', ') + ' · ' + stPill(o) +
      (isSurvey(o) && o.status === 'done' ? ' ' + quoteBtn(o) : '') + '</div>') +
      (isSurvey(o) ? '<span class="sub">Surveyor</span>' : teamChip(o.team)) + '</div>').join('');

    $('#ad-cal').innerHTML =
      '<header><div><h2>Calendar</h2><p class="sub">' + word('Every order') + ' lands here the moment it is saved. Colour is the team. Office hours ' +
      fm(officeStart()) + ' to ' + fm(officeEnd()) + '.</p></div>' +
      '<div class="chips"><button class="btn sm" data-act="ao-calnav" data-n="-1" aria-label="Previous month">◀</button>' +
      '<b style="align-self:center">' + MONF[m - 1] + ' ' + y + '</b>' +
      '<button class="btn sm" data-act="ao-calnav" data-n="1" aria-label="Next month">▶</button>' +
      (AO.cal !== today.slice(0, 7) ? '<button class="btn sm" data-act="ao-caltoday">Today</button>' : '') + '</div></header>' +
      '<div class="chips" style="margin-bottom:10px" role="group" aria-label="Filter by team">' + chip('', 'All teams') +
      activeTeams().map(t => chip(t.team, 'Team ' + t.team, tc(t.team))).join('') + chip('none', 'Unassigned', 'var(--tN)') + '</div>' +
      '<div class="cal' + (AO.calLoading && !AO.calOrders.length ? ' ao-dim' : '') + '">' + g + '</div>' +
      (inMonth
        ? '<h3 style="margin-top:16px">' + lab(AO.calDay) + ' <span class="sub" style="font-family:var(--f-body);font-weight:400">· ' +
          (AO.calLoading ? (AO.calOrders.length ? dl.length + ' job' + (dl.length === 1 ? '' : 's') + ' ' + updNote() : 'loading') : dl.length + ' job' + (dl.length === 1 ? '' : 's') + (dayOT ? ' · overtime ' + dur(dayOT) : '')) + '</span></h3>' +
          '<div class="daylist">' + list + '</div>'
        : '<p class="sub" style="margin-top:16px">Tap a day to see its jobs.</p>');
  }

  onAct('ao-calday', el => { AO.calDay = el.dataset.d; paintCal(); });
  onAct('ao-calteam', el => { AO.calTeam = el.dataset.t; paintCal(); });
  onAct('ao-calnav', el => {
    const p = AO.cal.split('-').map(Number), n = new Date(p[0], p[1] - 1 + Number(el.dataset.n), 1);
    AO.cal = n.getFullYear() + '-' + pad2(n.getMonth() + 1);
    // Select today if it is in this month, else the 1st
    AO.calDay = todayIso().slice(0, 7) === AO.cal ? todayIso() : AO.cal + '-01';
    AO.calOrders = [];
    loadCal();
  });
  onAct('ao-caltoday', () => { AO.calDay = todayIso(); AO.cal = AO.calDay.slice(0, 7); AO.calOrders = []; loadCal(); });
  onAct('ao-calreload', () => loadCal());

  registerScreen('admin', 'cal', () => loadCal());

  /* ======================================================================
     B6b  TEAM ROUTES: where every team is today
     - One line per team says what it is doing NOW, worked out from what the
       drivers tapped (reached, done, "I have left", running late).
       There is no GPS tracking: this is only what the drivers report.
     - Jobs without a team get a suggested team and a one-tap "Assign".
     - A small route map draws each team's stops in time order.
     Data: ONE order.list for today (saved copy shown first), plus the setup
     tabs already loaded at login. No extra server trips per row.
     ====================================================================== */
  async function loadRoutes() {
    const my = ++AO.seq.teams, t = todayIso();
    AO.routesLoading = true; AO.routesErr = false;
    paintRoutes();
    try {
      await apiCached('order.list', { from: t, to: t }, r => {
        if (my !== AO.seq.teams) return;
        AO.routes = (r.orders || []).filter(o => o.status !== 'moved' && !isSurvey(o));   // a survey has no team route
        paintRoutes();
      });
      if (my !== AO.seq.teams) return;
      AO.routesLoading = false;
      paintRoutes();
    } catch (e) {
      if (my !== AO.seq.teams) return;
      AO.routesLoading = false; AO.routesErr = true;
      paintRoutes(); fail(e);
    }
  }

  // How many minutes late before we call a team "late" (Settings tab, default 10)
  const lateLimit = () => Number(settings().late_alert_min) || 10;

  /* Is this stop running late? There is no GPS, so we only know two things:
       said    = minutes late the DRIVER reported ("I'll be late" button): a fact
       overdue = minutes past the due time by the clock, with no "reached" tap yet:
                 only a guess (the driver may simply have forgotten to tap)
     due = the booked time, or the arrival time sent to the customer if later. */
  function lateInfo(o) {
    const none = { said: 0, overdue: 0, due: null };
    if (o.status === 'done' || o.status === 'reached' || !o.team) return none;   // no team = nobody to reach it yet
    const sched = mins(o.sched_time);
    if (sched == null) return none;
    const said = o.status === 'delayed' ? Number(o.delay_min) || 0 : 0;
    const due = Math.max(sched, mins(o.eta_sent) || 0);
    const overdue = nowMin() - due > lateLimit() ? nowMin() - due : 0;
    return { said: said, overdue: overdue, due: due };
  }
  // Minutes late from either source (0 = on time); used for highlighting
  function lateBy(o) { const l = lateInfo(o); return Math.max(l.said, l.overdue); }

  /* The one-line live status for a team, from its jobs today (sorted by time).
     Returns { cls: 'ok' | 'warn' | 'idle', text, cur } where cur is the stop to
     highlight (the one they are at, or the next one). */
  function liveStatus(os) {
    if (!os.length) return { cls: 'idle', text: 'No jobs today' };
    const at = os.find(o => o.status === 'reached');
    if (at) return { cls: 'ok', text: 'At ' + at.client_name + (at.reached_at ? ' since ' + fm(mins(at.reached_at)) : ''), cur: at };
    const next = os.find(o => !doneToday(o));
    if (!next) return { cls: 'ok', text: 'All jobs done ✓' };
    const anyDone = os.some(doneToday);
    const eta = mins(next.eta_sent), li = lateInfo(next);
    // Driver reported a delay: say it as a fact
    if (li.said > 0) return { cls: 'warn', text: 'Running ' + dur(li.said) + ' late for ' + next.client_name + ' (driver reported)', cur: next };
    // Only the clock says so: say what we actually know, so the owner calls to check
    if (li.overdue > 0) return { cls: 'warn', text: 'Not reached ' + next.client_name + ' yet · due ' + fm(li.due) + ' · call to check', cur: next };
    if (eta != null && anyDone) return { cls: 'ok', text: 'On the way to ' + next.client_name + ', expected ~' + fm(eta), cur: next };
    if (!anyDone) return { cls: 'idle', text: 'Not started yet · first stop ' + fm(mins(next.sched_time)), cur: next };
    return { cls: 'idle', text: 'Next: ' + next.client_name + ' at ' + fm(mins(next.sched_time)), cur: next };
  }

  // The Dashboard's "Teams today" card uses the same live line, so both screens agree.
  // App.teamLiveStatus(orders of one team today) -> { cls, text }
  App.teamLiveStatus = os => liveStatus(os.slice().sort(byDateTime));

  // Pills on a stop: only the ones that add information (no "Assigned" on every row)
  function stopPills(o) {
    let h = '';
    if (o.status === 'reached') h += ' <span class="pill ok">Reached' + (o.reached_at ? ' ' + fm(mins(o.reached_at)) : '') + '</span>';
    if (o.status === 'done') h += ' <span class="pill ok">Done ✓</span>';
    const nd = o.not_done || [];
    if (o.status === 'done' && nd.length) h += ' <span class="pill bad" title="Not done: ' + esc(nd.map(svcName).join(', ')) + '">' + nd.length + ' not done</span>';
    const li = lateInfo(o);
    if (li.said > 0) h += ' <span class="pill warn" title="The driver reported this delay">Late · ' + esc(dur(li.said)) + '</span>';
    else if (li.overdue > 0) h += ' <span class="pill" title="Based on the clock only: the driver has not tapped Reached yet">Not reached yet</span>';
    if (o.moved_from) h += ' <span class="pill warn" title="Moved from ' + esc(lab(o.moved_from)) + '">Moved</span>';
    if (o.status === 'ongoing') h += ' <span class="pill ' + (doneToday(o) ? 'ok' : 'info') + '">' + (doneToday(o) ? 'Day done ✓' : 'In progress') + '</span>';
    return h + hourPills(o) + kindPills(o, todayIso());
  }

  // Phone number as digits with 91 in front (for tel: and wa.me links); '' if missing
  function dialNo(p) {
    const d = String(p || '').replace(/\D/g, '');
    if (d.length === 10) return '91' + d;
    return d.length >= 11 ? d : '';
  }
  // A small chat-bubble icon for the WhatsApp link (line drawing, like WA.icons)
  const WA_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 11.6a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.5-4.3A8.5 8.5 0 1 1 20.5 11.6z"/></svg>';

  // One team card: name, Call / WhatsApp, live status, stops, progress
  function teamCard(t, os) {
    const dn = os.filter(doneToday).length;
    const st = liveStatus(os);
    const ph = dialNo(t.driver_phone), who = t.driver_name || ('Team ' + t.team);
    let h = '<div class="tcard ao-tc" style="--tc:' + tc(t.team) + '">' +
      '<div class="ao-th"><div class="ao-tn"><span class="tchip"><i class="tdot"></i>' + esc(teamLabel(t.team)) + '</span>' +
      (t.workers ? '<span class="sub">Driver + ' + esc(t.workers) + ' workers</span>' : '') + '</div>' +
      (ph ? '<div class="ao-ph"><a class="btn sm ao-ib" href="tel:+' + ph + '" aria-label="Call ' + esc(who) + '" title="Call ' + esc(who) + '">' + WA.icons.call + '<span>Call</span></a>' +
        '<a class="btn sm ao-ib" href="https://wa.me/' + ph + '" target="_blank" rel="noopener" aria-label="WhatsApp ' + esc(who) + '" title="WhatsApp ' + esc(who) + '">' + WA_ICON + '</a></div>' : '') +
      '</div>' +
      '<div class="ao-live ' + st.cls + '"><i></i><span>' + esc(st.text) + '</span></div>';
    if (os.length) {
      h += '<ol class="ao-stops">';
      os.forEach((o, i) => {
        if (i > 0) h += '<li class="ao-leg" aria-hidden="true">about ' + travelMin(os[i - 1].area, o.area) + ' min drive</li>';
        const done = doneToday(o), cur = st.cur === o;
        const eta = !done && o.status !== 'reached' && o.eta_sent ? ' · expected ~' + fm(mins(o.eta_sent)) : '';
        h += '<li class="ao-stop' + (done ? ' done' : '') + (cur ? ' cur' : '') + '">' +
          '<i class="ao-n">' + (done ? '✓' : i + 1) + '</i>' +
          '<div class="ao-sb"><div><b class="ao-tm">' + fm(mins(o.sched_time)) + '</b> ' + clientLink(o) +
          // Call the customer from the stop (usability round 2026-10-08)
          (dialNo(o.phone) ? ' <a class="ao-scall" href="tel:+' + dialNo(o.phone) + '" aria-label="Call ' + esc(o.client_name) + '" title="Call ' + esc(o.client_name) + ', ' +
            esc(phoneText(o.phone)) + '">' + WA.icons.call + '<span>' + esc(phoneText(o.phone)) + '</span></a>' : '') + '</div>' +
          '<div class="sub">' + esc(areaName(o.area)) + eta + stopPills(o) + '</div></div></li>';
      });
      h += '</ol>';
      // Progress: text always; the bar only once at least one job is done (an empty bar looks broken)
      h += '<div class="ao-prog"><span class="sub">' + dn + ' of ' + os.length + ' done</span>' +
        (dn ? '<div class="prog"><i style="width:' + (dn / os.length * 100) + '%"></i></div>' : '') + '</div>';
    }
    return h + '</div>';
  }

  /* ---------- the compact route map ----------
     Only the areas with stops today, fitted with some space around them so
     nothing is cut off. Each team's stops are joined by a line in its colour,
     in time order. Dots are numbered with the stop number (faded = done).
     Area x, y in the Areas tab are km; K = screen units per km. */
  function routeStrip(list) {
    const placed = k => { const a = areaOf(k); return a && isFinite(a.x) && isFinite(a.y); };
    // Stops per area: each area shows a small row of dots, one per stop
    const slots = {};
    list.forEach(r => r.os.forEach((o, i) => {
      if (placed(o.area)) (slots[o.area] = slots[o.area] || []).push({ team: r.t.team, n: i + 1, o: o });
    }));
    const keys = Object.keys(slots);
    if (!keys.length) return '';

    // Fit the view to these areas
    const A = keys.map(areaOf);
    const minX = Math.min.apply(null, A.map(a => a.x)), maxX = Math.max.apply(null, A.map(a => a.x));
    const minY = Math.min.apply(null, A.map(a => a.y)), maxY = Math.max.apply(null, A.map(a => a.y));
    const spanX = Math.max(maxX - minX, 1), spanY = Math.max(maxY - minY, 1);
    const K = Math.min(190 / spanY, 720 / spanX, 60);            // the drawing stays under about 260 units tall
    const padX = 64, padT = 22, padB = 36;                          // room for dot rows and area names
    const W = Math.round(spanX * K + padX * 2), H = Math.round(spanY * K + padT + padB);
    const px = a => padX + (a.x - minX) * K, py = a => padT + (a.y - minY) * K;

    // Where each stop's dot goes: side by side around its area point
    const pos = new Map();
    keys.forEach(k => {
      const a = areaOf(k), L = slots[k].sort((p, q) => p.team < q.team ? -1 : p.team > q.team ? 1 : p.n - q.n);
      L.forEach((s, j) => pos.set(s.o, { x: px(a) + (j - (L.length - 1) / 2) * 19, y: py(a) }));
    });

    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Today\'s team routes on a schematic map of the areas">' +
      '<rect width="' + W + '" height="' + H + '" fill="var(--map-bg)"/>';
    // Areas without stops today: tiny grey dots (only those inside the view)
    areas().forEach(a => {
      if (slots[a.key] || !isFinite(a.x) || !isFinite(a.y)) return;
      const x = px(a), y = py(a);
      if (x > 6 && x < W - 6 && y > 6 && y < H - 6) s += '<circle cx="' + x + '" cy="' + y + '" r="2.5" fill="var(--muted)" opacity=".45"><title>' + esc(a.name_en) + ': no jobs today</title></circle>';
    });
    // Route lines, one per team, in time order
    list.forEach(r => {
      const pts = r.os.filter(o => pos.has(o)).map(o => pos.get(o));
      if (pts.length > 1) s += '<path d="M' + pts.map(p => p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join('L') + '" fill="none" stroke="' + tc(r.t.team) +
        '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>';
    });
    // Area names, small, under the dots
    keys.forEach(k => { const a = areaOf(k); s += '<text class="svgt ao-mt" x="' + px(a) + '" y="' + (py(a) + 24) + '" text-anchor="middle">' + esc(a.name_en) + '</text>'; });
    // Numbered dots on top
    list.forEach(r => r.os.forEach((o, i) => {
      const p = pos.get(o);
      if (!p) return;
      const done = o.status === 'done';
      s += '<g' + (done ? ' opacity=".45"' : '') + '><title>Team ' + esc(r.t.team) + ', stop ' + (i + 1) + ': ' + esc(o.client_name) + ', ' + fm(mins(o.sched_time)) + (done ? ' (done)' : '') + '</title>' +
        '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y + '" r="9" fill="' + tc(r.t.team) + '" stroke="var(--surface)" stroke-width="2"/>' +
        '<text x="' + p.x.toFixed(1) + '" y="' + p.y + '" class="ao-dn" text-anchor="middle" dominant-baseline="central">' + (i + 1) + '</text></g>';
    }));
    s += '</svg>';

    // Legend: each team's path in words ("Adajan → Piplod")
    const leg = list.map(r => {
      const path = [];
      r.os.forEach(o => { const n = areaName(o.area); if (path[path.length - 1] !== n) path.push(n); });
      return '<li style="--tc:' + tc(r.t.team) + '"><i class="ao-sw"></i><b>Team ' + esc(r.t.team) + '</b> <span class="sub">' + esc(path.join(' → ')) + '</span></li>';
    }).join('');
    return '<div class="card ao-strip"><div class="ao-map">' + s + '</div><div class="ao-key"><h3>Today\'s routes</h3><ul>' + leg + '</ul>' +
      '<p class="sub">Numbers are the stop order. Faded dots are done. Schematic map, not live tracking.</p></div></div>';
  }

  function paintRoutes() {
    if (!isOpen('teams')) return;
    const el = $('#ad-teams');
    const head = '<header><div><h2>Team routes</h2><p class="sub">Where every team is today, ' + lab(todayIso()) + '.' +
      (AO.routesLoading && AO.routes !== null ? ' ' + updNote() : '') + '</p></div>' +
      '<button class="btn sm" data-act="ao-routes-reload">Refresh</button></header>';

    if (AO.routes === null) {
      el.innerHTML = head + '<div class="empty">' + (AO.routesErr
        ? 'Could not load today\'s jobs. <button class="lnk" data-act="ao-routes-reload">Try again</button>' : 'Loading today\'s jobs…') + '</div>';
      return;
    }

    const all = AO.routes;
    const list = activeTeams().map(t => ({ t: t, os: all.filter(o => o.team === t.team).sort(byDateTime) }));
    const cards = list.map(r => teamCard(r.t, r.os)).join('');

    /* Jobs with no team yet: a small card, one row per job in three columns
       (client and time | suggested team and why | Assign), so everything lines up.
       The team is suggested with the same rule as Orders and assign. */
    const un = all.filter(o => !o.team).sort(byDateTime);
    let unBox = '';
    if (un.length) {
      unBox = '<div class="card ao-un"><div class="ao-unh"><i class="ao-und" aria-hidden="true"></i><b>' + un.length + ' job' + (un.length === 1 ? ' needs' : 's need') +
        ' a team</b><button class="lnk ao-unl" data-act="ao-goto-un">' + word('Open Orders') + '</button></div>' +
        un.map(o => {
          const sg = suggestLocal(o, all);
          return '<div class="ao-unr"><div class="ao-u1"><b>' + esc(o.client_name) + '</b><div class="sub">' + fm(mins(o.sched_time)) + ' · ' + esc(areaName(o.area)) + '</div></div>' +
            '<div class="ao-u2">' + (sg ? '<span class="tchip" style="--tc:' + tc(sg.team) + '"><i class="tdot"></i>' + esc(teamShort(sg.team)) + '</span><div class="sub">' + esc(sg.why) + '</div>'
              : '<span class="sub">No team to suggest</span>') + '</div>' +
            '<div class="ao-u3">' + (sg ? '<button class="btn sm pri" data-act="ao-r-assign" data-id="' + esc(o.order_id) + '" data-t="' + esc(sg.team) + '">Assign Team ' + esc(sg.team) + '</button>' : '') + '</div></div>';
        }).join('') + '</div>';
    }

    el.innerHTML = head + unBox +
      '<div class="teams ao-teams">' + (cards || '<div class="empty">No active teams in the Teams tab.</div>') + '</div>' +
      routeStrip(list.filter(r => r.os.length));
  }

  onAct('ao-routes-reload', () => loadRoutes());
  // One-tap Assign from the banner, then load the routes again
  onAct('ao-r-assign', async btn => {
    const id = Number(btn.dataset.id), team = btn.dataset.t;
    btn.disabled = true; btn.textContent = 'Assigning…';
    try {
      await api('order.assign', { order_id: id, team: team });
      dropSaved();
      toast('Order #' + id + ' assigned to Team ' + team + '.');
    } catch (e) { fail(e); }
    loadRoutes();
  });
  onAct('ao-goto-un', () => {
    AO.ord = { when: 'today', un: true, type: '', area: '', svc: '', team: '', group: '' };
    AO.orders = null;
    App.adminTab = 'orders';
    renderAdmin();
  });

  registerScreen('admin', 'teams', () => loadRoutes());
})();
