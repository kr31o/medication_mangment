/**
 * ملف الصيدلية: البيانات، نقطتها الخاصة على الخريطة يحددها الصيدلي بنفسه، الوثائق (الرخصة)،
 * وسجل حالة الاعتماد. رقم الترخيص يولّده النظام عند إنشاء الملف ويُعرض للقراءة فقط.
 *
 * لكل صيدلية نقطتها الخاصة، يحددها صاحبها بلا أي خدمة خارجية: يختار المدينة فتنتقل الخريطة
 * إليها، ثم يضع الدبوس على صيدليته بإحدى ثلاث طرق: (1) الضغط على الخريطة ثم سحب الدبوس
 * للتدقيق، (2) «موقعي الآن» من GPS الجهاز وهو داخل الصيدلية، (3) لصق الإحداثيات أو رابط
 * الموقع من أي تطبيق خرائط. المدينة وحدها لا تكفي: مركزها ليس مكان صيدلية.
 */

import { pharmacies } from "../shared/api.js";
import { $, $$, html, render } from "../shared/dom.js";
import { formatDateTime } from "../shared/format.js";
import { icon } from "../shared/icons.js";
import { startPage } from "../shared/layout.js";
import { createMap } from "../shared/map.js";
import { pharmacyStatusBadge, statusTimeline } from "../shared/orders.js";
import { DEFAULT_PLACE, distanceKm, findPlace, nearestPlace, parseLocation, PLACE_OPTIONS } from "../shared/places.js";
import { documentType, fieldErrors } from "../shared/text.js";
import { alertBox, button, confirmDialog, errorState, iconButton, loading, setAlert, setBusy, showFieldErrors, toast } from "../shared/ui.js";
import { hasOwnPoint, pointOf } from "./mine.js";

await startPage("PHARMACY");

// رقم الترخيص ليس حقلًا في النموذج: يولّده النظام.
const FIELDS = ["name", "phone", "city", "address_line", "latitude", "longitude"];
const GPS_FAILED = "تعذر تحديد الموقع من هذا الجهاز. اضغط على الخريطة عند مكان صيدليتك، أو الصق إحداثياتها تحت الخريطة.";
const NO_TILES_HINT = "اضغط «موقعي الآن» وأنت داخل الصيدلية، أو الصق إحداثياتها في الحقل تحت الخريطة.";
const POINT_REQUIRED = "حدّد نقطة صيدليتك أولًا: اضغط على الخريطة عند مكانها بالضبط.";

let pharmacy = null;
// ما في النموذج الآن؛ صيدلية جديدة تبدأ بلا مكان: الصيدلي يحدده بنفسه.
let form = Object.fromEntries(FIELDS.map((key) => [key, ""]));
let pointError = false;
let map = null;
let shownCenter = "";

// ----------------------------------------------------------------------------- الرأس والحالة

function drawHead() {
  render(
    $("#head"),
    html`<header class="page-head">
      <div>
        <h1>${pharmacy ? pharmacy.name : "إنشاء ملف الصيدلية"}</h1>
        ${pharmacy ? "" : html`<div class="page-head__sub">بعد إنشاء الملف ورفع الرخصة يراجع مدير النظام الطلب، ثم تظهر صيدليتك للمرضى.</div>`}
      </div>
      ${pharmacy ? html`<div class="page-head__actions">${pharmacyStatusBadge(pharmacy.status)}</div>` : ""}
    </header>`,
  );
  const box = $("#status-alerts");
  const status = pharmacy?.status;
  box.hidden = !pharmacy || status === "ACTIVE";
  render(
    box,
    status === "PENDING_APPROVAL"
      ? alertBox("info", "طلبك قيد المراجعة. تأكد من رفع رخصة الصيدلية. ستصلك رسالة عند اعتمادها.")
      : status === "REJECTED"
        ? alertBox("error", `لم يُعتمد الطلب: ${pharmacy.status_reason}. عدّل ما يلزم ثم أعد التقديم.`, { action: button("إعادة التقديم", { size: "sm", action: "resubmit" }) })
        : status === "SUSPENDED"
          ? alertBox("warning", `صيدليتك موقوفة: ${pharmacy.status_reason}. لا تظهر للمرضى حتى يُعاد تفعيلها.`)
          : "",
  );
  $("[data-action=resubmit]", box)?.addEventListener("click", async (event) => {
    setBusy(event.currentTarget, true);
    try {
      pharmacy = await pharmacies.resubmit();
      toast.success("أُعيد تقديم طلب الاعتماد");
      drawHead();
      loadHistory();
    } catch (error) {
      setBusy(event.currentTarget, false);
      toast.error(error);
    }
  });
}

// ----------------------------------------------------------------------------- المكان

/** حال النقطة الآن: رسالة فوق الخريطة، والدبوس، ومركز الخريطة. */
function drawPlace() {
  const place = findPlace(form.city);
  const point = pointOf(form);
  const own = hasOwnPoint(form);
  // بُعد النقطة المحددة عن مركز المدينة المختارة.
  const offset = place && point ? distanceKm(point[0], point[1], place.lat, place.lng) : null;

  $("#city").value = place ? form.city : "";
  $("#city-hint").dataset.hint =
    pharmacy && !place && form.city ? `المسجل الآن: «${form.city}» (ليس في القائمة). اختر مدينة لتحديث المكان.` : "تنتقل الخريطة إليها لتحدد نقطتك";

  let tone;
  let message;
  if (pointError) [tone, message] = ["error", POINT_REQUIRED];
  else if (own) {
    tone = "success";
    message = html`حُدِّدت نقطة صيدليتك: <bdi dir="ltr" class="semi">${form.latitude}, ${form.longitude}</bdi>${
      offset !== null && offset <= 50 ? `، تبعد ${offset.toFixed(1)} كم عن مركز ${place.name}` : ""
    }. اسحب الدبوس إن أردت تصحيحها.`;
  } else if (point) {
    tone = "warning";
    message = `النقطة الآن على مركز ${place?.name ?? "المدينة"}، وليست مكان صيدليتك. اضغط على الخريطة عند صيدليتك بالضبط، أو اسحب الدبوس إليها.`;
  } else if (place) {
    tone = "warning";
    message = "لم تُحدَّد نقطة الصيدلية بعد. قرّب الخريطة واضغط عند مكان صيدليتك بالضبط، أو استعمل «موقعي الآن»، أو الصق إحداثياتها.";
  } else [tone, message] = ["note", "اختر المدينة أولًا، ثم اضغط على الخريطة عند مكان صيدليتك بالضبط."];
  render($("#point-status"), alertBox(tone, message));
  setAlert(
    $("#point-far"),
    "warning",
    offset !== null && offset > 50 ? `النقطة المحددة تبعد ${Math.round(offset)} كم عن ${place.name}. اختر المدينة من جديد أو صحّح النقطة، وإلا لن يجدك مرضى ${place.name}.` : "",
  );

  // قبل النقطة: مستوى المدينة. بعدها: مستوى الشارع، ليُسحب الدبوس إلى المبنى نفسه.
  const focusZoom = point ? 16 : place ? 14 : undefined;
  const center = point ?? (place ? [place.lat, place.lng] : [DEFAULT_PLACE.lat, DEFAULT_PLACE.lng]);
  if (!map) map = createMap($("#map"), { center, zoom: focusZoom ?? 12, onPick: setPoint, noTilesHint: NO_TILES_HINT });
  else if (String(center) !== shownCenter) map.setView(center, focusZoom);
  shownCenter = String(center);
  map.setMarkers(point ? [{ position: point, kind: "pharmacy", onMove: setPoint }] : []);
}

/** نقطة من الخريطة أو GPS أو اللصق. إن لم تُختر مدينة بعد نملؤها بأقرب مدينة في القائمة. */
function setPoint(lat, lng) {
  pointError = false;
  setPasteError(null);
  showFieldErrors($("#form"), {});
  setAlert($("#coordinates-error"), "error", "");
  const near = nearestPlace(lat, lng);
  if (!findPlace(form.city) && near.km <= 50) form.city = near.place.name;
  form.latitude = lat.toFixed(6);
  form.longitude = lng.toFixed(6);
  drawPlace();
}

/** اختيار المدينة ينقل الخريطة إليها؛ النقطة يضعها الصيدلي بعد ذلك. */
$("#city").addEventListener("change", (event) => {
  const chosen = findPlace(event.target.value);
  if (!chosen) return;
  showFieldErrors($("#form"), {});
  const current = pointOf(form);
  // نقطة حددها الصيدلي وتقع في المدينة الجديدة أو جوارها تبقى؛ غيرها يُمسح ليحددها في مدينته.
  const keep = current && hasOwnPoint(form) && distanceKm(current[0], current[1], chosen.lat, chosen.lng) <= 25;
  form.city = chosen.name;
  if (!keep) form.latitude = form.longitude = "";
  drawPlace();
});

$("#locate").addEventListener("click", (event) => {
  const locate = event.currentTarget;
  if (!navigator.geolocation) {
    toast.info(GPS_FAILED);
    return;
  }
  setBusy(locate, true);
  navigator.geolocation.getCurrentPosition(
    (position) => {
      setBusy(locate, false);
      setPoint(position.coords.latitude, position.coords.longitude);
      const accuracy = Math.round(position.coords.accuracy);
      if (accuracy > 150) toast.info(`دقة الجهاز الآن ضعيفة (نحو ${accuracy} م). اسحب الدبوس إلى مكان الصيدلية بالضبط.`);
    },
    () => {
      setBusy(locate, false);
      toast.info(GPS_FAILED);
    },
    // GPS الجهاز نفسه (لا تحديد الموقع عبر الشبكة): يحتاج بضع ثوانٍ لكنه لا يعتمد على خدمة خارجية.
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
  );
});

// ----------------------------------------------------------------------------- لصق الإحداثيات

const paste = $("#paste");
const PASTE_NOTE = $("#paste-note").textContent;

function setPasteError(message) {
  $("#paste-field").classList.toggle("has-error", Boolean(message));
  paste.toggleAttribute("aria-invalid", Boolean(message));
  const note = $("#paste-note");
  note.textContent = message ?? PASTE_NOTE;
  note.className = message ? "tiny paste-error" : "tiny muted";
  note.setAttribute("role", message ? "alert" : "note");
}

function usePasted() {
  const result = parseLocation(paste.value);
  if (result.error) {
    setPasteError(result.error);
    return;
  }
  setPoint(result.lat, result.lng);
  paste.value = "";
  $("#use-paste").disabled = true;
}

paste.addEventListener("input", () => {
  setPasteError(null);
  $("#use-paste").disabled = !paste.value.trim();
});
paste.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    usePasted();
  }
});
$("#use-paste").addEventListener("click", usePasted);

// ----------------------------------------------------------------------------- الحفظ

["name", "phone", "address_line"].forEach((key) => $(`#${key}`).addEventListener("input", (event) => (form[key] = event.target.value)));

$("#save").addEventListener("click", async (event) => {
  const save = event.currentTarget;
  // المكان إلزامي: المدينة ثم نقطة الصيدلية نفسها، فبها يحسب المريض بُعدها عنه.
  if (!form.city.trim()) {
    showFieldErrors($("#form"), { city: "اختر مدينة الصيدلية من القائمة." });
    toast.error("اختر مدينة الصيدلية من القائمة، ثم حدّد نقطتها على الخريطة.");
    return;
  }
  if (!hasOwnPoint(form)) {
    pointError = true;
    drawPlace();
    toast.error(POINT_REQUIRED);
    return;
  }
  const created = !pharmacy;
  // التعديل يرسل الحقول التي تغيّرت فقط.
  const changes = created ? form : Object.fromEntries(Object.entries(form).filter(([key, value]) => String(pharmacy[key]) !== value));
  setBusy(save, true);
  try {
    if (created || Object.keys(changes).length) pharmacy = await (created ? pharmacies.create(changes) : pharmacies.update(changes));
  } catch (error) {
    setBusy(save, false);
    const errors = fieldErrors(error);
    showFieldErrors($("#form"), errors);
    setAlert($("#coordinates-error"), "error", errors.latitude || errors.longitude ? "الإحداثيات غير صالحة." : "");
    toast.error(error);
    return;
  }
  if (created) {
    // صفحة الصيدلية الكاملة (الوثائق وسجل الحالة) تظهر بعد إنشاء الملف.
    toast.later("أُنشئ ملف الصيدلية. ارفع الرخصة ليبدأ الاعتماد.");
    location.reload();
    return;
  }
  setBusy(save, false);
  toast.success("حُفظت التغييرات");
  fillForm();
  drawHead();
});

// ----------------------------------------------------------------------------- الوثائق

async function loadDocuments() {
  const box = $("#documents");
  let docs;
  try {
    docs = await pharmacies.documents();
  } catch (error) {
    render(box, errorState(error));
    return;
  }
  // بعد الاعتماد تبقى الوثائق التي راجعها الأدمن كما هي.
  const locked = ["ACTIVE", "SUSPENDED"].includes(pharmacy.status);
  if (!docs.length) {
    render(box, html`<p class="muted">لم تُرفع وثائق بعد. رخصة الصيدلية مطلوبة للاعتماد.</p>`);
    return;
  }
  render(
    box,
    docs.map(
      (doc) => html`<div class="doc">
        <span class="tile tile--blue">${icon("file_text", 20)}</span>
        <div class="grow">
          <div class="semi">${documentType[doc.document_type] ?? doc.document_type}</div>
          <div class="tiny muted"><bdi>${doc.original_filename}</bdi> · <bdi dir="ltr">${Math.max(1, Math.round(doc.size_bytes / 1024))} KB</bdi> · ${formatDateTime(doc.created_at)}</div>
        </div>
        ${iconButton("download", "تنزيل", { data: { download: doc.id } })}
        ${locked ? "" : iconButton("trash_2", "حذف", { danger: true, data: { remove: doc.id } })}
      </div>`,
    ),
  );
  $$("[data-download]", box).forEach((el) => el.addEventListener("click", () => pharmacies.download(el.dataset.download).catch(toast.error)));
  $$("[data-remove]", box).forEach((el) =>
    el.addEventListener("click", () =>
      confirmDialog({
        title: "حذف الوثيقة؟",
        confirmLabel: "حذف",
        danger: true,
        onConfirm: async () => {
          await pharmacies.deleteDocument(el.dataset.remove);
          loadDocuments();
        },
      }),
    ),
  );
}

$("#upload").addEventListener("click", () => $("#file").click());
$("#file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  const upload = $("#upload");
  setBusy(upload, true);
  try {
    await pharmacies.upload($("#document-type").value, file);
    toast.success("رُفعت الوثيقة");
    loadDocuments();
  } catch (error) {
    toast.error(error);
  } finally {
    setBusy(upload, false);
  }
});

async function loadHistory() {
  try {
    render($("#history"), statusTimeline(await pharmacies.history(), "pharmacy"));
  } catch (error) {
    render($("#history"), errorState(error));
  }
}

// ----------------------------------------------------------------------------- البداية

function fillForm() {
  if (pharmacy) form = Object.fromEntries(FIELDS.map((key) => [key, String(pharmacy[key])]));
  ["name", "phone", "address_line"].forEach((key) => ($(`#${key}`).value = form[key]));
  $("#license").value = pharmacy?.license_number ?? "";
  $("#save").textContent = pharmacy ? "حفظ التغييرات" : "إنشاء ملف الصيدلية";
  drawPlace();
}

async function load() {
  render($("#state"), loading());
  try {
    pharmacy = await pharmacies.me();
  } catch (error) {
    render($("#state"), errorState(error, { retry: true }));
    $("[data-action=retry]", $("#state")).addEventListener("click", load);
    return;
  }
  render($("#state"), "");
  render(
    $("#city"),
    html`<option value="">اختر المدينة أو المنطقة</option>
    ${PLACE_OPTIONS.map((group) => html`<optgroup label="${group.group}">${group.options.map((o) => html`<option value="${o.value}">${o.label}</option>`)}</optgroup>`)}`,
  );
  render($("#document-type"), Object.entries(documentType).map(([value, label]) => html`<option value="${value}">${label}</option>`));
  drawHead();
  $("#layout").hidden = false;
  if (pharmacy) {
    $("#layout").className = "split";
    $("#side").hidden = false;
    loadDocuments();
    loadHistory();
  }
  fillForm();
}

load();
