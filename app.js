/* ==========================================================================
   app.js: starts the app.
   - No session  -> PIN screen.
   - Logged in   -> loads setup (services, areas, teams...) and opens the
                    Admin layout (English) or the Phone layout (Gujarati).
   - One click handler for the whole page. Buttons say what they do with
     data-act="name", and the matching function is looked up in App.actions.
   Role files (admin.js, driver.js, collector.js) load after this file and
   add their own screens and actions with registerScreen() and onAct().
   ========================================================================== */

const App = {
  session: null,       // {token, role, team, name, expires}
  setup: null,         // reply of setup.get
  adminTab: 'dash',    // which admin menu item is open
  phonePage: '',       // which driver/collector page is open
  screens: { admin: {}, driver: {}, collector: {}, supervisor: {} },   // render functions by role and page
  actions: {},         // click handlers by data-act name
  changes: {},         // change handlers by data-chg name (select boxes, checkboxes)
  inputs: {}           // typing handlers by data-inp name (text boxes)
};

/* ---------- registration (used by the role files) ----------
   registerScreen('admin', 'orders', function (el) { el.innerHTML = '...'; })
   onAct('reach', function (button, event) { ... }) */
function registerScreen(role, page, fn) { App.screens[role][page] = fn; }
function onAct(name, fn) { App.actions[name] = fn; }
function onChg(name, fn) { App.changes[name] = fn; }
function onInp(name, fn) { App.inputs[name] = fn; }

/* ---------- menus ---------- */
// [key, name, short second line, icon]  (keep the second line short so it is never cut off)
const ADMIN_NAV = [
  ['dash', 'Dashboard', 'Alerts and visits due', 'dash'],
  ['new', 'New order', 'Add a call or WhatsApp', 'neworder'],
  ['orders', 'Orders and assign', 'Give jobs to teams', 'orders'],
  ['clients', 'Clients', 'History of every client', 'clients'],
  ['cal', 'Calendar', 'Month view', 'cal'],
  ['teams', 'Team routes', 'Where teams are today', 'routes'],
  ['logbook', 'Log book', 'Vehicle day sheet, costs', 'logbook'],
  ['pay', 'Payments', 'Ledger and collections', 'pay'],
  ['ot', 'Overtime', 'After-hours work', 'overtime'],
  ['reports', 'Reports', 'Monthly analysis', 'reports']
];
// Menu items that belong to an add-on pack (Modules tab). Everything else is core (always shown),
// including the Calendar. Packs: repeat (Clients), insights (Reports and Overtime).
const ADMIN_NAV_MODULE = { clients: 'repeat', ot: 'insights', reports: 'insights' };
// The menu for this client: packs that are off are left out; names follow word()
// ("New order" becomes "New task" when the "orders" add-on is off)
function adminNav() {
  return ADMIN_NAV.filter(n => !ADMIN_NAV_MODULE[n[0]] || hasMod(ADMIN_NAV_MODULE[n[0]])).map(n => {
    const sub = n[0] === 'dash' && !hasMod('clients') ? "Alerts and today's work" : n[2];   // no "visits due" without Clients
    return [n[0], word(n[1]), sub, n[3]];
  });
}
const PHONE_NAV = {
  driver: [['today', GU.today_jobs], ['up', GU.upcoming_jobs], ['me', GU.my_profile]],
  collector: [['todo', GU.ledger], ['done', GU.today_collection]],
  // supervisor (added 2026-10-08): survey visits to measure, and the ones already sent
  supervisor: [['todo', GU.surveys], ['done', GU.sent_surveys]]
};

/* ---------- show one main view, hide the others ---------- */
function showView(id) {
  ['v-login', 'v-wait', 'v-admin', 'v-phone'].forEach(v => { $('#' + v).hidden = v !== id; });
}

/* ==========================================================================
   PIN LOGIN
   ========================================================================== */
let pinDigits = '', pinBusy = false;

function showLogin(message) {
  App.session = null; App.setup = null;
  pinDigits = ''; pinBusy = false;
  document.documentElement.lang = 'gu';
  showView('v-login');
  renderPin(message || '');
}

function renderPin(error) {
  $$('#pin-dots i').forEach((dot, i) => dot.classList.toggle('on', i < pinDigits.length));
  const err = $('#pin-err');
  err.textContent = error || '';
  err.hidden = !error;
  $$('#pin-pad button').forEach(b => { b.disabled = pinBusy; });
}

function pinPress(d) {
  if (pinBusy) return;
  if (d === 'back') pinDigits = pinDigits.slice(0, -1);
  else if (pinDigits.length < 4) pinDigits += d;
  renderPin('');
  if (pinDigits.length === 4) doLogin();
}

async function doLogin() {
  pinBusy = true; renderPin('');
  try {
    const s = await api('login', { pin: pinDigits });
    saveSession(s);
    startApp();
  } catch (e) {
    pinDigits = ''; pinBusy = false;
    const code = e.code || String(e.message).split(':')[0];
    console.error('Login failed:', e);   // the exact reason, for whoever is helping
    renderPin(code === 'BAD_PIN' ? GU.wrong_pin + ' · Wrong PIN.'
      : code === 'LOCKED' ? GU.locked + ' · Too many tries, wait 5 minutes.'
      : code === 'NETWORK' || code === 'TIMEOUT' ? GU.no_network + ' · No network, try again.'
      // e.g. the supervisor PIN when the "Survey and quotation" add-on is off
      : code === 'FORBIDDEN' ? 'આ સુવિધા ચાલુ નથી. · This feature is not switched on.'
      : 'ભૂલ થઈ (' + code + '). ફરી પ્રયત્ન કરો. · Server problem (' + code + '), try again.');
  }
}

onAct('pin', el => pinPress(el.dataset.d));

// Typing the PIN on a computer keyboard also works
document.addEventListener('keydown', e => {
  if ($('#v-login').hidden) return;
  if (/^[0-9]$/.test(e.key)) pinPress(e.key);
  else if (e.key === 'Backspace') pinPress('back');
});

/* ==========================================================================
   START-UP: load setup, then open the right layout for the role
   ========================================================================== */
async function startApp() {
  App.session = currentSession();
  if (!App.session || sessionExpired(App.session)) { clearSession(); showLogin(); return; }

  const gu = App.session.role !== 'admin';
  document.documentElement.lang = gu ? 'gu' : 'en';
  showView('v-wait');
  $('#wait-msg').textContent = gu ? GU.loading : 'Loading…';

  try {
    App.setup = await api('setup.get');
  } catch (e) {
    if (e.message === 'AUTH') return;   // already sent back to the PIN screen
    // An add-on was switched off while logged in (e.g. the supervisor without "quotation")
    if (String(e.code || e.message).split(':')[0] === 'FORBIDDEN') {
      clearSession(); showLogin('આ સુવિધા ચાલુ નથી. · This feature is not switched on.'); return;
    }
    $('#wait-msg').innerHTML = esc(gu ? GU.no_network : 'Could not reach the server.') +
      '<br><br><button class="btn pri" data-act="retry-start">' + esc(gu ? GU.try_again : 'Try again') + '</button>';
    return;
  }

  if (App.session.role === 'admin') showAdmin();
  else showPhone();
}
onAct('retry-start', () => startApp());

function logout() {
  clearSession();
  showLogin();
}
onAct('logout', logout);

/* ==========================================================================
   ADMIN LAYOUT (English)
   ========================================================================== */
function showAdmin() {
  showView('v-admin');
  renderAdmin();
  // The Dashboard loads the alert count itself; other screens ask once here
  if (App.adminTab !== 'dash') refreshAlertBadge();
}

function renderAdmin() {
  const nav = adminNav();
  // A screen of an add-on that is off (or not known) opens the Dashboard instead
  if (!nav.some(n => n[0] === App.adminTab)) App.adminTab = 'dash';
  const agency = (App.setup && App.setup.settings && App.setup.settings.agency_name) || 'Tank Desk';
  // Left pane looks like the chat list on a computer: blue header, then one row per screen
  $('#ad-side').innerHTML =
    '<div class="wa-head"><div class="t"><b>' + esc(agency) + '</b><span>Tank Desk · Admin</span></div>' +
    '<button class="wa-ib" data-act="logout" aria-label="Log out" title="Log out">' + WA.icons.logout + '</button></div>' +
    nav.map(n => WA.row({ name: n[1], preview: esc(n[2]), act: 'tab', data: { t: n[0] },
      current: App.adminTab === n[0], avatarIcon: WA.icons[n[3]] })).join('');
  // Footer: agency, who is logged in (each admin has their own PIN and name),
  // a Log out link that is always visible (on a phone-width screen the header with
  // the logout icon is hidden), and "Install app" when the browser offers it.
  renderAdminFoot(agency);
  setAlertBadge(App.alertUnseen || 0);   // redraw the last known count, no server trip

  // Show only the open section
  ADMIN_NAV.forEach(n => { $('#ad-' + n[0]).hidden = n[0] !== App.adminTab; });

  const el = $('#ad-' + App.adminTab);
  const screen = App.screens.admin[App.adminTab];
  if (screen) screen(el);
  else {
    const title = (nav.find(n => n[0] === App.adminTab) || ['', ''])[1];
    el.innerHTML = '<header><div><h2>' + esc(title) + '</h2><p class="sub">Logged in as ' + esc(App.session.name) + '</p></div></header>' +
      '<div class="empty">Admin screens coming in B4-B9.</div>';
  }
}

onAct('tab', el => { App.adminTab = el.dataset.t; renderAdmin(); });

function renderAdminFoot(agency) {
  const name = App.session && App.session.name;
  $('#ad-foot-note').innerHTML = esc(agency) + (name ? ' · Logged in as <b>' + esc(name) + '</b>' : '') +
    ' · <button class="lnk" data-act="logout">Log out</button>' +
    (canInstall() ? ' · <button class="lnk" data-act="pwa-install">Install app</button>' : '');
}
// Redraw only the footer (the install offer can arrive after the screen is drawn)
function refreshAdminFoot() {
  if (!App.session || App.session.role !== 'admin' || $('#v-admin').hidden) return;
  renderAdminFoot((App.setup && App.setup.settings && App.setup.settings.agency_name) || 'Tank Desk');
}

/* ---------- install the app (PWA), shared by admin, driver and collector ----------
   Chrome and Edge (Android and computer) fire "beforeinstallprompt" when the app
   can be installed. We keep that event; the admin footer shows "Install app" and
   the phone menu (driver.js) shows "એપ ઇન્સ્ટોલ કરો". Tapping it opens the
   browser's own install box. iPhones have no such event (driver.js shows a how-to). */
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; refreshAdminFoot(); });
window.addEventListener('appinstalled', () => { installPrompt = null; refreshAdminFoot(); });

// Already running as an installed app (own window, no browser bar)?
const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
// Show an install link only when the browser offers it and the app is not installed yet
const canInstall = () => !!installPrompt && !isStandalone();

onAct('pwa-install', async () => {
  if (!installPrompt) return;
  const p = installPrompt;
  installPrompt = null;   // the browser lets us ask only once
  closeOverlays();
  refreshAdminFoot();
  try { p.prompt(); await p.userChoice; } catch (e) { /* user closed it */ }
});

/**
 * Red number on "Dashboard" in the side menu = alerts the owner has not seen yet.
 * Fetched quietly in the background; if it fails, the menu just shows no number.
 */
async function refreshAlertBadge() {
  try {
    const res = await api('alerts.list', { unseen_only: true });
    setAlertBadge(res.unseen);
  } catch (e) { /* not important enough to show an error */ }
}

/** Shows the count on the Dashboard row. The Dashboard also calls this with the
    count it already loaded, so no extra trip to the server is needed. */
function setAlertBadge(n) {
  App.alertUnseen = n || 0;
  const row = document.querySelector('#ad-side [data-t="dash"] .l2');
  if (!row) return;
  const old = row.querySelector('.bd');
  if (old) old.remove();
  if (App.alertUnseen > 0) row.insertAdjacentHTML('beforeend', '<span class="bd bad">' + App.alertUnseen + '</span>');
}
App.setAlertBadge = setAlertBadge;
App.refreshAlertBadge = refreshAlertBadge;
// Check for new alerts every 2 minutes while the admin screen is open.
setInterval(() => { if (App.session && App.session.role === 'admin' && !document.hidden) refreshAlertBadge(); }, 120000);

/* ==========================================================================
   PHONE LAYOUT (driver and collector, Gujarati)
   ========================================================================== */
function showPhone() {
  const nav = PHONE_NAV[App.session.role] || [];
  if (!nav.some(n => n[0] === App.phonePage)) App.phonePage = nav.length ? nav[0][0] : '';
  showView('v-phone');
  closeOverlays();
  renderPhone();
}

function renderPhone() {
  const role = App.session.role;
  const nav = PHONE_NAV[role] || [];
  const agency = (App.setup && App.setup.settings && App.setup.settings.agency_name) || 'Tank Desk';
  const who = role === 'driver' ? GU.team + ' ' + App.session.team + ' · ' + App.session.name
    : role === 'supervisor' ? GU.supervisor + ' · ' + App.session.name : GU.collector;

  // Blue header bar: agency name, who is logged in, refresh and the ⋮ menu
  $('#ph-head').innerHTML = '<div class="wa-head"><div class="t"><b>' + esc(agency) + '</b><span>' + esc(who) + '</span></div>' +
    '<button class="wa-ib" data-act="ph-refresh" aria-label="' + esc(GU.refresh || 'Refresh') + '">' + WA.icons.refresh + '</button>' +
    '<button class="wa-ib" data-act="menu" aria-label="મેનુ">' + WA.icons.more + '</button></div>';

  // Tabs under the header (like Chats / Updates / Calls). App.tabCounts[page] shows a small number.
  $('#ph-tabs').innerHTML = nav.map(n => '<button role="tab" data-act="page" data-p="' + n[0] + '" aria-selected="' + (App.phonePage === n[0]) + '">' +
    esc(n[1]) + ((App.tabCounts || {})[n[0]] ? '<span class="cnt">' + App.tabCounts[n[0]] + '</span>' : '') + '</button>').join('');

  const el = $('#ph-body');
  const screen = App.screens[role] && App.screens[role][App.phonePage];
  if (screen) screen(el);
  else el.innerHTML = '<div class="empty">' + esc(role === 'driver' ? GU.soon_driver : role === 'collector' ? GU.soon_collector : GU.loading) + '</div>';
}

/** Lets a screen show a small count on its tab (e.g. jobs left today). */
function setTabCount(page, n) {
  App.tabCounts = App.tabCounts || {};
  App.tabCounts[page] = n;
  const b = document.querySelector('#ph-tabs [data-p="' + page + '"]');
  if (!b) return;
  const old = b.querySelector('.cnt'); if (old) old.remove();
  if (n) b.insertAdjacentHTML('beforeend', '<span class="cnt">' + n + '</span>');
}

// The refresh icon in the header re-draws the open tab (each screen reloads its data when drawn)
onAct('ph-refresh', () => { if (!WA.chatOpen()) renderPhone(); });

/* ---------- slide-in menu (drawer) ---------- */
function openDrawer() {
  const role = App.session.role;
  const who = role === 'driver'
    ? '<b>' + esc(App.session.name) + '</b><span class="sub">' + GU.team + ' ' + esc(App.session.team) + '</span>'
    : role === 'supervisor' ? '<b>' + esc(App.session.name) + '</b><span class="sub">' + GU.supervisor + ' · ટાંકીનું માપ</span>'
    : '<b>' + GU.collector + '</b><span class="sub">' + GU.collector_team + '</span>';
  const d = $('#ph-drawer');
  d.innerHTML = '<div class="scrim" data-act="close"></div><nav class="drawer"><div class="who">' + who + '</div>' +
    (PHONE_NAV[role] || []).map(n => '<button class="dn" data-act="page" data-p="' + n[0] + '"' +
      (App.phonePage === n[0] ? ' aria-current="page"' : '') + '>' + esc(n[1]) + '</button>').join('') +
    '<button class="dn" data-act="logout">' + GU.logout + '</button></nav>';
  d.hidden = false;
}

/* ---------- bottom sheet (used by driver/collector screens for forms) ---------- */
function openSheet(html) {
  const s = $('#ph-sheet');
  s.innerHTML = '<div class="scrim" data-act="close"></div><div class="sheet">' + html + '</div>';
  s.hidden = false;
}
function closeOverlays() {
  ['#ph-drawer', '#ph-sheet'].forEach(id => { const el = $(id); el.hidden = true; el.innerHTML = ''; });
}

onAct('menu', () => { if ($('#ph-drawer').hidden) openDrawer(); else closeOverlays(); });
onAct('close', closeOverlays);
onAct('page', el => { App.phonePage = el.dataset.p; closeOverlays(); WA.closeChat(); renderPhone(); });

/* ==========================================================================
   ONE CLICK HANDLER FOR THE WHOLE PAGE (plus change and typing handlers)
   ========================================================================== */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = App.actions[el.dataset.act];
  if (fn) fn(el, e);
});
document.addEventListener('change', e => {
  const fn = e.target.dataset && App.changes[e.target.dataset.chg];
  if (fn) fn(e.target, e);
});
document.addEventListener('input', e => {
  const fn = e.target.dataset && App.inputs[e.target.dataset.inp];
  if (fn) fn(e.target, e);
});

/* ---------- go ---------- */
// When the server says the login is no longer valid: back to the PIN screen
setAuthLostHandler(() => showLogin(GU.login_again + ' · Please log in again.'));

// Start after every script (including the role files) has loaded
document.addEventListener('DOMContentLoaded', startApp);
