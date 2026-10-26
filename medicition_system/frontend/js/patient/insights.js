/**
 * ملخصات الالتزام: نص يكتبه نموذج لغوي على جهاز المستخدم من أرقام الجرعات فقط، أو القالب
 * الثابت إن لم يكن النموذج متاحًا (قرار «ز»). لا تشخيص ولا نصيحة علاجية.
 */

import { insights } from "../shared/api.js";
import { $, $$, html, render } from "../shared/dom.js";
import { formatDate, formatDateTime, formatEndExclusive } from "../shared/format.js";
import { icon } from "../shared/icons.js";
import { startPage } from "../shared/layout.js";
import { errorMessage } from "../shared/text.js";
import { alertBox, badge, emptyState, errorState, iconButton, loading, setBusy, toast } from "../shared/ui.js";

await startPage("PATIENT");

const METRIC_LABELS = {
  scheduled: "جرعات حُسم أمرها",
  taken: "مأخوذة",
  missed: "فائتة",
  skipped: "متروكة",
  adherence_rate: "نسبة الالتزام",
};
const TIME_NAMES = { MORNING: "الصباح", NOON: "الظهر", EVENING: "المساء", NIGHT: "الليل" };

let items = [];

/** من كتب النص: النموذج اللغوي على الجهاز (local-llm:<اسم النموذج>) أو القالب الثابت. */
const writer = (modelName) =>
  modelName?.startsWith("local-llm:") ? { label: "نموذج لغوي على الجهاز", model: modelName.slice("local-llm:".length) } : { label: "القالب الثابت", model: null };

/** نسبة الالتزام بتقريب نصف لأعلى بحساب صحيح، كما يحسبها ai-service: نفس الرقم في النص وهنا. */
const percent = (m) => (m.scheduled ? Math.floor((m.taken * 200 + m.scheduled) / (2 * m.scheduled)) : 0);

const counts = (v) => `أُخذت ${v.taken} من ${v.scheduled}${v.missed ? `، فاتت ${v.missed}` : ""}${v.skipped ? `، تُركت ${v.skipped}` : ""}`;

/** «على ماذا بُني؟»: الأرقام التي كُتب منها الملخص. */
function why(insight, metrics) {
  const by = writer(insight.model_name);
  return html`${metrics
      ? html`${Object.keys(METRIC_LABELS).map((key) => {
          const value = metrics[key];
          return html`<div class="between"><span>${METRIC_LABELS[key]}</span><span class="strong num">${key === "adherence_rate" && typeof value === "number" ? `${percent(metrics)}%` : (value ?? "—")}</span></div>`;
        })}
        ${metrics.by_time_of_day ? html`<div class="tiny muted insight__group">حسب وقت اليوم</div>` : ""}
        ${Object.keys(TIME_NAMES)
          .filter((name) => metrics.by_time_of_day?.[name])
          .map((name) => html`<div class="between"><span>${TIME_NAMES[name]}</span><span class="num">${counts(metrics.by_time_of_day[name])}</span></div>`)}
        ${metrics.by_medication?.length ? html`<div class="tiny muted insight__group">حسب الدواء</div>` : ""}
        ${(metrics.by_medication ?? []).map((v) => html`<div class="between"><bdi dir="ltr">${v.medication}</bdi><span class="num">${counts(v)}</span></div>`)}`
      : html`<div>…</div>`}
    <div class="tiny muted" style="margin-top: 8px">كتبه ${by.label}${by.model ? html`: <bdi dir="ltr">${by.model}</bdi>` : ""}. الأرقام من سجل جرعاتك، والنص فُحص قبل عرضه.</div>`;
}

function card(insight, index) {
  return html`<div class="card insight">
    <div class="card__body">
      <div class="between" style="margin-bottom: 12px">
        <div class="result">
          <span class="tile tile--violet">${icon("sparkles", 20)}</span>
          <span class="strong">${insight.trigger === "SCHEDULED" ? "الملخص الأسبوعي" : "ملخص آخر 7 أيام"}</span>
        </div>
        ${insight.trigger === "SCHEDULED" ? html`<span class="badge badge--violet badge--plain"><bdi dir="ltr">${insight.period_label}</bdi></span>` : badge("violet", "عند الطلب", true)}
      </div>
      <p class="insight__text">${insight.text}</p>
      <p class="tiny muted" style="margin-top: 8px">الفترة ${formatDate(insight.period_start)} – ${formatEndExclusive(insight.period_end)} · أُنشئ ${formatDateTime(insight.created_at)} · كتبه ${writer(insight.model_name).label}</p>
      <button type="button" class="btn btn--ghost btn--sm" style="margin-top: 8px" aria-expanded="false" data-why="${index}">على ماذا بُني؟</button>
      <div class="insight__why small" hidden></div>
    </div>
  </div>`;
}

async function toggleWhy(toggle) {
  const box = toggle.nextElementSibling;
  const open = box.hidden;
  box.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  toggle.textContent = open ? "إخفاء" : "على ماذا بُني؟";
  if (!open || box.dataset.loaded) return;
  // الأرقام التي بُني عليها الملخص تُجلب عند أول فتح فقط.
  const insight = items[Number(toggle.dataset.why)];
  render(box, why(insight, null));
  try {
    const details = await insights.get(insight.id);
    box.dataset.loaded = "1";
    render(box, why(insight, details.input_metrics));
  } catch (error) {
    render(box, errorState(error));
  }
}

async function load() {
  const box = $("#list");
  if (!items.length) render(box, loading());
  try {
    items = (await insights.list({ limit: 30 })).items;
  } catch (error) {
    render(box, errorState(error, { retry: true }));
    $("[data-action=retry]", box).addEventListener("click", load);
    return;
  }
  if (items.length === 0) {
    render(box, html`<div class="card">${emptyState({ icon: "sparkles", title: "لا ملخصات بعد", hint: "سجّل جرعاتك لبضعة أيام ثم اطلب ملخصًا." })}</div>`);
    return;
  }
  render(box, items.map(card));
  $$("[data-why]", box).forEach((el) => el.addEventListener("click", () => toggleWhy(el)));
}

$("#generate").addEventListener("click", async (event) => {
  const generate = event.currentTarget;
  const problem = $("#generate-error");
  problem.hidden = true;
  setBusy(generate, true);
  $("#writing").hidden = false;
  try {
    await insights.generate();
    toast.success("أُنشئ ملخص جديد");
    await load();
  } catch (error) {
    render(problem, alertBox("warning", errorMessage(error), { action: iconButton("x", "إغلاق", { action: "dismiss" }) }));
    problem.hidden = false;
    $("[data-action=dismiss]", problem).addEventListener("click", () => (problem.hidden = true));
  } finally {
    setBusy(generate, false);
    $("#writing").hidden = true;
  }
});

load();
