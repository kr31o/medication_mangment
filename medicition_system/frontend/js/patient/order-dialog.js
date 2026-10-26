/** نافذة إرسال طلب إلى صيدلية (من البحث ومن صفحة الصيدلية): أسطر الأدوية والكميات، ملاحظة، ثم الإرسال. */

import { newIdempotencyKey, orders } from "../shared/api.js";
import { $, $$, html, render } from "../shared/dom.js";
import { formatMoney } from "../shared/format.js";
import { createMedicationPicker, medicationLabel } from "../shared/medication.js";
import { errorMessage, fieldErrors } from "../shared/text.js";
import { alertBox, button, field, iconButton, openModal, setAlert, setBusy, stepper, toast } from "../shared/ui.js";

/**
 * pharmacy: { id, name }
 * initial: { medication, quantity, unitPrice, currency }: الدواء الذي بحث عنه المريض (اختياري).
 */
export function openOrderDialog({ pharmacy, initial }) {
  const lines = initial ? [{ medication: initial.medication, quantity: initial.quantity }] : [];
  let lineErrors = {};
  // مفتاح واحد لهذه المحاولة: الضغط مرتين أو إعادة الإرسال بعد انقطاع لا ينشئ طلبين.
  const idempotencyKey = newIdempotencyKey();

  const modal = openModal({
    title: `طلب من ${pharmacy.name}`,
    body: html`<div class="stack">
      <div data-slot="error" hidden></div>
      <div data-slot="lines" class="stack"></div>
      <div data-slot="picker"></div>
      ${field("ملاحظة للصيدلية", "note", { multiline: true, hint: "اختياري — مثل وقت الاستلام", maxLength: 500 })}
      ${initial?.unitPrice
        ? html`<p class="small muted">سعر العلبة الحالي لـ ${initial.medication.brand_name}: ${formatMoney(initial.unitPrice, initial.currency)} — السعر النهائي يُثبَّت لحظة إنشاء الطلب.</p>`
        : ""}
      ${alertBox("note", "لا دفع عبر المنصة ولا توصيل: تدفع وتستلم من الصيدلية مباشرة.")}
    </div>`,
    footer: html`${button("إلغاء", { variant: "quiet", action: "cancel" })}${button("إرسال الطلب", { variant: "primary", action: "send" })}`,
  });
  const root = modal.root;
  const send = $("[data-action=send]", root);
  $("[data-action=cancel]", root).addEventListener("click", modal.close);

  function drawLines() {
    const box = $("[data-slot=lines]", root);
    box.hidden = lines.length === 0;
    render(
      box,
      lines.map((line, index) => {
        const error = lineErrors[`items[${index}].medication_id`] ?? lineErrors[`items[${index}].quantity`];
        return html`<div class="line">
          <div class="grow">
            <div class="semi">${medicationLabel(line.medication)}</div>
            <div class="tiny" style="color: ${error ? "var(--coral-700)" : "var(--ink-3)"}">${error ?? line.medication.generic_name}</div>
          </div>
          <div data-stepper="${index}"></div>
          ${iconButton("trash_2", "حذف", { danger: true, disabled: lines.length === 1, data: { remove: index } })}
        </div>`;
      }),
    );
    $$("[data-stepper]", box).forEach((el) => {
      const line = lines[Number(el.dataset.stepper)];
      stepper(el, { label: "عدد العلب", value: line.quantity, min: 1, max: 100, onChange: (quantity) => (line.quantity = quantity) });
    });
    $$("[data-remove]", box).forEach((el) =>
      el.addEventListener("click", () => {
        lines.splice(Number(el.dataset.remove), 1);
        lineErrors = {};
        drawLines();
      }),
    );
    send.disabled = lines.length === 0;
  }

  createMedicationPicker($("[data-slot=picker]", root), {
    label: "إضافة دواء آخر من نفس الصيدلية",
    placeholder: "اكتب اسم الدواء",
    keepEmpty: true,
    exclude: () => new Set(lines.map((line) => line.medication.id)),
    onSelect: (medication) => {
      if (!medication) return;
      lines.push({ medication, quantity: 1 });
      drawLines();
    },
  });

  send.addEventListener("click", async () => {
    const note = root.querySelector("[name=note]").value.trim();
    setBusy(send, true);
    try {
      const order = await orders.place(
        {
          pharmacy_id: pharmacy.id,
          items: lines.map((line) => ({ medication_id: line.medication.id, quantity: line.quantity })),
          ...(note ? { note } : {}),
        },
        idempotencyKey,
      );
      toast.later("أُرسل طلبك إلى الصيدلية");
      location.assign(`/patient/orders/${order.id}`);
    } catch (error) {
      setBusy(send, false);
      lineErrors = fieldErrors(error);
      setAlert($("[data-slot=error]", root), "error", errorMessage(error));
      drawLines();
    }
  });

  drawLines();
}
