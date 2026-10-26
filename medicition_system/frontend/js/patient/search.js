/**
 * البحث عن دواء: (1) ابحث في الكتالوج بالاسم أو تصفّحه بالتصنيف، (2) تظهر الصيدليات
 * القريبة من موقعك التي يتوفر فيها الدواء بالكمية المطلوبة، قائمة وخريطة،
 * (3) اطلب من إحداها، أو افتح صفحة الصيدلية لترى بقية أدويتها.
 *
 * [قرار المستخدم] تحت الصيدليات: بدائل الدواء بنفس التركيبة (نفس المادة وكميتها ونفس الشكل، باسم
 * أو شركة أخرى)، ومع كل بديل أقرب الصيدليات التي يتوفر فيها. «اختر هذا البديل» يجعله الدواء المختار.
 * وفي قائمة نتائج البحث بالاسم نفسها: تحت كل دواء بدائله سطورًا تُختار مثله («بديل لـ …»).
 *
 * الصيدليات تُختار بالخط المستقيم ضمن نطاق البحث (في الخادم)، ثم تُعرض وتُرتَّب بمسافة
 * الطريق من خدمة OSRM الخارجية [خارجي] (shared/routing.js). إن لم ترد الخدمة تبقى مسافة
 * الخط المستقيم ويُكتب ذلك.
 *
 * مركز البحث هو موقع المريض: يحدده المتصفح تلقائيًا عند فتح الصفحة، وإن فشل يضغط
 * المريض على الخريطة عند مكانه (shared/location.js).
 */

import { medications, patients, pharmacies } from "../shared/api.js";
import { $, $$, debounce, html, render } from "../shared/dom.js";
import { count, formatDistance, formatMoney } from "../shared/format.js";
import { icon } from "../shared/icons.js";
import { startPage } from "../shared/layout.js";
import { pickOnMap, renderLocationBar, watchPatientLocation } from "../shared/location.js";
import { createMap } from "../shared/map.js";
import { alternativeOf, categoryBadge, medicationLabel, renderCategoryChips, withAlternatives } from "../shared/medication.js";
import { SYRIA_VIEW } from "../shared/places.js";
import { ROUTING_ENABLED, roadDistances, withRoadDistances } from "../shared/routing.js";
import { dosageForm, packUnit } from "../shared/text.js";
import { alertBox, button, emptyState, errorState, loading, stepper } from "../shared/ui.js";
import { openOrderDialog } from "./order-dialog.js";

await startPage("PATIENT");

const RADII = [2, 5, 10, 25, 50];
// كم دواءً يُعرض عند تصفّح تصنيف بلا كتابة اسم.
const BROWSE_LIMIT = 50;

let hasProfile = false;
// null: لم يختر المريض تصنيفًا بعد. "": اختار «الكل». غير ذلك: تصنيف بعينه.
let category = null;
let counts = {};
let found = [];
// [قرار المستخدم] الأدوية التي فتح المريض كل بدائلها («و N بدائل غيرها»).
let expanded = new Set();
let lastPage = null;
let selected = null;
let quantity = 1;
let where = { point: null, status: "idle" };
let items = [];
let map = null;
// يزيد مع كل طلب: جواب طلب قديم لا يكتب فوق نتيجة أحدث منه.
let searchAsk = 0;
let nearbyAsk = 0;

// ----------------------------------------------------------------------------- 1. الكتالوج

const input = $("#q");
// ?q= يأتي من صفحة صيدلية لا تعرض الدواء: «ابحث عنه في صيدليات أخرى».
input.value = new URLSearchParams(location.search).get("q") ?? "";

function drawChips() {
  renderCategoryChips($("#chips"), { value: category, counts, label: "تصفّح بالتصنيف" }, (next) => {
    category = next;
    drawChips();
    loadResults();
  });
}

async function loadResults() {
  const box = $("#results");
  const q = input.value.trim();
  // بالاسم (حرفان على الأقل)، أو بتصفّح تصنيف (أو «الكل»)، أو بهما معًا.
  const byName = q.length >= 2;
  const browsing = category !== null;
  const mine = ++searchAsk;
  if (!byName && !browsing) {
    render(box, emptyState({ icon: "pill", title: "اكتب حرفين على الأقل، أو اختر تصنيفًا.", hint: "نبحث في الاسم التجاري والاسم العلمي معًا، والتصنيف يعرض كل أدويته." }));
    return;
  }
  render(box, loading("جارٍ البحث…"));
  let page;
  try {
    page = await medications.search({
      q: byName ? q : undefined,
      category: category || undefined,
      limit: browsing ? BROWSE_LIMIT : 12,
      // [قرار المستخدم] البحث بالاسم: ومع كل نتيجة بدائلها.
      with_alternatives: byName || undefined,
    });
  } catch (error) {
    if (mine === searchAsk) render(box, html`<div class="card__body">${errorState(error)}</div>`);
    return;
  }
  if (mine !== searchAsk) return;
  expanded = new Set();
  lastPage = page;
  drawResults();
}

function drawResults() {
  const box = $("#results");
  const page = lastPage;
  const q = input.value.trim();
  const byName = q.length >= 2;
  found = page.items;
  if (found.length === 0) {
    render(
      box,
      emptyState({
        icon: "search_x",
        title: byName ? "لا يوجد دواء بهذا الاسم في الكتالوج" : "لا أدوية في هذا التصنيف",
        hint: byName && category ? "جرّب «الكل» بدل التصنيف المختار." : byName ? "ليس في قائمة الأدوية؟ اطلب من الإدارة إضافته." : undefined,
        // [قرار المستخدم] دواء غير موجود في القائمة: طلب للإدارة باسمه.
        action: byName && !category ? button("اطلب إضافته", { variant: "soft", href: `/patient/requests?type=NEW_MEDICATION&name=${encodeURIComponent(q)}` }) : "",
      }),
    );
    return;
  }
  // كل نتيجة ثم بدائلها (ليست في النتائج نفسها)، وكلها تُختار بالضغطة نفسها.
  const rows = withAlternatives(found, { expanded });
  const picks = rows.filter((r) => r.medication).map((r) => r.medication);
  render(
    box,
    html`<div class="rows">
      ${page.total > found.length ? html`<p class="row small soft">يظهر أول ${found.length} من ${page.total}. اكتب اسم الدواء أو اختر تصنيفًا لتضييق القائمة.</p>` : ""}
      ${rows.map((r) => {
        if (r.more) return html`<button type="button" class="alt-more" data-more="${r.of.id}">عرض كل بدائل <bdi>${r.of.brand_name} ${r.of.strength}</bdi> (+${r.more})</button>`;
        const m = r.medication;
        return html`<button type="button" class="${r.of ? "row is-alt" : "row"}" data-pick="${picks.indexOf(m)}">
          <span class="result">
            <span class="tile">${icon("pill", 20)}</span>
            <span>
              ${r.of ? alternativeOf(r.of) : ""}
              <span class="semi" style="display: block"><bdi>${m.brand_name} ${m.strength}</bdi></span>
              <span class="small muted">${m.generic_name} · ${dosageForm[m.dosage_form] ?? m.dosage_form} · العلبة ${count(m.pack_size, m.pack_unit)}${m.manufacturer ? ` · ${m.manufacturer}` : ""}</span>
            </span>
          </span>
          <span class="cluster" style="--gap: 10px"><span class="result__category">${categoryBadge(m.category)}</span><span class="muted">${icon("chevron_left", 20)}</span></span>
        </button>`;
      })}
    </div>
    ${rows.some((r) => r.of) ? html`<div class="card__body">${alertBox("info", "«بديل لـ …»: نفس المادة الفعالة وكميتها ونفس الشكل، باسم تجاري أو شركة أخرى. اسأل الصيدلاني أو طبيبك قبل أن تستبدل دواءك.")}</div>` : ""}`,
  );
  $$("[data-pick]", box).forEach((el) => el.addEventListener("click", () => choose(picks[Number(el.dataset.pick)])));
  $$("[data-more]", box).forEach((el) =>
    el.addEventListener("click", () => {
      expanded.add(el.dataset.more);
      drawResults();
    }),
  );
}

input.addEventListener("input", debounce(loadResults, 300));

// ----------------------------------------------------------------------------- 2. الصيدليات القريبة

const radius = () => Number($("#radius").value);

function choose(medication) {
  selected = medication;
  render($("#alternatives"), "");
  $("#catalog").hidden = true;
  $("#nearby").hidden = false;
  $("#medication-name").textContent = medicationLabel(medication);
  $("#medication-meta").textContent = `${medication.generic_name} · العلبة ${count(medication.pack_size, medication.pack_unit)}${medication.manufacturer ? ` · ${medication.manufacturer}` : ""}`;
  if (!map) {
    map = createMap($("#map"), {
      center: where.point ?? SYRIA_VIEW.center,
      zoom: where.point ? 12 : SYRIA_VIEW.zoom,
      onPick: pickOnMap,
      noTilesHint: "اسمح للمتصفح بمعرفة موقعك، ثم اضغط «أعد المحاولة» في الأعلى.",
    });
  }
  drawNote();
  loadNearby();
}

$("#change").addEventListener("click", () => {
  selected = null;
  nearbyAsk += 1;
  $("#nearby").hidden = true;
  $("#catalog").hidden = false;
  input.focus();
});

function drawNote() {
  if (!selected) return;
  $("#map-note").textContent = [
    where.point ? "اضغط على الخريطة إن أردت البحث حول مكان آخر." : "اضغط على الخريطة عند مكانك لنبحث حوله.",
    "موقعك يُستخدم لهذا البحث فقط ولا يُحفظ في الخادم.",
    ROUTING_ENABLED ? "مسافة الطريق من خدمة OSRM على خرائط OpenStreetMap." : "",
    `الوحدة: ${packUnit[selected.pack_unit]}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** دبوس بنفسجي لموقع المريض، ودبوس أخضر مرقّم لكل صيدلية بنفس ترتيب القائمة. */
function drawMarkers() {
  map?.setMarkers([
    ...(where.point ? [{ position: where.point, kind: "center", label: "●", title: "موقعك" }] : []),
    ...items.map((p, index) => ({
      position: [Number(p.latitude), Number(p.longitude)],
      kind: "pharmacy",
      label: String(index + 1),
      title: p.name,
      text: p.offer ? `${formatMoney(p.offer.unit_price, p.offer.currency)} للعلبة` : "",
    })),
  ]);
}

function drawItems() {
  const box = $("#pharmacies");
  render(
    box,
    items.map(
      (p, index) => html`<div class="card">
        <button type="button" class="pharmacy-card__top" data-view="${index}">
          <span class="rank">${index + 1}</span>
          <span class="grow">
            <span class="strong" style="display: block">${p.name}</span>
            <span class="meta-line">${icon("map_pin", 15)} ${p.city}، ${p.address_line} — يبعد ${formatDistance(p.km)} ${p.road_km === null ? "بخط مستقيم" : "على الطريق"}</span>
            <span class="meta-line">${icon("phone", 14)} <bdi dir="ltr">${p.phone}</bdi></span>
          </span>
          <span class="center">
            <span class="price" style="display: block">${p.offer ? formatMoney(p.offer.unit_price, p.offer.currency) : "—"}</span>
            <span class="tiny muted">للعلبة</span>
          </span>
        </button>
        <div class="pharmacy-card__foot pharmacy-card__foot--actions">
          ${button(`اطلب ${count(quantity, "box")} من هنا`, { variant: "primary", disabled: !hasProfile, data: { order: index } })}
          ${button("صفحة الصيدلية", { variant: "soft", href: `/patient/pharmacies/${p.id}` })}
        </div>
      </div>`,
    ),
  );
  // الضغط على البطاقة يحرك الخريطة إلى الصيدلية دون تغيير مركز البحث.
  $$("[data-view]", box).forEach((el) =>
    el.addEventListener("click", () => {
      const p = items[Number(el.dataset.view)];
      map.setView([Number(p.latitude), Number(p.longitude)], 12);
    }),
  );
  $$("[data-order]", box).forEach((el) =>
    el.addEventListener("click", () => {
      const p = items[Number(el.dataset.order)];
      openOrderDialog({
        pharmacy: { id: p.id, name: p.name },
        initial: { medication: selected, quantity, unitPrice: p.offer?.unit_price, currency: p.offer?.currency },
      });
    }),
  );
}

/** لا نتائج: هل في النطاق صيدليات أصلًا؟ ليعرف المريض السبب (لا صيدليات، أم الدواء غير متوفر). */
function drawNothing(inRange, alternativesNear) {
  const km = radius();
  const wider = RADII.find((n) => n > km);
  const hint =
    inRange > 0
      ? alternativesNear
        ? `في هذا النطاق ${count(inRange, "pharmacy")}، لكن الدواء غير متوفر فيها بهذه الكمية. له بدائل بنفس التركيبة متوفرة قريبًا منك، تجدها في الأسفل.`
        : `في هذا النطاق ${count(inRange, "pharmacy")}، لكن الدواء غير متوفر فيها بهذه الكمية. جرّب كمية أقل أو نطاقًا أوسع.`
      : wider
        ? "وسّع نطاق البحث."
        : "هذا أوسع نطاق. اضغط على الخريطة إن أردت البحث حول مكان آخر.";
  // [قرار المستخدم] لا هو ولا بدائله قريبًا: يبلغ الإدارة أنه ناقص.
  const report = alternativesNear ? "" : button("أبلغ الإدارة أنه ناقص", { variant: "quiet", href: `/patient/requests?type=SHORTAGE&medication=${selected.id}` });
  render(
    $("#pharmacies"),
    html`<div class="card">${emptyState({
      icon: "store",
      title: inRange === 0 ? `لا توجد صيدليات معتمدة ضمن ${km} كم من موقعك` : "هذا الدواء غير متوفر بهذه الكمية في الصيدليات القريبة",
      hint,
      action: html`<div class="cluster" style="justify-content: center">${wider ? button(`وسّع النطاق إلى ${wider} كم`, { variant: "soft", action: "wider" }) : ""}${report}</div>`,
    })}</div>`,
  );
  $("[data-action=wider]")?.addEventListener("click", () => {
    $("#radius").value = String(wider);
    loadNearby();
  });
}

// ----------------------------------------------------------------------------- البدائل

/** سطر التوفر لبديل: أقرب الصيدليات (حتى 3) بمسافتها وسعرها، أو أنه غير متوفر قريبًا. */
function availabilityLine(item) {
  if (item.pharmacies.length === 0) {
    return html`<span class="small muted" style="display: block">غير متوفر بهذه الكمية في الصيدليات القريبة الآن</span>`;
  }
  const near = item.pharmacies.map((p) => `${p.name} (${formatDistance(p.distance_km)}، ${formatMoney(p.offer.unit_price, p.offer.currency)})`).join("، ");
  const more = item.pharmacies_total - item.pharmacies.length;
  return html`<span class="small" style="display: block">${icon("store", 14)} متوفر قريبًا في: ${near}${more > 0 ? `، و${count(more, "pharmacy")} غيرها` : ""}</span>`;
}

function drawAlternatives(result) {
  const box = $("#alternatives");
  if (!result || result.items.length === 0) {
    render(box, "");
    return;
  }
  render(
    box,
    html`<div class="card">
      <div class="card__head">
        <div>
          <h3>بدائل بنفس التركيبة</h3>
          <div class="small muted">نفس المادة الفعالة وكميتها ونفس الشكل، باسم تجاري أو شركة أخرى. المسافات بخط مستقيم.</div>
        </div>
      </div>
      <div class="rows">
        ${result.items.map(
          (item, index) => html`<div class="row offer">
            <span class="result">
              <span class="tile">${icon("pill", 20)}</span>
              <span>
                <span class="semi" style="display: block"><bdi>${item.medication.brand_name} ${item.medication.strength}</bdi></span>
                <span class="small muted" style="display: block">${item.medication.manufacturer ? `${item.medication.manufacturer} · ` : ""}العلبة ${count(item.medication.pack_size, item.medication.pack_unit)}</span>
                ${availabilityLine(item)}
              </span>
            </span>
            <span class="offer__side">${item.pharmacies.length ? button("اختر هذا البديل", { size: "sm", variant: "soft", data: { alternative: index } }) : ""}</span>
          </div>`,
        )}
      </div>
      <div class="card__body">${alertBox("info", "البديل فيه نفس المادة وكميتها، لكن اسأل الصيدلاني أو طبيبك قبل أن تستبدل دواءك.")}</div>
    </div>`,
  );
  $$("[data-alternative]", box).forEach((el) =>
    el.addEventListener("click", () => {
      choose(result.items[Number(el.dataset.alternative)].medication);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }),
  );
}

async function loadNearby() {
  if (!selected) return;
  const mine = ++nearbyAsk;
  const box = $("#pharmacies");
  items = [];
  render($("#alternatives"), "");
  if (!where.point) {
    drawMarkers();
    render(
      box,
      where.status === "failed"
        ? html`<div class="card">${emptyState({ icon: "map_pinned", title: "حدّد موقعك لنبحث حولك", hint: "اضغط على الخريطة عند مكانك، فنعرض الصيدليات القريبة منه التي يتوفر فيها الدواء." })}</div>`
        : loading("نحدّد موقعك…"),
    );
    return;
  }
  const [lat, lng] = where.point;
  render(box, loading("نبحث في الصيدليات القريبة…"));
  // البدائل بالتوازي مع الصيدليات. إن تعذّرت لا تظهر، والبحث نفسه يبقى صحيحًا.
  const alternatives = pharmacies.nearbyAlternatives({ lat, lng, radius_km: radius(), medication_id: selected.id, quantity }).catch(() => null);
  let nearby;
  try {
    nearby = (await pharmacies.nearby({ lat, lng, radius_km: radius(), medication_id: selected.id, quantity })).items;
  } catch (error) {
    if (mine !== nearbyAsk) return;
    render(box, errorState(error, { retry: true }));
    $("[data-action=retry]", box).addEventListener("click", loadNearby);
    return;
  }
  if (mine !== nearbyAsk) return;
  if (nearby.length === 0) {
    let inRange = null;
    try {
      inRange = (await pharmacies.nearby({ lat, lng, radius_km: radius(), limit: 50 })).items.length;
    } catch {
      /* لا نعرف السبب: الرسالة العامة */
    }
    const others = await alternatives;
    if (mine !== nearbyAsk) return;
    drawMarkers();
    drawNothing(inRange, Boolean(others?.items.some((item) => item.pharmacies.length > 0)));
    drawAlternatives(others);
    return;
  }
  items = withRoadDistances(nearby, null);
  drawItems();
  drawMarkers();
  alternatives.then((others) => {
    if (mine === nearbyAsk) drawAlternatives(others);
  });
  // مسافة الطريق لكل صيدلية بطلب واحد؛ تُرتَّب بها حين تصل.
  const roads = await roadDistances(where.point, nearby);
  if (mine !== nearbyAsk || !roads) return;
  items = withRoadDistances(nearby, roads);
  drawItems();
  drawMarkers();
}

stepper($("#quantity"), {
  label: "عدد العلب",
  value: quantity,
  min: 1,
  max: 100,
  onChange: (n) => {
    quantity = n;
    loadNearby();
  },
});
$("#radius").addEventListener("change", loadNearby);

watchPatientLocation((next) => {
  const moved = String(next.point) !== String(where.point);
  where = next;
  renderLocationBar($("#whereami"), next);
  drawNote();
  // موقع جديد (من المتصفح أو من الخريطة) يعيد الخريطة إليه ويعيد البحث حوله.
  if (moved && next.point) map?.setView(next.point, 12);
  if (moved || (!next.point && next.status === "failed")) loadNearby();
});

// ----------------------------------------------------------------------------- البداية

async function loadProfile() {
  try {
    hasProfile = Boolean(await patients.me());
  } catch {
    return;
  }
  const box = $("#profile-alert");
  box.hidden = hasProfile;
  if (!hasProfile) {
    render(box, alertBox("warning", "أكمل ملفك الشخصي قبل إرسال أي طلب.", { action: button("إكمال الملف", { size: "sm", href: "/patient/profile" }) }));
  }
  if (items.length) drawItems();
}

async function loadCategories() {
  try {
    counts = Object.fromEntries((await medications.categories()).map((c) => [c.category, c.medications]));
  } catch {
    return;
  }
  drawChips();
}

loadProfile();
loadCategories();
loadResults();
