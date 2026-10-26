/**
 * تفاصيل طلب للمريض: مسار الحالة، الأصناف، السجل، والإلغاء قبل أن تقبله الصيدلية.
 *
 * [قرار المستخدم] طلب الوصفة: صورة الوصفة، ثم عرض الصيدلية (ما اختارته من مخزونها بسعره، وما ليس
 * عندها مع رابط للبحث عنه في غيرها) فيوافق المريض أو يرفض. وتحت كل صنف طريقة الاستعمال إن
 * كتبها الصيدلي. وفي أسفل الصفحة محادثة مع الصيدلية عن هذا الطلب.
 */

import { orders } from "../shared/api.js";
import { mountOrderChat } from "../shared/chat.js";
import { $, html, idFromPath, render } from "../shared/dom.js";
import { count, formatDateTime, formatMoney } from "../shared/format.js";
import { startPage } from "../shared/layout.js";
import { isPrescription, missingItemsBox, orderHistoryCard, orderItemsTable, orderStatusBadge, orderTrack } from "../shared/orders.js";
import { showPrescription } from "../shared/prescriptions.js";
import { alertBox, button, confirmDialog, errorState, loading, toast } from "../shared/ui.js";

await startPage("PATIENT");

const id = idFromPath();
let order = null;
let chatMounted = false;

function subtitle() {
  if (isPrescription(order) && order.items.length === 0) return `أُرسلت ${formatDateTime(order.created_at)} · صورة وصفة`;
  return `أُنشئ ${formatDateTime(order.created_at)} · ${count(order.items.length, "item")}`;
}

/** ما يقوله الطلب للمريض الآن، وما المطلوب منه إن وُجد. */
function stateNote() {
  if (order.status === "DISPENSED") {
    const planned = order.items.some((i) => i.dose_plan);
    return alertBox(
      "info",
      planned
        ? "أُضيفت الأدوية إلى سجلك الدوائي، ومعها جدول جرعات اقترحه الصيدلي: راجعه وفعّله من «أدويتي»."
        : "أُضيفت الأدوية إلى سجلك الدوائي. يمكنك الآن ضبط جدول الجرعات.",
      { action: button("أدويتي", { size: "sm", href: "/patient/medications" }) },
    );
  }
  if (order.status === "IN_REVIEW") {
    return alertBox("info", "الصيدلية تقرأ وصفتك الآن، وتختار أدويتها من مخزونها. يصلك إشعار حين يجهز العرض بسعره.");
  }
  if (order.status === "QUOTED") {
    return alertBox("warning", "عرض الصيدلية جاهز. راجع الأدوية وسعرها، ثم وافق ليصرفها الصيدلي، أو ارفض العرض.");
  }
  if (order.status === "PENDING" && isPrescription(order)) {
    return alertBox("info", "وافقت على العرض. الصيدلية تجهّز الأدوية، والدفع والاستلام منها مباشرة.");
  }
  return "";
}

function draw() {
  const prescription = isPrescription(order);
  const quoted = order.allowed_actions.includes("approve");
  render(
    $("#head"),
    html`<header class="page-head">
      <div>
        <h1>${prescription ? "وصفة إلى" : "طلب من"} ${order.pharmacy.name}</h1>
        <div class="page-head__sub">${subtitle()}</div>
      </div>
      <div class="page-head__actions">
        ${orderStatusBadge(order.status)}
        ${order.allowed_actions.includes("cancel") && !quoted
          ? button(prescription ? "إلغاء الوصفة" : "إلغاء الطلب", { variant: "danger-outline", action: "cancel" })
          : ""}
      </div>
    </header>`,
  );
  $("[data-action=cancel]", $("#head"))?.addEventListener("click", () =>
    confirmDialog({
      title: prescription ? "إلغاء الوصفة؟" : "إلغاء الطلب؟",
      message: "يمكن الإلغاء ما دامت الصيدلية لم تصرف الطلب.",
      confirmLabel: prescription ? "إلغاء الوصفة" : "إلغاء الطلب",
      danger: true,
      reason: { label: "السبب", required: false },
      onConfirm: async (reason) => {
        order = await orders.cancel(id, reason || undefined);
        toast.success(prescription ? "أُلغيت الوصفة" : "أُلغي الطلب");
        draw();
      },
    }),
  );

  const items = order.items.length
    ? html`<div class="card">
        ${quoted ? html`<div class="card__head"><div><h3>عرض الصيدلية</h3><div class="small muted">الأدوية التي اختارتها من مخزونها لوصفتك، بسعر العلبة الآن.</div></div></div>` : ""}
        ${orderItemsTable(order)}
        ${order.missing_items.length ? html`<div class="card__body">${missingItemsBox(order, { searchLinks: true })}</div>` : ""}
        ${quoted
          ? html`<div class="card__body quote-decision">
              <p class="small soft">بالموافقة يصل الطلب الصيدلية لتصرفه بـ ${formatMoney(order.total_amount, order.currency)}. الدفع والاستلام منها مباشرة.</p>
              <div class="cluster">
                ${button("موافقة على العرض", { variant: "primary", icon: "check", action: "approve" })}
                ${button("رفض العرض", { variant: "danger-outline", action: "decline" })}
              </div>
            </div>`
          : ""}
        ${order.patient_note ? html`<div class="card__body"><p class="small soft">ملاحظتك: ${order.patient_note}</p></div>` : ""}
      </div>`
    : order.patient_note
      ? html`<div class="card"><div class="card__body"><p class="small soft">ملاحظتك: ${order.patient_note}</p></div></div>`
      : "";

  render(
    $("#order"),
    html`<div class="split split--wide">
      <div class="stack">
        <div class="card"><div class="card__body stack">
          ${orderTrack(order)}
          ${stateNote()}
        </div></div>
        ${items}
        ${order.prescription
          ? html`<div class="card"><div class="card__body stack stack--sm">
              <h3>صورة الوصفة</h3>
              <div id="rx"></div>
            </div></div>`
          : ""}
      </div>
      ${orderHistoryCard(order)}
    </div>`,
  );
  if (order.prescription) showPrescription($("#rx"), () => orders.prescription(id));

  $("[data-action=approve]", $("#order"))?.addEventListener("click", () =>
    confirmDialog({
      title: "الموافقة على العرض؟",
      message: `يصل الطلب ${order.pharmacy.name} لتصرفه بـ ${formatMoney(order.total_amount, order.currency)}.`,
      confirmLabel: "موافقة",
      onConfirm: async () => {
        order = await orders.approve(id);
        toast.success("وافقت على العرض. يصلك إشعار حين تصرفه الصيدلية.");
        draw();
      },
    }),
  );
  $("[data-action=decline]", $("#order"))?.addEventListener("click", () =>
    confirmDialog({
      title: "رفض عرض الصيدلية؟",
      message: "تُلغى الوصفة عند هذه الصيدلية. تستطيع إرسالها لصيدلية أخرى.",
      confirmLabel: "رفض العرض",
      danger: true,
      reason: { label: "السبب (تراه الصيدلية)", required: false },
      onConfirm: async (reason) => {
        order = await orders.cancel(id, reason || undefined);
        toast.success("رفضت العرض وأُلغيت الوصفة");
        draw();
      },
    }),
  );

  if (!chatMounted) {
    chatMounted = true;
    mountOrderChat($("#chat"), { orderId: id, role: "PATIENT" });
  }
}

async function load(first = false) {
  if (first) render($("#order"), loading());
  try {
    const next = await orders.get(id);
    // لا نرسم من جديد إن لم يتغير شيء (حتى لا تتكرر حركة المسار كل 15 ثانية).
    if (order && JSON.stringify(next) === JSON.stringify(order)) return;
    order = next;
  } catch (error) {
    if (!first) return;
    render($("#order"), errorState(error, { retry: true }));
    $("[data-action=retry]", $("#order")).addEventListener("click", () => load(true));
    return;
  }
  draw();
}

load(true);
setInterval(load, 15_000);
