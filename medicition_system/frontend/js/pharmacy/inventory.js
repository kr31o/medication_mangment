/**
 * مخزون الصيدلية: الأصناف وأسعارها، إضافة أدوية (تصنيف ← مربعات اختيار)، حركة مخزون (توريد/تسوية)، وسجل الحركات.
 * الكمية لا تُعدَّل مباشرة: كل تغيير حركة مسجلة.
 *
 * الصيدلية توقف دواءً أو تفعّله: الدواء الموقوف يبقى في مخزونها بكميته وسعره، لكنه
 * يختفي عن المرضى ولا يُطلب حتى تفعّله من جديد.
 */

import { inventory, medications } from "../shared/api.js";
import { $, $$, cx, debounce, html, onAction, raw, render } from "../shared/dom.js";
import { count, currencyLabel, formatDateTime, formatMoney } from "../shared/format.js";
import { startPage } from "../shared/layout.js";
import { alternativeOf, categoryBadge, CATEGORY_OPTIONS, medicationLabel, renderCategoryChips, withAlternatives } from "../shared/medication.js";
import { errorMessage, fieldErrors, movementType } from "../shared/text.js";
import {
  badge,
  button,
  emptyState,
  errorState,
  field,
  iconButton,
  loading,
  openModal,
  renderPager,
  selectField,
  setAlert,
  setBusy,
  toast,
} from "../shared/ui.js";
import { activePharmacy } from "./mine.js";

await startPage("PHARMACY");

const PAGE_SIZE = 25;
const MOVEMENT_OPTIONS = [
  { value: "RESTOCK", label: "توريد (إضافة)" },
  { value: "ADJUSTMENT", label: "تسوية (جرد، تالف، منتهي الصلاحية)" },
];

let page = 1;
let items = [];
let editingPrice = null;
let ask = 0;

// ----------------------------------------------------------------------------- الجدول

function priceCell(item) {
  if (editingPrice === item.id) {
    return html`<form class="price-edit" data-price-form="${item.id}">
      <input class="input input--sm" type="number" min="0" step="any" aria-label="سعر العلبة" value="${item.unit_price}">
      ${iconButton("check", "حفظ السعر", { action: "save-price" })}
      ${iconButton("x", "تراجع", { action: "cancel-price" })}
    </form>`;
  }
  return button(formatMoney(item.unit_price, item.currency), { size: "sm", variant: "quiet", title: "اضغط لتعديل السعر", action: "edit-price", data: { id: item.id } });
}

function row(item) {
  const m = item.medication;
  return html`<tr class="${item.is_available ? "" : "is-stopped"}">
    <td class="cell-main">
      <div class="semi">${m ? html`<bdi>${m.brand_name} ${m.strength}</bdi>` : "—"}</div>
      <div class="tiny muted">${[m?.generic_name, m?.manufacturer].filter(Boolean).join(" · ")}</div>
      ${m?.category ? html`<div style="margin-top: 4px">${categoryBadge(m.category)}</div>` : ""}
    </td>
    <td data-label="الكمية">
      <div>
        <div class="cluster" style="--gap: 8px">
          <span class="${item.is_low_stock ? "strong qty--low num" : "strong num"}">${item.quantity}</span>
          ${item.is_low_stock ? badge("amber", "منخفض") : ""}
        </div>
        <div class="tiny muted">الحد ${item.low_stock_threshold}</div>
      </div>
    </td>
    <td data-label="سعر العلبة">${priceCell(item)}</td>
    <td data-label="الحالة">
      <div class="stop-cell">
        ${item.is_available ? badge("green", "معروض للمرضى") : badge("coral", "موقوف")}
        ${button(item.is_available ? "إيقاف" : "تفعيل", {
          size: "sm",
          variant: item.is_available ? "danger-outline" : "soft",
          icon: item.is_available ? "circle_pause" : "play",
          title: item.is_available ? "يختفي عن المرضى ولا يُطلب" : "يعود ظاهرًا للمرضى",
          action: "toggle",
          data: { id: item.id },
        })}
      </div>
    </td>
    <td class="nowrap cell-actions">
      ${iconButton("arrow_up_down", "توريد أو تسوية", { action: "move", data: { id: item.id } })}
      ${iconButton("history", "سجل الحركات", { action: "history", data: { id: item.id } })}
    </td>
  </tr>`;
}

function drawTable(total) {
  const filtered = $("#q").value.trim() || $("#low-only").checked || $("#category").value;
  if (items.length === 0) {
    render($("#list"), emptyState({ icon: "boxes", title: filtered ? "لا نتائج" : "المخزون فارغ", hint: "أضف الأدوية التي تبيعها ليجدها المرضى القريبون." }));
    render($("#pager"), "");
    return;
  }
  render(
    $("#list"),
    html`<div class="table-wrap">
      <table class="table table--hover table--stack">
        <thead><tr><th>الدواء</th><th>الكمية</th><th>سعر العلبة</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${items.map(row)}</tbody>
      </table>
    </div>`,
  );
  const form = $("[data-price-form]");
  if (form) {
    $("input", form).focus();
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      update(form.dataset.priceForm, { unit_price: $("input", form).value });
    });
  }
  if (total !== undefined) {
    renderPager($("#pager"), { page, pageSize: PAGE_SIZE, total }, (next) => {
      page = next;
      load(true);
    });
  }
}

async function load(fresh = false) {
  const mine = ++ask;
  if (fresh) render($("#list"), loading());
  const q = $("#q").value.trim();
  const category = $("#category").value;
  let result;
  try {
    result = await inventory.list({ q: q || undefined, category: category || undefined, low_stock: $("#low-only").checked || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  } catch (error) {
    if (mine !== ask) return;
    render($("#list"), html`<div class="card__body">${errorState(error, { retry: true })}</div>`);
    $("[data-action=retry]", $("#list")).addEventListener("click", () => load(true));
    return;
  }
  if (mine !== ask) return;
  items = result.items;
  editingPrice = null;
  drawTable(result.total);
}

/** تعديل صنف (السعر، أو الإيقاف والتفعيل). stopped: true عند الإيقاف، false عند التفعيل. */
async function update(id, body, stopped) {
  $$("[data-action=toggle]").forEach((b) => (b.disabled = true));
  try {
    await inventory.update(id, body);
    if (stopped === true) toast.success("أُوقف الدواء: لن يراه المرضى ولن يُطلب حتى تفعّله");
    if (stopped === false) toast.success("فُعّل الدواء: عاد ظاهرًا للمرضى");
  } catch (error) {
    toast.error(error);
  }
  load();
}

const itemOf = (el) => items.find((item) => item.id === el.dataset.id);

onAction($("#list"), {
  "edit-price": (el) => {
    editingPrice = el.dataset.id;
    drawTable();
  },
  "cancel-price": () => {
    editingPrice = null;
    drawTable();
  },
  "save-price": (el) => {
    const form = el.closest("form");
    update(form.dataset.priceForm, { unit_price: $("input", form).value });
  },
  toggle: (el) => {
    const item = itemOf(el);
    update(item.id, { is_available: !item.is_available }, item.is_available);
  },
  move: (el) => openMovement(itemOf(el)),
  history: (el) => openHistory(itemOf(el)),
});

// ----------------------------------------------------------------------------- إضافة أدوية

/**
 * [قرار المستخدم] الصيدلي يختار تصنيفًا فتظهر أدويته بمربعات اختيار، ويعلّم ما يريد (من أكثر من
 * تصنيف إن شاء)، لكل دواء كميته وسعر علبته، ثم تُضاف كلها بضغطة واحدة (كلها أو لا شيء).
 * ما في المخزون أصلًا يظهر «في مخزونك» بلا مربع.
 * [قرار المستخدم] البحث بالاسم يعرض تحت كل دواء بدائله بنفس التركيبة («بديل لـ …») بمربعاتها أيضًا.
 */
async function allStockedIds() {
  const ids = new Set();
  for (let offset = 0; ; offset += 100) {
    const result = await inventory.list({ limit: 100, offset });
    result.items.forEach((item) => ids.add(item.medication_id));
    if (offset + 100 >= result.total) return ids;
  }
}

$("#add").addEventListener("click", async () => {
  const chosen = new Map(); // medication_id → { medication, quantity, unit_price }
  let stocked = new Set();
  let category = "";
  let found = [];
  let shown = [];
  let expanded = new Set();
  let ask = 0;

  const modal = openModal({
    title: "إضافة أدوية للمخزون",
    size: "lg",
    body: html`<div class="stack">
      <div data-slot="error" hidden></div>
      <div data-slot="chips"></div>
      ${field("ابحث بالاسم", "q", { placeholder: "اسم الدواء التجاري أو العلمي", icon: "search", hint: "البحث بالاسم في كل التصنيفات، ومع كل دواء بدائله بنفس التركيبة" })}
      <div class="pick-list rows" data-slot="list">${loading()}</div>
    </div>`,
    footer: html`<span class="grow small soft pick-summary" data-slot="summary"></span>${button("إلغاء", { variant: "quiet", action: "cancel" })}${button("إضافة", { variant: "primary", action: "save", disabled: true })}`,
  });
  const root = modal.root;
  const list = $("[data-slot=list]", root);
  const save = $("[data-action=save]", root);
  const query = $("[name=q]", root);

  function refreshFooter() {
    const lines = [...chosen.values()];
    const ready = lines.length > 0 && lines.every((line) => line.unit_price !== "" && Number(line.unit_price) >= 0 && Number.isInteger(Number(line.quantity)) && Number(line.quantity) >= 0);
    save.disabled = !ready;
    save.textContent = lines.length ? `إضافة ${count(lines.length, "medication")}` : "إضافة";
    $("[data-slot=summary]", root).textContent = lines.length
      ? lines.some((line) => line.unit_price === "") ? "اكتب سعر العلبة لكل دواء مختار" : `المختار: ${count(lines.length, "medication")}`
      : "علّم الأدوية التي تريد إضافتها";
  }

  function row(m, of = null) {
    const line = chosen.get(m.id);
    const inStock = stocked.has(m.id);
    return html`<div class="${cx("pick", line && "is-picked", of && "is-alt")}" data-row="${m.id}">
      <label class="pick__main">
        <input type="checkbox" data-pick="${m.id}"${line ? raw(" checked") : ""}${inStock ? raw(" disabled") : ""}>
        <span>
          ${of ? alternativeOf(of) : ""}
          <span class="semi" style="display: block">${medicationLabel(m)}</span>
          <span class="tiny muted" style="display: block">${m.generic_name}${m.manufacturer ? ` · ${m.manufacturer}` : ""}</span>
        </span>
      </label>
      ${inStock
        ? badge("neutral", "في مخزونك")
        : line
          ? html`<div class="pick__inputs">
              <label class="pick__input"><span class="tiny soft">عدد العلب</span><input class="input input--sm" type="number" min="0" step="1" data-qty="${m.id}" value="${line.quantity}" aria-label="عدد العلب"></label>
              <label class="pick__input"><span class="tiny soft">سعر العلبة (${currencyLabel()})</span><input class="input input--sm" type="number" min="0" step="any" data-price="${m.id}" value="${line.unit_price}" aria-label="سعر العلبة"></label>
            </div>`
          : ""}
      <span class="field__hint pick__error" data-error="${m.id}"></span>
    </div>`;
  }

  function drawList() {
    // بحث بالاسم: كل دواء ثم بدائله (ليست في النتائج نفسها)؛ تصفّح التصنيف: الأدوية وحدها.
    const rows = query.value.trim() ? withAlternatives(found, { expanded }) : found.map((medication) => ({ medication, of: null }));
    shown = rows.filter((r) => r.medication).map((r) => r.medication);
    render(
      list,
      rows.length
        ? rows.map((r) =>
            r.more
              ? html`<button type="button" class="alt-more" data-more="${r.of.id}">عرض كل بدائل <bdi>${r.of.brand_name} ${r.of.strength}</bdi> (+${r.more})</button>`
              : row(r.medication, r.of),
          )
        : emptyState({
            icon: "search_x",
            title: "لا أدوية هنا",
            hint: query.value ? "جرّب اسمًا آخر أو تصنيفًا آخر. ليس في قائمة الأدوية؟ اطلب من الإدارة إضافته." : "",
            // [قرار المستخدم] دواء غير موجود في القائمة: طلب للإدارة باسمه.
            action: query.value.trim().length >= 2 ? button("اطلب إضافته", { variant: "soft", size: "sm", href: `/pharmacy/requests?type=NEW_MEDICATION&name=${encodeURIComponent(query.value.trim())}` }) : "",
          }),
    );
    refreshFooter();
  }

  async function loadList() {
    const mine = ++ask;
    render(list, loading());
    const items = [];
    try {
      // التصنيف كله صفحةً بعد صفحة (الخادم يعطي 100 في المرة): القلب وحده فيه أكثر من 180 دواءً.
      for (let offset = 0; offset < 1000; offset += 100) {
        const q = query.value.trim();
        // البحث بالاسم في كل التصنيفات (التصنيف المختار للتصفّح فقط)، ومع كل نتيجة بدائلها.
        const page = await medications.search({ category: q ? undefined : category || undefined, q: q || undefined, limit: 100, offset, with_alternatives: q ? true : undefined });
        if (mine !== ask) return;
        items.push(...page.items);
        if (items.length >= page.total || page.items.length === 0) break;
      }
    } catch (error) {
      if (mine === ask) render(list, errorState(error));
      return;
    }
    if (mine !== ask) return;
    found = items;
    expanded = new Set();
    drawList();
  }

  list.addEventListener("click", (event) => {
    const more = event.target.closest("[data-more]");
    if (!more) return;
    expanded.add(more.dataset.more);
    drawList();
  });
  list.addEventListener("change", (event) => {
    const id = event.target.dataset.pick;
    if (!id) return;
    if (event.target.checked) chosen.set(id, { medication: shown.find((m) => m.id === id), quantity: "10", unit_price: "" });
    else chosen.delete(id);
    drawList();
    if (event.target.checked) $(`[data-price="${id}"]`, list)?.focus();
  });
  list.addEventListener("input", (event) => {
    const id = event.target.dataset.qty ?? event.target.dataset.price;
    const line = id && chosen.get(id);
    if (!line) return;
    if (event.target.dataset.qty) line.quantity = event.target.value;
    else line.unit_price = event.target.value;
    refreshFooter();
  });
  query.addEventListener("input", debounce(loadList, 250));
  $("[data-action=cancel]", root).addEventListener("click", modal.close);

  save.addEventListener("click", async () => {
    const lines = [...chosen.values()];
    setBusy(save, true);
    setAlert($("[data-slot=error]", root), "error", "");
    try {
      await inventory.bulkCreate(
        lines.map((line) => ({ medication_id: line.medication.id, quantity: Number(line.quantity), unit_price: line.unit_price })),
      );
    } catch (error) {
      setBusy(save, false);
      refreshFooter();
      setAlert($("[data-slot=error]", root), "error", errorMessage(error));
      // أخطاء كل سطر باسمه: items[2].unit_price ← الدواء الثالث المختار.
      Object.entries(fieldErrors(error)).forEach(([key, message]) => {
        const index = Number(key.match(/^items\[(\d+)\]/)?.[1]);
        const id = lines[index]?.medication.id;
        const hint = id && $(`[data-error="${id}"]`, list);
        if (hint) hint.textContent = message;
      });
      return;
    }
    toast.success(`أُضيف ${count(lines.length, "medication")} للمخزون`);
    modal.close();
    load();
  });

  try {
    const [ids, categories] = await Promise.all([allStockedIds(), medications.categories()]);
    stocked = ids;
    const counts = Object.fromEntries(categories.map((c) => [c.category, c.medications]));
    category = categories.find((c) => c.medications > 0)?.category ?? "";
    const drawChips = () =>
      renderCategoryChips($("[data-slot=chips]", root), { value: category, counts }, (next) => {
        category = next;
        drawChips();
        loadList();
      });
    drawChips();
  } catch (error) {
    render(list, errorState(error));
    return;
  }
  loadList();
});

// ----------------------------------------------------------------------------- حركة مخزون

function openMovement(item) {
  const modal = openModal({
    title: `حركة مخزون — ${item.medication?.brand_name ?? ""}`,
    size: "sm",
    body: html`<div class="stack">
      <div data-slot="error" hidden></div>
      <p class="soft">الكمية الحالية: ${count(item.quantity, "box")}</p>
      ${selectField("نوع الحركة", "movement_type", MOVEMENT_OPTIONS, { value: "RESTOCK" })}
      ${field("عدد العلب المضافة", "quantity_delta", { type: "number" })}
    </div>`,
    footer: html`${button("إلغاء", { variant: "quiet", action: "cancel" })}${button("تسجيل", { variant: "primary", action: "save", disabled: true })}`,
  });
  const root = modal.root;
  const type = $("[name=movement_type]", root);
  const delta = $("[name=quantity_delta]", root);
  const save = $("[data-action=save]", root);

  function refresh() {
    const restock = type.value === "RESTOCK";
    $("[data-field=quantity_delta] .field__label", root).textContent = restock ? "عدد العلب المضافة" : "التغيير (سالب للإنقاص)";
    const deltaHint = $("[data-field=quantity_delta] .field__hint", root);
    deltaHint.textContent = deltaHint.dataset.hint = restock ? "" : "مثال: ‎-3 لثلاث علب تالفة";
    const value = Number(delta.value);
    // [قرار المستخدم] لا سبب لأي حركة. التوريد يزيد فقط، والتسوية تزيد أو تنقص.
    save.disabled = !delta.value || value === 0 || !Number.isInteger(value) || (restock && value < 0);
  }
  [type, delta].forEach((input) => input.addEventListener("input", refresh));
  $("[data-action=cancel]", root).addEventListener("click", modal.close);
  save.addEventListener("click", async () => {
    setBusy(save, true);
    let result;
    try {
      result = await inventory.move(item.id, {
        movement_type: type.value,
        quantity_delta: Number(delta.value),
      });
    } catch (error) {
      setBusy(save, false);
      setAlert($("[data-slot=error]", root), "error", errorMessage(error));
      return;
    }
    toast.success(`الكمية الآن ${count(result.item.quantity, "box")}`);
    modal.close();
    load();
  });
  refresh();
}

// ----------------------------------------------------------------------------- سجل الحركات

async function openHistory(item) {
  const drawer = openModal({ kind: "drawer", title: `سجل حركات ${item.medication?.brand_name ?? ""}`, body: loading() });
  const box = $(".drawer__body", drawer.root);
  let movements;
  try {
    movements = (await inventory.movements(item.id, { limit: 50 })).items;
  } catch (error) {
    render(box, errorState(error));
    return;
  }
  render(
    box,
    movements.map(
      (m) => html`<div class="kv" style="display: block">
        <div class="between">
          <span class="semi">${movementType[m.movement_type]}</span>
          <bdi dir="ltr" class="${m.quantity_delta > 0 ? "strong delta-plus num" : "strong delta-minus num"}">${m.quantity_delta > 0 ? `+${m.quantity_delta}` : m.quantity_delta}</bdi>
        </div>
        <div class="tiny muted">بعدها: ${m.quantity_after} · ${formatDateTime(m.created_at)}</div>
      </div>`,
    ),
  );
}

// ----------------------------------------------------------------------------- البداية

if (await activePharmacy($("#gate"))) {
  render($("#category"), html`<option value="">كل التصنيفات</option>${CATEGORY_OPTIONS.map((o) => html`<option value="${o.value}">${o.label}</option>`)}`);
  const reload = () => {
    page = 1;
    load(true);
  };
  $("#q").addEventListener("input", debounce(reload, 300));
  $("#category").addEventListener("change", reload);
  $("#low-only").addEventListener("change", reload);
  $("#content").hidden = false;
  load(true);
}
