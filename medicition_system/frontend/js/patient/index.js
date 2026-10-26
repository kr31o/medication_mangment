/**
 * الرئيسية للمريض: ترحيب، تنبيهات، أرقام اليوم، جرعات اليوم، والطلبات الجارية.
 * [قرار المستخدم] وتنبيه بعرض وصفة ينتظر موافقته، وبجدول جرعات اقترحه الصيدلي.
 */

import { health, insights, orders, patients } from "../shared/api.js";
import { $, html, render } from "../shared/dom.js";
import { count, formatMoney, todayLocal } from "../shared/format.js";
import { icon } from "../shared/icons.js";
import { startPage } from "../shared/layout.js";
import { isPrescription, orderStatusBadge } from "../shared/orders.js";
import { alertBox, button, emptyState, errorState, loading, statCard } from "../shared/ui.js";
import { renderDoseList } from "./doses-ui.js";

await startPage("PATIENT");

// ما وصل من الخادم حتى الآن؛ null = لم يصل بعد.
const data = { profile: undefined, doses: null, active: null, meds: null };

function drawAlerts() {
  const low = (data.meds ?? []).filter((m) => m.is_running_low && m.status === "ACTIVE");
  const proposed = (data.meds ?? []).filter((m) => m.proposed_schedules && m.status === "ACTIVE");
  const quoted = (data.active?.items ?? []).filter((o) => o.status === "QUOTED");
  const box = $("#alerts");
  box.hidden = !(data.profile === null || low.length > 0 || proposed.length > 0 || quoted.length > 0);
  render(
    box,
    html`${data.profile === null ? alertBox("warning", "أكمل ملفك الشخصي لتتمكن من الطلب.", { action: button("إكمال", { size: "sm", href: "/patient/profile" }) }) : ""}
    ${quoted.map((o) =>
      alertBox("info", `عرض ${o.pharmacy.name} لوصفتك جاهز وينتظر موافقتك.`, { action: button("راجع العرض", { size: "sm", href: `/patient/orders/${o.id}` }) }),
    )}
    ${proposed.map((m) =>
      alertBox("info", `اقترح الصيدلي جدول جرعات لـ ${m.brand_name} ${m.strength}. راجعه وفعّله إن وافق ما وصفه طبيبك.`, {
        action: button("راجع الجدول", { size: "sm", href: `/patient/medications/${m.id}` }),
      }),
    )}
    ${low.map((m) =>
      alertBox("warning", `${m.brand_name} ${m.strength} على وشك النفاد: بقي ${count(m.quantity_on_hand, m.unit)}.`, {
        action: button("اطلب", { size: "sm", href: "/patient/search" }),
      }),
    )}`,
  );
}

function drawStats() {
  const pending = data.doses?.filter((d) => ["DUE", "OVERDUE", "UPCOMING"].includes(d.state));
  render(
    $("#stats"),
    html`${statCard({ label: "جرعات متبقية اليوم", value: pending ? pending.length : "—", icon: "alarm_clock", tone: "blue" })}
    ${statCard({ label: "طلبات جارية", value: data.active?.total ?? "—", icon: "receipt_text", tone: "amber" })}
    ${statCard({ label: "أدوية في سجلي", value: data.meds ? data.meds.filter((m) => m.status === "ACTIVE").length : "—", icon: "pill" })}`,
  );
}

async function loadDoses(justRecorded = null) {
  const box = $("#doses");
  if (!data.doses) render(box, loading());
  try {
    data.doses = (await health.day(todayLocal())).doses;
  } catch (error) {
    if (!data.doses) render(box, errorState(error));
    return;
  }
  drawStats();
  if (data.doses.length === 0) {
    render(box, emptyState({ icon: "calendar_days", title: "لا جرعات اليوم", hint: "أنشئ جدولًا لأدويتك لتصلك التذكيرات." }));
    return;
  }
  renderDoseList(box, data.doses, {
    justRecorded,
    onRecorded: (key) => {
      loadDoses(key);
      loadMeds();
    },
  });
}

async function loadMeds() {
  try {
    data.meds = await health.medications();
  } catch {
    return;
  }
  drawAlerts();
  drawStats();
}

async function loadOrders() {
  const box = $("#orders");
  try {
    data.active = await orders.mine({ status: "IN_REVIEW,QUOTED,PENDING", limit: 5 });
  } catch (error) {
    render(box, html`<div class="card__body">${errorState(error)}</div>`);
    return;
  }
  drawStats();
  drawAlerts();
  render(
    box,
    data.active.items.length > 0
      ? html`<div class="rows">${data.active.items.map(
          (order) => html`<a href="/patient/orders/${order.id}" class="row">
            <span class="result">
              <span class="tile">${icon(isPrescription(order) ? "scroll_text" : "store", 20)}</span>
              <span>
                <span class="semi" style="display: block">${order.pharmacy.name}</span>
                <span class="tiny muted num">${order.items.length ? formatMoney(order.total_amount, order.currency) : "صورة وصفة"}</span>
              </span>
            </span>
            ${orderStatusBadge(order.status)}
          </a>`,
        )}</div>`
      : emptyState({ icon: "receipt_text", title: "لا طلبات جارية" }),
  );
}

async function loadInsight() {
  try {
    const insight = (await insights.list({ limit: 1 })).items[0];
    if (!insight) return;
    $("#insight-title").textContent = insight.trigger === "SCHEDULED" ? "الملخص الأسبوعي" : "ملخص آخر 7 أيام";
    $("#insight-text").textContent = insight.text;
    $("#insight").hidden = false;
  } catch {
    /* الملخص إضافة: الصفحة تعمل بدونه */
  }
}

async function loadProfile() {
  try {
    data.profile = await patients.me();
  } catch {
    return;
  }
  if (data.profile) $("#greeting").textContent = `أهلًا، ${data.profile.full_name.split(" ")[0]}`;
  drawAlerts();
}

drawStats();
loadProfile();
loadDoses();
loadMeds();
loadOrders();
loadInsight();
// الجرعات تتغير مع الوقت (يحين موعد، تفوت أخرى).
setInterval(() => loadDoses(), 60_000);
