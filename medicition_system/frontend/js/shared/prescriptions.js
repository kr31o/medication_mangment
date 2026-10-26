/**
 * [قرار المستخدم] طلب بصورة وصفة (انحراف عن BR-004: رفع الصورة مسموح، والقراءة الآلية OCR ممنوعة).
 *
 *   المريض يرسل صورة الوصفة لصيدلية      openPrescriptionDialog()
 *   الصيدلي يقرؤها ويختار أدويتها          mountQuoteBuilder()      (من مخزونه، ويكتب الناقص)
 *   ويكتب طريقة الاستعمال لكل صنف          openDosePlanDialog()     (تصل «أدويتي» جدولًا مقترحًا)
 *   المريض يوافق على العرض، ثم الصرف كأي طلب.
 *
 * showPrescription() تعرض الصورة نفسها للطرفين (للمريض صاحبها وللصيدلية المرسلة إليها فقط).
 */

import { inventory, newIdempotencyKey, orders } from "./api.js";
import { $, $$, cx, debounce, html, render } from "./dom.js";
import { count, formatMoney } from "./format.js";
import { icon } from "./icons.js";
import { alternativeOf } from "./medication.js";
import { dosageForm, errorMessage, packUnit, weekdays } from "./text.js";
import { alertBox, button, errorState, field, iconButton, loading, openModal, setAlert, setBusy, toast } from "./ui.js";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "application/pdf"];

// ----------------------------------------------------------------------------- الصورة

/** صورة الوصفة داخل container. load: orders.prescription(id) أو orders.pharmacyPrescription(id). */
export async function showPrescription(container, load) {
  render(container, loading("نحمّل صورة الوصفة…"));
  let file;
  try {
    file = await load();
  } catch (error) {
    render(container, errorState(error));
    return;
  }
  const url = URL.createObjectURL(file.blob);
  render(
    container,
    file.type.startsWith("application/pdf")
      ? html`<div class="rx-file">
          <span class="tile">${icon("file_text", 22)}</span>
          <div class="stack stack--xs">
            <div class="semi">الوصفة ملف PDF</div>
            <a class="btn btn--soft btn--sm" href="${url}" target="_blank" rel="noopener">${icon("external_link", 16)}فتح الملف</a>
          </div>
        </div>`
      : html`<a class="rx-photo" href="${url}" target="_blank" rel="noopener" title="فتح الصورة بحجمها الكامل">
          <img src="${url}" alt="صورة الوصفة">
          <span class="rx-photo__hint">${icon("external_link", 14)}اضغط للتكبير</span>
        </a>`,
  );
}

// ----------------------------------------------------------------------------- إرسال الوصفة (المريض)

/** نافذة إرسال صورة وصفة إلى pharmacy ({ id, name }). بعد الإرسال تفتح صفحة الطلب. */
export function openPrescriptionDialog({ pharmacy }) {
  let file = null;
  let preview = null;
  // مفتاح لكل محاولة بنفس الملف والملاحظة: إعادة الضغط بعد انقطاع لا تنشئ طلبين.
  let key = newIdempotencyKey();
  const modal = openModal({
    title: "إرسال صورة وصفة",
    onClose: () => preview && URL.revokeObjectURL(preview),
    body: html`<div class="stack">
      <div data-slot="error" hidden></div>
      <p class="small soft">إلى <bdi class="semi">${pharmacy.name}</bdi>. يقرأ الصيدلي الوصفة، ويختار أدويتها من مخزونه ويعلّم ما ليس عنده، ثم يصلك العرض بسعره لتوافق عليه قبل الصرف.</p>
      <button type="button" class="rx-drop" data-action="pick">
        <span class="rx-drop__body" data-slot="preview">
          <span class="tile">${icon("camera", 22)}</span>
          <span class="semi">صوّر الوصفة أو اختر صورة</span>
          <span class="tiny muted">JPEG أو PNG أو PDF، حتى 5 MB</span>
        </span>
      </button>
      <input type="file" name="file" hidden accept="image/jpeg,image/png,application/pdf">
      ${field("ملاحظة للصيدلي (اختيارية)", "note", { multiline: true, maxLength: 500, hint: "مثل: أحتاجها اليوم، أو: علبة واحدة من كل دواء" })}
      ${alertBox("note", "المنصة لا تقرأ الوصفة آليًا: الصيدلي يقرؤها بنفسه. تأكد أن الصورة واضحة وكاملة.")}
    </div>`,
    footer: html`${button("إلغاء", { variant: "quiet", action: "cancel" })}${button("إرسال الوصفة", { variant: "primary", icon: "send", action: "send" })}`,
  });
  const root = modal.root;
  const input = $("[name=file]", root);
  const send = $("[data-action=send]", root);
  const errorBox = $("[data-slot=error]", root);
  send.disabled = true;

  $("[data-action=pick]", root).addEventListener("click", () => input.click());
  $("[data-action=cancel]", root).addEventListener("click", modal.close);
  $("[name=note]", root).addEventListener("input", () => (key = newIdempotencyKey()));
  input.addEventListener("change", () => {
    const chosen = input.files?.[0];
    input.value = "";
    if (!chosen) return;
    if (!TYPES.includes(chosen.type)) {
      setAlert(errorBox, "error", "نوع الملف غير مدعوم. المسموح: صورة JPEG أو PNG، أو ملف PDF.");
      return;
    }
    if (chosen.size > MAX_BYTES) {
      setAlert(errorBox, "error", "الملف أكبر من 5 MB. صوّر الوصفة من جديد بدقة أقل.");
      return;
    }
    setAlert(errorBox, "error", "");
    file = chosen;
    key = newIdempotencyKey();
    if (preview) URL.revokeObjectURL(preview);
    preview = chosen.type === "application/pdf" ? null : URL.createObjectURL(chosen);
    render(
      $("[data-slot=preview]", root),
      preview
        ? html`<img class="rx-drop__image" src="${preview}" alt="الوصفة المختارة"><span class="tiny muted">اضغط لاختيار صورة أخرى</span>`
        : html`<span class="tile">${icon("file_text", 22)}</span><span class="semi"><bdi>${chosen.name}</bdi></span><span class="tiny muted">اضغط لاختيار ملف آخر</span>`,
    );
    send.disabled = false;
  });

  send.addEventListener("click", async () => {
    const note = $("[name=note]", root).value.trim();
    setBusy(send, true);
    let created;
    try {
      created = await orders.sendPrescription(pharmacy.id, file, note, key);
    } catch (error) {
      setBusy(send, false);
      setAlert(errorBox, "error", errorMessage(error));
      return;
    }
    toast.later("أُرسلت الوصفة. يصلك إشعار حين يجهز عرض الصيدلية.");
    location.href = `/patient/orders/${created.id}`;
  });
  return modal;
}

// ----------------------------------------------------------------------------- طريقة الاستعمال (الصيدلية)

const DEFAULT_PLAN = { days_of_week: [1, 2, 3, 4, 5, 6, 7], times: [{ time: "08:00", dose_amount: "1" }], duration_days: null, instructions: null };

/**
 * نافذة «طريقة الاستعمال» لصنف في الطلب: الأيام، والأوقات وكمية كل جرعة، والمدة، وتعليمات.
 * تصل المريض جدولًا مقترحًا في «أدويتي» (مع الصرف، أو فورًا إن كان الطلب مصروفًا).
 * onSaved(order) بالطلب بعد الحفظ.
 */
export function openDosePlanDialog({ order, item, onSaved }) {
  const start = item.dose_plan ?? DEFAULT_PLAN;
  let days = [...start.days_of_week];
  let times = start.times.map((t) => ({ ...t }));
  const unit = packUnit[item.pack_unit] ?? item.pack_unit;
  const dispensed = order.status === "DISPENSED";
  const modal = openModal({
    title: `طريقة استعمال ${item.brand_name} ${item.strength}`,
    body: html`<div class="stack">
      <div data-slot="error" hidden></div>
      ${alertBox(
        "info",
        dispensed
          ? "الطلب مصروف: تصل المريض الآن جدولًا مقترحًا جديدًا في «أدويتي»، ولا يعمل حتى يفعّله."
          : "تصل المريض مع الصرف جدولًا مقترحًا في «أدويتي»، ولا يذكّره حتى يفعّله هو.",
      )}
      <div class="field">
        <span class="field__label">الأيام</span>
        <div class="chips" role="group" aria-label="الأيام" data-slot="days"></div>
      </div>
      <div class="field">
        <span class="field__label">الأوقات والكمية في كل جرعة (${unit})</span>
        <div class="stack stack--sm">
          <div class="stack stack--sm" data-slot="times"></div>
          <div data-slot="duplicate" hidden></div>
          <div>${button("إضافة وقت", { size: "sm", variant: "soft", icon: "plus", action: "add-time" })}</div>
        </div>
      </div>
      <div class="grid grid--2 grid--keep">
        ${field("المدة بالأيام", "duration_days", { type: "number", value: start.duration_days ?? "", min: 1, max: 365, step: 1, hint: "اتركها فارغة إن كان الدواء مستمرًا" })}
        ${field("تعليمات", "instructions", { value: start.instructions ?? "", maxLength: 300, placeholder: "مثل: بعد الأكل" })}
      </div>
      <p class="tiny muted">اكتب ما وصفه الطبيب في الوصفة. المنصة لا تقترح جرعات من عندها.</p>
    </div>`,
    footer: html`${item.dose_plan && !dispensed ? button("حذف طريقة الاستعمال", { variant: "danger-outline", action: "remove" }) : ""}
      <span class="grow"></span>
      ${button("إلغاء", { variant: "quiet", action: "cancel" })}${button(dispensed ? "إرسال للمريض" : "حفظ", { variant: "primary", action: "save" })}`,
  });
  const root = modal.root;
  const save = $("[data-action=save]", root);
  const errorBox = $("[data-slot=error]", root);
  $("[data-action=cancel]", root).addEventListener("click", modal.close);

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
        if (!days.includes(value)) days = [...days, value];
        else if (days.length > 1) days = days.filter((d) => d !== value);
        drawDays();
      }),
    );
  }

  function checkDuplicate() {
    const duplicate = new Set(times.map((t) => t.time)).size !== times.length;
    setAlert($("[data-slot=duplicate]", root), "warning", duplicate ? "وقت مكرر." : "");
    save.disabled = duplicate;
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
    times = [...times, { time: "20:00", dose_amount: times.at(-1)?.dose_amount ?? "1" }];
    drawTimes();
  });

  async function submit(plan, buttonElement) {
    setBusy(buttonElement, true);
    let updated;
    try {
      updated = await orders.setDosePlan(order.id, item.id, plan);
    } catch (error) {
      setBusy(buttonElement, false);
      setAlert(errorBox, "error", errorMessage(error));
      return;
    }
    toast.success(plan ? (dispensed ? "أُرسل الجدول المقترح للمريض" : "حُفظت طريقة الاستعمال") : "حُذفت طريقة الاستعمال");
    modal.close();
    onSaved?.(updated);
  }

  save.addEventListener("click", () => {
    const duration = $("[name=duration_days]", root).value.trim();
    const instructions = $("[name=instructions]", root).value.trim();
    submit(
      {
        days_of_week: [...days].sort(),
        times: times.map((t) => ({ time: t.time, dose_amount: String(t.dose_amount) })),
        ...(duration ? { duration_days: Number(duration) } : {}),
        ...(instructions ? { instructions } : {}),
      },
      save,
    );
  });
  $("[data-action=remove]", root)?.addEventListener("click", (event) => submit(null, event.currentTarget));

  drawDays();
  drawTimes();
  return modal;
}

// ----------------------------------------------------------------------------- عرض الوصفة (الصيدلية)

/**
 * الصيدلي يختار أدوية الوصفة من مخزونه (بالبحث فيه) بكمياتها، ويكتب ما ليس عنده، ثم يرسل العرض.
 * الأسعار من المخزون الآن، ولا يُخصم شيء قبل «قبول وصرف». onQuoted(order) بعد الإرسال.
 */
export function mountQuoteBuilder(container, { order, onQuoted }) {
  /** [{ item: صنف المخزون, quantity }] */
  let lines = [];
  let missing = [];
  let ask = 0;

  render(
    container,
    html`<div class="card">
      <div class="card__head">
        <div>
          <h3>أدوية الوصفة</h3>
          <div class="small muted">اقرأ الوصفة، واختر ما عندك من مخزونك بكمياته، واكتب ما ليس عندك.</div>
        </div>
      </div>
      <div class="card__body stack">
        <div data-slot="error" hidden></div>
        ${field("ابحث في مخزونك", "q", { icon: "search", dir: "auto", placeholder: "اسم الدواء كما في الوصفة" })}
        <div data-slot="results"></div>
        <div data-slot="lines"></div>
        <div class="field">
          <span class="field__label">ليس عندي (من الوصفة)</span>
          <div class="inline-form">
            <div class="field"><div class="field__control"><input class="input" name="missing" dir="auto" maxlength="150" placeholder="مثل: Augmentin 1 g" aria-label="اسم دواء ليس عندك"></div></div>
            ${button("إضافة", { variant: "outline", action: "add-missing", className: "btn--tall" })}
          </div>
          <div class="cluster" data-slot="missing" style="margin-top: 8px"></div>
        </div>
        <div class="between quote-total"><span class="semi">الإجمالي</span><span class="price" data-slot="total"></span></div>
        ${alertBox("note", "الأسعار من مخزونك الآن. لا يُخصم شيء حتى يوافق المريض وتضغط «قبول وصرف». بعد الإرسال تستطيع كتابة طريقة الاستعمال لكل دواء.")}
        <div>${button("إرسال العرض للمريض", { variant: "primary", icon: "send", action: "send-quote" })}</div>
      </div>
    </div>`,
  );
  const box = container.firstElementChild;
  const send = $("[data-action=send-quote]", box);
  const errorBox = $("[data-slot=error]", box);
  const qInput = $("[name=q]", box);
  const missingInput = $("[name=missing]", box);

  const lineTotal = (line) => Number(line.item.unit_price) * line.quantity;
  const maxFor = (item) => Math.max(1, Math.min(100, item.quantity));

  function drawLines() {
    render(
      $("[data-slot=lines]", box),
      lines.length === 0
        ? html`<p class="small muted">لم تختر أدوية بعد.</p>`
        : html`<div class="rows quote-lines">${lines.map(
            (line, index) => html`<div class="row quote-line" data-line="${index}">
              <div class="grow">
                <div class="semi"><bdi>${line.item.medication.brand_name} ${line.item.medication.strength}</bdi></div>
                <div class="tiny muted">${dosageForm[line.item.medication.dosage_form] ?? line.item.medication.dosage_form} · ${formatMoney(line.item.unit_price, line.item.currency)} للعلبة · عندك ${count(line.item.quantity, "box")}</div>
              </div>
              <label class="quote-line__qty">
                <span class="tiny muted">العلب</span>
                <input class="input input--sm" type="number" name="quantity" min="1" max="${maxFor(line.item)}" step="1" value="${line.quantity}" aria-label="عدد العلب">
              </label>
              <span class="price nowrap" data-slot="line-total">${formatMoney(lineTotal(line), line.item.currency)}</span>
              ${iconButton("trash_2", "إزالة", { danger: true, data: { drop: index } })}
            </div>`,
          )}</div>`,
    );
    $$("[data-line]", box).forEach((row) => {
      const line = lines[Number(row.dataset.line)];
      const input = $("[name=quantity]", row);
      // تحديث في مكانه لا رسم من جديد: change يأتي مع blur، ورسم القائمة حينها يحذف الحقل أثناء مغادرته.
      input.addEventListener("change", () => {
        const n = Math.trunc(Number(input.value));
        line.quantity = Number.isFinite(n) ? Math.max(1, Math.min(maxFor(line.item), n)) : 1;
        input.value = String(line.quantity);
        $("[data-slot=line-total]", row).textContent = formatMoney(lineTotal(line), line.item.currency);
        drawTotal();
      });
    });
    $$("[data-drop]", box).forEach((el) =>
      el.addEventListener("click", () => {
        lines.splice(Number(el.dataset.drop), 1);
        drawLines();
        search();
      }),
    );
    drawTotal();
  }

  function drawTotal() {
    const currency = lines[0]?.item.currency;
    $("[data-slot=total]", box).textContent = formatMoney(lines.reduce((sum, line) => sum + lineTotal(line), 0), currency);
    send.disabled = lines.length === 0;
  }

  function drawMissing() {
    render(
      $("[data-slot=missing]", box),
      missing.map(
        (name, index) => html`<span class="chip-removable"><bdi>${name}</bdi><button type="button" aria-label="إزالة ${name}" data-unmiss="${index}">${icon("x", 14)}</button></span>`,
      ),
    );
    $$("[data-unmiss]", box).forEach((el) =>
      el.addEventListener("click", () => {
        missing.splice(Number(el.dataset.unmiss), 1);
        drawMissing();
      }),
    );
  }

  function addMissing() {
    const name = missingInput.value.split(/\s+/).filter(Boolean).join(" ");
    if (name.length < 2) return;
    if (missing.some((m) => m.toLowerCase() === name.toLowerCase())) {
      missingInput.value = "";
      return;
    }
    if (missing.length >= 20) {
      toast.error("20 دواءً على الأكثر.");
      return;
    }
    missing = [...missing, name];
    missingInput.value = "";
    drawMissing();
  }
  $("[data-action=add-missing]", box).addEventListener("click", addMissing);
  missingInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addMissing();
    }
  });

  async function search() {
    const mine = ++ask;
    const q = qInput.value.trim();
    const results = $("[data-slot=results]", box);
    if (q.length < 2) {
      render(results, "");
      return;
    }
    render(results, loading("نبحث في مخزونك…"));
    let found;
    try {
      // [قرار المستخدم] ومعها بدائل ما يطابق الاسم (نفس التركيبة) الموجودة في مخزونك.
      found = await inventory.list({ q, limit: 8, with_alternatives: true });
    } catch (error) {
      if (mine === ask) render(results, errorState(error));
      return;
    }
    if (mine !== ask) return;
    const chosen = new Set(lines.map((line) => line.item.id));
    const groups = found.alternatives ?? [];
    const inResults = new Set(found.items.map((item) => item.medication_id));
    const all = [...found.items, ...groups.flatMap((group) => group.items)];
    const itemRow = (item, of = null) => {
      const reason = chosen.has(item.id) ? "مضاف" : !item.is_available ? "موقوف" : item.quantity < 1 ? "نفد" : "";
      return html`<div class="${of ? "row is-alt" : "row"}">
        <div class="grow">
          ${of ? alternativeOf(of) : ""}
          <div class="semi"><bdi>${item.medication.brand_name} ${item.medication.strength}</bdi></div>
          <div class="tiny muted">${dosageForm[item.medication.dosage_form] ?? item.medication.dosage_form} · ${formatMoney(item.unit_price, item.currency)} · عندك ${count(item.quantity, "box")}</div>
        </div>
        ${reason ? html`<span class="tiny muted">${reason}</span>` : button("إضافة", { size: "sm", variant: "soft", icon: "plus", data: { pick: item.id } })}
      </div>`;
    };
    const groupRows = (group) => group.items.map((item) => itemRow(item, group.medication));
    render(
      results,
      all.length === 0
        ? html`<p class="small muted">لا شيء بهذا الاسم في مخزونك، ولا بديل له. إن كان في الوصفة فاكتبه في «ليس عندي».</p>`
        : html`<div class="rows quote-results">
            ${found.items.map((item) => html`${itemRow(item)}${groups.filter((g) => g.medication.id === item.medication_id).map(groupRows)}`)}
            ${groups
              .filter((g) => !inResults.has(g.medication.id))
              .map(
                (g) => html`<div class="row"><p class="small soft">ليس عندك <bdi class="semi">${g.medication.brand_name} ${g.medication.strength}</bdi>، وعندك بديله:</p></div>${groupRows(g)}`,
              )}
          </div>`,
    );
    $$("[data-pick]", results).forEach((el) =>
      el.addEventListener("click", () => {
        const item = all.find((i) => i.id === el.dataset.pick);
        if (lines.length >= 20) {
          toast.error("20 دواءً على الأكثر في الطلب.");
          return;
        }
        lines = [...lines, { item, quantity: 1 }];
        drawLines();
        qInput.value = "";
        render(results, "");
        qInput.focus();
      }),
    );
  }
  qInput.addEventListener("input", debounce(search, 300));

  send.addEventListener("click", async () => {
    setBusy(send, true);
    let updated;
    try {
      updated = await orders.quote(order.id, {
        items: lines.map((line) => ({ medication_id: line.item.medication_id, quantity: line.quantity })),
        ...(missing.length ? { missing } : {}),
      });
    } catch (error) {
      setBusy(send, false);
      send.disabled = lines.length === 0;
      setAlert(errorBox, "error", errorMessage(error));
      return;
    }
    toast.success("أُرسل العرض للمريض. يصلك إشعار حين يوافق.");
    onQuoted?.(updated);
  });

  drawLines();
  drawMissing();
}
