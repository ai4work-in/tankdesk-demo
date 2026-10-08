/* ==========================================================================
   chat.js: small helpers that build the WhatsApp-style pieces as HTML text.
   Every screen (admin, driver, collector) uses these, so they all look alike.
   Styles are in chat.css.

   Examples:
     WA.row({name:'Hiren Patel', time:'10:30', preview:'Vesu · Overhead tank', badge:1, act:'open-job', data:{id:1042}})
     WA.bubble('in',  'Job details…', '9:00 AM')
     WA.bubble('out', 'I have reached', '9:05 AM', {ticks:2})
     WA.day('Today')        WA.sys('Customer said NO')
     WA.quick([{label:'Reached', act:'reach', data:{id:1042}, cls:'pri'}])
   ========================================================================== */

const WA = {};

/* ---------- icons (simple line drawings, no image files needed) ---------- */
WA.icons = {
  back:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
  more:    '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
  call:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
  map:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  plus:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  send:    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 20.5 21 12 3 3.5v6.6L15 12 3 13.9z"/></svg>',
  // Admin menu icons
  dash:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  neworder:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v6M9 15h6"/></svg>',
  orders:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/></svg>',
  clients: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/></svg>',
  cal:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  routes:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5"/></svg>',
  pay:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12M6 9h12M10 4c3.5 0 5.5 1.7 5.5 4.5S13.5 13 10 13H7l8 7"/></svg>',
  overtime:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>',
  // an open notebook (Log book)
  logbook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z"/><path d="M6 3v18M4 7h4M4 12h4M4 17h4M11 8h5M11 12h5"/></svg>',
  reports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v16h16"/><path d="M8.5 16v-4M12.5 16V8M16.5 16v-6"/></svg>',
  logout:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  search:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  // two ticks = done / delivered (like a delivered message)
  ticks:   '<svg viewBox="0 0 18 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6l3 3 6-7M7 9l1 1 6-8"/></svg>',
  tick:    '<svg viewBox="0 0 18 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l3 3 6-7"/></svg>'
};

/* ---------- small helpers ---------- */

// "Hiren Patel" -> "HP", "Sky Heights Society" -> "SH"
WA.initials = function (name) {
  const w = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((w[0] || '?')[0] + (w.length > 1 ? w[1][0] : '')).toUpperCase();
};

// A steady colour per name, so the same client always gets the same circle colour
WA.colorFor = function (name) {
  const cols = ['#437A2B', '#0F9D8A', '#7A5AF0', '#D9730D', '#C2368A', '#2E7D32', '#5C6BC0', '#00838F'];
  let h = 0; String(name || '').split('').forEach(c => { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
  return cols[h % cols.length];
};

// data-* attributes from an object: {id:5, phone:'91..'} -> ' data-id="5" data-phone="91.."'
WA.dataAttrs = function (data) {
  return Object.keys(data || {}).map(k => ' data-' + k + '="' + esc(data[k]) + '"').join('');
};

/* ---------- building blocks ---------- */

// Round initials. opts.color overrides the colour, opts.icon puts an icon inside instead.
WA.avatar = function (name, opts) {
  opts = opts || {};
  return '<span class="wa-av' + (opts.small ? ' sm' : '') + '" style="--av:' + (opts.color || WA.colorFor(name)) + '" aria-hidden="true">' +
    (opts.icon || esc(WA.initials(name))) + '</span>';
};

/**
 * One chat-list row.
 * o = {name, time, timeHot, preview (HTML allowed, escape it yourself), badge, badgeCls,
 *      act, data, current, avatarColor, avatarIcon}
 */
WA.row = function (o) {
  return '<button class="wa-row" data-act="' + esc(o.act || '') + '"' + WA.dataAttrs(o.data) +
    (o.current ? ' aria-current="true"' : '') + '>' +
    WA.avatar(o.name, { color: o.avatarColor, icon: o.avatarIcon }) +
    '<span class="mid"><span class="l1"><span class="nm">' + esc(o.name) + '</span>' +
    (o.time ? '<span class="tm' + (o.timeHot ? ' hot' : '') + '">' + esc(o.time) + '</span>' : '') + '</span>' +
    '<span class="l2"><span class="pv">' + (o.preview || '') + '</span>' +
    (o.badge ? '<span class="bd ' + (o.badgeCls || '') + '">' + esc(o.badge) + '</span>' : '') + '</span></span></button>';
};

/**
 * One message bubble.
 * dir = 'in' (left, white: office/system) or 'out' (right, blue: what this user did)
 * html = content (escape it yourself), time = small time text
 * opts = {who: name shown on top, ticks: 1 or 2, cls: 'bad' | 'warn'}
 */
WA.bubble = function (dir, html, time, opts) {
  opts = opts || {};
  const ticks = opts.ticks === 2 ? WA.icons.ticks : opts.ticks === 1 ? WA.icons.tick : '';
  return '<div class="bub ' + dir + (opts.cls ? ' ' + opts.cls : '') + '">' +
    (opts.who ? '<span class="who">' + esc(opts.who) + '</span>' : '') + html +
    ((time || ticks) ? '<span class="meta">' + esc(time || '') + ticks + '</span>' : '') + '</div>';
};

WA.day = label => '<div class="wa-day">' + esc(label) + '</div>';
WA.sys = text => '<div class="wa-sys">' + esc(text) + '</div>';
WA.sec = label => '<div class="wa-sec">' + esc(label) + '</div>';

/**
 * Quick-reply buttons at the bottom of a chat.
 * btns = [{label, act, data, cls:'pri'|'bad'|'full', href, icon, disabled}]
 * A button with href becomes a link (for Call and Map).
 */
WA.quick = function (btns) {
  return '<div class="wa-qr">' + btns.filter(Boolean).map(b => {
    const inner = (b.icon ? WA.icons[b.icon] || '' : '') + '<span>' + esc(b.label) + '</span>';
    if (b.href) return '<a class="' + (b.cls || '') + '" href="' + esc(b.href) + '"' + (/^https?:/.test(b.href) ? ' target="_blank" rel="noopener"' : '') + '>' + inner + '</a>';
    return '<button class="' + (b.cls || '') + '" data-act="' + esc(b.act) + '"' + WA.dataAttrs(b.data) + (b.disabled ? ' disabled' : '') + '>' + inner + '</button>';
  }).join('') + '</div>';
};

/**
 * Header bar of a chat: back arrow, initials, name and a second line.
 * o = {title, sub, back: data-act for the back arrow, right: extra HTML (icon buttons)}
 */
WA.chatHead = function (o) {
  return '<div class="wa-head">' +
    (o.back ? '<button class="wa-ib" data-act="' + esc(o.back) + '" aria-label="Back">' + WA.icons.back + '</button>' : '') +
    WA.avatar(o.title, { small: true, color: o.avatarColor }) +
    '<div class="t"><b>' + esc(o.title) + '</b>' + (o.sub ? '<span>' + esc(o.sub) + '</span>' : '') + '</div>' +
    (o.right || '') + '</div>';
};

/* ---------- phone: open and close a chat over the list ---------- */

/**
 * Opens a full-screen chat on the phone.
 * head = WA.chatHead(...), msgs = bubbles HTML, bottom = WA.quick(...) or a compose row
 * The message area scrolls to the newest message, like a real chat.
 */
WA.openChat = function (head, msgs, bottom) {
  const c = $('#ph-chat');
  c.innerHTML = head + '<div class="wa-chat"><div class="wa-msgs" id="wa-msgs">' + msgs + '</div>' + (bottom || '') + '</div>';
  c.hidden = false;
  const m = $('#wa-msgs'); if (m) m.scrollTop = m.scrollHeight;
};
WA.chatOpen = () => !$('#ph-chat').hidden;
WA._pushed = false;   // true while the open chat has added a "back" step to the browser history

/**
 * Closes the chat. If opening it added a back step (WA.pushBack), that step is
 * removed too, so the next press of the phone's back button behaves normally.
 */
WA.closeChat = function () {
  const c = $('#ph-chat'); c.hidden = true; c.innerHTML = '';
  if (WA._pushed) { WA._pushed = false; try { history.back(); } catch (e) { /* ignore */ } }
};
onAct('wa-close', () => WA.closeChat());

// The phone's back button / back gesture closes an open chat instead of leaving the app
window.addEventListener('popstate', () => {
  WA._pushed = false;          // the browser already removed the back step
  if (WA.chatOpen()) WA.closeChat();
});
WA.pushBack = function () {
  if (WA._pushed) return;      // only one back step per open chat
  try { history.pushState({ chat: 1 }, ''); WA._pushed = true; } catch (e) { /* ignore */ }
};
