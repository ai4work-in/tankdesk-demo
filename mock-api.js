/* ==========================================================================
   mock-api.js: a FAKE server for building and demoing the app before the
   real Google Apps Script backend is ready.

   - It follows the API contract in docs/BUILD-PLAN.md section 3 exactly:
     same action names, same request and reply shapes, error 'AUTH' on login problems.
   - It uses the sample data from the mockup (Shuddh Jal Tank Care, Surat).
   - It hides fields by role the same way the real server must:
       driver:    own team's orders only, no amount, no balance
       collector: only order_id, client_name, phone, address, area, balance
   - Data lives in memory only. Reloading the page resets it.
   - PINs (fake server only): Team A-E 1111 to 5555, collector 9090, admin 0000,
     supervisor 7070 (measures tanks before a quotation, added 2026-10-08).
   - Pricing by tank size, surveys + quotations, multi-day jobs and AMC contracts
     (added 2026-10-08) follow the same rules as orders.gs / contracts.gs.

   Uses helpers from common.js (addD, mins, hhmm, nowIso, todayIso, normPhone...).
   ========================================================================== */

const MockAPI = (function () {
  'use strict';

  // Settings you can change while testing, e.g. MockAPI.config.tokenMinutes = 1
  const config = {
    tokenMinutes: 12 * 60   // how long a login lasts (the real server uses 12 hours)
  };

  // Backup / emergency admin PIN (real server: Script Property ADMIN_PIN). Each admin's
  // own PIN is in db.admins (the Admins tab), which is checked first.
  const ADMIN_PIN = '7777';
  const BACKUP_NAME = 'Owner (backup PIN)';   // name shown for the backup PIN (auth.gs)
  const MODES = ['cash', 'upi', 'cheque', 'bank', 'other'];
  const MODES_EN = { cash: 'cash', upi: 'UPI', cheque: 'cheque', bank: 'bank transfer', other: 'other' };
  // same as orders.gs (order.update may set these). 'ongoing' = a multi-day job that has
  // started and has more days to go (treated like 'assigned': the team comes back).
  const STATUSES = ['new', 'assigned', 'reached', 'done', 'delayed', 'ongoing'];
  const OPEN = ['assigned', 'delayed', 'ongoing'];   // a job the team still has to go to
  const CANCELLED = 'cancelled';   // set only by order.cancel, undone by order.restore
  const isCancelled = o => !!o && o.status === CANCELLED;
  // Extra reasons the OFFICE can give when it moves a job (orders.gs MOVE_REASONS).
  // gu = the words put in the customer's "rescheduled" WhatsApp.
  const MOVE_REASONS = {
    customer: { en: 'Customer asked', gu: 'તમારી વિનંતી મુજબ' },   // "as you requested"
    team: { en: 'Team not available', gu: 'અમારી ટીમ ઉપલબ્ધ નથી' },
    weather: { en: 'Weather', gu: 'ખરાબ હવામાન' }
  };
  // Settings a driver or the collector may see (setup.gs STAFF_SETTINGS), plus the
  // travel numbers only a driver gets (setup.gs DRIVER_SETTINGS)
  // (plastic_max_litres is a size limit for the tank editor, not money)
  const STAFF_SETTINGS = ['agency_name', 'office_start', 'office_end', 'ledger_day', 'plastic_max_litres'];
  const DRIVER_SETTINGS = ['min_per_km', 'buffer_min', 'same_area_min', 'unknown_area_min'];

  /* ======================================================================
     SAMPLE DATA (from the mockup). Sample dates are moved so that the
     mockup's "today" (7 Oct 2026) is always the real today.
     ====================================================================== */
  const SEED_TODAY = '2026-10-07';
  const SHIFT = daysBetween(SEED_TODAY, todayIso());
  const d = s => addD(s, SHIFT);   // move a sample date to match today

  const db = {
    settings: {
      office_start: '10:00', office_end: '17:00', min_per_km: 3, buffer_min: 5,
      collector_pin: '9090', owner_phone: '919825000000',
      agency_name: 'Shuddh Jal Tank Care', ledger_day: 'Fri',
      same_area_min: 10,     // travel minutes when both jobs are in the same area
      unknown_area_min: 20,  // travel minutes when an area is missing or unknown
      max_suggest_km: 6,     // "nearby" limit for the team suggestion
      late_alert_min: 10,    // alert the owner when a team is later than this
      reminder_days: 20,     // remind the owner this many days before a client's next visit
      // Supervisor login (measures tanks before a quotation). Change the PIN in the Settings tab.
      supervisor_pin: '7070', supervisor_name: 'Supervisor (sample)',
      // Rate card: price of ONE tank by material and litres (orders.gs tankPrice_)
      cement_base_price: 500,        // cement tank up to cement_base_litres
      cement_base_litres: 5000,
      cement_step_litres: 5000,      // each further step of this many litres...
      cement_step_price: 100,        // ...adds this much
      cement_cap_litres: 25000,      // steps stop here
      cement_extra_per_litre: 0.05,  // above the cap: price at the cap + this per extra litre
      plastic_bands: '500:300, 3000:400, 5000:500',   // "up to litres: price", in order
      plastic_max_litres: 5000       // a bigger plastic tank is refused
    },
    // priced_by: 'tanks' = the price comes from the tank sizes (rate card), 'fixed' = default_price.
    // default_price of the cleaning services is used only when an order has no tanks yet.
    services: [
      { key: 'ot', name_en: 'Overhead tank cleaning', name_gu: 'ઉપરની ટાંકીની સફાઈ', default_price: 1200, active: true, priced_by: 'tanks' },
      { key: 'ug', name_en: 'Underground sump cleaning', name_gu: 'અંડરગ્રાઉન્ડ ટાંકીની સફાઈ', default_price: 2600, active: true, priced_by: 'tanks' },
      { key: 'ab', name_en: 'Antibacterial treatment', name_gu: 'એન્ટિબેક્ટેરિયલ ટ્રીટમેન્ટ', default_price: 450, active: true, priced_by: 'fixed' },
      { key: 'rp', name_en: 'Leakage repair', name_gu: 'ટાંકીમાં લીકેજ રિપેર', default_price: 900, active: true, priced_by: 'fixed' }
    ],
    client_types: [
      // group: hotel, school, college and business are "institution" (as in setup.gs)
      { key: 'apartment', name_en: 'Apartment', name_gu: 'એપાર્ટમેન્ટ', group: 'apartment' },
      { key: 'bungalow', name_en: 'Bungalow', name_gu: 'બંગલો', group: 'bungalow' },
      { key: 'hotel', name_en: 'Hotel', name_gu: 'હોટેલ', group: 'institution' },
      { key: 'school', name_en: 'School', name_gu: 'સ્કૂલ', group: 'institution' },
      { key: 'college', name_en: 'College', name_gu: 'કોલેજ', group: 'institution' },
      { key: 'business', name_en: 'Business', name_gu: 'બિઝનેસ', group: 'institution' }
    ],
    // 'workers' is a proposed column (BUILD-PLAN section 8), used by the driver profile
    teams: [
      // vehicle_no and worker_names (log book, added 2026-10-08): the paper log book's
      // "ગાડી નં." and the workers' names. Team A is the vehicle in the photo (6340).
      { team: 'A', driver_name: 'Ramesh bhai', driver_phone: '919825001001', pin: '1111', areas: '', workers: 2, active: true, vehicle_no: 'GJ-05-6340', worker_names: 'Sagar, Alpesh, Paresh, Nitin' },
      { team: 'B', driver_name: 'Kishan bhai', driver_phone: '919825001002', pin: '2222', areas: '', workers: 3, active: true, vehicle_no: 'GJ-05-4127', worker_names: 'Raju, Mehul, Kalpesh' },
      { team: 'C', driver_name: 'Vijay bhai', driver_phone: '919825001003', pin: '3333', areas: '', workers: 2, active: true, vehicle_no: 'GJ-05-7781', worker_names: 'Jignesh, Bhavesh' },
      { team: 'D', driver_name: 'Mahesh bhai', driver_phone: '919825001004', pin: '4444', areas: '', workers: 2, active: true, vehicle_no: 'GJ-05-2093', worker_names: 'Hitesh, Sanjay' },
      { team: 'E', driver_name: 'Dinesh bhai', driver_phone: '919825001005', pin: '5555', areas: '', workers: 3, active: true, vehicle_no: 'GJ-05-5518', worker_names: 'Prakash, Dilip, Manoj' }
    ],
    // Admins tab: one row per office person, each with their own PIN (never sent to the app)
    admins: [
      { name: 'A P Bhatnagar', pin: '0000', active: true },
      { name: 'Office (sample)', pin: '0001', active: true }
    ],
    // x, y in km (mockup map pixels x 0.04)
    areas: [
      { key: 'katargam', name_en: 'Katargam', name_gu: 'કતારગામ', x: 12.4, y: 2.0 },
      { key: 'varachha', name_en: 'Varachha', name_gu: 'વરાછા', x: 18.4, y: 4.0 },
      { key: 'udhna', name_en: 'Udhna', name_gu: 'ઉધના', x: 19.2, y: 10.0 },
      { key: 'adajan', name_en: 'Adajan', name_gu: 'અડાજણ', x: 4.4, y: 4.8 },
      { key: 'piplod', name_en: 'Piplod', name_gu: 'પીપલોદ', x: 8.0, y: 10.0 },
      { key: 'vesu', name_en: 'Vesu', name_gu: 'વેસુ', x: 4.4, y: 12.0 },
      { key: 'althan', name_en: 'Althan', name_gu: 'અલથાણ', x: 11.6, y: 12.8 }
    ],
    orders: [],
    history: [],    // stands in for the OrderHistory tab (archived orders, archive.gs)
    payments: [],
    ledger: [],
    alerts: [],
    messages: [],   // stands in for the MessageLog tab (fake WhatsApp sends)
    daylog: [],     // stands in for the DayLog tab (log book costs per date and team, admin only)
    contracts: [],  // stands in for the Contracts tab (AMC, admin only, never archived)
    // stands in for the Modules tab (add-on packs, 2026-10-08): one row per pack (repeat, quotation, insights).
    // All on, like seedSample. A missing row (or an empty tab) also counts as ON.
    // The demo URL can change this: ?mock=1&modules=core (all packs off) or
    // ?mock=1&modules=repeat,insights (only those on). See MODULES below.
    modules: [],
    nextAmcNo: 1001,
    nextOrderId: 1055,
    nextPaymentId: 2,
    nextAlertNo: 0   // counter that keeps alert ids unique
  };

  // Mockup orders, in short form:
  // [id, type, client, phone, address, area, services, amount, date, time, team, status, extra]
  // extra: done = services done, doneAt = "h:mm AM", reachedAt = "HH:MM", src, ledger = true if in ledger
  const SEED = [
    [1031, 'bungalow', 'Rajesh Modi', '9825041031', '12, Sargam Society, Althan, Surat', 'althan', ['ot'], 1350, '2026-10-01', '10:00', 'E', 'done', { done: ['ot'], doneAt: '11:20', ledger: true }],
    [1032, 'apartment', 'Sky Heights Society', '9825041032', 'A Wing, Sky Heights, Vesu, Surat', 'vesu', ['ot', 'ab'], 1650, '2026-10-02', '11:00', 'B', 'done', { done: ['ot', 'ab'], doneAt: '12:40', ledger: true }],
    [1033, 'business', 'Gandhi Engineering', '9825041033', 'Plot 44, Udhna Udyog Nagar, Udhna, Surat', 'udhna', ['ug'], 2700, '2026-10-02', '14:00', 'C', 'done', { done: ['ug'], doneAt: '15:35', ledger: true }],
    [1034, 'bungalow', 'Smita Parekh', '9825041034', '7, Rangoli Row House, Adajan, Surat', 'adajan', ['ot', 'ug'], 3900, '2026-10-03', '09:30', 'A', 'done', { done: ['ot', 'ug'], doneAt: '11:55', ledger: true }],
    [1035, 'bungalow', 'Harsh Vora', '9825041035', '22, Green Park, Piplod, Surat', 'piplod', ['ot'], 1250, '2026-10-05', '10:00', 'B', 'done', { done: ['ot'], doneAt: '11:05' }],
    [1036, 'apartment', 'Shreeji Apartment', '9825041036', 'Block C, Shreeji Apartment, Katargam, Surat', 'katargam', ['ot', 'ab'], 1700, '2026-10-05', '14:00', 'D', 'done', { done: ['ot', 'ab'], doneAt: '15:30' }],
    [1037, 'school', 'Sunrise Public School', '9825041037', 'School Road, Varachha, Surat', 'varachha', ['ug'], 2650, '2026-10-06', '09:00', 'C', 'done', { done: ['ug'], doneAt: '11:00' }],
    [1038, 'bungalow', 'Meena Chauhan', '9825041038', '5, Palm Villa, Vesu, Surat', 'vesu', ['ot'], 1350, '2026-10-06', '11:00', 'B', 'done', { done: ['ot'], doneAt: '12:30' }],
    [1039, 'hotel', 'Hotel Riverview', '9825041039', 'Ring Road, Adajan, Surat', 'adajan', ['ot', 'ug', 'ab'], 3850, '2026-10-06', '13:00', 'A', 'done', { done: ['ot', 'ug'], doneAt: '18:10', reachedAt: '16:40' }],
    [1040, 'bungalow', 'Rakesh Vyas', '9825041040', 'Sagar Row House, Katargam, Surat', 'katargam', ['ot'], 1250, SEED_TODAY, '07:00', 'D', 'done', { done: ['ot'], doneAt: '08:05', reachedAt: '07:05' }],
    [1041, 'apartment', 'Shivam Residency', '9825041041', 'B Wing, Shivam Residency, Adajan Gam, Surat', 'adajan', ['ot', 'ug', 'ab'], 4250, SEED_TODAY, '09:00', 'A', 'assigned'],
    [1042, 'bungalow', 'Hiren Patel', '9825041042', 'Patel Villa, Canal Road, Vesu, Surat', 'vesu', ['ot', 'ab'], 1650, SEED_TODAY, '10:30', 'B', 'assigned'],
    [1043, 'apartment', 'Desai Residency', '9825041043', 'Piplod Main Road, Piplod, Surat', 'piplod', ['ug'], 2550, SEED_TODAY, '13:00', 'B', 'assigned'],
    [1044, 'business', 'Joshi Textiles', '9825041044', 'Plot 21, Varachha Road, Varachha, Surat', 'varachha', ['ot', 'ug'], 3950, SEED_TODAY, '10:00', 'C', 'assigned'],
    [1045, 'bungalow', 'Nilesh Shah', '9825041045', 'Shah Bungalow, Adajan Patiya, Adajan, Surat', 'adajan', ['ot'], 1350, SEED_TODAY, '14:30', '', 'new', { src: 'whatsapp' }],
    [1046, 'apartment', 'Laxmi Apartment', '9825041046', 'Flat 9, Laxmi Apartment, Katargam, Surat', 'katargam', ['ot', 'rp'], 2150, SEED_TODAY, '16:00', '', 'new'],
    [1047, 'bungalow', 'Darshan Rana', '9825041047', '14, Shanti Nagar, Althan, Surat', 'althan', ['ot'], 1300, '2026-10-08', '09:30', 'E', 'assigned'],
    [1048, 'college', 'Navjivan College', '9825041048', 'College Road, Vesu, Surat', 'vesu', ['ug', 'ab'], 3050, '2026-10-08', '11:00', 'B', 'assigned'],
    [1049, 'bungalow', 'Vimal Soni', '9825041049', 'Soni House, Adajan Gam, Surat', 'adajan', ['ot'], 1250, '2026-10-08', '15:00', '', 'new', { src: 'whatsapp' }],
    [1050, 'business', 'Kapadia Dyeing Mills', '9825041050', 'GIDC, Udhna, Surat', 'udhna', ['ot', 'ug'], 3800, '2026-10-09', '10:00', 'C', 'assigned'],
    [1051, 'apartment', 'Bhagat Residency', '9825041051', 'Near Water Tank Circle, Katargam, Surat', 'katargam', ['ot'], 1200, '2026-10-09', '12:00', 'D', 'assigned'],
    [1052, 'hotel', 'Hotel Grand Pearl', '9825041052', 'Piplod Circle, Piplod, Surat', 'piplod', ['ug', 'ab'], 3100, '2026-10-10', '09:00', '', 'new'],
    [1053, 'school', 'Little Stars School', '9825041053', 'Varachha Main Road, Varachha, Surat', 'varachha', ['ot', 'ab'], 1700, '2026-10-12', '10:00', '', 'new'],
    [1054, 'bungalow', 'Girish Amin', '9825041054', '9, Vesu Garden, Vesu, Surat', 'vesu', ['ot'], 1300, '2026-10-14', '11:00', 'B', 'assigned'],

    // Older jobs for repeat clients (for the admin "client history" screen).
    // Same phone = same client.
    [1001, 'bungalow', 'Rajesh Modi', '9825041031', '12, Sargam Society, Althan, Surat', 'althan', ['ot'], 1250, '2026-04-10', '10:00', 'E', 'done', { done: ['ot'], doneAt: '11:10', ledger: true }],
    [1008, 'bungalow', 'Rajesh Modi', '9825041031', '12, Sargam Society, Althan, Surat', 'althan', ['ot', 'ab'], 1650, '2026-07-14', '11:00', 'E', 'done', { done: ['ot', 'ab'], doneAt: '12:20', ledger: true }],
    [1002, 'apartment', 'Sky Heights Society', '9825041032', 'A Wing, Sky Heights, Vesu, Surat', 'vesu', ['ot', 'ab'], 1600, '2026-05-05', '11:00', 'B', 'done', { done: ['ot', 'ab'], doneAt: '12:35', ledger: true }],
    [1006, 'apartment', 'Sky Heights Society', '9825041032', 'A Wing, Sky Heights, Vesu, Surat', 'vesu', ['ot'], 1200, '2026-06-20', '10:00', 'B', 'done', { done: ['ot'], doneAt: '11:00', ledger: true }],
    [1009, 'apartment', 'Sky Heights Society', '9825041032', 'A Wing, Sky Heights, Vesu, Surat', 'vesu', ['ot', 'ug'], 3800, '2026-08-25', '10:00', 'B', 'done', { done: ['ot', 'ug'], doneAt: '13:15', ledger: true, dispute: true }],
    [1003, 'hotel', 'Hotel Riverview', '9825041039', 'Ring Road, Adajan, Surat', 'adajan', ['ot', 'ug'], 3700, '2026-05-18', '09:00', 'A', 'done', { done: ['ot', 'ug'], doneAt: '11:40', ledger: true }],
    [1007, 'hotel', 'Hotel Riverview', '9825041039', 'Ring Road, Adajan, Surat', 'adajan', ['ug', 'ab'], 3000, '2026-07-02', '13:00', 'A', 'done', { done: ['ug'], doneAt: '15:20', ledger: true }],
    [1004, 'apartment', 'Shivam Residency', '9825041041', 'B Wing, Shivam Residency, Adajan Gam, Surat', 'adajan', ['ot', 'ug'], 3800, '2026-06-03', '09:00', 'A', 'done', { done: ['ot', 'ug'], doneAt: '11:30', ledger: true }],
    [1010, 'apartment', 'Shivam Residency', '9825041041', 'B Wing, Shivam Residency, Adajan Gam, Surat', 'adajan', ['ot'], 1200, '2026-08-30', '10:00', 'C', 'done', { done: ['ot'], doneAt: '11:05', ledger: true }],

    // Last month's jobs, so the Reports screen has a "vs last month" to compare with
    [1011, 'apartment', 'Gokul Dham Society', '9825041011', 'Gokul Dham, Piplod, Surat', 'piplod', ['ot', 'ab'], 1650, '2026-09-08', '10:00', 'B', 'done', { done: ['ot', 'ab'], doneAt: '11:30', ledger: true }],
    [1012, 'school', 'Sunrise Public School', '9825041037', 'School Road, Varachha, Surat', 'varachha', ['ot'], 1200, '2026-09-15', '16:30', 'C', 'done', { done: ['ot'], doneAt: '17:50', reachedAt: '16:35', ledger: true }],
    [1013, 'bungalow', 'Paresh Desai', '9825041013', '3, Ashirwad Bungalows, Udhna, Surat', 'udhna', ['ot', 'rp'], 2100, '2026-09-22', '11:00', 'D', 'done', { done: ['ot'], doneAt: '12:40', ledger: true }]
  ];

  // Turn the short rows above into full Orders rows (SCHEMA.md column names)
  SEED.forEach(r => {
    const x = r[12] || {};
    const date = d(r[8]);
    const o = blankOrder();
    Object.assign(o, {
      order_id: r[0], created_at: addD(date, -2) + 'T11:00:00',
      client_type: r[1], client_name: r[2], phone: normPhone(r[3]), address: r[4],
      area: r[5], services: r[6], amount: r[7], sched_date: date, sched_time: r[9],
      team: r[10], status: r[11], source: x.src || 'call',
      created_by: x.by || 'A P Bhatnagar'   // who booked it (sample)
    });
    o.map_link = mapUrl(o);
    if (r[11] === 'done') {
      o.done_at = date + 'T' + x.doneAt + ':00';
      o.reached_at = x.reachedAt ? date + 'T' + x.reachedAt + ':00' : '';
      o.done_checklist = x.done;
      o.not_done = o.services.filter(k => !x.done.includes(k));
      o.customer_confirm = x.dispute ? 'no' : 'yes';
      o.dispute = !!x.dispute;
      o.overtime_min = overtimeOf(o);
    }
    db.orders.push(o);
    if (x.ledger) db.ledger.push(ledgerRowFor(o, mondayOf(date)));
  });
  db.orders.sort((a, b) => a.order_id - b.order_id);
  Object.assign(db.orders.find(o => o.order_id === 1011), { delay_min: 15, delay_reason: 'traffic' });   // a late arrival last month
  // Who did what (sample): most orders were booked by A P Bhatnagar (the default above);
  // a few by the second admin, and one edited by someone else, so client history shows it
  [1035, 1042, 1045, 1049].forEach(id => { db.orders.find(o => o.order_id === id).created_by = 'Office (sample)'; });
  db.orders.find(o => o.order_id === 1035).updated_by = 'A P Bhatnagar';

  // Sample next-visit dates (on each client's latest order), so reminders show up:
  // Rajesh Modi overdue, Sky Heights due in ~10 days, Smita Parekh due in ~15 days,
  // Hotel Riverview ~40 days away (not due yet). Shivam Residency's old date is
  // ignored because a newer order (1041) has been booked since.
  const NEXT = { 1031: '2026-10-04', 1032: '2026-10-17', 1034: '2026-10-22', 1039: '2026-11-16', 1010: '2026-10-01' };
  Object.keys(NEXT).forEach(id => { db.orders.find(o => o.order_id === Number(id)).next_visit = d(NEXT[id]); });

  // Sample clients WITHOUT WhatsApp (set on their latest order): staff call them instead.
  // Shivam Residency (Team A, today), Desai Residency (Team B's 2nd job today) and
  // Gandhi Engineering (in the collector's ledger).
  [1041, 1043, 1033].forEach(id => { db.orders.find(o => o.order_id === id).whatsapp = 'no'; });
  // Orders that came in on WhatsApp: the client uses WhatsApp
  db.orders.forEach(o => { if (o.source === 'whatsapp') o.whatsapp = 'yes'; });

  // Sample tank sizes and crew (log book, added 2026-10-08), from the paper log book photo.
  // Stored as in the Sheet: without total_litres (filterForRole adds it).
  const TK = (type, litres, l, w, h, count) => ({ type, litres: litres || null, l: l || null, w: w || null, h: h || null, count: count || 1 });
  [
    [1039, [TK('OH', 2000), TK('UG', 0, 2.0, 1.6, 1.5)], ['Sagar', 'Alpesh', 'Nitin']],       // yesterday, Team A
    [1034, [TK('OH', 1500)], ['Paresh', 'Nitin']],
    [1037, [TK('UG', 0, 1.0, 1.4, 1.7), TK('OH', 1500, 0, 0, 0, 3)], ['Jignesh']],
    [1038, [TK('OH', 1000)], ['Raju', 'Mehul']],
    [1040, [TK('OH', 1000, 0, 0, 0, 2)], ['Hitesh', 'Sanjay']],                                 // today, Team D
    [1010, [TK('OH', 0, 1.4, 1.6, 2.1), TK('UG', 0, 1.5, 1.6, 1.0)], ['Jignesh', 'Bhavesh']],
    // Shivam Residency's job today: pre-filled from the last visit (as order.create copies them)
    [1041, [TK('OH', 0, 1.4, 1.6, 2.1), TK('UG', 0, 1.5, 1.6, 1.0)], []]
  ].forEach(x => { const o = db.orders.find(y => y.order_id === x[0]); o.tanks = x[1]; o.crew = x[2]; });
  // Sample DayLog row: yesterday's costs of Team A's vehicle
  db.daylog.push({ date: d('2026-10-06'), team: 'A', vehicle_no: 'GJ-05-6340', advance: 500, petrol: 300, repair: 0,
    note: 'Puncture checked', updated_by: 'A P Bhatnagar', updated_at: d('2026-10-06') + 'T18:30:00' });

  // Sample payments: [order, date, time, amount, mode]
  [
    [1032, '2026-10-03', '12:30', 1000, 'upi'],
    [1001, '2026-04-12', '11:00', 1250, 'cash'],
    [1008, '2026-07-17', '16:10', 1650, 'upi'],
    [1002, '2026-05-08', '12:00', 1600, 'cheque'],
    [1006, '2026-06-22', '10:45', 1200, 'cash'],
    [1009, '2026-08-29', '15:30', 3000, 'bank'],
    [1003, '2026-05-20', '13:15', 3700, 'bank'],
    [1007, '2026-07-04', '12:00', 2500, 'upi'],
    [1004, '2026-06-05', '11:20', 3800, 'cheque'],
    [1010, '2026-09-02', '17:00', 1200, 'cash'],
    [1011, '2026-09-12', '11:00', 1000, 'upi'],
    [1011, '2026-09-12', '11:05', 650, 'cash'],
    [1012, '2026-09-19', '12:00', 1200, 'cheque'],
    [1013, '2026-09-26', '16:00', 1000, 'cash']
  ].forEach((p, i) => db.payments.push({
    payment_id: 'P' + (i + 1), order_id: p[0], date: d(p[1]) + 'T' + p[2] + ':00',
    amount: p[3], mode: p[4], collector: 'collector', note: ''
  }));
  db.nextPaymentId = db.payments.length + 1;

  // Sample WhatsApp log (stub mode): [order, date, time, in/out, template, body]
  [
    [1008, '2026-07-14', '11:02', 'out', 'arrival_confirm', ''],
    [1008, '2026-07-14', '11:04', 'in', '', 'હા'],
    [1008, '2026-07-14', '12:20', 'out', 'work_done_checklist', ''],
    [1008, '2026-07-14', '12:25', 'in', '', 'હા, બરાબર'],
    [1009, '2026-08-25', '13:15', 'out', 'work_done_checklist', ''],
    [1009, '2026-08-25', '13:40', 'in', '', 'ના, બરાબર નથી'],
    [1009, '2026-08-29', '15:31', 'out', 'payment_thanks', ''],
    [1007, '2026-07-02', '15:20', 'out', 'work_done_checklist', ''],
    [1007, '2026-07-04', '12:01', 'out', 'payment_thanks', ''],
    [1010, '2026-08-30', '10:05', 'out', 'arrival_confirm', ''],
    [1040, SEED_TODAY, '07:05', 'out', 'arrival_confirm', ''],
    [1040, SEED_TODAY, '07:06', 'in', '', 'હા'],
    [1040, SEED_TODAY, '08:05', 'out', 'work_done_checklist', ''],
    [1040, SEED_TODAY, '08:07', 'in', '', 'હા, બરાબર'],
    // Gandhi Engineering has no WhatsApp: logged, not sent
    [1033, '2026-10-02', '15:35', 'out', 'work_done_checklist', '{"done":["ug"],"not_done":[]}']
  ].forEach(m => {
    const o = db.orders.find(x => x.order_id === m[0]);
    const st = m[3] === 'in' ? 'received' : o.whatsapp === 'no' ? 'skipped_no_wa' : 'stub';
    db.messages.push({ ts: d(m[1]) + 'T' + m[2] + ':00', direction: m[3], phone: o.phone, order_id: m[0], template: m[4], body: m[5], status: st, wa_message_id: '' });
  });


  // Sample alerts: [date, time, type, sev, order, text]. Ids are text like the real "AL..." ids.
  [
    ['2026-10-06', '11:40', 'delay', 'warn', 1038, 'Team B reached Meena Chauhan 25 min late. Reason: Earlier job took longer.'],
    ['2026-10-06', '17:10', 'partial', 'warn', 1039, 'Hotel Riverview: 2 of 3 services done. Antibacterial treatment was not done. Check the invoice.'],
    ['2026-07-02', '15:20', 'partial', 'bad', 1007, 'Hotel Riverview: 1 of 2 services done. Not done: Antibacterial treatment. Check before invoicing.'],
    ['2026-08-25', '13:40', 'dispute', 'bad', 1009, 'Sky Heights Society says the completion details are not correct. Please call the customer.']
  ].forEach(a => {
    const at = d(a[0]) + 'T' + a[1] + ':00';
    db.alerts.push({ alert_id: alertId(at), created_at: at, type: a[2], sev: a[3], order_id: a[4], text: a[5], seen: true });
  });

  /* ======================================================================
     SMALL HELPERS
     ====================================================================== */

  // An empty Orders row with every column (SCHEMA.md, plus source/moved_from/delay_min/customer_time/next_visit).
  // delay_min is null when blank, as the real server sends it.
  function blankOrder() {
    return {
      order_id: 0, created_at: '', client_name: '', phone: '', client_type: '', address: '', map_link: '',
      area: '', services: [], amount: 0, sched_date: '', sched_time: '', team: '', status: 'new',
      reached_at: '', done_at: '', done_checklist: [], not_done: [], delay_reason: '', eta_sent: '',
      customer_confirm: '', dispute: false, overtime_min: 0, notes: '',
      source: 'call', moved_from: '', delay_min: null, customer_time: '',
      next_visit: '',   // admin only: when the client should be cleaned again (yyyy-MM-dd)
      cancel_reason: '', cancelled_at: '',  // set by order.cancel (admin only)
      // who did what (admin names, admin only; drivers' actions do not touch these)
      created_by: '', updated_by: '', cancelled_by: '',
      // Does the client use WhatsApp? 'yes' / 'no' / '' (blank = not known = treated as yes).
      // 'no' = nothing is sent to the customer; staff call them instead (logged as skipped_no_wa).
      whatsapp: '',
      // Log book (added 2026-10-08): tank sizes [{type, litres, l, w, h, count}] and
      // the workers who did the job (names from the team's worker_names). Not money.
      tanks: [], crew: [],
      // Survey + quotation (added 2026-10-08). kind: 'cleaning' (blank) or 'survey'.
      // quote_amount, quote_order_id, from_quote, amc_visit: a number, or null when not set
      kind: 'cleaning', quote_status: '', quote_amount: null, quote_sent_at: '', quote_order_id: null, from_quote: null,
      price_locked: false,   // true = the amount stays as it is (approved quote, AMC visit, or typed by an admin)
      // Multi-day jobs: days (1-10) and the days worked [{date, reached, left, overtime_min}]
      days: 1, work_days: [],
      // AMC visit: the contract and the visit number (1..visits)
      amc_id: '', amc_visit: null
    };
  }
  function ledgerRowFor(o, weekStart) {
    return { week_start: weekStart, order_id: o.order_id, client_name: o.client_name, phone: o.phone, address: o.address, area: o.area, billed: o.amount };
  }
  // Monday of the week that contains date s
  function mondayOf(s) { const n = (pd(s).getDay() + 6) % 7; return addD(s, -n); }
  // Alert ids are text, like the real server's "AL20261007143005123"
  function alertId(at) { db.nextAlertNo++; return 'AL' + String(at).replace(/\D/g, '') + String(db.nextAlertNo).padStart(3, '0'); }

  // Errors look like the real server's: "CODE: plain English message"
  const fail = (code, text) => { throw new Error(code + (text ? ': ' + text : '')); };
  const getOrder = id => db.orders.find(o => o.order_id === Number(id)) || fail('NOT_FOUND', 'Order not found.');
  const area = k => db.areas.find(a => a.key === k);
  const areaName = k => (area(k) || { name_en: k }).name_en;
  const teamRow = k => db.teams.find(t => t.team === k);
  const activeTeams = () => db.teams.filter(t => t.active).map(t => t.team);
  const round2 = n => Math.round(Number(n) * 100) / 100;
  const paidOf = id => round2(db.payments.filter(p => p.order_id === Number(id)).reduce((a, p) => a + p.amount, 0));
  const balanceOf = o => round2(o.amount - paidOf(o.order_id));
  const inLedger = id => db.ledger.some(r => r.order_id === Number(id));
  // true when the client does NOT use WhatsApp (blank counts as yes)
  const noWa = o => !!o && String(o.whatsapp || '').toLowerCase() === 'no';
  // Oldest -> newest by date, time, then order number (as clients.gs byDateTime_)
  const byDateTime = (a, b) => a.sched_date !== b.sched_date ? (a.sched_date < b.sched_date ? -1 : 1)
    : a.sched_time !== b.sched_time ? (a.sched_time < b.sched_time ? -1 : 1) : a.order_id - b.order_id;
  const today = () => todayIso();
  const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  // A number from a setting, with a fallback (orders.gs num_)
  const num = (v, def) => (v === '' || v === null || v === undefined || isNaN(Number(v))) ? def : Number(v);
  const setting = (k, def) => num(db.settings[k], def);
  // "a, b,c" or ['a','b'] -> ['a','b','c'] (setup.gs splitList_)
  const splitList = v => Array.isArray(v) ? v.map(String)
    : String(v === undefined || v === null ? '' : v).split(',').map(x => x.trim()).filter(x => x !== '');
  // The reasons a driver may give for "I will be late" (orders.gs LATE_REASONS); the end-of-day
  // reasons (not_home, cust_later, time_out, not_empty) are only for moving a job (added 2026-10-08)
  const LATE_REASONS = ['traffic', 'prev', 'vehicle', 'other'];
  const reasonEn = k => MOVE_REASONS[k] ? MOVE_REASONS[k].en : (REASON[k] || REASON.other).en;

  /* ======================================================================
     MODULES: task management is the core (always on); a few extras come in
     three add-on PACKS switched on or off per client (Modules tab):
     repeat, quotation, insights. Same rules as Code.gs / setup.gs (2026-10-08):
     - a pack that is missing (or an empty tab, or a blank "on" cell) = ON
     - old-style rows (orders, calendar, clients, reports, amc, multiday) are ignored
     - the code checks INTERNAL feature keys worked out from the packs:
       clients = amc = repeat; quotation = quotation; reports = insights;
       orders = calendar = multiday = always on (core)
     - an action of a feature that is off is refused with
       "FORBIDDEN: This feature is not switched on." (also inside a batch)
     - fields of a feature that is off are never sent (stripOffModules)
     ====================================================================== */
  const MODULES = [
    { key: 'repeat', name: 'Repeat business', gives: ['clients', 'amc'] },
    { key: 'quotation', name: 'Quotations', gives: ['quotation'] },
    { key: 'insights', name: 'Business insights', gives: ['reports'] }
  ];
  // Kept for other industries; these are always on in the current packs.
  const CORE_FEATURES = ['orders', 'calendar', 'multiday'];
  const OFF = 'This feature is not switched on.';
  const offFail = () => fail('FORBIDDEN', OFF);
  // Which add-on each action belongs to. Every action NOT listed here is core (always on).
  // (report.overtime stays core: the Dashboard uses it; only the Overtime SCREEN is "reports".)
  const ACTION_MODULE = {
    'price.quote': 'orders',
    'survey.submit': 'quotation', 'quote.send': 'quotation', 'quote.approve': 'quotation', 'quote.decline': 'quotation',
    'client.list': 'clients', 'client.history': 'clients', 'client.lookup': 'clients',
    'client.setNextVisit': 'clients', 'client.setWhatsapp': 'clients', 'reminders.list': 'clients',
    'report.month': 'reports',
    'amc.create': 'amc', 'amc.list': 'amc', 'amc.cancel': 'amc',
    'order.dayDone': 'multiday'
  };
  // The order fields that belong to an add-on: not sent when that add-on is off
  const MOD_FIELDS = {
    orders: ['price', 'price_locked', 'source', 'client_type'],
    quotation: ['kind', 'quote_status', 'quote_amount', 'quote_sent_at', 'quote_order_id', 'from_quote'],
    amc: ['amc_id', 'amc_visit', 'amc_label'],
    multiday: ['days', 'work_days'],
    clients: ['next_visit']
  };
  // An "on" cell: only FALSE / no / n / 0 / off switch an add-on off; anything else (also blank) = on
  const cellOn = v => v !== false && !['false', 'no', 'n', '0', 'off'].includes(String(v === undefined || v === null ? '' : v).trim().toLowerCase());
  /** {repeat, quotation, insights} (the packs) + the internal keys {orders, calendar, multiday, clients, amc, reports} */
  function modulesOn() {
    const out = {};
    MODULES.forEach(m => {
      const row = db.modules.find(r => String(r.key || '').trim().toLowerCase() === m.key);
      out[m.key] = !row || cellOn(row.on);
    });
    CORE_FEATURES.forEach(k => { out[k] = true; });
    MODULES.forEach(m => m.gives.forEach(k => { out[k] = out[m.key]; }));
    return out;
  }
  const modOn = k => modulesOn()[k] !== false;
  /** Remove the fields of the add-ons that are off from one order (a copy made by full()) */
  function stripOffModules(o, mods) {
    mods = mods || modulesOn();
    Object.keys(MOD_FIELDS).forEach(k => { if (!mods[k]) MOD_FIELDS[k].forEach(f => { delete o[f]; }); });
    return o;
  }
  /**
   * Switch add-ons for the demo and the tests (fills the fake Modules tab):
   *   'core' or 'none'       every pack off (core only)
   *   'all' or ''            every pack on (the default)
   *   'repeat,insights'      only these packs on
   *   {repeat:false, ...}    exactly these rows (keys left out = missing rows = on)
   */
  function setModules(spec) {
    if (spec && typeof spec === 'object') {
      db.modules = Object.keys(spec).map(k => ({ key: k, name: (MODULES.find(m => m.key === k) || { name: k }).name, on: spec[k] }));
      return modulesOn();
    }
    const v = String(spec === undefined || spec === null ? '' : spec).trim().toLowerCase();
    const list = v === 'core' || v === 'none' ? [] : v === '' || v === 'all' ? MODULES.map(m => m.key)
      : v.split(',').map(x => x.trim()).filter(Boolean);
    db.modules = MODULES.map(m => ({ key: m.key, name: m.name, on: list.includes(m.key) }));
    return modulesOn();
  }
  // Start: all on, unless the page address says otherwise (?mock=1&modules=core)
  (function modulesFromUrl() {
    let v = null;
    try { v = new URLSearchParams((typeof location !== 'undefined' && location && location.search) || '').get('modules'); } catch (e) { v = null; }
    setModules(v === null ? 'all' : v);
  })();

  // Straight-line distance in km between two areas, or null if either is unknown
  function dist(a, b) { const A = area(a), B = area(b); return (!a || !b || !A || !B) ? null : Math.hypot(A.x - B.x, A.y - B.y); }
  // Travel minutes between two areas (eta.gs travelMin)
  function travelMin(a, b) {
    const km = dist(a, b);
    if (km === null) return setting('unknown_area_min', 20);
    if (a === b) return setting('same_area_min', 10);
    return Math.round(km * setting('min_per_km', 3)) + setting('buffer_min', 5);
  }
  // Overtime minutes between reaching and leaving on ONE day (reports.gs overtimeMin):
  // the minutes before office start plus the minutes after office end
  function otBetween(reachedAt, leftAt) {
    const done = mins(leftAt);
    if (done === null) return 0;
    const reached = reachedAt ? mins(reachedAt) : done - 60;
    const s = mins(db.settings.office_start || '10:00'), e = mins(db.settings.office_end || '17:00');
    return Math.max(0, Math.min(done, s) - reached) + Math.max(0, done - Math.max(reached, e));
  }
  // Overtime minutes for a done order. A multi-day job: the sum of its days (work_days).
  function overtimeOf(o) {
    if (o.status !== 'done' || !o.done_at) return 0;
    const wd = workDays(o).filter(x => x.left);
    if (jobDays(o) > 1 && wd.length) return wd.reduce((a, x) => a + (Number(x.overtime_min) || 0), 0);
    return otBetween(o.reached_at, o.done_at);
  }
  // Surveys (the supervisor measuring tanks for a quotation) are NOT jobs: they never count
  // as work, money, overtime, routes or log book rows.
  function isSurvey(o) { return !!o && o.kind === 'survey'; }
  function isJob(o) { return !isSurvey(o); }

  // Team suggestion (orders.gs suggestTeam): same area that day, else nearest job
  // within max_suggest_km, else the team with the fewest jobs that day
  function suggest(areaKey, date, exceptId) {
    const teams = activeTeams();
    if (!teams.length) return { team: '', why: 'No active teams in the Teams tab' };
    // a cancelled job does not keep a team busy
    const same = db.orders.filter(x => jobOnDate(x, date) && x.team && teams.includes(x.team) && String(x.order_id) !== String(exceptId) && !isCancelled(x) && isJob(x));
    if (areaKey) {
      const m = same.find(x => x.area === areaKey);
      if (m) return { team: m.team, why: 'Already in ' + areaName(areaKey) + ' that day' };
      let best = null, bd = 1e9;
      same.forEach(x => { const k = dist(areaKey, x.area); if (k !== null && k < bd) { bd = k; best = x; } });
      if (best && bd <= setting('max_suggest_km', 6)) return { team: best.team, why: 'Nearby: ' + areaName(best.area) + ', ' + bd.toFixed(1) + ' km' };
    }
    const ld = teams.map(t => ({ t, n: same.filter(x => x.team === t).length })).sort((a, b) => a.n - b.n)[0];
    return { team: ld.t, why: 'Lightest day, ' + ld.n + ' job' + (ld.n === 1 ? '' : 's') };
  }

  // The next stop for a team after this (done) order, today (eta.gs nextStop)
  function nextStop(o) {
    if (!jobOnDate(o, today()) || o.status !== 'done' || !o.team) return null;
    const os = db.orders.filter(x => jobOnDate(x, today()) && x.team === o.team && isJob(x));
    if (os.some(x => x.status === 'done' && x.order_id !== o.order_id && String(x.done_at) > String(o.done_at))) return null;
    // (a multi-day job whose work for today is already done is not a next stop)
    const open = os.filter(x => OPEN.includes(x.status) && !(x.status === 'ongoing' && workDays(x).some(w => w.date === today() && w.left)))
      .sort((a, b) => mins(a.sched_time) - mins(b.sched_time));
    // Prefer the first job booked at or after the finished one (as eta.gs)
    return open.find(x => mins(x.sched_time) >= mins(o.sched_time)) || open[0] || null;
  }

  // seen = true: saved as already seen (the office's OWN actions: moved, cancelled, restored,
  // AMC, quotation approved by an admin), as orders.gs addAlert (usability round 2026-10-08)
  function addAlert(type, sev, orderId, text, seen) {
    const at = nowIso();
    db.alerts.push({ alert_id: alertId(at), created_at: at, type, sev, order_id: orderId || '', text, seen: seen === true,
      resolved_at: '', resolved_by: '' });   // alerts.resolve (added 2026-10-09)
  }
  // Pretend to send a WhatsApp message: only written to the fake MessageLog
  // (the real server writes the Gujarati text; the mock writes the params)
  // A client without WhatsApp (o.whatsapp 'no'): NOTHING is sent. One log row with status
  // 'skipped_no_wa' keeps what the customer should have been told (staff call them instead).
  // Returns false when skipped.
  function waSend(o, template, params) {
    const skip = noWa(o);
    db.messages.push({ ts: nowIso(), direction: 'out', phone: o.phone, order_id: o.order_id, template, body: JSON.stringify(params || {}),
      status: skip ? 'skipped_no_wa' : 'stub', wa_message_id: '' });
    return !skip;
  }

  /* ---------- the archive (OrderHistory tab, archive.gs) ---------- */

  // One OrderHistory row (the columns of the archive tab) from an order
  function historyRow(o, archivedAt) {
    const t = teamRow(o.team) || {};
    return {
      order_id: o.order_id, sched_date: o.sched_date, sched_time: o.sched_time, client_name: o.client_name, phone: o.phone,
      client_type: o.client_type, address: o.address, area: o.area, services: o.services.slice(), not_done: (o.not_done || []).slice(),
      amount: o.amount, paid: paidOf(o.order_id), pay_modes: payModesOf(o.order_id), team: o.team,
      driver_name: o.team ? t.driver_name || '' : '', workers: o.team ? Number(t.workers) || 0 : '',
      status: o.status, overtime_min: o.overtime_min || 0, delay_min: o.delay_min, dispute: !!o.dispute,
      customer_confirm: o.customer_confirm || '', source: o.source || 'call', moved_from: o.moved_from || '',
      next_visit: o.next_visit || '', notes: o.notes || '', cancel_reason: o.cancel_reason || '', archived_at: archivedAt,
      created_by: o.created_by || '',   // who booked it survives archiving (end of the OrderHistory columns)
      whatsapp: o.whatsapp || '',       // uses WhatsApp? (copied on archive)
      tanks: (o.tanks || []).map(tankForSheet), crew: (o.crew || []).slice(),   // log book: copied on archive
      // survey / quote / multi-day / AMC (added 2026-10-08, end of the OrderHistory columns)
      kind: o.kind || 'cleaning', from_quote: o.from_quote || null, price_locked: !!o.price_locked, days: o.days || 1,
      work_days: workDays(o).slice(), amc_id: o.amc_id || '', amc_visit: o.amc_visit || null
    };
  }
  // How an order was paid, as text: "cash 1000 + upi 500"
  function payModesOf(id) {
    const by = {};
    db.payments.filter(p => p.order_id === Number(id)).forEach(p => { by[p.mode] = round2((by[p.mode] || 0) + p.amount); });
    return Object.keys(by).map(m => m + ' ' + by[m]).join(' + ');
  }
  // An archived row read back as an order (as loadOrdersAll_ on the server): archived:true,
  // done_checklist = services minus not_done, no work times.
  function archivedOut(h) {
    return Object.assign(blankOrder(), h, {
      archived: true, reached_at: '', done_at: '',
      done_checklist: h.services.filter(k => !(h.not_done || []).includes(k))
    });
  }
  // Live orders AND archived ones (for client history, reminders, payment names and reports).
  // Live screens (order.list, driver, collector, routes...) use db.orders only.
  // If an order is in both (an archive run that stopped halfway), the live row wins.
  function allOrders() {
    const live = new Set(db.orders.map(o => o.order_id));
    return db.orders.concat(db.history.filter(h => !live.has(h.order_id)).map(archivedOut));
  }

  /* Sample archive: as if the monthly archive has already run.
     Old orders that were done and fully paid move to OrderHistory with only the history
     kept (no work times or checklist), plus how they were paid and the driver's name at
     that time. Their ledger rows are removed; payments always stay.
     1005 is an old cancelled order (cancelled orders are archived too). */
  const ARCHIVED_AT = d('2026-07-01') + 'T03:00:00';
  [1001, 1002, 1003].forEach(id => {
    const o = db.orders.find(x => x.order_id === id);
    db.history.push(historyRow(o, ARCHIVED_AT));
    db.orders.splice(db.orders.indexOf(o), 1);
    db.ledger = db.ledger.filter(r => r.order_id !== id);
  });
  db.history.push(historyRow(Object.assign(blankOrder(), {
    order_id: 1005, client_type: 'bungalow', client_name: 'Harsh Vora', phone: '919825041035', address: '22, Green Park, Piplod, Surat',
    area: 'piplod', services: ['ot', 'ab'], amount: 1650, sched_date: d('2026-06-10'), sched_time: '10:00', team: 'B',
    status: 'cancelled', cancel_reason: 'Customer was out of town'
  }), ARCHIVED_AT));

  /* ======================================================================
     ROLE FILTERING (the privacy rules). Whitelists: only listed fields go out.
     ====================================================================== */
  const DRIVER_FIELDS = ['order_id', 'client_name', 'phone', 'client_type', 'address', 'map_link', 'area', 'services',
    'sched_date', 'sched_time', 'team', 'status', 'reached_at', 'done_at', 'done_checklist', 'not_done',
    'delay_reason', 'delay_min', 'eta_sent', 'customer_confirm', 'dispute', 'overtime_min', 'notes', 'moved_from',
    'whatsapp',    // the driver must know when to CALL the customer instead (not money)
    'tanks', 'crew',   // log book: tank sizes and who did the job (sizes are not money)
    'days', 'work_days', 'amc_label'];   // multi-day jobs; "AMC 2/4" (a label only, never the contract money)
  const COLLECTOR_FIELDS = ['order_id', 'client_name', 'phone', 'address', 'area', 'balance', 'whatsapp'];
  // The supervisor measures tanks for a quotation: never any money, never the services
  const SUPERVISOR_FIELDS = ['order_id', 'client_name', 'phone', 'client_type', 'address', 'map_link', 'area', 'sched_date',
    'sched_time', 'status', 'tanks', 'notes', 'whatsapp', 'kind'];
  const pick = (obj, fields) => { const r = {}; fields.forEach(f => { if (obj[f] !== undefined) r[f] = obj[f]; }); return r; };

  // The admin form of an order: every column plus paid, balance and in_ledger (orders.gs addMoney_),
  // and price = the price breakdown (priceOrder), admin only
  const full = o => Object.assign({}, o, { paid: paidOf(o.order_id), balance: balanceOf(o), in_ledger: inLedger(o.order_id),
    tanks: tanksOut(o.tanks), crew: (o.crew || []).slice(), work_days: workDays(o).map(x => Object.assign({}, x)),
    price: priceOrder(isSurvey(o) ? Object.assign({}, o, { services: surveySvcs(o) }) : o) });

  /* ---------- tank sizes and crew (log book, orders.gs) ---------- */
  const TANK_MAX = 20, TANK_MAX_METRES = 20, TANK_MAX_LITRES = 200000, TANK_MAX_COUNT = 20;
  const numOrNull = v => (v === '' || v === null || v === undefined || isNaN(Number(v))) ? null : Number(v);
  // As saved in the Sheet (total_litres is never stored)
  // (a function declaration, because the sample archive above already uses it)
  function tankForSheet(t) {
    const out = { type: t.type, material: tankMat(t), litres: t.litres, l: t.l, w: t.w, h: t.h, count: t.count };
    if (t.part_of) out.part_of = t.part_of;   // partition: "part of tank N" (added 8 Oct 2026)
    return out;
  }
  // Saved tanks -> tanks for the app, each with total_litres = litres x count (tankLitres in common.js)
  function tanksOut(list) {
    const parts = {};   // partition: first tank number -> parts seen so far
    return (Array.isArray(list) ? list : []).filter(t => t && typeof t === 'object').map((t, i) => {
      const out = { type: String(t.type || '').toUpperCase(), material: tankMat(t), litres: numOrNull(t.litres), l: numOrNull(t.l), w: numOrNull(t.w), h: numOrNull(t.h),
        count: Math.max(1, Math.round(Number(t.count) || 1)) };
      out.total_litres = tankLitres(out) * out.count;
      // part_of = an EARLIER tank's number; part_no (worked out, never stored) = 2, 3 ... (orders.gs tanksOut_)
      const po = Number(t.part_of);
      if (po >= 1 && po <= i && Math.floor(po) === po) { parts[po] = (parts[po] || 1) + 1; out.part_of = po; out.part_no = parts[po]; }
      return out;
    });
  }
  // Tanks typed by a driver or admin (orders.gs cleanTanks_): BAD_INPUT when wrong. [] is fine.
  function cleanTanks(v) {
    let list = v;
    if (v === null || v === undefined) return [];
    if (typeof v === 'string') {
      if (!v.trim()) return [];
      try { list = JSON.parse(v); } catch (e) { fail('BAD_INPUT', 'Tanks must be a list.'); }
    }
    if (!Array.isArray(list)) fail('BAD_INPUT', 'Tanks must be a list.');
    if (list.length > TANK_MAX) fail('BAD_INPUT', 'At most ' + TANK_MAX + ' tanks.');
    return list.map((t, i) => {
      const n = 'Tank ' + (i + 1) + ': ';
      if (!t || typeof t !== 'object' || Array.isArray(t)) fail('BAD_INPUT', n + 'not a tank.');
      const type = String(t.type || '').trim().toUpperCase();
      if (!['OH', 'UG'].includes(type)) fail('BAD_INPUT', n + 'type must be OH or UG.');
      // material: cement (also when not given) or plastic
      const material = String(t.material === undefined || t.material === null || t.material === '' ? 'cement' : t.material).trim().toLowerCase();
      if (!['cement', 'plastic'].includes(material)) fail('BAD_INPUT', n + 'material must be cement or plastic.');
      const positive = (x, max, what) => {
        if (x === '' || x === null || x === undefined) return null;
        const num = Number(x);
        if (isNaN(num) || num <= 0) fail('BAD_INPUT', n + what + ' must be a number above 0.');
        if (num > max) fail('BAD_INPUT', n + what + ' must be at most ' + max + '.');
        return num;
      };
      const litres = positive(t.litres, TANK_MAX_LITRES, 'litres');
      const l = positive(t.l, TANK_MAX_METRES, 'length (m)'), w = positive(t.w, TANK_MAX_METRES, 'width (m)'), h = positive(t.h, TANK_MAX_METRES, 'height (m)');
      const dims = [l, w, h].filter(x => x !== null).length;
      if (dims !== 0 && dims !== 3) fail('BAD_INPUT', n + 'give all three sizes L x W x H, or litres.');
      if (litres === null && dims === 0) fail('BAD_INPUT', n + 'give litres or the size L x W x H.');
      let count = 1;
      if (t.count !== '' && t.count !== null && t.count !== undefined) {
        count = Number(t.count);
        if (!(count >= 1 && count <= TANK_MAX_COUNT && Math.floor(count) === count)) fail('BAD_INPUT', n + 'count must be a whole number from 1 to ' + TANK_MAX_COUNT + '.');
      }
      // A plastic tank is never bigger than plastic_max_litres (each tank, not the count)
      const max = setting('plastic_max_litres', 5000);
      if (material === 'plastic' && tankLitres({ litres, l, w, h }) > max) fail('BAD_INPUT', n + 'a plastic tank can be at most ' + litresText(max) + ' litres.');
      const tank = { type, material, litres, l, w, h, count };
      // Partition (added 8 Oct 2026): optional part_of = the number of an earlier tank
      if (t.part_of !== undefined && t.part_of !== null && t.part_of !== '' && t.part_of !== 0) {
        const po = Number(t.part_of);
        if (!(po >= 1 && po <= i && Math.floor(po) === po)) fail('BAD_INPUT', n + 'part_of must be the number of an earlier tank.');
        tank.part_of = po;
      }
      return tank;
    });
  }
  // The worker names of one team (Teams column worker_names) as a list
  const teamWorkers = k => splitList((teamRow(k) || {}).worker_names || '');
  // Crew ticked by a driver: names must be the team's workers (case does not matter). [] is fine.
  function cleanCrew(v, team) {
    const known = teamWorkers(team), out = [];
    splitList(v).forEach(n => {
      const m = known.find(k => k.toLowerCase() === String(n).trim().toLowerCase());
      if (!m) fail('BAD_INPUT', 'Not a worker of team ' + team + ': ' + n);
      if (!out.includes(m)) out.push(m);
    });
    return out;
  }
  /* ---------- PRICING by tank size (orders.gs tankPrice_ / priceOrder_, added 2026-10-08) ----------
     The price depends on the tank MATERIAL and its litres (rate card rows in Settings).
     Tank pricing REPLACES the cleaning services (priced_by 'tanks': ot, ug). Add-ons
     (priced_by 'fixed': antibacterial, leakage repair) keep their price and are added on top. */
  // "500:300, 3000:400" -> [{upto:500, price:300}, {upto:3000, price:400}]
  function plasticBands(st) {
    return String((st || db.settings).plastic_bands || '').split(',').map(x => x.split(':').map(y => Number(String(y).trim())))
      .filter(x => x.length === 2 && x[0] > 0 && x[1] >= 0).map(x => ({ upto: x[0], price: x[1] }));
  }
  /**
   * Price of ONE tank of L litres (L = litres, or l x w x h x 1000):
   *  cement:  L <= cap: base + step_price x max(0, ceil(L / step_litres) - 1)
   *           L >  cap: price at the cap + extra_per_litre x (L - cap), rounded to the rupee
   *  plastic: the first band with L <= its litres; above plastic_max_litres -> BAD_INPUT
   */
  function tankPrice(t, st) {
    st = st || db.settings;
    const n = (k, d) => num(st[k], d), L = tankLitres(t);
    if (tankMat(t) === 'plastic') {
      const max = n('plastic_max_litres', 5000);
      if (L > max) fail('BAD_INPUT', 'A plastic tank can be at most ' + litresText(max) + ' litres.');
      const bands = plasticBands(st), b = bands.find(x => L <= x.upto) || bands[bands.length - 1];
      return b ? b.price : 0;
    }
    const base = n('cement_base_price', 500), step = n('cement_step_litres', 5000) || 5000, stepP = n('cement_step_price', 100);
    const cap = n('cement_cap_litres', 25000), extra = n('cement_extra_per_litre', 0.05);
    const upTo = x => base + stepP * Math.max(0, Math.ceil(x / step) - 1);
    return L <= cap ? upTo(L) : Math.round(upTo(cap) + extra * (L - cap));
  }
  function svcRow(k) { return db.services.find(v => v.key === k); }
  // 'tanks' or 'fixed'. Blank = fixed, except ot and ug (the two cleaning services) = tanks.
  function pricedBy(k) {
    const p = String((svcRow(k) || {}).priced_by || '').trim().toLowerCase();
    if (p === 'tanks' || p === 'fixed') return p;
    return k === 'ot' || k === 'ug' ? 'tanks' : 'fixed';
  }
  /**
   * The price of an order, line by line (admin only):
   * {tanks:[{...tank, unit_price, price}], tanks_total, addons:[{key, price}], addons_total, total, by}
   *  by 'tanks':    tanks + the fixed-price services (add-ons)
   *  by 'services': no tanks yet: the default prices of all chosen services (as before)
   *  by 'locked':   price_locked: total = the order's amount (tanks_total still worked out, to compare)
   */
  function priceOrder(o) {
    const tanks = tanksOut(o.tanks).map(t => {
      let unit;
      try { unit = tankPrice(t); } catch (e) { const b = plasticBands(); unit = b.length ? b[b.length - 1].price : 0; }   // a saved tank over a new limit
      return Object.assign(t, { unit_price: unit, price: round2(unit * t.count) });
    });
    const svcs = splitList(o.services);
    // Tank pricing only when the order has tanks AND a service priced by tanks (a cleaning service).
    // An add-on-only job (e.g. leakage repair) is priced from its services even if tanks are saved.
    const byTanks = tanks.length > 0 && svcs.some(k => pricedBy(k) === 'tanks');
    const addons = (byTanks ? svcs.filter(k => pricedBy(k) !== 'tanks') : svcs)
      .map(k => ({ key: k, price: Number((svcRow(k) || {}).default_price) || 0 }));
    const tanksTotal = round2(tanks.reduce((a, t) => a + t.price, 0)), addonsTotal = round2(addons.reduce((a, x) => a + x.price, 0));
    // by 'services': the tanks do not set the price (they stay on the order for the log book)
    const out = { tanks: byTanks ? tanks : [], tanks_total: byTanks ? tanksTotal : 0, addons, addons_total: addonsTotal,
      total: round2(byTanks ? tanksTotal + addonsTotal : addonsTotal), by: byTanks ? 'tanks' : 'services' };
    if (o.price_locked) { out.by = 'locked'; out.total = round2(Number(o.amount) || 0); }
    return out;
  }
  // Locked price (approved quote / AMC visit / typed by an admin) and the driver measured
  // something different: tell the admin (alert 'price_diff'). The amount is NOT changed.
  // The "tank part" of the agreed price = amount minus the add-ons (an AMC visit: the
  // contract's undiscounted visit price, so the AMC discount is not reported as a difference).
  function priceDiffCheck(o, pr) {
    if (pr.by !== 'tanks') return;   // no cleaning priced by tanks: nothing to compare
    const c = o.amc_id ? contractOf(o.amc_id) : null;
    const part = c ? Number(c.visit_price) || 0 : round2((Number(o.amount) || 0) - pr.addons_total);
    if (Math.abs(pr.tanks_total - part) > 1) {
      addAlert('price_diff', 'warn', o.order_id, o.client_name + ': measured tanks come to ' + inr(pr.tanks_total) + ', quote was ' + inr(part) + '. Check the bill.');
    }
  }

  function filterForRole(o, s) {
    const f = full(o);
    if (s.role === 'admin') return stripOffModules(f);   // admin: the raw value ('yes' / 'no' / '')
    // Driver, collector, supervisor: plain 'yes' / 'no' (blank = the client's known value, else yes)
    f.whatsapp = o.whatsapp === 'yes' || o.whatsapp === 'no' ? o.whatsapp : clientWa(o.phone);
    if (s.role === 'driver') {
      const c = o.amc_id ? contractOf(o.amc_id) : null;
      f.amc_label = o.amc_id ? 'AMC ' + o.amc_visit + '/' + (c ? c.visits : '?') : '';
      return stripOffModules(pick(f, DRIVER_FIELDS));
    }
    if (s.role === 'collector') return pick(f, COLLECTOR_FIELDS);
    if (s.role === 'supervisor') return stripOffModules(pick(f, SUPERVISOR_FIELDS));
    return {};
  }
  // Drivers may only touch their own team's orders. Nobody may act on a cancelled order.
  function ownOrder(id, s) {
    const o = getOrder(id);
    if (s.role === 'driver' && o.team !== s.team) fail('FORBIDDEN', 'This job belongs to another team.');
    if (isCancelled(o)) fail('BAD_STATUS', s.role === 'driver' ? 'This job was cancelled by the office.' : 'This order is cancelled. Restore it first.');
    return o;
  }

  /* ======================================================================
     LOGIN AND TOKENS
     Fake token: "mock.<role>.<team>.<expiry ms>", plus ".<admin name>" for an admin
     (the name is URL-encoded so a dot in it cannot break the token).
     The real one is HMAC-signed and carries the admin's name as "n".
     ====================================================================== */
  let wrongPins = 0, blockedUntil = 0;

  function makeToken(role, team, name) {
    const exp = Date.now() + config.tokenMinutes * 60000;
    const parts = ['mock', role, team || '-', exp];
    if (role === 'admin') parts.push(encodeURIComponent(name || '').replace(/\./g, '%2E'));
    return { token: parts.join('.'), expires: exp };
  }
  // -> {role, team, name} or null. Admin tokens without a name still work (name 'Admin').
  function verifyToken(token) {
    const p = String(token || '').split('.');
    if ((p.length !== 4 && p.length !== 5) || p[0] !== 'mock') return null;
    if (!['admin', 'driver', 'collector', 'supervisor'].includes(p[1])) return null;
    if (p.length === 5 && p[1] !== 'admin') return null;
    const exp = Number(p[3]);
    if (!(exp > Date.now())) return null;   // expired
    if (p[1] === 'driver' && p[2] === '-') return null;   // a driver always has a team
    let name = '';
    if (p[1] === 'admin') {
      try { name = p.length === 5 ? decodeURIComponent(p[4]) : ''; } catch (e) { return null; }
      // An admin removed (or set inactive) in the Admins tab is logged out (auth.gs requireAuth)
      if (name && name !== BACKUP_NAME && !activeAdmins().some(a => String(a.name).trim() === name)) return null;
      if (!name) name = 'Admin';   // old token from before admins had names
    }
    return { role: p[1], team: p[1] === 'driver' ? p[2] : '', name };
  }
  // Active Admins rows with a name and a PIN (blank PINs never match)
  const activeAdmins = () => db.admins.filter(a => a.active && String(a.name || '').trim() && String(a.pin || '').trim());

  // Same order as auth.gs: Admins tab PINs, the backup admin PIN, then team PINs, the collector PIN, the supervisor PIN.
  // The 10th wrong PIN still says BAD_PIN; the NEXT try says LOCKED for 5 minutes.
  function login(b) {
    if (Date.now() < blockedUntil) fail('LOCKED', 'Too many wrong PINs. Please wait 5 minutes and try again.');
    const pin = String(b.pin === undefined || b.pin === null ? '' : b.pin).trim();
    let role = '', team = '', name = '';
    const t = pin && db.teams.find(x => x.active && String(x.pin) === pin);
    const ad = pin && activeAdmins().find(a => String(a.pin).trim() === pin);
    if (ad) { role = 'admin'; name = String(ad.name).trim(); }
    else if (pin && pin === ADMIN_PIN) { role = 'admin'; name = BACKUP_NAME; }
    else if (t) { role = 'driver'; team = t.team; name = t.driver_name || ('Team ' + t.team); }
    else if (pin && pin === String(db.settings.collector_pin)) { role = 'collector'; name = 'Collector'; }
    else if (pin && pin === String(db.settings.supervisor_pin || '')) { role = 'supervisor'; name = String(db.settings.supervisor_name || '').trim() || 'Supervisor'; }
    // The supervisor exists only with the "Survey and quotation" add-on
    if (role === 'supervisor' && !modOn('quotation')) offFail();
    if (!role) {
      wrongPins++;
      if (wrongPins >= 10) { wrongPins = 0; blockedUntil = Date.now() + 5 * 60000; }
      fail('BAD_PIN', 'Wrong PIN.');
    }
    const tk = makeToken(role, team, name);
    return { token: tk.token, role, team, name, expires: tk.expires };
  }

  /* ======================================================================
     CHECKING WHAT THE ADMIN TYPED (orders.gs cleanOrderInput_)
     Returns the fields ready to save. isNew = order.create; current = the order now.
     ====================================================================== */
  const ALLOWED = ['client_name', 'phone', 'client_type', 'address', 'map_link', 'area', 'services', 'amount',
    'sched_date', 'sched_time', 'team', 'status', 'reached_at', 'done_at', 'done_checklist',
    'not_done', 'delay_reason', 'delay_min', 'eta_sent', 'customer_confirm', 'dispute',
    'overtime_min', 'notes', 'source', 'moved_from', 'customer_time', 'next_visit', 'whatsapp',
    'tanks',    // log book: the admin can enter or correct the tank sizes
    'days',     // multi-day jobs (1-10)
    'price_locked'];   // false = unlock the price (order.update)

  function cleanTime(t) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) fail('BAD_INPUT', 'Time must look like 14:30.');
    return hhmm(Number(m[1]) * 60 + Number(m[2]));
  }
  const isYes = v => v === true || ['true', 'yes', 'y', '1'].includes(String(v === undefined || v === null ? '' : v).trim().toLowerCase());
  const jsonList = v => {
    if (Array.isArray(v)) return v;
    if (v === '' || v === null || v === undefined) return [];
    try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch (e) { return splitList(v); }
  };

  // opt.survey = true: a survey visit (services are optional)
  function cleanOrderInput(input, isNew, current, opt) {
    const out = {};
    const has = k => Object.prototype.hasOwnProperty.call(input, k);
    const text = v => String(v === undefined || v === null ? '' : v).trim();
    Object.keys(input).forEach(k => { if (!ALLOWED.includes(k)) fail('BAD_INPUT', 'This field cannot be changed: ' + k); });
    // Fields of an add-on that is off are ignored (not saved): "orders" off = no client type,
    // order source or price lock; "clients" off = no next visit.
    input = Object.assign({}, input);
    if (!modOn('orders')) ['client_type', 'source', 'price_locked'].forEach(k => { delete input[k]; });
    if (!modOn('clients')) delete input.next_visit;

    if (has('client_name') || isNew) {
      out.client_name = text(input.client_name);
      if (!out.client_name) fail('BAD_INPUT', 'Client name is required.');
    }
    if (has('phone') || isNew) out.phone = normPhone(input.phone) || fail('BAD_INPUT', 'Enter a 10 digit phone number.');
    if (has('client_type')) {
      out.client_type = text(input.client_type);
      if (out.client_type && !db.client_types.some(c => c.key === out.client_type)) fail('BAD_INPUT', 'Unknown client type: ' + out.client_type);
    }
    if (has('address')) out.address = text(input.address);
    if (isNew && !out.address) fail('BAD_INPUT', 'Enter the address.');
    if (has('area')) {
      out.area = text(input.area);
      if (out.area === 'other') out.area = '';
      if (out.area && !area(out.area)) fail('BAD_INPUT', 'Unknown area: ' + out.area);
    }
    let prices = null;
    if (has('services') || isNew) {
      const svcs = splitList(input.services);
      // services are optional for a survey, and for every task when "orders" is off (then they are only a checklist)
      if (!svcs.length && !(opt && opt.survey) && modOn('orders')) fail('BAD_INPUT', 'Choose at least one service.');
      prices = {};
      db.services.forEach(v => { if (v.active) prices[v.key] = Number(v.default_price) || 0; });
      svcs.forEach(k => { if (!(k in prices)) fail('BAD_INPUT', 'Unknown service: ' + k); });
      out.services = svcs;
    }
    if (has('amount') && text(input.amount) !== '') {
      const amt = Number(input.amount);
      if (isNaN(amt) || amt < 0) fail('BAD_INPUT', 'Amount must be a number, 0 or more.');
      out.amount = amt;
    } else if (isNew) {
      // no amount typed: add up the prices ("orders" off: there are no prices, so 0)
      out.amount = modOn('orders') ? out.services.reduce((sum, k) => sum + prices[k], 0) : 0;
    }
    if (has('sched_date') || isNew) {
      out.sched_date = text(input.sched_date);
      if (!validDate(out.sched_date)) fail('BAD_INPUT', 'Date must look like 2026-10-07.');
    }
    if (has('sched_time') || isNew) out.sched_time = cleanTime(input.sched_time);
    if (has('team')) {
      out.team = text(input.team).toUpperCase();
      if (out.team && !activeTeams().includes(out.team)) fail('BAD_INPUT', 'Unknown or inactive team: ' + out.team);
    }
    if (has('status')) {
      out.status = text(input.status);
      if (out.status === 'ongoing' && !modOn('multiday')) offFail();   // 'ongoing' belongs to multi-day jobs
      if (out.status === CANCELLED) fail('BAD_INPUT', 'Use Cancel order to cancel an order.');
      if (!STATUSES.includes(out.status)) fail('BAD_INPUT', 'Unknown status: ' + out.status);
    }
    if (has('source') || isNew) {
      out.source = text(input.source) || 'call';
      if (!['call', 'whatsapp'].includes(out.source)) fail('BAD_INPUT', 'Source must be call or whatsapp.');
    }
    if (has('customer_confirm')) {
      out.customer_confirm = text(input.customer_confirm);
      if (!['', 'yes', 'no'].includes(out.customer_confirm)) fail('BAD_INPUT', 'customer_confirm must be yes, no or blank.');
    }
    if (has('dispute')) out.dispute = isYes(input.dispute);
    if (has('whatsapp')) {
      out.whatsapp = text(input.whatsapp).toLowerCase();
      if (!['', 'yes', 'no'].includes(out.whatsapp)) fail('BAD_INPUT', 'whatsapp must be yes, no or blank.');
    }
    // An order that came in ON WhatsApp: the client obviously uses WhatsApp
    const src = out.source !== undefined ? out.source : (current ? current.source : '');
    if (src === 'whatsapp' && (has('whatsapp') || has('source') || isNew)) out.whatsapp = 'yes';
    if (has('next_visit')) {
      out.next_visit = text(input.next_visit);
      if (out.next_visit && !validDate(out.next_visit)) fail('BAD_INPUT', 'Next visit must look like 2026-11-20.');
    }
    if (has('moved_from')) {
      out.moved_from = text(input.moved_from);
      if (out.moved_from && !validDate(out.moved_from)) fail('BAD_INPUT', 'moved_from must look like 2026-10-07.');
    }
    ['delay_min', 'overtime_min'].forEach(k => {
      if (has(k)) {
        const v = text(input[k]);
        if (v !== '' && isNaN(Number(v))) fail('BAD_INPUT', k + ' must be a number.');
        // blank delay_min reads back as null, blank overtime_min as 0 (as orders.gs orderOut_)
        out[k] = v === '' ? (k === 'delay_min' ? null : 0) : Number(v);
      }
    });
    if (has('tanks')) out.tanks = cleanTanks(input.tanks);   // BAD_INPUT if a tank is wrong
    // Services follow the tanks (orders.gs cleanOrderInput_, usability round 2026-10-08): with a
    // tank-priced cleaning service, every tank position gets its cleaning service (OH -> ot, UG -> ug)
    if (modOn('orders') && !(opt && (opt.survey || opt.amc)) && !(current && (isSurvey(current) || current.amc_id)) && (has('tanks') || has('services'))) {
      const tk = out.tanks !== undefined ? out.tanks : (current ? current.tanks : []);
      const sv = out.services !== undefined ? out.services : (current ? current.services : []);
      if ((tk || []).length) { const f = withTankServices(sv, tk); if (f.length !== splitList(sv).length) out.services = f; }
    }
    if (has('price_locked')) { if (isNew) fail('BAD_INPUT', 'This field cannot be changed: price_locked'); delete out.price_locked; }
    if (has('days')) {
      const dd = text(input.days);
      out.days = dd === '' ? 1 : Number(dd);
      if (!(Number.isInteger(out.days) && out.days >= 1 && out.days <= 10)) fail('BAD_INPUT', 'Days must be a whole number from 1 to 10.');
      if (out.days > 1 && !modOn('multiday')) offFail();   // multi-day jobs are an add-on
      if (!modOn('multiday')) delete out.days;
    }
    if (has('done_checklist')) out.done_checklist = jsonList(input.done_checklist);
    if (has('not_done')) out.not_done = jsonList(input.not_done);
    ['map_link', 'notes', 'delay_reason', 'reached_at', 'done_at', 'eta_sent', 'customer_time'].forEach(k => {
      if (has(k)) out[k] = text(input[k]);
    });

    // Map link: made from the address when empty (and kept in step if the address changes)
    const linkFor = a => mapUrl({ address: a });
    if (isNew) {
      out.address = out.address || '';
      if (!out.map_link) out.map_link = linkFor(out.address);
    } else if (has('address') && !has('map_link') && current &&
               (!current.map_link || current.map_link === linkFor(current.address))) {
      out.map_link = linkFor(out.address);
    }

    // A team makes a new order "assigned", no team makes it "new"
    if (has('team') && !has('status')) {
      const st = current ? current.status : 'new';
      if (out.team && st === 'new') out.status = 'assigned';
      if (!out.team && st === 'assigned') out.status = 'new';
    }
    return out;
  }

  /* ======================================================================
     ACTIONS (one function per API action)
     ====================================================================== */

  // Which roles may call which action
  const PERMS = {
    'setup.get': ['admin', 'driver', 'collector', 'supervisor'],
    'order.create': ['admin'], 'order.update': ['admin'],
    'order.list': ['admin', 'driver', 'collector', 'supervisor'],
    'order.suggest': ['admin'], 'order.assign': ['admin'],
    'order.reached': ['driver'], 'order.done': ['driver'], 'order.delay': ['driver'], 'order.leave': ['driver'],
    'order.reschedule': ['driver', 'admin'],
    'order.cancel': ['admin'], 'order.restore': ['admin'],
    'ledger.get': ['collector', 'admin'], 'ledger.build': ['admin'], 'payment.add': ['collector', 'admin'],
    'payment.list': ['admin'],
    'payment.cancel': ['admin'],   // undo a wrong payment with a minus row (added 2026-10-08)
    'report.overtime': ['admin'], 'report.revenue': ['admin'],
    'alerts.list': ['admin'], 'alerts.seen': ['admin'],
    'alerts.resolve': ['admin'],   // mark one alert as dealt with, or open it again (added 2026-10-09)
    'client.list': ['admin'], 'client.history': ['admin'], 'client.lookup': ['admin'],
    'client.setNextVisit': ['admin'], 'reminders.list': ['admin'],
    'client.setWhatsapp': ['admin'], 'order.confirm': ['driver'],
    'order.sizeIssue': ['driver'],   // the tanks at the site differ from the saved sizes (added 2026-10-08)
    'report.month': ['admin'],
    'logbook.get': ['admin'], 'logbook.setCosts': ['admin'],   // log book: costs are admin only
    // added 2026-10-08: tank pricing, survey + quotation, multi-day jobs, AMC
    'order.dayDone': ['driver'], 'price.quote': ['admin'],
    'survey.submit': ['supervisor', 'admin'],
    'quote.send': ['admin'], 'quote.approve': ['admin'], 'quote.decline': ['admin'],
    'amc.create': ['admin'], 'amc.list': ['admin'], 'amc.cancel': ['admin']
  };

  const A = {};

  // setup.gs getSetup
  A['setup.get'] = (b, s) => {
    const admin = s.role === 'admin';
    const mods = modulesOn();   // which add-ons are on (sent to every role: not sensitive)
    // Settings that belong to an add-on: not sent when it is off
    // ("orders": the rate card; "quotation": the supervisor's name; "clients": reminder days)
    const offSetting = k => (!mods.orders && (/^cement_/.test(k) || k === 'plastic_bands')) ||
      (!mods.quotation && k === 'supervisor_name') || (!mods.clients && k === 'reminder_days');   // archive_keep_months: always (the archive is core)
    // Never send PINs. No prices for driver/collector. Collector never sees services.
    const settings = {};
    Object.keys(db.settings).forEach(k => {
      if (/pin$/i.test(k)) return;
      if (!admin && !STAFF_SETTINGS.includes(k) && !(s.role === 'driver' && DRIVER_SETTINGS.includes(k))) return;
      if (offSetting(k)) return;
      settings[k] = db.settings[k];
    });
    return {
      modules: mods,
      // "orders" off: the services are only checklist items (no prices, no priced_by)
      services: s.role === 'collector' ? [] : db.services.filter(x => x.active).map(x => {
        const out = { key: x.key, name_en: x.name_en, name_gu: x.name_gu, active: true };
        if (!mods.orders) return out;
        out.priced_by = pricedBy(x.key);   // not money: which services the tank sizes price
        if (admin) out.default_price = Number(x.default_price) || 0;
        return out;
      }),
      client_types: !mods.orders ? [] : db.client_types.map(c => ({ key: c.key, name_en: c.name_en, name_gu: c.name_gu, group: c.group || c.key })),
      areas: db.areas.map(a => ({ key: a.key, name_en: a.name_en, name_gu: a.name_gu, x: Number(a.x), y: Number(a.y) })),
      teams: db.teams.filter(t => t.active).map(t => {
        const out = { team: t.team, driver_name: t.driver_name, workers: Number(t.workers) || 0, active: true };
        if (admin) { out.driver_phone = String(t.driver_phone || ''); out.areas = splitList(t.areas); }
        // Log book: the vehicle and the workers' names. Admin: every team. Driver: own team only.
        // The collector never gets them.
        if (admin || (s.role === 'driver' && s.team === t.team)) {
          out.vehicle_no = String(t.vehicle_no || '').trim();
          out.worker_names = splitList(t.worker_names || '');
        }
        return out;
      }),
      settings
    };
  };

  // The collector gets the "to collect" list, and only the area filter applies to it.
  // Cancelled orders are left out, unless the ADMIN asks with include_cancelled:true
  // (Orders "All") or status:'cancelled'. Drivers and the collector never get them.
  // from / to: an order is in the range when it is "on" any day of it (a multi-day job on
  // each day of its span, and an unfinished one until today: jobInRange in common.js).
  // Supervisor: survey visits only (not yet measured, any date + measured in the last 7 days).
  // Drivers and the collector never get surveys. Admin may filter kind and quote_status.
  A['order.list'] = (b, s) => {
    let L = db.orders.slice();
    const wantCancelled = s.role === 'admin' && (b.include_cancelled === true || String(b.status || '') === CANCELLED);
    if (!wantCancelled) L = L.filter(o => !isCancelled(o));
    if (s.role === 'supervisor') {
      const since = addD(today(), -7);
      L = L.filter(o => isSurvey(o) && (o.status !== 'done' || String(o.done_at).slice(0, 10) >= since));
      return { orders: L.sort(byDateTime).map(o => filterForRole(o, s)) };
    }
    if (s.role !== 'admin' || !modOn('quotation')) L = L.filter(isJob);   // a survey is not a job (and no surveys at all without "quotation")
    if (b.area) L = L.filter(o => (o.area || 'other') === String(b.area));
    if (s.role === 'driver') L = L.filter(o => o.team === s.team);   // own team only, always
    if (s.role === 'collector') L = L.filter(o => inLedger(o.order_id) && balanceOf(o) > 0);
    else {
      if (b.from || b.to) L = L.filter(o => jobInRange(o, b.from ? String(b.from) : '', b.to ? String(b.to) : ''));
      if (b.status) L = L.filter(o => o.status === String(b.status));
      if (b.team && s.role === 'admin') L = L.filter(o => b.team === 'none' ? !o.team : o.team === String(b.team));
      if (b.kind && s.role === 'admin') L = L.filter(o => String(b.kind) === 'survey' ? isSurvey(o) : isJob(o));
      if (b.quote_status && s.role === 'admin') L = L.filter(o => o.quote_status === String(b.quote_status));
    }
    return { orders: L.sort(byDateTime).map(o => filterForRole(o, s)) };
  };

  // order.create {order}. order.kind 'survey' = a survey visit (no team, amount 0, services optional).
  // order.amc_id + amc_visit = an AMC visit (tanks and amount from the contract, price locked).
  // Amount: typed by the admin = kept and price_locked; else worked out (priceOrder).
  A['order.create'] = (b, s) => {
    const input = Object.assign({}, b.order || {});
    const has = k => Object.prototype.hasOwnProperty.call(input, k);
    const kind = String(input.kind === undefined || input.kind === null ? '' : input.kind).trim().toLowerCase() || 'cleaning';
    if (!['cleaning', 'survey'].includes(kind)) fail('BAD_INPUT', 'kind must be cleaning or survey.');
    const typed = has('amount') && String(input.amount === null ? '' : input.amount).trim() !== '';
    const amcId = String(input.amc_id === undefined || input.amc_id === null ? '' : input.amc_id).trim();
    const amcVisit = input.amc_visit;
    ['kind', 'amc_id', 'amc_visit'].forEach(k => delete input[k]);
    // Add-ons that are off: no survey visits, no AMC visits
    if (kind === 'survey' && !modOn('quotation')) offFail();
    if ((amcId || (amcVisit !== undefined && amcVisit !== null && amcVisit !== '')) && !modOn('amc')) offFail();
    if (kind === 'survey') {
      if (String(input.team === undefined || input.team === null ? '' : input.team).trim()) fail('BAD_INPUT', 'A survey visit has no team: the supervisor goes.');
      delete input.team; delete input.days;
    }
    const clean = cleanOrderInput(input, true, null, { survey: kind === 'survey' });
    clean.kind = kind;
    // No whatsapp given: copy what we already know about this client (blank if nothing known)
    if (clean.whatsapp === undefined || clean.whatsapp === '') {
      const w = waOrder(live(ordersOf(clean.phone)));
      clean.whatsapp = w ? w.whatsapp : '';
    }
    // Tank sizes not given: copy the client's last saved tanks, so the next visit is pre-filled
    if (clean.tanks === undefined) {
      clean.tanks = clientTanks(clean.phone).map(tankForSheet);
      // the copied tanks bring their cleaning services (orders.gs orderCreate)
      if (kind !== 'survey' && !amcId && modOn('orders') && clean.tanks.length) clean.services = withTankServices(clean.services, clean.tanks);
    }
    if (kind === 'survey') {
      if (amcId) fail('BAD_INPUT', 'A survey cannot be an AMC visit.');
      clean.team = ''; clean.amount = 0; clean.days = 1;
    } else if (amcId || (amcVisit !== undefined && amcVisit !== null && amcVisit !== '')) {
      const c = amcCheck(clean.phone, amcId, amcVisit), k = Number(amcVisit);
      clean.amc_id = c.amc_id; clean.amc_visit = k;
      clean.tanks = tanksOut(c.tanks).map(tankForSheet);
      clean.amount = amcShare(c, k);
      clean.price_locked = true;
    } else if (!modOn('orders')) {
      // "orders" off: no prices. The amount is what the admin typed (0 when nothing typed).
      clean.amount = typed ? clean.amount : 0;
    } else {
      // A typed amount that differs from the worked-out price is kept and locked
      const total = priceOrder({ tanks: clean.tanks, services: clean.services }).total;
      if (typed && Number(clean.amount) !== total) clean.price_locked = true;
      else clean.amount = total;
    }
    if (!clean.status) clean.status = clean.team ? 'assigned' : 'new';
    const o = Object.assign(blankOrder(), clean);
    o.order_id = db.nextOrderId++;
    o.created_at = nowIso();
    o.created_by = s.name || '';   // only admins create orders
    db.orders.push(o);
    return { order: filterForRole(o, s), suggestion: suggest(o.area, o.sched_date, o.order_id) };
  };

  // order.update {order_id, patch, reason?, notify?} -> {order, moved}
  // Changing the date or time of a job that is not done (or cancelled) is a RESCHEDULE,
  // exactly like order.reschedule (moved_from, 'moved' alert, "rescheduled" WhatsApp).
  A['order.update'] = (b, s) => {
    const o = getOrder(b.order_id);
    const patch = b.patch || {};
    const typed = Object.prototype.hasOwnProperty.call(patch, 'amount') && String(patch.amount === null ? '' : patch.amount).trim() !== '';
    if (isSurvey(o) && String(patch.team || '').trim()) fail('BAD_INPUT', 'A survey visit has no team: the supervisor goes.');
    const clean = cleanOrderInput(patch, false, o, { survey: isSurvey(o) });
    // The price: an amount typed by the admin is kept (and locked). Otherwise a change of
    // tanks or services works the amount out again, unless the price is locked.
    // price_locked:false unlocks (the amount is worked out again); a typed amount that differs
    // from the worked-out price locks it.
    const unlock = Object.prototype.hasOwnProperty.call(patch, 'price_locked') && !isYes(patch.price_locked);
    const calc = () => priceOrder({ tanks: clean.tanks !== undefined ? clean.tanks : o.tanks, services: clean.services || o.services }).total;
    if (isSurvey(o)) { delete clean.amount; delete clean.days; }
    else if (!modOn('orders')) { /* "orders" off: the typed amount is kept as it is, never worked out, never locked */ }
    else if (typed) { const t = calc(); if (Number(clean.amount) !== t) clean.price_locked = true; else if (unlock) clean.price_locked = false; }
    else if (unlock) { clean.price_locked = false; clean.amount = calc(); }
    else if ((clean.tanks !== undefined || clean.services !== undefined) && !o.price_locked) clean.amount = calc();
    const newDate = clean.sched_date !== undefined ? clean.sched_date : o.sched_date;
    const newTime = clean.sched_time !== undefined ? clean.sched_time : o.sched_time;
    const isMove = (newDate !== o.sched_date || newTime !== o.sched_time) && o.status !== 'done' && !isCancelled(o);
    o.updated_by = s.name || '';   // order.update is admin only
    if (!isMove) { Object.assign(o, clean); return { order: filterForRole(o, s), moved: false }; }
    const reason = moveReason(b.reason, s);
    if (newDate < today()) fail('BAD_INPUT', 'The new date cannot be in the past.');
    const move = { o, oldDate: o.sched_date, oldTime: o.sched_time, date: newDate, time: newTime, reason, notify: b.notify !== false };
    delete clean.sched_date; delete clean.sched_time;
    Object.assign(o, clean);        // the other edits first (e.g. a new team)
    applyMove(move, s);
    notifyMove(move, s);
    return { order: filterForRole(o, s), moved: true };
  };

  /* ---------- moving a job (shared by order.update and order.reschedule, as orders.gs) ---------- */
  // Drivers use the delay reasons; the office may also use MOVE_REASONS
  function moveReason(r, s) {
    const reason = String(r || 'other');
    if (REASON[reason]) return reason;
    if (s.role === 'admin' && MOVE_REASONS[reason]) return reason;
    return fail('BAD_INPUT', 'Unknown reason: ' + reason);
  }
  // Team KEPT; status back to assigned (or new without a team); moved_from only when the day changes
  function applyMove(m, s) {
    const o = m.o;
    if (m.date !== m.oldDate) o.moved_from = m.oldDate;
    o.sched_date = m.date; o.sched_time = m.time; o.status = o.team ? 'assigned' : 'new';
    o.reached_at = ''; o.delay_reason = m.reason; o.delay_min = null; o.eta_sent = '';   // delay_reason keeps why it was moved
    if (s.role === 'admin') {
      o.updated_by = s.name || '';
      addAlert('moved', 'ok', o.order_id, 'Office moved ' + o.client_name + ' from ' + m.oldDate + ' ' + fm(mins(m.oldTime)) +
        ' to ' + m.date + ' ' + fm(mins(m.time)) + '. Reason: ' + reasonEn(m.reason) + '.' + (m.notify ? '' : ' Customer not messaged.'), true);   // office's own action: seen
    } else {
      addAlert('moved', 'warn', o.order_id, (o.team ? 'Team ' + o.team : 'The team') + ' could not reach ' + o.client_name +
        ' on ' + m.oldDate + '. Reason: ' + reasonEn(m.reason) + '. Moved to ' + m.date + '.');
    }
  }
  // {date, time, reason} for driver and office alike (as orders.gs notifyMove_).
  // time = the new booked time; a driver's day-end move keeps the order's own time.
  // Office reasons go as Gujarati words, driver reasons as keys.
  function notifyMove(m, s) {
    if (!m.notify) return;
    const sent = waSend(m.o, 'rescheduled', { date: m.date, time: m.time, reason: MOVE_REASONS[m.reason] ? MOVE_REASONS[m.reason].gu : m.reason });
    // No WhatsApp and the OFFICE moved it: remind the office to call (a driver's move = the driver calls)
    if (!sent && s.role === 'admin') {
      addAlert('call', 'warn', m.o.order_id, 'Call ' + m.o.client_name + ' (+91 ' + phoneText(m.o.phone) + '): their job is moved to ' + m.date + ' ' + fm(mins(m.time)) +
        '. Reason: ' + reasonEn(m.reason) + '. No WhatsApp, so they were not messaged.');
    }
  }

  A['order.suggest'] = b => {
    if (!validDate(b.sched_date)) fail('BAD_INPUT', 'Date must look like 2026-10-07.');
    return suggest(String(b.area || ''), String(b.sched_date), b.order_id || '');
  };

  A['order.assign'] = (b, s) => {
    if (!b.smart) {
      const o = getOrder(b.order_id);
      if (isSurvey(o)) fail('BAD_STATUS', 'A survey visit has no team: the supervisor goes.');
      if (o.status === 'done') fail('BAD_STATUS', 'This job is already done.');
      if (isCancelled(o)) fail('BAD_STATUS', 'This order is cancelled. Restore it first.');
      const team = String(b.team || '').trim().toUpperCase();
      if (team && !activeTeams().includes(team)) fail('BAD_INPUT', 'Unknown or inactive team: ' + team);
      if (team && o.status === 'new') o.status = 'assigned';
      if (!team && o.status === 'assigned') o.status = 'new';
      o.team = team;
      o.updated_by = s.name || '';
      return { assigned: [{ order_id: o.order_id, team, why: team ? 'Chosen by admin' : 'Unassigned' }] };
    }
    // Smart assign: "new" orders from today on (or the "new" ones among order_ids),
    // by date and time; each assignment counts for the next one
    const ids = Array.isArray(b.order_ids) && b.order_ids.length ? b.order_ids.map(String) : null;
    const t = today(), assigned = [];
    db.orders.filter(o => o.status === 'new' && isJob(o) && (ids ? ids.includes(String(o.order_id)) : o.sched_date >= t))
      .sort(byDateTime).forEach(o => {
        const sg = suggest(o.area, o.sched_date, o.order_id);
        if (!sg.team) return;
        o.team = sg.team; o.status = 'assigned'; o.updated_by = s.name || '';
        assigned.push({ order_id: o.order_id, team: sg.team, why: sg.why });
      });
    return { assigned };
  };

  /* ---------- driver actions ---------- */
  // A multi-day job: reached_at is set on the FIRST day only; every day's reach is kept as an
  // open entry in work_days {date, reached, left:''}. arrival_confirm goes on the first day only.
  A['order.reached'] = (b, s) => {
    const o = ownOrder(b.order_id, s);
    if (o.status === 'reached' || o.status === 'done') return { order: filterForRole(o, s) };   // double tap: nothing to do, no message
    if (!OPEN.includes(o.status)) fail('BAD_STATUS', 'This job is not assigned yet.');
    const first = !o.reached_at, now = nowIso(), n = jobDays(o);
    o.status = 'reached';
    if (first) o.reached_at = now;
    if (n > 1) {
      const wd = workDays(o).filter(x => x.left);
      wd.push({ date: today(), reached: now, left: '', overtime_min: 0 });
      o.work_days = wd;
    }
    const late = o.sched_date === today() && o.sched_time ? nowMin() - mins(o.sched_time) : 0;
    if (late > setting('late_alert_min', 10)) {
      addAlert('delay', 'warn', o.order_id, 'Team ' + o.team + ' reached ' + o.client_name + ' ' + late + ' min late.' +
        (o.delay_reason ? ' Reason: ' + reasonEn(o.delay_reason) + '.' : ' No reason was given.'));
    } else addAlert('info', 'ok', o.order_id, 'Team ' + o.team + ' reached ' + o.client_name + ' at ' + fm(nowMin()) +
      (n > 1 ? ' (day ' + jobDayNo(o, today()) + ' of ' + n + ')' : '') + '.');
    if (first) waSend(o, 'arrival_confirm', {});
    return { order: filterForRole(o, s) };
  };

  // Close today's open work_days entry of a multi-day job (left = now, overtime of the day)
  function closeDay(o) {
    const now = nowIso(), wd = workDays(o).map(x => Object.assign({}, x));
    let e = wd.find(x => !x.left);
    if (!e) { e = { date: today(), reached: o.reached_at || now, left: '', overtime_min: 0 }; wd.push(e); }
    e.left = now;
    e.overtime_min = otBetween(e.reached, e.left);
    o.work_days = wd;
    return e;
  }

  // order.dayDone {order_id} (driver, own team): "today's work is done, we come back tomorrow".
  // Only on a multi-day job that is 'reached'. Status -> 'ongoing'. No WhatsApp to the customer.
  A['order.dayDone'] = (b, s) => {
    const o = ownOrder(b.order_id, s);
    if (jobDays(o) <= 1) fail('BAD_STATUS', 'This is a one-day job: use work done.');
    if (o.status === 'ongoing') return { order: filterForRole(o, s), day: workDays(o).filter(w => w.left).pop() || null };   // double tap
    if (o.status !== 'reached') fail('BAD_STATUS', 'Tap "reached" first.');
    const e = closeDay(o);
    o.status = 'ongoing';
    addAlert('info', 'ok', o.order_id, 'Team ' + o.team + ' finished day ' + workDays(o).length + ' of ' + jobDays(o) + ' at ' + o.client_name +
      ' (' + fm(mins(e.reached)) + ' to ' + fm(mins(e.left)) + ').' + (e.overtime_min > 0 ? ' Overtime ' + e.overtime_min + ' min.' : '') + ' More days to go.');
    return { order: filterForRole(o, s), day: e };
  };

  A['order.done'] = (b, s) => {
    const o = ownOrder(b.order_id, s);
    if (o.status === 'done') return { order: filterForRole(o, s), overtime_min: o.overtime_min };   // double tap: no message
    if (o.status !== 'reached') fail('BAD_STATUS', 'Tap "reached" before finishing the job.');
    const done = splitList(b.done);
    // A task without a checklist (no services: possible when "orders" is off) needs no ticks
    if (!done.length && (o.services || []).length) fail('BAD_INPUT', 'Tick at least one service that was done.');
    done.forEach(k => { if (!o.services.includes(k)) fail('BAD_INPUT', 'This service was not ordered: ' + k); });
    // Log book: crew (not given = keep; checked BEFORE anything is saved).
    // Tanks from a driver are IGNORED (orders.gs, 2026-10-08): the saved sizes stay and the
    // amount is never re-priced here. A different size at the site -> order.sizeIssue.
    const has = k => b[k] !== undefined && b[k] !== null;
    const crew = has('crew') ? cleanCrew(b.crew, o.team) : null;
    if (crew) o.crew = crew;
    o.status = 'done';
    o.done_at = nowIso();
    o.done_checklist = done;
    o.not_done = o.services.filter(k => !done.includes(k));
    if (jobDays(o) > 1) closeDay(o);   // the last day of a multi-day job; overtime = all its days
    o.overtime_min = overtimeOf(o);
    const svc = k => (db.services.find(v => v.key === k) || { name_en: k }).name_en;
    if (o.not_done.length) addAlert('partial', 'bad', o.order_id, o.client_name + ': ' + done.length + ' of ' + o.services.length +
      ' services done. Not done: ' + o.not_done.map(svc).join(', ') + '. Check before invoicing.');
    else addAlert('info', 'ok', o.order_id, 'Team ' + o.team + ' finished ' + o.client_name + ' at ' + fm(mins(o.done_at)) +
      '. All ' + o.services.length + ' services done.');
    if (o.overtime_min > 0) addAlert('overtime', 'warn', o.order_id, 'Team ' + o.team + ' worked ' + o.overtime_min + ' min overtime at ' + o.client_name + '.');
    waSend(o, 'work_done_checklist', { done: o.done_checklist, not_done: o.not_done });
    return { order: filterForRole(o, s), overtime_min: o.overtime_min };
  };

  A['order.delay'] = (b, s) => {
    const m = Math.round(Number(b.mins));
    if (!(m > 0 && m <= 600)) fail('BAD_INPUT', 'Minutes late must be between 1 and 600.');
    const reason = String(b.reason || 'other');
    if (!LATE_REASONS.includes(reason)) fail('BAD_INPUT', 'Unknown reason: ' + reason);   // end-of-day reasons are not "late" reasons
    const o = ownOrder(b.order_id, s);
    if (!OPEN.includes(o.status)) fail('BAD_STATUS', 'Only a job not yet started can be delayed.');
    o.status = 'delayed'; o.delay_min = m; o.delay_reason = reason;
    addAlert('delay', 'warn', o.order_id, 'Team ' + o.team + ' will reach ' + o.client_name + ' about ' + m + ' min late. Reason: ' + reasonEn(reason) + '.');
    // New arrival time (orders.gs delayArrival_): later of now and the booked time,
    // plus the minutes late, rounded UP to 5 minutes. Sent as "HH:MM".
    const now = nowMin(), booked = mins(o.sched_time);
    const base = booked !== null && (o.sched_date > today() || (o.sched_date === today() && booked > now)) ? booked : now;
    waSend(o, 'delay', { mins: m, reason, time: hhmm((Math.ceil((base + m) / 5) * 5) % (24 * 60)) });
    return { order: filterForRole(o, s) };
  };

  // eta.gs orderLeave -> {next_order_id, eta ("HH:MM", 24 h), late_min}
  A['order.leave'] = (b, s) => {
    const o = ownOrder(b.order_id, s);
    if (o.status !== 'done') fail('BAD_STATUS', 'Mark this job as done first.');
    const nx = nextStop(o);
    if (!nx) return { next_order_id: null, eta: null, late_min: 0 };
    // ETA = max(now + travel, scheduled time), rounded UP to 5 minutes
    const sched = mins(nx.sched_time);
    const eta = Math.ceil(Math.max(nowMin() + travelMin(o.area, nx.area), sched) / 5) * 5;
    const lateBy = eta - sched, late = lateBy > setting('late_alert_min', 10);
    // Very late or after office hours: no automatic message, the owner calls instead (as eta.gs)
    const hold = lateBy > setting('max_auto_late_min', 120) || eta > mins(db.settings.office_end || '17:00') + 60;
    if (!hold) nx.eta_sent = hhmm(eta);
    if (late) { nx.status = 'delayed'; nx.delay_min = Math.round(lateBy / 5) * 5; nx.delay_reason = 'prev'; }
    const text = 'Team ' + o.team + ' left ' + o.client_name + ' for ' + nx.client_name + ', expected around ' + fm(eta);
    if (hold) addAlert('delay', 'bad', nx.order_id, text + ' (' + lateBy + ' min late). Customer NOT messaged: please call them or move the job.');
    else addAlert(late ? 'delay' : 'info', late ? 'warn' : 'ok', nx.order_id, text + (late ? '. About ' + lateBy + ' min behind schedule, ' +
      (noWa(nx) ? 'customer has no WhatsApp: the team will call them.' : 'customer informed.') : '.'));
    // time goes to WhatsApp as "HH:MM" (24 h); whatsapp.gs turns it into "h:mm AM/PM" for the customer
    if (!hold) waSend(nx, 'arrival_time', { time: hhmm(eta), late });
    return { next_order_id: nx.order_id, eta: hhmm(eta), late_min: Math.max(0, lateBy), customer_told: !hold,
      next_whatsapp: noWa(nx) ? 'no' : 'yes' };   // 'no' = nothing sent: the driver calls the next customer
  };

  // order.confirm {order_id, answer:'yes'|'no'} (driver, own team): for a client WITHOUT WhatsApp
  // the driver asks in person after the work and taps "ગ્રાહક સંમત" / "ગ્રાહક અસંમત".
  // Only for a done job with whatsapp 'no'. 'no' -> dispute + dispute alert (as the WhatsApp "No").
  // Already answered: nothing changes (a double tap never makes a second alert).
  A['order.confirm'] = (b, s) => {
    const answer = String(b.answer || '').trim().toLowerCase();
    if (!['yes', 'no'].includes(answer)) fail('BAD_INPUT', 'answer must be yes or no.');
    const o = ownOrder(b.order_id, s);
    if (o.status !== 'done') fail('BAD_STATUS', 'Finish the job before asking the customer.');
    if (!noWa(o)) fail('BAD_STATUS', 'This customer uses WhatsApp; they answer there.');
    if (o.customer_confirm === answer) return { order: filterForRole(o, s) };   // same answer again: no change
    if (o.customer_confirm) fail('BAD_STATUS', 'The customer already answered.');
    const who = o.client_name + ' (order ' + o.order_id + ')';
    o.customer_confirm = answer;
    if (answer === 'yes') addAlert('info', 'ok', o.order_id, who + ' confirmed the work is complete (told the driver in person).');
    else {
      o.dispute = true;
      addAlert('dispute', 'warn', o.order_id, who + ' says the completion details are NOT correct (told the driver in person, no WhatsApp). Please call the customer.');
    }
    return { order: filterForRole(o, s) };
  };

  // order.sizeIssue {order_id, note} (driver, own team; added 2026-10-08, as orders.gs orderSizeIssue):
  // drivers see the tanks read-only; "માપ અલગ છે" tells the office. Only a 'warn' alert size_issue,
  // nothing else is saved. Any status except cancelled; note 1-300 characters.
  A['order.sizeIssue'] = (b, s) => {
    const note = String(b.note === undefined || b.note === null ? '' : b.note).replace(/\s+/g, ' ').trim();
    if (!note) fail('BAD_INPUT', 'Say what is different about the tanks.');
    if (note.length > 300) fail('BAD_INPUT', 'The note is too long (at most 300 characters).');
    const o = ownOrder(b.order_id, s);   // own team only, never a cancelled job
    if (s.role === 'driver' && o.kind === 'survey') fail('FORBIDDEN', 'This job belongs to another team.');
    addAlert('size_issue', 'warn', o.order_id, (o.team ? 'Team ' + o.team : 'The team') + ' says the tank sizes at ' + o.client_name +
      ' are different: ' + note + '. Check the sizes and the price.');
    return { ok: true, alert_id: db.alerts[db.alerts.length - 1].alert_id };
  };

  // order.reschedule {items:[{order_id, reason, new_date, new_time?, notify?}]} -> {moved}
  // Admin may also give new_time and the office reasons; notify:false = no WhatsApp.
  // All items are checked first: if one is wrong, nothing is moved (as orders.gs)
  A['order.reschedule'] = (b, s) => {
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) fail('BAD_INPUT', 'Nothing to move.');
    const t = today();
    const plan = items.map(it => {
      const o = ownOrder(it.order_id, s);   // also refuses cancelled orders
      if (o.status === 'done') fail('BAD_STATUS', 'Order ' + o.order_id + ' is already done.');
      if (o.status === 'ongoing' || workDays(o).length) fail('BAD_STATUS', 'Order ' + o.order_id + ' has started (several days): it cannot be moved.');
      const nd = String(it.new_date || '');
      if (!validDate(nd)) fail('BAD_INPUT', 'New date must look like 2026-10-08.');
      if (nd < t) fail('BAD_INPUT', 'The new date cannot be in the past.');
      const nt = (it.new_time === undefined || it.new_time === null || it.new_time === '') ? o.sched_time : cleanTime(it.new_time);
      if (nd === o.sched_date && nt === o.sched_time) fail('BAD_INPUT', 'Pick a different date or time.');
      return { o, oldDate: o.sched_date, oldTime: o.sched_time, date: nd, time: nt,
        reason: moveReason(it.reason, s), notify: s.role !== 'admin' || it.notify !== false };
    });
    plan.forEach(p => applyMove(p, s));
    plan.forEach(p => notifyMove(p, s));
    return { moved: plan.length };
  };

  /* ---------- admin: cancel and restore (orders.gs orderCancel / orderRestore) ---------- */
  // Cancelled orders vanish from drivers, Team routes, next stop, suggestions, ledger,
  // revenue, reminders, the collector and the Dashboard. The customer is NOT messaged
  // (no approved "cancelled" template yet; could be added later).
  A['order.cancel'] = (b, s) => {
    const o = getOrder(b.order_id);
    if (o.status === 'done') fail('BAD_STATUS', 'This job is done; it cannot be cancelled.');
    if (!isCancelled(o)) {
      const reason = String(b.reason === undefined || b.reason === null ? '' : b.reason).trim().slice(0, 200);
      o.status = CANCELLED; o.cancel_reason = reason; o.cancelled_at = nowIso();   // the team is kept for restore
      o.cancelled_by = s.name || '';
      const notify = b.notify === true;
      addAlert('info', 'ok', o.order_id, 'Order #' + o.order_id + ' for ' + o.client_name + ' (' + o.sched_date + ' ' + fm(mins(o.sched_time)) +
        ') was cancelled. Reason: ' + (reason || 'not given') + '.' + (notify ? '' : ' Customer not messaged.'), true);   // office's own action: seen
      // notify:true (added 2026-10-09): the "cancelled" WhatsApp with the booked date and time (orders.gs orderCancel)
      if (notify) {
        const sent = waSend(o, 'cancelled', { date: o.sched_date, time: o.sched_time });
        if (!sent) addAlert('call', 'warn', o.order_id, 'Call ' + o.client_name + ' (+91 ' + phoneText(o.phone) + '): their booking on ' + o.sched_date + ' ' +
          fm(mins(o.sched_time)) + ' is cancelled. No WhatsApp, so they were not messaged.');
        return { order: filterForRole(o, s), whatsapp: sent ? 'yes' : 'no' };
      }
    }
    return { order: filterForRole(o, s) };
  };
  A['order.restore'] = (b, s) => {
    const o = getOrder(b.order_id);
    if (!isCancelled(o)) fail('BAD_STATUS', 'This order is not cancelled.');
    o.status = o.team ? 'assigned' : 'new'; o.cancel_reason = ''; o.cancelled_at = ''; o.reached_at = '';
    o.cancelled_by = ''; o.updated_by = s.name || '';
    addAlert('info', 'ok', o.order_id, 'Order #' + o.order_id + ' for ' + o.client_name + ' was restored (' + o.sched_date + ' ' + fm(mins(o.sched_time)) + ').', true);   // office's own action: seen
    return { order: filterForRole(o, s) };
  };

  /* ---------- ledger and payments (ledger.gs) ---------- */
  // A cancelled payment is never deleted: payment.cancel adds a MINUS row with
  // ref "cancel-<payment id>" (as ledger.gs). All totals are plain sums of db.payments.
  const CANCEL_REF = 'cancel-';
  const isCancelRow = p => String(p.ref || '').indexOf(CANCEL_REF) === 0;
  const cancelledSet = () => { const m = {}; db.payments.forEach(p => { if (isCancelRow(p)) m[String(p.ref).slice(CANCEL_REF.length)] = true; }); return m; };

  A['ledger.get'] = (b, s) => {
    let rows = db.ledger.map(r => {
      const o = db.orders.find(x => x.order_id === r.order_id);
      const billed = o ? o.amount : (Number(r.billed) || 0), paid = paidOf(r.order_id);
      return {
        week_start: r.week_start, order_id: r.order_id,
        client_name: o ? o.client_name : r.client_name, phone: o ? o.phone : r.phone,
        address: o ? o.address : r.address, area: o ? o.area : r.area,
        sched_date: o ? o.sched_date : '', billed, paid, balance: round2(billed - paid),
        whatsapp: clientWa(o ? o.phone : r.phone)   // 'no': the collector tells the receipt in person
      };
    });
    if (b.area) rows = rows.filter(r => (r.area || 'other') === String(b.area));
    // The collector also gets the job date (one line per client, the jobs inside the chat)
    if (s.role !== 'admin') rows = rows.filter(r => r.balance > 0).map(r => pick(r, COLLECTOR_FIELDS.concat(['sched_date'])));
    const t = today(), cancelled = cancelledSet();
    // Today's payments: a cancelled one stays (cancelled: true), the minus row is not listed
    const today_payments = db.payments.filter(p => p.date.slice(0, 10) === t && !isCancelRow(p)).map(p => {
      const o = db.orders.find(x => x.order_id === p.order_id);
      return { payment_id: p.payment_id, order_id: p.order_id, client_name: o ? o.client_name : '', phone: o ? o.phone : '', amount: p.amount, mode: p.mode,
        time: p.date.slice(11, 16), note: p.note || '', cancelled: !!cancelled[p.payment_id] };
    }).reverse();   // newest first
    return { rows, total: round2(rows.reduce((a, r) => a + Math.max(0, r.balance), 0)), today_payments };
  };

  // Only done jobs, not yet in the ledger, that still have money to collect.
  // order_ids (optional): only the jobs the admin saw in the preview.
  A['ledger.build'] = b => {
    if (b.order_ids !== undefined && b.order_ids !== null && !Array.isArray(b.order_ids)) fail('BAD_INPUT', 'order_ids must be a list.');
    const only = Array.isArray(b.order_ids) ? b.order_ids.map(Number) : null;
    const week = mondayOf(today());
    const ready = db.orders.filter(o => o.status === 'done' && isJob(o) && !inLedger(o.order_id) && balanceOf(o) > 0 &&
      (!only || only.includes(o.order_id)));
    ready.forEach(o => db.ledger.push(ledgerRowFor(o, week)));
    return { added: ready.length };
  };

  // A client's unpaid ledger jobs, oldest first: [{o, bal}]
  const clientJobs = phone => db.orders.filter(o => o.phone === phone && inLedger(o.order_id) && !isCancelled(o))
    .sort(byDateTime).map(o => ({ o, bal: balanceOf(o) })).filter(j => j.bal > 0);

  // payment.add: {order_id, ...} for one job, or {phone, ...} for one client (split over the oldest jobs first)
  A['payment.add'] = (b, s) => {
    const amt = round2(b.amount);
    if (!(amt > 0)) fail('BAD_INPUT', 'Amount must be more than 0.');
    const mode = String(b.mode || '').toLowerCase();
    if (!MODES.includes(mode)) fail('BAD_INPUT', 'Payment mode must be cash, upi, cheque, bank or other.');
    const note = String(b.note === undefined || b.note === null ? '' : b.note).trim();
    // ref = the app's id for this payment attempt: a retry with the same ref is not saved twice
    const ref = String(b.ref === undefined || b.ref === null ? '' : b.ref).trim().slice(0, 100);
    if (mode === 'cheque' && !note && s.role === 'collector') fail('BAD_INPUT', 'Write the cheque number and bank in the note.');
    const who = s.role === 'admin' ? (s.name || 'Admin') : 'collector';   // an admin: their own name
    const byPhone = (b.order_id === undefined || b.order_id === null || b.order_id === '') && b.phone;

    if (byPhone) {
      const phone = normPhone(b.phone) || fail('BAD_INPUT', 'Enter a 10 digit phone number.');
      if (ref) {
        const same = db.payments.find(p => p.ref === ref + '-1' || p.ref === ref);
        if (same) {
          const ids = db.payments.filter(p => p.ref === ref || (String(p.ref).indexOf(ref + '-') === 0 && /^\d+$/.test(String(p.ref).slice(ref.length + 1)))).map(p => p.payment_id);
          return { payment_id: same.payment_id, payment_ids: ids, balance: round2(clientJobs(phone).reduce((a, j) => a + j.bal, 0)), duplicate: true };   // no 2nd WhatsApp
        }
      }
      const jobs = clientJobs(phone);
      if (!jobs.length) fail('NOT_FOUND', 'Nothing to collect from this client.');
      const total = round2(jobs.reduce((a, j) => a + j.bal, 0));
      if (amt > total) fail('BAD_INPUT', 'Amount is more than the balance (' + inr(total) + ').');
      let rest = amt;
      const parts = [], ids = [], when = nowIso();
      for (const j of jobs) {
        if (rest <= 0) break;
        const take = round2(Math.min(rest, j.bal));
        rest = round2(rest - take);
        const p = { payment_id: 'P' + db.nextPaymentId++, order_id: j.o.order_id, date: when, amount: take, mode,
          collector: who, note, ref: ref ? ref + '-' + (ids.length + 1) : '' };
        db.payments.push(p);
        ids.push(p.payment_id);
        parts.push({ order_id: j.o.order_id, amount: take, balance: round2(j.bal - take) });
      }
      const left = round2(total - amt), first = jobs[0].o, last = jobs[parts.length - 1].o;
      addAlert('info', 'ok', first.order_id, inr(amt) + ' collected from ' + first.client_name + ' by ' + MODES_EN[mode] +
        (parts.length > 1 ? ' (' + parts.map(p => '#' + p.order_id + ' ' + inr(p.amount)).join(', ') + ')' : '') + '. ' +
        (left > 0 ? 'Balance ' + inr(left) + '.' : 'Fully paid.'));
      waSend(last, 'payment_thanks', { amount: amt, mode, balance: left });   // ONE thank-you with the client's new total
      return { payment_id: ids[0], payment_ids: ids, balance: left, parts, whatsapp: clientWa(phone) };
    }

    if (ref) {
      const same = db.payments.find(p => p.ref === ref);
      if (same) return { payment_id: same.payment_id, balance: balanceOf(getOrder(same.order_id)), duplicate: true }; // no 2nd WhatsApp
    }
    const o = getOrder(b.order_id);
    if (s.role === 'collector' && !inLedger(o.order_id)) fail('FORBIDDEN', 'This job is not in the ledger.');
    const bal = balanceOf(o);
    if (amt > bal) fail('BAD_INPUT', 'Amount is more than the balance (' + inr(bal) + ').');
    const p = { payment_id: 'P' + db.nextPaymentId++, order_id: o.order_id, date: nowIso(), amount: amt, mode,
      collector: who, note, ref };
    db.payments.push(p);
    const left = round2(bal - amt);
    addAlert('info', 'ok', o.order_id, inr(amt) + ' collected from ' + o.client_name + ' by ' + MODES_EN[mode] + '. ' + (left > 0 ? 'Balance ' + inr(left) + '.' : 'Fully paid.'));
    waSend(o, 'payment_thanks', { amount: amt, mode, balance: left });
    return { payment_id: p.payment_id, balance: left, whatsapp: clientWa(o.phone) };   // 'no' = thank-you skipped
  };

  // Admin only: cancel a wrong payment. Nothing is deleted: a minus row is added (as ledger.gs).
  A['payment.cancel'] = (b, s) => {
    const pid = String(b.payment_id === undefined || b.payment_id === null ? '' : b.payment_id).trim();
    const reason = String(b.reason === undefined || b.reason === null ? '' : b.reason).trim().slice(0, 200);
    if (!pid) fail('BAD_INPUT', 'Which payment? payment_id is missing.');
    if (!reason) fail('BAD_INPUT', 'Write why the payment is cancelled.');
    const p = db.payments.find(x => x.payment_id === pid) || fail('NOT_FOUND', 'Payment not found.');
    if (isCancelRow(p) || !(p.amount > 0)) fail('BAD_INPUT', 'This row is itself a cancellation.');
    const already = db.payments.find(x => x.ref === CANCEL_REF + pid);
    if (already) return { payment_id: already.payment_id, cancelled: pid, balance: balanceOf(getOrder(p.order_id)), duplicate: true };
    const o = db.orders.find(x => x.order_id === p.order_id) || fail('BAD_INPUT', 'This order is archived. Correct it in the Sheet.');
    const who = s.name || 'Admin';
    const minus = { payment_id: 'P' + db.nextPaymentId++, order_id: o.order_id, date: nowIso(), amount: -p.amount, mode: p.mode,
      collector: who, note: 'Cancels ' + pid + ': ' + reason, ref: CANCEL_REF + pid };
    db.payments.push(minus);
    const bal = balanceOf(o);
    addAlert('info', 'ok', o.order_id, 'Payment ' + inr(p.amount) + ' (' + o.client_name + ', ' + (MODES_EN[p.mode] || p.mode) + ', ' + p.date.slice(0, 10) +
      ') cancelled by ' + who + ': ' + reason + '. Balance now ' + inr(bal) + '.');   // no customer WhatsApp
    return { payment_id: minus.payment_id, cancelled: pid, balance: bal };
  };

  // Admin only: payments between two dates (default: the last 30 days), newest first
  A['payment.list'] = b => {
    const t = today();
    const from = b.from ? String(b.from) : addD(t, -30);
    const to = b.to ? String(b.to) : t;
    if (!validDate(from) || !validDate(to)) fail('BAD_INPUT', 'Dates must look like 2026-10-07.');
    const cancelled = cancelledSet();
    const payments = db.payments.filter(p => p.date.slice(0, 10) >= from && p.date.slice(0, 10) <= to)
      .map(p => {
        const o = allOrders().find(x => x.order_id === p.order_id);   // archived orders too (for the name)
        return { payment_id: p.payment_id, order_id: p.order_id, client_name: o ? o.client_name : '',
          date: p.date, amount: p.amount, mode: p.mode, collector: p.collector, note: p.note || '',
          cancelled: !!cancelled[p.payment_id], cancel_of: isCancelRow(p) ? String(p.ref).slice(CANCEL_REF.length) : '' };
      })
      .sort((x, y) => x.date < y.date ? 1 : x.date > y.date ? -1 : 0);
    return { payments };
  };

  /* ---------- reports (reports.gs) ---------- */
  // 'today' | 'week' (Mon-Sun) | 'month' -> {from, to}
  function rangeDates(range) {
    const t = today();
    if (range === 'today') return { from: t, to: t };
    if (range === 'week') { const m = mondayOf(t); return { from: m, to: addD(m, 6) }; }
    if (range === 'month') { const f = t.slice(0, 8) + '01', n = pd(f); n.setMonth(n.getMonth() + 1); return { from: f, to: addD(isoOf(n), -1) }; }
    return fail('BAD_INPUT', 'Range must be today, week or month.');
  }

  // by_team: one line per active team (always all teams); orders and total_min: only the chosen team, if given
  A['report.overtime'] = b => {
    const r = rangeDates(b.range || 'today');
    const team = b.team ? String(b.team) : '';
    const lines = db.teams.filter(t => t.active).map(t => ({ team: t.team, driver_name: t.driver_name, jobs: 0, ot_jobs: 0, minutes: 0 }));
    const orders = [];
    db.orders.forEach(o => {
      if (o.status !== 'done' || isSurvey(o) || o.sched_date < r.from || o.sched_date > r.to) return;
      const ot = o.overtime_min || overtimeOf(o);   // the saved value; worked out again only when missing
      const line = lines.find(x => x.team === o.team);
      if (line) { line.jobs++; if (ot > 0) { line.ot_jobs++; line.minutes += ot; } }
      if (ot <= 0 || (team && o.team !== team)) return;
      orders.push({ order_id: o.order_id, client_name: o.client_name, area: o.area, team: o.team, sched_date: o.sched_date,
        reached_at: o.reached_at || '', done_at: o.done_at || '', overtime_min: ot });
    });
    orders.sort((x, y) => x.sched_date < y.sched_date ? -1 : x.sched_date > y.sched_date ? 1 : x.order_id - y.order_id);
    return { from: r.from, to: r.to, total_min: orders.reduce((a, x) => a + x.overtime_min, 0), by_team: lines, orders };
  };

  A['report.revenue'] = b => {
    const r = rangeDates(b.range || 'week'), by_day = [];
    for (let day = r.from; day <= r.to; day = addD(day, 1)) {
      const os = db.orders.filter(o => o.sched_date === day && !isCancelled(o) && isJob(o));   // a cancelled job (or a survey) is not booked work
      by_day.push({
        date: day,
        done: os.filter(o => o.status === 'done').reduce((a, o) => a + o.amount, 0),
        booked: os.reduce((a, o) => a + o.amount, 0)
      });
    }
    const collected = db.payments.filter(p => p.date.slice(0, 10) >= r.from && p.date.slice(0, 10) <= r.to).reduce((a, p) => a + p.amount, 0);
    return {
      from: r.from, to: r.to, by_day,
      done_total: by_day.reduce((a, x) => a + x.done, 0),
      booked_total: by_day.reduce((a, x) => a + x.booked, 0),
      collected
    };
  };

  /* ---------- monthly report (report.month, admin only) ----------
     Everything is counted by the booked date (sched_date) inside the month, over live
     AND archived orders. Payments count by the date they were received. */

  // '2026-10' -> first and last day: ['2026-10-01', '2026-10-31']
  function monthDays(m) {
    const f = m + '-01', n = pd(f);
    n.setMonth(n.getMonth() + 1);
    return [f, addD(isoOf(n), -1)];
  }
  // '2026-10' and -1 -> '2026-09'
  function monthAdd(m, k) {
    const x = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + k, 1);
    return x.getFullYear() + '-' + pad2(x.getMonth() + 1);
  }

  // The totals T for one month (the same block is used for "this month" and "last month")
  function monthTotals(allIn, m) {
    const r = monthDays(m), inMonth = o => o.sched_date >= r[0] && o.sched_date <= r[1];
    const all = allIn.filter(isJob);   // surveys are not jobs (counted separately below)
    const os = all.filter(inMonth), live = os.filter(o => !isCancelled(o)), done = live.filter(o => o.status === 'done');
    const sum = (list, f) => round2(list.reduce((a, o) => a + (Number(f(o)) || 0), 0));
    // Surveys and quotations of the month (by the survey's booked date)
    const sv = allIn.filter(o => isSurvey(o) && inMonth(o) && !isCancelled(o));
    const approved = sv.filter(o => o.quote_status === 'approved');
    const contracts = db.contracts.filter(c => String(c.created_at).slice(0, 7) === m);
    // new client = their FIRST ever not-cancelled order is in this month
    const first = {};
    all.filter(o => !isCancelled(o)).forEach(o => { if (!first[o.phone] || o.sched_date < first[o.phone]) first[o.phone] = o.sched_date; });
    const phones = Array.from(new Set(live.map(o => o.phone)));
    const newClients = phones.filter(p => inMonth({ sched_date: first[p] })).length;
    return {
      orders: live.length, done: done.length, open: live.length - done.length, cancelled: os.length - live.length,
      moved: live.filter(o => o.moved_from).length,
      partial: done.filter(o => (o.not_done || []).length).length,
      disputes: live.filter(o => o.dispute).length,            // cancelled orders do not count
      late: live.filter(o => Number(o.delay_min) > 0).length,
      booked_amount: sum(live, o => o.amount), billed: sum(done, o => o.amount),
      collected: round2(db.payments.filter(p => p.date.slice(0, 10) >= r[0] && p.date.slice(0, 10) <= r[1]).reduce((a, p) => a + p.amount, 0)),
      due: sum(done, o => Math.max(0, o.amount - paidOf(o.order_id))),
      overtime_min: sum(done, o => o.overtime_min),
      new_clients: newClients, repeat_clients: phones.length - newClients,
      // quotations: surveys measured; sent = reached the customer (sent, approved or declined)
      surveys: sv.filter(o => o.status === 'done').length,
      quotes_sent: sv.filter(o => o.quote_sent_at || ['sent', 'approved', 'declined'].includes(o.quote_status)).length,
      quotes_approved: approved.length,
      quotes_declined: sv.filter(o => o.quote_status === 'declined').length,
      quote_value_approved: sum(approved, o => o.quote_amount),
      // AMC: visits done this month, contracts made this month and their value
      amc_visits: done.filter(o => o.amc_id).length,
      new_contracts: contracts.length,
      contract_value: round2(contracts.reduce((a, c) => a + (Number(c.amount) || 0), 0))
    };
  }

  // report.month leaves out the quotation and AMC totals when those add-ons are off
  function monthAddons(T) {
    const mods = modulesOn();
    if (!mods.quotation) ['surveys', 'quotes_sent', 'quotes_approved', 'quotes_declined', 'quote_value_approved'].forEach(k => { delete T[k]; });
    if (!mods.amc) ['amc_visits', 'new_contracts', 'contract_value'].forEach(k => { delete T[k]; });
    return T;
  }

  A['report.month'] = b => {
    const m = b.month === undefined || b.month === null || b.month === '' ? today().slice(0, 7) : String(b.month);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) fail('BAD_INPUT', 'Month must look like 2026-10.');
    const r = monthDays(m), all = allOrders();
    const done = all.filter(o => o.status === 'done' && isJob(o) && o.sched_date >= r[0] && o.sched_date <= r[1]);
    const bigFirst = (x, y) => (y.jobs - x.jobs) || ((y.billed || 0) - (x.billed || 0));
    // Add one done job to a group in a list ({key: ...} rows)
    const addTo = (map, key, o, extra) => {
      const g = map[key] = map[key] || Object.assign({ key, jobs: 0, billed: 0 }, extra || {});
      g.jobs++; g.billed = round2(g.billed + (Number(o.amount) || 0));
      return g;
    };

    const by_day = [];
    for (let day = r[0]; day <= r[1]; day = addD(day, 1)) {
      const ds = done.filter(o => o.sched_date === day);
      by_day.push({ date: day, jobs: ds.length, billed: round2(ds.reduce((a, o) => a + o.amount, 0)) });
    }
    // services that were actually done (services minus not_done)
    const svc = {};
    done.forEach(o => o.services.filter(k => !(o.not_done || []).includes(k)).forEach(k => { svc[k] = svc[k] || { key: k, jobs: 0 }; svc[k].jobs++; }));
    const area = {}, type = {}, client = {};
    done.forEach(o => {
      addTo(area, o.area || 'other', o);
      const ct = db.client_types.find(c => c.key === o.client_type);
      addTo(type, o.client_type || '', o, { group: ct ? ct.group || ct.key : (o.client_type || '') });
      const c = addTo(client, o.phone, o, { phone: o.phone, client_name: o.client_name });
      c.client_name = o.client_name;   // the latest name
    });
    // teams: Teams-tab order first, then any other team found in the orders
    const teams = db.teams.map(t => ({ team: t.team, driver_name: t.driver_name, jobs: 0, billed: 0, overtime_min: 0, late: 0, partial: 0 }));
    done.forEach(o => {
      let t = teams.find(x => x.team === o.team);
      if (!t) { t = { team: o.team, driver_name: '', jobs: 0, billed: 0, overtime_min: 0, late: 0, partial: 0 }; teams.push(t); }
      if (o.archived && o.driver_name && !t.driver_name) t.driver_name = o.driver_name;
      t.jobs++; t.billed = round2(t.billed + o.amount); t.overtime_min += Number(o.overtime_min) || 0;
      if (Number(o.delay_min) > 0) t.late++;
      if ((o.not_done || []).length) t.partial++;
    });
    const modes = {};
    db.payments.filter(p => p.date.slice(0, 10) >= r[0] && p.date.slice(0, 10) <= r[1]).forEach(p => {
      const x = modes[p.mode] = modes[p.mode] || { mode: p.mode, count: 0, amount: 0 };
      x.count += p.amount < 0 ? -1 : 1; x.amount = round2(x.amount + p.amount);   // a minus row (payment.cancel) takes a payment back out
    });
    const months = all.map(o => o.sched_date.slice(0, 7)).filter(Boolean).sort();
    const mc = monthCosts(m);   // log book costs (DayLog)
    teams.forEach(t => { t.costs = mc.by_team[t.team] || 0; });
    const vals = o => Object.keys(o).map(k => o[k]);
    return {
      month: m, from: r[0], to: r[1], first_month: months[0] || '',
      totals: monthAddons(monthTotals(all, m)), prev: monthAddons(monthTotals(all, monthAdd(m, -1))),
      by_day,
      by_service: vals(svc).sort((x, y) => y.jobs - x.jobs),
      by_area: vals(area).sort(bigFirst),
      by_type: vals(type).sort(bigFirst),
      by_team: teams,
      pay_modes: vals(modes).sort((x, y) => y.amount - x.amount),
      top_clients: vals(client).sort((x, y) => (y.billed - x.billed) || (y.jobs - x.jobs)).slice(0, 5)
        .map(c => ({ phone: c.phone, client_name: c.client_name, jobs: c.jobs, billed: c.billed })),
      costs: mc.total   // log book: advance + petrol + repair of the month (DayLog)
    };
  };

  /* ---------- log book (logbook.gs, admin only) ----------
     One page per vehicle (team) per day: the jobs with crew and tank sizes,
     and the day's costs (DayLog). Drivers and the collector never see costs. */
  const emptyCosts = () => ({ advance: 0, petrol: 0, repair: 0, note: '', updated_by: '', updated_at: '' });
  const costsOf = r => r ? { advance: r.advance, petrol: r.petrol, repair: r.repair, note: r.note, updated_by: r.updated_by, updated_at: r.updated_at } : emptyCosts();
  function logTeam(k) {
    const key = String(k === undefined || k === null ? '' : k).trim().toUpperCase();
    return (key && db.teams.find(t => t.team.toUpperCase() === key)) || fail('BAD_INPUT', 'Unknown team: ' + key);
  }
  // The month's costs: {total:{advance, petrol, repair, total}, by_team:{A: 800}}
  function monthCosts(m) {
    const total = { advance: 0, petrol: 0, repair: 0, total: 0 }, byTeam = {};
    db.daylog.filter(r => r.date.slice(0, 7) === m).forEach(r => {
      const sum = r.advance + r.petrol + r.repair;
      total.advance += r.advance; total.petrol += r.petrol; total.repair += r.repair; total.total += sum;
      byTeam[r.team] = (byTeam[r.team] || 0) + sum;
    });
    Object.keys(total).forEach(k => { total[k] = round2(total[k]); });
    Object.keys(byTeam).forEach(k => { byTeam[k] = round2(byTeam[k]); });
    return { total, by_team: byTeam };
  }

  // logbook.get {date, team?} -> {date, teams:[{team, driver_name, vehicle_no, worker_names, rows, costs}]}
  A['logbook.get'] = b => {
    const date = String(b.date || '').trim();
    if (!validDate(date)) fail('BAD_INPUT', 'Date must look like 2026-10-07.');
    const only = b.team === undefined || b.team === null || String(b.team).trim() === '' ? null : logTeam(b.team);
    // A multi-day job is on every day it was worked (work_days) or is "on" (jobOnDate)
    const day = allOrders().filter(o => isJob(o) && o.team && !isCancelled(o) &&
      (jobOnDate(o, date) || workDays(o).some(w => w.date === date))).sort(byDateTime);
    const saved = k => db.daylog.find(r => r.date === date && r.team === k);
    const pickTeams = only ? [only] : db.teams.filter(t => t.active || saved(t.team) || day.some(o => o.team === t.team));
    return {
      date,
      teams: pickTeams.map(t => {
        const c = saved(t.team);
        return {
          team: t.team, driver_name: t.driver_name || '',
          vehicle_no: (c && c.vehicle_no) || String(t.vehicle_no || '').trim(),
          worker_names: splitList(t.worker_names || ''),
          rows: day.filter(o => o.team === t.team).map((o, i) => ({
            sr: i + 1, order_id: o.order_id, crew: (o.crew || []).slice(), client_name: o.client_name,
            address: o.address || '', area: o.area, services: o.services.slice(), tanks: tanksOut(o.tanks), status: o.status
          })),
          costs: costsOf(c)
        };
      })
    };
  };

  // logbook.setCosts {date, team, advance, petrol, repair, note} -> the saved costs (adds or changes the DayLog row)
  A['logbook.setCosts'] = (b, s) => {
    const date = String(b.date || '').trim();
    if (!validDate(date)) fail('BAD_INPUT', 'Date must look like 2026-10-07.');
    const t = logTeam(b.team);
    const money = (k, label) => {
      const v = b[k];
      if (v === undefined || v === null || String(v).trim() === '') return 0;
      const n = Number(v);
      if (isNaN(n) || n < 0) fail('BAD_INPUT', label + ' must be a number, 0 or more.');
      return round2(n);
    };
    const row = { advance: money('advance', 'Advance'), petrol: money('petrol', 'Petrol'), repair: money('repair', 'Repair'),
      note: String(b.note === undefined || b.note === null ? '' : b.note).trim().slice(0, 500),
      vehicle_no: String(t.vehicle_no || '').trim(), updated_by: s.name || '', updated_at: nowIso() };
    const have = db.daylog.find(r => r.date === date && r.team === t.team);
    if (have) Object.assign(have, row); else db.daylog.push(Object.assign({ date, team: t.team }, row));
    return { date, team: t.team, advance: row.advance, petrol: row.petrol, repair: row.repair, note: row.note,
      updated_by: row.updated_by, updated_at: row.updated_at };
  };

  /* ---------- alerts (orders.gs) ---------- */
  // Newest first, at most 200
  A['alerts.list'] = b => {
    db.alerts.forEach(a => { if (a.resolved_at === undefined) { a.resolved_at = ''; a.resolved_by = ''; } });   // sample rows made before 9 Oct
    const L = db.alerts.slice().sort((x, y) => x.created_at === y.created_at ? (x.alert_id < y.alert_id ? 1 : -1) : (x.created_at < y.created_at ? 1 : -1));
    const list = b.unseen_only ? L.filter(a => !a.seen).slice(0, 200) : L.slice(0, 200).map(withAlertOrder);
    // Only real problems count (bad / warn), as orders.gs
    return { alerts: list, unseen: db.alerts.filter(a => !a.seen && a.sev !== 'ok').length };
  };

  // The order's client on an alert (orders.gs withAlertOrder_, usability round 2026-10-08):
  // the Dashboard offers Open order / Call customer / Reschedule on the alert itself
  function withAlertOrder(a) {
    const o = a.order_id === '' ? null : db.orders.find(x => x.order_id === Number(a.order_id));
    if (!o) return a;
    return Object.assign({}, a, { client_name: o.client_name, phone: o.phone, sched_date: o.sched_date, order_status: o.status,
      whatsapp: o.whatsapp === 'no' ? 'no' : 'yes' });
  }

  // No ids (or an empty list) = mark every alert as seen
  A['alerts.seen'] = b => {
    const ids = Array.isArray(b.alert_ids) && b.alert_ids.length ? b.alert_ids.map(String) : null;
    let updated = 0;
    db.alerts.forEach(a => { if (!a.seen && (!ids || ids.includes(String(a.alert_id)))) { a.seen = true; updated++; } });
    return { updated };
  };

  // alerts.resolve {alert_id, undo?} -> {alert} (orders.gs alertsResolve, added 2026-10-09):
  // resolved_at / resolved_by = when and which admin; a resolved alert counts as seen.
  // undo:true opens it again (stays seen). Resolving twice keeps the first time.
  A['alerts.resolve'] = (b, s) => {
    const id = String(b.alert_id === undefined || b.alert_id === null ? '' : b.alert_id).trim();
    if (!id) fail('BAD_INPUT', 'Which alert? alert_id is missing.');
    const a = db.alerts.find(x => String(x.alert_id) === id) || fail('NOT_FOUND', 'Alert not found. It may be in the monthly archive (OldAlerts).');
    if (b.undo === true) { a.resolved_at = ''; a.resolved_by = ''; }
    else if (!a.resolved_at) { a.resolved_at = nowIso(); a.resolved_by = s.name || 'Admin'; a.seen = true; }
    return { alert: withAlertOrder(Object.assign({}, a)) };
  };

  /* ---------- clients (clients.gs, admin only). A client = one phone number. ---------- */
  // Orders for one phone, oldest first. Archived orders (OrderHistory) are included, with archived:true.
  const ordersOf = phone => allOrders().filter(o => o.phone === phone).sort(byDateTime);
  // The order that holds the client's next visit: the latest order that HAS next_visit set
  const nextVisitOrder = list => { for (let i = list.length - 1; i >= 0; i--) if (list[i].next_visit) return list[i]; return null; };

  // Orders that are not cancelled
  const live = list => list.filter(o => !isCancelled(o));

  // The order that holds "uses WhatsApp?": the latest order that HAS it set ('yes' or 'no')
  const waOrder = list => { for (let i = list.length - 1; i >= 0; i--) if (list[i].whatsapp === 'yes' || list[i].whatsapp === 'no') return list[i]; return null; };
  // 'yes' or 'no' for one phone number (cancelled orders count only when there is nothing else)
  function clientWa(phone) {
    const all = ordersOf(phone), os = live(all).length ? live(all) : all, w = waOrder(os);
    return w ? w.whatsapp : 'yes';
  }

  // One summary line per client. Name, type, area, address and services come from the latest order.
  // Cancelled orders are left out (they still show in client.history), except payments, which always count.
  function clientSummary(phone) {
    const all = ordersOf(phone);
    if (!all.length) return null;
    const os = live(all).length ? live(all) : all;
    const last = os[os.length - 1], done = os.filter(o => o.status === 'done' && isJob(o));   // a survey is not billed work
    const billed = done.reduce((a, o) => a + o.amount, 0);
    const paid = all.reduce((a, o) => a + paidOf(o.order_id), 0);
    const nv = nextVisitOrder(os), wa = waOrder(os);
    return {
      phone, client_name: last.client_name, client_type: last.client_type || '', area: last.area, address: last.address || '',
      orders: os.length, done: done.length, first_date: os[0].sched_date, last_date: last.sched_date,
      last_services: last.services, billed, paid: round2(paid), balance: round2(billed - paid),
      disputes: os.filter(o => o.dispute).length, next_visit: nv ? nv.next_visit : '',
      whatsapp: wa ? wa.whatsapp : 'yes',  // from the latest order that has it set; not known = yes
      tanks: clientTanks(phone),           // log book: tanks of the latest order that has any, else []
      amc: modOn('amc') ? amcSummary(phone) : null   // the active AMC contract, or null (always null without "amc")
    };
  }
  // The client's saved tanks: from the latest order (live or archived) that has any, with total_litres
  function clientTanks(phone) {
    const all = ordersOf(phone);
    for (let i = all.length - 1; i >= 0; i--) if ((all[i].tanks || []).length) return tanksOut(all[i].tanks);
    return [];
  }
  const allPhones = () => Array.from(new Set(allOrders().map(o => o.phone).filter(Boolean)));

  A['client.list'] = b => {
    const q = String(b.q || '').trim().toLowerCase(), qd = q.replace(/\D/g, '');
    let L = allPhones().map(clientSummary);
    if (q) L = L.filter(c => String(c.client_name || '').toLowerCase().includes(q) || (qd && c.phone.includes(qd)));
    return { clients: L.sort((x, y) => x.last_date < y.last_date ? 1 : x.last_date > y.last_date ? -1 : 0) };
  };

  A['client.history'] = (b, s) => {
    const phone = normPhone(b.phone) || fail('BAD_INPUT', 'Enter a 10 digit phone number.');
    const client = clientSummary(phone) || fail('NOT_FOUND', 'No orders for this phone number.');
    const os = ordersOf(phone).reverse(), ids = os.map(o => o.order_id);
    return {
      client,
      orders: os.map(o => stripOffModules(full(o))),   // full admin orders with paid, balance and in_ledger (no fields of add-ons that are off)
      payments: db.payments.filter(p => ids.includes(p.order_id)).sort((x, y) => x.date < y.date ? 1 : x.date > y.date ? -1 : 0)
        .map(p => ({ payment_id: p.payment_id, order_id: p.order_id, date: p.date, amount: p.amount, mode: p.mode, note: p.note || '' })),
      messages: db.messages.filter(m => m.phone === phone || (m.order_id !== '' && ids.includes(Number(m.order_id))))
        .sort((x, y) => x.ts < y.ts ? 1 : x.ts > y.ts ? -1 : 0)
        .map(m => ({ ts: m.ts, direction: m.direction, order_id: m.order_id === '' ? '' : Number(m.order_id), template: m.template, body: m.body, status: m.status })),
      alerts: db.alerts.filter(a => a.order_id !== '' && ids.includes(Number(a.order_id)))
        .sort((x, y) => x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : 0)
        .map(a => ({ created_at: a.created_at, type: a.type, sev: a.sev || 'warn', order_id: Number(a.order_id), text: a.text })),
      // AMC contracts of this client, newest first
      contracts: !modOn('amc') ? [] : db.contracts.filter(c => c.phone === phone).slice().reverse().map(contractOut),
      last_bill: lastJob(phone, true)   // the latest finished job (Start AMC compares its amount), added 2026-10-08
    };
  };

  // Used by the New order form: a known phone fills in name, address, area and type. Unknown or bad phone -> null.
  // Added 2026-10-08 (usability round), as clients.gs: last_job (its services and add-ons are
  // copied onto a new order) and amc_next (the next AMC visit not booked yet, or null)
  A['client.lookup'] = b => {
    const phone = normPhone(b.phone);
    const c = phone ? clientSummary(phone) : null;
    if (!c) return null;
    c.last_job = lastJob(phone, false);
    if (modOn('amc')) c.amc_next = amcNext(phone);
    return c;
  };
  // The latest cleaning job {order_id, sched_date, services, amount, status} (no surveys, no cancelled), or null.
  // doneOnly: the latest finished one (the last bill).
  function lastJob(phone, doneOnly) {
    const os = ordersOf(phone);
    for (let i = os.length - 1; i >= 0; i--) {
      const o = os[i];
      if (!isJob(o) || isCancelled(o) || (doneOnly && o.status !== 'done')) continue;
      return { order_id: o.order_id, sched_date: o.sched_date, services: (o.services || []).slice(), amount: Number(o.amount) || 0, status: o.status };
    }
    return null;
  }

  // Set the next visit on the client's latest order ('' clears it)
  A['client.setNextVisit'] = b => {
    const phone = normPhone(b.phone) || fail('BAD_INPUT', 'Enter a 10 digit phone number.');
    const nv = String(b.next_visit === undefined || b.next_visit === null ? '' : b.next_visit).trim();
    if (nv && !validDate(nv)) fail('BAD_INPUT', 'Next visit must look like 2026-11-20.');
    const all = ordersOf(phone);
    if (!all.length) fail('NOT_FOUND', 'No orders for this phone number.');
    const os = live(all).length ? live(all) : all;   // the latest order that is not cancelled
    const last = os[os.length - 1];
    // An archived order is a copy: change the OrderHistory row itself
    (last.archived ? db.history.find(h => h.order_id === last.order_id) : last).next_visit = nv;
    return { client: clientSummary(phone) };
  };

  // client.setWhatsapp {phone, whatsapp:'yes'|'no'}: saved on the client's latest not-cancelled
  // order (an archived latest order -> its OrderHistory row), like client.setNextVisit
  A['client.setWhatsapp'] = b => {
    const phone = normPhone(b.phone) || fail('BAD_INPUT', 'Enter a 10 digit phone number.');
    const wa = String(b.whatsapp || '').trim().toLowerCase();
    if (!['yes', 'no'].includes(wa)) fail('BAD_INPUT', 'whatsapp must be yes or no.');
    const all = ordersOf(phone);
    if (!all.length) fail('NOT_FOUND', 'No orders for this phone number.');
    const os = live(all).length ? live(all) : all;   // the latest order that is not cancelled
    const last = os[os.length - 1];
    (last.archived ? db.history.find(h => h.order_id === last.order_id) : last).whatsapp = wa;
    // ...and on the client's open live orders (not done, not cancelled), so today's job follows at once
    db.orders.forEach(o => { if (o.phone === phone && o.status !== 'done' && !isCancelled(o)) o.whatsapp = wa; });
    return { client: clientSummary(phone) };

  };

  // clients.gs reminderFor_: the reminder comes from the latest order that HAS a next_visit.
  // It is due from (next_visit - reminder_days), and clears once the client has a newer
  // order (higher order number) dated on or after that start date.
  A['reminders.list'] = () => {
    const days = setting('reminder_days', 20), t = today();
    const reminders = [];
    allPhones().forEach(phone => {
      const list = live(ordersOf(phone)), base = nextVisitOrder(list);   // cancelled orders do not count
      if (!list.length) return;
      if (!base) return;
      const from = addD(base.next_visit, -days);
      if (t < from) return;                                                                   // not yet
      if (list.some(o => o.order_id > base.order_id && o.sched_date >= from)) return;        // already rebooked
      const last = list[list.length - 1];
      reminders.push({
        kind: 'visit', phone, client_name: last.client_name, area: last.area, address: last.address || '', client_type: last.client_type || '',
        last_date: last.sched_date, last_services: last.services, next_visit: base.next_visit,
        days_left: daysBetween(t, base.next_visit), order_id: base.order_id
      });
    });
    // AMC visits that are due (not booked yet), from reminder_days before the due date (also overdue).
    // Not booked automatically: the admin taps "Book order".
    db.contracts.filter(c => modOn('amc') && contractStatus(c) === 'active').forEach(c => {
      const list = live(ordersOf(c.phone)), last = list[list.length - 1] || {};
      for (let k = 1; k <= c.visits; k++) {
        const due = amcDue(c, k);
        if (amcBooked(c, k) || t < addD(due, -days)) continue;
        reminders.push({
          kind: 'amc', amc_id: c.amc_id, visit_no: k, visits: c.visits, due_date: due, days_left: daysBetween(t, due),
          phone: c.phone, client_name: last.client_name || c.client_name, area: last.area || '', address: last.address || '',
          client_type: last.client_type || '', last_date: last.sched_date || '', last_services: last.services || [],
          next_visit: due, order_id: null,
          visit_amount: amcShare(c, k), tanks: tanksOut(c.tanks)   // for the New order form (admin only)
        });
      }
    });
    return { reminders: reminders.sort((x, y) => x.days_left - y.days_left), reminder_days: days };
  };

  /* ======================================================================
     PRICE QUOTE, SURVEY AND QUOTATION (added 2026-10-08, orders.gs)
     A survey visit (kind 'survey'): the supervisor measures the tanks, the admin
     sends the quotation, the customer says yes, the admin schedules the cleaning
     (quote.approve makes the cleaning order with the quoted price LOCKED).
     ====================================================================== */

  // price.quote {tanks, services} (admin): the price breakdown without saving anything
  // (New order and AMC forms). BAD_INPUT when a tank is wrong.
  A['price.quote'] = b => {
    const tanks = cleanTanks(b.tanks);
    const svcs = splitList(b.services);
    svcs.forEach(k => { if (!svcRow(k)) fail('BAD_INPUT', 'Unknown service: ' + k); });
    return priceOrder({ tanks, services: svcs });
  };

  // The services a quotation is priced with: the services the client asked for, plus (when none of
  // them is priced by tanks) the cleaning services that match the tank positions (OH -> ot, UG -> ug).
  // Same for quote_amount, quote.approve and the admin price of a survey (orders.gs surveyServices_).
  function surveySvcs(o) { return withCleaning(splitList(o.services), o.tanks); }
  // orders.gs withTankServices_: with a tank-priced service, add the cleaning service of each tank position
  function withTankServices(svcs, tanks) {
    svcs = splitList(svcs);
    if (!svcs.some(k => pricedBy(k) === 'tanks')) return svcs;
    const want = Array.from(new Set(tanksOut(tanks).map(t => t.type === 'UG' ? 'ug' : 'ot'))).sort().filter(k => svcRow(k) && svcRow(k).active);
    const miss = want.filter(k => !svcs.includes(k));
    return miss.length ? svcs.concat(miss) : svcs;
  }
  function withCleaning(svcs, tanks) {
    if (svcs.some(k => pricedBy(k) === 'tanks')) return svcs;
    return Array.from(new Set(tanksOut(tanks).map(t => t.type === 'UG' ? 'ug' : 'ot'))).filter(k => svcRow(k)).concat(svcs);
  }
  // The survey order, or an error
  function getSurvey(id) {
    const o = getOrder(id);
    if (!isSurvey(o)) fail('BAD_INPUT', 'Order #' + o.order_id + ' is not a survey visit.');
    if (isCancelled(o)) fail('BAD_STATUS', 'This survey was cancelled. Restore it first.');
    return o;
  }
  // The tanks in Gujarati words for the quotation WhatsApp:
  // "2 સિમેન્ટ ટાંકી (5,000 લિ., 12,000 લિ.), 1 પ્લાસ્ટિક ટાંકી (1,000 લિ.)"
  function quoteTanksGu(list) {
    const t = tanksOut(list), parts = [];
    ['cement', 'plastic'].forEach(m => {
      const L = t.filter(x => x.material === m);
      if (!L.length) return;
      const n = L.reduce((a, x) => a + x.count, 0);
      parts.push(n + ' ' + TANK_MAT[m].gu + ' ટાંકી (' + L.map(x => litresText(tankLitres(x)) + ' લિ.' + (x.count > 1 ? ' × ' + x.count : '')).join(', ') + ')');
    });
    return parts.join(', ');
  }

  // survey.submit {order_id, tanks, notes?} (supervisor; admin too): the measured tanks.
  // The survey is 'done', the quotation is a 'draft' with quote_amount = tanks + chosen add-ons.
  // Allowed again while the quotation has not gone to the client (draft).
  A['survey.submit'] = (b, s) => {
    const o = getSurvey(b.order_id);
    if (['sent', 'approved', 'declined'].includes(o.quote_status)) fail('BAD_STATUS', 'The quotation has already gone to the client.');
    const tanks = cleanTanks(b.tanks);
    if (!tanks.length) fail('BAD_INPUT', 'Enter at least one tank.');
    const note = String(b.notes === undefined || b.notes === null ? '' : b.notes).trim().slice(0, 500);
    o.tanks = tanks;
    // Same as survey.gs: a new line "Supervisor: ..." (or "Office: ..." from an admin). The supervisor's
    // screen shows its own lines in its outgoing bubble (supervisor.js svMyNotes).
    if (note) o.notes = (o.notes ? o.notes + String.fromCharCode(10) : '') + (s.role === 'admin' ? 'Office' : 'Supervisor') + ': ' + note;
    o.status = 'done';
    o.done_at = nowIso();
    o.quote_status = 'draft';
    o.quote_amount = priceOrder(Object.assign({}, o, { price_locked: false, services: surveySvcs(o) })).total;
    if (s.role === 'admin') o.updated_by = s.name || '';
    addAlert('info', 'ok', o.order_id, 'Survey done for ' + o.client_name + ': quotation ' + inr(o.quote_amount) + ' ready to send.');
    return { order: filterForRole(o, s) };
  };

  // quote.send {order_id} (admin): WhatsApp template 'quotation' (Yes / No buttons).
  // Sending again is allowed. A client without WhatsApp gets nothing: reply call:true, the admin calls.
  A['quote.send'] = (b, s) => {
    const o = getSurvey(b.order_id);
    if (o.status !== 'done' || !['draft', 'sent'].includes(o.quote_status)) {
      fail('BAD_STATUS', o.status !== 'done' ? 'The survey is not done yet: the supervisor has not sent the measurements.'
        : 'This quotation is already ' + o.quote_status + '.');
    }
    o.quote_status = 'sent';
    o.quote_sent_at = nowIso();
    o.updated_by = s.name || '';
    const pr = priceOrder(Object.assign({}, o, { price_locked: false, services: surveySvcs(o) }));
    const sent = waSend(o, 'quotation', { client_name: o.client_name, tanks: quoteTanksGu(o.tanks), addons: pr.addons.map(x => x.key), total: o.quote_amount });
    return { order: full(o), sent: sent, call: !sent };
  };

  // quote.approve {order_id, sched_date, sched_time, team?, days?, amount?} (admin):
  // makes the CLEANING order from the survey (client, tanks, services; amount = amount or the
  // quote; price locked). A declined quotation can still be approved (the admin decides).
  A['quote.approve'] = (b, s) => {
    const sv = getSurvey(b.order_id);
    if (sv.quote_status === 'approved') fail('BAD_STATUS', 'This quotation is already approved (order #' + sv.quote_order_id + ').');
    if (sv.status !== 'done' || !['draft', 'sent', 'declined'].includes(sv.quote_status)) fail('BAD_STATUS', 'The survey is not done yet.');
    const typed = b.amount !== undefined && b.amount !== null && String(b.amount).trim() !== '';
    const amount = typed ? Number(b.amount) : Number(sv.quote_amount) || 0;
    if (typed && !(amount >= 0)) fail('BAD_INPUT', 'Amount must be a number, 0 or more.');
    // services: what the client asked for, else the cleaning services that match the tank positions
    const svcs = surveySvcs(sv);
    const input = { client_name: sv.client_name, phone: sv.phone, client_type: sv.client_type, address: sv.address, map_link: sv.map_link,
      area: sv.area, whatsapp: sv.whatsapp, source: sv.source, services: svcs, sched_date: b.sched_date, sched_time: b.sched_time,
      team: b.team === undefined || b.team === null ? '' : b.team };
    if (b.days !== undefined && b.days !== null && b.days !== '') input.days = b.days;
    const clean = cleanOrderInput(input, true, null);
    const o = Object.assign(blankOrder(), clean, {
      kind: 'cleaning', tanks: sv.tanks.map(tankForSheet), amount: round2(amount), price_locked: true, from_quote: sv.order_id,
      status: clean.team ? 'assigned' : 'new'
    });
    o.order_id = db.nextOrderId++;
    o.created_at = nowIso();
    o.created_by = s.name || '';
    db.orders.push(o);
    sv.quote_status = 'approved';
    sv.quote_order_id = o.order_id;
    sv.updated_by = s.name || '';
    addAlert('info', 'ok', o.order_id, 'Quotation approved for ' + o.client_name + ': cleaning order #' + o.order_id + ' on ' + o.sched_date + ' ' +
      fm(mins(o.sched_time)) + ', ' + inr(o.amount) + ' (price locked).', true);   // office's own action: seen
    return { order: full(o), survey: full(sv) };
  };

  // quote.decline {order_id, reason?} (admin): the client said no. The reason goes into the notes.
  A['quote.decline'] = (b, s) => {
    const o = getSurvey(b.order_id);
    if (o.quote_status === 'approved') fail('BAD_STATUS', 'This quotation is already approved (order #' + o.quote_order_id + ').');
    if (o.status !== 'done' || !['draft', 'sent', 'declined'].includes(o.quote_status)) fail('BAD_STATUS', 'The survey is not done yet.');
    const reason = String(b.reason === undefined || b.reason === null ? '' : b.reason).trim().slice(0, 200);
    o.quote_status = 'declined';
    if (reason) o.notes = (o.notes ? o.notes + ' · ' : '') + 'Declined: ' + reason;
    o.updated_by = s.name || '';
    return { order: full(o) };
  };

  /* ======================================================================
     AMC: ANNUAL MAINTENANCE CONTRACTS (contracts.gs, admin only, added 2026-10-08)
     One contract per client at a time. Visits per year are chosen per contract.
     Price = one visit's tank price x visits - discount %. Billing: PER VISIT (each AMC
     visit order = contract amount / visits; normal ledger and collector).
     Visits are NOT booked automatically: they show in "Visits due" on the Dashboard.
     ====================================================================== */
  // '2026-10-08' -> '2027-10-08'
  const addYear = s => { const x = pd(s); x.setFullYear(x.getFullYear() + 1); return isoOf(x); };
  function contractOf(id) { const k = String(id === undefined || id === null ? '' : id).trim(); return db.contracts.find(c => c.amc_id === k); }
  // 'ended' is worked out when read (end_date before today); no trigger needed
  function contractStatus(c) { return c.status === 'active' && c.end_date < today() ? 'ended' : c.status; }
  // Visit k (1..visits) is due on start_date + round((k - 1) x 365 / visits) days
  function amcDue(c, k) { return addD(c.start_date, Math.round((k - 1) * 365 / c.visits)); }
  // The (not cancelled) order booked for visit k, live or archived, or null
  function amcBooked(c, k) { return allOrders().find(o => o.amc_id === c.amc_id && Number(o.amc_visit) === k && !isCancelled(o)) || null; }
  // The amount of visit k: amount / visits, rounded; the last visit gets the remainder (the sum is exact)
  function amcShare(c, k) {
    const each = Math.round(c.amount / c.visits);
    return k < c.visits ? each : round2(c.amount - each * (c.visits - 1));
  }
  // A contract for the app: tanks with litres, status (ended?), booked / done counts, next due date,
  // per_visit, and the schedule: one line per visit {visit_no, due_date, amount, order_id (or null), status}
  function contractOut(c) {
    const visitList = [];
    let booked = 0, done = 0, nextDue = '';
    for (let k = 1; k <= c.visits; k++) {
      const o = amcBooked(c, k);
      if (o) { booked++; if (o.status === 'done') done++; } else if (!nextDue) nextDue = amcDue(c, k);
      visitList.push({ visit_no: k, due_date: amcDue(c, k), amount: amcShare(c, k), order_id: o ? o.order_id : null, status: o ? o.status : '' });
    }
    return Object.assign({}, c, { tanks: tanksOut(c.tanks), status: contractStatus(c), booked, done, next_due: nextDue,
      per_visit: Math.round(c.amount / c.visits), schedule: visitList });
  }
  // The next visit of the client's active contract not booked yet (client.lookup amc_next), or null
  function amcNext(phone) {
    const c = db.contracts.filter(x => x.phone === phone && contractStatus(x) === 'active').pop();
    if (!c) return null;
    const v = contractOut(c).schedule.find(x => !x.order_id);
    return v ? { amc_id: c.amc_id, visit_no: v.visit_no, visits: c.visits, due_date: v.due_date, days_left: daysBetween(today(), v.due_date),
      visit_amount: v.amount, tanks: tanksOut(c.tanks) } : null;
  }
  // The client's ACTIVE contract in short (client summary `amc`), or null
  function amcSummary(phone) {
    const c = db.contracts.filter(x => x.phone === phone && contractStatus(x) === 'active').pop();
    return c ? pick(contractOut(c), ['amc_id', 'visits', 'booked', 'done', 'next_due', 'end_date', 'amount', 'status']) : null;
  }
  // order.create for an AMC visit: the contract must be active, of this phone, and the visit not booked
  function amcCheck(phone, amcId, visit) {
    const c = contractOf(amcId) || fail('BAD_INPUT', 'Unknown AMC contract: ' + amcId);
    if (contractStatus(c) !== 'active') fail('BAD_INPUT', 'AMC ' + c.amc_id + ' is not active.');
    if (c.phone !== phone) fail('BAD_INPUT', 'AMC ' + c.amc_id + ' belongs to another client.');
    const k = Number(visit);
    if (!(Number.isInteger(k) && k >= 1 && k <= c.visits)) fail('BAD_INPUT', 'AMC visit must be a number from 1 to ' + c.visits + '.');
    const bk = amcBooked(c, k);
    if (bk) fail('BAD_INPUT', 'AMC visit ' + k + ' is already booked (order #' + bk.order_id + ').');
    return c;
  }

  // amc.create {phone, start_date, visits (1-12), discount_pct (0-50), amount?, notes?}
  A['amc.create'] = (b, s) => {
    const phone = normPhone(b.phone) || fail('BAD_INPUT', 'Enter a 10 digit phone number.');
    const client = clientSummary(phone) || fail('NOT_FOUND', 'No orders for this phone number.');
    const start = String(b.start_date || '').trim();
    if (!validDate(start)) fail('BAD_INPUT', 'Start date must look like 2026-10-08.');
    const visits = Number(b.visits);
    if (!(Number.isInteger(visits) && visits >= 1 && visits <= 12)) fail('BAD_INPUT', 'Visits per year must be a whole number from 1 to 12.');
    const blank = v => v === undefined || v === null || String(v).trim() === '';
    const disc = blank(b.discount_pct) ? 0 : Number(b.discount_pct);
    if (!(disc >= 0 && disc <= 50)) fail('BAD_INPUT', 'Discount must be from 0 to 50 %.');
    if (!client.tanks.length) fail('BAD_INPUT', 'Measure the tanks first (survey).');
    if (db.contracts.some(c => c.phone === phone && contractStatus(c) === 'active')) fail('BAD_INPUT', 'This client already has an active AMC contract.');
    const vp = priceOrder({ tanks: client.tanks, services: withCleaning([], client.tanks) }).tanks_total;   // cleaning only (ot/ug from the tank positions)
    const amount = blank(b.amount) ? Math.round(vp * visits * (1 - disc / 100)) : Number(b.amount);
    if (!(amount >= 0)) fail('BAD_INPUT', 'Amount must be a number, 0 or more.');
    const c = {
      amc_id: 'AMC' + db.nextAmcNo++, created_at: nowIso(), created_by: s.name || '', phone, client_name: client.client_name,
      start_date: start, end_date: addD(addYear(start), -1), visits, tanks: client.tanks.map(tankForSheet), visit_price: vp,
      discount_pct: disc, amount: round2(amount), billing: 'per_visit', status: 'active', cancel_reason: '',
      notes: String(b.notes === undefined || b.notes === null ? '' : b.notes).trim().slice(0, 500)
    };
    db.contracts.push(c);
    addAlert('info', 'ok', '', 'AMC ' + c.amc_id + ' started for ' + c.client_name + ': ' + visits + ' visit' + (visits === 1 ? '' : 's') + ' a year, ' + inr(c.amount) + '.', true);   // office's own action: seen
    return { contract: contractOut(c) };
  };

  // amc.list {phone?, status?} -> {contracts} newest first
  A['amc.list'] = b => {
    let L = db.contracts.slice();
    if (b.phone) { const p = normPhone(b.phone) || fail('BAD_INPUT', 'Enter a 10 digit phone number.'); L = L.filter(c => c.phone === p); }
    let out = L.map(contractOut).reverse();
    if (b.status) out = out.filter(c => c.status === String(b.status));
    return { contracts: out };
  };

  // amc.cancel {amc_id, reason}: booked visit orders are NOT touched (cancel them in Orders if needed)
  A['amc.cancel'] = (b, s) => {
    const c = contractOf(b.amc_id) || fail('NOT_FOUND', 'AMC contract not found.');
    const st = contractStatus(c);
    if (st !== 'active') fail('BAD_STATUS', 'This contract is already ' + st + '.');
    c.status = 'cancelled';
    c.cancel_reason = String(b.reason === undefined || b.reason === null ? '' : b.reason).trim().slice(0, 200);
    addAlert('info', 'ok', '', 'AMC ' + c.amc_id + ' for ' + c.client_name + ' was cancelled by ' + (s.name || 'the office') + '. Reason: ' + (c.cancel_reason || 'not given') + '.', true);   // office's own action: seen
    return { contract: contractOut(c) };
  };

  /* ---------- sample data for the new features (added 2026-10-08) ----------
     Two surveys (one today not measured yet, one measured with a draft quotation),
     one approved quotation -> cleaning order with the price locked, a 3-day job of
     Team C that started yesterday, and an AMC contract (4 visits) with a visit due soon. */
  (function seedNew() {
    const mk = f => {
      const o = Object.assign(blankOrder(), f);
      o.phone = normPhone(o.phone);
      o.map_link = mapUrl(o);
      o.created_by = o.created_by || 'A P Bhatnagar';
      o.created_at = o.created_at || addD(o.sched_date, -2) + 'T11:00:00';
      db.orders.push(o);
      return o;
    };
    const T = (type, material, litres, count) => ({ type, material, litres, l: null, w: null, h: null, count: count || 1 });
    const yd = d('2026-10-06');
    // 1. survey today, not measured yet
    mk({ order_id: 1055, kind: 'survey', client_type: 'apartment', client_name: 'Aakash Towers', phone: '9825041055',
      address: 'Aakash Towers, Udhna Main Road, Udhna, Surat', area: 'udhna', services: ['ot', 'ug'], sched_date: d(SEED_TODAY), sched_time: '11:30',
      notes: 'Secretary Mr. Mehta will show the tanks' });
    // 2. survey yesterday, measured: draft quotation (2 cement + 2 plastic overhead, 1 cement underground)
    const s2 = mk({ order_id: 1056, kind: 'survey', client_type: 'hotel', client_name: 'Hotel Sapphire', phone: '9825041056',
      address: 'Ring Road, Katargam, Surat', area: 'katargam', services: ['ot', 'ug', 'ab'], sched_date: yd, sched_time: '15:00',
      status: 'done', done_at: yd + 'T16:10:00', tanks: [T('UG', 'cement', 12000), T('OH', 'cement', 5000, 2), T('OH', 'plastic', 1000, 2)], quote_status: 'draft' });
    s2.quote_amount = priceOrder(s2).total;
    // 3. survey last week, quotation sent and approved -> cleaning order 1058 (price locked)
    const s3 = mk({ order_id: 1057, kind: 'survey', client_type: 'school', client_name: 'Shanti Vidyalaya', phone: '9825041057',
      address: 'Shanti Vidyalaya, Piplod Road, Piplod, Surat', area: 'piplod', services: ['ot', 'ug'], sched_date: d('2026-10-03'), sched_time: '12:00',
      status: 'done', done_at: d('2026-10-03') + 'T13:05:00', tanks: [T('UG', 'cement', 20000), T('OH', 'cement', 3000, 2)],
      quote_status: 'approved', quote_sent_at: d('2026-10-03') + 'T17:00:00', quote_order_id: 1058 });
    s3.quote_amount = priceOrder(s3).total;
    mk({ order_id: 1058, client_type: 'school', client_name: 'Shanti Vidyalaya', phone: '9825041057', address: s3.address, area: 'piplod',
      services: ['ot', 'ug'], amount: s3.quote_amount, sched_date: d('2026-10-09'), sched_time: '10:00', team: 'D', status: 'assigned',
      tanks: s3.tanks.map(tankForSheet), price_locked: true, from_quote: 1057, created_at: d('2026-10-04') + 'T10:15:00' });
    // 4. a 3-day job of Team C: started yesterday (worked till 6:15 PM), goes on today
    const m4 = mk({ order_id: 1059, client_type: 'business', client_name: 'Surat Textile Market', phone: '9825041059',
      address: 'Ring Road, Surat Textile Market, Varachha, Surat', area: 'varachha', services: ['ot', 'ug', 'ab'], sched_date: yd, sched_time: '09:00',
      team: 'C', status: 'ongoing', days: 3, reached_at: yd + 'T09:05:00', tanks: [T('UG', 'cement', 40000), T('OH', 'cement', 10000, 4)],
      work_days: [{ date: yd, reached: yd + 'T09:05:00', left: yd + 'T18:15:00', overtime_min: 75 }], crew: ['Jignesh', 'Bhavesh'] });
    m4.amount = priceOrder(m4).total;
    // 5. AMC for Hotel Riverview: 4 visits a year, 10% off. Visit 1 done in July, visit 2 due in a few days.
    const hr = '919825041039', start = d('2026-07-12');
    const ht = clientTanks(hr).map(tankForSheet);
    const vp = priceOrder({ tanks: ht, services: withCleaning([], ht) }).tanks_total;
    const c = { amc_id: 'AMC1001', created_at: d('2026-07-10') + 'T12:00:00', created_by: 'A P Bhatnagar', phone: hr, client_name: 'Hotel Riverview',
      start_date: start, end_date: addD(addYear(start), -1), visits: 4, tanks: ht, visit_price: vp, discount_pct: 10,
      amount: Math.round(vp * 4 * 0.9), billing: 'per_visit', status: 'active', cancel_reason: '', notes: 'Quarterly cleaning' };
    db.contracts.push(c);
    db.nextAmcNo = 1002;
    const v1 = mk({ order_id: 1014, client_type: 'hotel', client_name: 'Hotel Riverview', phone: hr, address: 'Ring Road, Adajan, Surat', area: 'adajan',
      services: ['ot', 'ug'], amount: amcShare(c, 1), sched_date: start, sched_time: '10:00', team: 'A', status: 'done', reached_at: start + 'T10:02:00',
      done_at: start + 'T12:10:00', done_checklist: ['ot', 'ug'], customer_confirm: 'yes', tanks: ht, price_locked: true, amc_id: 'AMC1001', amc_visit: 1 });
    db.ledger.push(ledgerRowFor(v1, mondayOf(start)));
    db.payments.push({ payment_id: 'P' + db.nextPaymentId++, order_id: 1014, date: addD(start, 2) + 'T11:00:00', amount: v1.amount, mode: 'upi', collector: 'collector', note: '' });
    db.orders.sort((a, b) => a.order_id - b.order_id);
    db.nextOrderId = 1060;
    // WhatsApp log and alerts for these samples
    const msg = (id, ts, dir, tpl, body) => db.messages.push({ ts, direction: dir, phone: db.orders.find(o => o.order_id === id).phone, order_id: id,
      template: tpl, body, status: dir === 'in' ? 'received' : 'stub', wa_message_id: '' });
    msg(1057, d('2026-10-03') + 'T17:00:00', 'out', 'quotation', JSON.stringify({ client_name: 'Shanti Vidyalaya', tanks: quoteTanksGu(s3.tanks), addons: [], total: s3.quote_amount }));
    msg(1057, d('2026-10-03') + 'T18:20:00', 'in', '', 'હા');
    msg(1059, yd + 'T09:05:00', 'out', 'arrival_confirm', '');
    const al = (at, type, sev, id, text, seen) => db.alerts.push({ alert_id: alertId(at), created_at: at, type, sev, order_id: id, text, seen: !!seen });
    al(d('2026-10-03') + 'T18:20:00', 'quote_yes', 'warn', 1057, 'Shanti Vidyalaya accepted the quotation (' + inr(s3.quote_amount) + '). Schedule the cleaning.', true);
    al(yd + 'T16:10:00', 'info', 'ok', 1056, 'Survey done for Hotel Sapphire: quotation ' + inr(s2.quote_amount) + ' ready to send.', false);
    al(yd + 'T18:15:00', 'info', 'ok', 1059, 'Team C finished day 1 of 3 at Surat Textile Market (9:05 AM to 6:15 PM). Overtime 75 min. More days to go.', true);
  })();

  /* ======================================================================
     ENTRY POINT: handle({action, token, ...}) -> {ok:true, data} or {ok:false, error}
     ====================================================================== */
  // true when the action belongs to an add-on that is off (or the supervisor works without "quotation")
  function offFor(action, s) {
    const mods = modulesOn(), m = ACTION_MODULE[action];
    return (m && !mods[m]) || (s.role === 'supervisor' && !mods.quotation);
  }

  function handle(body) {
    try {
      body = body || {};
      const action = String(body.action || '');
      if (action === 'login') return { ok: true, data: login(body) };
      if (action === 'batch') return batch(body);
      if (!A[action]) return { ok: false, error: 'UNKNOWN_ACTION: ' + action };
      const s = verifyToken(body.token);
      if (!s) return { ok: false, error: 'AUTH' };
      if (!PERMS[action].includes(s.role)) return { ok: false, error: 'FORBIDDEN: Not allowed for your role.' };
      if (offFor(action, s)) return { ok: false, error: 'FORBIDDEN: ' + OFF };
      // Copy the reply so screens cannot change the fake database by accident
      return { ok: true, data: JSON.parse(JSON.stringify(A[action](body, s))) };
    } catch (e) {
      return { ok: false, error: (e && e.message) || 'ERROR' };
    }
  }

  /**
   * batch {calls:[{action, ...params}]} -> {ok:true, data:{results:[{ok, data} | {ok:false, error}]}}
   * Same rules as Code.gs doBatch_: token checked once (bad -> top-level AUTH), at most 10 calls,
   * no login and no batch inside (whole batch BAD_INPUT), each call checked against PERMS,
   * a failing call gives ok:false for that item only.
   */
  const BATCH_MAX = 10;
  function batch(body) {
    const s = verifyToken(body.token);
    if (!s) return { ok: false, error: 'AUTH' };
    const calls = body.calls;
    if (!Array.isArray(calls) || !calls.length) return { ok: false, error: 'BAD_INPUT: calls must be a list of actions.' };
    if (calls.length > BATCH_MAX) return { ok: false, error: 'BAD_INPUT: At most ' + BATCH_MAX + ' calls in one batch.' };
    for (const c of calls) {
      const a = c && typeof c === 'object' ? String(c.action || '') : '';
      if (a === 'batch') return { ok: false, error: 'BAD_INPUT: A batch cannot contain another batch.' };
      if (a === 'login') return { ok: false, error: 'BAD_INPUT: login cannot be part of a batch.' };
    }
    const results = calls.map(c => {
      try {
        if (!c || typeof c !== 'object' || Array.isArray(c)) return { ok: false, error: 'BAD_INPUT: Each call must be an object.' };
        const action = String(c.action || '');
        if (!A[action]) return { ok: false, error: 'UNKNOWN_ACTION: ' + action };
        if (!PERMS[action].includes(s.role)) return { ok: false, error: 'FORBIDDEN: Not allowed for your role.' };
        if (offFor(action, s)) return { ok: false, error: 'FORBIDDEN: ' + OFF };
        return { ok: true, data: JSON.parse(JSON.stringify(A[action](c, s))) };
      } catch (e) {
        return { ok: false, error: (e && e.message) || 'ERROR' };
      }
    });
    return { ok: true, data: { results } };
  }

  // _price: the pricing functions, for the tests (tests/mock-pricing-test.js)
  // setModules / modulesOn: switch add-ons for demos and tests (tests/mock-modules-test.js)
  return { handle, config, setModules, modulesOn, _db: db, _price: { tankPrice, priceOrder } };
})();
