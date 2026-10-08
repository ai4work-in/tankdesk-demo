/* ==========================================================================
   supervisor.js: the SUPERVISOR screens (Gujarati, or English when chosen), added 2026-10-08.
   The supervisor visits a client BEFORE the cleaning, measures every tank and
   sends the measurements. The office then makes the quotation (price) and
   sends it to the client. The supervisor never sees any money.

     todo ("સર્વે")     a chat list of the survey visits still to measure
     done ("મોકલેલા")   the ones sent in the last 7 days
   Tap a visit -> a chat: the office's message (address, phone, time, note),
   the shared tank editor (tank-editor.js), a note box, and [માપ મોકલો].
   Like the driver: the message shows at once, a 5-second "રદ કરો" bar lets the
   supervisor take it back, then it goes to the server (survey.submit).

   Uses shared helpers from driver.js (loaded before this file): guErr,
   telUrl, drHold (the 5-second undo), drFlush, Phone.reload, areaT, typeT,
   and from common.js: labT, tr, TX (the words in Gujarati or English).
   Server: order.list (surveys only, no money), survey.submit {order_id, tanks, notes}.
   ========================================================================== */

const SV = {
  orders: null,     // the survey visits (null = not loaded yet)
  loading: false,
  again: false,     // a reload was asked for while one was running
  error: '',
  chat: null,       // order_id of the open chat
  chatHtml: '',     // what the open chat shows now (to skip redrawing when nothing changed)
  notes: {},        // order_id -> the note being typed
  pending: {},      // order_id -> {state:'wait'|'sending'|'sent'|'failed', at, tanks, notes}
  token: ''         // which login the data belongs to
};
const svKey = id => 'sv:' + id;   // the tank editor of one survey

/* The note being typed is kept on the phone too (like the tanks, tank-editor.js save:true):
   the phone may close the browser after a call or the map. Cleared after a successful send. */
const SV_NOTE = 'tankdesk-svnote:';
function svNoteKeep(id, text) {
  try { if (text) localStorage.setItem(SV_NOTE + id, text); else localStorage.removeItem(SV_NOTE + id); } catch (e) { /* private mode: kept until the page closes */ }
}
function svNoteKept(id) { try { return localStorage.getItem(SV_NOTE + id) || ''; } catch (e) { return ''; } }
// The supervisor's own lines in the order notes ("Supervisor: ..." added by survey.submit) and the office's lines
const SV_NL = String.fromCharCode(10);   // a line break
const svMyNotes = notes => String(notes || '').split(SV_NL).filter(l => /^Supervisor: /.test(l)).map(l => l.replace(/^Supervisor: /, '')).join(SV_NL);
const svOfficeNotes = notes => String(notes || '').split(SV_NL).filter(l => !/^Supervisor: /.test(l)).join(SV_NL).trim();
// A survey that is measured (in the fresh list): nothing typed for it needs keeping any more
function svForgetDone() {
  (SV.orders || []).forEach(o => {
    if (o.status === 'done' && !SV.pending[o.order_id]) { TankEd.clear(svKey(o.order_id)); svNoteKeep(o.order_id, ''); }
  });
}

// The surveys as the supervisor should see them: a measurement just sent shows as sent at once
function svList() {
  return (SV.orders || []).map(o => {
    const p = SV.pending[o.order_id];
    if (!p || p.state === 'failed' || o.status === 'done') return o;
    return Object.assign({}, o, { status: 'done', tanks: p.tanks.map(t => Object.assign({}, t, { total_litres: tankTotal(t) })) });
  });
}
const svOrder = id => svList().find(o => String(o.order_id) === String(id));
const svBusy = id => { const p = SV.pending[id]; return !!(p && (p.state === 'wait' || p.state === 'sending')); };

/* ---------- load ---------- */
async function svLoad() {
  if (SV.loading) { SV.again = true; return; }
  SV.loading = true;
  const tok = App.session && App.session.token;
  try {
    await apiCached('order.list', {}, (data, fresh) => {
      if (!App.session || App.session.token !== tok) return;
      SV.orders = data.orders || [];
      SV.token = tok;
      if (fresh) { svClearSent(); svForgetDone(); }
      svShow();
    });
    SV.error = '';
    svClearSent();
  } catch (e) {
    SV.loading = false;
    if (guCode(e) === 'AUTH') return;
    SV.error = guErr(e);
    svShow();
    return;
  }
  SV.loading = false;
  if (SV.again) { SV.again = false; return svLoad(); }
  svShow();
}
// Sent measurements are in the fresh list now: forget the "just sent" copies
function svClearSent() {
  Object.keys(SV.pending).forEach(id => {
    const o = (SV.orders || []).find(x => String(x.order_id) === String(id));
    if (SV.pending[id].state === 'sent' && o && o.status === 'done') delete SV.pending[id];
  });
}
Phone.reload.supervisor = svLoad;
// Language switched (app.js): the open survey chat and the undo bar in the new words
Phone.relang.supervisor = () => {
  if (SV.chat != null && WA.chatOpen()) svShowChat(SV.chat, 'force');
  drUndoRelang();
};

// Draw the list again (and the open chat), if the supervisor is still on a supervisor page
function svShow(how) {
  if (!App.session || App.session.role !== 'supervisor' || $('#v-phone').hidden) return;
  const el = $('#ph-body'), top = el.scrollTop;
  renderPhone();
  el.scrollTop = top;
  if (SV.chat != null && WA.chatOpen()) svShowChat(SV.chat, how || 'auto');
}

// Common start of every supervisor page: loading / error / data
function svReady(el) {
  el.classList.remove('pad');
  if (SV.token !== App.session.token) {
    drUndoClear();   // an old login's waiting action is dropped
    Object.assign(SV, { orders: null, error: '', chat: null, chatHtml: '', notes: {}, pending: {}, token: App.session.token });
    TankEd.resetAll('sv:');
    WA.closeChat();
  }
  if (SV.orders) return true;
  if (SV.error) el.innerHTML = '<div class="dr-pad"><div class="box bad">' + esc(SV.error) + '</div><button class="btn lg" data-act="ph-refresh">' + TX.try_again + '</button></div>';
  else { el.innerHTML = '<div class="dr-pad"><div class="empty">' + TX.loading + '</div></div>'; svLoad(); }
  return false;
}

const byWhen = (a, b) => a.sched_date === b.sched_date ? mins(a.sched_time) - mins(b.sched_time) : (a.sched_date < b.sched_date ? -1 : 1);
// "today" or the date
const svDay = d => d === todayIso() ? TX.today : labT(d);

// One chat-list row
function svRow(o, done) {
  const n = (o.tanks || []).reduce((a, t) => a + (Number(t.count) || 1), 0);
  return WA.row({
    name: o.client_name,
    time: done ? svDay(o.sched_date) : svDay(o.sched_date) + ' · ' + fm(mins(o.sched_time)),
    timeHot: !done && o.sched_date === todayIso(),
    preview: done
      ? '<span class="dr-st ok">' + tr('✓✓ માપ મોકલ્યું', '✓✓ Sizes sent') + '</span> · ' + tr(n + ' ટાંકી', n + (n === 1 ? ' tank' : ' tanks')) + ' · ' +
        esc(litresText(tanksTotal(o.tanks))) + ' ' + TX.litres
      : (o.sched_date < todayIso() ? '<span class="dr-st bad">' + tr('બાકી', 'Overdue') + '</span> · ' : '') + esc(areaT(o.area)) + ' · ' + esc(o.address || ''),
    act: 'sv-open', data: { id: o.order_id }, avatarColor: WA.colorFor(o.client_name)
  });
}

/* ---------- page: surveys to measure ---------- */
registerScreen('supervisor', 'todo', el => {
  if (!svReady(el)) return;
  const L = svList().filter(o => o.status !== 'done').sort(byWhen);
  setTabCount('todo', L.length);
  let h = WA.sec(tr(L.length + ' સર્વે બાકી', L.length + (L.length === 1 ? ' survey' : ' surveys') + ' to do'));
  if (SV.error) h += '<div class="dr-pad"><div class="box bad">' + esc(SV.error) + '</div></div>';
  h += L.length ? '<div class="wa-list">' + L.map(o => svRow(o, false)).join('') + '</div>'
    : '<div class="dr-pad"><div class="empty">' + tr('હમણાં કોઈ સર્વે બાકી નથી.', 'No surveys to do right now.') + '</div></div>';
  el.innerHTML = h;
});

/* ---------- page: measurements already sent (last 7 days) ---------- */
registerScreen('supervisor', 'done', el => {
  if (!svReady(el)) return;
  setTabCount('todo', svList().filter(o => o.status !== 'done').length);
  const L = svList().filter(o => o.status === 'done').sort(byWhen).reverse();
  el.innerHTML = L.length ? WA.sec(tr('છેલ્લા 7 દિવસ', 'Last 7 days')) + '<div class="wa-list">' + L.map(o => svRow(o, true)).join('') + '</div>'
    : '<div class="dr-pad"><div class="empty">' + tr('હજી કોઈ માપ મોકલ્યું નથી.', 'No sizes sent yet.') + '</div></div>';
});

/* ---------- the survey chat ---------- */
function svChatParts(o) {
  const id = o.order_id, p = SV.pending[id];
  const head = WA.chatHead({
    title: o.client_name,
    sub: areaT(o.area) + ' · ' + svDay(o.sched_date) + ' · ' + fm(mins(o.sched_time)),
    back: 'sv-back',
    avatarColor: WA.colorFor(o.client_name),
    right: '<a class="wa-ib dr-hb" href="' + esc(telUrl(o.phone)) + '" aria-label="' + esc(TX.call_aria) + '">' + WA.icons.call + '<span>' + TX.call_short + '</span></a>' +
      '<a class="wa-ib dr-hb" href="' + esc(mapUrl(o)) + '" target="_blank" rel="noopener" aria-label="' + esc(tr('નકશો ખોલો', 'Open map')) + '">' + WA.icons.map + '<span>' + TX.map_short + '</span></a>'
  });
  const kv = (k, v) => v ? '<dt>' + k + '</dt><dd>' + v + '</dd>' : '';
  let m = WA.day(svDay(o.sched_date)) +
    WA.bubble('in', '<b>' + tr('ટાંકીનું માપ લેવા જવાનું છે', 'Go and measure the tanks') + '</b><dl class="kv">' +
      kv(TX.time, esc(svDay(o.sched_date) + ' · ' + fm(mins(o.sched_time)))) +
      kv(TX.customer, esc(o.client_name)) +
      kv(TX.address, esc(o.address)) +
      kv(TX.area, esc(areaT(o.area))) +
      kv(TX.type, esc(typeT(o.client_type))) +
      kv(TX.phone, '<a href="' + telUrl(o.phone) + '">' + esc(phoneText(o.phone)) + '</a>') + '</dl>' +
      '<div class="sub">' + tr('દરેક ટાંકી માપો. ઓફિસ તેના પરથી ભાવ નક્કી કરીને ગ્રાહકને મોકલશે.', 'Measure every tank. The office will work out the price and send it to the customer.') + '</div>', '', { who: TX.office });
  // The office's note (the supervisor's own note shows in the outgoing bubble below, not here)
  const offNote = svOfficeNotes(o.notes), myNote = p && p.notes ? p.notes : svMyNotes(o.notes);
  if (offNote) m += WA.bubble('in', '<b>' + TX.note + ':</b> ' + esc(offNote), '', { who: TX.office, cls: 'warn' });

  const tanksHtml = list => (list || []).map(t => '<span class="dr-tkline">' + esc(tankTextT(t)) + '</span>').join('') +
    ((list || []).length > 1 ? '<span class="dr-tkline"><b>' + tr('કુલ ', 'Total ') + litresText(tanksTotal(list)) + ' ' + TX.litres + '</b></span>' : '');
  let bottom = '';
  if (o.status === 'done') {
    // Sent (or being sent): the measurements as an outgoing message
    const sending = svBusy(id);
    const b = WA.bubble('out', '<b>' + TX.tank_sizes + '</b><div class="dr-crewl">' + tanksHtml(o.tanks) + '</div>' +
      (myNote ? '<div class="sv-mynote"><b>' + TX.note + ':</b> ' + esc(myNote) + '</div>' : ''), p ? fm(p.at) : '', { ticks: 2 });
    m += sending ? b.replace(WA.icons.ticks, '<i class="dr-clock" aria-label="' + esc(TX.sending) + '">' + ICON_CLOCK + '</i>') : b;
    if (!sending) m += WA.bubble('in', tr('માપ મળી ગયું ✓<br>ઓફિસ ભાવ નક્કી કરીને ગ્રાહકને મોકલશે.', 'Sizes received ✓<br>The office will work out the price and send it to the customer.'), '', { who: TX.office });
    bottom = WA.quick([{ label: TX.back_to_list, act: 'sv-back', cls: 'full', disabled: sending }]);
  } else {
    if (p && p.state === 'failed') {
      m += WA.bubble('out', '<b>' + TX.tank_sizes + '</b><div class="dr-crewl">' + tanksHtml(p.tanks) + '</div>' +
        (p.notes ? '<div class="sv-mynote"><b>' + TX.note + ':</b> ' + esc(p.notes) + '</div>' : '') +
        '<button class="dr-retry" data-act="sv-retry" data-id="' + id + '">⚠ ' + TX.not_sent_retry + '</button>', fm(p.at), { cls: 'bad dr-fail' });
    }
    m += WA.bubble('in', '<b class="dr-tk-t">' + TX.tank_sizes + '</b>' +
      '<div class="sub">' + tr('દરેક ટાંકી: ઉપરની કે અંડરગ્રાઉન્ડ, સિમેન્ટ કે પ્લાસ્ટિક, પછી લિટર અથવા માપ (મીટર).',
        'Each tank: overhead or underground, cement or plastic, then litres or size (metres).') + '</div>' +
      TankEd.html(svKey(id), o.tanks, { lang: uiLang(), save: true }) +   // save: typed sizes stay on the phone
      '<label class="sv-note"><span class="dr-lbl">' + tr('નોંધ (જરૂરી હોય તો)', 'Note (if needed)') + '</span>' +
      '<textarea rows="2" data-inp="sv-note" data-id="' + id + '" placeholder="' + esc(tr('જેમ કે: ટાંકી સુધી જવા સીડી જોઈએ', 'e.g. a ladder is needed to reach the tank')) + '">' + esc(svNoteText(id)) + '</textarea></label>',
      '', { who: TX.office, cls: 'dr-log' });
    bottom = WA.quick([{ label: TX.send_measure, act: 'sv-send', data: { id: id }, cls: 'pri full', icon: 'send' }]);
  }
  return { head: head, msgs: m, bottom: bottom };
}

// how: 'open' | 'force' (after an action) | 'auto' (refresh: only when something changed, never while typing)
function svShowChat(id, how) {
  const o = svOrder(id);
  if (!o) {
    if (WA.chatOpen()) { svCloseChat(); toast(tr('આ સર્વે હવે તમારી યાદીમાં નથી.', 'This survey is no longer in your list.')); }
    return;
  }
  const p = svChatParts(o), html = p.head + p.msgs + p.bottom;
  if (how === 'auto' && html === SV.chatHtml) return;
  const f = document.activeElement;
  if (how === 'auto' && f && (f.tagName === 'INPUT' || f.tagName === 'TEXTAREA') && f.closest && f.closest('#ph-chat')) return;
  WA.openChat(p.head, p.msgs, p.bottom);
  SV.chat = o.order_id;
  SV.chatHtml = html;
}
function svCloseChat() {
  drFlush();   // a measurement still in its undo window is sent now, never lost
  WA.closeChat();
  SV.chat = null; SV.chatHtml = '';
}
onAct('sv-open', btn => {
  drFlush();
  svShowChat(btn.dataset.id, 'open');
  if (WA.chatOpen()) WA.pushBack();
});
onAct('sv-back', () => { svCloseChat(); svShow(); });
window.addEventListener('popstate', () => { if (!WA.chatOpen() && SV.chat != null) { drFlush(); SV.chat = null; SV.chatHtml = ''; } });
onInp('sv-note', el => { SV.notes[el.dataset.id] = el.value; svNoteKeep(el.dataset.id, el.value); });
// The note being typed: this session's, else the one kept on the phone
const svNoteText = id => (SV.notes[id] !== undefined ? SV.notes[id] : svNoteKept(id));

/* ---------- [માપ મોકલો]: send the measurements (5-second undo, then survey.submit) ---------- */
onAct('sv-send', btn => {
  const id = btn.dataset.id, o = svOrder(id);
  if (!o || svBusy(id)) return;
  const tk = TankEd.out(svKey(id));
  // A problem shows inline at the tank (red border, scrolled into view): no toast on top of it
  if (tk.error) { TankEd.setError(svKey(id), tk.error); return; }
  if (!tk.tanks.length) { TankEd.setError(svKey(id), tr('ઓછામાં ઓછી એક ટાંકીનું માપ લખો.', 'Enter the size of at least one tank.')); return; }
  const p = SV.pending[id] = { state: 'wait', at: nowMin(), tanks: tk.tanks, notes: String(svNoteText(id) || '').trim() };
  svShow('force');
  svShowChat(id, 'force');
  // Nothing goes to a customer: the undo bar says "will be saved"
  drHold(() => svPost(id, p), () => { if (SV.pending[id] === p) delete SV.pending[id]; svShow('force'); }, true);
});
onAct('sv-retry', btn => {
  const id = btn.dataset.id, p = SV.pending[id];
  if (!p || p.state !== 'failed') return;
  const np = SV.pending[id] = Object.assign({}, p, { state: 'sending', at: nowMin() });
  svShow('force');
  svPost(id, np);
});

async function svPost(id, p) {
  if (SV.pending[id] !== p) return;
  p.state = 'sending';
  try {
    await api('survey.submit', { order_id: Number(id), tanks: p.tanks, notes: p.notes });
    if (SV.pending[id] !== p) return;
    p.state = 'sent';
    TankEd.clear(svKey(id));   // sent: the copy kept on the phone is not needed any more
    delete SV.notes[id];
    svNoteKeep(id, '');
    if (!WA.chatOpen()) toast(tr('માપ ઓફિસને મોકલ્યું ✓', 'Sizes sent to the office ✓'));
  } catch (e) {
    if (guCode(e) === 'AUTH' || SV.pending[id] !== p) return;
    if (guCode(e) === 'BAD_STATUS') { delete SV.pending[id]; toast(guErr(e)); }
    else { p.state = 'failed'; toast(guErr(e)); }
  }
  if (!App.session) return;
  svShow('force');
  cacheDrop(['order.list']);
  svLoad();
}
