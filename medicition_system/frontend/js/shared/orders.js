/**
 * عرض الطلبات والحالات: شارة الحالة، مسار الطلب (كبسولة تمتلئ)، جدول الأصناف، وسجل تغيّر الحالة.
 * [قرار المستخدم] وطلب الوصفة: مساره الأطول، طريقة الاستعمال تحت كل صنف، وما ليس عند الصيدلية.
 */

import { cx, html } from "./dom.js";
import { count, formatClock, formatDateTime, formatMoney } from "./format.js";
import { icon } from "./icons.js";
import { dosageForm, orderStatus, orderStatusTone, pharmacyStatus, pharmacyStatusTone, roleLabel, weekdays } from "./text.js";
import { alertBox, badge, button } from "./ui.js";

export const orderStatusBadge = (status) => badge(orderStatusTone[status], orderStatus[status] ?? status);
export const pharmacyStatusBadge = (status) => badge(pharmacyStatusTone[status], pharmacyStatus[status] ?? status);
export const isPrescription = (order) => order.kind === "PRESCRIPTION";
/** شارة «وصفة» بجانب طلب الوصفة في القوائم. */
export const prescriptionBadge = (order) => (isPrescription(order) ? badge("violet", "وصفة", true) : "");

// المسار الطبيعي للطلب: ينتظر الصيدلية، ثم تقبله فيُصرف. الرفض والإلغاء يقطعانه.
const FLOW = [
  { status: "PENDING", icon: "hourglass", label: orderStatus.PENDING },
  { status: "DISPENSED", icon: "hand_coins", label: orderStatus.DISPENSED },
];
// [قرار المستخدم] طلب الوصفة: الصيدلي يقرؤها ويختار أدويتها، ثم يوافق المريض على العرض، ثم الصرف.
const PRESCRIPTION_FLOW = [
  { status: "IN_REVIEW", icon: "scroll_text", label: "مراجعة الوصفة" },
  { status: "QUOTED", icon: "clipboard_check", label: "موافقة المريض" },
  { status: "PENDING", icon: "hourglass", label: "بانتظار الصرف" },
  { status: "DISPENSED", icon: "hand_coins", label: orderStatus.DISPENSED },
];

/** لماذا انتهى الطلب قبل الصرف، بجملة. */
function endedText(order) {
  const last = (order.history ?? []).at(-1);
  const what = isPrescription(order) ? "الوصفة" : "الطلب";
  if (order.status === "REJECTED") return `رفضت الصيدلية ${what}${order.status_reason ? ` — ${order.status_reason}` : ""}`;
  if (last?.from_status === "QUOTED") return `رُفض عرض الصيدلية وأُلغيت ${what}`;
  return `${isPrescription(order) ? "أُلغيت الوصفة" : "أُلغي الطلب"}${order.status_reason ? ` — ${order.status_reason}` : ""}`;
}

/** مسار الطلب: محطات على شريط بشكل كبسولة يمتلئ حتى المحطة الحالية. */
export function orderTrack(order) {
  const FLOW_ = isPrescription(order) ? PRESCRIPTION_FLOW : FLOW;
  const ended = order.status === "REJECTED" || order.status === "CANCELLED";
  const reached = new Set((order.history ?? []).map((h) => h.to_status));
  const index = FLOW_.findIndex((stop) => stop.status === order.status);
  // عدد المحطات المنجزة: للطلب المنتهي بالرفض/الإلغاء نعدّ ما وصل إليه قبل ذلك.
  const done = ended ? FLOW_.filter((stop) => reached.has(stop.status)).length : index + (order.status === "DISPENSED" ? 1 : 0);
  const fill = (Math.max(0, Math.min(done, FLOW_.length - 1) - (ended ? 1 : 0)) / (FLOW_.length - 1)) * 100;
  return html`<div>
    <div class="${cx("track", ended && "is-ended")}" style="--stops: ${FLOW_.length}">
      <div class="track__rail"><div class="track__fill" style="--value: ${fill}%"></div></div>
      <ol class="track__stops">
        ${FLOW_.map((stop, i) => {
          const isDone = i < done;
          const isCurrent = !ended && i === done;
          return html`<li class="${cx("track__stop", isDone && "is-done", isCurrent && "is-current")}"${isCurrent ? html` aria-current="step"` : ""}>
            <span class="track__dot">${icon(isDone ? "check" : stop.icon)}</span>
            <span class="track__label">${stop.label}</span>
          </li>`;
        })}
      </ol>
    </div>
    ${ended
      ? alertBox(order.status === "REJECTED" ? "error" : "warning", endedText(order), { className: "track__ended" })
      : ""}
  </div>`;
}

/** [قرار المستخدم] طريقة الاستعمال بجملة: «يوميًا · 08:00 (قرص واحد)، 20:00 (قرص واحد) · لمدة 5 أيام · بعد الأكل». */
export function dosePlanText(plan, unit) {
  const days =
    plan.days_of_week.length === 7
      ? "يوميًا"
      : weekdays
          .filter((d) => plan.days_of_week.includes(d.value))
          .map((d) => d.label)
          .join("، ");
  const times = plan.times.map((t) => `${formatClock(t.time)} (${count(t.dose_amount, unit)})`).join("، ");
  return [days, times, plan.duration_days ? `لمدة ${count(plan.duration_days, "day")}` : "", plan.instructions ?? ""].filter(Boolean).join(" · ");
}

/** ما في الوصفة وليس عند الصيدلية، كما كتبه الصيدلي. للمريض: رابط للبحث عنه في صيدليات أخرى. */
export function missingItemsBox(order, { searchLinks = false } = {}) {
  if (!order.missing_items?.length) return "";
  return alertBox(
    "warning",
    html`<div class="semi">ليست عند الصيدلية (من الوصفة):</div>
      <ul class="missing-list">${order.missing_items.map(
        (name) => html`<li><bdi>${name}</bdi>${searchLinks ? html` · <a href="/patient/search?q=${encodeURIComponent(name)}">ابحث عنه في صيدليات أخرى</a>` : ""}</li>`,
      )}</ul>`,
  );
}

/**
 * جدول أصناف الطلب مع الإجمالي. planButtons: للصيدلية، زر «طريقة الاستعمال» لكل صنف
 * (data-plan = معرّف الصنف) حين يسمح الطلب بذلك.
 */
export function orderItemsTable(order, { planButtons = false } = {}) {
  return html`<div class="table-wrap">
    <table class="table table--stack">
      <thead><tr><th>الدواء</th><th>الكمية</th><th>سعر العلبة</th><th>المجموع</th></tr></thead>
      <tbody>
        ${order.items.map(
          (item) => html`<tr>
            <td class="cell-main">
              <div class="semi">${item.brand_name} ${item.strength}</div>
              <div class="tiny muted">${item.generic_name} · ${dosageForm[item.dosage_form] ?? item.dosage_form} · العلبة ${count(item.pack_size, item.pack_unit)}</div>
              ${item.dose_plan
                ? html`<div class="dose-plan"><span class="dose-plan__label">${icon("calendar_clock", 15)}طريقة الاستعمال:</span> ${dosePlanText(item.dose_plan, item.pack_unit)}</div>`
                : ""}
              ${planButtons && order.can_plan_doses
                ? html`<div style="margin-top: 6px">${button(item.dose_plan ? "تعديل طريقة الاستعمال" : "طريقة الاستعمال", { size: "sm", variant: "soft", icon: item.dose_plan ? "pencil" : "plus", data: { plan: item.id } })}</div>`
                : ""}
            </td>
            <td class="nowrap" data-label="الكمية">${count(item.quantity, "box")}</td>
            <td class="nowrap num" data-label="سعر العلبة">${formatMoney(item.unit_price, order.currency)}</td>
            <td class="nowrap num" data-label="المجموع">${formatMoney(item.line_total, order.currency)}</td>
          </tr>`,
        )}
      </tbody>
      <tfoot><tr><td colspan="3">الإجمالي</td><td class="nowrap num total">${formatMoney(order.total_amount, order.currency)}</td></tr></tfoot>
    </table>
  </div>`;
}

/**
 * سجل تغيّر الحالة كخط زمني. items: [{ to_status, actor_role, reason, changed_at }].
 * kind: "order" أو "pharmacy": يحدد أسماء الحالات وألوانها.
 */
export function statusTimeline(items, kind = "order") {
  const statusBadge = kind === "order" ? orderStatusBadge : pharmacyStatusBadge;
  const tones = kind === "order" ? orderStatusTone : pharmacyStatusTone;
  return html`<ol class="timeline">
    ${items.map(
      (h) => html`<li class="timeline__item timeline__item--${tones[h.to_status] ?? "neutral"}">
        ${statusBadge(h.to_status)}
        <div class="small">${roleLabel[h.actor_role] ?? h.actor_role}${h.reason ? ` — ${h.reason}` : ""}</div>
        <div class="tiny muted">${formatDateTime(h.changed_at)}</div>
      </li>`,
    )}
  </ol>`;
}

/** بطاقة «سجل الحالة» تحت تفاصيل الطلب. */
export function orderHistoryCard(order) {
  if (!order.history?.length) return "";
  return html`<div class="card"><div class="card__body"><h3 style="margin-bottom: 12px">سجل الحالة</h3>${statusTimeline(order.history)}</div></div>`;
}
