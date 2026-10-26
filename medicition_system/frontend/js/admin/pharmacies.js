/** إدارة الصيدليات: كل الصيدليات المسجلة (أو حسب الحالة). الضغط على صيدلية يفتح صفحتها. */

import { pharmacies } from "../shared/api.js";
import { $, $$, debounce, html, render } from "../shared/dom.js";
import { formatDateTime } from "../shared/format.js";
import { startPage } from "../shared/layout.js";
import { pharmacyStatusBadge } from "../shared/orders.js";
import { pharmacyStatus } from "../shared/text.js";
import { emptyState, errorState, loading, renderPager, renderTabs } from "../shared/ui.js";

await startPage("ADMIN");

// null = كل الصيدليات المسجلة، وهو ما تفتح عليه الصفحة.
const TABS = [null, "PENDING_APPROVAL", "ACTIVE", "SUSPENDED", "REJECTED"];
const PAGE_SIZE = 20;

let tab = 0;
let page = 1;
let counts = {};
let ask = 0;

function drawTabs() {
  const all = Object.values(counts).reduce((sum, n) => sum + n, 0);
  renderTabs(
    $("#tabs"),
    TABS.map((status) => ({
      label: status ? pharmacyStatus[status] : "الكل",
      count: status ? counts[status] : all,
      countTone: status === "PENDING_APPROVAL" ? "alert" : "quiet",
    })),
    tab,
    (next) => {
      tab = next;
      page = 1;
      drawTabs();
      load();
    },
  );
}

async function load() {
  const mine = ++ask;
  const box = $("#list");
  render(box, loading());
  let result;
  try {
    result = await pharmacies.adminList({ status: TABS[tab] ?? undefined, q: $("#q").value.trim() || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  } catch (error) {
    if (mine === ask) render(box, html`<div class="card__body">${errorState(error)}</div>`);
    return;
  }
  if (mine !== ask) return;
  if (result.items.length === 0) {
    render(box, emptyState({ title: "لا صيدليات هنا" }));
    render($("#pager"), "");
    return;
  }
  render(
    box,
    html`<div class="table-wrap">
      <table class="table table--hover table--stack">
        <thead><tr><th>الصيدلية</th><th>الحالة</th><th>الترخيص</th><th>المدينة</th><th>الهاتف</th><th>آخر تغيير</th></tr></thead>
        <tbody>
          ${result.items.map(
            (p) => html`<tr class="is-clickable" tabindex="0" data-href="/admin/pharmacies/${p.id}">
              <td class="semi cell-main">${p.name}</td>
              <td data-label="الحالة">${pharmacyStatusBadge(p.status)}</td>
              <td data-label="الترخيص"><bdi dir="ltr">${p.license_number}</bdi></td>
              <td data-label="المدينة">${p.city}</td>
              <td data-label="الهاتف"><bdi dir="ltr">${p.phone}</bdi></td>
              <td class="nowrap muted" data-label="آخر تغيير">${formatDateTime(p.status_changed_at)}</td>
            </tr>`,
          )}
        </tbody>
      </table>
    </div>`,
  );
  $$("[data-href]", box).forEach((tr) => {
    tr.addEventListener("click", () => location.assign(tr.dataset.href));
    tr.addEventListener("keydown", (event) => event.key === "Enter" && location.assign(tr.dataset.href));
  });
  renderPager($("#pager"), { page, pageSize: PAGE_SIZE, total: result.total }, (next) => {
    page = next;
    load();
  });
}

$("#q").addEventListener(
  "input",
  debounce(() => {
    page = 1;
    load();
  }, 300),
);

try {
  counts = await pharmacies.adminSummary();
} catch {
  /* التبويبات بلا أعداد */
}
drawTabs();
load();
