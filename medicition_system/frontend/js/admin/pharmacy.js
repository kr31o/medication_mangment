/**
 * صيدلية واحدة عند مدير النظام: بياناتها، حساب صاحبها، موقعها على الخريطة، وثائقها، صيادلتها،
 * وسجل حالتها، مع الاعتماد والرفض والإيقاف وإعادة التفعيل.
 */

import { ApiError, pharmacies } from "../shared/api.js";
import { $, $$, html, idFromPath, render } from "../shared/dom.js";
import { formatDateTime } from "../shared/format.js";
import { icon } from "../shared/icons.js";
import { startPage } from "../shared/layout.js";
import { createMap } from "../shared/map.js";
import { pharmacyStatusBadge, statusTimeline } from "../shared/orders.js";
import { documentType } from "../shared/text.js";
import { alertBox, button, confirmDialog, emptyState, errorState, iconButton, loading, toast } from "../shared/ui.js";

await startPage("ADMIN");

const id = idFromPath();
let map = null;

// الإجراء المتاح يتحدد من الحالة الحالية (from).
const ACTIONS = {
  approve: { label: "اعتماد", title: "اعتماد الصيدلية؟", from: "PENDING_APPROVAL" },
  reject: { label: "رفض", title: "رفض الطلب؟", danger: true, reason: true, from: "PENDING_APPROVAL" },
  suspend: { label: "إيقاف", title: "إيقاف الصيدلية؟", danger: true, reason: true, from: "ACTIVE" },
  reinstate: { label: "إعادة التفعيل", title: "إعادة تفعيل الصيدلية؟", from: "SUSPENDED" },
};

function ask(p, action) {
  const config = ACTIONS[action];
  confirmDialog({
    title: config.title,
    confirmLabel: config.label,
    danger: config.danger,
    reason: config.reason ? { label: "السبب (يراه صاحب الصيدلية)", required: true } : undefined,
    onConfirm: async (reason) => {
      try {
        // الاعتماد يحمل بصمة ما يعرضه الأدمن الآن: إن عدّل صاحب الصيدلية رقم الترخيص أو
        // الوثائق بعد فتح الصفحة يرفض الخادم ويُعاد تحميل التفاصيل للمراجعة.
        await pharmacies.adminAction(id, action, reason || undefined, p.review_token);
        toast.success("حُدّثت حالة الصيدلية");
      } catch (error) {
        toast.error(error);
        if (!(error instanceof ApiError && error.code === "PHARMACY_CHANGED_SINCE_REVIEW")) return;
      }
      load();
    },
  });
}

function draw(p) {
  document.title = `${p.name} · منصة الأدوية`;
  const available = Object.entries(ACTIONS).filter(([, a]) => a.from === p.status);
  render(
    $("#head"),
    html`<header class="page-head">
      <div>
        <h1>${p.name}</h1>
        <div class="page-head__sub">${pharmacyStatusBadge(p.status)}</div>
      </div>
      <div class="page-head__actions">${available.map(([action, a]) => button(a.label, { variant: a.danger ? "danger-outline" : "primary", data: { act: action } }))}</div>
    </header>`,
  );
  $$("[data-act]", $("#head")).forEach((el) => el.addEventListener("click", () => ask(p, el.dataset.act)));

  const hasLicense = p.documents.some((d) => d.document_type === "PHARMACY_LICENSE");
  const missingLicense = p.status === "PENDING_APPROVAL" && !hasLicense;
  $("#alerts").hidden = !missingLicense && !p.status_reason;
  render(
    $("#alerts"),
    html`${missingLicense ? alertBox("warning", "لم تُرفع رخصة الصيدلية بعد؛ لا يمكن الاعتماد قبلها.") : ""}
    ${p.status_reason ? alertBox("info", `السبب المسجل: ${p.status_reason}`) : ""}`,
  );

  // [العنوان، القيمة، هل تُعزل باتجاه LTR؟]: الأرقام اللاتينية تُعزل حتى لا يعكس RTL ترتيبها.
  const facts = [
    ["رقم الترخيص", p.license_number, true],
    ["هاتف الصيدلية", p.phone, true],
    // حساب صاحب الصيدلية من خدمة الحسابات؛ يغيب إن لم ترد تلك الخدمة.
    ["حساب صاحبها", p.owner ? (p.owner.email ?? p.owner.phone) : "غير متاح الآن", Boolean(p.owner)],
    ["العنوان", `${p.city}، ${p.address_line}`, false],
    ["الإحداثيات", `${p.latitude}, ${p.longitude}`, true],
    ["سُجّلت", formatDateTime(p.created_at), false],
  ];
  render(
    $("#facts"),
    facts.map(([label, value, ltr]) => html`<div class="kv"><span class="kv__key">${label}</span><bdi${ltr ? html` dir="ltr"` : ""} class="semi">${value}</bdi></div>`),
  );
  const position = [Number(p.latitude), Number(p.longitude)];
  if (!map) map = createMap($("#map"), { center: position, zoom: 15, noTilesHint: "الإحداثيات مكتوبة فوق الخريطة." });
  map.setMarkers([{ position, kind: "pharmacy", title: p.name, text: p.address_line }]);

  render(
    $("#documents"),
    p.documents.length
      ? html`<div class="card__body">${p.documents.map(
          (d) => html`<div class="doc">
            <span class="tile tile--blue">${icon("file_text", 20)}</span>
            <div class="grow">
              <div class="semi">${documentType[d.document_type] ?? d.document_type}</div>
              <div class="tiny muted"><bdi>${d.original_filename}</bdi> · ${formatDateTime(d.created_at)}</div>
            </div>
            ${iconButton("download", "تنزيل للمراجعة", { data: { download: d.id } })}
          </div>`,
        )}</div>`
      : emptyState({ icon: "file_text", title: "لا وثائق" }),
  );
  $$("[data-download]", $("#documents")).forEach((el) => el.addEventListener("click", () => pharmacies.adminDownload(p.id, el.dataset.download).catch(toast.error)));

  render($("#history"), statusTimeline(p.history, "pharmacy"));
  $("#pharmacists-title").textContent = `الصيادلة (${p.pharmacists.length})`;
  render(
    $("#pharmacists"),
    p.pharmacists.length
      ? html`<div class="table-wrap"><table class="table table--compact table--stack"><tbody>${p.pharmacists.map(
          (ph) => html`<tr>
            <td class="semi cell-main">${ph.full_name}</td>
            <td data-label="رقم مزاولة المهنة"><bdi dir="ltr">${ph.license_number}</bdi></td>
            <td data-label="الحالة">${ph.is_active ? "نشط" : "غير نشط"}</td>
          </tr>`,
        )}</tbody></table></div>`
      : emptyState({ title: "لا صيادلة مسجلون" }),
  );
}

async function load() {
  const first = !map;
  if (first) render($("#state"), loading());
  let p;
  try {
    p = await pharmacies.adminGet(id);
  } catch (error) {
    render($("#state"), errorState(error));
    return;
  }
  render($("#state"), "");
  $("#content").hidden = false;
  draw(p);
}

load();
