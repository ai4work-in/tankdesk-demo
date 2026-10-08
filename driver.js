/* ==========================================================================
   driver.js: the DRIVER screens (Gujarati) + small shared phone helpers.

   Part 1 (PHONE SHARED) is also used by collector.js, which loads after this
   file: Gujarati dates, Gujarati error messages, the refresh button, the
   automatic refresh every 60 seconds, the "install app" button in the drawer
   and the service worker (offline app files) registration.

   Part 2 (DRIVER) looks like WhatsApp, because every driver knows WhatsApp:
     today ("આજના કામ")     a chat list: one row per job of today
     up    ("આવતા કામ")     the same kind of list, grouped by day
     me    ("મારી પ્રોફાઇલ") team, driver name, workers, office hours
   Tapping a job opens it like a chat: the office's job card at the top, then
   one message per thing that happened (reached, late, done...). The buttons
   at the bottom show only what the driver can do next.

   PRIVACY: drivers never see money. The server already removes amount and
   balance from the driver's data, and this file never shows any money field.
   ========================================================================== */

/* ==========================================================================
   PART 1: PHONE SHARED (driver and collector)
   ========================================================================== */

// Gujarati day and month names for dates on the phone screens
const GU_DAYS = ['રવિ', 'સોમ', 'મંગળ', 'બુધ', 'ગુરુ', 'શુક્ર', 'શનિ'];
const GU_MON = ['જાન્યુ', 'ફેબ્રુ', 'માર્ચ', 'એપ્રિલ', 'મે', 'જૂન', 'જુલાઈ', 'ઑગસ્ટ', 'સપ્ટે', 'ઑક્ટો', 'નવે', 'ડિસે'];
// "2026-10-08" -> "ગુરુ 8 ઑક્ટો"
const labGu = s => { const d = pd(s); return GU_DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + GU_MON[d.getMonth()]; };

// Turn an error from api() into a short Gujarati message for a toast
// Errors look like "CODE: message"; only the code before the colon matters.
// guCode(e) -> "BAD_STATUS"
const guCode = e => (e && e.code) || String((e && e.message) || '').split(':')[0].trim();
function guErr(e) {
  const c = String((e && e.message) || '');
  const code = c.split(':')[0].trim();
  if (code === 'NETWORK' || code === 'TIMEOUT') return GU.no_network;
  if (code === 'BAD_STATUS') return 'આ કામની સ્થિતિ બદલાઈ ગઈ છે. યાદી ફરી લોડ કરી.';
  if (code === 'FORBIDDEN') return 'આ કામ તમારી ટીમનું નથી.';
  if (code === 'BAD_INPUT') return c.replace(/^BAD_INPUT:\s*/, '');
  return 'ભૂલ થઈ (' + code + '). ફરી પ્રયત્ન કરો.';
}

// "tel:" link for a phone stored as 91XXXXXXXXXX
const telUrl = p => 'tel:+' + String(p || '').replace(/\D/g, '');

// The small row at the top of a phone page: some text on the left, a refresh button on the right
function topRow(text) {
  return '<div class="ph-top"><div class="sub">' + text + '</div>' +
    '<button class="btn sm" data-act="ph-refresh" aria-label="ફરી લોડ કરો">↻ ફરી લોડ કરો</button></div>';
}

/* ---------- refresh ----------
   Each role file puts its "load the data again" function here:
   Phone.reload.driver = function () {...}. The refresh button and the
   60-second timer call the one for the logged-in role. */
const Phone = { reload: {} };

function phoneReload() {
  const s = App.session;
  if (!s || $('#v-phone').hidden) return;
  const fn = Phone.reload[s.role];
  if (fn) fn();
}
onAct('ph-refresh', () => phoneReload());

// Every 60 seconds, while the page is on screen and no form is open, load fresh data
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (!$('#ph-sheet').hidden || !$('#ph-drawer').hidden) return;   // do not disturb an open form or menu
  phoneReload();
}, 60000);
// When the driver comes back to the app (after a call, after the map), load fresh data
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && $('#ph-sheet').hidden) phoneReload();
});

/* ---------- install the app (PWA) ----------
   The "beforeinstallprompt" listener, installPrompt, isStandalone() and the
   'pwa-install' button action live in app.js (shared with the admin footer).
   Here we show "એપ ઇન્સ્ટોલ કરો" in the phone menu.
   iPhones have no such event, so they get a short how-to instead. */
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/* ---------- extra items in the phone menu (drawer) ----------
   app.js builds the menu. We add our items just above "લૉગઆઉટ":
   - driver: "દિવસ પૂર્ણ કરો" (as in the mockup; asks first if it is too early)
   - everyone: the install button, or the iPhone how-to */
const baseOpenDrawer = openDrawer;
openDrawer = function () {
  baseOpenDrawer();
  const out = $('#ph-drawer [data-act="logout"]');
  if (!out) return;
  let extra = '';
  if (App.session && App.session.role === 'driver') extra += '<button class="dn" data-act="dr-dayend">' + GU.day_end + '</button>';
  if (!isStandalone()) {
    if (installPrompt) extra += '<button class="dn install" data-act="pwa-install">⬇ એપ ઇન્સ્ટોલ કરો</button>';
    else if (isIOS()) extra += '<div class="ios-hint">iPhone પર એપ ઇન્સ્ટોલ કરવા: નીચે શેર બટન (⬆) દબાવો, પછી "Add to Home Screen" પસંદ કરો.</div>';
  }
  out.insertAdjacentHTML('beforebegin', extra);
};

/* ---------- service worker: keeps the app files on the phone ----------
   Registered once here (app.js does not do it). Not used when the page is
   opened straight from a file (file://), only from a web address. */
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.tdSwRegistered) {
  window.tdSwRegistered = true;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker not registered:', e));
  });
}

/* ---------- "new version ready" notice ----------
   sw.js sends {type:'td-update'} when it saved a changed app file or a new
   version took over. We show one small notice with a button that reloads. */
function showUpdateNotice() {
  if (document.getElementById('td-update')) return;   // only once
  const en = document.documentElement.lang === 'en';  // admin screens are in English
  const d = document.createElement('div');
  d.id = 'td-update';
  d.className = 'toast';
  d.setAttribute('role', 'status');
  d.innerHTML = '<span>' + (en ? 'New version ready' : 'નવું વર્ઝન તૈયાર છે') + '</span>' +
    '<button type="button" class="lnk">' + (en ? 'Reload' : 'ફરી ખોલો') + '</button>';
  d.querySelector('button').addEventListener('click', () => location.reload());
  document.body.appendChild(d);
}
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.tdSwListening) {
  window.tdSwListening = true;
  navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'td-update') showUpdateNotice(); });
  try { navigator.serviceWorker.startMessages(); } catch (e) { /* older browsers start them on their own */ }
}


/* ==========================================================================
   PART 2: DRIVER
   ========================================================================== */

const DR = {
  orders: null,     // the team's orders from today on (null = not loaded yet)
  loading: false,
  again: false,     // a reload was asked for while one was running: load once more after it
  error: '',        // shown when loading failed
  busy: false,      // true while the end-of-day request is running (stops double taps)
  syncing: false,   // true while fresh data is being fetched ("updating…" in the header)
  seq: 0,           // counts the loads, so an old answer never wipes a newer action
  pending: {},      // order_id -> an action sent but not confirmed yet (see drSend)
  ticks: {},        // order_id -> list of service keys ticked on the checklist
  crew: {},         // order_id -> worker names tapped under "કોણે કામ કર્યું?" (log book)
                    // (the tanks being typed live in the shared tank editor, TankEd key 'dr:<order_id>')
  finish: {},       // order_id -> true after "આખું કામ પૂર્ણ" on a multi-day job (shows the checklist)
  left: {},         // order_id -> {at, to, eta, late} after "I have left"
  chat: null,       // order_id of the job chat that is open (null = none)
  chatHtml: '',     // what the open chat shows now (to skip redrawing when nothing changed)
  late: null,       // the "I will be late" picker inside the chat: {id, mins, reason}
  sheet: null,      // the open end-of-day sheet: {type:'dayend', items}
  moving: null,     // end-of-day jobs shown as moved before the server confirmed: {items, state, seq}
  undo: null,       // the action waiting in its 5-second "રદ કરો" window (see drHold)
  delayAt: {},      // order_id -> new arrival time ("HH:MM") worked out when "મોડો પડીશ" was sent (to tell a no-WhatsApp customer)
  token: ''         // which login the data belongs to (a new login starts fresh)
};
const DR_REASONS = ['traffic', 'prev', 'vehicle', 'other'];
// Small clock, shown on a message that is still being sent (like an unsent WhatsApp message)
const ICON_CLOCK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2.2 1.4"/></svg>';
const DR_OFFICE = 'ઓફિસ';        // name shown on messages from the office
const DR_CUST = 'ગ્રાહક';         // name shown on the customer's replies

// Small icon for the "end the day" row (a moon)
const DR_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';

/* ---------- lookups in setup (names in Gujarati) ---------- */
const svcGu = k => { const s = (App.setup.services || []).find(x => x.key === k); return s ? s.name_gu : k; };
const typeGu = k => { const t = (App.setup.client_types || []).find(x => x.key === k); return t ? t.name_gu : ''; };
const areaGu = k => { const a = (App.setup.areas || []).find(x => x.key === k); return a ? a.name_gu : GU.other_area; };
// The orders as the driver should see them: the server's data, plus the
// actions that were tapped but are not confirmed yet (so the screen reacts at once)
const drList = () => (DR.orders || []).map(drPatch);
const drOrder = id => drList().find(o => String(o.order_id) === String(id));
const timeOf = o => fm(mins(o.sched_time));
const drSvcs = o => (o.services || []).map(svcGu).join(', ');
// "today" or the Gujarati date
const drDay = d => d === todayIso() ? 'આજે' : labGu(d);

/* ---------- jobs over several days (added 2026-10-08) ----------
   A job can last several days (days 1-10). It shows on every day of its span, and
   an unfinished one keeps showing until it is done (jobOnDate in common.js).
   Each day: "હું પહોંચી ગયો", then either "આજનું કામ પૂર્ણ" (we come back tomorrow,
   status 'ongoing') or, on the last day, "આખું કામ પૂર્ણ" (the normal done step).
   The customer gets a WhatsApp only on the first day's reach and at the very end. */
const DR_OPEN = ['assigned', 'delayed', 'ongoing'];   // the team still has to go there
const drMulti = o => jobDays(o) > 1;
// "દિવસ 2 / 3" for date d (d before the start: "3 દિવસનું કામ")
function drDayLabel(o, d) {
  const n = jobDays(o), k = jobDayNo(o, d || todayIso());
  if (k < 1) return n + ' દિવસનું કામ';
  return k > n ? 'દિવસ ' + k + ' (' + n + ' દિવસનું કામ)' : GU.day_of(k, n);
}
// Today's work on a multi-day job is finished ("આજનું કામ પૂર્ણ" tapped today): nothing more today
const drDoneToday = o => o.status === 'done' || (o.status === 'ongoing' && workDays(o).some(w => w.date === todayIso() && w.left));
// Small chips on a row / in the chat: "દિવસ 2 / 3" and "AMC 2/4" (the AMC label never has money)
const drChips = (o, d) => (drMulti(o) ? '<span class="dr-day">' + esc(drDayLabel(o, d)) + '</span> ' : '') +
  (o.amc_label ? '<span class="dr-amc">' + esc(o.amc_label) + '</span> ' : '');

/* ---------- customers WITHOUT WhatsApp ----------
   The office marks a client "no WhatsApp" (order field whatsapp = 'no'; blank = yes).
   Then the server sends that customer NOTHING. Wherever this screen would say
   "the customer got a WhatsApp", it says "call the customer and tell them" instead,
   with the exact words to say and a big call button. After the work the driver asks
   the customer in person and taps "ગ્રાહક સંમત ✓" / "ગ્રાહક અસંમત ✗" (order.confirm). */
const drNoWa = o => !!o && String(o.whatsapp || '').toLowerCase() === 'no';
// The badge on the job row and in the chat: "WhatsApp નથી · ફોન કરો"
const drNoWaBadge = () => '<span class="dr-nowa">' + esc(GU.no_wa) + '</span>';
// A big green call button for one customer: "ફોન કરો 98250 41041"
const drCallBtn = o => '<a class="dr-call" href="' + esc(telUrl(o.phone)) + '">' + WA.icons.call +
  '<span>' + esc(GU.call) + ' · ' + esc(phoneText(o.phone)) + '</span></a>';
// Office message: "call the customer and tell them: «words»" + call button.
// title is optional (default "ગ્રાહકને ફોન કરીને જણાવો"); words is HTML (escape it yourself).
function drCallBubble(o, words, title) {
  return WA.bubble('in', '<b>' + esc(title || GU.call_tell) + '</b>' +
    (words ? '<div class="dr-say">«' + words + '»</div>' : '') + drCallBtn(o), '', { who: DR_OFFICE, cls: 'dr-callb' });
}
// The words to say, the same as the WhatsApp templates (apps-script/whatsapp.gs)
const drSayDelay = (m, r, time) => 'માફ કરજો, અમારી ટીમ લગભગ ' + m + ' મિનિટ મોડી પહોંચશે. કારણ: ' + esc((REASON[r] || REASON.other).gu) + '.' +
  (time ? ' અમે લગભગ <b>' + fm(mins(time)) + '</b> સુધીમાં પહોંચી જઈશું.' : '');
const drSayEta = time => 'અમે લગભગ <b>' + fm(mins(time)) + '</b> સુધીમાં પહોંચી જઈશું.';
const drSayDone = o => 'કામ પૂર્ણ થયું: ' + esc((o.done_checklist || []).map(svcGu).join(', ') || '-') + '.' +
  ((o.not_done || []).length ? ' બાકી: ' + esc(o.not_done.map(svcGu).join(', ')) + '.' : '') + ' કામ બરાબર થયું?';
// New arrival time after "I will be late" (same rule as the server, orders.gs delayArrival_):
// the later of now and the booked time, plus the minutes, rounded UP to 5 minutes. -> "HH:MM"
function drLateEta(o, m) {
  const now = nowMin(), booked = mins(o.sched_time);
  const base = booked !== null && (o.sched_date > todayIso() || (o.sched_date === todayIso() && booked > now)) ? booked : now;
  return hhmm((Math.ceil((base + m) / 5) * 5) % (24 * 60));
}

/* ---------- load the team's orders ----------
   apiCached draws the copy saved on the phone at once, then asks the server
   and draws again only if something changed. While it asks, the header says
   "updating…" quietly instead of showing a blank screen. */
async function drLoad() {
  if (DR.loading) { DR.again = true; return; }   // one is already running: load again right after it
  DR.loading = true;
  const seq = ++DR.seq;
  const tok = App.session && App.session.token;
  drSync(true);
  try {
    await apiCached('order.list', { from: todayIso() }, (data, fresh) => {
      if (!App.session || App.session.token !== tok) return;   // logged out meanwhile
      DR.orders = data.orders || [];
      DR.token = tok;
      if (fresh) { DR.error = ''; drClearSent(seq); }
      drShow('auto');
    });
    DR.error = '';
    drClearSent(seq);
  } catch (e) {
    DR.loading = false; drSync(false);
    if (guCode(e) === 'AUTH') return;
    DR.error = guErr(e);
    drShow('auto');
    return;
  }
  DR.loading = false;
  if (DR.again) { DR.again = false; return drLoad(); }
  drSync(false);
  drShow('auto');
}

// Draw the list again (and the open chat), if the driver is still on a driver page
function drShow(how) {
  if (!App.session || App.session.role !== 'driver' || $('#v-phone').hidden) return;
  drRedraw();
  if (DR.chat != null && WA.chatOpen()) drShowChat(DR.chat, how || 'auto');
}

// "updating…" after the team name in the blue header while fresh data loads
function drSync(on) {
  DR.syncing = on;
  const sub = $('#ph-head .wa-head .t span');
  if (!sub) return;
  const old = sub.querySelector('.dr-upd');
  if (old) old.remove();
  if (on && App.session && App.session.role === 'driver') sub.insertAdjacentHTML('beforeend', '<i class="dr-upd"> · અપડેટ થાય છે…</i>');
}
Phone.reload.driver = drLoad;

// Draw the open page (the list behind the chat) again, keeping the scroll position
function drRedraw() {
  const el = $('#ph-body'), top = el.scrollTop;
  renderPhone();
  el.scrollTop = top;
  drSync(DR.syncing);   // renderPhone redrew the header: put "updating…" back if needed
}

// Common start of every driver page: loading / error / data
function drReady(el) {
  el.classList.remove('pad');   // lists go edge to edge, like WhatsApp
  // Someone else logged in on this phone: forget the old data and close an old chat
  if (DR.token !== App.session.token) {
    drUndoClear();   // an old login's waiting action is dropped, never sent with the new login
    Object.assign(DR, { orders: null, error: '', ticks: {}, crew: {}, finish: {}, left: {}, pending: {}, chat: null, chatHtml: '', late: null, sheet: null, moving: null, token: App.session.token });
    TankEd.resetAll('dr:');   // tank sizes typed under the old login
    WA.closeChat();
  }
  if (DR.orders) return true;
  if (DR.error) el.innerHTML = '<div class="dr-pad"><div class="box bad">' + esc(DR.error) + '</div><button class="btn lg" data-act="ph-refresh">' + GU.try_again + '</button></div>';
  else { el.innerHTML = '<div class="dr-pad"><div class="empty">' + GU.loading + '</div></div>'; drLoad(); }
  return false;
}

// Today's jobs: unfinished ones by time first, then the finished ones
function drToday() {
  const t = todayIso(), byTime = (a, b) => mins(a.sched_time) - mins(b.sched_time);
  const list = drList().filter(o => jobOnDate(o, t));   // a multi-day job is on every day of its span
  return list.filter(o => !drDoneToday(o)).sort(byTime).concat(list.filter(drDoneToday).sort(byTime));
}
// The small number on the "today" tab = jobs left today
function drCount() {
  if (DR.orders) setTabCount('today', drToday().filter(o => !drDoneToday(o)).length);
}

/* ---------- travel and next job ---------- */
// A number from the Settings tab (null when it is missing)
const drSet = k => { const v = Number((App.setup.settings || {})[k]); return isFinite(v) && (App.setup.settings || {})[k] !== '' ? v : null; };

// Travel minutes between two areas: the same rule as the server (eta.gs), for the
// "next job" preview only. Returns null if a setting is missing (then no minutes are shown).
function drTravel(a, b) {
  const A = (App.setup.areas || []).find(x => x.key === a), B = (App.setup.areas || []).find(x => x.key === b);
  if (!a || !b || !A || !B) return drSet('unknown_area_min');   // an area is missing or unknown
  if (a === b) return drSet('same_area_min');                    // both jobs in the same area
  const perKm = drSet('min_per_km'), buf = drSet('buffer_min');
  if (perKm === null || buf === null) return null;
  return Math.round(Math.hypot(A.x - B.x, A.y - B.y) * perKm) + buf;
}

// The next job after this finished one (only for the latest finished job of today)
function drNextStop(o) {
  const t = todayIso();
  if (!jobOnDate(o, t) || o.status !== 'done') return null;
  const os = drList().filter(x => jobOnDate(x, t));
  // done_at is compared as text ("2026-10-07T11:20:00"), the same way as the server
  if (os.some(x => x.status === 'done' && x.order_id !== o.order_id && String(x.done_at) > String(o.done_at))) return null;
  return os.filter(x => DR_OPEN.includes(x.status) && !drDoneToday(x)).sort((a, b) => mins(a.sched_time) - mins(b.sched_time))[0] || null;
}

/* ---------- the short status line of a job (for the chat list) ----------
   Returns {text, cls}. cls colours it: ok (done), warn (late), bad (problem). */
function drStatus(o) {
  const lateBy = nowMin() - mins(o.sched_time);
  if (o.dispute || o.customer_confirm === 'no') return { text: 'ગ્રાહકે ના કહી', cls: 'bad' };
  if (o.status === 'done' && drNoWa(o) && !o.customer_confirm) return { text: '✓✓ કામ પૂર્ણ · ગ્રાહકને પૂછો', cls: 'warn' };
  if (o.status === 'done') return { text: '✓✓ કામ પૂર્ણ' + ((o.not_done || []).length ? ' · થોડું બાકી' : ''), cls: (o.not_done || []).length ? 'warn' : 'ok' };
  if (o.status === 'reached') return { text: 'પહોંચ્યા · કામ ચાલુ', cls: 'ok' };
  if (o.status === 'ongoing') return drDoneToday(o) ? { text: '✓ ' + GU.day_done + ' · કાલે ફરી', cls: 'ok' } : { text: GU.ongoing + ' · આજે ફરી જવાનું', cls: '' };
  if (o.status === 'delayed' && o.delay_min > 0) return { text: 'મોડું ' + durGu(o.delay_min), cls: 'warn' };
  if (o.sched_date === todayIso() && lateBy > 10) return { text: 'સમય કરતાં ' + durGu(lateBy) + ' મોડા', cls: 'bad' };
  if (o.eta_sent) return { text: 'સમય મોકલ્યો ' + fm(mins(o.eta_sent)), cls: '' };
  if (o.moved_from) return { text: labGu(o.moved_from) + ' થી ખસેડેલું', cls: '' };
  return { text: GU.status[o.status] || o.status, cls: '' };
}

// One chat-list row for a job. next = true for the job to do now.
function drRow(o, next) {
  const s = drStatus(o);
  const bad = s.cls === 'bad' && (o.dispute || o.customer_confirm === 'no');
  return WA.row({
    name: o.client_name,
    time: timeOf(o),
    timeHot: next,
    // status first (it matters most), then area and services
    preview: (drNoWa(o) ? drNoWaBadge() + ' ' : '') + drChips(o, o.sched_date > todayIso() ? o.sched_date : todayIso()) +
      '<span class="dr-st ' + s.cls + '">' + esc(s.text) + '</span> · ' + esc(areaGu(o.area)) + ' · ' + esc(drSvcs(o)),
    badge: bad ? '!' : next ? 'હવે' : '',
    badgeCls: bad ? 'bad' : '',
    current: next,
    act: 'dr-open',
    data: { id: o.order_id },
    avatarColor: WA.colorFor(o.client_name)
  });
}

/* ---------- page: today (chat list) ---------- */
registerScreen('driver', 'today', el => {
  if (!drReady(el)) return;
  const today = drToday();
  const pend = today.filter(o => !drDoneToday(o));
  const nextId = pend.length ? pend[0].order_id : null;   // the job to do now
  setTabCount('today', pend.length);
  const moved = drMoved();
  let h = WA.sec(labGu(todayIso()) + ' · ' + GU.team + ' ' + App.session.team + ' · ' + today.length + ' કામ');
  if (DR.error) h += '<div class="dr-pad"><div class="box bad">' + esc(DR.error) + '</div></div>';
  if (!today.length && !moved.length) h += '<div class="dr-pad"><div class="empty">આજે કોઈ કામ નથી.</div></div>';
  // Nothing left for today (all done or moved): the honest count of the day, on top
  if (!pend.length && (today.length || moved.length)) h += drSummaryHtml();
  h += '<div class="wa-list">' + today.map(o => drRow(o, o.order_id === nextId)).join('') + '</div>';
  // Jobs moved away from today stay visible, with their new date
  if (moved.length) h += WA.sec('ખસેડેલા') + '<div class="wa-list dr-moved">' + moved.map(drMovedRow).join('') + '</div>';
  // Very last: end the day (moves unfinished jobs to another date). Never at the top.
  if (pend.length) {
    h += '<div class="wa-list dr-endrow">' + WA.row({ name: GU.day_end, preview: esc(pend.length + ' કામ બાકી · નવી તારીખ નક્કી કરો'), act: 'dr-dayend',
      avatarIcon: DR_MOON, avatarColor: 'var(--muted)' }) + '</div>';
  }
  el.innerHTML = h;
});

/* ---------- moved jobs and the honest day summary ---------- */
// Jobs that were booked for today but moved to a later date
function drMoved() {
  const t = todayIso();
  return drList().filter(o => o.moved_from === t && o.sched_date > t)
    .sort((a, b) => a.sched_date === b.sched_date ? mins(a.sched_time) - mins(b.sched_time) : (a.sched_date < b.sched_date ? -1 : 1));
}
// One row in the "ખસેડેલા" (moved) section: new date first
function drMovedRow(o) {
  return WA.row({
    name: o.client_name,
    time: timeOf(o),
    preview: (drNoWa(o) ? drNoWaBadge() + ' ' : '') + '<span class="dr-st warn">→ ' + esc(labGu(o.sched_date)) + '</span>' +
      (o.delay_reason && REASON[o.delay_reason] ? ' · ' + esc(REASON[o.delay_reason].gu) : ''),
    act: 'dr-open', data: { id: o.order_id }, avatarColor: WA.colorFor(o.client_name)
  });
}
// The truth about today: "આજે: 2 પૂર્ણ · 1 થોડું બાકી · 1 ખસેડ્યું".
// "શાબાશ!" only when every job was fully done (nothing partial, nothing moved).
function drSummaryHtml() {
  const t = todayIso(), today = drList().filter(o => jobOnDate(o, t) && drDoneToday(o));
  const part = today.filter(o => (o.not_done || []).length).length;
  const full = today.length - part, moved = drMoved().length;
  const bits = [];
  if (full) bits.push(full + ' પૂર્ણ');
  if (part) bits.push(part + ' થોડું બાકી');
  if (moved) bits.push(moved + ' ખસેડ્યું');
  const great = full > 0 && !part && !moved;
  return '<div class="dr-sum ' + (great ? 'ok' : 'warn') + '" role="status"><b>આજે: ' + esc(bits.join(' · ')) + '</b>' +
    (great ? '<span>શાબાશ!</span>' : '') + '</div>';
}

/* ---------- page: upcoming (chat list grouped by day) ---------- */
registerScreen('driver', 'up', el => {
  if (!drReady(el)) return;
  drCount();
  const t = todayIso();
  const up = drList().filter(o => o.sched_date > t && o.status !== 'done')
    .sort((a, b) => a.sched_date === b.sched_date ? mins(a.sched_time) - mins(b.sched_time) : (a.sched_date < b.sched_date ? -1 : 1));
  if (!up.length) { el.innerHTML = '<div class="dr-pad"><div class="empty">હજી કોઈ કામ સોંપાયું નથી.</div></div>'; return; }
  let h = '', lastDate = '';
  up.forEach(o => {
    if (o.sched_date !== lastDate) {
      if (lastDate) h += '</div>';
      lastDate = o.sched_date;
      h += WA.sec(labGu(o.sched_date)) + '<div class="wa-list">';
    }
    h += drRow(o, false);
  });
  el.innerHTML = h + '</div>';
});

/* ---------- page: profile (a simple padded page) ---------- */
registerScreen('driver', 'me', el => {
  el.classList.add('pad');
  drCount();
  const tm = (App.setup.teams || []).find(x => x.team === App.session.team) || {};
  const st = App.setup.settings || {};
  const w = Number(tm.workers) || 0;
  const name = tm.driver_name || App.session.name;
  el.innerHTML = '<div class="dr-me">' + WA.avatar(App.session.team, { color: teamColor(App.session.team, (App.setup.teams || []).map(x => x.team)) }) +
    '<div><b>' + GU.team + ' ' + esc(App.session.team) + '</b><span>' + esc(GU.driver) + ': ' + esc(name) + '</span></div></div>' +
    '<dl class="dr-kv">' +
    '<dt>' + esc(GU.driver) + '</dt><dd>' + esc(name) + '</dd>' +
    (w ? '<dt>કારીગર</dt><dd>સાથે ' + w + ' કારીગર</dd>' : '') +
    (st.office_start && st.office_end ? '<dt>ઓફિસ સમય</dt><dd>' + fm(mins(st.office_start)) + ' થી ' + fm(mins(st.office_end)) + '</dd>' : '') +
    '</dl>' +
    (st.office_start && st.office_end ? '<div class="box warn">ઓફિસ સમય પછીનો સમય ઓવરટાઇમ ગણાશે.</div>' : '');
});

/* ==========================================================================
   THE JOB CHAT
   Built fresh from the order every time, oldest message first.
   ========================================================================== */

// The office's job card (the first message)
function drCardBubble(o) {
  const kv = (k, v) => v ? '<dt>' + k + '</dt><dd>' + v + '</dd>' : '';
  const html = '<b>' + esc(o.client_name) + '</b>' +
    '<ul class="dr-svc">' + (o.services || []).map(k => '<li>' + esc(svcGu(k)) + '</li>').join('') + '</ul>' +
    '<dl class="kv">' +
    kv('સમય', esc(drDay(o.sched_date) + ' · ' + timeOf(o))) +
    (drMulti(o) ? kv('દિવસ', esc(jobDays(o) + ' દિવસનું કામ · ' + labGu(o.sched_date) + ' થી ' + labGu(jobEnd(o)))) : '') +
    (o.amc_label ? kv('પ્રકાર', '<span class="dr-amc">' + esc(o.amc_label) + '</span> વાર્ષિક કરાર (AMC)') : '') +
    kv('સરનામું', esc(o.address)) +
    kv('વિસ્તાર', esc(areaGu(o.area))) +
    kv('પ્રકાર', esc(typeGu(o.client_type))) +
    kv('ફોન', '<a href="' + telUrl(o.phone) + '">' + esc(phoneText(o.phone)) + '</a>') +
    '</dl>';
  let h = WA.bubble('in', html, '', { who: DR_OFFICE });
  // No WhatsApp: say so at the top of the chat, with the call button
  if (drNoWa(o)) {
    h += WA.bubble('in', drNoWaBadge() + '<div class="dr-nowa-t">આ ગ્રાહકને WhatsApp મેસેજ જતા નથી. દરેક વાત ફોન કરીને જણાવો.</div>' + drCallBtn(o),
      '', { who: DR_OFFICE, cls: 'dr-callb' });
  }
  if (o.notes) h += WA.bubble('in', '<b>નોંધ:</b> ' + esc(o.notes), '', { who: DR_OFFICE, cls: 'warn' });
  if (o.moved_from) h += WA.sys(labGu(o.moved_from) + ' થી ખસેડેલું કામ' + (o.delay_reason && REASON[o.delay_reason] ? ' · ' + REASON[o.delay_reason].gu : ''));
  return h;
}

// The customer's reply (yes / no / waiting), shown after the last event
function drReply(o) {
  if (o.dispute || o.customer_confirm === 'no') {
    return WA.bubble('in', 'ગ્રાહકનો જવાબ: <b>ના</b><br>ગ્રાહકે ના કહી. માલિકને જાણ કરી છે.', '', { who: DR_CUST, cls: 'bad' });
  }
  if (o.customer_confirm === 'yes') return WA.bubble('in', 'ગ્રાહકનો જવાબ: <b>હા</b> ✓', '', { who: DR_CUST });
  return WA.sys('ગ્રાહકનો જવાબ બાકી');
}

// The "I will be late" picker: minutes and reason chips, then a send button.
// NOTHING is chosen at the start, so one hurried tap can never send a wrong message.
// The send button stays off until both minutes and reason are chosen.
function drLateBubble(o) {
  const L = DR.late;
  const chip = (k, v, label, on) => '<button aria-pressed="' + on + '" data-act="dr-late-pick" data-k="' + k + '" data-v="' + v + '">' + esc(label) + '</button>';
  const ready = !!(L.mins && L.reason);
  // Preview: the same words as the "delay" WhatsApp template (apps-script/whatsapp.gs).
  // New arrival time, same rule as the server (drLateEta).
  // No WhatsApp: nothing is sent, so the words are what the driver says on the phone.
  const noWa = drNoWa(o);
  let prev = '<div class="dr-prev muted">મિનિટ અને કારણ બંને પસંદ કરો.</div>';
  if (L.mins) {
    const etaLine = 'અમે લગભગ ' + fm(mins(drLateEta(o, L.mins))) + ' સુધીમાં પહોંચી જઈશું.';
    prev = '<div class="dr-prev"><span class="dr-lbl">' + (noWa ? 'ગ્રાહકને ફોન કરીને આ કહો:' : 'ગ્રાહકને આ મેસેજ જશે:') + '</span>' +
      (L.reason
        ? '«માફ કરજો, અમારી ટીમ લગભગ ' + L.mins + ' મિનિટ મોડી પહોંચશે. કારણ: ' + esc(REASON[L.reason].gu) + '. <b>' + etaLine + '</b>»'
        : '<b class="dr-eta">' + etaLine + '</b><span class="muted">હવે કારણ પસંદ કરો.</span>') + '</div>';
  }
  return WA.bubble('in',
    '<b>મોડા છો? ગ્રાહકને જણાવો</b>' + (noWa ? '<div>' + drNoWaBadge() + '</div>' : '') +
    '<span class="dr-lbl">કેટલી મિનિટ મોડા?</span><div class="wa-chips">' +
    [15, 30, 45, 60].map(m => chip('mins', m, m + ' ' + GU.minutes, L.mins === m)).join('') + '</div>' +
    '<span class="dr-lbl">કારણ</span><div class="wa-chips">' +
    DR_REASONS.map(r => chip('reason', r, REASON[r].gu, L.reason === r)).join('') + '</div>' +
    prev +
    '<button class="dr-send" data-act="dr-delay-send" data-id="' + o.order_id + '"' + (ready ? '' : ' disabled') + '>' + WA.icons.send +
    '<span>' + (noWa ? 'મોડાની નોંધ કરો' : 'ગ્રાહકને WhatsApp મોકલો') + '</span></button>' +
    (noWa ? drCallBtn(o) : ''),
    '', { who: DR_OFFICE, cls: 'dr-late' });
}

/* ---------- no WhatsApp: the customer's answer, asked in person ----------
   After the work the driver shows the customer what was done and asks.
   Two buttons inside the message; the answer goes to the server (order.confirm).
   "ના" = a dispute and an alert to the owner, the same as a "No" on WhatsApp. */
function drConfirmPart(o) {
  const p = DR.pending[o.order_id];
  // An answer tapped, still in its undo window or on its way: show it with a clock
  if (p && p.kind === 'confirm' && drBusyState(p)) {
    return drOut(o, 'confirm', p.params.answer === 'yes' ? GU.cust_yes : GU.cust_no, fm(p.at), p.params.answer === 'yes' ? '' : 'bad');
  }
  if (o.customer_confirm === 'yes') return WA.bubble('out', '<b>' + GU.cust_yes + '</b><br><span class="sub">ગ્રાહકે રૂબરૂ હા કહી</span>', '', { ticks: 2 });
  if (o.customer_confirm === 'no' || o.dispute) {
    return WA.bubble('out', '<b>' + GU.cust_no + '</b>', '', { ticks: 2, cls: 'bad' }) +
      WA.bubble('in', 'ગ્રાહકે ના કહી. માલિકને જાણ કરી છે.', '', { who: DR_OFFICE, cls: 'bad' });
  }
  const off = drSending(o.order_id) ? ' disabled' : '';
  return WA.bubble('in', '<b>ગ્રાહકને કામ બતાવો અને પૂછો</b>' +
    '<div class="dr-say">«' + drSayDone(o) + '»</div>' +
    '<span class="dr-lbl">ગ્રાહકનો જવાબ:</span>' +
    '<div class="dr-cf">' +
    '<button class="dr-cf-yes" data-act="dr-confirm" data-id="' + o.order_id + '" data-v="yes"' + off + '>' + GU.cust_yes + '</button>' +
    '<button class="dr-cf-no" data-act="dr-confirm" data-id="' + o.order_id + '" data-v="no"' + off + '>' + GU.cust_no + '</button></div>' +
    '<div class="sub">ગ્રાહક ત્યાં ન હોય તો ફોન કરીને પૂછો.</div>' + drCallBtn(o),
    '', { who: DR_OFFICE, cls: 'dr-callb' });
}

// The service checklist after reaching: tap a service to tick it
function drCheckBubble(o) {
  // A task without a checklist (possible when the "orders" add-on is off): nothing to tick
  if (!(o.services || []).length) return '';
  const ticks = DR.ticks[o.order_id] || [];
  const not = (o.services || []).filter(k => !ticks.includes(k));
  return WA.bubble('in',
    '<b>કયા કયા કામ થયા? ટિક કરો</b>' +
    '<div class="dr-cks">' + (o.services || []).map(k => '<button class="dr-ck" aria-pressed="' + ticks.includes(k) + '" data-act="dr-tick" data-id="' + o.order_id + '" data-k="' + esc(k) + '">' +
      '<i aria-hidden="true">' + WA.icons.tick + '</i><span>' + esc(svcGu(k)) + '</span></button>').join('') + '</div>' +
    (ticks.length && not.length ? '<div class="box warn">બાકી: ' + not.map(k => esc(svcGu(k))).join(', ') + '. માલિકને જાણ કરવામાં આવશે.</div>' : ''),
    '', { who: DR_OFFICE });
}

/* ---------- log book: who did the work, and the tank sizes ----------
   Shown under the checklist while the team is at the site, sent with "કામ પૂર્ણ થયું".
   - "કોણે કામ કર્યું?": one chip per worker of the team (Teams tab worker_names), tap to pick.
   - "ટાંકીનું માપ": the shared tank editor (tank-editor.js), pre-filled from the client's
     last visit (the server copies them onto the new order): position, material
     (સિમેન્ટ / પ્લાસ્ટિક), litres or L × W × H, how many. Nothing about money. */
// The worker names of the driver's own team (setup.get sends only the own team's)
function drWorkers() {
  const t = ((App.setup && App.setup.teams) || []).find(x => x.team === App.session.team);
  return (t && t.worker_names) || [];
}
const drTkKey = id => 'dr:' + id;   // the tank editor of one job
// The bubble with the crew chips and the tank editor
function drLogBubble(o) {
  const id = o.order_id, workers = drWorkers(), crew = DR.crew[id] || [];
  return WA.bubble('in',
    (workers.length ? '<b>કોણે કામ કર્યું?</b>' +
      '<div class="wa-chips dr-crew">' + workers.map(w => '<button type="button" data-act="dr-crew" data-id="' + id + '" data-n="' + esc(w) + '" aria-pressed="' + crew.includes(w) + '">' + esc(w) + '</button>').join('') + '</div>' : '') +
    '<b class="dr-tk-t">ટાંકીનું માપ</b>' +
    ((o.tanks || []).length ? '<div class="sub">છેલ્લી વખતનું માપ ભરેલું છે. બદલાયું હોય તો સુધારો.</div>' : '') +
    TankEd.html(drTkKey(id), o.tanks, { lang: 'gu' }),
    '', { who: DR_OFFICE, cls: 'dr-log' });
}

/* ---------- messages the driver sends (WhatsApp style) ----------
   A tapped action shows at once with a small clock. When the server says OK
   the clock becomes ✓✓. If it fails, the message turns red with "send again". */
const drDelayHtml = (m, r) => '<b>' + m + ' મિનિટ</b> મોડો પડીશ<br>' + esc((REASON[r] || REASON.other).gu);
// crew and tanks (log book) are shown under the services when they were saved
const drDoneHtml = (done, not, crew, tanks) => '<b>કામ પૂર્ણ</b><div class="dr-done">' +
  done.map(k => '<span class="ok">✓ ' + esc(svcGu(k)) + '</span>').join('') +
  not.map(k => '<span class="no">✗ ' + esc(svcGu(k)) + '</span>').join('') + '</div>' +
  ((crew || []).length ? '<div class="dr-crewl"><span class="dr-lbl">કામ કરનાર</span>' + esc(crew.join(', ')) + '</div>' : '') +
  ((tanks || []).length ? '<div class="dr-crewl"><span class="dr-lbl">ટાંકીનું માપ</span>' +
    tanks.map(t => '<span class="dr-tkline">' + esc(tankTextGu(t)) + '</span>').join('') +
    (tanks.length > 1 ? '<span class="dr-tkline"><b>કુલ ' + litresText(tanksTotal(tanks)) + ' લિટર</b></span>' : '') + '</div>' : '');
// true while an action waits in its undo window ('wait') or is on its way ('sending')
const drBusyState = p => !!(p && (p.state === 'wait' || p.state === 'sending'));
const drSending = id => drBusyState(DR.pending[id]);

// One outgoing message: ✓✓ when confirmed, a clock while it waits or is being sent
function drOut(o, kind, html, time, cls) {
  const p = DR.pending[o.order_id];
  const b = WA.bubble('out', html, time, { ticks: 2, cls: cls });
  return (p && p.kind === kind && drBusyState(p))
    ? b.replace(WA.icons.ticks, '<i class="dr-clock" aria-label="મોકલાય છે">' + ICON_CLOCK + '</i>') : b;
}
// The red "not sent" message with a button to send it again
function drFailed(o) {
  const p = DR.pending[o.order_id];
  if (!p || p.state !== 'failed') return '';
  return WA.bubble('out', p.text + '<button class="dr-retry" data-act="dr-retry" data-id="' + o.order_id + '">⚠ મોકલાયું નહીં · ફરી મોકલો</button>',
    fm(p.at), { cls: 'bad dr-fail' });
}

// The order with a not-yet-confirmed action already applied (only while it is being sent or just sent)
function drPatch(o) {
  const p = DR.pending[o.order_id];
  // End of day tapped, not confirmed yet: show the job as already moved
  const mv = DR.moving && DR.moving.items.find(it => String(it.order_id) === String(o.order_id));
  if (mv && o.sched_date === todayIso() && o.status !== 'done') {
    return Object.assign({}, o, { sched_date: mv.new_date, moved_from: todayIso(), status: 'assigned', delay_reason: mv.reason, delay_min: null });
  }
  if (!p || p.state === 'failed' || p.kind === 'leave') return o;
  const x = Object.assign({}, o), at = todayIso() + 'T' + hhmm(p.at) + ':00';
  const open = DR_OPEN.includes(o.status);
  // multi-day: close today's open day entry (dayDone / final done)
  const closeDay = () => { x.work_days = workDays(o).map(w => w.left ? w : Object.assign({}, w, { left: at })); };
  if (p.kind === 'confirm' && o.status === 'done' && !o.customer_confirm) {
    x.customer_confirm = p.params.answer;
    if (p.params.answer === 'no') x.dispute = true;
  }
  if (p.kind === 'reach' && open) {
    x.status = 'reached';
    if (!o.reached_at) x.reached_at = at;   // a multi-day job keeps the first day's time
    if (drMulti(o)) x.work_days = workDays(o).filter(w => w.left).concat([{ date: todayIso(), reached: at, left: '', overtime_min: 0 }]);
  }
  if (p.kind === 'daydone' && o.status === 'reached') { x.status = 'ongoing'; closeDay(); }
  if (p.kind === 'delay' && open) { x.status = 'delayed'; x.delay_min = p.params.mins; x.delay_reason = p.params.reason; }
  if (p.kind === 'done' && o.status === 'reached') {
    x.status = 'done'; x.done_at = at; x.done_checklist = p.params.done;
    x.not_done = (o.services || []).filter(k => !p.params.done.includes(k));
    if (p.params.crew) x.crew = p.params.crew;
    if (p.params.tanks) x.tanks = p.params.tanks.map(t => Object.assign({}, t, { total_litres: tankTotal(t) }));
    if (drMulti(o)) closeDay();
  }
  return x;
}
// Fresh data from a load that started after the action was confirmed already contains it
function drClearSent(seq) {
  Object.keys(DR.pending).forEach(id => { const p = DR.pending[id]; if (p.state === 'sent' && p.seq < seq) delete DR.pending[id]; });
  if (DR.moving && DR.moving.state === 'sent' && DR.moving.seq < seq) DR.moving = null;
}

/* The days of a multi-day job, oldest first: for each day worked, "હું પહોંચી ગયો" and
   "આજનું કામ પૂર્ણ" (with the day's overtime); today's reach with a clock while it is sent.
   The customer's WhatsApp answer belongs to the first day only. */
function drDaysPart(o) {
  const t = todayIso(), n = jobDays(o), noWa = drNoWa(o), wd = workDays(o);
  const closed = wd.filter(w => w.left), openE = wd.find(w => !w.left);
  let m = '';
  closed.forEach((w, i) => {
    const lastOfJob = o.status === 'done' && i === closed.length - 1;   // the final day: the "કામ પૂર્ણ" message follows
    if (w.date !== o.sched_date) m += WA.day(drDay(w.date));
    m += WA.bubble('out', GU.reached + ' <span class="dr-day">' + esc(GU.day_of(i + 1, n)) + '</span>', fm(mins(w.reached)), { ticks: 2 });
    if (!lastOfJob) {
      const html = '<b>' + GU.day_done + '</b> <span class="sub">(' + esc(GU.day_of(i + 1, n)) + ')</span>';
      m += i === closed.length - 1 ? drOut(o, 'daydone', html, fm(mins(w.left))) : WA.bubble('out', html, fm(mins(w.left)), { ticks: 2 });
      if (Number(w.overtime_min) > 0) m += WA.sys('ઓવરટાઇમ: ' + durGu(Number(w.overtime_min)));
    }
  });
  if (openE) {
    if (openE.date !== o.sched_date) m += WA.day(drDay(openE.date));
    m += drOut(o, 'reach', GU.reached + ' <span class="dr-day">' + esc(GU.day_of(closed.length + 1, n)) + '</span>', fm(mins(openE.reached)));
    // the first day only: the customer's answer (or the call, without WhatsApp)
    if (!closed.length && o.status === 'reached') m += noWa ? drCallBubble(o, 'અમારી ટીમ પહોંચી ગઈ છે.', 'ગ્રાહકને ફોન કરીને અથવા રૂબરૂ જણાવો') : drReply(o);
  } else if (o.status === 'ongoing' && !drDoneToday(o) && jobOnDate(o, t)) {
    m += WA.day(drDay(t)) + WA.sys(drDayLabel(o, t) + ': પહોંચો ત્યારે «' + GU.reached + '» દબાવો.');
  }
  return m;
}

/**
 * Builds the whole chat for one job: {head, msgs, bottom}.
 * Read-only (upcoming jobs): no action buttons, only Call and Map in the header.
 */
function drChatParts(o) {
  const t = todayIso();
  const readOnly = !jobOnDate(o, t);   // a multi-day job is "today" on every day of its span
  const open = DR_OPEN.includes(o.status) && !drDoneToday(o);
  const multi = drMulti(o), n = jobDays(o);
  const lateBy = o.sched_date === t ? nowMin() - mins(o.sched_time) : 0;

  // Header: back arrow, client, area · day · time, Call and Map
  const head = WA.chatHead({
    title: o.client_name,
    sub: areaGu(o.area) + ' · ' + (multi && o.sched_date <= t ? drDayLabel(o, t) : drDay(o.sched_date)) + ' · ' + timeOf(o),
    back: 'dr-back',
    avatarColor: WA.colorFor(o.client_name),
    // Call and Map with words under the icons (icons alone are hard to read in the sun)
    // No WhatsApp: the Call button is green, so it stands out
    right: '<a class="wa-ib dr-hb' + (drNoWa(o) ? ' dr-hot' : '') + '" href="' + esc(telUrl(o.phone)) + '" aria-label="કૉલ કરો">' + WA.icons.call + '<span>કૉલ</span></a>' +
      '<a class="wa-ib dr-hb" href="' + esc(mapUrl(o)) + '" target="_blank" rel="noopener" aria-label="નકશો ખોલો">' + WA.icons.map + '<span>નકશો</span></a>'
  });

  // Messages, oldest first
  const noWa = drNoWa(o);
  let m = WA.day(drDay(o.sched_date)) + drCardBubble(o);
  // Moved off today by the end-of-day: a no-WhatsApp customer must be called with the new date
  if (noWa && readOnly && o.moved_from === t && o.sched_date > t) {
    m += drCallBubble(o, 'તમારું કામ <b>' + esc(labGu(o.sched_date)) + ' · ' + timeOf(o) + '</b> પર ખસેડ્યું છે.' +
      (o.delay_reason && REASON[o.delay_reason] ? ' કારણ: ' + esc(REASON[o.delay_reason].gu) + '.' : ''));
  }
  if (o.eta_sent) {
    m += !noWa ? WA.bubble('out', 'ગ્રાહકને અંદાજિત સમય મોકલ્યો: <b>' + fm(mins(o.eta_sent)) + '</b>', '', { ticks: 2 })
      : open ? drCallBubble(o, drSayEta(o.eta_sent), 'અંદાજિત સમય ' + fm(mins(o.eta_sent)) + ' · ' + GU.call_tell)
      : WA.sys('અંદાજિત સમય ' + fm(mins(o.eta_sent)));
  }
  if (o.delay_min > 0) {
    m += drOut(o, 'delay', drDelayHtml(o.delay_min, o.delay_reason), '');
    // No WhatsApp: the late message was NOT sent, the driver calls with these words
    if (noWa && open) m += drCallBubble(o, drSayDelay(o.delay_min, o.delay_reason, DR.delayAt[o.order_id]));
  }
  if (open && !readOnly && lateBy > 10) {
    m += WA.sys('સમય કરતાં ' + durGu(lateBy) + ' મોડા.' + (o.delay_min > 0 ? '' : ' ગ્રાહકને મોડાની જાણ કરો.'));
  }
  if (multi) m += drDaysPart(o);   // one block per day worked (multi-day job)
  else if (o.reached_at) {
    m += drOut(o, 'reach', GU.reached, fm(mins(o.reached_at)));
    if (o.status === 'reached') m += noWa ? drCallBubble(o, 'અમારી ટીમ પહોંચી ગઈ છે.', 'ગ્રાહકને ફોન કરીને અથવા રૂબરૂ જણાવો') : drReply(o);
  }
  if (o.status === 'done') {
    const done = o.done_checklist || [], not = o.not_done || [];
    m += drOut(o, 'done', drDoneHtml(done, not, o.crew, o.tanks), o.done_at ? fm(mins(o.done_at)) : '', not.length ? 'warn' : '');
    if (o.overtime_min > 0) m += WA.sys('ઓવરટાઇમ: ' + durGu(o.overtime_min));
    m += noWa ? drConfirmPart(o) : drReply(o);
  }

  m += drFailed(o);   // an action that could not be sent, with "send again"

  // What the driver can do now (the buttons at the bottom).
  // While an action is on its way, the buttons wait (wait = true).
  const wait = drSending(o.order_id);
  let bottom = '';
  if (readOnly) {
    m += WA.sys('આ કામ ' + labGu(o.sched_date) + ' નું છે.');
  } else if (open) {
    if (DR.late && String(DR.late.id) === String(o.order_id)) {
      m += drLateBubble(o);
      bottom = WA.quick([{ label: GU.close, act: 'dr-late-cancel', cls: 'full' }]);
    } else {
      bottom = WA.quick([
        { label: GU.reached, act: 'dr-reach', data: { id: o.order_id }, cls: 'pri', disabled: wait },
        { label: GU.will_be_late, act: 'dr-delay', data: { id: o.order_id }, disabled: wait }
      ]);
    }
  } else if (o.status === 'reached' && multi && !DR.finish[o.order_id]) {
    // A multi-day job at the site: today's work done (come back tomorrow), or the whole job done
    m += WA.bubble('in', '<b>આ કામ ' + n + ' દિવસનું છે</b><br>આજનું કામ પૂરું થાય ત્યારે <b>«' + GU.day_done + '»</b> દબાવો. ' +
      'આખું કામ પૂરું થાય ત્યારે <b>«' + GU.job_done + '»</b> દબાવો.', '', { who: DR_OFFICE });
    bottom = WA.quick([
      { label: GU.day_done, act: 'dr-daydone', data: { id: o.order_id }, cls: 'pri', disabled: wait },
      { label: GU.job_done, act: 'dr-finish', data: { id: o.order_id }, disabled: wait }
    ]);
  } else if (o.status === 'reached') {
    m += drCheckBubble(o);
    m += drLogBubble(o);   // log book: who did the work and the tank sizes
    bottom = WA.quick([{ label: multi ? GU.job_done : GU.work_done, act: 'dr-done', data: { id: o.order_id }, cls: 'pri full',
      disabled: wait || (!(DR.ticks[o.order_id] || []).length && (o.services || []).length > 0) }].concat(multi
      ? [{ label: GU.day_done + ' (કાલે ફરી)', act: 'dr-daydone', data: { id: o.order_id }, cls: 'full', disabled: wait }] : []));
  } else if (o.status === 'ongoing' && !readOnly) {
    // Today's work was done ("આજનું કામ પૂર્ણ"): nothing more today
    m += WA.sys('આજનું કામ પૂર્ણ. આવતીકાલે ફરી આ કામ પર જવાનું છે.');
    bottom = WA.quick([{ label: 'યાદી પર પાછા જાઓ', act: 'dr-back', cls: 'full', disabled: wait }]);
  } else if (o.status === 'done') {
    const L = DR.left[o.order_id], nx = drNextStop(o), pl = DR.pending[o.order_id];
    const nxNoWa = nx && drNoWa(nx);
    // Big "open the next job" button, so "I have left" is never a dead end
    const nextBtn = j => WA.quick([{ label: 'આગળનું કામ ખોલો: ' + j.client_name, act: 'dr-open', data: { id: j.order_id }, cls: 'pri full' }]);
    // Last job of the day finished: a clear way back to the list
    const backBtn = WA.quick([{ label: 'યાદી પર પાછા જાઓ', act: 'dr-back', cls: 'full', disabled: wait }]);
    if (pl && pl.kind === 'leave' && drBusyState(pl)) {
      // "I have left" tapped: shown at once with a clock until the server answers
      m += drOut(o, 'leave', GU.i_left, fm(pl.at));
    } else if (L) {
      // "I have left" was tapped on this phone: show it and the server's answer
      m += WA.bubble('out', GU.i_left, fm(L.at), { ticks: 2 });
      const j = (L.next != null && drOrder(L.next)) || nx;
      m += L.told === false
        ? WA.bubble('in', esc(L.to) + ': સમય કરતાં લગભગ ' + durGu(L.late) + ' મોડું.<br>ઓફિસને જાણ કરી, ઓફિસ ગ્રાહકને ફોન કરશે.', '', { who: DR_OFFICE, cls: 'warn' })
        // The next customer has no WhatsApp: nothing was sent, the driver calls them with the time
        : L.wa === false && j ? drCallBubble(j, drSayEta(L.eta) + (L.late > 10 ? ' (સમય કરતાં લગભગ ' + durGu(L.late) + ' મોડું)' : ''), GU.call_tell + ': ' + L.to)
        : WA.bubble('in', esc(L.to) + ' ને અંદાજિત સમય <b>' + fm(mins(L.eta)) + '</b> મોકલ્યો ✓' +
          (L.late > 10 ? '<br>સમય કરતાં લગભગ ' + durGu(L.late) + ' મોડું. ગ્રાહકને જાણ કરી.' : ''), '', { who: DR_OFFICE });
      bottom = j && j.sched_date === t && j.status !== 'done' ? nextBtn(j) : backBtn;
    } else if (nx && nx.eta_sent) {
      m += nxNoWa ? drCallBubble(nx, drSayEta(nx.eta_sent), GU.call_tell + ': ' + nx.client_name)
        : WA.bubble('in', esc(nx.client_name) + ' ને અંદાજિત સમય <b>' + fm(mins(nx.eta_sent)) + '</b> મોકલ્યો ✓', '', { who: DR_OFFICE });
      bottom = nextBtn(nx);
    } else if (nx) {
      m += WA.bubble('in', 'આગળનું કામ: <b>' + esc(nx.client_name) + '</b><br>' + esc(areaGu(nx.area)) + ' · ' + timeOf(nx) +
        (drTravel(o.area, nx.area) !== null ? ' · રસ્તો લગભગ ' + drTravel(o.area, nx.area) + ' મિનિટ' : '') +
        (nxNoWa ? '<br>' + drNoWaBadge() : ''), '', { who: DR_OFFICE, cls: 'dr-next' });
      bottom = WA.quick([{ label: GU.i_left, act: 'dr-leave', data: { id: o.order_id }, cls: 'pri full', disabled: wait }]);
    } else {
      bottom = backBtn;
    }
  }
  return { head: head, msgs: m, bottom: bottom };
}

/**
 * Shows (or re-draws) the chat of one job.
 * how = 'open'  first open, newest message at the bottom
 *       'force' after an action: redraw and go to the newest message
 *       'keep'  after a tick or chip tap: redraw, stay where the driver is (or at the bottom)
 *       'auto'  the 60-second refresh: only redraw if something changed
 */
function drShowChat(id, how) {
  const o = drOrder(id);
  if (!o) {
    // The job is gone (moved to another team, or cancelled)
    if (WA.chatOpen()) { drCloseChat(); toast('આ કામ હવે તમારી યાદીમાં નથી.'); }
    return;
  }
  const p = drChatParts(o);
  const html = p.head + p.msgs + p.bottom;
  if (how === 'auto' && html === DR.chatHtml) return;   // nothing new
  // The 60-second refresh never redraws while the driver is typing a tank size (the keyboard would close)
  const f = document.activeElement;
  if (how === 'auto' && f && f.tagName === 'INPUT' && f.closest && f.closest('#ph-chat')) return;
  const old = $('#wa-msgs');
  const top = old ? old.scrollTop : 0;
  const atBottom = old ? old.scrollHeight - old.scrollTop - old.clientHeight < 40 : true;
  WA.openChat(p.head, p.msgs, p.bottom);   // this scrolls to the newest message
  DR.chat = o.order_id;
  DR.chatHtml = html;
  const box = $('#wa-msgs');
  // 'keep' and 'auto': stay where the driver was, unless they were already at the newest message
  if (box && (how === 'keep' || how === 'auto') && !atBottom) box.scrollTop = top;
}

function drCloseChat() {
  drFlush();   // leaving the chat: an action still in its undo window is sent now, never lost
  WA.closeChat();
  DR.chat = null; DR.chatHtml = ''; DR.late = null;
}

// Tap a job row (or "આગળનું કામ ખોલો"): open its chat. The phone's back button will close it.
onAct('dr-open', btn => {
  drFlush();   // opening another job = leaving this one: send what is waiting
  DR.late = null;
  drShowChat(btn.dataset.id, 'open');
  if (WA.chatOpen()) WA.pushBack();   // once per open chat; redraws after an action do not call it
});
// Back arrow in the chat header. WA.closeChat also removes the back step added by WA.pushBack.
onAct('dr-back', () => drCloseChat());
// After the phone's back button closed the chat (chat.js), forget which chat was open
window.addEventListener('popstate', () => {
  if (!WA.chatOpen()) { drFlush(); DR.chat = null; DR.chatHtml = ''; DR.late = null; }
});


/* ==========================================================================
   5-SECOND "રદ કરો" (UNDO) WINDOW
   Every tap that sends the customer a WhatsApp (reached, late, done, I have
   left, end of day) shows on screen at once, but is sent only after 5 seconds.
   A big bar at the bottom says "રદ કરો · 5" and counts down. Tapping it puts
   everything back exactly as it was, and nothing is sent.
   - Only one action waits at a time: a new one sends the waiting one first.
   - Leaving the chat, switching tab, logging out or hiding the app (phone
     locked, another app opened) sends the waiting action at once, so it is
     never lost. (sendBeacon cannot carry our login well, so we just send.)
   ========================================================================== */
const DR_UNDO_SEC = 5;

/**
 * Starts the undo window.
 * commit() = really send it (runs after 5 seconds, or at once on leave/hide)
 * revert() = put the screen back (runs only when "રદ કરો" is tapped)
 * saveOnly = true when nothing goes to a customer (no WhatsApp, or the in-person answer):
 *            the bar then says "will be saved" instead of "will be sent to the customer"
 */
function drHold(commit, revert, saveOnly) {
  drFlush();   // only one at a time: the older one goes now
  DR.undo = { commit: commit, revert: revert, end: Date.now() + DR_UNDO_SEC * 1000, saveOnly: !!saveOnly,
    timer: setInterval(drUndoTick, 200) };
  drUndoBar();
}
// Every 0.2 s: update the number; at 0, send
function drUndoTick() {
  const u = DR.undo;
  if (!u) return;
  if (Date.now() >= u.end) drFlush(); else drUndoBar();
}
// Stop the countdown and remove the bar (nothing is sent)
function drUndoClear() {
  const u = DR.undo;
  DR.undo = null;
  if (u) clearInterval(u.timer);
  drUndoBar();
  return u;
}
// Send the waiting action now (if there is one)
function drFlush() {
  const u = drUndoClear();
  if (u) u.commit();
}
// "રદ કરો": cancel the waiting action. No API call is made.
onAct('dr-undo', () => {
  const u = drUndoClear();
  if (u) u.revert();
});

// The big bar at the bottom of the phone. Built once; only the number changes,
// so a tap on it is never lost while it counts down.
function drUndoBar() {
  let bar = document.getElementById('dr-undo');
  const u = DR.undo;
  if (!u) { if (bar) bar.remove(); return; }
  const left = Math.max(1, Math.ceil((u.end - Date.now()) / 1000));
  const words = n => n + (u.saveOnly ? ' સેકન્ડમાં સેવ થશે' : ' સેકન્ડમાં ગ્રાહકને મોકલાશે');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'dr-undo';
    bar.setAttribute('role', 'status');
    bar.innerHTML = '<span class="dr-undo-t">' + words(left) + '</span>' +
      '<button type="button" data-act="dr-undo">રદ કરો · <b>' + left + '</b></button>';
    ($('#v-phone') || document.body).appendChild(bar);
  } else {
    const n = bar.querySelector('b'), t = bar.querySelector('.dr-undo-t');
    if (n.textContent !== String(left)) {
      n.textContent = left;
      t.textContent = words(left);
    }
  }
}

// Page hidden (phone locked, call, another app) or closing: send at once
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') drFlush(); });
window.addEventListener('pagehide', () => drFlush());

// Switching tab or logging out also sends the waiting action first.
// (The buttons are handled in app.js; we wrap them here.)
const drBasePage = App.actions.page, drBaseLogout = App.actions.logout;
onAct('page', (el, e) => { drFlush(); drBasePage(el, e); });
onAct('logout', (el, e) => { drFlush(); drBaseLogout(el, e); });

/* ---------- "driver" class on the phone, for the bigger driver styles in phone.css ---------- */
const drBaseRenderPhone = renderPhone;
renderPhone = function () {
  // the supervisor gets the same big buttons (also measuring tanks on site)
  $('#v-phone').classList.toggle('dr-on', !!(App.session && (App.session.role === 'driver' || App.session.role === 'supervisor')));
  drBaseRenderPhone();
};

/* ==========================================================================
   DRIVER ACTIONS (buttons)
   ========================================================================== */

/**
 * One driver action, WITHOUT making the driver wait:
 *  1. the screen changes at once (message with a clock, next buttons)
 *  2. the 5-second "રદ કરો" window (drHold). Undo = back as it was, nothing sent.
 *  3. then the server is asked (drPost).
 *     OK: clock -> ✓✓. Failed: red message "send again", the job goes back to how it was.
 * kind = reach | delay | done | leave, text = the message text, ok(reply) runs after success,
 * undo() = extra things to put back when "રદ કરો" is tapped (e.g. reopen the late picker).
 */
function drSend(kind, id, action, params, text, ok, undo) {
  if (drSending(id)) return;   // already waiting or on its way (stops double taps)
  const p = DR.pending[id] = { kind: kind, action: action, params: params, text: text, ok: ok, at: nowMin(), state: 'wait' };
  // Nothing goes to a customer: the in-person answer, or a customer without WhatsApp
  // ("I have left" messages the NEXT customer, so that one counts)
  const o = drOrder(id), nx = kind === 'leave' && o ? drNextStop(o) : null;
  // (a multi-day job: no WhatsApp after the first day's reach, and none for "today's work done")
  const saveOnly = kind === 'confirm' || kind === 'daydone' || (kind === 'reach' && o && drMulti(o) && !!o.reached_at) ||
    (kind === 'leave' ? !nx || drNoWa(nx) : drNoWa(o));
  drShow('force');
  drHold(() => drPost(id, p), () => {
    if (DR.pending[id] === p) delete DR.pending[id];
    if (undo) undo();
    drShow('force');
  }, saveOnly);
}

// Really sends one action to the server (after the undo window)
async function drPost(id, p) {
  if (DR.pending[id] !== p) return;
  p.state = 'sending';
  try {
    const r = await api(p.action, p.params);
    if (DR.pending[id] !== p) return;
    p.state = 'sent'; p.seq = DR.seq;
    if (p.ok) p.ok(r);
    if (p.kind === 'leave') delete DR.pending[id];   // its answer is kept in DR.left
  } catch (e) {
    if (guCode(e) === 'AUTH') return;              // back to the PIN screen already
    if (DR.pending[id] !== p) return;
    if (guCode(e) === 'BAD_STATUS') { delete DR.pending[id]; toast(guErr(e)); }   // the job changed: sending again will not help
    else { p.state = 'failed'; if (!WA.chatOpen()) toast(guErr(e)); }
  }
  if (!App.session) return;   // logged out meanwhile (the action was still sent)
  drShow('force');
  // The saved list is out of date now: forget it and load fresh data in the background
  cacheDrop(['order.list']);
  drLoad();
}

// "ફરી મોકલો" on a red message: send the same action again (no second undo window)
onAct('dr-retry', btn => {
  const id = btn.dataset.id, p = DR.pending[id];
  if (!p || p.state !== 'failed') return;
  const np = DR.pending[id] = Object.assign({}, p, { state: 'sending', at: nowMin() });
  drShow('force');
  drPost(id, np);
});

// A short "sent ✓" message. Inside a chat the new bubble already shows it, so no pop-up there.
const drToast = msg => { if (!WA.chatOpen()) toast(msg); };

// "હું પહોંચી ગયો": mark reached; the customer gets a WhatsApp to confirm
onAct('dr-reach', btn => {
  const o0 = drOrder(btn.dataset.id), later = !!(o0 && drMulti(o0) && o0.reached_at);   // day 2+ of a multi-day job: no WhatsApp
  drSend('reach', btn.dataset.id, 'order.reached', { order_id: Number(btn.dataset.id) }, GU.reached,
    () => drToast(later || drNoWa(drOrder(btn.dataset.id)) ? GU.saved_ok : 'ગ્રાહકને WhatsApp મોકલ્યો ✓'));
});

// No WhatsApp: the customer's answer, asked in person ("ગ્રાહક સંમત ✓" / "ગ્રાહક અસંમત ✗")
onAct('dr-confirm', btn => {
  const id = btn.dataset.id, v = btn.dataset.v === 'no' ? 'no' : 'yes';
  drSend('confirm', id, 'order.confirm', { order_id: Number(id), answer: v }, v === 'yes' ? GU.cust_yes : GU.cust_no,
    () => drToast(v === 'yes' ? GU.saved_ok : 'માલિકને જાણ કરી.'));
});

// Checklist tick / untick (kept on the phone until "કામ પૂર્ણ થયું")
onAct('dr-tick', btn => {
  const id = btn.dataset.id, k = btn.dataset.k;
  const list = DR.ticks[id] || (DR.ticks[id] = []);
  const i = list.indexOf(k);
  if (i < 0) list.push(k); else list.splice(i, 1);
  drShowChat(id, 'keep');
});

// Log book: tap a worker's name (crew), change a tank, add or remove a tank
onAct('dr-crew', btn => {
  const id = btn.dataset.id, nm = btn.dataset.n, list = DR.crew[id] || (DR.crew[id] = []);
  const i = list.indexOf(nm);
  if (i < 0) list.push(nm); else list.splice(i, 1);
  drShowChat(id, 'keep');
});
// (tank taps and typing are handled by the shared tank editor, tank-editor.js)

// "કામ પૂર્ણ થયું": send the ticked services (the ticks are kept until the server says OK,
// so "રદ કરો" brings the checklist back with the same ticks)
onAct('dr-done', btn => {
  const id = btn.dataset.id, o = drOrder(id), done = (DR.ticks[id] || []).slice();
  if (!o || (!done.length && (o.services || []).length)) return;   // a task without a checklist needs no ticks
  const not = (o.services || []).filter(k => !done.includes(k));
  // Log book: the tank sizes must be right before anything is sent
  const tk = TankEd.out(drTkKey(id));
  if (tk.error) { TankEd.setError(drTkKey(id), tk.error); toast(tk.error); return; }
  const crew = (DR.crew[id] || []).slice();
  drSend('done', id, 'order.done', { order_id: Number(id), done: done, tanks: tk.tanks, crew: crew }, drDoneHtml(done, not, crew, tk.tanks), r => {
    delete DR.ticks[id]; delete DR.crew[id]; delete DR.finish[id]; TankEd.reset(drTkKey(id));
    drToast((drNoWa(o) ? 'કામ પૂર્ણ. ગ્રાહકને પૂછો ✓' : 'કામ પૂર્ણ. ગ્રાહકને WhatsApp મોકલ્યો ✓') + (r && r.overtime_min > 0 ? ' · ઓવરટાઇમ ' + durGu(r.overtime_min) : ''));
  });
});

// Multi-day job: "આજનું કામ પૂર્ણ" = today's work is done, the team comes back tomorrow
// (order.dayDone; nothing is sent to the customer, so the undo bar says "will be saved")
onAct('dr-daydone', btn => {
  const id = btn.dataset.id;
  drSend('daydone', id, 'order.dayDone', { order_id: Number(id) }, '<b>' + GU.day_done + '</b>',
    () => { delete DR.finish[id]; drToast(GU.day_done + ' ✓ ' + GU.saved_ok); });
});
// Multi-day job: "આખું કામ પૂર્ણ" opens the normal done step (checklist, crew, tanks)
onAct('dr-finish', btn => { DR.finish[btn.dataset.id] = true; drShowChat(btn.dataset.id, 'force'); });

// "હું નીકળ્યો, ગ્રાહકને જણાવો": the server works out the arrival time and tells the next customer
onAct('dr-leave', btn => {
  const id = btn.dataset.id, o = drOrder(id), nx = o && drNextStop(o);
  const at = nowMin();
  drSend('leave', id, 'order.leave', { order_id: Number(id) }, GU.i_left, r => {
    if (!r || !r.next_order_id) { toast('આજે બીજું કોઈ કામ બાકી નથી.'); return; }
    const next = drOrder(r.next_order_id) || nx || {};
    const told = r.customer_told !== false;   // false = too late, the office will call the customer instead
    // false = the next customer has no WhatsApp: nothing was sent, the driver calls (server: next_whatsapp 'no')
    const wa = r.next_whatsapp ? r.next_whatsapp !== 'no' : !drNoWa(next);
    DR.left[id] = { at: at, to: next.client_name || '', eta: r.eta, late: r.late_min || 0, told: told, wa: wa, next: r.next_order_id };
    drToast(!told ? 'ઘણું મોડું છે. ઓફિસને જાણ કરી, ઓફિસ ગ્રાહકને ફોન કરશે.'
      : !wa ? (next.client_name || '') + ': ' + GU.call_tell + ' · ' + fm(mins(r.eta))
      : (next.client_name || '') + ' ને અંદાજિત સમય ' + fm(mins(r.eta)) + ' મોકલ્યો ✓');
  });
});

/* ---------- "મોડો પડીશ": minutes + reason chips inside the chat ---------- */
// Opens with NOTHING chosen: the driver must pick minutes and a reason
onAct('dr-delay', btn => {
  DR.late = { id: btn.dataset.id, mins: null, reason: null };
  drShowChat(btn.dataset.id, 'force');
});
onAct('dr-late-pick', btn => {
  if (!DR.late) return;
  DR.late[btn.dataset.k] = btn.dataset.k === 'mins' ? Number(btn.dataset.v) : btn.dataset.v;
  drShowChat(DR.late.id, 'keep');
});
onAct('dr-late-cancel', () => {
  const id = DR.late && DR.late.id;
  DR.late = null;
  if (id != null) drShowChat(id, 'force');
});
onAct('dr-delay-send', () => {
  const L = DR.late;
  if (!L || !L.mins || !L.reason) return;   // both must be chosen
  DR.late = null;   // close the chips at once; the message shows with a clock
  const o = drOrder(L.id);
  if (o) DR.delayAt[L.id] = drLateEta(o, L.mins);   // the time to tell a no-WhatsApp customer on the phone
  drSend('delay', L.id, 'order.delay', { order_id: Number(L.id), mins: L.mins, reason: L.reason }, drDelayHtml(L.mins, L.reason),
    () => drToast(drNoWa(o) ? GU.saved_ok + ' ' + GU.call_tell : 'ગ્રાહકને મોડાની જાણ કરી ✓'),
    () => { DR.late = L; });   // "રદ કરો": the picker comes back with the same choices
});

/* ---------- "દિવસ પૂર્ણ કરો": reason + new date for each unfinished job ---------- */
const drDeHead = () => '<div class="dr-de-hd">' + WA.avatar(GU.day_end, { small: true, icon: DR_MOON, color: 'var(--muted)' }) + '<h3>' + GU.day_end + '</h3></div>';
// true when every listed job has both a reason and a new date
const drDeReady = () => !!(DR.sheet && DR.sheet.items.length && DR.sheet.items.every(it => it.reason && it.new_date));

function drDayEndSheet() {
  const sh = DR.sheet, t = todayIso();
  let h = drDeHead();
  if (!sh.items.length) {
    // Nothing left to move: the honest count of the day (not always "well done")
    h += drSummaryHtml() + '<button class="btn lg" data-act="close">' + GU.close + '</button>';
  } else {
    // Nothing is pre-filled: the driver chooses a reason and a date for every job
    const opt = (v, label, on) => '<option value="' + v + '"' + (on ? ' selected' : '') + '>' + esc(label) + '</option>';
    h += '<div class="sub">આ કામ આજે પૂર્ણ થયા નથી. દરેક કામ માટે કારણ અને નવી તારીખ પસંદ કરો. ગ્રાહકને મેસેજ જશે.</div>' +
      sh.items.map((it, i) => {
        const o = drOrder(it.order_id) || {};
        return '<div class="dr-de">' + WA.avatar(o.client_name, { small: true }) +
          '<div class="dr-de-mid"><b>' + esc(o.client_name) + '</b><span class="sub">' + timeOf(o) + ' · ' + esc(areaGu(o.area)) + '</span>' +
          // No WhatsApp: this customer gets no message, the driver calls with the new date
          (drNoWa(o) ? '<span>' + drNoWaBadge() + '</span>' : '') +
          '<div class="dr-de-sel"><select class="fsel" data-chg="dr-de-r" data-i="' + i + '" aria-label="કારણ">' +
          opt('', '— કારણ પસંદ કરો —', !it.reason) +
          DR_REASONS.map(r => opt(r, REASON[r].gu, it.reason === r)).join('') + '</select>' +
          '<select class="fsel" data-chg="dr-de-d" data-i="' + i + '" aria-label="નવી તારીખ">' +
          opt('', '— નવી તારીખ પસંદ કરો —', !it.new_date) +
          [1, 2, 3].map(n => { const d = addD(t, n); return opt(d, labGu(d), it.new_date === d); }).join('') +
          '</select></div></div></div>';
      }).join('') +
      '<div class="dr-de-hint"' + (drDeReady() ? ' hidden' : '') + '>દરેક કામ માટે કારણ અને તારીખ પસંદ કરો.</div>' +
      '<button class="btn pri lg" data-act="dr-dayend-send"' + (drDeReady() ? '' : ' disabled') + '>ગ્રાહકોને મેસેજ મોકલો અને દિવસ પૂર્ણ કરો</button>' +
      '<button class="btn lg" data-act="close">' + GU.close + '</button>';
  }
  openSheet(h);
}
// After each choice: switch the save button on only when everything is chosen
function drDeCheck() {
  const ok = drDeReady();
  const b = $('#ph-sheet [data-act="dr-dayend-send"]'), hint = $('#ph-sheet .dr-de-hint');
  if (b) b.disabled = !ok;
  if (hint) hint.hidden = ok;
}

// "દિવસ પૂર્ણ કરો" (row at the bottom of the list, or the menu).
// Before the last job's booked time it asks first: ending early moves customers to another day.
onAct('dr-dayend', btn => {
  if (!DR.orders) { closeOverlays(); return; }
  const t = todayIso();
  // A multi-day job that has started is not moved: it simply continues tomorrow
  const pend = drList().filter(o => o.sched_date === t && !drDoneToday(o) && !(drMulti(o) && (o.reached_at || o.status === 'ongoing')))
    .sort((a, b) => mins(a.sched_time) - mins(b.sched_time));
  closeOverlays();
  const lastTime = pend.length ? mins(pend[pend.length - 1].sched_time) : 0;
  if (pend.length && nowMin() < lastTime && !(btn && btn.dataset && btn.dataset.sure)) {
    openSheet(drDeHead() +
      '<p class="dr-ask">હજુ ' + pend.length + ' કામ બાકી છે. ખરેખર દિવસ પૂર્ણ કરવો છે?</p>' +
      '<div class="row2"><button class="btn lg" data-act="close">ના</button>' +
      '<button class="btn pri lg" data-act="dr-dayend" data-sure="1">હા</button></div>');
    return;
  }
  DR.sheet = { type: 'dayend', items: pend.map(o => ({ order_id: o.order_id, reason: '', new_date: '' })) };
  drDayEndSheet();
});
onChg('dr-de-r', s => { if (DR.sheet) { DR.sheet.items[+s.dataset.i].reason = s.value; drDeCheck(); } });
onChg('dr-de-d', s => { if (DR.sheet) { DR.sheet.items[+s.dataset.i].new_date = s.value; drDeCheck(); } });

// Save: the jobs move on screen at once, then the 5-second "રદ કરો" window, then the server.
onAct('dr-dayend-send', () => {
  const sh = DR.sheet;
  if (!sh || !drDeReady() || DR.busy) return;
  const items = sh.items.map(it => Object.assign({}, it));
  DR.sheet = null; closeOverlays();
  const mv = DR.moving = { items: items, state: 'wait' };
  drShow('force');
  drHold(() => drDayEndPost(mv), () => {
    // "રદ કરો": the jobs come back to today and the sheet opens again with the same choices
    if (DR.moving === mv) DR.moving = null;
    DR.sheet = { type: 'dayend', items: items };
    drShow('force');
    drDayEndSheet();
  });
});
async function drDayEndPost(mv) {
  if (DR.moving !== mv) return;
  DR.busy = true; mv.state = 'sending';
  try {
    const r = await api('order.reschedule', { items: mv.items });
    mv.state = 'sent'; mv.seq = DR.seq;
    // Customers without WhatsApp got nothing: the driver must call them (shown in the moved list)
    const calls = mv.items.filter(it => drNoWa(drOrder(it.order_id))).length;
    const sent = ((r && r.moved) || 0) - calls;
    toast((sent > 0 ? sent + ' ગ્રાહકોને WhatsApp પર જાણ કરી ✓' : GU.saved_ok) + (calls ? ' · ' + calls + ' ગ્રાહકને ફોન કરો' : ''));

  } catch (e) {
    DR.busy = false;
    if (DR.moving === mv) DR.moving = null;
    drShow('force');
    if (guCode(e) === 'AUTH') return;
    toast(guErr(e));
    // Not sent: open the sheet again with the same choices, so the driver can try again
    DR.sheet = { type: 'dayend', items: mv.items };
    if (!WA.chatOpen()) drDayEndSheet();
    return;
  }
  DR.busy = false;
  if (!App.session) return;   // logged out meanwhile (the moves were still sent)
  drShow('force');
  cacheDrop(['order.list']);
  drLoad();   // in the background
}
