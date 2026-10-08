/* ==========================================================================
   api.js: the one place that talks to the server (Google Apps Script).
   Every screen calls   api('action.name', {...})   and gets back the data,
   or an error is thrown with a short code like 'AUTH' or 'NETWORK'.
   ========================================================================== */

// Paste the Apps Script web app URL here after deploying (ends in /exec).
const API_URL = '';   // DEMO COPY: no real server, everything runs on sample data

// true = always use the fake server in mock-api.js (sample data, nothing is saved).
// false = use the real Google Sheet. Adding ?mock=1 to the page address still opens the demo.
const USE_MOCK = true;   // DEMO COPY: always sample data, nothing is saved

// How long to wait for the server before giving up (milliseconds)
const API_TIMEOUT_MS = 20000;

// Is the fake server on for this page?
function isMock() {
  if (USE_MOCK) return true;
  try { return new URLSearchParams(location.search).get('mock') === '1'; } catch (e) { return false; }
}

/* ---------- session (who is logged in) ----------
   Saved on the phone under 'td_session' as {token, role, team, name, expires}.
   Every access is wrapped in try/catch because some browsers (private mode)
   block storage. Then the user simply logs in again next time. */
const SESSION_KEY = 'td_session';

function getSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return s && s.token ? s : null;
  } catch (e) { return null; }
}
function saveSession(s) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) { /* storage blocked: session lasts until the page closes */ }
  memorySession = s;
}
function clearSession() {
  try { if (typeof cacheClear === 'function') cacheClear(); } catch (e) { /* ignore */ }
  try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  memorySession = null;
}
// Backup copy in memory, for browsers that block localStorage
let memorySession = null;
function currentSession() { return getSession() || memorySession; }

// Has the session run out? 'expires' may be a number (milliseconds) or a date text.
function sessionExpired(s) {
  if (!s || !s.expires) return false;
  const t = typeof s.expires === 'number' ? s.expires : Date.parse(s.expires);
  return !isNaN(t) && t <= Date.now();
}

/* ---------- "logged out" hook ----------
   app.js sets this so that when the server says AUTH (or the session runs out)
   the app goes back to the PIN screen. */
let onAuthLost = function () {};
function setAuthLostHandler(fn) { onAuthLost = fn; }
function authLost() {
  clearSession();
  try { onAuthLost(); } catch (e) { console.error(e); }
}

/* ---------- the main call ---------- */
async function api(action, params) {
  const s = currentSession();

  // Not logged in, or the session has run out: back to the PIN screen
  if (action !== 'login' && (!s || sessionExpired(s))) {
    authLost();
    throw new Error('AUTH');
  }

  const body = Object.assign({ action: action, token: s ? s.token : '' }, params || {});
  const res = isMock() ? await callMock(body) : await callServer(body);

  if (!res || res.ok !== true) throw apiError((res && res.error) || 'UNKNOWN');
  return res.data;
}

/**
 * Server errors look like "BAD_INPUT: Amount is more than the balance".
 * The thrown error keeps that text (screens show the part after the colon),
 * except a login problem, which is always exactly 'AUTH' so screens can
 * simply check e.message === 'AUTH'. e.code always holds just the code.
 */
function apiError(text) {
  text = String(text);
  const code = text.split(':')[0].trim() || 'UNKNOWN';
  if (code === 'AUTH') authLost();
  const e = new Error(code === 'AUTH' ? 'AUTH' : text);
  e.code = code;
  return e;
}

/* ==========================================================================
   SPEED HELPERS
   Each trip to Google Apps Script takes about 1-2 seconds, so we:
     1. send several requests in ONE trip       -> apiBatch()
     2. show the last saved data straight away,
        then quietly update it                 -> apiCached()
   ========================================================================== */

/**
 * Several actions in one trip to the server.
 * apiBatch([['alerts.list', {}], ['reminders.list', {}]])
 *   -> [ {alerts...}, {reminders...} ]   (an item is an Error object if that one failed)
 * The whole call throws only if the network fails or the login has run out.
 */
async function apiBatch(calls) {
  const data = await api('batch', { calls: calls.map(c => Object.assign({ action: c[0] }, c[1] || {})) });
  return (data.results || []).map(r => (r && r.ok) ? r.data : apiErrorQuiet((r && r.error) || 'UNKNOWN'));
}
// The error for one item inside a batch (returned, not thrown)
function apiErrorQuiet(text) {
  return apiError(text);
}

/* Saved copies of recent answers, so a screen can draw instantly.
   Kept in memory and on the phone (localStorage), per logged-in user. */
const CACHE_PREFIX = 'td_cache:';
const memCache = {};

function cacheKey(action, params) {
  const s = currentSession() || {};
  return CACHE_PREFIX + (s.role || '') + ':' + (s.team || '') + ':' + action + ':' + JSON.stringify(params || {});
}
function cacheGet(key) {
  if (memCache[key]) return memCache[key];
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); if (v) memCache[key] = v; return v; } catch (e) { return null; }
}
function cachePut(key, data) {
  memCache[key] = data;
  try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { /* phone storage full or blocked: memory copy is enough */ }
}
/** Forget all saved answers (on logout, so the next person never sees old data). */
function cacheClear() {
  Object.keys(memCache).forEach(k => delete memCache[k]);
  try { Object.keys(localStorage).filter(k => k.indexOf(CACHE_PREFIX) === 0).forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
}

/**
 * Show saved data at once, then fetch fresh data and show it if it changed.
 *   apiCached('order.list', {from, to}, data => drawList(data))
 * draw(data, fresh) is called once with the saved copy (fresh = false) if there is one,
 * and again with the server's answer (fresh = true) if it is different.
 * Returns the fresh data (or throws, like api()).
 */
async function apiCached(action, params, draw) {
  const key = cacheKey(action, params);
  const old = cacheGet(key);
  if (old && draw) draw(old, false);
  const data = await api(action, params);
  const changed = !old || JSON.stringify(old) !== JSON.stringify(data);
  cachePut(key, data);
  if (draw && changed) draw(data, true);
  return data;
}

/** After saving something, the saved copies may be out of date: drop them for these actions. */
function cacheDrop(actions) {
  const s = currentSession() || {};
  const start = CACHE_PREFIX + (s.role || '') + ':' + (s.team || '') + ':';
  const match = k => k.indexOf(start) === 0 && (!actions || actions.some(a => k.indexOf(start + a + ':') === 0));
  Object.keys(memCache).filter(match).forEach(k => delete memCache[k]);
  try { Object.keys(localStorage).filter(match).forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
}

// Real server: POST with text/plain so the browser does not do an extra
// "preflight" check that Apps Script cannot answer.
async function callServer(body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  try {
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) {
    // Weak signal, no internet, or too slow: screens show a "Try again" button
    throw new Error(e && e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
}

// Fake server: waits ~300ms like a real network, then asks mock-api.js.
// The data is copied in and out so screens behave exactly as with the real server.
function callMock(body) {
  return new Promise(resolve => {
    setTimeout(() => {
      const res = MockAPI.handle(JSON.parse(JSON.stringify(body)));
      resolve(JSON.parse(JSON.stringify(res)));
    }, 300);
  });
}
