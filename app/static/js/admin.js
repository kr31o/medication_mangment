if (!Auth.require('admin')) throw new Error('يلزم تسجيل الدخول بحساب إدارة.');

const $ = id => document.getElementById(id);
const state = { patients: [], meds: [], categories: [], patientPage:1, medPage:1, editingMed:null };

$('admin-user').textContent = Auth.user().email || 'مدير';
window.addEventListener('DOMContentLoaded', initAdmin);

async function initAdmin() {
  await loadCategories();
  await loadOverview();
}

function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  $(`page-${page}`).classList.add('active');
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.querySelector('.sidebar')?.classList.remove('open');
  if (page === 'overview') loadOverview();
  if (page === 'patients') loadPatients(1);
  if (page === 'meds') loadMeds(1);
  if (page === 'warning') loadWarningPatients();
}

async function loadCategories() {
  const r = await Api.admin.categories();
  state.categories = r.data || [];
  $('med-category').innerHTML = state.categories.map(c => `<option value="${UI.h(c)}">${UI.h(c)}</option>`).join('');
}

async function loadOverview() {
  const r = await Api.admin.stats();
  const s = r.data;
  $('s-patients').textContent = s.total_patients;
  $('s-active-patients').textContent = s.active_patients;
  $('s-meds').textContent = s.total_medications;
  $('s-stock').textContent = s.total_patient_stock;
}

let pt = null;
function searchPatients() {
  clearTimeout(pt);
  pt = setTimeout(() => loadPatients(1), 300);
}

async function loadPatients(page = 1) {
  state.patientPage = page;
  const r = await Api.admin.patients({page, per_page:20, q:$('patient-q').value.trim()});
  state.patients = r.data.items || [];
  $('patients-table').innerHTML = state.patients.length ? `<div class="table-wrap"><table><thead><tr><th>الاسم</th><th>البريد</th><th>الهاتف</th><th>الحالة</th><th>الأزرار</th></tr></thead><tbody>${state.patients.map(p => `<tr><td>${UI.h(p.full_name)}</td><td>${UI.h(p.email)}</td><td>${UI.h(p.phone || '—')}</td><td>${UI.badge(p.status)}</td><td><div class="actions"><button class="btn sm secondary" onclick="viewPatient(${p.patient_id})">عرض</button><button class="btn sm secondary" onclick="openPatient(${p.patient_id})">تعديل</button>${p.status === 'active' ? `<button class="btn sm danger" onclick="deactivatePatient(${p.patient_id})">تعطيل</button>` : `<button class="btn sm success" onclick="activatePatient(${p.patient_id})">تفعيل</button>`}<button class="btn sm primary" onclick="warningFor(${p.patient_id})">تحذير</button></div></td></tr>`).join('')}</tbody></table></div>` : UI.empty('👥', 'لا يوجد مرضى', '');
  UI.pagination($('patients-pages'), r.data, 'loadPatients');
}

async function viewPatient(id) {
  const [p, m] = await Promise.all([Api.admin.getPatient(id), Api.admin.patientMedications(id)]);
  const patient = p.data;
  $('detail-name').textContent = patient.full_name;
  $('detail-email').textContent = patient.email;
  $('detail-actions').innerHTML = `<button class="btn secondary" onclick="showPage('patients')">رجوع</button><button class="btn primary" onclick="warningFor(${id})">تحذير</button>`;
  $('detail-info').innerHTML = `<p>الهاتف: <b>${UI.h(patient.phone || '—')}</b></p><p>الحالة: ${UI.badge(patient.status)}</p><p>تاريخ التسجيل: ${UI.formatDate(patient.created_at)}</p>`;
  $('detail-meds').innerHTML = (m.data || []).map(x => `<div class="row"><div><div class="row-title">${UI.h(x.medication_name)}</div><div class="row-sub">${UI.h(x.medication_category)} · ${UI.h(x.medication_strength)} · الكمية ${x.current_quantity}</div><div class="row-sub">${adminSchedule(x.active_schedule)}</div></div>${UI.badge(x.status)}</div>`).join('') || UI.empty('💊', 'لا توجد أدوية', '');
  showPage('detail');
}

function adminSchedule(s) {
  if (!s) return 'لا يوجد جدول';
  return (s.dose_periods || []).map(p => `${UI.period(p.dose_period)} ${UI.formatTime(p.dose_time)} - ${p.dose_amount} ${UI.h(p.dose_unit)}`).join('، ');
}

function openPatient(id) {
  const p = state.patients.find(x => x.patient_id === id);
  if (!p) return;
  $('patient-id').value = id;
  $('patient-name').value = p.full_name;
  $('patient-phone').value = p.phone || '';
  UI.clearError('patient-error');
  UI.open('modal-patient');
}

async function savePatient() {
  const b = $('btn-save-patient');
  UI.loading(b, true);
  try {
    await Api.admin.updatePatient(Number($('patient-id').value), {full_name:$('patient-name').value.trim(), phone:$('patient-phone').value.trim() || null});
    UI.success('تم تعديل المريض.');
    UI.close('modal-patient');
    await loadPatients(state.patientPage);
  } catch (e) {
    UI.showError('patient-error', e);
  } finally {
    UI.loading(b, false);
  }
}

async function deactivatePatient(id) {
  if (!confirm('تعطيل حساب المريض؟')) return;
  try {
    await Api.admin.deactivatePatient(id);
    UI.success('تم تعطيل المريض.');
    await loadPatients(state.patientPage);
  } catch (e) {
    UI.error(e.message);
  }
}

async function activatePatient(id) {
  try {
    await Api.admin.activatePatient(id);
    UI.success('تم تفعيل المريض.');
    await loadPatients(state.patientPage);
  } catch (e) {
    UI.error(e.message);
  }
}

let mt = null;
function searchMeds() {
  clearTimeout(mt);
  mt = setTimeout(() => loadMeds(1), 300);
}

async function loadMeds(page = 1) {
  state.medPage = page;
  const r = await Api.admin.medications({page, per_page:20, q:$('med-q').value.trim()});
  state.meds = r.data.items || [];
  $('meds-table').innerHTML = state.meds.length ? `<div class="table-wrap"><table><thead><tr><th>الدواء</th><th>التصنيف</th><th>التركيز</th><th>الحالة</th><th>الأزرار</th></tr></thead><tbody>${state.meds.map(m => `<tr><td>${UI.h(m.name)}</td><td>${UI.h(m.category)}</td><td>${UI.h(m.strength)}</td><td>${UI.badge(m.is_active ? 'active' : 'inactive')}</td><td><div class="actions"><button class="btn sm secondary" onclick="openMedModal(${m.medication_id})">تعديل</button>${m.is_active ? `<button class="btn sm danger" onclick="deleteMedication(${m.medication_id})">حذف</button>` : `<button class="btn sm success" onclick="restoreMedication(${m.medication_id})">استعادة</button>`}</div></td></tr>`).join('')}</tbody></table></div>` : UI.empty('💊', 'لا توجد أدوية', '');
  UI.pagination($('meds-pages'), r.data, 'loadMeds');
}

function openMedModal(id = null) {
  state.editingMed = id;
  const m = id ? state.meds.find(x => x.medication_id === id) : null;
  $('med-modal-title').textContent = id ? 'تعديل دواء' : 'إضافة دواء';
  $('med-id').value = id || '';
  $('med-name').value = m?.name || '';
  $('med-category').value = m?.category || state.categories[0] || 'أخرى';
  $('med-form').value = m?.form || 'tablet';
  $('med-strength').value = m?.strength || '';
  $('med-active').value = String(m?.is_active ?? true);
  $('med-description').value = m?.description || '';
  UI.clearError('med-error');
  UI.open('modal-med');
}

async function saveMedication() {
  const b = $('btn-save-med');
  UI.loading(b, true);
  UI.clearError('med-error');
  try {
    const payload = {
      name: $('med-name').value.trim(),
      category: $('med-category').value,
      form: $('med-form').value,
      strength: $('med-strength').value.trim(),
      description: $('med-description').value.trim() || null,
      is_active: $('med-active').value === 'true'
    };
    if (state.editingMed) await Api.admin.updateMedication(state.editingMed, payload);
    else await Api.admin.addMedication(payload);
    UI.success('تم حفظ الدواء.');
    UI.close('modal-med');
    await loadOverview();
    await loadMeds(state.medPage);
  } catch (e) {
    UI.showError('med-error', e);
  } finally {
    UI.loading(b, false);
  }
}

async function deleteMedication(id) {
  if (!confirm('حذف الدواء من كتالوج المرضى؟ ستبقى سجلات المرضى القديمة محفوظة.')) return;
  try {
    await Api.admin.deleteMedication(id);
    UI.success('تم حذف الدواء من الكتالوج.');
    await loadMeds(state.medPage);
  } catch (e) {
    UI.error(e.message);
  }
}

async function restoreMedication(id) {
  try {
    await Api.admin.activateMedication(id);
    UI.success('تمت استعادة الدواء.');
    await loadMeds(state.medPage);
  } catch (e) {
    UI.error(e.message);
  }
}

async function loadWarningPatients() {
  const r = await Api.admin.patients({page:1, per_page:500});
  $('warning-patient').innerHTML = '<option value="">اختر المريض</option>' + (r.data.items || []).map(p => `<option value="${p.patient_id}">${UI.h(p.full_name)} - ${UI.h(p.email)}</option>`).join('');
}

function warningFor(id) {
  showPage('warning');
  setTimeout(() => $('warning-patient').value = String(id), 100);
}

async function sendWarning() {
  const b = $('btn-warning');
  UI.loading(b, true);
  UI.clearError('warning-error');
  $('warning-success').innerHTML = '';
  try {
    await Api.admin.sendWarning({patient_id:Number($('warning-patient').value), title:$('warning-title').value.trim(), message:$('warning-message').value.trim()});
    $('warning-success').innerHTML = '<div class="alert success">تم إرسال التحذير بنجاح.</div>';
    $('warning-title').value = '';
    $('warning-message').value = '';
  } catch (e) {
    UI.showError('warning-error', e);
  } finally {
    UI.loading(b, false);
  }
}
