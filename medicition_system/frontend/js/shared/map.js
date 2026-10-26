/**
 * خريطة Leaflet (مكتبة الخرائط في vendor/leaflet، تُحمَّل في الصفحة قبل هذا الملف).
 *
 * [خارجي] صور الخريطة (البلاطات) من خوادم OpenStreetMap العامة: ليست Google Maps
 * ولا تحتاج مفتاحًا. تحتاج إنترنت، ومتصفح المستخدم يطلب منها بلاطات حول الموقع
 * المعروض (خادمنا لا يخزّن موقع المريض، BR-006، لكن مزوّد البلاطات يرى الطلبات).
 * MAP_TILES_URL في .env يغيّر الخادم.
 *
 * الخريطة وسيلة مساعدة لا شرط: إن لم تُحمَّل صورها (لا إنترنت أو الخدمة محجوبة)
 * تظهر رسالة فوقها تقول ما البديل (noTilesHint)، وتبقى الصفحة تعمل بدونها. وهي عندئذ
 * لا تستقبل الضغط ولا السحب: نقطة تُختار على خريطة فارغة ليست مكانًا يعرفه من اختاره.
 */

import { CONFIG } from "./api.js";

const L = window.L;
const TILES_URL = CONFIG.map_tiles_url || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILES_ATTRIBUTION = CONFIG.map_tiles_attribution || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const FIT_OPTIONS = { padding: [44, 44], maxZoom: 16 };
// لون --violet-500 (نقطة المريض): الخط يبدأ منها. المتقطع خط مستقيم بين نقطتين،
// والمتصل طريق حقيقي على الشوارع.
const PATH_STYLE = { color: "#7c5ce6", weight: 3, opacity: 0.9, dashArray: "4 9", lineCap: "round", interactive: false };
const ROUTE_STYLE = { color: "#7c5ce6", weight: 5, opacity: 0.85, lineCap: "round", lineJoin: "round", interactive: false };

/** دبوس. kind: pharmacy (أخضر مرقّم) | center (بنفسجي: موقع البحث) | dot (نقطة). */
function pinIcon(kind, label = "") {
  const dot = kind === "dot";
  const span = document.createElement("span");
  span.textContent = label;
  return L.divIcon({
    className: "",
    html: `<div class="map-pin map-pin--${kind}">${span.outerHTML}</div>`,
    iconSize: dot ? [24, 24] : [34, 34],
    iconAnchor: dot ? [12, 12] : [17, 34],
    popupAnchor: [0, dot ? -12 : -32],
  });
}

/** نص النافذة الصغيرة فوق الدبوس: عناصر DOM لا HTML، فلا يُحقن فيه شيء. */
function popupNode(title, text) {
  const node = document.createElement("div");
  node.dir = "rtl";
  const strong = document.createElement("strong");
  strong.textContent = title;
  node.append(strong);
  if (text) node.append(document.createElement("br"), document.createTextNode(text));
  return node;
}

/**
 * يرسم خريطة داخل container. الخيارات:
 *   center: [lat, lng]، zoom، onPick(lat, lng) عند الضغط على الخريطة،
 *   noTilesHint: ما يفعله المستخدم إن لم تُحمَّل صور الخريطة.
 * يرجع أدوات تغييرها لاحقًا:
 *   setView(center, focusZoom)  تتحرك إليه (وتقرّب إلى focusZoom على الأقل إن أُعطي)
 *   setMarkers([{ position, kind, label, title, text, onMove }])  onMove يجعل الدبوس قابلًا للسحب
 *   setPath(points, kind)  خط بين النقاط: "straight" متقطع، "route" طريق حقيقي
 *   fit(points)  تُظهر هذه النقاط كلها
 */
export function createMap(container, { center, zoom = 13, onPick, noTilesHint = "اختيار المدينة من القائمة يكفي." }) {
  container.classList.add("map-wrap");
  // Leaflet يحسب مواضع البلاطات من اليسار؛ داخل صفحة RTL يُعزل باتجاه LTR.
  const box = document.createElement("div");
  box.className = "map";
  box.dir = "ltr";
  container.replaceChildren(box);

  const map = L.map(box, { center, zoom, scrollWheelZoom: true });
  const tiles = L.tileLayer(TILES_URL, { attribution: TILES_ATTRIBUTION }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  let line = null;
  let bounds = null;
  let markers = [];
  // true حين تفشل صور الخريطة كلها (لم تُحمَّل ولا واحدة).
  let blank = false;
  let loaded = false;

  const notice = document.createElement("div");
  notice.className = "map__notice";
  notice.setAttribute("role", "status");
  notice.textContent = `تعذر تحميل صور الخريطة (لا إنترنت أو الخدمة محجوبة). يمكنك المتابعة بدونها: ${noTilesHint}`;

  const setBlank = (value) => {
    if (value === blank) return;
    blank = value;
    box.toggleAttribute("data-blank", value);
    if (value) container.append(notice);
    else notice.remove();
    drawMarkers();
  };
  tiles.on("tileload", () => {
    loaded = true;
    setBlank(false);
  });
  tiles.on("tileerror", () => {
    if (!loaded) setBlank(true);
  });
  map.on("click", (event) => {
    if (!blank) onPick?.(event.latlng.lat, event.latlng.lng);
  });

  // الحاوية قد تتغير أبعادها بعد الرسم (حركة دخول الصفحة، تدوير الجوال).
  new ResizeObserver(() => {
    map.invalidateSize();
    if (bounds) map.fitBounds(bounds, { ...FIT_OPTIONS, animate: false });
  }).observe(box);

  function drawMarkers() {
    layer.clearLayers();
    markers.forEach((marker) => {
      const movable = Boolean(marker.onMove) && !blank;
      const item = L.marker(marker.position, { icon: pinIcon(marker.kind ?? "pharmacy", marker.label), draggable: movable, autoPan: true });
      if (movable) {
        item.on("dragend", () => {
          const { lat, lng } = item.getLatLng();
          marker.onMove(lat, lng);
        });
      }
      if (marker.title) item.bindPopup(popupNode(marker.title, marker.text));
      item.addTo(layer);
    });
  }

  return {
    setView(point, focusZoom) {
      bounds = null;
      const current = map.getZoom();
      map.setView(point, focusZoom ? Math.max(current, focusZoom) : current);
    },
    setMarkers(next) {
      markers = next;
      drawMarkers();
    },
    setPath(points, kind = "straight") {
      line?.remove();
      line = points && points.length >= 2 ? L.polyline(points, kind === "route" ? ROUTE_STYLE : PATH_STYLE).addTo(map) : null;
    },
    fit(points) {
      // أول ضبط عند فتح الصفحة فوري؛ الحركة فقط حين يتغير شيء بعد ذلك.
      const first = bounds === null;
      bounds = points && points.length >= 2 ? L.latLngBounds(points) : null;
      if (bounds) map.fitBounds(bounds, { ...FIT_OPTIONS, animate: !first });
    },
  };
}
