/**
 * الرئيسية للصيدلية: أرقام الطلبات، الطلبات الجديدة، والأصناف المنخفضة.
 * [قرار المستخدم] والوصفات بالصورة التي تنتظر أن يختار الصيدلي أدويتها.
 */

import { inventory, orders, pharmacies } from "../shared/api.js";
import { $, html, render } from "../shared/dom.js";
import { count, formatMoney, relativeTime } from "../shared/format.js";
import { icon } from "../shared/icons.js";
import { startPage } from "../shared/layout.js";
import { isPrescription, orderStatusBadge, pharmacyStatusBadge } from "../shared/orders.js";
import { alertBox, button, emptyState, errorState, loading, statCard } from "../shared/ui.js";
import { activePharmacy, hasOwnPoint } from "./mine.js";

await startPage("PHARMACY");

async function loadSummary() {
  let counts = {};
  try {
    counts = await orders.queueSummary();
  } catch {
    /* الأرقام تبقى «—» */
  }
  render(
    $("#stats"),
    html`${statCard({ label: "طلبات جديدة", value: counts.PENDING ?? "—", tone: "amber", icon: "bell_ring" })}
    ${statCard({ label: "وصفات للمراجعة", value: counts.IN_REVIEW ?? "—", tone: "violet", icon: "scroll_text" })}
    ${statCard({ label: "صُرفت", value: counts.DISPENSED ?? "—", icon: "hand_coins" })}
    ${statCard({ label: "مرفوضة", value: counts.REJECTED ?? "—", tone: "coral", icon: "circle_alert" })}`,
  );
}

async function loadOrders() {
  const box = $("#orders");
  let items;
  try {
    // ما ينتظر الصيدلي: طلبات يصرفها، ووصفات يختار أدويتها.
    items = (await orders.queue({ status: "PENDING,IN_REVIEW", limit: 5 })).items;
  } catch (error) {
    render(box, html`<div class="card__body">${errorState(error)}</div>`);
    return;
  }
  render(
    box,
    items.length
      ? html`<div class="rows">${items.map(
          (order) => html`<a href="/pharmacy/orders/${order.id}" class="row">
            <span class="result">
              <span class="tile tile--amber">${icon(isPrescription(order) ? "scroll_text" : "user_round", 20)}</span>
              <span>
                <span class="semi" style="display: block">${order.patient?.name}</span>
                <span class="tiny muted">${order.items.length ? `${count(order.items.length, "item")} · ${formatMoney(order.total_amount, order.currency)}` : "صورة وصفة"} · ${relativeTime(order.created_at)}</span>
              </span>
            </span>
            ${orderStatusBadge(order.status)}
          </a>`,
        )}</div>`
      : emptyState({ title: "لا طلبات جديدة" }),
  );
}

async function loadStock() {
  try {
    const [low, all] = await Promise.all([inventory.list({ low_stock: true, limit: 5 }), inventory.list({ limit: 1 })]);
    render(
      $("#low"),
      low.items.length
        ? html`<div class="rows">${low.items.map(
            (item) => html`<div class="row">
              <span class="semi">${item.medication ? `${item.medication.brand_name} ${item.medication.strength}` : "دواء"}</span>
              <span class="strong qty--low nowrap">${count(item.quantity, "box")}</span>
            </div>`,
          )}</div>`
        : emptyState({ icon: "boxes", title: "المخزون بخير" }),
    );
    // مخزون فارغ = لا يجد المرضى الصيدلية في أي بحث (البحث يكون عن دواء متوفر).
    const empty = $("#empty-stock");
    empty.hidden = all.total !== 0;
    if (all.total === 0) {
      render(
        empty,
        alertBox("warning", "مخزونك فارغ، فلن تظهر صيدليتك للمرضى. المريض يبحث عن دواء فتظهر له الصيدليات التي تعرضه في مخزونها.", {
          action: button("إضافة أدوية", { size: "sm", href: "/pharmacy/inventory" }),
        }),
      );
    }
  } catch (error) {
    render($("#low"), html`<div class="card__body">${errorState(error)}</div>`);
  }
}

async function start() {
  render($("#gate"), loading());
  let pharmacy;
  try {
    pharmacy = await pharmacies.me();
  } catch (error) {
    render($("#gate"), errorState(error, { retry: true }));
    $("[data-action=retry]", $("#gate")).addEventListener("click", start);
    return;
  }
  if (pharmacy) {
    $("#name").textContent = pharmacy.name;
    render($("#status"), pharmacyStatusBadge(pharmacy.status));
    if (!hasOwnPoint(pharmacy)) {
      $("#point-alert").hidden = false;
      render(
        $("#point-alert"),
        alertBox("warning", `صيدليتك مسجلة على مركز ${pharmacy.city} لا على مكانها. حدّد نقطتها على الخريطة ليرى المرضى بُعدها الصحيح عنهم.`, {
          action: button("تحديد المكان", { size: "sm", href: "/pharmacy/profile" }),
        }),
      );
    }
  }
  if (!(await activePharmacy($("#gate"), pharmacy))) return;
  $("#lead").textContent = "طلبات المرضى ومخزونك في مكان واحد.";
  $("#content").hidden = false;
  loadSummary();
  loadOrders();
  loadStock();
  setInterval(() => {
    loadSummary();
    loadOrders();
  }, 20_000);
}

start();
