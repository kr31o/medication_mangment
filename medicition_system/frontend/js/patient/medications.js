/**
 * أدويتي: الأدوية المصروفة للمريض، وكميتها المتبقية. الضغط على دواء يفتح صفحته.
 * [قرار المستخدم] الدواء الذي اقترح له الصيدلي جدول جرعات تظهر عليه شارة «جدول مقترح».
 */

import { health } from "../shared/api.js";
import { $, cx, html, render } from "../shared/dom.js";
import { count } from "../shared/format.js";
import { icon } from "../shared/icons.js";
import { startPage } from "../shared/layout.js";
import { dosageForm } from "../shared/text.js";
import { badge, button, emptyState, errorState, loading } from "../shared/ui.js";

await startPage("PATIENT");

const card = (med) => html`<a class="${cx("card card--link", med.status === "STOPPED" && "card--dim")}" href="/patient/medications/${med.id}">
  <div class="med-card">
    <div class="between" style="align-items: flex-start">
      <span class="${cx("tile", med.is_running_low && "tile--amber")}">${icon("pill", 20)}</span>
      <span class="cluster" style="--gap: 6px">
        ${med.proposed_schedules && med.status !== "STOPPED" ? badge("blue", "جدول مقترح") : ""}
        ${med.status === "STOPPED" ? badge("neutral", "موقوف") : med.open_schedule_id ? badge("green", "له جدول") : badge("amber", "بلا جدول")}
      </span>
    </div>
    <div>
      <h3>${med.brand_name} <span class="soft">${med.strength}</span></h3>
      <div class="small muted">${med.generic_name} · ${dosageForm[med.dosage_form] ?? med.dosage_form}</div>
    </div>
    <div class="${cx("strong", med.is_running_low && "qty--low")}" style="margin-top: auto; display: flex; align-items: center; gap: 6px">
      ${med.is_running_low ? icon("triangle_alert", 17) : ""}المتبقي: ${count(med.quantity_on_hand, med.unit)}
    </div>
  </div>
</a>`;

async function load() {
  const box = $("#list");
  render(box, loading());
  let meds;
  try {
    meds = await health.medications();
  } catch (error) {
    render(box, errorState(error, { retry: true }));
    $("[data-action=retry]", box).addEventListener("click", load);
    return;
  }
  render(
    box,
    meds.length === 0
      ? html`<div class="card">${emptyState({
          icon: "pill",
          title: "لا أدوية في سجلك بعد",
          hint: "يُضاف الدواء هنا تلقائيًا عندما تصرفه لك الصيدلية.",
          action: button("ابحث عن دواء", { variant: "primary", href: "/patient/search" }),
        })}</div>`
      : html`<div class="grid grid--3">${meds.map(card)}</div>`,
  );
}

load();
