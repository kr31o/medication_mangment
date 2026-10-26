/** إنشاء حساب مريض أو صيدلية بالبريد أو رقم الهاتف. */

import { auth, session } from "./shared/api.js";
import { $ } from "./shared/dom.js";
import { homeFor, startAuthPage } from "./shared/layout.js";
import { E164, errorMessage } from "./shared/text.js";
import { setAlert, setBusy, showFieldErrors, toast, wireSegmented } from "./shared/ui.js";

await startAuthPage();

/** أول صفحة بعد إنشاء الحساب: الملف الذي يجب إكماله قبل أي شيء آخر. */
const FIRST_PAGE = { PATIENT: "/patient/profile", PHARMACY: "/pharmacy/profile" };
const PHONE_FORMAT = "بالصيغة الدولية، مثل ‎+963944000000";

const form = $("#form");
const identifier = $("#identifier");
const password = $("#password");
const confirm = $("#confirm");
const submit = $("button[type=submit]", form);
let accountType = "PATIENT";
let channel = "email";

function check() {
  const phoneInvalid = channel === "phone" && identifier.value.length > 0 && !E164.test(identifier.value.trim());
  const mismatch = confirm.value.length > 0 && confirm.value !== password.value;
  showFieldErrors(form, {
    identifier: phoneInvalid ? PHONE_FORMAT : undefined,
    confirm: mismatch ? "كلمتا المرور غير متطابقتين" : undefined,
  });
  submit.disabled = !identifier.value || password.value.length < 8 || password.value !== confirm.value || phoneInvalid;
}

wireSegmented($("#account-type"), (value) => (accountType = value));
wireSegmented($("#channel"), (value) => {
  channel = value;
  const email = value === "email";
  $("#identifier-label").textContent = email ? "البريد الإلكتروني" : "رقم الهاتف";
  identifier.type = email ? "email" : "tel";
  identifier.placeholder = email ? "name@example.com" : "+963944000000";
  identifier.autocomplete = email ? "email" : "tel";
  identifier.value = "";
  $("#identifier-hint").dataset.hint = email ? "" : PHONE_FORMAT;
  check();
  identifier.focus();
});
[identifier, password, confirm].forEach((input) => input.addEventListener("input", check));
check();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  setBusy(submit, true);
  setAlert($("#error"), "error", "");
  const value = identifier.value.trim();
  try {
    await auth.register({ account_type: accountType, [channel]: value, password: password.value });
  } catch (error) {
    setBusy(submit, false);
    check();
    setAlert($("#error"), "error", errorMessage(error));
    return;
  }
  // الحساب يعمل من لحظة إنشائه، فندخل به مباشرة ونفتح الملف الذي يجب إكماله.
  try {
    const tokens = await auth.login(value, password.value);
    session.set(tokens.access_token, tokens.refresh_token);
    const role = session.principal().role;
    toast.later(accountType === "PHARMACY" ? "أُنشئ حسابك. أدخل بيانات صيدليتك الآن." : "أُنشئ حسابك. أكمل ملفك الشخصي لتبدأ.");
    location.replace(FIRST_PAGE[role] ?? homeFor(role));
  } catch {
    toast.later("أُنشئ حسابك. سجّل الدخول الآن.");
    location.replace("/login");
  }
});
