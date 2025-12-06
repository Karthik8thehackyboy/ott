// Utils
const $ = (sel) => document.querySelector(sel);
const subsKey = 'ott_subscriptions';

function getSubs() {
  return JSON.parse(localStorage.getItem(subsKey) || '[]');
}
function saveSubs(subs) {
  localStorage.setItem(subsKey, JSON.stringify(subs));
}
function dateToISO(d) {
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d - tzOffset).toISOString().slice(0, 10);
}
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
function cycleDays(cycle, customDays) {
  switch (cycle) {
    case 'monthly': return 30;
    case 'quarterly': return 90;
    case 'semiannual': return 182;
    case 'annual': return 365;
    case 'custom': return Math.max(1, Number(customDays || 1));
    default: return 30;
  }
}
function nextRenewal(fromDateISO, cycle, customDays) {
  const now = new Date();
  let next = new Date(fromDateISO);
  const step = cycleDays(cycle, customDays);
  while (next < now) next = addDays(next, step);
  return next;
}
function daysLeft(date) {
  const ms = new Date(date) - new Date();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

// Elements
const form = $('#subForm');
const nameEl = $('#name');
const planEl = $('#plan');
const costEl = $('#cost');
const renewalDateEl = $('#renewalDate');
const cycleEl = $('#cycle');
const customDaysWrap = $('#customDaysWrap');
const customDaysEl = $('#customDays');
const tableBody = $('#subsTable tbody');
const windowDaysEl = $('#windowDays');
const searchEl = $('#search');
const notifyBtn = $('#notify-permission');
const exportBtn = $('#export');
const importFileEl = $('#importFile');

// State
let subs = getSubs();

// Notification permission
notifyBtn.addEventListener('click', async () => {
  if (!('Notification' in window)) {
    alert('Notifications are not supported in this browser.');
    return;
  }
  const p = await Notification.requestPermission();
  alert(p === 'granted' ? 'Notifications enabled.' : 'Notifications blocked.');
});

// Show/hide custom days
cycleEl.addEventListener('change', () => {
  customDaysWrap.classList.toggle('hidden', cycleEl.value !== 'custom');
});

// Add subscription
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const sub = {
    id: crypto.randomUUID(),
    name: nameEl.value.trim(),
    plan: planEl.value.trim(),
    cost: Number(costEl.value || 0),
    renewalDate: renewalDateEl.value,
    cycle: cycleEl.value,
    customDays: cycleEl.value === 'custom' ? Number(customDaysEl.value || 1) : null,
    notes: $('#notes').value.trim(),
    createdAt: new Date().toISOString()
  };
  subs.push(sub);
  saveSubs(subs);
  form.reset();
  cycleEl.value = 'annual';
  customDaysWrap.classList.add('hidden');
  render();
});

// Delete / Renew now
function removeSub(id) {
  subs = subs.filter(s => s.id !== id);
  saveSubs(subs);
  render();
}
function renewNow(id) {
  const s = subs.find(x => x.id === id);
  if (!s) return;
  const next = nextRenewal(s.renewalDate, s.cycle, s.customDays);
  s.renewalDate = dateToISO(addDays(next, cycleDays(s.cycle, s.customDays)));
  saveSubs(subs);
  render();
}

// Filtering + rendering
function render() {
  const windowDays = Number(windowDaysEl.value || 30);
  const q = (searchEl.value || '').toLowerCase();

  const rows = subs
    .map(s => {
      const next = nextRenewal(s.renewalDate, s.cycle, s.customDays);
      const left = daysLeft(next);
      const badgeClass = left <= 3 ? 'danger' : left <= 10 ? 'warn' : 'ok';
      return { ...s, next, left, badgeClass };
    })
    .filter(s => s.left <= windowDays)
    .filter(s => {
      const bucket = `${s.name} ${s.plan} ${s.notes}`.toLowerCase();
      return bucket.includes(q);
    })
    .sort((a, b) => a.next - b.next);

  tableBody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.name}</td>
      <td>${r.plan || '-'}</td>
      <td>${r.cost ? '₹' + r.cost.toFixed(2) : '-'}</td>
      <td>${r.renewalDate}</td>
      <td>${r.cycle}${r.cycle === 'custom' ? ` (${r.customDays}d)` : ''}</td>
      <td>${dateToISO(r.next)}</td>
      <td><span class="badge ${r.badgeClass}">${r.left} days</span></td>
      <td>${r.notes || '-'}</td>
      <td class="actions-cell">
        <button class="secondary" data-action="renew" data-id="${r.id}">Mark renewed</button>
        <button data-action="delete" data-id="${r.id}">Delete</button>
      </td>
    </tr>
  `).join('');

  // schedule local notifications for items due within 1 day
  rows.forEach(r => {
    if (r.left <= 1 && ('Notification' in window) && Notification.permission === 'granted') {
      new Notification(`Renew ${r.name} in ${r.left} day${r.left === 1 ? '' : 's'}`, {
        body: `Plan: ${r.plan || '—'} • Next: ${dateToISO(r.next)} • Cost: ₹${(r.cost || 0).toFixed(2)}`,
      });
    }
  });
}

// table actions
tableBody.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'delete') removeSub(id);
  if (btn.dataset.action === 'renew') renewNow(id);
});

windowDaysEl.addEventListener('input', render);
searchEl.addEventListener('input', render);

// export/import
exportBtn.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(subs, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'subscriptions.json';
  a.click();
});
importFileEl.addEventListener('change', async () => {
  const file = importFileEl.files?.[0];
  if (!file) return;
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error('Invalid data');
    subs = data.map(s => ({ ...s, id: s.id || crypto.randomUUID() }));
    saveSubs(subs);
    render();
  } catch (err) {
    alert('Import failed: ' + err.message);
  }
});

// initial
if (!renewalDateEl.value) renewalDateEl.value = dateToISO(new Date());
render();