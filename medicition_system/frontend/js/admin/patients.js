/**
 * المرضى المسجلون في المنصة: القائمة، وإيقاف الحساب (مع سبب يراه المريض) وإعادة تفعيله.
 *
 * الأدمن يرى بيانات الحساب فقط: الاسم، البريد أو الهاتف، تاريخ التسجيل، والحالة. أدوية
 * المريض وجرعاته وطلباته بيانات صحية تبقى له وحده. المريض الموقوف لا يدخل المنصة،
 * وصفحة الدخول تعرض له السبب.
 */

import { accounts } from "../shared/api.js";
import { $, debounce, html, onAction, render } from "../shared/dom.js";
import { formatDate } from "../shared/format.js";
import { startPage } from "../shared/layout.js";
import { accountStatus, accountStatusTone } from "../shared/text.js";
import { badge, button, confirmDialog, emptyState, errorState, loading, renderPager, renderTabs, toast } from "../shared/ui.js";

await startPage("ADMIN");

// null = كل الحالات.
const TABS = [null, "ACTIVE", "SUSPENDED"];
const TAB_LABELS = ["الكل", "نشط", "موقوف"];
const PAGE_SIZE = 20;

let tab = 0;
let page = 1;
let items = [];
let shown = false;
let ask = 0;

async function drawTabs() {
  let counts = {};
  try {
    counts = await accounts.patientsSummary();
  } catch {
    /* التبويبات بلا أعداد */
  }
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const tabCounts = [total, counts.ACTIVE, counts.SUSPENDED];
  renderTabs(
    $("#tabs"),
    TAB_LABELS.map((label, i) => ({ label, count: tabCounts[i], countTone: i === 2 ? "alert" : "quiet" })),
    tab,
    (next) => {
      tab = next;
      page = 1;
      drawTabs();
      load();
    },
  );
}

const nameOf = (patient) => patient.full_name ?? patient.email ?? patient.phone;

async function load() {
  const mine = ++ask;
  const box = $("#list");
  // أول مرة فقط: بعدها تبقى القائمة السابقة ظاهرة حتى تصل الجديدة.
  if (!shown) render(box, loading());
  const q = $("#q").value.trim();
  let result;
  try {
    result = await accounts.patients({ status: TABS[tab] ?? undefined, q: q || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  } catch (error) {
    if (mine !== ask) return;
    shown = false;
    render(box, html`<div class="card__body">${errorState(error, { retry: true })}</div>`);
    $("[data-action=retry]", box).addEventListener("click", load);
    return;
  }
  if (mine !== ask) return;
  // صفحة فرغت بعد إجراء (آخر من فيها أُوقف فخرج من التبويب): نرجع إلى آخر صفحة فيها حسابات.
  if (result.items.length === 0 && page > 1) {
    page = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
    load();
    return;
  }
  shown = true;
  items = result.items;
  const namesMissing = result.names_available === false;
  $("#names-missing").hidden = !namesMissing;
  if (items.length === 0) {
    render(box, emptyState({ icon: "users_round", title: q ? `لا مريض يطابق «${q}»` : tab === 2 ? "لا حسابات موقوفة" : "لا مرضى مسجلون بعد" }));
    render($("#pager"), "");
    return;
  }
  render(
    box,
    html`<div class="table-wrap">
      <table class="table table--stack">
        <thead><tr><th>المريض</th><th>البريد أو الهاتف</th><th>تاريخ التسجيل</th><th>الحالة</th><th aria-label="الإجراء"></th></tr></thead>
        <tbody>
          ${items.map(
            (patient, index) => html`<tr>
              <td class="cell-main">${patient.full_name
                ? html`<span class="semi">${patient.full_name}</span>`
                : html`<span class="muted">${namesMissing ? "الاسم غير متاح الآن" : "لم يكمل ملفه الشخصي"}</span>`}</td>
              <td data-label="البريد أو الهاتف"><bdi dir="ltr">${patient.email ?? patient.phone}</bdi></td>
              <td class="nowrap" data-label="تاريخ التسجيل">${formatDate(patient.created_at)}</td>
              <td data-label="الحالة">
                ${badge(accountStatusTone[patient.status], accountStatus[patient.status] ?? patient.status)}
                ${patient.status_reason ? html`<span class="tiny muted reason-line">السبب: ${patient.status_reason}</span>` : ""}
              </td>
              <td class="cell-actions">
                ${patient.status === "ACTIVE"
                  ? button("إيقاف", { size: "sm", variant: "danger-outline", action: "suspend", data: { index } })
                  : patient.status === "SUSPENDED"
                    ? button("إعادة التفعيل", { size: "sm", variant: "soft", action: "reactivate", data: { index } })
                    : ""}
              </td>
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

/** بعد الإجراء (نجح أو فشل) تُعاد القائمة والأعداد: ربما غيّرها مدير آخر في هذه الأثناء. */
async function act(patient, action, reason) {
  try {
    if (action === "suspend") await accounts.suspendPatient(patient.id, reason);
    else await accounts.reactivatePatient(patient.id);
    toast.success(action === "suspend" ? "أُوقف الحساب، وسيرى المريض السبب عند محاولة الدخول" : "أُعيد تفعيل الحساب");
  } catch (error) {
    toast.error(error);
  }
  drawTabs();
  load();
}

onAction($("#list"), {
  suspend: (el) => {
    const patient = items[Number(el.dataset.index)];
    confirmDialog({
      title: "إيقاف حساب المريض؟",
      message: `${nameOf(patient)}: لن يستطيع الدخول إلى المنصة حتى تعيد تفعيل حسابه.`,
      confirmLabel: "إيقاف الحساب",
      danger: true,
      reason: { label: "السبب (يراه المريض)", required: true },
      onConfirm: (reason) => act(patient, "suspend", reason),
    });
  },
  reactivate: (el) => {
    const patient = items[Number(el.dataset.index)];
    confirmDialog({
      title: "إعادة تفعيل الحساب؟",
      message: `${nameOf(patient)}: سيستطيع الدخول من جديد، ويصله إشعار بذلك.`,
      confirmLabel: "إعادة التفعيل",
      onConfirm: () => act(patient, "reactivate"),
    });
  },
});

$("#q").addEventListener(
  "input",
  debounce(() => {
    page = 1;
    load();
  }, 300),
);

drawTabs();
load();
