/**
 * صيدلية واحدة للمريض: معلوماتها، موقعها وبُعدها عنه، وأدويتها المتوفرة الآن بالتصنيف
 * (بسعرها، بلا كميات) مع الطلب منها مباشرة. ما نفد لا يظهر.
 *
 * [قرار المستخدم] البحث بالاسم يعرض مع كل دواء بدائله بنفس التركيبة المتوفرة في هذه الصيدلية
 * نفسها («بديل لـ …» تحته)، وإن لم يكن الدواء نفسه هنا تظهر بدائله تحت «بدل …». كلها تُطلب مباشرة.
 *
 * [قرار المستخدم] «أرسل صورة وصفة» إلى هذه الصيدلية، و«راسل الصيدلية» (المحادثة العامة بينهما).
 * ?rx=1 (من «إرسال وصفة» في «طلباتي») يفتح نافذة الوصفة مباشرة.
 *
 * المسافة مسافة أقصر طريق بالسيارة من خدمة OSRM [خارجي]، والطريق نفسه يُرسم على الخريطة.
 * إن لم ترد الخدمة تُعرض مسافة الخط المستقيم ويُكتب ذلك بجانبها.
 */

import { ApiError, patients, pharmacies } from "../shared/api.js";
import { $, $$, debounce, html, idFromPath, render } from "../shared/dom.js";
import { count, formatDistance, formatMinutes, formatMoney } from "../shared/format.js";
import { startPage } from "../shared/layout.js";
import { originLabel, pickOnMap, renderLocationBar, watchPatientLocation } from "../shared/location.js";
import { createMap } from "../shared/map.js";
import { alternativeOf, categoryBadge, categoryIcon, renderCategoryChips } from "../shared/medication.js";
import { distanceKm } from "../shared/places.js";
import { ROUTING_ENABLED, roadRoute } from "../shared/routing.js";
import { dosageForm } from "../shared/text.js";
import { alertBox, button, emptyState, errorState, loading, renderPager } from "../shared/ui.js";
import { messagePharmacy } from "../shared/chat.js";
import { openPrescriptionDialog } from "../shared/prescriptions.js";
import { openOrderDialog } from "./order-dialog.js";

await startPage("PATIENT");

const PAGE_SIZE = 50;
const MAP_HINT = "اسمح للمتصفح بمعرفة موقعك، ثم اضغط «أعد المحاولة» في الأعلى.";
const id = idFromPath();

let pharmacy = null;
let position = null;
let map = null;
let where = { point: null };
let hasProfile = false;
let category = "";
let page = 1;
let offerAsk = 0;
let routeAsk = 0;
let offerItems = [];

// ----------------------------------------------------------------------------- البُعد والخريطة

async function drawDistance() {
  const mine = ++routeAsk;
  const point = where.point;
  map.setMarkers([
    ...(point ? [{ position: point, kind: "center", label: "●", title: "موقعك" }] : []),
    { position, kind: "pharmacy", title: pharmacy.name },
  ]);
  if (!point) {
    $("#distance").hidden = true;
    render($("#distance"), "");
    map.setPath(null);
    map.setView(position);
    return;
  }
  const origin = originLabel(where);
  const show = (km, note) => {
    $("#distance").hidden = false;
    render(
      $("#distance"),
      html`<div class="distance">
        <span class="distance__value display">${formatDistance(km)}</span>
        <span class="distance__label">بينك وبين الصيدلية<span class="tiny muted">${note}</span></span>
      </div>`,
    );
  };
  // أولًا الخط المستقيم (فوري)، ثم الطريق حين يصل.
  const straight = distanceKm(point[0], point[1], position[0], position[1]);
  show(straight, ROUTING_ENABLED ? `خط مستقيم من ${origin}. نحسب مسافة الطريق…` : `خط مستقيم من ${origin}`);
  map.setPath([point, position], "straight");
  map.fit([point, position]);
  if (!ROUTING_ENABLED) return;
  const road = await roadRoute(point, position);
  if (mine !== routeAsk) return;
  if (!road) {
    show(straight, `خط مستقيم من ${origin}. تعذّر حساب الطريق الآن`);
    return;
  }
  // القوائم تعرض طول الطريق الأسرع (طلب واحد لكل الصيدليات)؛ إن وُجد هنا طريق أقصر منه
  // قيل ذلك، فلا يبدو الرقمان متناقضين.
  const fasterDiffers = formatDistance(road.fastestKm) !== formatDistance(road.km);
  show(road.km, `أقصر طريق بالسيارة من ${origin}، نحو ${formatMinutes(road.minutes)}${fasterDiffers ? `. الطريق الأسرع ${formatDistance(road.fastestKm)}` : ""}`);
  map.setPath(road.path, "route");
  map.fit(road.path);
}

// ----------------------------------------------------------------------------- الأدوية

/** سطر دواء معروض: الاسم والتفاصيل، والسعر وزر «اطلب» (index في offerItems). of: الدواء الذي هو بديل له. */
function offerRow(item, index, of = null) {
  const m = item.medication;
  return html`<div class="${of ? "row offer is-alt" : "row offer"}">
    <span class="result">
      <span class="tile">${categoryIcon(m.category, 20)}</span>
      <span>
        ${of ? alternativeOf(of) : ""}
        <span class="semi" style="display: block"><bdi>${m.brand_name} ${m.strength}</bdi></span>
        <span class="small muted" style="display: block">${m.generic_name} · ${dosageForm[m.dosage_form] ?? m.dosage_form} · العلبة ${count(m.pack_size, m.pack_unit)}${m.manufacturer ? ` · ${m.manufacturer}` : ""}</span>
        ${categoryBadge(m.category)}
      </span>
    </span>
    <span class="offer__side">
      <span class="offer__price"><span class="price">${formatMoney(item.unit_price, item.currency)}</span><span class="tiny muted">للعلبة</span></span>
      ${button("اطلب", { size: "sm", variant: "primary", disabled: !hasProfile, data: { order: index } })}
    </span>
  </div>`;
}

/** ما بحث عنه غير متوفر هنا، وهذه بدائله المتوفرة هنا (لكل دواء مطابق مجموعة). start: أول رقم في offerItems. */
function alternativesHere(groups, start = 0) {
  let index = start;
  return html`<div class="alternatives-here">
    <div class="card__head">
      <div>
        <h3>بدائل متوفرة هنا بنفس التركيبة</h3>
        <div class="small muted">نفس المادة الفعالة وكميتها ونفس الشكل، باسم تجاري أو شركة أخرى.</div>
      </div>
    </div>
    ${groups.map(
      (group) => html`<p class="alternatives-here__for small soft">بدل <bdi class="semi">${group.medication.brand_name} ${group.medication.strength}</bdi>:</p>
        <div class="rows">${group.offers.map((item) => offerRow(item, index++, group.medication))}</div>`,
    )}
    <div class="card__body">${alertBox("info", "البديل فيه نفس المادة وكميتها، لكن اسأل الصيدلاني أو طبيبك قبل أن تستبدل دواءك.")}</div>
  </div>`;
}

function bindOrders(box) {
  $$("[data-order]", box).forEach((el) =>
    el.addEventListener("click", () => {
      const item = offerItems[Number(el.dataset.order)];
      openOrderDialog({
        pharmacy: { id: pharmacy.id, name: pharmacy.name },
        initial: { medication: item.medication, quantity: 1, unitPrice: item.unit_price, currency: item.currency },
      });
    }),
  );
}

function drawOffers(result) {
  const box = $("#offers");
  const q = $("#q").value.trim();
  offerItems = result.items;
  const counts = result.categories ?? {};
  const shownCount = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if (shownCount > 0) {
    renderCategoryChips($("#chips"), { value: category, counts }, (next) => {
      category = next;
      page = 1;
      loadOffers();
    });
  } else render($("#chips"), "");

  if (offerItems.length === 0) {
    const groups = result.alternatives ?? [];
    // أزرار «اطلب» في البدائل تشير إلى عناصر offerItems بالترتيب نفسه.
    offerItems = groups.flatMap((group) => group.offers);
    render(
      box,
      q
        ? html`${emptyState({
            icon: "search_x",
            title: `«${q}» غير متوفر في هذه الصيدلية`,
            hint: groups.length ? "لا يوجد دواء بهذا الاسم متوفر هنا الآن، لكن له بدائل بنفس التركيبة متوفرة هنا (في الأسفل)." : "لا يوجد دواء بهذا الاسم متوفر في هذه الصيدلية الآن.",
            action: button("ابحث عنه في صيدليات أخرى", { variant: "soft", href: `/patient/search?q=${encodeURIComponent(q)}` }),
          })}
          ${groups.length ? alternativesHere(groups) : ""}`
        : emptyState({ icon: "store", title: "لا أدوية متوفرة في هذه الصيدلية الآن" }),
    );
    bindOrders(box);
    return;
  }
  // [قرار المستخدم] تحت كل دواء بدائله المتوفرة هنا، وبعد القائمة بدائل ما بحث عنه وليس هنا.
  const groups = result.alternatives ?? [];
  const here = new Set(result.items.map((item) => item.medication.id));
  const rows = [];
  offerItems = [];
  for (const item of result.items) {
    rows.push(offerRow(item, offerItems.push(item) - 1));
    for (const group of groups.filter((g) => g.medication.id === item.medication.id)) {
      group.offers.forEach((offer) => rows.push(offerRow(offer, offerItems.push(offer) - 1, group.medication)));
    }
  }
  const elsewhere = groups.filter((g) => !here.has(g.medication.id));
  const start = offerItems.length;
  elsewhere.forEach((g) => offerItems.push(...g.offers));
  render(
    box,
    html`<div class="rows">${rows}</div>
    <div id="offers-pager"></div>
    ${elsewhere.length ? alternativesHere(elsewhere, start) : start > result.items.length ? html`<div class="card__body">${alertBox("info", "«بديل لـ …»: نفس المادة الفعالة وكميتها ونفس الشكل، باسم تجاري أو شركة أخرى. اسأل الصيدلاني أو طبيبك قبل أن تستبدل دواءك.")}</div>` : ""}`,
  );
  renderPager($("#offers-pager"), { page, pageSize: PAGE_SIZE, total: result.total }, (next) => {
    page = next;
    loadOffers();
  });
  bindOrders(box);
}

let lastOffers = null;

async function loadOffers() {
  const mine = ++offerAsk;
  const box = $("#offers");
  if (!lastOffers) render(box, loading("نحمّل أدوية الصيدلية…"));
  const q = $("#q").value.trim();
  try {
    const result = await pharmacies.offers(id, { q: q || undefined, category: category || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
    if (mine !== offerAsk) return;
    lastOffers = result;
    drawOffers(result);
  } catch (error) {
    if (mine !== offerAsk) return;
    lastOffers = null;
    render(box, html`<div class="card__body">${errorState(error, { retry: true })}</div>`);
    $("[data-action=retry]", box).addEventListener("click", loadOffers);
  }
}

$("#q").addEventListener(
  "input",
  debounce(() => {
    category = "";
    page = 1;
    loadOffers();
  }, 300),
);

// ----------------------------------------------------------------------------- البداية

async function loadProfile() {
  try {
    hasProfile = Boolean(await patients.me());
  } catch {
    return;
  }
  const box = $("#profile-alert");
  box.hidden = hasProfile;
  if (!hasProfile) render(box, alertBox("warning", "أكمل ملفك الشخصي قبل إرسال أي طلب.", { action: button("إكمال الملف", { size: "sm", href: "/patient/profile" }) }));
  if (lastOffers) drawOffers(lastOffers);
  drawActions();
}

/** [قرار المستخدم] أزرار رأس الصفحة: صورة وصفة، ومراسلة الصيدلية (بعد إكمال الملف الشخصي). */
function drawActions() {
  if (!pharmacy) return;
  render(
    $("#actions"),
    html`${button("راسل الصيدلية", { variant: "outline", icon: "message_circle", action: "message", disabled: !hasProfile })}
      ${button("أرسل صورة وصفة", { variant: "primary", icon: "camera", action: "prescription", disabled: !hasProfile })}`,
  );
  $("[data-action=message]", $("#actions")).addEventListener("click", (event) => messagePharmacy(pharmacy.id, event.currentTarget));
  $("[data-action=prescription]", $("#actions")).addEventListener("click", () => openPrescriptionDialog({ pharmacy: { id: pharmacy.id, name: pharmacy.name } }));
}

function showPharmacy() {
  const p = pharmacy;
  document.title = `${p.name} · منصة الأدوية`;
  $("#name").textContent = p.name;
  $("#address").textContent = `${p.city}، ${p.address_line}`;
  $("#head").hidden = false;
  $("#content").hidden = false;
  position = [Number(p.latitude), Number(p.longitude)];
  render(
    $("#facts"),
    html`<div class="kv"><span class="kv__key">العنوان</span><bdi class="semi">${p.city}، ${p.address_line}</bdi></div>
      <div class="kv"><span class="kv__key">الهاتف</span><bdi dir="ltr" class="semi"><a href="tel:${p.phone}">${p.phone}</a></bdi></div>
      <div class="kv"><span class="kv__key">الإحداثيات</span><bdi dir="ltr" class="semi">${position[0].toFixed(6)}, ${position[1].toFixed(6)}</bdi></div>`,
  );
  $("#osm").href = `https://www.openstreetmap.org/?mlat=${position[0]}&mlon=${position[1]}#map=17/${position[0]}/${position[1]}`;
  map = createMap($("#map"), { center: position, zoom: 14, onPick: pickOnMap, noTilesHint: MAP_HINT });
  let drawn = false;
  watchPatientLocation((next) => {
    const moved = !drawn || String(next.point) !== String(where.point);
    drawn = true;
    where = next;
    renderLocationBar($("#whereami"), next);
    if (moved) drawDistance();
  });
  loadOffers();
}

async function load() {
  render($("#state"), loading());
  try {
    pharmacy = await pharmacies.get(id);
  } catch (error) {
    // صيدلية غير موجودة: لا فائدة من إعادة المحاولة.
    const missing = error instanceof ApiError && error.status === 404;
    render($("#state"), html`<div class="section">${errorState(error, { retry: !missing })}</div>`);
    $("[data-action=retry]")?.addEventListener("click", load);
    return;
  }
  render($("#state"), "");
  showPharmacy();
  drawActions();
}

await Promise.all([loadProfile(), load()]);
if (pharmacy && hasProfile && new URLSearchParams(location.search).get("rx") === "1") {
  history.replaceState(null, "", location.pathname);
  openPrescriptionDialog({ pharmacy: { id: pharmacy.id, name: pharmacy.name } });
}
