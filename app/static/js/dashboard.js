if (!Auth.require('patient')) throw new Error('يلزم تسجيل الدخول بحساب مريض.');

const $ = id => document.getElementById(id);
const state = { meds: [], catalog: [], categories: [], notifications: [], unread: [], adherence: {}, selectedMed: null, currentPage: 'overview' };
const dayLabel = {sat:'السبت',sun:'الأحد',mon:'الاثنين',tue:'الثلاثاء',wed:'الأربعاء',thu:'الخميس',fri:'الجمعة'};

$('side-user').textContent = Auth.user().full_name || Auth.user().email || 'مريض';
$('welcome').textContent = `أهلًا ${Auth.user().full_name || 'بك'}`;
window.addEventListener('DOMContentLoaded', refreshAll);

function showPage(page) {
  state.currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  $(`page-${page}`).classList.add('active');
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.querySelector('.sidebar')?.classList.remove('open');
  if (page === 'meds') renderMeds();
  if (page === 'history') loadHistory(1);
  if (page === 'notifications') loadNotifications(1);
}

async function refreshAll() {
  await Promise.all([loadMeds(), loadNotifications(1, true), loadUnread()]);
  await loadAdherence();
  renderOverview();
  renderMeds();
}

async function loadMeds() {
  const r = await Api.medications.myList();
  state.meds = r.data || [];
}

async function loadUnread() {
  try {
    const r = await Api.notifications.unread();
    state.unread = r.data || [];
  } catch {
    state.unread = [];
  }
}

async function loadAdherence() {
  state.adherence = {};
  await Promise.all(state.meds.map(async m => {
    try {
      state.adherence[m.patient_med_id] = (await Api.doses.adherence(m.patient_med_id)).data;
    } catch {
      state.adherence[m.patient_med_id] = null;
    }
  }));
}

function activeMeds() {
  return state.meds.filter(m => m.status === 'active');
}

function activeSchedule(m) {
  return m.active_schedule || (m.schedules || []).find(s => s.status === 'active');
}

function renderOverview() {
  const active = activeMeds();
  const low = active.filter(m => Number(m.current_quantity) <= Number(m.min_threshold));
  const ad = Object.values(state.adherence).filter(Boolean);
  const avg = ad.length ? Math.round(ad.reduce((s, a) => s + Number(a.adherence_rate || 0), 0) / ad.length) : 0;
  $('st-meds').textContent = active.length;
  $('st-unread').textContent = state.unread.length;
  $('st-low').textContent = low.length;
  $('st-adherence').textContent = `${avg}%`;
  renderToday();
  $('overview-notifs').innerHTML = state.notifications.slice(0, 4).map(notificationRow).join('') || UI.empty('🔔', 'لا توجد تنبيهات', '');
}

function renderToday() {
  const d = ['sun','mon','tue','wed','thu','fri','sat'][new Date().getDay()];
  const rows = [];
  activeMeds().forEach(m => {
    const s = activeSchedule(m);
    if (!s || !(s.days || []).some(x => x.day_of_week === d)) return;
    (s.dose_periods || []).forEach(p => rows.push({ m, p }));
  });
  $('today-list').innerHTML = rows.map(({m, p}) => `
    <div class="row">
      <div>
        <div class="row-title">${UI.h(m.medication_name)} - ${UI.period(p.dose_period)}</div>
        <div class="row-sub">${p.dose_amount} ${UI.h(p.dose_unit)} · موعد الإشعار ${UI.formatTime(p.dose_time)}</div>
      </div>
      <span class="badge">ينتظر الإشعار</span>
    </div>
  `).join('') || UI.empty('🌿', 'لا توجد جرعات اليوم', '');
}

function renderMeds() {
  const box = $('med-cards');
  if (!box) return;
  if (!state.meds.length) {
    box.innerHTML = UI.empty('💊', 'لا توجد أدوية', 'اضغط إضافة دواء للبدء.');
    return;
  }
  box.innerHTML = state.meds.map(m => {
    const s = activeSchedule(m);
    const low = Number(m.current_quantity) <= Number(m.min_threshold);
    return `<div class="med-card">
      <div class="row-title">${UI.h(m.medication_name)}</div>
      <div class="row-sub">${UI.h(m.medication_category)} · ${UI.form(m.medication_form)} · ${UI.h(m.medication_strength)}</div>
      <div class="meta">${UI.badge(m.status)}${low ? UI.badge('low_stock') : ''}<span class="badge">الكمية ${m.current_quantity}</span></div>
      <div class="schedule-box">${scheduleText(s)}</div>
      <div class="actions">
        <button class="btn sm secondary" onclick="openEditMed(${m.patient_med_id})">تعديل</button>
        ${m.status === 'active'
          ? `<button class="btn sm primary" onclick="openSchedule(${m.patient_med_id})">جدول الجرعات</button><button class="btn sm danger" onclick="stopMed(${m.patient_med_id})">إيقاف</button>`
          : `<button class="btn sm success" onclick="openActivateMed(${m.patient_med_id})">تفعيل</button>`}
      </div>
    </div>`;
  }).join('');
}

function scheduleText(s) {
  if (!s) return 'لا يوجد جدول نشط';
  const days = (s.days || []).map(d => dayLabel[d.day_of_week] || d.day_of_week).join('، ');
  const ps = (s.dose_periods || []).map(p => `${UI.period(p.dose_period)} ${UI.formatTime(p.dose_time)}: ${p.dose_amount} ${UI.h(p.dose_unit)}`).join('، ');
  return `<b>${UI.h(days)}</b><br><span class="row-sub">${ps}</span>`;
}

async function openAddMed() {
  UI.clearError('add-error');
  state.selectedMed = null;
  $('selected-med').value = '';
  $('selected-box').textContent = 'لم يتم اختيار دواء بعد.';
  $('pm-start').value = UI.date();
  $('pm-end').value = '';
  $('pm-qty').value = '';
  $('pm-qty').removeAttribute('max');
  $('pm-threshold').value = '';
  $('pm-threshold').removeAttribute('max');
  $('pm-notes').value = '';
  UI.open('modal-add');
  const [cats, meds] = await Promise.all([Api.medications.categories(), Api.medications.list({page:1, per_page:500})]);
  state.categories = cats.data || [];
  state.catalog = meds.data.items || [];
  $('cat-category').innerHTML = '<option value="">كل التصنيفات</option>' + state.categories.map(c => `<option value="${UI.h(c)}">${UI.h(c)}</option>`).join('');
  $('cat-chips').innerHTML = '<button class="chip active" onclick="setCategory(\'\')">الكل</button>' + state.categories.map(c => `<button class="chip" onclick="setCategory(decodeURIComponent('${encodeURIComponent(c)}'))">${UI.h(c)}</button>`).join('');
  renderCatalog();
}

function setCategory(c) {
  $('cat-category').value = c;
  document.querySelectorAll('.chip').forEach(b => b.classList.toggle('active', b.textContent === (c || 'الكل')));
  renderCatalog();
}

function renderCatalog() {
  const q = ($('cat-search').value || '').toLowerCase();
  const c = $('cat-category').value;
  const list = state.catalog.filter(m => (!c || m.category === c) && (!q || `${m.name} ${m.category} ${m.strength} ${m.form}`.toLowerCase().includes(q)));
  $('catalog').innerHTML = list.map(m => `
    <div class="catalog-card ${state.selectedMed?.medication_id === m.medication_id ? 'selected' : ''}">
      <div class="row-title">${UI.h(m.name)}</div>
      <div class="row-sub">${UI.h(m.category)} · ${UI.form(m.form)} · ${UI.h(m.strength)}</div>
      <button class="btn sm primary" onclick="selectMed(${m.medication_id})">اختيار</button>
    </div>
  `).join('') || UI.empty('🔎', 'لا توجد نتائج', '');
}

function selectMed(id) {
  state.selectedMed = state.catalog.find(m => m.medication_id === id);
  $('selected-med').value = id;
  $('selected-box').textContent = `تم اختيار ${state.selectedMed.name}. أدخل الكمية الموجودة لديك.`;
  $('pm-qty').value = '';
  $('pm-threshold').value = '';
  renderCatalog();
}

async function submitAddMed() {
  const b = $('btn-add-med');
  UI.clearError('add-error');
  UI.loading(b, true);
  try {
    if (!state.selectedMed) throw new Error('اختر دواء من النتائج أولًا.');
    await Api.medications.add({
      medication_id: Number($('selected-med').value),
      current_quantity: $('pm-qty').value,
      min_threshold: $('pm-threshold').value,
      start_date: $('pm-start').value,
      end_date: $('pm-end').value || null,
      notes: $('pm-notes').value.trim() || null
    });
    UI.success('تمت إضافة الدواء.');
    UI.close('modal-add');
    await refreshAll();
    showPage('meds');
  } catch (e) {
    UI.showError('add-error', e);
  } finally {
    UI.loading(b, false);
  }
}

function openEditMed(id) {
  const m = state.meds.find(x => x.patient_med_id === id);
  if (!m) return;
  $('edit-pm-id').value = id;
  $('edit-qty').value = m.current_quantity;
  $('edit-qty').removeAttribute('max');
  $('edit-threshold').value = m.min_threshold;
  $('edit-end').value = m.end_date || '';
  $('edit-notes').value = m.notes || '';
  UI.clearError('edit-error');
  UI.open('modal-edit');
}

async function submitEditMed() {
  const b = $('btn-edit-med');
  UI.loading(b, true);
  UI.clearError('edit-error');
  try {
    await Api.medications.update(Number($('edit-pm-id').value), {
      current_quantity: $('edit-qty').value,
      min_threshold: $('edit-threshold').value,
      end_date: $('edit-end').value || null,
      notes: $('edit-notes').value.trim() || null
    });
    UI.success('تم تعديل الدواء.');
    UI.close('modal-edit');
    await refreshAll();
  } catch (e) {
    UI.showError('edit-error', e);
  } finally {
    UI.loading(b, false);
  }
}

function openActivateMed(id) {
  const m = state.meds.find(x => x.patient_med_id === id);
  $('activate-pm-id').value = id;
  $('activate-info').textContent = 'أدخل الكمية الموجودة لديك لإعادة تفعيل الدواء.';
  $('activate-qty').value = '';
  $('activate-qty').removeAttribute('max');
  $('activate-threshold').value = m?.min_threshold || '';
  $('activate-threshold').removeAttribute('max');
  UI.clearError('activate-error');
  UI.open('modal-activate');
}

async function submitActivateMed() {
  const b = $('btn-activate-med');
  UI.loading(b, true);
  try {
    await Api.medications.activate(Number($('activate-pm-id').value), {
      current_quantity: $('activate-qty').value,
      min_threshold: $('activate-threshold').value
    });
    UI.success('تم تفعيل الدواء.');
    UI.close('modal-activate');
    await refreshAll();
  } catch (e) {
    UI.showError('activate-error', e);
  } finally {
    UI.loading(b, false);
  }
}

async function stopMed(id) {
  if (!confirm('إيقاف الدواء؟')) return;
  try {
    await Api.medications.stop(id);
    UI.success('تم إيقاف الدواء.');
    await refreshAll();
  } catch (e) {
    UI.error(e.message);
  }
}

function toggleEnd() {
  $('end-wrap').style.display = $('schedule-cont').value === 'true' ? 'none' : 'block';
}

function openSchedule(id) {
  const m = state.meds.find(x => x.patient_med_id === id);
  const s = activeSchedule(m);
  $('schedule-pm-id').value = id;
  $('schedule-start').value = s?.start_date || m.start_date || UI.date();
  $('schedule-cont').value = s && !s.is_continuous ? 'false' : 'true';
  $('schedule-end').value = s?.end_date || '';
  document.querySelectorAll('#days input').forEach(cb => cb.checked = s ? (s.days || []).some(d => d.day_of_week === cb.value) : true);
  ['morning','evening'].forEach(p => {
    const dp = (s?.dose_periods || []).find(x => x.dose_period === p);
    $(`period-${p}`).checked = !!dp;
    $(`${p}-time`).value = dp?.dose_time || '';
    $(`${p}-dose`).value = dp?.dose_amount || 1;
    $(`${p}-unit`).value = dp?.dose_unit || 'حبة';
  });
  toggleEnd();
  UI.clearError('schedule-error');
  UI.open('modal-schedule');
}

async function submitSchedule() {
  const b = $('btn-save-schedule');
  UI.loading(b, true);
  UI.clearError('schedule-error');
  try {
    const periods = [];
    ['morning','evening'].forEach(p => {
      if (!$(`period-${p}`).checked) return;
      if (!$(`${p}-time`).value) throw new Error('حدد وقت الجرعة لكل فترة مختارة.');
      periods.push({
        dose_period: p,
        dose_time: $(`${p}-time`).value,
        dose_amount: $(`${p}-dose`).value,
        dose_unit: $(`${p}-unit`).value,
        reminder_before_minutes: 0
      });
    });
    await Api.medications.setSchedule(Number($('schedule-pm-id').value), {
      start_date: $('schedule-start').value,
      is_continuous: $('schedule-cont').value === 'true',
      end_date: $('schedule-cont').value === 'true' ? null : $('schedule-end').value,
      days: [...document.querySelectorAll('#days input:checked')].map(x => x.value),
      dose_periods: periods
    });
    UI.success('تم حفظ جدول الجرعات.');
    UI.close('modal-schedule');
    await refreshAll();
  } catch (e) {
    UI.showError('schedule-error', e);
  } finally {
    UI.loading(b, false);
  }
}

async function loadHistory(page = 1) {
  const r = await Api.doses.allHistory({page, per_page:30});
  const items = r.data.items || [];
  $('history-table').innerHTML = items.length ? `<div class="table-wrap"><table><thead><tr><th>الدواء</th><th>التاريخ</th><th>الفترة</th><th>الحالة</th><th>التأخير</th></tr></thead><tbody>${items.map(x => `<tr><td>${UI.h(x.medication_name)}</td><td>${UI.formatDateTime(x.scheduled_time)}</td><td>${UI.badge(x.dose_period)}</td><td>${UI.badge(x.status)}</td><td>${x.late_minutes ? x.late_minutes + ' دقيقة' : '—'}</td></tr>`).join('')}</tbody></table></div>` : UI.empty('📋', 'لا يوجد سجل جرعات', '');
  UI.pagination($('history-pages'), r.data, 'loadHistory');
}

async function loadNotifications(page = 1, silent = false) {
  if (!silent) $('notif-list').innerHTML = UI.empty('⏳', 'جار التحميل', '');
  const r = await Api.notifications.list({page, per_page:30});
  state.notifications = r.data.items || [];
  $('notif-list').innerHTML = state.notifications.map(notificationRow).join('') || UI.empty('🔔', 'لا توجد تنبيهات', '');
  UI.pagination($('notif-pages'), r.data, 'loadNotifications');
}

function notificationRow(n) {
  const actions = [];
  if (n.actionable) {
    actions.push(`<button class="btn sm success" onclick="confirmNotif(${n.notification_id})">تأكيد الجرعة</button>`);
    actions.push(`<button class="btn sm warning" onclick="missNotif(${n.notification_id})">تسجيل فائتة</button>`);
  }
  if (n.status === 'unread') actions.push(`<button class="btn sm secondary" onclick="readNotif(${n.notification_id})">مقروء</button>`);
  if (n.dose_log_status) actions.push(UI.badge(n.dose_log_status));
  return `<div class="row">
    <div class="row-main">
      <div class="row-title">${UI.h(n.title)}</div>
      <div class="row-sub">${UI.h(n.message)}</div>
      <div class="meta">${UI.badge(n.type)} ${UI.badge(n.status)} ${n.dose_period ? UI.badge(n.dose_period) : ''} ${n.dose_time ? `<span class="badge">${UI.formatTime(n.dose_time)}</span>` : ''}</div>
    </div>
    <div class="actions">${actions.join('')}</div>
  </div>`;
}

async function readNotif(id) {
  try {
    await Api.notifications.markRead(id);
    UI.success('تم تحديث التنبيه.');
    await refreshAll();
  } catch (e) {
    UI.error(e.message);
  }
}

async function confirmNotif(id) {
  try {
    await Api.notifications.confirmDose(id);
    UI.success('تم تأكيد الجرعة وخصم الكمية.');
    await refreshAll();
  } catch (e) {
    UI.error(e.message);
  }
}

async function missNotif(id) {
  try {
    await Api.notifications.missDose(id);
    UI.success('تم تسجيل الجرعة كفائتة.');
    await refreshAll();
  } catch (e) {
    UI.error(e.message);
  }
}
