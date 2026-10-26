/** تسجيل الدخول بالبريد أو رقم الهاتف وكلمة المرور. */

import { ApiError, auth, session } from "./shared/api.js";
import { $, html } from "./shared/dom.js";
import { FROM_KEY, homeFor, startAuthPage } from "./shared/layout.js";
import { errorMessage, identifierHint } from "./shared/text.js";
import { setAlert, setBusy, showFieldErrors } from "./shared/ui.js";

await startAuthPage({ signedInGoesHome: true });

const form = $("#form");
const identifier = $("#identifier");
const password = $("#password");
const submit = $("button[type=submit]", form);

function check() {
  const hint = identifierHint(identifier.value);
  showFieldErrors(form, { identifier: hint || undefined });
  submit.disabled = !identifier.value || !password.value || Boolean(hint);
}
identifier.addEventListener("input", check);
password.addEventListener("input", check);
check();

/** الحساب موقوف: كلمة المرور صحيحة لكن مدير النظام أوقفه، والخادم يرسل السبب لصاحبه. */
const suspended = (error) =>
  html`<strong>حسابك موقوف، ولا يمكنك الدخول الآن.</strong>
    ${error.details?.reason ? html`<span class="suspended-reason">السبب: ${error.details.reason}</span>` : ""}
    <span class="suspended-reason">للاستفسار تواصل مع إدارة المنصة.</span>`;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  setBusy(submit, true);
  setAlert($("#error"), "error", "");
  try {
    const tokens = await auth.login(identifier.value.trim(), password.value);
    session.set(tokens.access_token, tokens.refresh_token);
    const home = homeFor(session.principal().role);
    // من حاول فتح صفحة قبل الدخول يعود إليها، بشرط أنها من صفحات دوره.
    let from = null;
    try {
      from = sessionStorage.getItem(FROM_KEY);
      sessionStorage.removeItem(FROM_KEY);
    } catch {
      /* لا شيء */
    }
    location.replace(from && from.startsWith(home) ? from : home);
  } catch (error) {
    setBusy(submit, false);
    let message;
    if (error instanceof ApiError && error.code === "ACCOUNT_SUSPENDED") message = suspended(error);
    else if (error instanceof ApiError && error.code === "INVALID_CREDENTIALS") {
      // نفس الرسالة لكلمة مرور خاطئة ولحساب غير موجود: الخادم لا يميّز بينهما.
      message = "البريد أو رقم الهاتف أو كلمة المرور غير صحيحة.";
    } else message = errorMessage(error);
    setAlert($("#error"), "error", message);
    check();
  }
});
