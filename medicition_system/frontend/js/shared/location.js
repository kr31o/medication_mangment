/**
 * «أين المريض الآن؟» لصفحات البحث والصيدليات.
 *
 * المتصفح يحدد موقع المريض تلقائيًا أول ما تُفتح إحدى هذه الصفحات (GPS في الهاتف،
 * وخدمة تحديد الموقع في الحاسوب)، والمسافات تُحسب من نقطته هو لا من مركز مدينة.
 * إن رفض المريض أو فشل التحديد يضغط على الخريطة عند مكانه.
 *
 * النقطة مشتركة بين الصفحات، ومحفوظة في sessionStorage فقط: تخص هذا التبويب، وتُمحى
 * بإغلاقه وعند تسجيل الخروج (session.clear في api.js). لا تُرسل للخادم ولا تُحفظ فيه (BR-006).
 */

import { formatDistance } from "./format.js";
import { html, render } from "./dom.js";
import { inSyria, nearestPlace } from "./places.js";
import { button } from "./ui.js";

const KEY = "medplat.location";
// status: idle (لم نحاول بعد) | locating | ready (توجد نقطة) | failed (لا نقطة)
// source: gps (من المتصفح) | map (ضغطة المريض). accuracy بالأمتار، من المتصفح فقط.
// problem: سبب آخر فشل في التحديد التلقائي، حتى لو بقيت نقطة سابقة صالحة.
const IDLE = { status: "idle", point: null, source: null, accuracy: null, problem: null };
// دقة أسوأ من هذا (بالأمتار) تعني أن المتصفح خمّن من الشبكة لا من GPS: نقول للمريض أن يصحّح.
const COARSE_M = 1000;
const NEAR_KM = 40;

function load() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (saved && (saved.status === "ready" || saved.status === "failed")) return { ...IDLE, ...saved };
  } catch {
    /* لا شيء محفوظ */
  }
  return IDLE;
}

let state = load();
// يزيد عند كل طلب تحديد وعند المسح: جواب طلب قديم لا يكتب فوق حالة أحدث منه.
let generation = 0;
const listeners = new Set();

function update(next) {
  state = next;
  try {
    if (next.status === "ready" || next.status === "failed") sessionStorage.setItem(KEY, JSON.stringify(next));
    else if (next.status === "idle") sessionStorage.removeItem(KEY);
  } catch {
    /* بلا تخزين: النقطة تبقى لهذه الصفحة فقط */
  }
  listeners.forEach((listener) => listener(location()));
}

const round = (degrees) => Math.round(degrees * 1e6) / 1e6;

function fail(problem) {
  // فشل إعادة التحديد لا يمحو نقطة صالحة حددها المريض قبل قليل.
  update(state.point ? { ...state, status: "ready", problem } : { ...IDLE, status: "failed", problem });
}

/** يسأل المتصفح عن موقع المريض. fresh: المريض طلب التحديث بنفسه، فلا نقبل موقعًا قديمًا. */
function locate({ fresh = false } = {}) {
  if (state.status === "locating") return;
  if (!("geolocation" in navigator)) return fail("unsupported");
  if (window.isSecureContext === false) return fail("insecure");
  const asked = ++generation;
  update({ ...state, status: "locating", problem: null });
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (asked !== generation) return;
      const { latitude, longitude, accuracy } = position.coords;
      // موقع خارج البلد هو في الغالب عنوان خادم VPN لا مكان المريض: لا نحسب منه مسافات.
      if (!inSyria(latitude, longitude)) return fail("outside");
      update({ status: "ready", point: [round(latitude), round(longitude)], source: "gps", accuracy: Number.isFinite(accuracy) ? accuracy : null, problem: null });
    },
    (error) => {
      if (asked !== generation) return;
      fail(error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable");
    },
    // GPS الجهاز إن وُجد. في التحديد التلقائي يكفي موقع عمره أقل من دقيقة.
    { enableHighAccuracy: true, timeout: 15000, maximumAge: fresh ? 0 : 60000 },
  );
}

/** نقطة يضعها المريض بضغطة على الخريطة: تلغي أي طلب تحديد جارٍ وتحل محله. */
export function pickOnMap(lat, lng) {
  generation += 1;
  update({ status: "ready", point: [round(lat), round(lng)], source: "map", accuracy: null, problem: null });
}

/**
 * موقع المريض الآن: { status, point, source, accuracy, problem, near }.
 * near: اسم أقرب مدينة إلى النقطة (للعرض فقط)، أو null إن كانت بعيدة عن كل المدن.
 */
function location() {
  let near = null;
  if (state.point) {
    const nearest = nearestPlace(state.point[0], state.point[1]);
    near = nearest.km <= NEAR_KM ? nearest.place.name : null;
  }
  return { ...state, near };
}

/**
 * يتابع موقع المريض: onChange(location) الآن وعند كل تغيير. أول مرة في التبويب يطلب
 * التحديد التلقائي.
 */
export function watchPatientLocation(onChange) {
  listeners.add(onChange);
  onChange(location());
  if (state.status === "idle") locate();
}

// لماذا فشل التحديد التلقائي، بلا نقطة في آخر الجملة: تُكمَّل بما يفعله المريض.
const PROBLEMS = {
  denied: "المتصفح ممنوع من معرفة موقعك",
  unavailable: "خدمة تحديد الموقع في هذا الجهاز لا ترد الآن",
  timeout: "تأخر تحديد الموقع كثيرًا",
  unsupported: "هذا المتصفح لا يدعم تحديد الموقع",
  insecure: "المتصفح يحدد الموقع فقط حين تُفتح المنصة من هذا الجهاز نفسه أو عبر https",
  outside: "المتصفح أعطى موقعًا خارج سوريا فلم نعتمده، وغالبًا السبب برنامج VPN",
};
// المتصفح نفسه لا يستطيع: إعادة المحاولة لن تغيّر شيئًا.
const NO_RETRY = new Set(["unsupported", "insecure"]);

/** من أين تُحسب المسافة الآن، بكلمتين: للعناوين الصغيرة تحت الأرقام. */
export const originLabel = (where) => (where.source === "gps" ? "موقعك الحالي" : "النقطة التي حدّدتها");

/**
 * سطر الحالة: ماذا نعرف عن موقع المريض الآن، وماذا يفعل إن لم نعرفه.
 * الدائرة البنفسجية هي نفسها دبوس «موقعك» على الخريطة.
 */
export function renderLocationBar(container, where) {
  const { status, source, accuracy, problem, near } = where;
  const place = near ? `قرب ${near}` : null;
  const coarse = source === "gps" && accuracy !== null && accuracy > COARSE_M;
  const precision = accuracy !== null ? `بدقة نحو ${formatDistance(accuracy / 1000)}` : null;
  const facts = [place, precision].filter(Boolean).join("، ");

  // ok: نقطة موثوقة. approx: نقطة تحتاج انتباهًا. none: لا نقطة. busy: نسأل المتصفح الآن.
  let tone = "ok";
  let title;
  let detail;
  if (status === "failed") {
    tone = "none";
    title = "لم نستطع تحديد موقعك تلقائيًا";
    detail = `${PROBLEMS[problem]}. ${problem === "denied" ? "اسمح له من أيقونة القفل بجانب عنوان الصفحة، أو اضغط" : "اضغط"} على الخريطة عند مكانك.`;
  } else if (status !== "ready") {
    tone = "busy";
    title = "نحدّد موقعك…";
    detail = "إن سألك المتصفح، اسمح له بمعرفة موقعك.";
  } else if (problem) {
    // طلب المريض تحديث موقعه ففشل: نقطته السابقة باقية، ونقول له ذلك.
    tone = "approx";
    title = "لم يتغيّر موقعك";
    detail = `${PROBLEMS[problem]}. المسافات ما زالت تُحسب من ${source === "gps" ? "موقعك السابق" : "النقطة التي حدّدتها على الخريطة"}.`;
  } else if (source === "gps") {
    tone = coarse ? "approx" : "ok";
    title = coarse ? "موقعك تقريبي" : "حدّدنا موقعك";
    detail = coarse ? `${facts} فقط. اضغط على الخريطة عند مكانك بالضبط لتصحيحه.` : facts ? `${facts}. المسافات تُحسب منه.` : "المسافات تُحسب منه.";
  } else {
    title = "موقعك هو النقطة التي حدّدتها على الخريطة";
    detail = `${place ? `${place}. ` : ""}اضغط على الخريطة لتغييرها.`;
  }
  const busy = status === "locating" || status === "idle";
  const canRetry = !busy && !NO_RETRY.has(problem);
  const label = status === "failed" ? "أعد المحاولة" : source === "gps" ? "تحديث" : "حدّد تلقائيًا";

  render(
    container,
    html`<div class="whereami whereami--${tone}" role="status" aria-live="polite">
      <span class="whereami__pin" aria-hidden="true"></span>
      <div class="whereami__text"><span class="whereami__title">${title}</span><span class="whereami__detail">${detail}</span></div>
      ${canRetry ? button(label, { size: "sm", variant: "soft", icon: status === "failed" ? "rotate_cw" : "locate_fixed", action: "relocate" }) : ""}
    </div>`,
  );
  container.querySelector("[data-action=relocate]")?.addEventListener("click", () => locate({ fresh: true }));
}
