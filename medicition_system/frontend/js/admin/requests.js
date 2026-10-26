/**
 * [قرار المستخدم] طلبات للإدارة (للأدمن): ما أرسله المرضى والصيدليات — دواء ناقص أو دواء جديد.
 * الرد مرة واحدة: «تمت المعالجة» (رد اختياري) أو «رفض» (سبب إلزامي)، ويصل صاحب الطلب إشعارًا.
 */

import { medicationRequests } from "../shared/api.js";
import { $, $$, html, render } from "../shared/dom.js";
import { formatDateTime } from "../shared/format.js";
import { icon } from "../shared/icons.js";
import { startPage } from "../shared/layout.js";
import { REQUEST_TYPE, requestStatusBadge, requestSubject, requestTypeBadge } from "../shared/requests.js";
import { alertBox, button, confirmDialog, emptyState, errorState, loading, renderPager, renderTabs, toast } from "../shared/ui.js";

await startPage("ADMIN");

const PAGE_SIZE = 10;
const TABS = [
  { status: "OPEN", label: "بانتظار الرد" },
  { status: "RESOLVED", label: "تمت المعالجة" },
  { status: "REJECTED", label: "مرفوضة" },
];
const ROLE = { PATIENT: { label: "مريض", icon: "user_round" }, PHARMACY: { label: "صيدلية", icon: "store" } };

let tab = 0;
let page = 1;
let ask = 0;
let items = [];
let counts = {};

function drawTabs() {
  renderTabs(
    $("#tabs"),
    TABS.map((t) => ({ label: t.label, count: counts[t.status], countTone: t.status === "OPEN" ? "amber" : undefined })),
    tab,
    (next) => {
      tab = next;
      page = 1;
      drawTabs();
      load(true);
    },
  );
}

async function loadCounts() {
  try {
    counts = await medicationRequests.summary();
  } catch {
    counts = {};
  }
  drawTabs();
}

function answerCard(r) {
  if (r.status === "OPEN") return "";
  const text = r.status === "REJECTED" ? `السبب: ${r.admin_reply}` : r.admin_reply ? `ردك: ${r.admin_reply}` : "بلا رد مكتوب.";
  return alertBox(r.status === "REJECTED" ? "error" : "success", html`${text}<span class="tiny muted" style="display: block">${formatDateTime(r.answered_at)}</span>`);
}

function answer(r, action) {
  const reject = action === "reject";
  confirmDialog({
    title: reject ? "رفض الطلب؟" : "تمت معالجة الطلب؟",
    message: `${REQUEST_TYPE[r.request_type]}: ${requestSubject(r)} — من ${r.requester.name}. ${reject ? "يصله الرفض وسببه إشعارًا." : "يصله إشعار بأن طلبه عولج، ومعه ردك إن كتبته."}`,
    confirmLabel: reject ? "رفض" : "تمت المعالجة",
    danger: reject,
    reason: reject ? { label: "سبب الرفض (يراه صاحب الطلب)", required: true } : { label: "ردك (اختياري، يراه صاحب الطلب)", required: false },
    onConfirm: async (reply) => {
      await (reject ? medicationRequests.reject(r.id, reply) : medicationRequests.resolve(r.id, reply || undefined));
      toast.success(reject ? "رُفض الطلب، وأُبلغ صاحبه" : "عُلّم الطلب «تمت المعالجة»، وأُبلغ صاحبه");
      loadCounts();
      load(true);
    },
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
    result = await medicationRequests.all({
      status: TABS[tab].status,
      request_type: $("#type").value || undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    });
  } catch (error) {
    if (mine !== ask) return;
    render(box, errorState(error, { retry: true }));
    $("[data-action=retry]", box).addEventListener("click", () => load(true));
    return;
  }
  if (mine !== ask) return;
  items = result.items;
  render(
    box,
    items.length === 0
      ? html`<div class="card">${emptyState({ icon: "inbox", title: tab === 0 ? "لا طلبات بانتظار الرد" : "لا طلبات هنا" })}</div>`
      : html`<div class="stack stack--sm">${items.map(
          (r, index) => html`<div class="card"><div class="card__body stack stack--sm">
            <div class="result" style="align-items: flex-start">
              <span class="tile">${icon(r.request_type === "SHORTAGE" ? "package_open" : "plus", 20)}</span>
              <div class="stack stack--xs">
                <div class="strong"><bdi>${requestSubject(r)}</bdi></div>
                ${r.details ? html`<div class="small soft"><bdi>${r.details}</bdi></div>` : ""}
                <div class="cluster" style="--gap: 6px">${requestStatusBadge(r.status)}${requestTypeBadge(r.request_type)}</div>
                <div class="small soft">${icon(ROLE[r.requester.role].icon, 14)} ${ROLE[r.requester.role].label}: <span class="semi">${r.requester.name}</span></div>
                <div class="tiny muted">${formatDateTime(r.created_at)}</div>
              </div>
            </div>
            ${r.note ? html`<p class="small soft">ملاحظته: ${r.note}</p>` : ""}
            ${answerCard(r)}
            ${
              r.status === "OPEN"
                ? html`<div class="cluster" style="justify-content: flex-end">
                    ${r.request_type === "NEW_MEDICATION" ? button("كتالوج الأدوية", { size: "sm", variant: "quiet", href: "/admin/medications" }) : ""}
                    ${button("رفض", { size: "sm", variant: "danger-outline", data: { reject: index } })}
                    ${button("تمت المعالجة", { size: "sm", variant: "primary", data: { resolve: index } })}
                  </div>`
                : ""
            }
          </div></div>`,
        )}</div>`,
  );
  $$("[data-resolve]", box).forEach((el) => el.addEventListener("click", () => answer(items[Number(el.dataset.resolve)], "resolve")));
  $$("[data-reject]", box).forEach((el) => el.addEventListener("click", () => answer(items[Number(el.dataset.reject)], "reject")));
  renderPager($("#pager"), { page, pageSize: PAGE_SIZE, total: result.total }, (next) => {
    page = next;
    load(true);
  });
}

$("#type").addEventListener("change", () => {
  page = 1;
  load(true);
});
drawTabs();
loadCounts();
load(true);
