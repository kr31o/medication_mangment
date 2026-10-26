/** كتالوج الأدوية (للأدمن): تعريف الدواء وتصنيفه فقط؛ الكميات والأسعار تخص كل صيدلية في مخزونها. */

import { medications } from "../shared/api.js";
import { $, debounce, html, onAction, render } from "../shared/dom.js";
import { count } from "../shared/format.js";
import { startPage } from "../shared/layout.js";
import { categoryBadge, CATEGORY_OPTIONS } from "../shared/medication.js";
import { dosageForm, errorMessage, fieldErrors, packUnit } from "../shared/text.js";
import {
  badge,
  button,
  emptyState,
  errorState,
  field,
  iconButton,
  loading,
  onSwitch,
  openModal,
  renderPager,
  selectField,
  setAlert,
  setBusy,
  showFieldErrors,
  switchControl,
  toast,
} from "../shared/ui.js";

await startPage("ADMIN");

const PAGE_SIZE = 25;
const FIELDS = ["brand_name", "generic_name", "strength", "dosage_form", "category", "manufacturer", "pack_size", "pack_unit", "description"];
// حقلان اختياريان: فارغان لا يُرسلان عند الإضافة، ويُرسلان null عند التعديل ليُمسحا.
const OPTIONAL = ["manufacturer", "description"];
const REQUIRED = ["brand_name", "generic_name", "strength", "pack_size", "category"];
const FORM_OPTIONS = Object.entries(dosageForm).map(([value, label]) => ({ value, label }));
const UNIT_OPTIONS = Object.entries(packUnit).map(([value, label]) => ({ value, label }));

let page = 1;
let items = [];
let ask = 0;

async function load() {
  const mine = ++ask;
  const box = $("#list");
  render(box, loading());
  let result;
  try {
    result = await medications.search({
      q: $("#q").value.trim() || undefined,
      category: $("#category").value || undefined,
      include_inactive: true,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    });
  } catch (error) {
    if (mine === ask) render(box, html`<div class="card__body">${errorState(error)}</div>`);
    return;
  }
  if (mine !== ask) return;
  items = result.items;
  if (items.length === 0) {
    render(box, emptyState({ title: "لا نتائج" }));
    render($("#pager"), "");
    return;
  }
  render(
    box,
    html`<div class="table-wrap">
      <table class="table table--hover table--stack">
        <thead><tr><th>الاسم التجاري</th><th>الاسم العلمي</th><th>الشركة</th><th>التصنيف</th><th>الشكل</th><th>العلبة</th><th>الحالة</th><th></th></tr></thead>
        <tbody>
          ${items.map(
            (m, index) => html`<tr class="${m.is_active ? "" : "is-dim"}">
              <td class="cell-main"><bdi dir="ltr" class="semi">${m.brand_name} ${m.strength}</bdi></td>
              <td data-label="الاسم العلمي"><bdi dir="ltr">${m.generic_name}</bdi></td>
              <td data-label="الشركة">${m.manufacturer ?? "—"}</td>
              <td data-label="التصنيف">${categoryBadge(m.category)}</td>
              <td data-label="الشكل">${dosageForm[m.dosage_form]}</td>
              <td class="nowrap" data-label="العلبة">${count(m.pack_size, m.pack_unit)}</td>
              <td data-label="الحالة">
                <div class="cluster">
                  ${switchControl({ checked: Boolean(m.is_active), label: `تفعيل ${m.brand_name}`, action: "active", data: { index } })}
                  ${badge(m.is_active ? "green" : "neutral", m.is_active ? "نشط" : "معطل")}
                </div>
              </td>
              <td class="cell-actions">${iconButton("pencil", "تعديل", { action: "edit", data: { index } })}</td>
            </tr>`,
          )}
        </tbody>
      </table>
    </div>`,
  );
  renderPager($("#pager"), { page, pageSize: PAGE_SIZE, total: result.total }, (next) => {
    page = next;
    load();
  });
}

onSwitch($("#list"), {
  active: async (input) => {
    const m = items[Number(input.dataset.index)];
    input.disabled = true;
    try {
      await medications.update(m.id, { is_active: !m.is_active });
    } catch (error) {
      toast.error(error);
    }
    load();
  },
});

onAction($("#list"), { edit: (el) => openEditor(items[Number(el.dataset.index)]) });
$("#add").addEventListener("click", () => openEditor(null));

/** نافذة دواء جديد أو تعديل دواء. */
function openEditor(medication) {
  const value = (key, fallback = "") => String(medication?.[key] ?? fallback);
  const modal = openModal({
    title: medication ? "تعديل دواء" : "دواء جديد",
    body: html`<div class="stack">
      <div data-slot="error" hidden></div>
      <div class="grid grid--2">
        ${field("الاسم التجاري", "brand_name", { value: value("brand_name"), dir: "ltr" })}
        ${field("الاسم العلمي", "generic_name", { value: value("generic_name"), dir: "ltr", placeholder: "Paracetamol + Caffeine", hint: "عدة مواد: افصل بينها بـ +" })}
        ${field("التركيز", "strength", { value: value("strength"), placeholder: "500 mg / 65 mg", dir: "ltr", hint: "كمية كل مادة بترتيب المواد نفسه" })}
        ${selectField("الشكل الدوائي", "dosage_form", FORM_OPTIONS, { value: value("dosage_form", "TABLET") })}
        ${field("عدد الوحدات في العلبة", "pack_size", { type: "number", value: value("pack_size"), min: 0.01, step: "any" })}
        ${selectField("وحدة العد", "pack_unit", UNIT_OPTIONS, { value: value("pack_unit", "TABLET") })}
      </div>
      ${selectField("التصنيف", "category", [{ value: "", label: "اختر التصنيف" }, ...CATEGORY_OPTIONS], {
        // دواء جديد يبدأ بلا تصنيف: الأدمن يختاره صراحة، فلا يدخل الكتالوج شيء تحت «أخرى» سهوًا.
        value: value("category"),
        required: true,
        hint: "به يتصفح المريض الأدوية، وبه تفلتر الصيدلية مخزونها",
      })}
      ${field("الشركة المصنّعة", "manufacturer", { value: value("manufacturer"), placeholder: "مثل: يونيفارما", hint: "اختياري. يظهر للمريض والصيدلية بجانب اسم الدواء" })}
      ${field("وصف مختصر (الفئة الدوائية)", "description", { value: value("description"), multiline: true })}
    </div>`,
    footer: html`${button("إلغاء", { variant: "quiet", action: "cancel" })}${button("حفظ", { variant: "primary", action: "save" })}`,
  });
  const root = modal.root;
  const save = $("[data-action=save]", root);
  const form = () => Object.fromEntries(FIELDS.map((key) => [key, $(`[name=${key}]`, root).value]));
  const refresh = () => (save.disabled = REQUIRED.some((key) => !form()[key]));
  root.addEventListener("input", refresh);
  root.addEventListener("change", refresh);
  $("[data-action=cancel]", root).addEventListener("click", modal.close);
  refresh();

  save.addEventListener("click", async () => {
    const values = form();
    let request;
    if (!medication) {
      OPTIONAL.forEach((key) => {
        if (!values[key].trim()) delete values[key];
      });
      request = medications.create(values);
    } else {
      // التعديل يرسل الحقول التي تغيّرت فقط.
      const changes = Object.fromEntries(FIELDS.filter((key) => values[key] !== value(key)).map((key) => [key, values[key]]));
      OPTIONAL.forEach((key) => {
        if (key in changes && !changes[key].trim()) changes[key] = null;
      });
      request = medications.update(medication.id, changes);
    }
    setBusy(save, true);
    try {
      await request;
    } catch (error) {
      setBusy(save, false);
      refresh();
      setAlert($("[data-slot=error]", root), "error", errorMessage(error));
      showFieldErrors(root, fieldErrors(error));
      return;
    }
    toast.success(medication ? "حُفظ الدواء" : "أُضيف الدواء للكتالوج");
    modal.close();
    load();
  });
}

render($("#category"), html`<option value="">كل التصنيفات</option>${CATEGORY_OPTIONS.map((o) => html`<option value="${o.value}">${o.label}</option>`)}`);
const reload = () => {
  page = 1;
  load();
};
$("#q").addEventListener("input", debounce(reload, 300));
$("#category").addEventListener("change", reload);
load();
