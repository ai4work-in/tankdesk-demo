/* ==========================================================================
   admin-reports.js: the Reports screen (#ad-reports, English, admin only).
   One month at a time (‹ previous month, next month ›):
     - tiles with the main numbers and the change "vs last month"
     - a bar chart of the money billed each day
     - a short "Problems" list (cancelled, moved, partly done, disputes, late)
     - services, areas, client types, teams, payment modes and the top clients
     - Quotations (surveys, sent, approved, declined, approved value, conversion %)
       and AMC (visits done, new contracts, contract value), added 2026-10-08

   All numbers come from ONE server call, report.month {month:'2026-10'}.
   It counts by the booked date and includes archived orders (OrderHistory),
   so old months still show after the monthly archive has run.

   Uses the shared admin helpers from admin-insights.js (App.ins: loadScreen,
   tile, tchip ...), so this screen loads and looks like the other admin screens.
   Styles are in admin.css (the "Reports" part, class names start with rp-).
   ========================================================================== */

(function () {
  'use strict';

  const I = () => App.ins;            // helpers from admin-insights.js (loaded before this file)
  const S = { month: '', first: '' }; // month on screen ('' = this month), earliest month with orders

  // '2026-10' -> 'October 2026', short: 'Oct'
  const monthName = m => MONF[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4);
  const monthShort = m => MON[Number(m.slice(5, 7)) - 1];
  // '2026-10' and -1 -> '2026-09'
  function monthAdd(m, k) {
    const x = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + k, 1);
    return x.getFullYear() + '-' + pad2(x.getMonth() + 1);
  }
  const thisMonth = () => todayIso().slice(0, 7);
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

  /* "vs last month" line under a tile.
     money: show the change in rupees. lowerIsBetter: for overtime and money due,
     going DOWN is good (green) and going UP is bad (red). */
  function change(cur, prev, prevMonth, opts) {
    opts = opts || {};
    const d = Math.round((Number(cur) || 0) - (Number(prev) || 0));
    const word = 'vs ' + monthShort(prevMonth);
    if (!d) return '<span class="rp-same">same as ' + monthShort(prevMonth) + '</span>';
    const good = opts.lowerIsBetter ? d < 0 : d > 0;
    const amount = opts.money ? inr(Math.abs(d)) : opts.minutes ? dur(Math.abs(d)) : Math.abs(d);
    const pct = prev > 0 ? ' (' + Math.round(Math.abs(d) / prev * 100) + '%)' : '';
    return '<span class="rp-ch ' + (good ? 'up' : 'down') + '">' + (d > 0 ? '▲ ' : '▼ ') + esc(amount) + esc(pct) + '</span> ' + word;
  }

  /* ---------- the by-day bar chart (same style as the week chart on the Dashboard) ---------- */
  // A round top for the chart: 4 grid lines at "nice" steps (500, 1000, 2500, 5000 ...)
  function niceStep(max) {
    const raw = Math.max(max, 1000) / 4, pow = Math.pow(10, Math.floor(Math.log10(raw)));
    return [1, 2, 2.5, 5, 10].map(x => x * pow).find(x => x >= raw);
  }
  const kText = v => v === 0 ? '0' : v >= 1000 ? '₹' + (v / 1000) + 'k' : '₹' + v;

  function dayChart(byDay) {
    const t = todayIso();
    const step = niceStep(Math.max(0, ...byDay.map(x => x.billed))), top = step * 4;
    const n = byDay.length || 30;
    const W = 640, H = 220, pl = 46, pr = 8, pt = 12, pb = 26, pw = W - pl - pr, ph = H - pt - pb, bw = pw / n * 0.62;
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Money billed each day of the month">';
    for (let i = 0; i <= 4; i++) {
      const v = step * i, y = pt + ph - (v / top) * ph;
      s += '<line class="svgl" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y + '" y2="' + y + '"/>' +
        '<text class="svgt" x="' + (pl - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + kText(v) + '</text>';
    }
    byDay.forEach((x, i) => {
      const day = pd(x.date).getDate(), cx = pl + pw / n * i + pw / n / 2, h = (x.billed / top) * ph;
      // A thin grey line on days with nothing billed, so the month's shape is still visible
      s += x.billed > 0
        ? '<rect x="' + (cx - bw / 2) + '" y="' + (pt + ph - h) + '" width="' + bw + '" height="' + h + '" rx="2" fill="var(--accent)"><title>' +
          esc(lab(x.date)) + ': ' + plural(x.jobs, 'job') + ' done, ' + inr(x.billed) + '</title></rect>'
        : '<rect x="' + (cx - bw / 2) + '" y="' + (pt + ph - 2) + '" width="' + bw + '" height="2" fill="var(--line)"><title>' + esc(lab(x.date)) + ': nothing done</title></rect>';
      // Day numbers: 1, 5, 10, 15, 20, 25, 30 (all 31 would be too small on a phone),
      // plus the last day when it is not right next to one of those (28, 29 in February)
      if (day === 1 || day % 5 === 0 || (i === n - 1 && day % 5 >= 3)) {
        s += '<text class="svgt" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle" style="font-weight:' + (x.date === t ? 700 : 400) + '">' + day + '</text>';
      }
    });
    return s + '</svg>';
  }

  /* ---------- horizontal bars (services, areas, client types, payment modes) ----------
     rows: [{label (HTML), value (bar length), right (HTML on the right), color}] */
  function bars(rows, emptyText) {
    if (!rows.length) return '<div class="sub rp-none">' + esc(emptyText) + '</div>';
    const mx = Math.max(1, ...rows.map(r => r.value));
    return '<div class="rp-bars">' + rows.map(r =>
      '<div class="rp-br"><div class="rp-bl">' + r.label + '</div>' +
      '<div class="rp-bt"><i style="width:' + Math.max(2, r.value / mx * 100).toFixed(1) + '%' + (r.color ? ';--bc:' + r.color : '') + '"></i></div>' +
      '<div class="rp-bv num">' + r.right + '</div></div>').join('') + '</div>';
  }
  const card = (title, inner, extra) => '<div class="card rp-card"><div class="ins-h3"><h3>' + title + '</h3>' + (extra || '') + '</div>' + inner + '</div>';

  /* ---------- "Problems": one line per kind, like the alerts feed ---------- */
  function problems(T, P, prevMonth) {
    const ic = I().icon;
    const line = (n, prev, title, what, icon) => {
      const bad = n > 0;
      return '<div class="ins-fi">' + WA.avatar('', { small: true, color: bad ? 'var(--warn)' : 'var(--tN)', icon: icon }) +
        '<div class="mid"><div class="l1"><span class="tx"><b>' + esc(title) + '</b> <span class="sub">' + esc(what) + '</span></span>' +
        '<b class="num rp-pn' + (bad ? ' bad' : '') + '">' + n + '</b></div>' +
        '<div class="l2"><span class="sub">' + esc(monthShort(prevMonth)) + ': ' + prev + '</span></div></div></div>';
    };
    return '<div class="ins-feed rp-feed">' +
      line(T.cancelled, P.cancelled, 'Cancelled', 'orders cancelled', ic.cross) +
      line(T.moved, P.moved, 'Moved', 'jobs moved to another day', ic.cal) +
      line(T.partial, P.partial, 'Partly done', 'a service was not done', ic.half) +
      line(T.disputes, P.disputes, 'Disputes', 'customer said "not right"', ic.alert) +
      line(T.late, P.late, 'Late', 'team reached late', ic.clock) +
      '</div>';
  }

  /* ---------- Quotations and AMC: two small blocks of numbers (with last month) ---------- */
  function kvBlock(rows, prevMonth) {
    return '<dl class="rp-kv">' + rows.map(r => '<dt>' + esc(r[0]) + '</dt><dd><b class="num">' + r[1] + '</b>' +
      (r[2] !== undefined ? ' <span class="sub">' + esc(monthShort(prevMonth)) + ': ' + r[2] + '</span>' : '') + '</dd>').join('') + '</dl>';
  }
  function quoteAmcBlocks(T, P, pm) {
    if (typeof T.surveys !== 'number') return '';   // an older server without these numbers
    const pct = x => x.quotes_sent ? Math.round(x.quotes_approved / x.quotes_sent * 100) + '%' : '–';
    return '<div class="rp-grid rp-grid2 ins-sec">' +
      card('Quotations', kvBlock([
        ['Surveys done', T.surveys, P.surveys], ['Quotations sent', T.quotes_sent, P.quotes_sent],
        ['Approved', T.quotes_approved, P.quotes_approved], ['Declined', T.quotes_declined, P.quotes_declined],
        ['Approved value', inr(T.quote_value_approved), inr(P.quote_value_approved)], ['Conversion', pct(T), pct(P)]
      ], pm), '<span class="sub">by survey date</span>') +
      card('AMC', kvBlock([
        ['AMC visits done', T.amc_visits, P.amc_visits], ['New contracts', T.new_contracts, P.new_contracts],
        ['Contract value', inr(T.contract_value), inr(P.contract_value)]
      ], pm), '<span class="sub">billed per visit</span>') +
      '</div>';
  }

  /* ---------- screen header: title and the month picker ---------- */
  function header(m) {
    const first = S.first;
    const canPrev = !first || m > first, canNext = m < thisMonth();
    return '<header><div><h2>Reports</h2><p class="sub">Monthly analysis by booked date. Older months include archived orders.</p></div>' +
      '<div class="rp-pick" role="group" aria-label="Choose month">' +
      '<button class="btn sm" data-act="rp-m" data-d="-1" aria-label="Previous month"' + (canPrev ? '' : ' disabled') + '>‹</button>' +
      '<b class="rp-mn">' + esc(monthName(m)) + '</b>' +
      '<button class="btn sm" data-act="rp-m" data-d="1" aria-label="Next month"' + (canNext ? '' : ' disabled') + '>›</button>' +
      (m !== thisMonth() ? '<button class="btn sm" data-act="rp-now">This month</button>' : '') +
      '</div></header>';
  }

  /* ---------- the whole screen ---------- */
  function draw(el, r) {
    const rep = r[0], m = rep.month, pm = monthAdd(m, -1), T = rep.totals, P = rep.prev;
    if (rep.first_month) S.first = rep.first_month;
    const h = I();
    const tile = h.tile;

    if (!T.orders && !T.cancelled && !rep.pay_modes.length) {
      el.innerHTML = header(m) + '<div class="empty">No orders booked in ' + esc(monthName(m)) + '.</div>';
      return;
    }

    // Busiest day, for the line under the chart
    const best = rep.by_day.reduce((a, x) => (!a || x.billed > a.billed ? x : a), null);
    // Client type groups (apartment / bungalow / institution) as small chips
    const groups = {};
    rep.by_type.forEach(x => { const g = x.group || x.key || 'other'; groups[g] = (groups[g] || 0) + x.jobs; });
    const groupChips = Object.keys(groups).sort((a, b) => groups[b] - groups[a])
      .map(g => '<span class="pill">' + esc(g.charAt(0).toUpperCase() + g.slice(1)) + ' ' + groups[g] + '</span>').join(' ');

    el.innerHTML = header(m) +

      // Tiles: the main numbers with the change vs last month
      '<div class="tiles rp-tiles">' +
      tile('Jobs done', T.done, 'of ' + plural(T.orders, 'order') + ' · ' + change(T.done, P.done, pm)) +
      tile('Billed', inr(T.billed), change(T.billed, P.billed, pm, { money: true })) +
      tile('Collected', inr(T.collected), change(T.collected, P.collected, pm, { money: true })) +
      tile('Still due', inr(T.due), 'from this month\'s jobs', T.due > 0 ? 'bad' : '') +
      tile('Clients', T.new_clients + T.repeat_clients, T.new_clients + ' new · ' + T.repeat_clients + ' repeat') +
      tile('Overtime', dur(T.overtime_min || 0), change(T.overtime_min, P.overtime_min, pm, { minutes: true, lowerIsBetter: true })) +
      // Log book costs of the month (typed on the Log book screen, admin only)
      (rep.costs ? tile('Vehicle costs', inr(rep.costs.total), 'Advance ' + inr(rep.costs.advance) + ' · Petrol ' + inr(rep.costs.petrol) + ' · Repair ' + inr(rep.costs.repair)) : '') +
      '</div>' +

      // Chart + problems
      '<div class="two"><div class="card"><h3>Billed each day</h3><div class="ins-chart">' + dayChart(rep.by_day) + '</div>' +
      '<div class="chips sub ins-legend"><span><i class="tdot" style="--tc:var(--accent)"></i> Done jobs, by booked date</span>' +
      (best && best.billed > 0 ? '<span>Busiest: ' + esc(lab(best.date)) + ', ' + plural(best.jobs, 'job') + ', ' + inr(best.billed) + '</span>' : '') +
      '<span>Booked ' + inr(T.booked_amount) + ' · ' + plural(T.open, 'job') + ' not done</span></div></div>' +
      '<div class="card ins-flush"><div class="ins-h3"><h3>Problems</h3><span class="sub">vs ' + esc(monthShort(pm)) + '</span></div>' + problems(T, P, pm) + '</div></div>' +

      // Quotations (survey visits) and AMC contracts
      quoteAmcBlocks(T, P, pm) +

      // Services, areas, client types
      '<div class="rp-grid">' +
      card('Services done', bars(rep.by_service.map(x => ({ label: esc(h.svcName(x.key)), value: x.jobs, right: plural(x.jobs, 'job') })), 'No jobs done.')) +
      card('Areas', bars(rep.by_area.map(x => ({ label: esc(h.areaName(x.key === 'other' ? '' : x.key)), value: x.jobs,
        right: x.jobs + ' · <span class="sub">' + inr(x.billed) + '</span>' })), 'No jobs done.')) +
      card('Client types', (groupChips ? '<div class="rp-groups">' + groupChips + '</div>' : '') +
        bars(rep.by_type.map(x => ({ label: esc(h.typeName(x.key)), value: x.jobs, right: x.jobs + ' · <span class="sub">' + inr(x.billed) + '</span>' })), 'No jobs done.')) +
      '</div>' +

      // Teams
      '<div class="ins-h3 ins-bar ins-sec"><h3>Teams</h3><span class="sub">done jobs</span></div>' +
      '<div class="tw"><table class="tbl"><thead><tr><th>Team</th><th>Jobs</th><th>Billed</th><th>Overtime</th><th>Late</th><th>Partly done</th><th>Costs</th></tr></thead><tbody>' +
      (rep.by_team.length ? rep.by_team.map(x => '<tr><td>' + h.tchip(x.team) + (x.driver_name ? ' <span class="sub">' + esc(x.driver_name) + '</span>' : '') + '</td>' +
        '<td class="num"><b>' + x.jobs + '</b></td><td class="num">' + inr(x.billed) + '</td>' +
        '<td class="num">' + (x.overtime_min ? '<span class="pill warn">' + esc(dur(x.overtime_min)) + '</span>' : '<span class="sub">none</span>') + '</td>' +
        '<td class="num">' + (x.late ? '<span class="ins-red">' + x.late + '</span>' : '0') + '</td>' +
        '<td class="num">' + (x.partial ? '<span class="ins-red">' + x.partial + '</span>' : '0') + '</td>' +
        '<td class="num">' + (Number(x.costs) ? inr(x.costs) : '<span class="sub">-</span>') + '</td></tr>').join('')
        : '<tr><td colspan="7"><div class="empty">No teams.</div></td></tr>') + '</tbody></table></div>' +

      // Payment modes + top clients
      '<div class="rp-grid ins-sec">' +
      card('Payments received', bars(rep.pay_modes.map(x => ({ label: esc((MODE[x.mode] || { en: x.mode }).en), value: x.amount,
        right: inr(x.amount) + ' · <span class="sub">' + x.count + '</span>' })), 'No payments received this month.'),
        '<span class="sub">' + inr(T.collected) + '</span>') +
      '<div class="card ins-flush rp-card"><div class="ins-h3"><h3>Top clients</h3><span class="sub">by billed</span></div>' +
      (rep.top_clients.length ? '<div class="wa-list">' + rep.top_clients.map(c => WA.row({
        name: c.client_name, time: inr(c.billed), act: 'open-client', data: { phone: c.phone },
        preview: plural(c.jobs, 'job') + ' done · ' + esc(phoneText(c.phone))
      })).join('') + '</div>' : '<div class="empty ins-m">No jobs done this month.</div>') + '</div>' +
      '</div>';
  }

  function renderReports(el) {
    const m = S.month || thisMonth();
    const calls = [['report.month', { month: m }]];
    // A month not seen before: show its name and "Loading…" at once (not the old month's numbers)
    if (!cacheGet(cacheKey('screen.reports', calls))) el.innerHTML = header(m) + '<div class="empty">Loading…</div>';
    I().loadScreen(el, 'reports', 'Reports', calls, draw);
  }

  // ‹ and ›: one month back or forward (never past this month, never before the first order)
  onAct('rp-m', el => {
    const m = monthAdd(S.month || thisMonth(), Number(el.dataset.d));
    if (m > thisMonth() || (S.first && m < S.first)) return;
    S.month = m === thisMonth() ? '' : m;
    renderAdmin();
  });
  onAct('rp-now', () => { S.month = ''; renderAdmin(); });

  registerScreen('admin', 'reports', renderReports);
})();
