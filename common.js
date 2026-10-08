/* ==========================================================================
   common.js: small helpers used by every screen. Loaded first.
   Most of these are copied from the mockup so screens behave the same.
   ========================================================================== */

/* ---------- page helpers ---------- */
// Find one element on the page, e.g. $('#ph-body')
const $ = s => document.querySelector(s);
// Find all matching elements as a normal list
const $$ = s => Array.from(document.querySelectorAll(s));
// Make text safe to put inside HTML (stops names like "<b>" breaking the page)
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Rupees with Indian commas: 125000 -> "₹1,25,000"
const inr = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

/* ---------- dates ----------
   Dates are text like "2026-10-07". Times are text like "14:30".
   Date-and-time is "2026-10-07T14:30:00" (India time, no time zone suffix). */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONF = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad2 = n => String(n).padStart(2, '0');
// "2026-10-07" -> a Date at midnight
const pd = s => new Date(s + 'T00:00:00');
// a Date -> "2026-10-07"
const isoOf = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
// add (or subtract) days: addD('2026-10-07', 1) -> "2026-10-08"
const addD = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return isoOf(d); };
// days from date a to date b (both "YYYY-MM-DD")
const daysBetween = (a, b) => Math.round((pd(b) - pd(a)) / 86400000);
// "2026-10-07" -> "Wed 7 Oct"
const lab = s => { const d = pd(s); return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]; };
// today's date on this device ("YYYY-MM-DD"); phones in India are on India time
const todayIso = () => isoOf(new Date());
// minutes since midnight right now
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
// now as "2026-10-07T14:30:05"
const nowIso = () => { const d = new Date(); return isoOf(d) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); };
// minutes -> "14:30" (for saving)
const hhmm = m => pad2(Math.floor(m / 60)) + ':' + pad2(Math.round(m) % 60);
// "14:30" or "2026-10-07T14:30:00" -> minutes since midnight (870). Blank -> null.
const mins = t => {
  if (!t) return null;
  const s = String(t), time = s.includes('T') ? s.split('T')[1] : s;
  const a = time.split(':');
  return +a[0] * 60 + +a[1];
};
// minutes -> "2:30 PM" (for showing)
const fm = m => { m = Math.round(m); const h = Math.floor(m / 60), mm = m % 60; return (h % 12 || 12) + ':' + pad2(mm) + ' ' + (h < 12 || h === 24 ? 'AM' : 'PM'); };
// a duration in English: 95 -> "1h 35m"
const dur = m => m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + m % 60 + 'm' : '');
// a duration in Gujarati: 95 -> "1 કલાક 35 મિનિટ"
const durGu = m => ((m >= 60 ? Math.floor(m / 60) + ' કલાક ' : '') + (m % 60 ? m % 60 + ' મિનિટ' : '')).trim();

/* ---------- phones and maps ---------- */
// Any phone format -> "91XXXXXXXXXX" (as stored in the Sheet). Returns '' if it is not a valid number.
const normPhone = s => {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '0') d = d.slice(1);
  if (d.length === 10) d = '91' + d;
  return /^91\d{10}$/.test(d) ? d : '';
};
// "919825041031" -> "98250 41031" (for showing)
const phoneText = p => { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? d.slice(0, 5) + ' ' + d.slice(5) : String(p || ''); };
// Google Maps link for an order: the saved link, or a search on the address
const mapUrl = o => o.map_link || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.address || '');

/* ---------- switchable add-ons ("modules", added 2026-10-08) ----------
   Task management is the core and is always on (with orders + pricing, calendar,
   multi-day jobs and the archive). Three add-on PACKS can be switched on or off per client
   in the Modules tab of the Sheet (key, name, on): repeat, quotation, insights (2026-10-08).
   The server sends setup.get modules with the packs AND the internal keys worked out from them:
     repeat -> clients, amc;  quotation -> quotation;  insights -> reports;
     orders, calendar, multiday -> always true.
   So hasMod('clients') and hasMod('repeat') both work.
   A key that is missing counts as ON, so a Sheet without a Modules tab works as before.
   The SERVER enforces the rules; these helpers only decide what the screens show. */
function hasMod(key) {
  const m = (typeof App !== 'undefined' && App && App.setup && App.setup.modules) || {};
  return m[key] !== false;
}
/**
 * The admin wording (orders is always on in the current packs; kept for other industries): with the "orders" add-on on, the screens say "Order(s)" (as always).
 * With it off (task management only), the same text says "Task(s)":
 *   word('New order') -> 'New task', word('Orders and assign') -> 'Tasks and assign'.
 * One helper, so no screen needs its own if/else for this.
 */
function word(s) {
  s = String(s == null ? '' : s);
  if (hasMod('orders')) return s;
  return s.replace(/\bOrders\b/g, 'Tasks').replace(/\bOrder\b/g, 'Task').replace(/\borders\b/g, 'tasks').replace(/\border\b/g, 'task');
}

/* ---------- team colours ----------
   Team A..E get the five colours from styles.css. No team = grey.
   teamKeys is the list of team letters from setup (defaults to A-E). */
const teamColor = (k, teamKeys) => {
  const i = (teamKeys || ['A', 'B', 'C', 'D', 'E']).indexOf(k);
  return i < 0 ? 'var(--tN)' : 'var(--t' + 'ABCDE'[i % 5] + ')';
};

/* ---------- toast: a short message at the bottom of the screen ---------- */
function toast(msg) {
  const box = $('#toasts');
  if (!box) return;
  const d = document.createElement('div');
  d.className = 'toast';
  d.textContent = msg;
  while (box.children.length >= 2) box.firstChild.remove();
  box.appendChild(d);
  setTimeout(() => d.remove(), 4500);
}

/* ---------- labels ----------
   Delay reasons and payment modes, in English (admin) and Gujarati (driver, collector). */
const REASON = {
  traffic: { en: 'Heavy traffic', gu: 'ટ્રાફિક બહુ છે' },
  prev: { en: 'Earlier job took longer', gu: 'પહેલાના કામમાં વધારે સમય લાગ્યો' },
  vehicle: { en: 'Vehicle problem', gu: 'ગાડીમાં તકલીફ થઈ' },
  // 'other': the driver's chip says "some other reason"; the CUSTOMER still hears the polite
  // "એક અનિવાર્ય કારણ" (cust / custEn = the customer's words, as whatsapp.gs REASON_GU).
  other: { en: 'Some other reason', gu: 'બીજું કોઈ કારણ', cust: 'એક અનિવાર્ય કારણ', custEn: 'An unavoidable reason' },
  // End-of-day reasons (DRIVER, added 2026-10-08): only for moving a job to another day.
  not_home: { en: 'Customer not home', gu: 'ગ્રાહક ઘરે નથી', cust: 'તમે ઘરે ન હતા', custEn: 'You were not at home' },
  cust_later: { en: 'Customer asked for later', gu: 'ગ્રાહકે પછી આવવા કહ્યું', cust: 'તમે પછી આવવા કહ્યું', custEn: 'You asked us to come later' },
  time_out: { en: 'Time ran out', gu: 'સમય પૂરો થઈ ગયો', cust: 'આજનો કામનો સમય પૂરો થઈ ગયો', custEn: "Today's working time ran out" },
  not_empty: { en: 'Tank not emptied', gu: 'ટાંકી ખાલી નથી', cust: 'ટાંકી ખાલી ન હતી', custEn: 'The tank was not emptied' }
};
// The words the CUSTOMER hears for a reason key (Gujarati / English meaning): cust if set, else gu / en
const reasonCust = k => { const r = REASON[k] || REASON.other; return r.cust || r.gu; };
const reasonCustEn = k => { const r = REASON[k] || REASON.other; return r.custEn || r.en; };
const MODE = {
  cash: { en: 'Cash', gu: 'રોકડ' },
  upi: { en: 'UPI', gu: 'UPI' },
  cheque: { en: 'Cheque', gu: 'ચેક' },
  bank: { en: 'Bank transfer', gu: 'બેંક ટ્રાન્સફર' },
  other: { en: 'Other', gu: 'અન્ય' }
};

/* ---------- language of the staff phone screens (added 2026-10-08) ----------
   Driver, collector and supervisor screens are in Gujarati ('gu', the default) or
   English ('en'). Admin screens are always English. Customer WhatsApp text is
   ALWAYS Gujarati (the server never translates it).
   The choice is made on the PIN screen ("English / ગુજરાતી"), in the phone ⋮ menu,
   or with ?lang=en (or ?lang=gu) in the web address. It is remembered on this device.
   How the screens use it:
     tr('ગુજરાતી', 'English')  -> the text in the chosen language
     TX.reached                -> a word from the GU / EN lists below, in the chosen language
     lbl(REASON.traffic)       -> .gu or .en of a label object (REASON, MODE, TANK_MAT...)
     nameOf(area)              -> name_gu or name_en of a Services / Areas / ClientTypes row
     enMean('Our team…')       -> in English only: a muted "In English: …" line under Gujarati customer text */
const LANG_KEY = 'td-lang';
let uiLangNow = 'gu';
(function () {
  let l = '';
  try { l = (new URLSearchParams(location.search || '')).get('lang') || ''; } catch (e) { /* no address bar (tests) */ }
  if (l === 'en' || l === 'gu') { try { localStorage.setItem(LANG_KEY, l); } catch (e) { /* private mode */ } }
  else { try { l = localStorage.getItem(LANG_KEY) || ''; } catch (e) { l = ''; } }
  uiLangNow = l === 'en' ? 'en' : 'gu';
})();
const uiLang = () => uiLangNow;
const isEn = () => uiLangNow === 'en';
// Change the language and remember it on this device
function setLang(l) {
  uiLangNow = l === 'en' ? 'en' : 'gu';
  try { localStorage.setItem(LANG_KEY, uiLangNow); } catch (e) { /* private mode: works until the page is closed */ }
}
const tr = (gu, en) => (uiLangNow === 'en' ? en : gu);
const lbl = x => (x ? (uiLangNow === 'en' ? x.en : x.gu) : '');
const nameOf = x => (x ? (uiLangNow === 'en' ? (x.name_en || x.name_gu || x.key) : (x.name_gu || x.name_en || x.key)) : '');
// The meaning of Gujarati customer text, shown only in English mode (html: escape it yourself)
const enMean = html => (uiLangNow === 'en' && html ? '<span class="en-mean">In English: ' + html + '</span>' : '');
// The same line for the admin screens (always English)
const enMeanAlways = html => (html ? '<span class="en-mean">In English: ' + html + '</span>' : '');
// Gujarati customer text, marked as Gujarati (so the English check skips it, and screen readers read it right)
const guText = html => '<span lang="gu">' + html + '</span>';
// A date for the staff screens: "ગુરુ 8 ઑક્ટો" (Gujarati) or "Thu 8 Oct" (English)
const GU_DAYS = ['રવિ', 'સોમ', 'મંગળ', 'બુધ', 'ગુરુ', 'શુક્ર', 'શનિ'];
const GU_MON = ['જાન્યુ', 'ફેબ્રુ', 'માર્ચ', 'એપ્રિલ', 'મે', 'જૂન', 'જુલાઈ', 'ઑગસ્ટ', 'સપ્ટે', 'ઑક્ટો', 'નવે', 'ડિસે'];
// "2026-10-08" -> "ગુરુ 8 ઑક્ટો" (always Gujarati: used inside customer words)
const labGu = s => { const d = pd(s); return GU_DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + GU_MON[d.getMonth()]; };
const labT = s => (uiLangNow === 'en' ? lab(s) : labGu(s));
// A duration for the staff screens: "1 કલાક 35 મિનિટ" or "1h 35m"
const durT = m => (uiLangNow === 'en' ? dur(m) : durGu(m));

/* Gujarati words used on the driver and collector screens. Change wording here.
   The English words are in EN (below); every key here should have one there. */
const GU = {
  login: 'લૉગિન',
  enter_pin: 'તમારો 4 આંકડાનો PIN નાખો',
  wrong_pin: 'ખોટો PIN. ફરી પ્રયત્ન કરો.',
  locked: 'ઘણી વાર ખોટો PIN નાખ્યો. 5 મિનિટ પછી ફરી પ્રયત્ન કરો.',
  login_again: 'ફરી લૉગિન કરો.',
  loading: 'લોડ થાય છે…',
  no_network: 'નેટવર્ક નથી. ફરી પ્રયત્ન કરો.',
  try_again: 'ફરી પ્રયત્ન કરો',
  menu: 'મેનુ',
  logout: 'લૉગઆઉટ',
  close: 'બંધ કરો',
  team: 'ટીમ',
  minutes: 'મિનિટ',
  // driver
  driver: 'ડ્રાઇવર',
  today_jobs: 'આજના કામ',
  upcoming_jobs: 'આવતા કામ',
  my_profile: 'મારી પ્રોફાઇલ',
  day_end: 'દિવસ પૂર્ણ કરો',
  open_map: '📍 નકશો ખોલો',
  reached: 'હું પહોંચી ગયો',
  will_be_late: 'મોડો પડીશ',
  work_done: 'કામ પૂર્ણ થયું',
  i_left: 'હું નીકળ્યો, ગ્રાહકને જણાવો',
  // customers WITHOUT WhatsApp: nothing is sent to them, staff call instead
  no_wa: 'WhatsApp નથી · ફોન કરો',
  call_tell: 'ગ્રાહકને ફોન કરીને જણાવો',
  call: 'ફોન કરો',
  cust_yes: 'ગ્રાહક સંમત ✓',
  cust_no: 'ગ્રાહક અસંમત ✗',
  saved_ok: 'નોંધ થઈ ✓',
  receipt_in_person: 'WhatsApp નથી: રસીદ મોઢે જણાવો',
  // collector
  collector: 'કલેક્શન',
  collector_team: 'પેમેન્ટ કલેક્શન ટીમ',
  ledger: 'કલેક્શન લેજર',
  today_collection: 'આજનું કલેક્શન',
  take_payment: 'પેમેન્ટ લો',
  total_due: 'કુલ બાકી',
  other_area: 'અન્ય વિસ્તાર',
  // order status
  status: { new: 'નવું', assigned: 'બાકી', delayed: 'મોડું', reached: 'કામ ચાલુ', done: 'પૂર્ણ', moved: 'ખસેડ્યું', ongoing: 'ચાલુ કામ (આવતીકાલે ફરી)' },
  // placeholders until the real screens are built
  soon_driver: 'ડ્રાઇવરની સ્ક્રીન જલ્દી આવશે (B7).',
  soon_collector: 'કલેક્શનની સ્ક્રીન જલ્દી આવશે (B8).',
  // jobs over several days (driver)
  day_of: (k, n) => 'દિવસ ' + k + ' / ' + n,
  day_done: 'આજનું કામ પૂર્ણ',
  job_done: 'આખું કામ પૂર્ણ',
  ongoing: 'ચાલુ કામ',
  // supervisor (measures the tanks before the quotation)
  supervisor: 'સુપરવાઇઝર',
  surveys: 'સર્વે',
  sent_surveys: 'મોકલેલા',
  send_measure: 'માપ મોકલો',
  // tank editor
  partition_hint: 'પાર્ટિશન અને 2 એન્ટ્રી હોય તો દરેક ભાગ અલગ ટાંકી તરીકે માપીને લખો',
  // shared phone words
  refresh: 'ફરી લોડ કરો',
  office: 'ઓફિસ',
  customer: 'ગ્રાહક',
  today: 'આજે',
  back_to_list: 'યાદી પર પાછા જાઓ',
  updating: 'અપડેટ થાય છે…',
  sending: 'મોકલાય છે…',
  not_sent_retry: 'મોકલાયું નહીં · ફરી મોકલો',
  note: 'નોંધ',
  time: 'સમય',
  address: 'સરનામું',
  area: 'વિસ્તાર',
  type: 'પ્રકાર',
  phone: 'ફોન',
  call_short: 'કૉલ',
  call_aria: 'કૉલ કરો',
  map_short: 'નકશો',
  litres: 'લિટર',
  tank_sizes: 'ટાંકીનું માપ',
  // language switch (the button shows the OTHER language)
  lang_other: 'English',
  lang_label: 'ભાષા / Language',
  // ---- DRIVER words (usability round, added 2026-10-08) ----
  cf_yes: 'હા, બરાબર છે',            // the customer's answer in person (was "ગ્રાહક સંમત ✓")
  cf_no: 'ના, ફરિયાદ છે',            // (was "ગ્રાહક અસંમત ✗")
  size_diff: 'માપ અલગ છે',           // the tanks at the site differ from the saved sizes
  office_informed: 'ઓફિસને જાણ કરી ✓',
  tick_first: 'પહેલા ઉપર કામ ટિક કરો ↑',
  day_done_btn: '🌙 આજે બસ, કાલે ફરી આવીશું',
  job_done_btn: '✅ આખું કામ પૂરું',
  call_these: 'આ ગ્રાહકોને ફોન કરો'
};

/* The same words in English (lang 'en'). Short and plain, for field staff. */
const EN = {
  login: 'Log in',
  enter_pin: 'Enter your 4-digit PIN',
  wrong_pin: 'Wrong PIN. Try again.',
  locked: 'Too many wrong PINs. Try again in 5 minutes.',
  login_again: 'Please log in again.',
  loading: 'Loading…',
  no_network: 'No network. Try again.',
  try_again: 'Try again',
  menu: 'Menu',
  logout: 'Log out',
  close: 'Close',
  team: 'Team',
  minutes: 'min',
  driver: 'Driver',
  today_jobs: "Today's jobs",
  upcoming_jobs: 'Upcoming jobs',
  my_profile: 'My profile',
  day_end: 'End the day',
  open_map: '📍 Open map',
  reached: 'I have reached',
  will_be_late: 'I will be late',
  work_done: 'Work done',
  i_left: 'I have left, tell the customer',
  no_wa: 'No WhatsApp · call',
  call_tell: 'Call the customer and tell them',
  call: 'Call',
  cust_yes: 'Customer agrees ✓',
  cust_no: 'Customer does not agree ✗',
  saved_ok: 'Saved ✓',
  receipt_in_person: 'No WhatsApp: tell the receipt in person',
  collector: 'Collection',
  collector_team: 'Payment collection team',
  ledger: 'To collect',
  today_collection: "Today's collection",
  take_payment: 'Take payment',
  total_due: 'Total due',
  other_area: 'Other area',
  status: { new: 'New', assigned: 'To do', delayed: 'Late', reached: 'Working', done: 'Done', moved: 'Moved', ongoing: 'Ongoing (again tomorrow)' },
  soon_driver: 'The driver screen is coming soon (B7).',
  soon_collector: 'The collection screen is coming soon (B8).',
  day_of: (k, n) => 'Day ' + k + ' / ' + n,
  day_done: "Today's work done",
  job_done: 'Whole job done',
  ongoing: 'Ongoing job',
  supervisor: 'Supervisor',
  surveys: 'Surveys',
  sent_surveys: 'Sent',
  send_measure: 'Send sizes',
  partition_hint: 'Partition with 2 entry points: measure each part and enter it as a separate tank.',
  refresh: 'Refresh',
  office: 'Office',
  customer: 'Customer',
  today: 'Today',
  back_to_list: 'Back to the list',
  updating: 'updating…',
  sending: 'Sending…',
  not_sent_retry: 'Not sent · send again',
  note: 'Note',
  time: 'Time',
  address: 'Address',
  area: 'Area',
  type: 'Type',
  phone: 'Phone',
  call_short: 'Call',
  call_aria: 'Call',
  map_short: 'Map',
  litres: 'litres',
  tank_sizes: 'Tank sizes',
  lang_other: 'ગુજરાતી',
  lang_label: 'Language',
  // ---- DRIVER words (usability round, added 2026-10-08) ----
  cf_yes: 'Yes, all fine',
  cf_no: 'No, complaint',
  size_diff: 'Size is different',
  office_informed: 'Office informed ✓',
  tick_first: 'Tick the work above first ↑',
  day_done_btn: '🌙 Done for today, back tomorrow',
  job_done_btn: '✅ Whole job finished',
  call_these: 'Call these customers'
};

/* What the customer is told, in English (only for the "In English: …" lines; the customer
   always gets the Gujarati words, the same as the WhatsApp templates in apps-script/whatsapp.gs). */
const CUST_EN = {
  reached: 'Our team has reached.',
  eta: time => 'We will reach by about ' + time + '.',
  delay: (m, reason, time) => 'Sorry, our team will reach about ' + m + ' minutes late. Reason: ' + reason + '.' +
    (time ? ' We will reach by about ' + time + '.' : ''),
  done: (done, notDone) => 'Work done: ' + done + '.' + (notDone ? ' Still to do: ' + notDone + '.' : '') + ' Is the work all right?',
  moved: (when, reason) => 'Your job has been moved to ' + when + '.' + (reason ? ' Reason: ' + reason + '.' : ''),
  receipt: (amt, bal) => inr(amt) + ' received, thank you.' + (bal > 0 ? ' Balance ' + inr(bal) + '.' : ' Fully paid.')
};

/* TX = the words in the chosen language: TX.reached is "હું પહોંચી ગયો" or "I have reached".
   (A Proxy looks the word up in EN or GU every time it is read, so a switch takes effect
   at once. A word missing in EN falls back to Gujarati.) */
const TX = new Proxy(GU, { get: (gu, k) => (uiLangNow === 'en' && k in EN ? EN[k] : gu[k]) });

/* ---------- tank sizes (log book, added 2026-10-08; material added 2026-10-08) ----------
   A tank, as the server sends it:
     {type:'OH'|'UG', material:'cement'|'plastic', litres, l, w, h, count, total_litres}
   (the paper log book writes "2000 = 1" or "1.40 x 1.60 x 2.10 = OH").
   litres is null when the size in metres (l, w, h) is given.
   OH = overhead (ઉપરની), UG = underground (અંડરગ્રાઉન્ડ): the POSITION, for the log book.
   material = what it is made of; the PRICE depends on it (rate card in the Settings tab).
   Old saved tanks without a material are cement.
   A partitioned cement tank with 2 entry points is measured and entered as 2 tanks. */
const TANK_TYPE = { OH: { en: 'OH', gu: 'ઉપરની' }, UG: { en: 'UG', gu: 'અંડરગ્રાઉન્ડ' } };
const TANK_MAT = { cement: { en: 'Cement', gu: 'સિમેન્ટ' }, plastic: { en: 'Plastic', gu: 'પ્લાસ્ટિક' } };
// The material of a tank: 'cement' (also for old tanks saved without one) or 'plastic'
const tankMat = t => (t && String(t.material || '').toLowerCase() === 'plastic') ? 'plastic' : 'cement';
// Litres of ONE tank: the capacity, else l x w x h metres x 1000 (rounded). Same rule as orders.gs.
const tankLitres = t => {
  if (!t) return 0;
  if (t.litres !== null && t.litres !== undefined && t.litres !== '') return Number(t.litres) || 0;
  if (t.l && t.w && t.h) return Math.round(Number(t.l) * Number(t.w) * Number(t.h) * 1000);
  return 0;
};
// All tanks of one size together (litres x count)
const tankTotal = t => tankLitres(t) * (Number(t && t.count) || 1);
// Litres with Indian commas: 4704 -> "4,704"
const litresText = n => Math.round(Number(n) || 0).toLocaleString('en-IN');
// Metres with two decimals, as on paper: 1.4 -> "1.40"
const metres = n => (Number(n) || 0).toFixed(2);
const tankHasSize = t => !!(t && t.l && t.w && t.h && (t.litres === null || t.litres === undefined || t.litres === ''));
// Partition (added 8 Oct 2026, SUPERVISOR agent): " · part 2 of tank 3" when the tank is a part of an earlier one
// (part_of = that tank's number, part_no worked out by the server)
const tankPart = (t, lang) => !(t && Number(t.part_of) > 0) ? ''
  : lang === 'gu' ? ' · ટાંકી ' + t.part_of + ' નો ભાગ ' + (t.part_no || 2) : ' · part ' + (t.part_no || 2) + ' of tank ' + t.part_of;
/**
 * One tank as one line (English, admin and log book), with the material at the end:
 *   capacity: "2,000 L × 1 = OH · Cement"
 *   size:     "1.40 × 1.60 × 2.10 m = OH (4,704 L) · Cement"   (with "× 2" before "=" when there are 2)
 */
function tankText(t) {
  const n = Number(t.count) || 1, type = (TANK_TYPE[t.type] || { en: t.type || '' }).en, mat = ' · ' + TANK_MAT[tankMat(t)].en + tankPart(t, 'en');
  if (tankHasSize(t)) {
    return metres(t.l) + ' × ' + metres(t.w) + ' × ' + metres(t.h) + ' m' + (n > 1 ? ' × ' + n : '') + ' = ' + type +
      ' (' + litresText(tankTotal(t)) + ' L)' + mat;
  }
  return litresText(tankLitres(t)) + ' L × ' + n + ' = ' + type + mat;
}
// The same in Gujarati words (driver and supervisor screens): "ઉપરની · સિમેન્ટ: 2,000 લિટર × 1"
function tankTextGu(t) {
  const n = Number(t.count) || 1, type = (TANK_TYPE[t.type] || { gu: t.type || '' }).gu + ' · ' + TANK_MAT[tankMat(t)].gu + tankPart(t, 'gu');
  if (tankHasSize(t)) {
    return type + ': ' + metres(t.l) + ' × ' + metres(t.w) + ' × ' + metres(t.h) + ' મી.' + (n > 1 ? ' × ' + n : '') +
      ' = ' + litresText(tankTotal(t)) + ' લિટર';
  }
  return type + ': ' + litresText(tankLitres(t)) + ' લિટર × ' + n;
}
// The tank line for the staff phone screens, in the chosen language
const tankTextT = t => (uiLangNow === 'en' ? tankText(t) : tankTextGu(t));
// Short list for one line: "2,000 L × 1 = OH · Cement; 1.40 × 1.60 × 2.10 m = OH (4,704 L) · Cement"
const tanksLine = list => (list || []).map(tankText).join('; ');
// Total litres of a list of tanks
const tanksTotal = list => (list || []).reduce((a, t) => a + tankTotal(t), 0);

/* ---------- jobs that last several days (added 2026-10-08) ----------
   An order has days (1 to 10, blank = 1). It runs from sched_date to
   sched_date + days - 1. A multi-day job that is not finished keeps showing
   on every day until it is done (even after its planned last day).
   work_days = the days already worked: [{date, reached, left, overtime_min}]
   (an entry with left '' is the day in progress). Same rules as orders.gs. */
const jobDays = o => Math.max(1, Math.min(10, Math.round(Number(o && o.days) || 1)));
// The planned last day: "2026-10-09" for a 3-day job starting "2026-10-07"
const jobEnd = o => addD(o.sched_date, jobDays(o) - 1);
const jobOpen = o => !!o && o.status !== 'done' && o.status !== 'cancelled';
/** Is the job "on" date d? One-day jobs: only on their date (as before). */
function jobOnDate(o, d) {
  if (!o || !o.sched_date) return false;
  if (jobDays(o) <= 1) return o.sched_date === d;
  return (o.sched_date <= d && d <= jobEnd(o)) || (jobOpen(o) && o.sched_date <= d && d <= todayIso());
}
/** Is the job on any day from 'from' to 'to'? (either may be blank = no limit) */
function jobInRange(o, from, to) {
  if (!o || !o.sched_date) return false;
  if (jobDays(o) <= 1) return (!from || o.sched_date >= from) && (!to || o.sched_date <= to);
  let end = jobEnd(o);
  if (jobOpen(o) && todayIso() > end) end = todayIso();
  return (!to || o.sched_date <= to) && (!from || end >= from);
}
// Day number of date d in the job: the start date is day 1
const jobDayNo = (o, d) => daysBetween(o.sched_date, d) + 1;
// The days worked so far, as a list (the server may send it as JSON text)
function workDays(o) {
  const v = o && o.work_days;
  if (Array.isArray(v)) return v;
  if (!v) return [];
  try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch (e) { return []; }
}
