/** جرعات يوم واحد (للرئيسية وصفحة الجرعات): شريط الحبوب، صف لكل جرعة، وزرّا التسجيل. */

import { health } from "../shared/api.js";
import { $$, cx, html, render } from "../shared/dom.js";
import { count, formatClock } from "../shared/format.js";
import { icon } from "../shared/icons.js";
import { doseState, doseStateTone } from "../shared/text.js";
import { badge, button, toast } from "../shared/ui.js";

const STATE_ICON = { TAKEN: "check", MISSED: "x", SKIPPED: "minus" };

const keyOf = (dose) => `${dose.dose_time_id}-${dose.scheduled_date}`;

/**
 * شريط الحبوب: خانة لكل جرعة في اليوم كما في شريط الدواء الحقيقي.
 * حبة سليمة = لم يحن وقتها، خانة خضراء بعلامة صح = أُخذت، مرجانية = فاتت.
 */
function dayStrip(doses) {
  const taken = doses.filter((d) => d.state === "TAKEN").length;
  return html`<div class="stack stack--sm">
    <div class="between small"><span class="semi">شريط اليوم</span><span class="muted">أُخذت ${taken} من ${doses.length}</span></div>
    <div class="blister" role="list">
      ${doses.map((dose) => {
        const label = `${formatClock(dose.local_time)} — ${dose.medication.brand_name} ${dose.medication.strength} — ${doseState[dose.state]}`;
        return html`<span role="listitem" class="blister__cell is-${dose.state}" title="${label}" aria-label="${label}">${
          STATE_ICON[dose.state] ? icon(STATE_ICON[dose.state], 20) : html`<span class="blister__pill"></span>`
        }</span>`;
      })}
    </div>
  </div>`;
}

/** صف جرعة واحدة مع زرّي التسجيل. الحبة «تفرقع» لحظة تسجيلها (justRecorded). */
function doseRow(dose, index, justRecorded) {
  const recordable = dose.state === "DUE" || dose.state === "OVERDUE" || dose.state === "MISSED";
  const popped = justRecorded && (dose.state === "TAKEN" || dose.state === "SKIPPED");
  const extra = [count(dose.dose_amount, dose.unit), dose.instructions, dose.log?.source === "SYSTEM" ? "علّمها النظام فائتة" : null].filter(Boolean).join(" · ");
  return html`<div class="${cx("dose", `is-${dose.state}`, popped && "just-recorded")}">
    <span class="dose__bubble">${icon(STATE_ICON[dose.state] ?? "pill", 20)}</span>
    <div class="dose__info">
      <div class="cluster" style="--gap: 4px 10px">
        <span class="dose__time">${formatClock(dose.local_time)}</span>
        <span class="semi">${dose.medication.brand_name} ${dose.medication.strength}</span>
        ${badge(doseStateTone[dose.state], doseState[dose.state])}
      </div>
      <div class="small muted">${extra}</div>
    </div>
    ${recordable
      ? html`<div class="dose__actions">
          ${button("أخذتها", { size: "sm", variant: "primary", icon: "check", data: { record: "TAKEN", index } })}
          ${button("تركتها", { size: "sm", variant: "quiet", data: { record: "SKIPPED", index } })}
        </div>`
      : ""}
  </div>`;
}

/**
 * يرسم جرعات اليوم داخل container. بعد تسجيل جرعة يُستدعى onRecorded(key) لتعيد
 * الصفحة تحميل ما تغيّر (الكمية المتبقية تنقص، والنسبة تتغير)، ثم ترسم من جديد
 * ومعها justRecorded = key.
 */
export function renderDoseList(container, doses, { justRecorded = null, onRecorded }) {
  render(
    container,
    html`<div class="stack">${dayStrip(doses)}<div>${doses.map((dose, index) => doseRow(dose, index, keyOf(dose) === justRecorded))}</div></div>`,
  );
  const buttons = $$("[data-record]", container);
  buttons.forEach((el) =>
    el.addEventListener("click", async () => {
      const dose = doses[Number(el.dataset.index)];
      const status = el.dataset.record;
      buttons.forEach((b) => (b.disabled = true));
      try {
        await health.record({ dose_time_id: dose.dose_time_id, scheduled_date: dose.scheduled_date, status });
        toast.success(status === "TAKEN" ? "سُجّلت الجرعة" : "سُجّلت كمتروكة");
        onRecorded(keyOf(dose));
      } catch (error) {
        toast.error(error);
        buttons.forEach((b) => (b.disabled = false));
      }
    }),
  );
}
