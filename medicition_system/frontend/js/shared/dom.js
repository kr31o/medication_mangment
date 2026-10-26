/**
 * أدوات صغيرة لبناء الصفحة من JavaScript.
 *
 * أهمها html`…`: قالب نص يكتب HTML، وكل قيمة توضع داخله تُهرَّب تلقائيًا، فاسم دواء
 * أو ملاحظة كتبها مستخدم لا تصير HTML يُنفَّذ أبدًا. ما بُني بـ html نفسه (أو أيقونة)
 * يدخل كما هو. مثال:
 *
 *     render(list, html`<li class="semi">${order.pharmacy.name}</li>`);
 */

/** نص HTML موثوق: بُني بـ html`…` أو هو ثابت في الكود. */
class SafeHtml {
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** يحوّل النص إلى نص آمن داخل HTML. */
export function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

function piece(value) {
  if (value === null || value === undefined || value === false) return "";
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(piece).join("");
  return esc(value);
}

/** قالب HTML آمن: html`<b>${name}</b>`. القوائم تُجمع، و null و false لا تظهر. */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, index) => {
    out += piece(value) + strings[index + 1];
  });
  return new SafeHtml(out);
}

/** نص HTML ثابت من الكود نفسه (لا من بيانات المستخدم). */
export const raw = (text) => new SafeHtml(text);

/** يضع المحتوى داخل العنصر ويحذف ما كان فيه. */
export function render(element, content) {
  element.innerHTML = piece(content);
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** يجمع أسماء الأصناف ويتجاهل الفارغ: cx("btn", active && "is-active"). */
export const cx = (...names) => names.filter(Boolean).join(" ");

/**
 * ضغطات الأزرار داخل حاوية: كل زر عليه data-action="اسم" يستدعي الدالة بنفس الاسم.
 *
 *     onAction(list, { open: (button) => go(button.dataset.id) });
 *
 * الحاوية تبقى نفسها، فالأزرار التي تُرسم فيها لاحقًا تعمل أيضًا.
 */
export function onAction(root, handlers) {
  root.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target || !root.contains(target) || target.disabled) return;
    const handler = handlers[target.dataset.action];
    if (!handler) return;
    event.preventDefault();
    handler(target, event);
  });
}

/** يؤخر الدالة حتى يتوقف المستخدم عن الكتابة (لا طلب لكل حرف). */
export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** معرّف العنصر في آخر الرابط: /patient/orders/<id>. */
export function idFromPath() {
  return decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() ?? "");
}
