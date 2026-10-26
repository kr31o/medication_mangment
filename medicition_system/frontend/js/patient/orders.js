/**
 * طلبات المريض: الجارية والسابقة. الضغط على طلب يفتح تفاصيله.
 * [قرار المستخدم] ومعها الوصفات المرسلة بالصورة، و«إرسال وصفة» (يختار الصيدلية أولًا).
 */

import { orders } from "../shared/api.js";
import { $, html, render } from "../shared/dom.js";
import { formatDateTime, formatMoney } from "../shared/format.js";
import { icon } from "../shared/icons.js";
import { startPage } from "../shared/layout.js";
import { isPrescription, orderStatusBadge, prescriptionBadge } from "../shared/orders.js";
import { emptyState, errorState, loading, renderPager, renderTabs } from "../shared/ui.js";

await startPage("PATIENT");

const ACTIVE = "IN_REVIEW,QUOTED,PENDING";
const DONE = "DISPENSED,REJECTED,CANCELLED";
const PAGE_SIZE = 10;

let tab = 0;
let page = 1;
let ask = 0;

function drawTabs() {
  renderTabs($("#tabs"), [{ label: "الجارية" }, { label: "السابقة" }], tab, (next) => {
    tab = next;
    page = 1;
    drawTabs();
    load(true);
  });
}

async function load(fresh = false) {
  const mine = ++ask;
  const box = $("#list");
  if (fresh) {
    render(box, loading());
    render($("#pager"), "");
  }
  let result;
  try {
    result = await orders.mine({ status: tab === 0 ? ACTIVE : DONE, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  } catch (error) {
    if (mine !== ask) return;
    render(box, errorState(error, { retry: true }));
    $("[data-action=retry]", box).addEventListener("click", () => load(true));
    return;
  }
  if (mine !== ask) return;
  render(
    box,
    result.items.length === 0
      ? html`<div class="card">${emptyState({ icon: "receipt_text", title: tab === 0 ? "لا طلبات جارية" : "لا طلبات سابقة", hint: "ابحث عن دوائك واطلبه من أقرب صيدلية." })}</div>`
      : html`<div class="stack stack--sm">${result.items.map(
          (order) => html`<a class="card card--link" href="/patient/orders/${order.id}">
            <div class="card__body between">
              <div class="result">
                <span class="tile">${icon(isPrescription(order) ? "scroll_text" : "store", 20)}</span>
                <div>
                  <div class="strong">${order.pharmacy.name} ${prescriptionBadge(order)}</div>
                  <div class="small soft">${order.items.length ? order.items.map((i) => `${i.brand_name} ${i.strength} × ${i.quantity}`).join("، ") : "صورة وصفة، بانتظار أن تختار الصيدلية أدويتها"}</div>
                  <div class="tiny muted">${formatDateTime(order.created_at)}</div>
                </div>
              </div>
              <div class="stack stack--sm" style="align-items: flex-end">
                ${orderStatusBadge(order.status)}
                ${order.items.length ? html`<span class="price">${formatMoney(order.total_amount, order.currency)}</span>` : ""}
              </div>
            </div>
          </a>`,
        )}</div>`,
  );
  renderPager($("#pager"), { page, pageSize: PAGE_SIZE, total: result.total, bare: true }, (next) => {
    page = next;
    load(true);
  });
}

drawTabs();
load(true);
// الطلبات الجارية تتحدث وحدها كل 20 ثانية.
setInterval(() => tab === 0 && load(), 20_000);
