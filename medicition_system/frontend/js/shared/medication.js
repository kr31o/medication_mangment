/** الأدوية في الواجهة: اسم الدواء للعرض، أيقونة التصنيف وشارته، كبسولات الفلترة، وحقل اختيار دواء من الكتالوج. */

import { medications } from "./api.js";
import { $, $$, cx, debounce, html, render } from "./dom.js";
import { icon } from "./icons.js";
import { dosageForm, medicationCategory } from "./text.js";
import { iconButton } from "./ui.js";

/**
 * «Unadol 500 mg — أقراص». الاسم والتركيز بين علامتي عزل الاتجاه (FSI … PDI)، فيبقى
 * «0.05 %» بترتيبه داخل السطر العربي أينما وُضع النص (عنوان، خيار في قائمة).
 */
export const medicationLabel = (m) => `⁨${m.brand_name} ${m.strength}⁩ — ${dosageForm[m.dosage_form] ?? m.dosage_form}`;

const CATEGORY_ICONS = {
  ANALGESIC: "pill",
  ANTIBIOTIC: "bug",
  CARDIOVASCULAR: "heart_pulse",
  DIABETES: "droplet",
  RESPIRATORY: "wind",
  GASTROINTESTINAL: "utensils",
  ALLERGY: "flower_2",
  VITAMINS: "citrus",
  DERMATOLOGY: "hand",
  NEUROLOGY: "brain",
  HORMONAL: "activity",
  EYE_ENT: "eye",
  MUSCULOSKELETAL: "bone",
  OTHER: "package",
};

/** خيارات قائمة التصنيفات بترتيبها الثابت. */
export const CATEGORY_OPTIONS = Object.entries(medicationCategory).map(([value, label]) => ({ value, label }));

export const categoryIcon = (category, size = 16) => icon(CATEGORY_ICONS[category] ?? "package", size);

/** شارة صغيرة باسم التصنيف وأيقونته. */
export const categoryBadge = (category) =>
  html`<span class="cat-badge">${categoryIcon(category, 14)}${medicationCategory[category] ?? medicationCategory.OTHER}</span>`;

/**
 * صف كبسولات للفلترة بالتصنيف: «الكل» ثم كل تصنيف فيه أدوية، مع العدد.
 * counts: { CATEGORY: عدد }؛ التصنيف الذي لا أدوية فيه لا يظهر (إلا المختار الآن).
 * value: التصنيف المختار أو "" للكل. onChange(category) عند الضغط.
 */
export function renderCategoryChips(container, { value, counts = {}, label = "التصنيف" }, onChange) {
  const shown = Object.keys(medicationCategory).filter((category) => (counts[category] ?? 0) > 0 || category === value);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const chip = (key, text, n, mark) =>
    html`<button type="button" class="${cx("chip-toggle chip-toggle--cat", value === key && "is-active")}" aria-pressed="${value === key}" data-category="${key}">
      ${mark}<span>${text}</span><span class="chip-toggle__count num">${n}</span>
    </button>`;
  render(
    container,
    html`<div class="chip-row" role="group" aria-label="${label}">
      ${chip("", "الكل", total, "")}
      ${shown.map((category) => chip(category, medicationCategory[category], counts[category] ?? 0, categoryIcon(category)))}
    </div>`,
  );
  $$("[data-category]", container).forEach((el) => el.addEventListener("click", () => onChange(el.dataset.category)));
}

// ----------------------------------------------------------------------------- البدائل في القوائم [قرار المستخدم]

/**
 * نتائج بحث وتحت كل دواء بدائله (بنفس التركيبة): يرجع سطورًا بالترتيب
 *   { medication, of: null }            دواء من النتائج نفسها
 *   { medication, of: الدواء الأصل }     بديل له (ليس في النتائج، ويظهر مرة واحدة)
 *   { more: العدد، of: الدواء الأصل }     «و N بدائل غيرها» حين تزيد على max (expanded تفتحها كلها)
 * items: نتائج فيها alternatives (من medications.search بـ with_alternatives).
 */
export function withAlternatives(items, { max = 4, expanded = new Set() } = {}) {
  const seen = new Set(items.map((m) => m.id));
  const rows = [];
  for (const m of items) {
    rows.push({ medication: m, of: null });
    const fresh = (m.alternatives ?? []).filter((alt) => !seen.has(alt.id));
    fresh.forEach((alt) => seen.add(alt.id));
    const limit = expanded.has(m.id) ? fresh.length : max;
    fresh.slice(0, limit).forEach((alt) => rows.push({ medication: alt, of: m }));
    if (fresh.length > limit) rows.push({ more: fresh.length - limit, of: m });
  }
  return rows;
}

/** وسم سطر البديل: «بديل لـ Unadol 500 mg». */
export const alternativeOf = (of) =>
  html`<span class="alt-of">${icon("corner_down_left", 14)}بديل لـ <bdi>${of.brand_name} ${of.strength}</bdi></span>`;

let pickers = 0;

/**
 * حقل يبحث في كتالوج الأدوية أثناء الكتابة ويعرض النتائج تحته للاختيار.
 *   label / placeholder: نصوص الحقل.
 *   value: الدواء المختار (يُعرض مكان الحقل مع زر إزالة)؛ اتركه فارغًا لحقل «أضف وأكمل».
 *   keepEmpty: بعد الاختيار يبقى الحقل فارغًا لاختيار دواء آخر (لا يُعرض المختار مكانه).
 *   onSelect(medication | null).
 *   exclude(): معرّفات أدوية لا تظهر في النتائج (مختارة مسبقًا).
 * يرجع { setError(text) }.
 */
export function createMedicationPicker(container, { label, placeholder, value = null, keepEmpty = false, onSelect, exclude = () => new Set(), emptyText = "لا نتائج", hint = "" }) {
  let picked = value;
  let options = [];
  let active = 0;
  let open = false;
  let asked = 0;
  const id = `picker${++pickers}`;

  function showPicked() {
    render(
      container,
      html`<div class="field"><span class="field__label">${label}</span>
        <div class="combo__picked"><span>${medicationLabel(picked)}</span>${iconButton("x", "تغيير الدواء", { action: "unpick" })}</div>
      </div>`,
    );
    $("[data-action=unpick]", container).addEventListener("click", () => {
      picked = null;
      onSelect(null);
      showInput();
      $("input", container).focus();
    });
  }

  function choose(medication) {
    open = false;
    if (keepEmpty) {
      $("input", container).value = "";
      drawList();
      onSelect(medication);
      return;
    }
    picked = medication;
    onSelect(medication);
    showPicked();
  }

  function drawList(state = "ready") {
    const list = $(".combo__list", container);
    if (!open) {
      list.hidden = true;
      return;
    }
    list.hidden = false;
    if (state === "loading") return render(list, html`<div class="combo__empty">جارٍ البحث…</div>`);
    if (options.length === 0) return render(list, html`<div class="combo__empty">${emptyText}</div>`);
    render(
      list,
      options.map(
        (m, index) => html`<button type="button" role="option" aria-selected="${index === active}" class="${cx("combo__option", index === active && "is-active")}" data-index="${index}">
          <span class="semi">${medicationLabel(m)}</span>
          <span class="tiny muted" style="display: block">${[m.generic_name, m.manufacturer].filter(Boolean).join(" · ")}</span>
        </button>`,
      ),
    );
    $$("[data-index]", list).forEach((el) => el.addEventListener("click", () => choose(options[Number(el.dataset.index)])));
  }

  async function search(text) {
    const mine = ++asked;
    drawList("loading");
    try {
      const page = await medications.search({ q: text || undefined, limit: 20 });
      if (mine !== asked) return;
      const skip = exclude();
      options = page.items.filter((m) => !skip.has(m.id));
    } catch {
      if (mine !== asked) return;
      options = [];
    }
    active = 0;
    drawList();
  }
  const searchLater = debounce(search, 300);

  function showInput() {
    render(
      container,
      html`<div class="combo">
        <div class="field" data-field="medication">
          <label class="field__label" for="${id}">${label}</label>
          <div class="field__control field__control--icon">
            <span class="field__icon">${icon("search")}</span>
            <input id="${id}" class="input" role="combobox" aria-expanded="false" autocomplete="off" placeholder="${placeholder ?? ""}">
          </div>
          <span class="field__hint" data-hint="${hint}">${hint}</span>
        </div>
        <div class="combo__list" role="listbox" hidden></div>
      </div>`,
    );
    const input = $("input", container);
    const openList = () => {
      if (open) return;
      open = true;
      input.setAttribute("aria-expanded", "true");
      search(input.value.trim());
    };
    input.addEventListener("focus", openList);
    input.addEventListener("input", () => {
      open = true;
      input.setAttribute("aria-expanded", "true");
      drawList("loading");
      searchLater(input.value.trim());
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" && open) {
        event.preventDefault();
        active = Math.min(options.length - 1, active + 1);
        drawList();
      } else if (event.key === "ArrowUp" && open) {
        event.preventDefault();
        active = Math.max(0, active - 1);
        drawList();
      } else if (event.key === "Enter" && open && options[active]) {
        event.preventDefault();
        choose(options[active]);
      } else if (event.key === "Escape" && open) {
        event.stopPropagation();
        open = false;
        input.setAttribute("aria-expanded", "false");
        drawList();
      }
    });
  }

  if (picked) showPicked();
  else showInput();

  return {
    setError(text) {
      const box = $("[data-field=medication]", container);
      if (!box) return;
      box.classList.toggle("has-error", Boolean(text));
      const hintEl = $(".field__hint", box);
      hintEl.textContent = text || hintEl.dataset.hint;
    },
  };
}
