/** الإشعارات (لكل الأدوار): الضغط على إشعار يعلّمه مقروءًا ويفتح ما يخصه. */

import { notifications } from "./shared/api.js";
import { $, $$, cx, html, render } from "./shared/dom.js";
import { relativeTime } from "./shared/format.js";
import { startPage } from "./shared/layout.js";
import { emptyState, errorState, loading, renderPager, renderTabs, setBusy, toast } from "./shared/ui.js";

const principal = await startPage("ANY");

const PAGE_SIZE = 20;
let unreadOnly = false;
let page = 1;
let items = [];

/** الصفحة التي يفتحها الإشعار حسب نوع الكيان ودور المستخدم. */
function targetOf(n) {
  const pharmacy = principal.role === "PHARMACY";
  switch (n.entity_type) {
    case "ORDER":
      return pharmacy ? `/pharmacy/orders/${n.entity_id}` : `/patient/orders/${n.entity_id}`;
    case "PHARMACY":
      return "/pharmacy/profile";
    case "INVENTORY_ITEM":
      return "/pharmacy/inventory";
    case "DOSE_TIME":
      return "/patient/doses";
    case "PATIENT_MEDICATION":
      return `/patient/medications/${n.entity_id}`;
    case "AI_INSIGHT":
      return "/patient/insights";
    case "MEDICATION_REQUEST":
      return pharmacy ? "/pharmacy/requests" : "/patient/requests";
    // [قرار المستخدم] رسالة جديدة: تفتح المحادثة نفسها.
    case "CONVERSATION":
      return `${pharmacy ? "/pharmacy" : "/patient"}/messages?c=${n.entity_id}`;
    default:
      return n.type === "ACCOUNT_CREATED" ? (pharmacy ? "/pharmacy/profile" : "/patient/profile") : null;
  }
}

/** الجرس في الشريط العلوي يعيد عدّ غير المقروء. */
const updateBell = () => window.dispatchEvent(new Event("medplat:notifications"));

function drawTabs() {
  renderTabs($("#tabs"), [{ label: "الكل" }, { label: "غير المقروءة" }], unreadOnly ? 1 : 0, (value) => {
    unreadOnly = value === 1;
    page = 1;
    drawTabs();
    load();
  });
}

async function open(n) {
  if (!n.read_at) {
    await notifications.markRead(n.id).catch(() => undefined);
    updateBell();
  }
  const target = targetOf(n);
  if (target) location.assign(target);
  else load();
}

async function load() {
  const box = $("#list");
  if (!items.length) render(box, loading());
  let result;
  try {
    result = await notifications.list({ unread: unreadOnly, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  } catch (error) {
    items = [];
    render(box, html`<div class="card__body">${errorState(error, { retry: true })}</div>`);
    $("[data-action=retry]", box).addEventListener("click", load);
    return;
  }
  items = result.items;
  render(
    box,
    items.length === 0
      ? emptyState({ icon: "bell_off", title: unreadOnly ? "لا إشعارات غير مقروءة" : "لا توجد إشعارات بعد" })
      : items.map(
          (n, index) => html`<button type="button" class="${cx("notif", !n.read_at && "is-unread", n.priority === "HIGH" && "is-high")}" data-index="${index}">
            <span class="notif__dot"></span>
            <span class="grow">
              <span class="between"><span class="${n.read_at ? "semi" : "strong"}">${n.title}</span><span class="tiny muted nowrap">${relativeTime(n.created_at)}</span></span>
              <span class="small soft" style="display: block; margin-top: 2px">${n.message}</span>
            </span>
          </button>`,
        ),
  );
  $$("[data-index]", box).forEach((el) => el.addEventListener("click", () => open(items[Number(el.dataset.index)])));
  renderPager($("#pager"), { page, pageSize: PAGE_SIZE, total: result.total }, (next) => {
    page = next;
    load();
  });
}

$("#read-all").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  setBusy(button, true);
  try {
    const result = await notifications.markAllRead();
    toast.success(result.marked ? "عُلّمت كل الإشعارات كمقروءة" : "لا يوجد جديد");
    updateBell();
    await load();
  } catch (error) {
    toast.error(error);
  } finally {
    setBusy(button, false);
  }
});

drawTabs();
load();
