/** كل طلبات المنصة (للأدمن): مراقبة فقط، فتغيير الحالة من صلاحية الصيدلية والمريض. */

import { orders } from "../shared/api.js";
import { $, $$, html, render } from "../shared/dom.js";
import { formatDateTime, formatMoney } from "../shared/format.js";
import { startPage } from "../shared/layout.js";
import { isPrescription, missingItemsBox, orderItemsTable, orderStatusBadge, orderTrack, prescriptionBadge, statusTimeline } from "../shared/orders.js";
import { orderStatus } from "../shared/text.js";
import { emptyState, errorState, loading, openModal, renderPager } from "../shared/ui.js";

await startPage("ADMIN");

const PAGE_SIZE = 25;
let page = 1;
let ask = 0;

async function load() {
  const mine = ++ask;
  const box = $("#list");
  render(box, loading());
  let result;
  try {
    result = await orders.adminList({ status: $("#status").value || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  } catch (error) {
    if (mine === ask) render(box, html`<div class="card__body">${errorState(error)}</div>`);
    return;
  }
  if (mine !== ask) return;
  if (result.items.length === 0) {
    render(box, emptyState({ title: "لا طلبات" }));
    render($("#pager"), "");
    return;
  }
  render(
    box,
    html`<div class="table-wrap">
      <table class="table table--hover table--stack">
        <thead><tr><th>التاريخ</th><th>المريض</th><th>الصيدلية</th><th>المبلغ</th><th>الحالة</th></tr></thead>
        <tbody>
          ${result.items.map(
            (o) => html`<tr class="is-clickable" tabindex="0" data-id="${o.id}">
              <td class="nowrap muted" data-label="التاريخ">${formatDateTime(o.created_at)}</td>
              <td class="semi" data-label="المريض">${o.patient?.name} ${prescriptionBadge(o)}</td>
              <td data-label="الصيدلية">${o.pharmacy.name}</td>
              <td class="nowrap num" data-label="المبلغ">${o.items.length ? formatMoney(o.total_amount, o.currency) : "—"}</td>
              <td data-label="الحالة">${orderStatusBadge(o.status)}</td>
            </tr>`,
          )}
        </tbody>
      </table>
    </div>`,
  );
  $$("[data-id]", box).forEach((tr) => {
    tr.addEventListener("click", () => openOrder(tr.dataset.id));
    tr.addEventListener("keydown", (event) => event.key === "Enter" && openOrder(tr.dataset.id));
  });
  renderPager($("#pager"), { page, pageSize: PAGE_SIZE, total: result.total }, (next) => {
    page = next;
    load();
  });
}

/** تفاصيل طلب في نافذة: مساره، أصنافه، وسجل حالته. */
async function openOrder(id) {
  const modal = openModal({ title: "تفاصيل الطلب", size: "lg", body: loading() });
  const box = $(".modal__body", modal.root);
  try {
    const order = await orders.adminGet(id);
    render(
      box,
      html`<div class="stack stack--lg">
        ${orderTrack(order)}
        ${order.items.length ? orderItemsTable(order) : ""}
        ${missingItemsBox(order)}
        ${isPrescription(order) ? html`<p class="small muted">طلب بصورة وصفة. الصورة نفسها للمريض والصيدلية فقط، لا للإدارة.</p>` : ""}
        ${order.history?.length ? html`<div><h3 style="margin-bottom: 12px">سجل الحالة</h3>${statusTimeline(order.history)}</div>` : ""}
      </div>`,
    );
  } catch (error) {
    render(box, errorState(error));
  }
}

render(
  $("#status"),
  html`<option value="">الكل</option>${Object.entries(orderStatus).map(([value, label]) => html`<option value="${value}">${label}</option>`)}`,
);
$("#status").addEventListener("change", () => {
  page = 1;
  load();
});
load();
