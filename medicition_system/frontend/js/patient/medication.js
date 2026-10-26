/**
 * صفحة دواء في سجل المريض: الكمية المتبقية، مصدرها، حد التنبيه، وجدول الجرعات.
 *
 * [قرار المستخدم] الجدول المقترح: كتبه الصيدلي مع الصرف (طريقة الاستعمال)، ولا يذكّر ولا تُعدّ
 * جرعاته حتى يفعّله المريض. التفعيل يبدأه من اليوم بالمدة نفسها؛ وإن كان للدواء جدول مفتوح
 * يُسأل المريض أولًا لأن التفعيل يُنهيه. «تجاهل» يتركه في السجل بلا أثر.
 */

import { health } from "../shared/api.js";
import { $, $$, cx, html, idFromPath, render } from "../shared/dom.js";
import { addDays, count, formatClock, formatDate, formatDateTime, TIMEZONE, todayLocal } from "../shared/format.js";
import { startPage } from "../shared/layout.js";
import { dosageForm, errorMessage, packUnit, weekdays } from "../shared/text.js";
import { alertBox, badge, button, confirmDialog, emptyState, errorState, field, iconButton, loading, openModal, setAlert, setBusy, toast } from "../shared/ui.js";

await startPage("PATIENT");

const id = idFromPath();
let med = null;

const SCHEDULE_STATUS = {
  PROPOSED: { label: "مقترح من الصيدلي", tone: "blue" },
  ACTIVE: { label: "نشط", tone: "green" },
  PAUSED: { label: "موقوف مؤقتًا", tone: "amber" },
  ENDED: { label: "منتهٍ", tone: "neutral" },
  DISMISSED: { label: "متجاهَل", tone: "neutral" },
};
const OPEN = ["ACTIVE", "PAUSED"];
const CLOSED = ["ENDED", "DISMISSED"];
// المقترح أولًا ثم المفتوح ثم المنتهي، والأحدث أولًا داخل كل مجموعة.
const ORDER = { PROPOSED: 0, ACTIVE: 1, PAUSED: 1, ENDED: 2, DISMISSED: 2 };

/** مدة الجدول بالأيام (من البداية إلى النهاية شاملة)، أو null بلا نهاية. */
function durationDays(schedule) {
  if (!schedule.end_date) return null;
  return Math.round((Date.parse(schedule.end_date) - Date.parse(schedule.start_date)) / 86_400_000) + 1;
}

// ----------------------------------------------------------------------------- الرسم

function scheduleCard(schedule) {
  const days =
    schedule.days_of_week.length === 7
      ? "يوميًا"
      : weekdays
          .filter((d) => schedule.days_of_week.includes(d.value))
          .map((d) => d.label)
          .join("، ");
  const status = SCHEDULE_STATUS[schedule.status] ?? { label: schedule.status, tone: "neutral" };
  const proposed = schedule.status === "PROPOSED";
  const days_ = durationDays(schedule);
  return html`<div class="${cx("card", CLOSED.includes(schedule.status) && "card--dim", proposed && "card--proposed")}">
    <div class="card__body stack stack--sm">
      <div class="between">
        ${badge(status.tone, status.label)}
        <span class="tiny muted">${proposed
          ? days_ ? `المدة: ${count(days_, "day")} تبدأ يوم التفعيل` : "بلا تاريخ نهاية، يبدأ يوم التفعيل"
          : `من ${formatDate(schedule.start_date)}${schedule.end_date ? ` إلى ${formatDate(schedule.end_date)}` : ""}`}</span>
      </div>
      ${schedule.proposed_by ? html`<div class="small soft">${proposed ? "اقترحته" : "من اقتراح"} <bdi class="semi">${schedule.proposed_by}</bdi> مع صرف الدواء</div>` : ""}
      <div class="strong">${days}</div>
      <div class="cluster">${schedule.times.map((t) => badge("blue", `${formatClock(t.time)} · ${count(t.dose_amount, med.unit)}`, true))}</div>
      ${schedule.instructions ? html`<p class="small soft">${schedule.proposed_by ? "تعليمات الصيدلي" : "ملاحظة"}: ${schedule.instructions}</p>` : ""}
      ${proposed
        ? html`<div class="cluster" style="margin-top: 6px">
            ${button("تفعيل الجدول", { size: "sm", variant: "primary", icon: "check", disabled: med.status !== "ACTIVE", data: { activate: schedule.id } })}
            ${button("تجاهل", { size: "sm", variant: "outline", data: { schedule: schedule.id, status: "DISMISSED" } })}
          </div>
          ${med.status !== "ACTIVE" ? html`<p class="tiny muted">الدواء موقوف: أعد تفعيله أولًا.</p>` : ""}`
        : OPEN.includes(schedule.status)
        ? html`<div class="cluster" style="margin-top: 6px">
            ${schedule.status === "ACTIVE"
              ? button("إيقاف مؤقت", { size: "sm", variant: "outline", data: { schedule: schedule.id, status: "PAUSED" } })
              : button("استئناف", { size: "sm", variant: "primary", data: { schedule: schedule.id, status: "ACTIVE" } })}
            ${button("إنهاء الجدول", { size: "sm", variant: "danger-outline", data: { schedule: schedule.id, status: "ENDED" } })}
          </div>`
        : ""}
    </div>
  </div>`;
}

function draw() {
  const open = med.schedules.find((s) => OPEN.includes(s.status));
  const schedules = [...med.schedules].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  document.title = `${med.brand_name} ${med.strength} · منصة الأدوية`;
  render(
    $("#head"),
    html`<header class="page-head">
      <div>
        <h1>${med.brand_name} ${med.strength}</h1>
        <div class="page-head__sub">${med.generic_name} · ${dosageForm[med.dosage_form] ?? med.dosage_form}</div>
      </div>
      <div class="page-head__actions">
        ${med.status === "ACTIVE" ? button("إيقاف الدواء", { variant: "outline", action: "stop" }) : button("إعادة التفعيل", { variant: "primary", action: "reactivate" })}
      </div>
    </header>`,
  );
  render(
    $("#medication"),
    html`<div class="split">
      <div>
        <section class="section">
          <div class="section__head">
            <h2>جدول الجرعات</h2>
            ${!open && med.status === "ACTIVE" ? button("جدول جديد", { variant: "primary", size: "sm", icon: "plus", action: "new-schedule" }) : ""}
          </div>
          ${med.schedules.length === 0
            ? html`<div class="card">${emptyState({ icon: "calendar_clock", title: "لا يوجد جدول", hint: "أنشئ جدولًا لتصلك تذكيرات بمواعيد الجرعات." })}</div>`
            : html`<div class="stack stack--sm">${schedules.map(scheduleCard)}</div>`}
        </section>
        ${alertBox("note", "الجدول يعكس ما وصفه لك طبيبك. المنصة تذكّرك بالمواعيد فقط ولا تقترح جرعات؛ الجدول المقترح كتبه الصيدلي، والقرار لك.")}
      </div>

      <div class="stack">
        <div class="card"><div class="card__body stack">
          <div>
            <div class="small muted">الكمية المتبقية</div>
            <div class="${cx("qty", med.is_running_low && "qty--low")}">${count(med.quantity_on_hand, med.unit)}</div>
          </div>
          ${med.is_running_low ? alertBox("warning", "الدواء على وشك النفاد.", { action: button("اطلب", { size: "sm", href: "/patient/search" }) }) : ""}
          <div class="inline-form">
            ${field(`نبهني عند (${packUnit[med.unit]})`, "min_quantity", { type: "number", value: med.min_quantity ?? "", min: 0, step: "any" })}
            <button type="button" class="btn btn--soft" style="min-height: 48px" data-action="save-min" disabled>حفظ</button>
          </div>
          <p class="tiny muted">الحد الأدنى للتنبيه قبل النفاد</p>
        </div></div>
        <div class="card"><div class="card__body">
          <h3 style="margin-bottom: 6px">مصدر الكمية</h3>
          ${med.acquisitions.map(
            (a) => html`<div class="kv" style="display: block">
              <div class="semi">+${count(a.units_added, med.unit)} (${count(a.packs, "box")})</div>
              <div class="tiny muted">${a.pharmacy.name} · ${formatDateTime(a.acquired_at)} · <a href="/patient/orders/${a.order_id}">الطلب</a></div>
            </div>`,
          )}
        </div></div>
      </div>
    </div>`,
  );
  wire();
}

// ----------------------------------------------------------------------------- الأفعال

async function update(body, buttonElement) {
  setBusy(buttonElement, true);
  try {
    await health.updateMedication(id, body);
    toast.success("حُفظ");
  } catch (error) {
    setBusy(buttonElement, false);
    toast.error(error);
    return;
  }
  await load();
}

function wire() {
  $("[data-action=stop]")?.addEventListener("click", () =>
    confirmDialog({
      title: "إيقاف الدواء؟",
      message: "سينتهي جدول جرعاته وتتوقف التذكيرات. يبقى سجله محفوظًا.",
      confirmLabel: "إيقاف",
      danger: true,
      onConfirm: async () => {
        await health.updateMedication(id, { status: "STOPPED" });
        toast.success("حُفظ");
        await load();
      },
    }),
  );
  $("[data-action=reactivate]")?.addEventListener("click", (event) => update({ status: "ACTIVE" }, event.currentTarget));
  $("[data-action=new-schedule]")?.addEventListener("click", openScheduleDialog);

  const minInput = $("[name=min_quantity]");
  const save = $("[data-action=save-min]");
  minInput.addEventListener("input", () => (save.disabled = false));
  save.addEventListener("click", () => update({ min_quantity: minInput.value === "" ? null : minInput.value }, save));

  $$("[data-activate]").forEach((el) => el.addEventListener("click", () => activate(el.dataset.activate, el)));

  $$("[data-schedule]").forEach((el) =>
    el.addEventListener("click", () => {
      const status = el.dataset.status;
      const change = async () => {
        await health.updateSchedule(el.dataset.schedule, { status });
        toast.success("حُدّث الجدول");
        await load();
      };
      if (status === "DISMISSED") {
        confirmDialog({
          title: "تجاهل الجدول المقترح؟",
          message: "يبقى في السجل ولا يذكّرك. لن تستطيع تفعيله بعد ذلك، لكن يمكنك إنشاء جدول بنفسك.",
          confirmLabel: "تجاهل",
          onConfirm: change,
        });
        return;
      }
      if (status === "ENDED") {
        confirmDialog({
          title: "إنهاء الجدول؟",
          message: "لا يمكن إعادة فتح جدول منتهٍ، لكن يمكنك إنشاء جدول جديد.",
          confirmLabel: "إنهاء",
          danger: true,
          onConfirm: change,
        });
        return;
      }
      $$("[data-schedule]").forEach((b) => (b.disabled = true));
      change().catch((error) => {
        toast.error(error);
        $$("[data-schedule]").forEach((b) => (b.disabled = false));
      });
    }),
  );
}

/** تفعيل جدول الصيدلي المقترح. إن كان للدواء جدول مفتوح فالتفعيل يُنهيه، فنسأل أولًا. */
function activate(scheduleId, buttonElement) {
  const run = async (replaceOpen) => {
    await health.updateSchedule(scheduleId, { status: "ACTIVE", ...(replaceOpen ? { replace_open: true } : {}) });
    toast.success("فُعّل الجدول، وستصلك التذكيرات من اليوم");
    await load();
  };
  if (med.schedules.some((s) => OPEN.includes(s.status))) {
    confirmDialog({
      title: "تفعيل الجدول المقترح؟",
      message: "لهذا الدواء جدول مفتوح. التفعيل يُنهي جدولك الحالي ويبدأ جدول الصيدلي من اليوم.",
      confirmLabel: "إنهاء جدولي وتفعيل المقترح",
      onConfirm: () => run(true),
    });
    return;
  }
  setBusy(buttonElement, true);
  run(false).catch((error) => {
    setBusy(buttonElement, false);
    toast.error(error);
  });
}

// ----------------------------------------------------------------------------- جدول جديد

function openScheduleDialog() {
  let days = [1, 2, 3, 4, 5, 6, 7];
  let times = [{ time: "08:00", dose_amount: "1" }];
  const today = todayLocal();
  const modal = openModal({
    title: "جدول جرعات جديد",
    body: html`<div class="stack">
      <div data-slot="error" hidden></div>
      <div class="field">
        <span class="field__label">الأيام</span>
        <div class="chips" role="group" aria-label="الأيام" data-slot="days"></div>
      </div>
      <div class="field">
        <span class="field__label">الأوقات والكمية في كل جرعة (${packUnit[med.unit]})</span>
        <div class="stack stack--sm">
          <div class="stack stack--sm" data-slot="times"></div>
          <div data-slot="duplicate" hidden></div>
          <div>${button("إضافة وقت", { size: "sm", variant: "soft", icon: "plus", action: "add-time" })}</div>
        </div>
      </div>
      <div class="grid grid--2 grid--keep">
        ${field("البداية", "start_date", { type: "date", value: today, min: addDays(today, -7), hint: "حتى 7 أيام في الماضي" })}
        ${field("النهاية", "end_date", { type: "date", min: today, hint: "اختياري" })}
      </div>
      ${field("ملاحظة لنفسك", "instructions", { placeholder: "مثل: بعد الأكل", maxLength: 500 })}
    </div>`,
    footer: html`${button("إلغاء", { variant: "quiet", action: "cancel" })}${button("إنشاء الجدول", { variant: "primary", action: "create" })}`,
  });
  const root = modal.root;
  const create = $("[data-action=create]", root);
  const startInput = $("[name=start_date]", root);
  const endInput = $("[name=end_date]", root);
  $("[data-action=cancel]", root).addEventListener("click", modal.close);
  startInput.addEventListener("input", () => (endInput.min = startInput.value));

  function drawDays() {
    render(
      $("[data-slot=days]", root),
      weekdays.map(
        (d) => html`<button type="button" class="${cx("chip-toggle", days.includes(d.value) && "is-active")}" aria-pressed="${days.includes(d.value)}" data-day="${d.value}">${d.label}</button>`,
      ),
    );
    $$("[data-day]", root).forEach((el) =>
      el.addEventListener("click", () => {
        const value = Number(el.dataset.day);
        // يوم واحد على الأقل يبقى مختارًا.
        if (!days.includes(value)) days = [...days, value];
        else if (days.length > 1) days = days.filter((d) => d !== value);
        drawDays();
      }),
    );
  }

  function checkDuplicate() {
    const duplicate = new Set(times.map((t) => t.time)).size !== times.length;
    setAlert($("[data-slot=duplicate]", root), "warning", duplicate ? "وقت مكرر." : "");
    create.disabled = duplicate;
  }

  function drawTimes() {
    render(
      $("[data-slot=times]", root),
      times.map(
        (t, index) => html`<div class="time-row" data-row="${index}">
          ${field("الوقت", "time", { type: "time", value: t.time })}
          ${field("الكمية", "dose_amount", { type: "number", value: t.dose_amount, min: 0.25, step: 0.25 })}
          ${iconButton("trash_2", "حذف", { danger: true, disabled: times.length === 1, data: { remove: index } })}
        </div>`,
      ),
    );
    $$("[data-row]", root).forEach((row) => {
      const t = times[Number(row.dataset.row)];
      $("[name=time]", row).addEventListener("input", (event) => {
        t.time = event.target.value;
        checkDuplicate();
      });
      $("[name=dose_amount]", row).addEventListener("input", (event) => (t.dose_amount = event.target.value));
    });
    $$("[data-remove]", root).forEach((el) =>
      el.addEventListener("click", () => {
        times.splice(Number(el.dataset.remove), 1);
        drawTimes();
      }),
    );
    $("[data-action=add-time]", root).disabled = times.length >= 12;
    checkDuplicate();
  }

  $("[data-action=add-time]", root).addEventListener("click", () => {
    times = [...times, { time: "20:00", dose_amount: "1" }];
    drawTimes();
  });

  create.addEventListener("click", async () => {
    const instructions = $("[name=instructions]", root).value.trim();
    setBusy(create, true);
    try {
      await health.createSchedule(med.id, {
        start_date: startInput.value,
        ...(endInput.value ? { end_date: endInput.value } : {}),
        // منطقة المنصة لا منطقة المتصفح: كل الشاشات والتذكيرات تعرض بتوقيت عمّان،
        // ومتصفح مضبوط على UTC كان سيجعل جرعة "8:00" تظهر 11:00 في السجل.
        timezone: TIMEZONE,
        days_of_week: days,
        times,
        ...(instructions ? { instructions } : {}),
      });
    } catch (error) {
      setBusy(create, false);
      setAlert($("[data-slot=error]", root), "error", errorMessage(error));
      return;
    }
    toast.success("أُنشئ الجدول وستصلك التذكيرات");
    modal.close();
    load();
  });

  drawDays();
  drawTimes();
}

// ----------------------------------------------------------------------------- التحميل

async function load() {
  if (!med) render($("#medication"), loading());
  try {
    med = await health.medication(id);
  } catch (error) {
    render($("#medication"), errorState(error, { retry: true }));
    $("[data-action=retry]", $("#medication")).addEventListener("click", load);
    return;
  }
  draw();
}

load();
