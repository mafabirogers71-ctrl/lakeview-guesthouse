/* Lakeview Guest House MIS - front end (Step 2: PHP + MySQL)
   All data is read from and written to MySQL through api/api.php. */

const KEY = 'lakeview_mis_v1';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/* ---------- Dates and formatting ---------- */
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const today = () => iso(new Date());
const addDays = (d, n) => { const x = new Date(d + 'T00:00'); x.setDate(x.getDate() + n); return iso(x); };
const nights = (a, b) => Math.max(1, Math.round((new Date(b + 'T00:00') - new Date(a + 'T00:00')) / 864e5));
const money = (n) => 'UGX ' + Number(n).toLocaleString('en-UG');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dShort = (d) => new Date(d + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/* ---------- Data layer (talks to PHP + MySQL) ---------- */
let db = { types: [], rooms: [], guests: [], bookings: [], payments: [], menu: [], orders: [], stock: [] };

async function api(action, body) {
  const opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
  const res = await fetch('api/api.php?action=' + action, opt);
  const j = await res.json().catch(() => ({ error: 'Server error. Check that Apache and MySQL are running in XAMPP.' }));
  if (!res.ok) throw new Error(j.error || 'Request failed');
  return j;
}
let gd = { me: {}, types: [], menu: [], bookings: [] };
async function refresh() { if (role === 'guest') gd = await api('g_data'); else db = await api('data'); }
async function act(action, body, msg) {
  try { await api(action, body); await refresh(); toast(msg); render(); return true; }
  catch (e) { toast(e.message, true); return false; }
}

/* ---------- Lookups and business rules ---------- */
const G = (id) => db.guests.find((g) => g.id == id);
const R = (id) => db.rooms.find((r) => r.id == id);
const T = (id) => db.types.find((t) => t.id == id);
const B = (id) => db.bookings.find((b) => b.id == id);
const active = (b) => b.status === 'Reserved' || b.status === 'Checked in';
const isFree = (room, a, b) => !room.maint && !db.bookings.some((x) => x.room == room.id && active(x) && x.in < b && x.out > a);

function bill(b) {
  const n = nights(b.in, b.out), rate = T(R(b.room).type).rate, room = n * rate;
  const food = db.orders.filter((o) => o.booking == b.id).reduce((s, o) => s + o.qty * db.menu.find((m) => m.id == o.item).price, 0);
  const paid = db.payments.filter((p) => p.booking == b.id).reduce((s, p) => s + p.amount, 0);
  return { n, rate, room, food, total: room + food, paid, bal: room + food - paid };
}
function roomState(r) {
  if (r.maint) return ['maint', 'Maintenance', ''];
  const bs = db.bookings.filter((b) => b.room == r.id);
  const inn = bs.find((b) => b.status === 'Checked in');
  if (inn) return ['occ', 'Occupied', G(inn.guest).name];
  const due = bs.find((b) => b.status === 'Reserved' && b.in === today());
  if (due) return ['due', 'Arriving', G(due.guest).name];
  return ['free', 'Available', ''];
}

/* ---------- Roles and navigation ---------- */
const ROLES = {
  reception: { label: 'Receptionist', views: ['dashboard', 'bookings', 'billing', 'orders', 'rooms'] },
  manager: { label: 'Manager', views: ['dashboard', 'bookings', 'billing', 'orders', 'rooms', 'inventory', 'reports', 'feedback'] },
  accounts: { label: 'Accountant', views: ['dashboard', 'billing', 'reports'] },
  admin: { label: 'Administrator', views: ['dashboard', 'rooms', 'feedback', 'admin'] },
  guest: { label: 'Guest', views: ['gbook', 'gmenu', 'gstays'] }
};
const TITLES = { dashboard: 'Dashboard', bookings: 'Bookings', billing: 'Billing', orders: 'Restaurant', rooms: 'Rooms', inventory: 'Inventory', reports: 'Reports', admin: 'Admin', gbook: 'Book a room', gstays: 'My stays', feedback: 'Guest feedback', gmenu: 'Food and drinks' };
let role = null, current = 'dashboard';

function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.className = ''), 3200);
}
function show(view) {
  current = view;
  $$('main > section').forEach((s) => (s.hidden = s.id !== 'v-' + view));
  $$('#nav button').forEach((b) => b.setAttribute('aria-current', b.dataset.v === view));
  render();
}
async function enter(user) {
  role = user;
  $('#login').hidden = true; $('#app').hidden = false;
  $('#whoName').textContent = 'Signed in as ' + ROLES[user].label;
  $('#nav').innerHTML = ROLES[user].views.map((v) => `<button data-v="${v}">${TITLES[v]}</button>`).join('');
  $('#roomForm').hidden = user !== 'manager';
  $('#purgeBtn').hidden = user !== 'manager';
  await refresh();
  show(ROLES[user].views[0]);
}

/* ---------- Rendering ---------- */
const empty = (cols, msg) => `<tr><td colspan="${cols}" class="empty">${msg}</td></tr>`;
const badge = (txt) => {
  const c = { 'Checked in': 'ok', Reserved: 'warn', Cancelled: 'bad', 'Checked out': '' }[txt] || '';
  return `<span class="badge ${c}">${txt}</span>`;
};
function fillSelect(sel, items, label, keep) {
  const old = keep ? sel.value : '';
  sel.innerHTML = items.map((i) => `<option value="${i.id}">${esc(label(i))}</option>`).join('');
  if (old && items.some((i) => i.id == old)) sel.value = old;
}

function render() {
  ({ dashboard: rDash, rooms: rRooms, bookings: rBook, billing: rBill, orders: rOrd, inventory: rStock, reports: rRep, admin: rAdmin, gbook: rGBook, gstays: rGStays, feedback: rFeedback, gmenu: rGMenu })[current]();
}

function rDash() {
  const box = $('#onlineBox');
  if (role === 'reception') {
    const on = db.bookings.filter((b) => b.source === 'Online' && b.status === 'Reserved');
    box.innerHTML = `<div class="card online"><h3>Online reservations awaiting arrival (${on.length})</h3>${on.length
      ? '<ul>' + on.map((b) => `<li><b>${esc(G(b.guest).name)}</b>, ${esc(G(b.guest).phone)}: Room ${esc(R(b.room).no)} (${T(R(b.room).type).name}), ${dShort(b.in)} to ${dShort(b.out)}</li>`).join('') + '</ul>'
      : '<p class="empty">No online reservations waiting.</p>'}<small>Remind guests to pay and report on time to avoid a fine.</small></div>`;
  } else box.innerHTML = '';
  const rooms = db.rooms, usable = rooms.filter((r) => !r.maint).length;
  const occ = rooms.filter((r) => roomState(r)[0] === 'occ').length;
  const arr = db.bookings.filter((b) => b.status === 'Reserved' && b.in === today()).length;
  const dep = db.bookings.filter((b) => b.status === 'Checked in' && b.out === today()).length;
  const rev = db.payments.filter((p) => p.date === today()).reduce((s, p) => s + p.amount, 0);
  $('#stats').innerHTML = [
    [Math.round((occ / (usable || 1)) * 100) + '%', `Occupancy (${occ} of ${usable} rooms)`],
    [arr, 'Arrivals expected today'], [dep, 'Departures due today'], [money(rev), 'Payments received today']
  ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  $('#rack').innerHTML = rooms.map((r) => {
    const [c, label, who] = roomState(r);
    return `<div class="tile ${c}"><b>${esc(r.no)}</b><span>${T(r.type).name}, ${label}</span><em>${esc(who)}</em></div>`;
  }).join('');
}

const photoTag = (t, cls) => t.photo
  ? `<img class="${cls}" src="uploads/${esc(t.photo)}" alt="${esc(t.name)} room">`
  : `<div class="${cls} ph">${esc(t.name[0])}</div>`;

function rRooms() {
  $('#typeCards').innerHTML = db.types.map((t) => `<div class="tcard">${photoTag(t, 'tphoto')}<div class="tinfo"><b>${esc(t.name)}</b><span>${money(t.rate)} per night</span></div>${['manager', 'admin'].includes(role) ? `<div class="tup"><input type="file" accept="image/jpeg,image/png,image/webp" id="cfile${t.id}" aria-label="Photo for ${esc(t.name)}"><button class="btn sm ghost" data-act="cphoto" data-id="${t.id}">Upload photo</button></div>` : ''}</div>`).join('');
  $('#roomsBody').innerHTML = db.rooms.map((r) => {
    const [c, label] = roomState(r);
    const btn = role === 'manager' && c !== 'occ'
      ? `<button class="btn sm ghost" data-act="maint" data-id="${r.id}">${r.maint ? 'Mark available' : 'Mark maintenance'}</button>` : '';
    return `<tr><td>${esc(r.no)}</td><td>${T(r.type).name}</td><td>${money(T(r.type).rate)}</td><td>${label}</td><td>${btn}</td></tr>`;
  }).join('');
  fillSelect($('#rType'), db.types, (t) => t.name, true);
}

function rBook() {
  fillSelect($('#bType'), db.types, (t) => `${t.name} (${money(t.rate)})`, true);
  if (!$('#bIn').value) { $('#bIn').value = today(); $('#bOut').value = addDays(today(), 1); }
  $('#bIn').min = today();
  availRooms();
  const rows = [...db.bookings].reverse().filter((b) => $('#showCancelled').checked || b.status !== 'Cancelled').map((b) => {
    let a = '';
    if (b.status === 'Reserved') a = `<button class="btn sm" data-act="in" data-id="${b.id}">Check in</button><button class="btn sm danger" data-act="cancel" data-id="${b.id}">Cancel</button>`;
    if (b.status === 'Checked in') a = `<button class="btn sm" data-act="out" data-id="${b.id}">Check out</button>`;
    return `<tr><td>${b.id}</td><td>${esc(G(b.guest).name)}</td><td>${esc(R(b.room).no)}</td><td>${dShort(b.in)} to ${dShort(b.out)}</td><td>${b.source === 'Online' ? '<span class="badge warn">Online</span>' : 'Front desk'}</td><td>${badge(b.status)}</td><td>${a}</td></tr>`;
  });
  $('#bookBody').innerHTML = rows.join('') || empty(7, 'No bookings yet. Save the first one above.');
}
function availRooms() {
  const a = $('#bIn').value, b = $('#bOut').value, type = $('#bType').value, sel = $('#bRoom');
  const free = db.rooms.filter((r) => r.type == type && a && b && b > a && isFree(r, a, b));
  sel.innerHTML = free.length ? free.map((r) => `<option value="${r.id}">Room ${esc(r.no)}</option>`).join('') : '<option value="">No room free for these dates</option>';
}

function stays(list) { return list.map((b) => ({ id: b.id, label: `Room ${R(b.room).no}, ${G(b.guest).name} (${b.status})` })); }
function rBill() {
  const list = db.bookings.filter((b) => b.status === 'Checked in' || b.status === 'Checked out').reverse();
  fillSelect($('#billSel'), stays(list), (x) => x.label, true);
  const b = B($('#billSel').value);
  $('#payForm').hidden = !b;
  if (!b) { $('#invoice').innerHTML = '<p class="empty">No guests in house yet. Check a guest in from Bookings.</p>'; return; }
  const x = bill(b), g = G(b.guest);
  $('#invoice').innerHTML = `<strong>Invoice #${b.id}</strong>
    <p>${esc(g.name)}, ${esc(g.phone)}<br>Room ${esc(R(b.room).no)} (${T(R(b.room).type).name}), ${dShort(b.in)} to ${dShort(b.out)}</p>
    <table class="invoice-t">
      <tr><td>Room: ${x.n} night(s) at ${money(x.rate)}</td><td>${money(x.room)}</td></tr>
      <tr><td>Restaurant and bar</td><td>${money(x.food)}</td></tr>
      <tr class="sum"><td>Total</td><td>${money(x.total)}</td></tr>
      <tr><td>Paid</td><td>${money(x.paid)}</td></tr>
      <tr class="sum"><td>Balance due</td><td>${money(Math.max(0, x.bal))}</td></tr>
    </table>`;
  $('#pAmt').value = Math.max(0, x.bal) || '';
}

function rOrd() {
  const inHouse = db.bookings.filter((b) => b.status === 'Checked in');
  fillSelect($('#oBook'), stays(inHouse), (x) => x.label, true);
  fillSelect($('#oItem'), db.menu, (m) => `${m.name} (${money(m.price)})`, true);
  $('#ordBody').innerHTML = [...db.orders].reverse().map((o) => {
    const m = db.menu.find((i) => i.id == o.item), b = B(o.booking);
    return `<tr><td>${dShort(o.date)}</td><td>${esc(R(b.room).no)}</td><td>${esc(m.name)}</td><td>${o.qty}</td><td>${money(o.qty * m.price)}</td></tr>`;
  }).join('') || empty(5, 'No orders yet.');
}

function rStock() {
  fillSelect($('#sItem'), db.stock.map((s) => ({ id: s.id, n: s.item })), (s) => s.n, true);
  $('#stkBody').innerHTML = db.stock.map((s) => `<tr><td>${esc(s.item)}</td><td>${s.qty}</td><td>${s.min}</td>
    <td>${s.qty <= s.min ? '<span class="badge bad">Reorder now</span>' : '<span class="badge ok">OK</span>'}</td></tr>`).join('');
}

function rRep() {
  const live = db.bookings.filter((b) => b.status !== 'Cancelled');
  const paid = db.payments.reduce((s, p) => s + p.amount, 0);
  const owed = live.filter((b) => b.status !== 'Reserved').reduce((s, b) => s + Math.max(0, bill(b).bal), 0);
  $('#repStats').innerHTML = [[live.length, 'Bookings (not cancelled)'], [money(paid), 'Total payments received'], [money(owed), 'Outstanding balances']]
    .map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  const days = [...Array(7)].map((_, i) => addDays(today(), i - 6));
  const sums = days.map((d) => db.payments.filter((p) => p.date === d).reduce((s, p) => s + p.amount, 0));
  const max = Math.max(...sums, 1);
  $('#bars').innerHTML = days.map((d, i) => `<div class="bar" title="${money(sums[i])}"><div style="height:${(sums[i] / max) * 80}%"></div><span>${dShort(d)}</span></div>`).join('');
  $('#typeBody').innerHTML = db.types.map((t) => {
    const bs = live.filter((b) => T(R(b.room).type).id === t.id);
    return `<tr><td>${t.name}</td><td>${bs.length}</td><td>${money(bs.reduce((s, b) => s + bill(b).room, 0))}</td></tr>`;
  }).join('');
  const low = db.stock.filter((s) => s.qty <= s.min);
  $('#lowList').innerHTML = low.length ? low.map((s) => `<p>${esc(s.item)}: ${s.qty} left, reorder at ${s.min}</p>`).join('') : '<p>All items are above their reorder level.</p>';
}

async function rAdmin() {
  let users = [];
  try { users = await api('users'); } catch (e) { return toast(e.message, true); }
  const roles = ['receptionist', 'manager', 'accountant', 'admin'];
  $('#userBody').innerHTML = users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td>
    <td>${u.role === 'guest' ? 'guest' : ''}<select data-urole="${u.id}"${u.role === 'guest' ? ' hidden' : ''} aria-label="Role for ${esc(u.username)}">${roles.map((r) => `<option value="${r}"${r === u.role ? ' selected' : ''}>${r}</option>`).join('')}</select></td>
    <td>${+u.active ? '<span class="badge ok">Active</span>' : '<span class="badge bad">Disabled</span>'}</td>
    <td><button class="btn sm ghost" data-act="toggle" data-id="${u.id}" data-on="${+u.active}">${+u.active ? 'Disable' : 'Enable'}</button>
        <button class="btn sm ghost" data-act="pwd" data-id="${u.id}">Reset password</button></td></tr>`).join('');
  $('#adminTypes').innerHTML = db.types.map((t) => `<tr><td>${photoTag(t, 'thumb')}</td><td>${esc(t.name)}</td>
    <td><input class="sm" type="number" min="1000" step="1000" value="${t.rate}" id="rate${t.id}" aria-label="Rate for ${esc(t.name)}"> <button class="btn sm" data-act="rate" data-id="${t.id}">Save rate</button></td>
    <td><input type="file" accept="image/jpeg,image/png,image/webp" id="file${t.id}" aria-label="Photo for ${esc(t.name)}"> <button class="btn sm ghost" data-act="photo" data-id="${t.id}">Upload</button></td></tr>`).join('');
  $('#menuBody').innerHTML = db.menu.map((m) => `<tr><td>${photoTag(m, 'thumb')}</td><td>${esc(m.name)}</td>
    <td><input class="sm" type="number" min="500" step="500" value="${m.price}" id="mp${m.id}" aria-label="Price for ${esc(m.name)}"> <button class="btn sm" data-act="mprice" data-id="${m.id}">Save price</button></td>
    <td><input type="file" accept="image/jpeg,image/png,image/webp" id="mfile${m.id}" aria-label="Photo for ${esc(m.name)}"> <button class="btn sm ghost" data-act="mphoto" data-id="${m.id}">Upload</button></td></tr>`).join('');
}

async function postForm(action, fd, msg) {
  try {
    const res = await fetch('api/api.php?action=' + action, { method: 'POST', body: fd });
    const j = await res.json().catch(() => ({ error: 'Upload failed.' }));
    if (!res.ok) throw new Error(j.error);
    await refresh(); toast(msg); render(); return true;
  } catch (e) { toast(e.message, true); return false; }
}

async function uploadPhoto(id, inputSel) {
  const f = $(inputSel).files[0];
  if (!f) return toast('Choose an image first', true);
  const fd = new FormData(); fd.append('type', id); fd.append('photo', f);
  try {
    const res = await fetch('api/api.php?action=type_photo', { method: 'POST', body: fd });
    const j = await res.json().catch(() => ({ error: 'Upload failed.' }));
    if (!res.ok) throw new Error(j.error);
    await refresh(); toast('Photo uploaded'); render();
  } catch (e) { toast(e.message, true); }
}

function adminAct(btn) {
  const id = +btn.dataset.id, a = btn.dataset.act;
  if (a === 'toggle') { act('user_update', { id, active: btn.dataset.on === '1' ? 0 : 1 }, 'Account updated'); return true; }
  if (a === 'pwd') { const p = prompt('New password (at least 6 characters):'); if (p) act('user_update', { id, password: p }, 'Password reset'); return true; }
  if (a === 'rate') { act('type_update', { id, rate: +$('#rate' + id).value }, 'Rate saved'); return true; }
  if (a === 'mprice') { act('menu_update', { id, price: +$('#mp' + id).value }, 'Price saved'); return true; }
  if (a === 'mphoto') {
    const f = $('#mfile' + id).files[0];
    if (!f) { toast('Choose an image first', true); return true; }
    const fd = new FormData(); fd.append('id', id); fd.append('photo', f);
    postForm('menu_photo', fd, 'Photo uploaded');
    return true;
  }
  if (a === 'photo') { uploadPhoto(id, '#file' + id); return true; }
  if (a === 'cphoto') { uploadPhoto(id, '#cfile' + id); return true; }
  return false;
}

/* ---------- Guest portal and feedback ---------- */
const hint = (n) => (n <= 2 ? 'We are sorry it fell short. What went wrong?' : n === 3 ? 'What could we do better?' : 'What did you enjoy most?');

function gEstimate() {
  const t = gd.types.find((x) => x.id == $('#gType').value), a = $('#gIn').value, b = $('#gOut').value;
  $('#gEst').textContent = t && a && b && b > a
    ? `${nights(a, b)} night(s) at ${money(t.rate)} = ${money(nights(a, b) * t.rate)} (room only)`
    : 'Choose valid dates to see the price.';
}

let gAvail = {};
function gCards() {
  const sel = $('#gType').value;
  $('#gTypes').innerHTML = gd.types.map((t) => {
    const a = gAvail[t.id], on = t.id == sel;
    const line = !a ? 'Pick valid dates to see availability' : a.free > 0 ? `${a.free} of ${a.total} available for your dates` : 'Fully booked for your dates';
    return `<div class="tcard${on ? ' sel' : ''}">${photoTag(t, 'tphoto')}<div class="tinfo"><b>${esc(t.name)}</b><span>${money(t.rate)} per night</span><span class="${a && a.free === 0 ? 'full' : 'avail'}">${line}</span></div><div class="tup"><button type="button" class="btn sm${on ? '' : ' ghost'}" data-act="gpick" data-id="${t.id}">${on ? 'Selected' : 'Choose this type'}</button></div></div>`;
  }).join('');
}
async function gLoadAvail() {
  const a = $('#gIn').value, b = $('#gOut').value;
  gAvail = {};
  if (a && b && b > a) {
    try { (await api('g_avail', { in: a, out: b })).forEach((r) => (gAvail[r.id] = r)); } catch (e) { gAvail = {}; }
  }
  gCards();
}
function rGBook() {
  fillSelect($('#gType'), gd.types, (t) => `${t.name} (${money(t.rate)})`, true);
  if (!$('#gIn').value) { $('#gIn').value = today(); $('#gOut').value = addDays(today(), 1); }
  $('#gIn').min = today();
  gCards(); gEstimate(); gLoadAvail();
}

function rGMenu() {
  $('#gMenu').innerHTML = gd.menu.map((m) => `<div class="tcard">${photoTag(m, 'tphoto')}<div class="tinfo"><b>${esc(m.name)}</b><span>${money(m.price)}</span></div></div>`).join('') || '<p class="empty">The menu is empty at the moment.</p>';
}

function rGStays() {
  $('#stayList').innerHTML = gd.bookings.map((b) => {
    let extra = '';
    if (b.status === 'Reserved') extra = `<p class="warn-note">Please report on ${dShort(b.in)} and pay on time to avoid a fine.</p><button class="btn sm danger" data-act="gcancel" data-id="${b.id}">Cancel booking</button>`;
    if (b.status === 'Checked out') {
      extra = `<div class="fb">
        <fieldset><legend>Rate your stay</legend><div class="stars">${[5, 4, 3, 2, 1].map((n) =>
          `<input type="radio" class="sr" name="r${b.id}" id="r${b.id}_${n}" value="${n}"${b.rating == n ? ' checked' : ''}><label for="r${b.id}_${n}"><span aria-hidden="true">★</span><span class="sr">${n} star${n > 1 ? 's' : ''}</span></label>`).join('')}</div></fieldset>
        <label>Your comments<textarea id="c${b.id}" maxlength="1000" rows="3" placeholder="${b.rating ? hint(+b.rating) : 'Tell us about your stay'}">${esc(b.comment || '')}</textarea></label>
        <div><button class="btn sm" data-act="gfb" data-id="${b.id}">${b.rating ? 'Update feedback' : 'Send feedback'}</button></div>
      </div>`;
    }
    return `<div class="card stay"><div class="sh"><div><b>Room ${esc(b.room)}, ${esc(b.type)}</b><br><small>${dShort(b.in)} to ${dShort(b.out)}, ${money(b.total)}</small></div>${badge(b.status)}</div>${extra}</div>`;
  }).join('') || '<p class="empty">No stays yet. Book a room to get started.</p>';
}

function guestAct(btn) {
  const id = +btn.dataset.id, a = btn.dataset.act;
  if (a === 'gpick') { $('#gType').value = id; gEstimate(); gCards(); return true; }
  if (a === 'gcancel') { act('g_cancel', { booking: id }, 'Booking cancelled'); return true; }
  if (a === 'gfb') {
    const r = document.querySelector(`input[name="r${id}"]:checked`);
    if (!r) { toast('Please choose a star rating first', true); return true; }
    act('g_feedback', { booking: id, rating: +r.value, comment: $('#c' + id).value.trim() }, 'Thank you for your feedback');
    return true;
  }
  return false;
}

let fbRows = [];
async function rFeedback() {
  try { fbRows = await api('feedback_list'); } catch (e) { return toast(e.message, true); }
  const n = fbRows.length, count = (r) => fbRows.filter((f) => f.rating === r).length;
  const avg = n ? fbRows.reduce((s, f) => s + f.rating, 0) / n : 0;
  $('#fbStats').innerHTML = [
    [n ? avg.toFixed(1) + ' / 5' : 'No ratings', 'Average rating'], [n, 'Reviews received'],
    [(n ? Math.round(((count(4) + count(5)) / n) * 100) : 0) + '%', 'Rated 4 or 5 stars'], [count(1) + count(2), 'Rated 1 or 2 stars']
  ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  const max = Math.max(1, ...[1, 2, 3, 4, 5].map(count));
  $('#fbBars').innerHTML = [5, 4, 3, 2, 1].map((r) => `<div class="dist"><span>${r} ★</span><div class="track"><div style="width:${(count(r) / max) * 100}%"></div></div><span>${count(r)}</span></div>`).join('');
  fbList();
}
function fbList() {
  const f = $('#fbFilter').value;
  const rows = fbRows.filter((x) => (f === 'low' ? x.rating <= 2 : f === 'mid' ? x.rating === 3 : f === 'high' ? x.rating >= 4 : true));
  $('#fbBody').innerHTML = rows.map((x) => `<tr><td>${dShort(String(x.updated).slice(0, 10))}</td><td>${esc(x.guest)}</td><td>${esc(x.room)} (${esc(x.type)})</td>
    <td><span class="stars-ro" role="img" aria-label="${x.rating} out of 5">${'★'.repeat(x.rating)}${'☆'.repeat(5 - x.rating)}</span></td>
    <td class="cmt">${x.comment ? esc(x.comment) : '<small>No comment</small>'}</td></tr>`).join('') || empty(5, 'No feedback to show.');
}

/* ---------- Events ---------- */
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('login', { username: $('#u').value.trim(), password: $('#p').value });
    $('#loginErr').textContent = '';
    await enter(r.role);
  } catch (err) { $('#loginErr').textContent = err.message; }
});
$('#logout').onclick = async () => { try { await api('logout', {}); } catch (e) { /* ignore */ } location.reload(); };
$('#nav').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  try { await refresh(); } catch (err) { return toast(err.message, true); }
  show(b.dataset.v);
});
['#bType', '#bIn', '#bOut'].forEach((s) => $(s).addEventListener('change', availRooms));
$('#billSel').addEventListener('change', rBill);

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  if (adminAct(btn) || guestAct(btn)) return;
  const id = +btn.dataset.id;
  const map = {
    maint: ['maint', { room: id }, 'Room status updated'],
    in: ['checkin', { booking: id }, 'Guest checked in'],
    out: ['checkout', { booking: id }, 'Guest checked out'],
    cancel: ['cancel', { booking: id }, 'Booking cancelled']
  };
  act(...map[btn.dataset.act]);
});

$('#bookForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!$('#bRoom').value) return toast('Pick dates with a free room first', true);
  const ok = await act('book', {
    name: $('#bName').value.trim(), phone: $('#bPhone').value.trim(), idno: $('#bId').value.trim(),
    room: +$('#bRoom').value, in: $('#bIn').value, out: $('#bOut').value
  }, 'Booking saved');
  if (ok) { e.target.reset(); $('#bIn').value = today(); $('#bOut').value = addDays(today(), 1); render(); }
});

$('#payForm').addEventListener('submit', (e) => {
  e.preventDefault();
  act('pay', { booking: +$('#billSel').value, amount: +$('#pAmt').value, method: $('#pMethod').value }, 'Payment recorded');
});
$('#printBtn').onclick = () => window.print();

$('#ordForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!$('#oBook').value) return toast('No guest is checked in yet', true);
  act('order', { booking: +$('#oBook').value, item: +$('#oItem').value, qty: +$('#oQty').value }, 'Order added to the guest bill');
});

$('#stkForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ok = await act('stock', { item: +$('#sItem').value, delta: +$('#sQty').value * +$('#sAct').value }, 'Stock updated');
  if (ok) e.target.reset();
});

$('#roomForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ok = await act('addroom', { no: $('#rNo').value.trim(), type: +$('#rType').value }, 'Room added');
  if (ok) e.target.reset();
});

document.addEventListener('change', (e) => {
  const s = e.target.closest('[data-urole]');
  if (s) act('user_update', { id: +s.dataset.urole, role: s.value }, 'Role updated');
});
$('#userForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ok = await act('user_add', { name: $('#uName').value.trim(), username: $('#uUser').value.trim(), role: $('#uRole').value, password: $('#uPass').value }, 'User added');
  if (ok) e.target.reset();
});
$('#menuForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData();
  fd.append('name', $('#mName').value.trim()); fd.append('price', $('#mPrice').value);
  if ($('#mPhoto').files[0]) fd.append('photo', $('#mPhoto').files[0]);
  const ok = await postForm('menu_add', fd, 'Menu item added');
  if (ok) e.target.reset();
});

['#gType', '#gIn', '#gOut'].forEach((s) => $(s).addEventListener('change', () => { gEstimate(); gCards(); if (s !== '#gType') gLoadAvail(); }));
$('#gBookForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const av = gAvail[$('#gType').value];
  if (av && av.free === 0) return toast('No room of that type is free for these dates. Choose another type or other dates.', true);
  const ok = await act('g_book', { type: +$('#gType').value, in: $('#gIn').value, out: $('#gOut').value }, 'Room reserved. See My stays.');
  if (ok) show('gstays');
});
$('#fbFilter').addEventListener('change', fbList);
document.addEventListener('change', (e) => {
  const r = e.target.closest('input[type=radio][name^="r"]');
  const ta = r && $('#c' + r.name.slice(1));
  if (ta) ta.placeholder = hint(+r.value);
});

$('#showReg').onclick = () => { $('#loginForm').hidden = true; $('#regForm').hidden = false; };
$('#showLogin').onclick = () => { $('#regForm').hidden = true; $('#loginForm').hidden = false; };
$('#regForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('register', { name: $('#rName').value.trim(), phone: $('#rPhone').value.trim(), idno: $('#rId').value.trim(), username: $('#rUser').value.trim(), password: $('#rPass').value });
    $('#regErr').textContent = '';
    await enter(r.role);
  } catch (err) { $('#regErr').textContent = err.message; }
});

$('#showCancelled').addEventListener('change', rBook);
$('#purgeBtn').onclick = () => {
  if (confirm('Permanently delete all cancelled bookings? This cannot be undone.')) act('purge_cancelled', {}, 'Cancelled bookings deleted');
};

/* Resume an existing PHP session after a page refresh */
api('me').then((r) => enter(r.role)).catch(() => { /* not signed in: show login */ });
