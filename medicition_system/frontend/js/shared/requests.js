/**
 * [قرار المستخدم] طلبات للإدارة، للمريض والصيدلية معًا:
 * - «دواء ناقص»: دواء موجود في قائمة الأدوية لكنه غير متوفر.
 * - «دواء جديد»: دواء غير موجود في القائمة.
 * الإدارة ترد بـ «تمت المعالجة» أو «مرفوض» مع سبب، ويصل الرد إشعارًا.
 *
 * mountMyRequests() تبني صفحة «طلبات للإدارة»، و openRequestDialog() نافذة الطلب الجديد
 * (تُفتح أيضًا من البحث حين لا يتوفر دواء: /patient/requests?type=SHORTAGE&medication=<id>).
 */

import { medicationRequests, medications } from "./api.js";
import { $, $$, html, render } from "./dom.js";
import { formatDateTime } from "./format.js";
import { icon } from "./icons.js";
import { createMedicationPicker, medicationLabel } from "./medication.js";
import { errorMessage, fieldErrors } from "./text.js";
import { alertBox, badge, button, emptyState, errorState, field, loading, openModal, renderPager, renderTabs, setAlert, setBusy, showFieldErrors, toast, wireSegmented } from "./ui.js";

export const REQUEST_TYPE = { SHORTAGE: "دواء ناقص", NEW_MEDICATION: "دواء جديد" };
export const REQUEST_STATUS = {
  OPEN: { label: "بانتظار الرد", tone: "amber" },
  RESOLVED: { label: "تمت المعالجة", tone: "green" },
  REJECTED: { label: "مرفوض", tone: "coral" },
};

export const requestStatusBadge = (status) => badge(REQUEST_STATUS[status]?.tone, REQUEST_STATUS[status]?.label ?? status);
export const requestTypeBadge = (type) => badge("neutral", REQUEST_TYPE[type] ?? type, true);

/** عمّ يدور الطلب: دواء الكتالوج، أو الاسم كما كتبه صاحبه. */
export const requestSubject = (r) => (r.medication ? medicationLabel(r.medication) : r.medication_name);

/** رد الإدارة كما يراه صاحب الطلب. */
export function adminReply(r) {
  if (r.status === "OPEN") return "";
  const tone = r.status === "REJECTED" ? "error" : "success";
  const text = r.status === "REJECTED" ? `رفضت الإدارة الطلب. السبب: ${r.admin_reply}` : r.admin_reply ? `رد الإدارة: ${r.admin_reply}` : "عالجت الإدارة الطلب.";
  return alertBox(tone, html`${text}<span class="tiny muted" style="display: block">${formatDateTime(r.answered_at)}</span>`);
}

/**
 * نافذة طلب جديد. type: SHORTAGE | NEW_MEDICATION، medication: دواء من الكتالوج (للناقص)،
 * name: اسم مكتوب (للجديد). onCreated(request) بعد الإرسال.
 */
export function openRequestDialog({ type = "SHORTAGE", medication = null, name = "", onCreated } = {}) {
  let kind = type;
  let picked = medication;
  const modal = openModal({
    title: "طلب جديد للإدارة",
    body: html`<div class="stack">
      <div data-slot="error" hidden></div>
      <div class="segmented segmented--block" role="group" aria-label="نوع الطلب" data-slot="kind">
        <button type="button" class="segmented__item${kind === "SHORTAGE" ? " is-active" : ""}" aria-pressed="${kind === "SHORTAGE"}" data-value="SHORTAGE">${icon("package_open", 17)}دواء ناقص</button>
        <button type="button" class="segmented__item${kind === "NEW_MEDICATION" ? " is-active" : ""}" aria-pressed="${kind === "NEW_MEDICATION"}" data-value="NEW_MEDICATION">${icon("plus", 17)}دواء جديد</button>
      </div>
      <p class="small soft" data-slot="explain"></p>
      <div data-slot="shortage"><div data-slot="picker"></div></div>
      <div class="stack" data-slot="new">
        ${field("اسم الدواء", "medication_name", { value: name, dir: "auto", placeholder: "مثل Panadol Extra", maxLength: 150 })}
        ${field("تفاصيل (اختيارية)", "details", { dir: "auto", placeholder: "العيار والشكل والشركة إن عرفتها", maxLength: 300 })}
      </div>
      ${field("ملاحظة للإدارة (اختيارية)", "note", { multiline: true, maxLength: 500, hint: "مثل: بحثت عنه في صيدليات منطقتي ولم أجده" })}
    </div>`,
    footer: html`${button("إلغاء", { variant: "quiet", action: "cancel" })}${button("إرسال الطلب", { variant: "primary", action: "send" })}`,
  });
  const root = modal.root;
  const send = $("[data-action=send]", root);
  const nameInput = $("[name=medication_name]", root);

  createMedicationPicker($("[data-slot=picker]", root), {
    label: "الدواء من قائمة الأدوية",
    placeholder: "اكتب اسم الدواء",
    value: picked,
    hint: "لا تجده في القائمة؟ اختر «دواء جديد».",
    onSelect: (m) => {
      picked = m;
      refresh();
    },
  });

  function refresh() {
    const shortage = kind === "SHORTAGE";
    $("[data-slot=shortage]", root).hidden = !shortage;
    $("[data-slot=new]", root).hidden = shortage;
    $("[data-slot=explain]", root).textContent = shortage
      ? "دواء موجود في قائمة الأدوية لكنك لا تجده متوفرًا. تبلغ الإدارة لتتابع توفيره."
      : "دواء غير موجود في قائمة الأدوية. تطلب من الإدارة إضافته.";
    send.disabled = shortage ? !picked : nameInput.value.trim().length < 2;
  }
  wireSegmented($("[data-slot=kind]", root), (value) => {
    kind = value;
    setAlert($("[data-slot=error]", root), "error", "");
    refresh();
  });
  nameInput.addEventListener("input", refresh);
  $("[data-action=cancel]", root).addEventListener("click", modal.close);
  send.addEventListener("click", async () => {
    const note = $("[name=note]", root).value.trim();
    const body =
      kind === "SHORTAGE"
        ? { request_type: kind, medication_id: picked.id }
        : { request_type: kind, medication_name: nameInput.value.trim(), ...($("[name=details]", root).value.trim() ? { details: $("[name=details]", root).value.trim() } : {}) };
    if (note) body.note = note;
    setBusy(send, true);
    let created;
    try {
      created = await medicationRequests.create(body);
    } catch (error) {
      setBusy(send, false);
      refresh();
      showFieldErrors(root, fieldErrors(error));
      setAlert($("[data-slot=error]", root), "error", errorMessage(error));
      return;
    }
    modal.close();
    toast.success("أُرسل طلبك للإدارة. يصلك إشعار حين ترد.");
    onCreated?.(created);
  });
  refresh();
  return modal;
}

/** صفحة «طلبات للإدارة» للمريض والصيدلية: الطلبات وردودها، وزر طلب جديد. */
export async function mountMyRequests() {
  const PAGE_SIZE = 10;
  const TABS = [
    { label: "الكل", status: undefined },
    { label: "بانتظار الرد", status: "OPEN" },
    { label: "تمت المعالجة", status: "RESOLVED" },
    { label: "مرفوضة", status: "REJECTED" },
  ];
  let tab = 0;
  let page = 1;
  let ask = 0;

  function drawTabs() {
    renderTabs($("#tabs"), TABS, tab, (next) => {
      tab = next;
      page = 1;
      drawTabs();
      load(true);
    });
  }

  async function load(fresh = false) {
    const mine = ++ask;
    const box = $("#list");
    if (fresh) {
      render(box, loading());
      render($("#pager"), "");
    }
    let result;
    try {
      result = await medicationRequests.mine({ status: TABS[tab].status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
    } catch (error) {
      if (mine !== ask) return;
      render(box, errorState(error, { retry: true }));
      $("[data-action=retry]", box).addEventListener("click", () => load(true));
      return;
    }
    if (mine !== ask) return;
    render(
      box,
      result.items.length === 0
        ? html`<div class="card">${emptyState({
            icon: "inbox",
            title: tab === 0 ? "لم ترسل طلبات للإدارة بعد" : "لا طلبات هنا",
            hint: "دواء لا تجده متوفرًا، أو دواء غير موجود في القائمة؟ أرسل طلبًا للإدارة.",
            action: tab === 0 ? button("طلب جديد", { variant: "soft", action: "new" }) : "",
          })}</div>`
        : html`<div class="stack stack--sm">${result.items.map(
            (r) => html`<div class="card"><div class="card__body stack stack--sm">
              <div class="result" style="align-items: flex-start">
                <span class="tile">${icon(r.request_type === "SHORTAGE" ? "package_open" : "plus", 20)}</span>
                <div class="stack stack--xs">
                  <div class="strong"><bdi>${requestSubject(r)}</bdi></div>
                  ${r.details ? html`<div class="small soft"><bdi>${r.details}</bdi></div>` : ""}
                  <div class="cluster" style="--gap: 6px">${requestStatusBadge(r.status)}${requestTypeBadge(r.request_type)}</div>
                  <div class="tiny muted">${formatDateTime(r.created_at)}</div>
                </div>
              </div>
              ${r.note ? html`<p class="small soft">ملاحظتك: ${r.note}</p>` : ""}
              ${adminReply(r)}
            </div></div>`,
          )}</div>`,
    );
    $("[data-action=new]", box)?.addEventListener("click", () => openRequestDialog({ onCreated: () => load(true) }));
    renderPager($("#pager"), { page, pageSize: PAGE_SIZE, total: result.total }, (next) => {
      page = next;
      load(true);
    });
  }

  $("#new").addEventListener("click", () => openRequestDialog({ onCreated: () => load(true) }));
  drawTabs();
  await load(true);

  // من صفحة أخرى: ?type=SHORTAGE&medication=<id> أو ?type=NEW_MEDICATION&name=<الاسم>
  const params = new URLSearchParams(location.search);
  const type = params.get("type");
  if (type === "SHORTAGE" || type === "NEW_MEDICATION") {
    let medication = null;
    if (type === "SHORTAGE" && params.get("medication")) {
      medication = await medications.get(params.get("medication")).catch(() => null);
    }
    history.replaceState(null, "", location.pathname);
    openRequestDialog({ type, medication, name: params.get("name") ?? "", onCreated: () => load(true) });
  }
}
