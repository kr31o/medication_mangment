/**
 * [خارجي] مسافة الطريق بين المريض والصيدلية، من خدمة OSRM العامة.
 *
 * OSRM (project-osrm.org) محرك توجيه مفتوح المصدر على خرائط OpenStreetMap؛ خادمه العام
 * router.project-osrm.org بلا مفتاح ولا حساب، وليس Google. المتصفح يرسل إليه إحداثيات
 * المريض والصيدليات فقط (بلا اسم ولا حساب) ويستلم طول الطريق بالسيارة وشكله. خادمنا لا
 * يشارك في ذلك ولا يحفظ موقع المريض (BR-006)؛ لكن مزوّد الخدمة يرى الإحداثيات.
 *
 * الخدمة تحتاج إنترنت وقد لا ترد (خادم تجريبي عام). عندئذ تعرض الصفحات مسافة الخط
 * المستقيم وتقول ذلك صراحة، فلا يتوقف شيء عليها.
 *
 * ROUTING_URL في .env يغيّر الخادم، والقيمة الفارغة تعطّل حساب الطريق كله.
 */

import { CONFIG } from "./api.js";

const BASE = String(CONFIG.routing_url ?? "").trim().replace(/\/+$/, "");
export const ROUTING_ENABLED = BASE !== "";
const TIMEOUT_MS = 8000;
// الخادم العام يقبل عددًا محدودًا من النقاط في الطلب الواحد.
const TABLE_MAX = 60;
// نفس السؤال في الصفحة نفسها لا يُرسل مرتين.
const cache = new Map();

// خمس خانات عشرية ≈ متر واحد.
const coord = ([lat, lng]) => `${Number(lng).toFixed(5)},${Number(lat).toFixed(5)}`;

async function ask(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}${path}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`routing ${response.status}`);
    const body = await response.json();
    if (body.code !== "Ok") throw new Error(`routing ${body.code}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/** طلب لخدمة الطريق، بمحاولة ثانية إن فشل الأول. */
function osrm(path) {
  if (!cache.has(path)) {
    const answer = ask(path).catch(() => ask(path));
    cache.set(path, answer);
    // فشل اليوم لا يُحفظ: إعادة فتح الصفحة تسأل من جديد.
    answer.catch(() => cache.delete(path));
  }
  return cache.get(path);
}

const usable = (point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);

/**
 * أقصر طريق بالسيارة بين نقطتين [lat, lng]: { km, minutes, path, fastestKm }، أو null إن
 * كانت الخدمة معطلة أو لم ترد. OSRM يعطي الأسرع أولًا ومعه بدائل؛ نختار الأقصر مسافةً.
 * fastestKm طول الأسرع، وهو ما تعطيه مصفوفة المسافات للقوائم، فتذكره صفحة الصيدلية إن اختلف.
 */
export async function roadRoute(from, to) {
  if (!ROUTING_ENABLED || !usable(from) || !usable(to)) return null;
  try {
    const body = await osrm(`/route/v1/driving/${coord(from)};${coord(to)}?overview=simplified&geometries=geojson&alternatives=3`);
    const best = body.routes.reduce((shortest, route) => (route.distance < shortest.distance ? route : shortest));
    return {
      km: best.distance / 1000,
      minutes: best.duration / 60,
      path: best.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      fastestKm: body.routes[0].distance / 1000,
    };
  } catch {
    return null;
  }
}

/**
 * مسافة الطريق بالكيلومتر من نقطة إلى عدة صيدليات بطلب واحد، بترتيبها (null لصيدلية لا
 * طريق إليها)، أو null كلها إن كانت الخدمة معطلة أو لم ترد.
 */
export async function roadDistances(from, pharmacies) {
  if (!ROUTING_ENABLED || !usable(from) || pharmacies.length === 0) return null;
  const destinations = pharmacies.map((p) => [Number(p.latitude), Number(p.longitude)]);
  try {
    const points = [from, ...destinations.slice(0, TABLE_MAX)].map(coord).join(";");
    const body = await osrm(`/table/v1/driving/${points}?sources=0&annotations=distance`);
    const sent = Math.min(destinations.length, TABLE_MAX);
    const meters = body.distances?.[0]?.slice(1);
    // جواب لا يحمل مسافة لكل صيدلية ليس جوابًا: تُعرض مسافة الخط المستقيم.
    if (!Array.isArray(meters) || meters.length !== sent) return null;
    return destinations.map((_, index) => (typeof meters[index] === "number" ? meters[index] / 1000 : null));
  } catch {
    return null;
  }
}

/**
 * يضع على كل صيدلية road_km (الطريق أو null) و km (ما يُعرض: الطريق، وإلا الخط المستقيم)،
 * ويرتّب القائمة بها. بلا مسافات طريق تبقى القائمة بترتيبها.
 */
export function withRoadDistances(pharmacies, distances) {
  if (!distances) return pharmacies.map((p) => ({ ...p, road_km: null, km: p.distance_km }));
  return pharmacies
    .map((p, index) => ({ ...p, road_km: distances[index] ?? null, km: distances[index] ?? p.distance_km }))
    .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
}
