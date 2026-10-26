/**
 * طلب واحد للصيدلية: «قبول وصرف» (يُخصم من المخزون فورًا)، أو رفض بسبب يراه المريض.
 *
 * [قرار المستخدم] طلب الوصفة: الصيدلي يقرأ صورة الوصفة، فيختار أدويتها من مخزونه ويكتب ما ليس
 * عنده، ويرسل العرض للمريض. بعد موافقة المريض يصرفه كأي طلب. ولكل صنف «طريقة الاستعمال» كما
 * في الوصفة: تصل المريض جدولًا مقترحًا في «أدويتي». وفي أسفل الصفحة محادثة مع المريض.
 */

import { orders } from "../shared/api.js";
import { mountOrderChat } from "../shared/chat.js";
import { $, $$, html, idFromPath, render } from "../shared/dom.js";
import { count, formatDateTime, formatMoney } from "../shared/format.js";
import { startPage } from "../shared/layout.js";
import { isPrescription, missingItemsBox, orderHistoryCard, orderItemsTable, orderStatusBadge, orderTrack } from "../shared/orders.js";
import { mountQuoteBuilder, openDosePlanDialog, showPrescription } from "../shared/prescriptions.js";
import { orderAction } from "../shared/text.js";
import { alertBox, button, confirmDialog, errorState, loading, toast } from "../shared/ui.js";
import { activePharmacy } from "./mine.js";

await startPage("PHARMACY");

const id = idFromPath();
let order = null;
let chatMounted = false;
// عرض الوصفة قيد الكتابة: لا يُمسح بالتحديث الدوري.
let quoting = false;

// نص نافذة التأكيد لكل إجراء.
const CONFIRM = {
  dispense: { title: "قبول الطلب وصرفه؟", message: "تُخصم الكميات من مخزونك الآن، وتُضاف الأدوية لسجل المريض، ويُبلَّغ المريض. لا يمكن التراجع بعد الصرف." },
  reject: { title: "رفض الطلب؟", message: "يُبلَّغ المريض بالرفض وسببه.", danger: true, reason: true },
};

function ask(action) {
  const config = CONFIRM[action];
  const prescription = isPrescription(order);
  confirmDialog({
    title: action === "reject" && prescription ? "رفض الوصفة؟" : config.title,
    message: config.message,
    confirmLabel: orderAction[action],
    danger: config.danger,
    reason: config.reason ? { label: "سبب الرفض (يراه المريض)", required: true } : undefined,
    onConfirm: async (reason) => {
      try {
        order = await orders.pharmacyAction(id, action, reason || undefined);
        toast.success(action === "dispense" ? "قُبل الطلب وصُرف، وخُصمت الكميات من المخزون" : prescription ? "رُفضت الوصفة" : "رُفض الطلب");
        draw();
      } catch (error) {
        // ربما تغيّرت حالة الطلب في هذه الأثناء (ألغاه المريض مثلًا): نعرض حالته الآن.
        toast.error(error);
        load();
      }
    },
  });
}

function subtitle() {
  if (isPrescription(order) && order.items.length === 0) return `${formatDateTime(order.created_at)} · صورة وصفة`;
  return `${formatDateTime(order.created_at)} · ${count(order.items.length, "item")} · ${formatMoney(order.total_amount, order.currency)}`;
}

function stateNote() {
  if (order.status === "QUOTED") return alertBox("info", "أُرسل العرض للمريض. حين يوافق يصير الطلب «بانتظار الصيدلية» فتصرفه بـ «قبول وصرف».");
  if (order.status === "PENDING" && isPrescription(order)) return alertBox("success", "وافق المريض على العرض. جهّز الأدوية واصرفها بـ «قبول وصرف».");
  if (order.can_plan_doses && order.items.length && !order.items.some((i) => i.dose_plan)) {
    return alertBox("note", "اكتب «طريقة الاستعمال» لكل دواء كما في الوصفة: تصل المريض جدولًا مقترحًا في «أدويتي» يفعّله بنفسه.");
  }
  return "";
}

function draw() {
  // الخادم يحدد الإجراءات المسموحة في الحالة الحالية (allowed_actions).
  const primary = order.allowed_actions.filter((a) => a !== "reject" && a !== "quote");
  const prescription = isPrescription(order);
  render(
    $("#head"),
    html`<header class="page-head">
      <div>
        <h1>${prescription ? "وصفة" : "طلب"} ${order.patient?.name ?? ""}</h1>
        <div class="page-head__sub">${subtitle()}</div>
      </div>
      <div class="page-head__actions">
        ${orderStatusBadge(order.status)}
        ${order.allowed_actions.includes("reject") ? button(prescription ? "رفض الوصفة" : "رفض", { variant: "danger-outline", data: { act: "reject" } }) : ""}
        ${primary.map((action) => button(orderAction[action], { variant: "primary", data: { act: action } }))}
      </div>
    </header>`,
  );
  $$("[data-act]", $("#head")).forEach((el) => el.addEventListener("click", () => ask(el.dataset.act)));

  const reviewing = order.allowed_actions.includes("quote");
  quoting = reviewing;
  render(
    $("#order"),
    html`<div class="split split--wide">
      <div class="stack">
        <div class="card"><div class="card__body stack">${orderTrack(order)}${stateNote()}</div></div>
        ${reviewing ? html`<div id="quote"></div>` : ""}
        ${order.items.length
          ? html`<div class="card">
              ${orderItemsTable(order, { planButtons: true })}
              ${order.missing_items.length ? html`<div class="card__body">${missingItemsBox(order)}</div>` : ""}
            </div>`
          : ""}
        ${order.patient_note ? alertBox("info", `ملاحظة المريض: ${order.patient_note}`) : ""}
      </div>
      <div class="stack">
        ${order.prescription
          ? html`<div class="card"><div class="card__body stack stack--sm">
              <h3>صورة الوصفة</h3>
              <div id="rx"></div>
              <p class="tiny muted">اقرأها بنفسك: المنصة لا تقرأ الوصفات آليًا.</p>
            </div></div>`
          : ""}
        ${orderHistoryCard(order)}
      </div>
    </div>`,
  );
  if (order.prescription) showPrescription($("#rx"), () => orders.pharmacyPrescription(id));
  if (reviewing) {
    mountQuoteBuilder($("#quote"), {
      order,
      onQuoted: (updated) => {
        order = updated;
        draw();
      },
    });
  }
  $$("[data-plan]", $("#order")).forEach((el) =>
    el.addEventListener("click", () =>
      openDosePlanDialog({
        order,
        item: order.items.find((i) => i.id === el.dataset.plan),
        onSaved: (updated) => {
          order = updated;
          draw();
        },
      }),
    ),
  );

  if (!chatMounted) {
    chatMounted = true;
    mountOrderChat($("#chat"), { orderId: id, role: "PHARMACY" });
  }
}

async function load(first = false) {
  if (first) render($("#order"), loading());
  try {
    const next = await orders.pharmacyGet(id);
    if (order && JSON.stringify(next) === JSON.stringify(order)) return;
    // الصيدلي يكتب عرض الوصفة: لا نمسح ما كتبه إلا إن تغيّرت حالة الطلب (ألغاه المريض مثلًا).
    if (quoting && order && next.status === order.status) return;
    order = next;
  } catch (error) {
    if (!first) return;
    render($("#order"), errorState(error, { retry: true }));
    $("[data-action=retry]", $("#order")).addEventListener("click", () => load(true));
    return;
  }
  draw();
}

if (await activePharmacy($("#gate"))) {
  $("#content").hidden = false;
  load(true);
  setInterval(load, 20_000);
}
