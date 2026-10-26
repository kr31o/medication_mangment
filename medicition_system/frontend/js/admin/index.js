/** لوحة تحكم مدير النظام: أرقام الصيدليات والطلبات، وتوزيع كلٍّ منهما على حالاته. */

import { medicationRequests, orders, pharmacies } from "../shared/api.js";
import { $, html, render } from "../shared/dom.js";
import { count } from "../shared/format.js";
import { startPage } from "../shared/layout.js";
import { orderStatus, orderStatusTone, pharmacyStatus, pharmacyStatusTone } from "../shared/text.js";
import { alertBox, button, emptyState, errorState, meter, statCard } from "../shared/ui.js";

await startPage("ADMIN");

// لون شريط كل حالة مطابق للون شارتها. الأخضر هو لون الشريط الأصلي فلا يحتاج اسمًا.
const METER_TONE = { amber: "amber", blue: "blue", coral: "coral", violet: "violet", neutral: "neutral" };

/** قائمة حالات، لكل حالة عددها وشريط بنسبتها من المجموع. rows: [[status, count], …]. */
function statusMeters(container, { rows, total, labels, tones, empty }) {
  render(
    container,
    total === 0
      ? emptyState({ title: empty })
      : html`<div class="card__body stack">${rows.map(
          ([status, n]) => html`<div>
            <div class="between small" style="margin-bottom: 6px"><span>${labels[status] ?? status}</span><span class="strong num">${n}</span></div>
            ${meter((n / total) * 100, { small: true, tone: METER_TONE[tones[status]], label: labels[status] ?? status })}
          </div>`,
        )}</div>`,
  );
}

async function load() {
  let pharm;
  let ord;
  try {
    [pharm, ord] = await Promise.all([pharmacies.adminSummary(), orders.adminSummary()]);
  } catch (error) {
    render($("#stats"), errorState(error));
    return;
  }
  const orderTotal = Object.values(ord).reduce((a, b) => a + b, 0);
  const pending = pharm.PENDING_APPROVAL ?? 0;
  $("#pending").hidden = pending === 0;
  if (pending > 0) render($("#pending"), alertBox("warning", `${count(pending, "pharmacy")} بانتظار الاعتماد.`, { action: button("مراجعة", { size: "sm", href: "/admin/pharmacies" }) }));
  // [قرار المستخدم] طلبات المرضى والصيدليات بانتظار الرد. إن تعذّر عدّها تبقى اللوحة كما هي.
  medicationRequests
    .summary()
    .then((requests) => {
      const open = requests.OPEN ?? 0;
      $("#requests").hidden = open === 0;
      if (open > 0) render($("#requests"), alertBox("info", `${count(open, "order")} للإدارة بانتظار ردك.`, { action: button("مراجعة", { size: "sm", href: "/admin/requests" }) }));
    })
    .catch(() => undefined);
  render(
    $("#stats"),
    html`${statCard({ label: "صيدليات معتمدة", value: pharm.ACTIVE ?? "—", icon: "store" })}
    ${statCard({ label: "بانتظار الاعتماد", value: pending, icon: "hourglass", tone: "amber" })}
    ${statCard({ label: "كل الطلبات", value: orderTotal, icon: "clipboard_list", tone: "blue" })}
    ${statCard({ label: "طلبات مصروفة", value: ord.DISPENSED ?? "—", icon: "hand_coins", tone: "violet" })}`,
  );
  const pharmacyRows = Object.keys(pharmacyStatus).map((status) => [status, pharm[status] ?? 0]);
  statusMeters($("#pharmacies"), {
    rows: pharmacyRows,
    total: pharmacyRows.reduce((sum, [, n]) => sum + n, 0),
    labels: pharmacyStatus,
    tones: pharmacyStatusTone,
    empty: "لا صيدليات مسجلة بعد",
  });
  // بترتيب مسار الطلب (كما في text.js) لا بترتيب استجابة الخادم.
  statusMeters($("#orders"), {
    rows: Object.keys(orderStatus)
      .filter((status) => status in ord)
      .map((status) => [status, ord[status]]),
    total: orderTotal,
    labels: orderStatus,
    tones: orderStatusTone,
    empty: "لا طلبات بعد",
  });
}

load();
