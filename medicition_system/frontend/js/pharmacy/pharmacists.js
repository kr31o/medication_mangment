/**
 * الصيادلة العاملون في الصيدلية: القائمة، إضافة صيدلي، وتفعيل/إيقاف «على رأس العمل».
 * رقم مزاولة المهنة يولّده النظام عند الإضافة ولا يُكتب باليد.
 */

import { pharmacies } from "../shared/api.js";
import { $, html, render } from "../shared/dom.js";
import { startPage } from "../shared/layout.js";
import { errorMessage, fieldErrors } from "../shared/text.js";
import { button, emptyState, errorState, field, loading, onSwitch, openModal, setAlert, setBusy, showFieldErrors, switchControl, toast } from "../shared/ui.js";

await startPage("PHARMACY");

async function load() {
  const box = $("#list");
  let list;
  try {
    list = await pharmacies.pharmacists();
  } catch (error) {
    render(box, html`<div class="card__body">${errorState(error)}</div>`);
    return;
  }
  render(
    box,
    list.length === 0
      ? emptyState({ icon: "id_card", title: "لم تُضف صيادلة بعد" })
      : html`<div class="table-wrap">
          <table class="table table--stack">
            <thead><tr><th>الاسم</th><th>رقم مزاولة المهنة</th><th>الهاتف</th><th>على رأس العمل</th></tr></thead>
            <tbody>
              ${list.map(
                (p) => html`<tr class="${p.is_active ? "" : "is-dim"}">
                  <td class="semi cell-main">${p.full_name}</td>
                  <td data-label="رقم مزاولة المهنة"><bdi dir="ltr">${p.license_number}</bdi></td>
                  <td data-label="الهاتف"><bdi dir="ltr">${p.phone ?? "—"}</bdi></td>
                  <td data-label="على رأس العمل">${switchControl({ checked: p.is_active, label: `على رأس العمل: ${p.full_name}`, action: "active", data: { id: p.id } })}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>`,
  );
}

onSwitch($("#list"), {
  active: async (input) => {
    input.disabled = true;
    try {
      await pharmacies.updatePharmacist(input.dataset.id, { is_active: input.checked });
    } catch (error) {
      toast.error(error);
    }
    load();
  },
});

$("#add").addEventListener("click", () => {
  const modal = openModal({
    title: "إضافة صيدلي",
    size: "sm",
    body: html`<div class="stack">
      <div data-slot="error" hidden></div>
      ${field("الاسم الكامل", "full_name")}
      ${field("الهاتف", "phone", { placeholder: "+963944000000", hint: "اختياري", dir: "ltr" })}
      <p class="small soft">رقم مزاولة المهنة يولّده النظام تلقائيًا عند الإضافة.</p>
    </div>`,
    footer: html`${button("إلغاء", { variant: "quiet", action: "cancel" })}${button("إضافة", { variant: "primary", action: "save", disabled: true })}`,
  });
  const root = modal.root;
  const name = $("[name=full_name]", root);
  const phone = $("[name=phone]", root);
  const save = $("[data-action=save]", root);
  $("[data-action=cancel]", root).addEventListener("click", modal.close);
  name.addEventListener("input", () => (save.disabled = !name.value.trim()));
  save.addEventListener("click", async () => {
    setBusy(save, true);
    try {
      const pharmacist = await pharmacies.addPharmacist({ full_name: name.value, ...(phone.value ? { phone: phone.value } : {}) });
      toast.success(`أُضيف الصيدلي برقم المزاولة ${pharmacist.license_number}`);
      modal.close();
      load();
    } catch (error) {
      setBusy(save, false);
      setAlert($("[data-slot=error]", root), "error", errorMessage(error));
      showFieldErrors(root, fieldErrors(error));
    }
  });
});

render($("#list"), loading());
load();
