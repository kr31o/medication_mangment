/**
 * قطع الواجهة المشتركة: أزرار وشارات وتنبيهات، حالات التحميل والفراغ والخطأ، حقول النماذج،
 * التبويبات والترقيم، الرسائل القصيرة (toast)، والنوافذ. شكلها كله في css/components.css.
 *
 * الدوال التي تبني HTML ترجع html`…` آمنًا يوضع داخل صفحة بـ render().
 */

import { $, $$, cx, esc, html, raw, render } from "./dom.js";
import { icon } from "./icons.js";
import { errorMessage } from "./text.js";

// ----------------------------------------------------------------------------- أزرار وشارات

/**
 * زر. variant: primary | soft | outline | ghost | quiet | danger | danger-outline | light.
 * href يجعله رابطًا بنفس الشكل. action يضع data-action (انظر onAction في dom.js).
 */
export function button(label, { variant = "ghost", size, block, icon: name, href, action, data = {}, disabled, title, type = "button", className } = {}) {
  const classes = cx("btn", `btn--${variant}`, size && `btn--${size}`, block && "btn--block", className);
  const attrs = [
    action ? raw(` data-action="${esc(action)}"`) : "",
    ...Object.entries(data).map(([key, value]) => raw(` data-${key}="${esc(value)}"`)),
    title ? raw(` title="${esc(title)}"`) : "",
  ];
  const content = html`${name ? icon(name, size === "sm" ? 16 : 18) : ""}${label}`;
  if (href) return html`<a class="${classes}" href="${href}"${attrs}>${content}</a>`;
  return html`<button type="${type}" class="${classes}"${attrs}${disabled ? raw(" disabled") : ""}>${content}</button>`;
}

/** زر أيقونة بلا نص (الاسم يظهر عند الوقوف عليه ولقارئ الشاشة). */
export function iconButton(name, label, { action, data = {}, danger, disabled, size = 18, className } = {}) {
  const attrs = Object.entries(data).map(([key, value]) => raw(` data-${key}="${esc(value)}"`));
  return html`<button type="button" class="${cx("icon-btn", danger && "icon-btn--danger", className)}" aria-label="${label}" title="${label}"${
    action ? raw(` data-action="${esc(action)}"`) : ""
  }${attrs}${disabled ? raw(" disabled") : ""}>${icon(name, size)}</button>`;
}

/** زر مشغول: دائرة تدور مكان الأيقونة، ولا يُضغط حتى ينتهي العمل. */
export function setBusy(buttonElement, busy) {
  if (!buttonElement) return;
  buttonElement.disabled = busy;
  buttonElement.classList.toggle("is-busy", busy);
  const spinner = $(".btn__spinner", buttonElement);
  if (busy && !spinner) buttonElement.insertAdjacentHTML("afterbegin", '<span class="btn__spinner" aria-hidden="true"></span>');
  if (!busy) spinner?.remove();
}

/** مفتاح تشغيل/إيقاف (في الجداول). يُرسل الضغط كـ data-action مثل الأزرار. */
export function switchControl({ checked, label, action, data = {}, disabled }) {
  const attrs = Object.entries(data).map(([key, value]) => raw(` data-${key}="${esc(value)}"`));
  return html`<label class="switch"><input type="checkbox" role="switch" aria-label="${label}"${checked ? raw(" checked") : ""}${
    disabled ? raw(" disabled") : ""
  }${action ? raw(` data-switch="${esc(action)}"`) : ""}${attrs}><span class="switch__track"></span></label>`;
}

/** تغيير المفاتيح داخل حاوية: كل مفتاح عليه data-switch="اسم" يستدعي الدالة بنفس الاسم. */
export function onSwitch(root, handlers) {
  root.addEventListener("change", (event) => {
    const input = event.target.closest("[data-switch]");
    if (input && root.contains(input)) handlers[input.dataset.switch]?.(input);
  });
}

/**
 * أزرار اختيار متجاورة مكتوبة في HTML: <div class="segmented"><button data-value="…">.
 * onChange(value) عند تغيير الاختيار.
 */
export function wireSegmented(group, onChange) {
  $$(".segmented__item", group).forEach((item) =>
    item.addEventListener("click", () => {
      if (item.classList.contains("is-active")) return;
      $$(".segmented__item", group).forEach((other) => {
        other.classList.toggle("is-active", other === item);
        other.setAttribute("aria-pressed", String(other === item));
      });
      onChange(item.dataset.value);
    }),
  );
}

/** زر العين بجانب كل حقل كلمة مرور (data-action="toggle-password") يُظهرها ويخفيها. */
export function wirePasswordToggles(root = document) {
  $$("[data-action=toggle-password]", root).forEach((toggle) =>
    toggle.addEventListener("click", () => {
      const input = $("input", toggle.closest(".field__control"));
      const shown = input.type === "password";
      input.type = shown ? "text" : "password";
      toggle.setAttribute("aria-pressed", String(shown));
      toggle.setAttribute("aria-label", shown ? "إخفاء" : "إظهار");
      toggle.title = shown ? "إخفاء" : "إظهار";
      render(toggle, icon(shown ? "eye_off" : "eye"));
    }),
  );
}

/** شارة. tone: neutral | amber | blue | green | coral | violet | primary. */
export const badge = (tone, text, plain = false) => html`<span class="${cx("badge", `badge--${tone ?? "neutral"}`, plain && "badge--plain")}">${text}</span>`;

const ALERT_ICONS = { info: "info", success: "check", warning: "triangle_alert", error: "circle_alert", note: "info" };

/** تنبيه داخل الصفحة. tone: info | success | warning | error | note. action: زر بجانبه. */
export function alertBox(tone, body, { action, className } = {}) {
  return html`<div class="${cx("alert", `alert--${tone}`, className)}" role="${tone === "error" ? "alert" : "status"}">
    <span class="alert__icon">${icon(ALERT_ICONS[tone])}</span>
    <div class="alert__body">${body}</div>
    ${action ? html`<div class="alert__action">${action}</div>` : ""}
  </div>`;
}

/** يضع تنبيهًا في مكانه من الصفحة (عنصر مخفي حتى يُستعمل)، أو يخفيه إن لم تكن رسالة. */
export function setAlert(box, tone, message) {
  box.hidden = !message;
  render(box, message ? alertBox(tone, message) : "");
}

// ----------------------------------------------------------------------------- التحميل والفراغ والخطأ

export const loading = (label = "جارٍ التحميل…") =>
  html`<div class="loading" role="status"><span class="capsule-loader" aria-hidden="true"></span><span>${label}</span></div>`;

export function emptyState({ icon: name = "inbox", title, hint, action } = {}) {
  return html`<div class="empty">
    <span class="empty__icon">${icon(name, 30)}</span>
    <p class="empty__title">${title}</p>
    ${hint ? html`<p class="small">${hint}</p>` : ""}
    ${action ?? ""}
  </div>`;
}

/** رسالة خطأ بالعربية. retry: يضع زر «إعادة المحاولة» بـ data-action="retry". */
export function errorState(error, { retry = false } = {}) {
  return alertBox("error", errorMessage(error), { action: retry ? button("إعادة المحاولة", { size: "sm", action: "retry" }) : null });
}

// ----------------------------------------------------------------------------- أرقام

/** بطاقة رقم. tone: green (الافتراضي) | amber | blue | coral | violet | neutral. */
export function statCard({ label, value, tone, icon: name, suffix = "" }) {
  const shown = value === null || value === undefined ? "—" : `${value}${typeof value === "number" ? suffix : ""}`;
  return html`<div class="${cx("stat", tone && `stat--${tone}`)}">
    ${name ? html`<span class="stat__icon">${icon(name, 22)}</span>` : ""}
    <div class="stat__text"><div class="stat__value">${shown}</div><div class="stat__label">${label}</div></div>
  </div>`;
}

/** شريط نسبة مئوية (0–100). */
export function meter(value, { tone, small, label } = {}) {
  const width = Math.max(0, Math.min(100, value));
  return html`<div class="${cx("meter", tone && `meter--${tone}`, small && "meter--sm")}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(value)}" aria-label="${label ?? ""}">
    <div class="meter__fill" style="--value: ${width}%"></div>
  </div>`;
}

// ----------------------------------------------------------------------------- تبويبات وترقيم

/** tabs: [{ label, count, countTone }]. onChange(index) عند الضغط. */
export function renderTabs(container, tabs, value, onChange) {
  render(
    container,
    html`<div class="tabs" role="tablist">${tabs.map(
      (tab, index) => html`<button type="button" role="tab" aria-selected="${index === value}" class="${cx("tab", index === value && "is-active")}" data-tab="${index}">
        ${tab.label}${tab.count ? html`<span class="${cx("tab__count", tab.countTone && `tab__count--${tab.countTone}`)}">${tab.count}</span>` : ""}
      </button>`,
    )}</div>`,
  );
  $$("[data-tab]", container).forEach((el) => el.addEventListener("click", () => onChange(Number(el.dataset.tab))));
}

/** ترقيم الصفحات (page يبدأ من 1). يختفي إن كانت النتائج صفحة واحدة. */
export function renderPager(container, { page, pageSize, total, bare = false }, onChange) {
  if (total <= pageSize) {
    render(container, "");
    return;
  }
  const pages = Math.ceil(total / pageSize);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  render(
    container,
    html`<div class="${cx("pager", bare && "pager--bare")}">
      <span class="num">${from}–${to} من ${total}</span>
      <div class="pager__nav">
        ${iconButton("chevron_right", "الصفحة السابقة", { action: "prev", disabled: page <= 1, size: 20 })}
        <span class="num">صفحة ${page} من ${pages}</span>
        ${iconButton("chevron_left", "الصفحة التالية", { action: "next", disabled: page >= pages, size: 20 })}
      </div>
    </div>`,
  );
  $("[data-action=prev]", container).addEventListener("click", () => onChange(page - 1));
  $("[data-action=next]", container).addEventListener("click", () => onChange(page + 1));
}

// ----------------------------------------------------------------------------- حقول النماذج

let fieldCount = 0;

/**
 * حقل بعنوان فوقه، يُرسم داخل النوافذ. name اسمه في النموذج (form.elements[name]).
 * الخيارات: type, value, hint, required, dir, placeholder, multiline, min, max, step, maxLength, icon, disabled.
 */
export function field(label, name, { type = "text", value = "", hint, required, dir, placeholder, multiline, min, max, step, maxLength, icon: name2, disabled, className } = {}) {
  const id = `f${++fieldCount}`;
  const attrs = [
    dir && raw(` dir="${dir}"`),
    placeholder && raw(` placeholder="${esc(placeholder)}"`),
    min !== undefined && raw(` min="${min}"`),
    max !== undefined && raw(` max="${max}"`),
    step !== undefined && raw(` step="${step}"`),
    maxLength && raw(` maxlength="${maxLength}"`),
    required && raw(" required"),
    disabled && raw(" disabled"),
  ];
  const control = multiline
    ? html`<textarea id="${id}" name="${name}" class="input" rows="2" aria-describedby="${id}-hint"${attrs}>${value}</textarea>`
    : html`<input id="${id}" name="${name}" type="${type}" class="input" value="${value}" aria-describedby="${id}-hint"${attrs}>`;
  return html`<div class="${cx("field", className)}" data-field="${name}">
    <label class="field__label" for="${id}">${label}${required ? html`<span class="field__req" aria-hidden="true">*</span>` : ""}</label>
    <div class="${cx("field__control", name2 && "field__control--icon")}">${name2 ? html`<span class="field__icon">${icon(name2)}</span>` : ""}${control}</div>
    <span class="field__hint" id="${id}-hint" data-hint="${hint ?? ""}">${hint ?? ""}</span>
  </div>`;
}

/** قائمة منسدلة. options: [{ value, label }] أو مجموعات [{ group, options }]. */
export function selectField(label, name, options, { value = "", hint, required, size } = {}) {
  const id = `f${++fieldCount}`;
  const item = (option) => html`<option value="${option.value}"${String(option.value) === String(value) ? raw(" selected") : ""}>${option.label}</option>`;
  return html`<div class="field" data-field="${name}">
    ${label ? html`<label class="field__label" for="${id}">${label}${required ? html`<span class="field__req" aria-hidden="true">*</span>` : ""}</label>` : ""}
    <select id="${id}" name="${name}" class="${cx("input", size === "sm" && "input--sm")}"${required ? raw(" required") : ""}${label ? "" : raw(` aria-label="${esc(name)}"`)}>
      ${options.map((option) => (option.options ? html`<optgroup label="${option.group}">${option.options.map(item)}</optgroup>` : item(option)))}
    </select>
    <span class="field__hint" data-hint="${hint ?? ""}">${hint ?? ""}</span>
  </div>`;
}

/**
 * يعرض أخطاء الحقول تحت كل حقل: { اسم_الحقل: رسالة }. الحقل بلا خطأ يعود لتلميحه الأصلي.
 * يعمل مع حقول field() ومع الحقول المكتوبة في صفحات HTML (data-field).
 */
export function showFieldErrors(root, errors = {}) {
  $$("[data-field]", root).forEach((box) => {
    const message = errors[box.dataset.field];
    const hint = $(".field__hint", box);
    box.classList.toggle("has-error", Boolean(message));
    $("input, select, textarea", box)?.toggleAttribute("aria-invalid", Boolean(message));
    if (hint) hint.textContent = message ?? hint.dataset.hint ?? "";
  });
}

/**
 * حقل عدد صحيح بزرّي − و +. القيمة تُضبط ضمن الحدود عند مغادرة الحقل
 * (من يمسح "1" ويكتب "5" يحصل على 5). onChange(n) عند كل تغيير صالح.
 */
export function stepper(container, { label, value, min, max, onChange }) {
  const id = `f${++fieldCount}`;
  render(
    container,
    html`<div class="field">
      <label class="field__label" for="${id}">${label}</label>
      <div class="stepper">
        <button type="button" aria-label="إنقاص" data-step="-1">${icon("minus", 16)}</button>
        <input id="${id}" type="number" inputmode="numeric" min="${min}" max="${max}" step="1" value="${value}">
        <button type="button" aria-label="زيادة" data-step="1">${icon("plus", 16)}</button>
      </div>
    </div>`,
  );
  const input = $("input", container);
  let current = value;
  const clamp = (n) => Math.max(min, Math.min(max, n));
  const sync = () => {
    $("[data-step='-1']", container).disabled = current <= min;
    $("[data-step='1']", container).disabled = current >= max;
  };
  const set = (n) => {
    if (n === current) return;
    current = n;
    input.value = String(n);
    sync();
    onChange(n);
  };
  $$("[data-step]", container).forEach((el) => el.addEventListener("click", () => set(clamp(current + Number(el.dataset.step)))));
  input.addEventListener("input", () => {
    const n = Number(input.value);
    if (input.value !== "" && Number.isInteger(n) && n >= min && n <= max && n !== current) {
      current = n;
      sync();
      onChange(n);
    }
  });
  input.addEventListener("blur", () => {
    const n = Number(input.value);
    const next = input.value === "" || !Number.isFinite(n) ? current : clamp(Math.trunc(n));
    input.value = String(next);
    set(next);
  });
  sync();
  return { get value() { return current; } };
}

// ----------------------------------------------------------------------------- رسائل قصيرة

const TOAST_ICONS = { success: "check", info: "info", error: "circle_alert" };
const FLASH_KEY = "medplat.flash";

function showToast(message, tone) {
  let box = $(".toasts");
  if (!box) {
    box = document.createElement("div");
    box.className = "toasts";
    box.setAttribute("aria-live", "polite");
    document.body.append(box);
  }
  // ثلاث رسائل على الأكثر؛ الأقدم تخرج أولًا.
  while (box.children.length >= 3) box.firstElementChild.remove();
  const item = document.createElement("div");
  item.className = `toast toast--${tone}`;
  item.setAttribute("role", tone === "error" ? "alert" : "status");
  render(item, html`${icon(TOAST_ICONS[tone])}<span>${message}</span><button type="button" class="toast__close" aria-label="إغلاق">${icon("x", 14)}</button>`);
  $(".toast__close", item).addEventListener("click", () => item.remove());
  box.append(item);
  setTimeout(() => item.remove(), tone === "error" ? 6000 : 3500);
}

/** رسالة قصيرة أسفل الشاشة. error يقبل نصًا أو خطأ من الـ API (يُترجم للعربية). */
export const toast = {
  success: (message) => showToast(message, "success"),
  info: (message) => showToast(message, "info"),
  error: (error) => showToast(typeof error === "string" ? error : errorMessage(error), "error"),
  /** رسالة تظهر في الصفحة التالية (بعد الانتقال إليها). */
  later(message, tone = "success") {
    try {
      sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message, tone }));
    } catch {
      /* بلا تخزين: لا رسالة */
    }
  },
};

/** يعرض رسالة toast.later() إن وُجدت. تستدعيها كل صفحة عند فتحها. */
export function showFlash() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(FLASH_KEY) ?? "null");
    sessionStorage.removeItem(FLASH_KEY);
    if (saved) showToast(saved.message, saved.tone);
  } catch {
    /* لا شيء */
  }
}

// ----------------------------------------------------------------------------- نوافذ

/**
 * نافذة منبثقة. body و footer: html`…`. size: sm | md | lg. kind: "modal" أو "drawer" (لوحة جانبية).
 * تُغلق بـ Esc وبالضغط خارجها وبزر ×، ويبقى Tab داخلها. يرجع { root, close }.
 */
export function openModal({ title, body, footer, size, kind = "modal", onClose }) {
  const previous = document.activeElement;
  const overflow = document.body.style.overflow;
  const titleId = `t${++fieldCount}`;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const shell =
    kind === "drawer"
      ? html`<aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1">
          <div class="modal__head"><h2 id="${titleId}">${title}</h2>${iconButton("x", "إغلاق", { action: "close", size: 20 })}</div>
          <div class="drawer__body">${body}</div>
        </aside>`
      : html`<div class="${cx("modal", size && `modal--${size}`)}" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1">
          <div class="modal__head"><h2 id="${titleId}">${title}</h2>${iconButton("x", "إغلاق", { action: "close", size: 20 })}</div>
          <div class="modal__body">${body}</div>
          ${footer ? html`<div class="modal__foot">${footer}</div>` : ""}
        </div>`;
  render(backdrop, shell);
  document.body.append(backdrop);
  document.body.style.overflow = "hidden";
  const dialog = backdrop.firstElementChild;

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
    document.body.style.overflow = overflow;
    previous?.focus?.({ preventScroll: true });
    onClose?.();
  };
  const onKey = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      const items = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', dialog).filter(
        (el) => !el.disabled && el.offsetParent !== null,
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener("keydown", onKey);
  backdrop.addEventListener("mousedown", (event) => event.target === backdrop && close());
  $("[data-action=close]", dialog).addEventListener("click", close);
  ($("input, select, textarea", dialog) ?? dialog).focus({ preventScroll: true });
  return { root: dialog, close };
}

/**
 * نافذة تأكيد قبل أي إجراء مهم. reason: { label, required } يضيف حقل سبب (3 أحرف على
 * الأقل إن كان مطلوبًا). onConfirm(reason) يُنفَّذ والزر مشغول؛ إن نجح تُغلق النافذة، وإن
 * فشل تبقى ويظهر الخطأ.
 */
export function confirmDialog({ title, message, confirmLabel, danger, reason, onConfirm }) {
  const body = html`<div class="stack">
    ${message ? html`<p class="soft">${message}</p>` : ""}
    ${reason ? field(reason.label, "reason", { multiline: true, required: reason.required, hint: reason.required ? "3 أحرف على الأقل" : "اختياري", maxLength: 500 }) : ""}
  </div>`;
  const footer = html`${button("تراجع", { variant: "quiet", action: "close" })}${button(confirmLabel, { variant: danger ? "danger" : "primary", action: "confirm" })}`;
  const modal = openModal({ title, body, footer, size: "sm" });
  const ok = $("[data-action=confirm]", modal.root);
  const text = $("textarea", modal.root);
  const valid = () => !reason?.required || (text?.value.trim().length ?? 0) >= 3;
  ok.disabled = !valid();
  text?.addEventListener("input", () => (ok.disabled = !valid()));
  $(".modal__foot [data-action=close]", modal.root).addEventListener("click", modal.close);
  ok.addEventListener("click", async () => {
    setBusy(ok, true);
    try {
      await onConfirm(text?.value.trim() ?? "");
      modal.close();
    } catch (error) {
      setBusy(ok, false);
      ok.disabled = !valid();
      toast.error(error);
    }
  });
  return modal;
}
