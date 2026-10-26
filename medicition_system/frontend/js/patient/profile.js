/** الملف الشخصي للمريض: إنشاء لأول مرة، ثم تعديل. الاسم يظهر للصيدلية عند الطلب. */

import { patients } from "../shared/api.js";
import { $, render } from "../shared/dom.js";
import { todayLocal } from "../shared/format.js";
import { startPage } from "../shared/layout.js";
import { fieldErrors } from "../shared/text.js";
import { errorState, loading, setBusy, showFieldErrors, toast } from "../shared/ui.js";

await startPage("PATIENT");

const form = $("#form");
const submit = $("button[type=submit]", form);
const FIELDS = ["full_name", "date_of_birth", "gender"];
let profile = null;

const current = () => Object.fromEntries(FIELDS.map((name) => [name, form.elements[name].value]));
const saved = () => ({ full_name: profile?.full_name ?? "", date_of_birth: profile?.date_of_birth ?? "", gender: profile?.gender ?? "" });

/** زر الحفظ يعمل فقط إن تغيّر شيء (عند التعديل). */
function refreshButton() {
  const values = current();
  submit.disabled = Boolean(profile) && FIELDS.every((name) => values[name] === saved()[name]);
}

/** فحص الحقول قبل الإرسال؛ يرجع { اسم_الحقل: رسالة }. */
function validate(values) {
  const errors = {};
  const name = values.full_name.trim();
  if (name.length < 2) errors.full_name = "الاسم قصير جدًا";
  else if (name.length > 120) errors.full_name = "الاسم طويل جدًا";
  if (values.date_of_birth && (values.date_of_birth < "1900-01-01" || values.date_of_birth > todayLocal())) errors.date_of_birth = "تاريخ غير منطقي";
  return errors;
}

function show() {
  Object.entries(saved()).forEach(([name, value]) => (form.elements[name].value = value));
  form.elements.date_of_birth.max = todayLocal();
  submit.textContent = profile ? "حفظ التغييرات" : "إنشاء الملف";
  $("#first-time").hidden = Boolean(profile);
  $("#card").style.marginTop = profile ? "0" : "16px";
  $("#card").hidden = false;
  refreshButton();
}

async function load() {
  render($("#state"), loading());
  try {
    profile = await patients.me();
  } catch (error) {
    render($("#state"), errorState(error, { retry: true }));
    $("[data-action=retry]")?.addEventListener("click", load);
    return;
  }
  render($("#state"), "");
  show();
}

form.addEventListener("input", (event) => {
  showFieldErrors(form, {});
  refreshButton();
  event.stopPropagation();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = current();
  const errors = validate(values);
  showFieldErrors(form, errors);
  if (Object.keys(errors).length) return;
  const body = { full_name: values.full_name.trim() };
  const created = !profile;
  if (profile) {
    // التعديل: الحقل الفارغ يُرسل null فيُمسح فعلًا، لا يُتجاهل.
    body.date_of_birth = values.date_of_birth || null;
    body.gender = values.gender || null;
  } else {
    if (values.date_of_birth) body.date_of_birth = values.date_of_birth;
    if (values.gender) body.gender = values.gender;
  }
  setBusy(submit, true);
  try {
    profile = await (created ? patients.create(body) : patients.update(body));
  } catch (error) {
    setBusy(submit, false);
    showFieldErrors(form, fieldErrors(error));
    toast.error(error);
    return;
  }
  setBusy(submit, false);
  if (created) {
    toast.later("أُنشئ ملفك. يمكنك الآن طلب الأدوية.");
    location.assign("/patient");
    return;
  }
  toast.success("حُفظت التغييرات");
  show();
});

load();
