/** تنسيق العرض: التواريخ والأوقات بتوقيت المنصة، المبالغ، المسافات، والعدد مع المعدود بالعربية. */

import { CONFIG } from "./api.js";
import { packUnit } from "./text.js";

export const TIMEZONE = "Asia/Amman";
const LOCALE = "ar-JO-u-nu-latn";

const dateTime = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE });
const dateOnly = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeZone: TIMEZONE });
const dateLong = new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long", timeZone: TIMEZONE });

const asDate = (iso) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);

export const formatDateTime = (iso) => (iso ? dateTime.format(new Date(iso)) : "—");
export const formatDate = (iso) => (iso ? dateOnly.format(asDate(iso)) : "—");
/** مثل «السبت، 3 أكتوبر» — لعناوين اليوم. */
export const formatDayLong = (iso) => (iso ? dateLong.format(asDate(iso)) : "—");
/** نهاية فترة مفتوحة [start, end): آخر يوم فيها هو اليوم السابق لـ end. */
export const formatEndExclusive = (iso) => (iso ? dateOnly.format(new Date(new Date(iso).getTime() - 1)) : "—");

export function formatClock(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "ص" : "م";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** عملة المنصة من INVENTORY_CURRENCY في ملف .env، فالواجهة والخدمات على العملة نفسها. */
const CURRENCY = String(CONFIG.currency || "SYP").toUpperCase();
const CURRENCY_LABELS = { SYP: "ل.س", JOD: "د.أ" };
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fractional = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** اسم العملة المختصر كما يُعرض: «ل.س». */
export const currencyLabel = (currency = CURRENCY) => CURRENCY_LABELS[currency] ?? currency;

/** «7,500 ل.س» — الليرة بفواصل الآلاف وبلا كسور إلا إن وُجدت؛ الدينار بمنزلتين دائمًا. */
export function formatMoney(amount, currency = CURRENCY) {
  const number = Number(amount);
  const value = currency === "JOD" || !Number.isInteger(number) ? fractional.format(number) : whole.format(number);
  return `${value} ${currencyLabel(currency)}`;
}

/** المسافة للعرض: «850 م» تحت الكيلومتر، «2.4 كم» حتى عشرة، ثم «254 كم». */
export function formatDistance(km) {
  const value = Number(km);
  if (km === null || km === undefined || !Number.isFinite(value)) return "—";
  if (value < 1) return `${Math.max(10, Math.round(value * 100) * 10)} م`;
  return value < 10 ? `${value.toFixed(1)} كم` : `${Math.round(value)} كم`;
}

/** مدة تقريبية بالدقائق: «7 د»، «1 س 55 د». */
export function formatMinutes(minutes) {
  const total = Math.max(1, Math.round(Number(minutes)));
  if (total < 60) return `${total} د`;
  const rest = total % 60;
  return rest ? `${Math.floor(total / 60)} س ${rest} د` : `${Math.floor(total / 60)} س`;
}

export function relativeTime(iso) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "الآن";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `قبل ${minutes} د`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `قبل ${hours} س`;
  return formatDate(iso);
}

/** اليوم بتوقيت عمّان بصيغة YYYY-MM-DD. */
export function todayLocal() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
}

export function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// [المفرد، المثنى، الجمع، التمييز المنصوب، مؤنث؟]
const NOUNS = {
  box: ["علبة", "علبتان", "علب", "علبة", true],
  TABLET: ["قرص", "قرصان", "أقراص", "قرصًا", false],
  CAPSULE: ["كبسولة", "كبسولتان", "كبسولات", "كبسولة", true],
  ML: ["مل", "مل", "مل", "مل", false],
  G: ["غرام", "غرامان", "غرامات", "غرامًا", false],
  DOSE: ["بخّة", "بخّتان", "بخّات", "بخّة", true],
  PIECE: ["قطعة", "قطعتان", "قطع", "قطعة", true],
  dose: ["جرعة", "جرعتان", "جرعات", "جرعة", true],
  item: ["صنف", "صنفان", "أصناف", "صنفًا", false],
  medication: ["دواء", "دواءان", "أدوية", "دواءً", false],
  order: ["طلب", "طلبان", "طلبات", "طلبًا", false],
  pharmacy: ["صيدلية", "صيدليتان", "صيدليات", "صيدلية", true],
  day: ["يوم", "يومان", "أيام", "يومًا", false],
  message: ["رسالة", "رسالتان", "رسائل", "رسالة", true],
};

/** العدد مع المعدود بصيغة عربية صحيحة (نفس قاعدة medplat.arabic في الخادم). */
export function count(value, noun) {
  const n = Number(value);
  const known = NOUNS[noun];
  const [singular, dual, plural, tamyeez, feminine] = known ?? [packUnit[noun] ?? noun, "", "", "", false];
  if (!Number.isInteger(n)) return `${n} ${singular}`;
  // وحدة لا تُثنّى ولا تُجمع (مل) أو معدود غير معروف: الرقم يُكتب دائمًا.
  if (!known || (singular === dual && dual === plural)) return `${n} ${singular}`;
  if (n === 1) return `${singular} ${feminine ? "واحدة" : "واحد"}`;
  if (n === 2) return dual;
  const r = n % 100;
  if (r >= 3 && r <= 10) return `${n} ${plural}`;
  if (r >= 11 && r <= 99) return `${n} ${tamyeez}`;
  return `${n} ${singular}`;
}
