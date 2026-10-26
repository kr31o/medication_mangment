/**
 * طلبات الصيدلية بتبويباتها: جديدة، مصروفة، مرفوضة وملغاة. الضغط على طلب يفتح تفاصيله.
 * [قرار المستخدم] ومعها الوصفات بالصورة: «وصفات للمراجعة» (تختار أدويتها) و«بانتظار المريض» (أُرسل عرضها).
 */

import { orders } from "../shared/api.js";
import { $, html, render } from "../shared/dom.js";
import { formatMoney, relativeTime } from "../shared/format.js";
import { icon } from "../shared/icons.js";
import { startPage } from "../shared/layout.js";
import { isPrescription, orderStatusBadge, prescriptionBadge } from "../shared/orders.js";
import { emptyState, errorState, loading, renderPager, renderTabs } from "../shared/ui.js";
import { activePharmacy } from "./mine.js";

await startPage("PHARMACY");

const TABS = [
  { label: "جديدة", status: "PENDING" },
  { label: "وصفات للمراجعة", status: "IN_REVIEW" },
  { label: "بانتظار المريض", status: "QUOTED" },
  { label: "مصروفة", status: "DISPENSED" },
  { label: "مرفوضة وملغاة", status: "REJECTED,CANCELLED" },
];
const PAGE_SIZE = 15;

let tab = 0;
let page = 1;
let counts = {};
let ask = 0;

function drawTabs() {
  // عدّاد على التبويبات التي تنتظر الصيدلية (بالأحمر)، وعلى ما ينتظر المريض.
  const badges = [counts.PENDING, counts.IN_REVIEW, counts.QUOTED, 0, 0];
  renderTabs(
    $("#tabs"),
    TABS.map((t, i) => ({ label: t.label, count: badges[i], countTone: i < 2 ? "alert" : undefined })),
    tab,
    (next) => {
      tab = next;
      page = 1;
      drawTabs();
      load(true);
    },
  );
}

const card = (order) => html`<a class="card card--link" href="/pharmacy/orders/${order.id}">
  <div class="card__body between">
    <div class="result">
      <span class="tile">${icon(isPrescription(order) ? "scroll_text" : "user_round", 20)}</span>
      <div>
        <div><span class="strong">${order.patient?.name}</span> ${prescriptionBadge(order)} <span class="tiny muted">${relativeTime(order.created_at)}</span></div>
        <div class="small soft">${order.items.length ? order.items.map((i) => `${i.brand_name} ${i.strength} × ${i.quantity}`).join("، ") : "صورة وصفة: افتحها واختر أدويتها من مخزونك"}</div>
        ${order.patient_note ? html`<div class="tiny" style="color: var(--violet-700)">ملاحظة: ${order.patient_note}</div>` : ""}
      </div>
    </div>
    <div class="stack stack--sm" style="align-items: flex-end">
      ${orderStatusBadge(order.status)}
      ${order.items.length ? html`<span class="price">${formatMoney(order.total_amount, order.currency)}</span>` : ""}
    </div>
  </div>
</a>`;

async function load(fresh = false) {
  const mine = ++ask;
  const box = $("#list");
  if (fresh) {
    render(box, loading());
    render($("#pager"), "");
  }
  let result;
  try {
    [result, counts] = await Promise.all([orders.queue({ status: TABS[tab].status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }), orders.queueSummary()]);
  } catch (error) {
    if (mine !== ask) return;
    render(box, errorState(error, { retry: true }));
    $("[data-action=retry]", box).addEventListener("click", () => load(true));
    return;
  }
  if (mine !== ask) return;
  drawTabs();
  render(box, result.items.length === 0 ? html`<div class="card">${emptyState({ title: "لا طلبات هنا" })}</div>` : html`<div class="stack stack--sm">${result.items.map(card)}</div>`);
  renderPager($("#pager"), { page, pageSize: PAGE_SIZE, total: result.total, bare: true }, (next) => {
    page = next;
    load(true);
  });
}

if (await activePharmacy($("#gate"))) {
  $("#content").hidden = false;
  drawTabs();
  load(true);
  setInterval(load, 20_000);
}
