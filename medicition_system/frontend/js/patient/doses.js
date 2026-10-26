/** الجرعات: نسبة الالتزام، جرعات يوم بعينه مع تسجيلها (أخذتها/تركتها)، وآخر ما سُجّل. */

import { health } from "../shared/api.js";
import { $, html, render } from "../shared/dom.js";
import { addDays, formatDateTime, formatDayLong, todayLocal } from "../shared/format.js";
import { startPage } from "../shared/layout.js";
import { doseState, doseStateTone } from "../shared/text.js";
import { badge, button, emptyState, errorState, loading, meter, statCard } from "../shared/ui.js";
import { renderDoseList } from "./doses-ui.js";

await startPage("PATIENT");

const today = todayLocal();
let date = today;
let dayAsk = 0;

async function loadAdherence() {
  let data = null;
  try {
    data = await health.adherence();
  } catch {
    /* الأرقام تبقى «—» */
  }
  const rate = data?.adherence_rate;
  render(
    $("#stats"),
    html`${statCard({ label: "نسبة الالتزام (7 أيام)", value: rate == null ? "—" : Math.round(rate * 100), suffix: "%", icon: "activity" })}
    ${statCard({ label: "مأخوذة", value: data?.taken ?? "—", icon: "check" })}
    ${statCard({ label: "فائتة", value: data?.missed ?? "—", tone: "coral", icon: "x" })}
    ${statCard({ label: "متروكة", value: data?.skipped ?? "—", tone: "neutral", icon: "minus" })}`,
  );
  const box = $("#meter");
  if (rate == null) {
    box.style.cssText = "height: 22px";
    render(box, "");
  } else {
    box.style.cssText = "margin: 14px 0 22px";
    render(box, meter(rate * 100, { label: "نسبة الالتزام" }));
  }
}

function drawDayLabel() {
  render(
    $("#day-label"),
    html`<h2>${date === today ? "اليوم" : formatDayLong(date)}</h2>
    ${date !== today ? button("العودة لليوم", { size: "sm", action: "today" }) : html`<span class="small muted">${formatDayLong(date)}</span>`}`,
  );
  $("[data-action=today]", $("#day-label"))?.addEventListener("click", () => setDate(today));
}

async function loadDay({ justRecorded = null, quiet = false } = {}) {
  const mine = ++dayAsk;
  const box = $("#doses");
  if (!quiet) render(box, loading());
  let doses;
  try {
    doses = (await health.day(date)).doses;
  } catch (error) {
    if (mine !== dayAsk) return;
    render(box, errorState(error, { retry: true }));
    $("[data-action=retry]", box).addEventListener("click", () => loadDay());
    return;
  }
  if (mine !== dayAsk) return;
  if (doses.length === 0) {
    render(
      box,
      emptyState({
        icon: "calendar_days",
        title: "لا جرعات في هذا اليوم",
        hint: "الجرعات تظهر من جداولك النشطة.",
        action: button("أدويتي وجداولها", { variant: "soft", href: "/patient/medications" }),
      }),
    );
    return;
  }
  renderDoseList(box, doses, {
    justRecorded,
    // تسجيل جرعة يغيّر النسبة والسجل أيضًا.
    onRecorded: (key) => {
      loadDay({ justRecorded: key, quiet: true });
      loadAdherence();
      loadHistory();
    },
  });
}

function setDate(next) {
  date = next;
  drawDayLabel();
  loadDay();
}

async function loadHistory() {
  const box = $("#history");
  let items;
  try {
    items = (await health.history({ limit: 15 })).items;
  } catch (error) {
    render(box, html`<div class="card__body">${errorState(error)}</div>`);
    return;
  }
  render(
    box,
    items.length === 0
      ? emptyState({ title: "لا سجل بعد" })
      : html`<div class="table-wrap">
          <table class="table table--compact table--stack">
            <thead><tr><th>الموعد</th><th>الدواء</th><th>الحالة</th><th>وقت التسجيل</th></tr></thead>
            <tbody>
              ${items.map(
                (h) => html`<tr>
                  <td class="nowrap" data-label="الموعد">${formatDateTime(h.scheduled_at)}</td>
                  <td class="semi" data-label="الدواء">${h.medication.brand_name} ${h.medication.strength}</td>
                  <td data-label="الحالة">${badge(doseStateTone[h.status], doseState[h.status])}</td>
                  <td class="nowrap muted" data-label="وقت التسجيل">${formatDateTime(h.taken_at ?? h.recorded_at)}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>`,
  );
}

$("#previous").addEventListener("click", () => setDate(addDays(date, -1)));
$("#next").addEventListener("click", () => setDate(addDays(date, 1)));

drawDayLabel();
loadAdherence();
loadDay();
loadHistory();
// حالة الجرعات تتغير مع الوقت (يحين موعد، تفوت أخرى).
setInterval(() => loadDay({ quiet: true }), 60_000);
