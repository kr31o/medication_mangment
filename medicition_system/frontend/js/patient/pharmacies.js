/**
 * دليل الصيدليات المعتمدة كلها للمريض، الأقرب إليه أولًا، مع بحث وخريطة.
 *
 * موقع المريض يحدده المتصفح تلقائيًا (shared/location.js)، وإن فشل يضغط المريض على
 * الخريطة عند مكانه. قبل أن يُعرف الموقع تُعرض الصيدليات بالاسم وبلا مسافات.
 * المسافة مسافة الطريق من خدمة OSRM الخارجية [خارجي]؛ إن لم ترد تبقى مسافة الخط المستقيم.
 *
 * [قرار المستخدم] ?rx=1 (من «إرسال وصفة» في «طلباتي»): يختار المريض الصيدلية التي يرسل إليها
 * صورة الوصفة، فتُفتح صفحتها ونافذة الإرسال مباشرة.
 */

import { pharmacies } from "../shared/api.js";
import { $, debounce, html, render } from "../shared/dom.js";
import { count, formatDistance } from "../shared/format.js";
import { icon } from "../shared/icons.js";
import { startPage } from "../shared/layout.js";
import { originLabel, pickOnMap, renderLocationBar, watchPatientLocation } from "../shared/location.js";
import { createMap } from "../shared/map.js";
import { SYRIA_VIEW } from "../shared/places.js";
import { ROUTING_ENABLED, roadDistances, withRoadDistances } from "../shared/routing.js";
import { alertBox, emptyState, errorState, loading, renderPager } from "../shared/ui.js";

await startPage("PATIENT");

const RX = new URLSearchParams(location.search).get("rx") === "1";
if (RX) {
  $("#rx-note").hidden = false;
  render($("#rx-note"), alertBox("info", "اختر الصيدلية التي تريد إرسال صورة الوصفة إليها، والأقرب إليك أولًا."));
}

const PAGE_SIZE = 20;
const MAP_HINT = "اسمح للمتصفح بمعرفة موقعك، ثم اضغط «أعد المحاولة» في الأعلى.";

let where = { point: null };
let page = 1;
let ask = 0;
let shown = false;

const map = createMap($("#map"), { center: SYRIA_VIEW.center, zoom: SYRIA_VIEW.zoom, onPick: pickOnMap, noTilesHint: MAP_HINT });

/** سطر فوق القائمة: كيف رُتّبت. roads: undefined (نحسب)، null (لم تُحسب)، أو المسافات. */
function orderNote(items, roads) {
  if (items[0].km === null) return "مرتبة بالاسم. تظهر المسافات بعد تحديد موقعك.";
  const origin = originLabel(where);
  if (Array.isArray(roads)) {
    return items.every((p) => p.road_km !== null)
      ? `مرتبة من الأقرب إلى ${origin} بمسافة الطريق.`
      : `مرتبة من الأقرب إلى ${origin} بمسافة الطريق، وبالخط المستقيم حيث لم يُحسب طريق.`;
  }
  if (!ROUTING_ENABLED) return `مرتبة من الأقرب إلى ${origin} بالخط المستقيم.`;
  if (roads === null) return `مرتبة من الأقرب إلى ${origin} بالخط المستقيم: تعذّر حساب مسافات الطريق الآن.`;
  return `مرتبة من الأقرب إلى ${origin}. نحسب مسافات الطريق…`;
}

function draw(result, roads) {
  const items = withRoadDistances(result.items, roads);
  const firstRank = (page - 1) * PAGE_SIZE + 1;
  const q = $("#q").value.trim();
  const box = $("#list");
  if (items.length === 0) {
    render(
      box,
      html`<div class="card">${emptyState({
        icon: "store",
        title: q ? `لا صيدلية معتمدة تطابق «${q}»` : "لا صيدليات معتمدة في المنصة بعد",
        hint: q ? "جرّب اسمًا آخر أو اسم المدينة." : "تظهر الصيدلية هنا بعد أن يعتمدها مدير النظام.",
      })}</div>`,
    );
  } else {
    render(
      box,
      html`<p class="small soft" aria-live="polite">${count(result.total, "pharmacy")}، ${orderNote(items, roads)}</p>
      ${items.map(
        (p, index) => html`<a class="card card--link" href="/patient/pharmacies/${p.id}${RX ? "?rx=1" : ""}">
          <div class="pharmacy-line">
            <span class="rank">${firstRank + index}</span>
            <span class="grow">
              <span class="strong" style="display: block">${p.name}</span>
              <span class="meta-line">${icon("map_pin", 15)} ${p.city}، ${p.address_line}</span>
              <span class="meta-line">${icon("phone", 14)} <bdi dir="ltr">${p.phone}</bdi></span>
            </span>
            ${p.km === null
              ? ""
              : html`<span class="distance distance--sm"><span class="distance__value">${formatDistance(p.km)}</span><span class="tiny muted">${p.road_km === null ? "خط مستقيم" : "على الطريق"}</span></span>`}
          </div>
        </a>`,
      )}
      <div id="pager"></div>`,
    );
    renderPager($("#pager"), { page, pageSize: PAGE_SIZE, total: result.total, bare: true }, (next) => {
      page = next;
      load();
    });
  }

  // دبوس بنفسجي لنقطة المريض إن عُرفت، ودبوس أخضر مرقّم لكل صيدلية بترتيب القائمة.
  const markers = [
    ...(where.point ? [{ position: where.point, kind: "center", label: "●", title: "موقعك" }] : []),
    ...items.map((p, index) => ({
      position: [Number(p.latitude), Number(p.longitude)],
      kind: "pharmacy",
      label: String(firstRank + index),
      title: p.name,
      text: p.km === null ? p.city : `${p.city} — ${formatDistance(p.km)}`,
    })),
  ];
  map.setMarkers(markers);
  if (markers.length >= 2) map.fit(markers.map((m) => m.position));
  // بلا نقطة للمريض: الخريطة عند الصيدلية الوحيدة إن وُجدت، وإلا البلد كله.
  else map.setView(markers[0]?.position ?? SYRIA_VIEW.center, markers.length ? 12 : undefined);
}

async function load() {
  const mine = ++ask;
  const box = $("#list");
  // أول مرة فقط: بعدها تبقى القائمة السابقة ظاهرة حتى تصل الجديدة.
  if (!shown) render(box, loading("نحمّل الصيدليات…"));
  const q = $("#q").value.trim();
  let result;
  try {
    result = await pharmacies.directory({ lat: where.point?.[0], lng: where.point?.[1], q: q || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  } catch (error) {
    if (mine !== ask) return;
    shown = false;
    render(box, errorState(error, { retry: true }));
    $("[data-action=retry]", box).addEventListener("click", load);
    return;
  }
  if (mine !== ask) return;
  shown = true;
  draw(result, ROUTING_ENABLED && where.point ? undefined : null);
  // مسافة الطريق لصيدليات الصفحة بطلب واحد؛ تُرتَّب بها حين تصل.
  if (!where.point || !ROUTING_ENABLED) return;
  const roads = await roadDistances(where.point, result.items);
  if (mine === ask) draw(result, roads);
}

$("#q").addEventListener(
  "input",
  debounce(() => {
    page = 1;
    load();
  }, 300),
);

watchPatientLocation((next) => {
  const moved = String(next.point) !== String(where.point);
  where = next;
  renderLocationBar($("#whereami"), next);
  $("#map-note").textContent = [
    next.point ? "اضغط على الخريطة إن أردت تغيير موقعك." : "اضغط على الخريطة عند مكانك لتُحسب المسافات منه.",
    "موقعك يُستعمل للحساب فقط ولا يُحفظ في الخادم.",
    ROUTING_ENABLED ? "مسافة الطريق من خدمة OSRM على خرائط OpenStreetMap." : "",
  ]
    .filter(Boolean)
    .join(" ");
  // موقع جديد يغيّر الترتيب كله: نعود إلى أول القائمة.
  if (moved) {
    page = 1;
    load();
  }
});
if (!shown && ask === 0) load();
