/**
 * النصوص العربية الثابتة المرتبطة بقيم الـ API: أسماء الحالات، الأشكال الدوائية، التصنيفات،
 * ورسائل الأخطاء. الخادم يرسل رموزًا (PENDING، TABLET…) والواجهة تعرضها من هنا.
 */

import { ApiError } from "./api.js";

export const orderStatus = {
  // [قرار المستخدم] طلب بصورة وصفة يمر بهاتين قبل PENDING.
  IN_REVIEW: "بانتظار مراجعة الوصفة",
  QUOTED: "بانتظار موافقة المريض",
  PENDING: "بانتظار الصيدلية",
  DISPENSED: "تم الصرف",
  REJECTED: "مرفوض",
  CANCELLED: "ملغى",
};

/** لون الشارة لكل حالة: كهرماني = ينتظر، أخضر = صُرف، مرجاني = رُفض. */
export const orderStatusTone = {
  IN_REVIEW: "blue",
  QUOTED: "violet",
  PENDING: "amber",
  DISPENSED: "green",
  REJECTED: "coral",
  CANCELLED: "neutral",
};

export const orderAction = {
  quote: "إرسال العرض للمريض",
  approve: "موافقة على العرض",
  dispense: "قبول وصرف",
  reject: "رفض",
  cancel: "إلغاء الطلب",
};

/** [قرار المستخدم] نوع الطلب: من البحث (أصناف يختارها المريض) أو بصورة وصفة. */
export const orderKind = {
  STANDARD: "طلب",
  PRESCRIPTION: "وصفة",
};

/** حالة حساب المريض كما يراها الأدمن. */
export const accountStatus = {
  ACTIVE: "نشط",
  SUSPENDED: "موقوف",
  DEACTIVATED: "معطَّل",
};

export const accountStatusTone = {
  ACTIVE: "green",
  SUSPENDED: "coral",
  DEACTIVATED: "neutral",
};

export const pharmacyStatus = {
  PENDING_APPROVAL: "بانتظار الاعتماد",
  ACTIVE: "معتمدة",
  REJECTED: "مرفوضة",
  SUSPENDED: "موقوفة",
};

export const pharmacyStatusTone = {
  PENDING_APPROVAL: "amber",
  ACTIVE: "green",
  REJECTED: "coral",
  SUSPENDED: "neutral",
};

export const dosageForm = {
  TABLET: "أقراص",
  CAPSULE: "كبسولات",
  SYRUP: "شراب",
  SUSPENSION: "معلّق",
  INJECTION: "حقن",
  CREAM: "كريم",
  OINTMENT: "مرهم",
  GEL: "جل",
  DROPS: "قطرات",
  INHALER: "بخاخ",
  SUPPOSITORY: "تحاميل",
  PATCH: "لصقات",
  SACHET: "أكياس",
  OTHER: "أخرى",
};

/** التصنيف العلاجي للدواء: قائمة ثابتة بترتيب العرض (نفس قائمة medication-service). */
export const medicationCategory = {
  ANALGESIC: "مسكنات وخافضات حرارة",
  ANTIBIOTIC: "مضادات حيوية",
  CARDIOVASCULAR: "القلب والضغط",
  DIABETES: "السكري",
  RESPIRATORY: "الجهاز التنفسي",
  GASTROINTESTINAL: "الجهاز الهضمي",
  ALLERGY: "الحساسية",
  VITAMINS: "فيتامينات ومكملات",
  DERMATOLOGY: "الجلدية",
  NEUROLOGY: "الأعصاب والصحة النفسية",
  HORMONAL: "الهرمونات والغدد",
  EYE_ENT: "العين والأنف والأذن",
  MUSCULOSKELETAL: "العظام والمفاصل",
  OTHER: "أخرى",
};

export const packUnit = {
  TABLET: "قرص",
  CAPSULE: "كبسولة",
  ML: "مل",
  G: "غرام",
  DOSE: "بخّة",
  PIECE: "قطعة",
};

export const documentType = {
  PHARMACY_LICENSE: "رخصة الصيدلية",
  COMMERCIAL_REGISTRATION: "السجل التجاري",
  PHARMACIST_LICENSE: "رخصة مزاولة صيدلي",
  OTHER: "أخرى",
};

export const movementType = {
  INITIAL: "رصيد افتتاحي",
  RESTOCK: "توريد",
  ADJUSTMENT: "تسوية",
  DISPENSE: "صرف طلب",
  DISPENSE_REVERSAL: "تراجع عن صرف",
};

export const doseState = {
  UPCOMING: "قادمة",
  DUE: "حان وقتها",
  OVERDUE: "متأخرة",
  TAKEN: "أُخذت",
  MISSED: "فاتت",
  SKIPPED: "تُركت",
};

export const doseStateTone = {
  UPCOMING: "neutral",
  DUE: "blue",
  OVERDUE: "amber",
  TAKEN: "green",
  MISSED: "coral",
  SKIPPED: "neutral",
};

export const roleLabel = {
  PATIENT: "مريض",
  PHARMACY: "صيدلية",
  ADMIN: "مدير النظام",
  SYSTEM: "النظام",
};

export const weekdays = [
  { value: 6, label: "السبت" },
  { value: 7, label: "الأحد" },
  { value: 1, label: "الاثنين" },
  { value: 2, label: "الثلاثاء" },
  { value: 3, label: "الأربعاء" },
  { value: 4, label: "الخميس" },
  { value: 5, label: "الجمعة" },
];

// ----------------------------------------------------------------------------- رقم الهاتف

/** رقم هاتف دولي: + ثم 8 إلى 15 رقمًا. */
export const E164 = /^\+[1-9][0-9]{7,14}$/;
const PHONE_HINT = "اكتب رقم الهاتف بالصيغة الدولية، مثل \u200e+963944000000";

/** معرّف بلا @ يجب أن يكون رقمًا دوليًا: نخبر المستخدم قبل الإرسال بدل "بعض الحقول غير صحيحة". */
export function identifierHint(value) {
  const v = value.trim();
  if (!v || v.includes("@")) return "";
  return E164.test(v) ? "" : PHONE_HINT;
}

// ----------------------------------------------------------------------------- الأخطاء

const errorMessages = {
  NETWORK_ERROR: "تعذر الاتصال بالخادم. تحقق من أن الخدمات تعمل.",
  SERVICE_UNAVAILABLE: "إحدى خدمات النظام غير متاحة الآن. حاول بعد قليل.",
  INTERNAL_ERROR: "حدث خطأ غير متوقع.",
  UNAUTHORIZED: "انتهت الجلسة. سجّل الدخول من جديد.",
  FORBIDDEN: "ليست لديك صلاحية لهذا الإجراء.",
  NOT_FOUND: "العنصر المطلوب غير موجود.",
  VALIDATION_ERROR: "بعض الحقول غير صحيحة.",
  INVALID_REQUEST: "الطلب غير صالح.",
  RATE_LIMITED: "محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.",
  REQUEST_TOO_LARGE: "حجم البيانات أكبر من المسموح.",
  INVALID_CREDENTIALS: "بيانات الدخول غير صحيحة.",
  ACCOUNT_ALREADY_EXISTS: "يوجد حساب بهذا المعرّف مسبقًا.",
  REFRESH_TOKEN_INVALID: "انتهت الجلسة. سجّل الدخول من جديد.",
  PATIENT_PROFILE_NOT_FOUND: "لم تُنشئ ملفك الشخصي بعد.",
  PATIENT_PROFILE_EXISTS: "ملفك الشخصي موجود مسبقًا.",
  PATIENT_PROFILE_REQUIRED: "أكمل ملفك الشخصي قبل الطلب.",
  PHARMACY_PROFILE_NOT_FOUND: "لم تُنشئ ملف الصيدلية بعد.",
  PHARMACY_PROFILE_REQUIRED: "أكمل ملف الصيدلية أولًا.",
  PHARMACY_PROFILE_EXISTS: "ملف الصيدلية موجود مسبقًا.",
  PHARMACY_LICENSE_EXISTS: "رقم الترخيص مسجل لصيدلية أخرى.",
  PHARMACY_NOT_ACTIVE: "صيدليتك غير معتمدة حاليًا.",
  REQUEST_ALREADY_OPEN: "لك طلب مفتوح لهذا الدواء، بانتظار رد الإدارة.",
  TOO_MANY_OPEN_REQUESTS: "لك 20 طلبًا بانتظار رد الإدارة. انتظر ردها قبل إرسال المزيد.",
  REQUEST_ALREADY_ANSWERED: "رُدّ على هذا الطلب من قبل. حدّث الصفحة.",
  REQUEST_NOT_FOUND: "الطلب غير موجود.",
  PHARMACY_STATUS_CONFLICT: "لا يمكن تنفيذ هذا الإجراء في حالة الصيدلية الحالية.",
  PHARMACY_LICENSE_DOCUMENT_REQUIRED: "يجب رفع وثيقة رخصة الصيدلية قبل الاعتماد.",
  PHARMACY_NOT_FOUND: "الصيدلية غير موجودة.",
  UNSUPPORTED_FILE_TYPE: "نوع الملف غير مدعوم. المسموح: PDF أو PNG أو JPEG.",
  DOCUMENT_LOCKED: "لا يمكن حذف الوثائق بعد الاعتماد.",
  DOCUMENT_LIMIT_REACHED: "وصلت للحد الأقصى من الوثائق.",
  PHARMACIST_ALREADY_EXISTS: "صيدلي بنفس رقم الترخيص مسجل مسبقًا.",
  MEDICATION_ALREADY_EXISTS: "يوجد دواء بنفس الاسم والتركيز والشكل.",
  MEDICATION_NOT_FOUND: "الدواء غير موجود.",
  INVENTORY_ITEM_EXISTS: "هذا الدواء موجود في مخزونك. استخدم التوريد لزيادة الكمية.",
  INSUFFICIENT_STOCK: "الكمية المتوفرة غير كافية.",
  QUANTITY_LIMIT: "الكمية أكبر من الحد المسموح.",
  ORDER_ITEMS_UNAVAILABLE: "بعض الأدوية غير متاحة في هذه الصيدلية.",
  ORDER_STATE_CONFLICT: "حالة الطلب تغيّرت. حدّث الصفحة.",
  DISPENSE_IN_PROGRESS: "الطلب قيد الصرف من جهاز آخر.",
  DISPENSE_ATTEMPT_EXPIRED: "انتهت مهلة الصرف. حاول مرة أخرى.",
  IDEMPOTENCY_KEY_REUSED: "تعارض في إعادة إرسال الطلب. أعد المحاولة.",
  SCHEDULE_ALREADY_OPEN: "لهذا الدواء جدول مفتوح. أنهِه قبل إنشاء جديد.",
  SCHEDULE_ENDED: "الجدول منتهٍ ولا يمكن تعديله.",
  SCHEDULE_STATE_CONFLICT: "لا يمكن تغيير الجدول إلى هذه الحالة.",
  PATIENT_MEDICATION_STOPPED: "هذا الدواء موقوف. فعّله أولًا.",
  DOSE_ALREADY_RECORDED: "سُجّلت هذه الجرعة مسبقًا.",
  DOSE_OUT_OF_WINDOW: "لا يمكن تسجيل هذه الجرعة الآن (مبكر أو متأخر جدًا).",
  NOT_A_SCHEDULED_DOSE: "لا توجد جرعة مجدولة في هذا الموعد.",
  NOT_ENOUGH_DATA: "نحتاج 3 جرعات مسجلة على الأقل خلال آخر 7 أيام.",
  INSIGHT_REJECTED: "تعذر إنتاج ملخص مناسب.",
  CONFLICT: "تعارض مع حالة البيانات الحالية. حدّث الصفحة وحاول مجددًا.",
  METHOD_NOT_ALLOWED: "الإجراء غير مسموح.",
  ORDER_NOT_FOUND: "الطلب غير موجود.",
  DOCUMENT_NOT_FOUND: "الوثيقة غير موجودة (ربما حُذفت للتو).",
  DOCUMENT_FILE_MISSING: "ملف الوثيقة غير متاح على الخادم.",
  INVENTORY_ITEM_NOT_FOUND: "الصنف غير موجود في مخزونك.",
  PATIENT_MEDICATION_NOT_FOUND: "الدواء غير موجود في سجلك.",
  SCHEDULE_NOT_FOUND: "الجدول غير موجود.",
  DOSE_TIME_NOT_FOUND: "موعد الجرعة غير موجود.",
  DOSE_NOT_IN_ACTIVE_PERIOD: "هذه الجرعة خارج فترة نشاط الجدول (قبل إنشائه أو بعد إيقافه).",
  INSIGHT_NOT_FOUND: "الملخص غير موجود.",
  NOTIFICATION_NOT_FOUND: "الإشعار غير موجود.",
  PHARMACIST_NOT_FOUND: "الصيدلي غير موجود.",
  ACCOUNT_SUSPENDED: "حسابك موقوف من إدارة المنصة.",
  ACCOUNT_NOT_FOUND: "حساب المريض غير موجود.",
  ACCOUNT_STATUS_CONFLICT: "تغيّرت حالة الحساب قبل قليل. حُدّثت القائمة.",
  PHARMACY_CHANGED_SINCE_REVIEW: "تغيّر ملف الصيدلية أو وثائقها منذ فتحته. راجعه من جديد ثم اعتمده.",
  // [قرار المستخدم] الوصفة، طريقة الاستعمال، والرسائل
  TOO_MANY_OPEN_PRESCRIPTIONS: "لك 10 وصفات تنتظر الصيدليات أو موافقتك. انتظر حتى تُعالج.",
  PRESCRIPTION_NOT_FOUND: "لا صورة وصفة لهذا الطلب.",
  PRESCRIPTION_FILE_MISSING: "ملف الوصفة غير متاح على الخادم.",
  DOSE_PLAN_LOCKED: "لا يمكن تغيير طريقة الاستعمال في حالة الطلب الحالية.",
  ORDER_ITEM_NOT_FOUND: "الصنف غير موجود في الطلب.",
  CONVERSATION_NOT_FOUND: "المحادثة غير موجودة.",
  MESSAGE_NOT_FOUND: "الرسالة غير موجودة.",
  TOO_MANY_MESSAGES: "أرسلت رسائل كثيرة خلال دقيقة. انتظر قليلًا.",
  PHARMACY_NOT_AVAILABLE: "هذه الصيدلية غير متاحة حاليًا.",
};

// رمز غير معروف للواجهة يُعرض حسب فئته لا بنص الخادم الإنجليزي.
function messageForUnknown(error) {
  if (error.code.endsWith("_NOT_FOUND")) return errorMessages.NOT_FOUND;
  if (error.status === 0) return errorMessages.NETWORK_ERROR;
  if (error.status === 401) return errorMessages.UNAUTHORIZED;
  if (error.status === 403) return errorMessages.FORBIDDEN;
  if (error.status === 404) return errorMessages.NOT_FOUND;
  if (error.status === 409) return errorMessages.CONFLICT;
  if (error.status === 429) return errorMessages.RATE_LIMITED;
  if (error.status === 400 || error.status === 422) return errorMessages.VALIDATION_ERROR;
  if (error.status === 503) return errorMessages.SERVICE_UNAVAILABLE;
  return errorMessages.INTERNAL_ERROR;
}

const detailPatterns = [
  [/^This field is required\.$/, () => "هذا الحقل مطلوب."],
  [/^Unknown field\.$/, () => "حقل غير معروف."],
  [/^Length must be between (\d+) and (\d+) characters\.$/, (m) => `الطول بين ${m[1]} و${m[2]} حرفًا.`],
  [/^Must be at least (.+)\.$/, (m) => `يجب ألا يقل عن ${m[1]}.`],
  [/^Must be at most (.+)\.$/, (m) => `يجب ألا يزيد عن ${m[1]}.`],
  [/^Must be one of: (.+)\.$/, () => "قيمة غير مسموحة."],
  [/^Email format is invalid\.$/, () => "صيغة البريد غير صحيحة."],
  [/^Phone must use E\.164 format/, () => "اكتب الرقم بالصيغة الدولية مثل ‎+963944000000."],
  [/^At most (\d+) decimal places/, (m) => `بحد أقصى ${m[1]} منازل عشرية.`],
  [/^Must be (an integer|a decimal number|a number)\.$/, () => "يجب أن يكون رقمًا."],
  [/^Must be a date/, () => "تاريخ غير صالح."],
  [/^Must be a time/, () => "وقت غير صالح."],
  [/^Duplicate/, () => "قيمة مكررة."],
  [/^Must be a valid IANA time zone/, () => "منطقة زمنية غير صالحة."],
  [/^Date of birth must be/, () => "تاريخ الميلاد غير منطقي."],
  [/^Must not be before the start date/, () => "يجب أن يكون بعد تاريخ البداية."],
  [/^Medication is not in the active catalog/, () => "الدواء غير موجود في الكتالوج النشط."],
  [/^Medication is not available/, () => "الدواء غير متاح."],
  [/^This pharmacy does not offer/, () => "الصيدلية لا توفر هذا الدواء."],
  [/^Not enough stock/, () => "الكمية غير كافية حاليًا."],
  [/^Quantity changes only through stock movements/, () => "الكمية تتغير بحركة مخزون فقط."],
  [/^No changes supplied/, () => "لم تغيّر أي شيء."],
  [/^Contains invalid characters/i, () => "يحتوي رموزًا غير صالحة."],
  [/contains invalid characters/i, () => "يحتوي رموزًا غير صالحة."],
  [/^Must be a finite number/, () => "يجب أن يكون رقمًا صحيحًا."],
  [/^Must be a boolean/, () => "قيمة غير صالحة."],
  [/^Must be a (string|list|an object)/, () => "قيمة غير صالحة."],
  [/^Must be a valid UUID/, () => "معرّف غير صالح."],
  [/^Must be an ISO 8601 datetime/, () => "تاريخ ووقت غير صالحين."],
  [/^Must contain between (\d+) and (\d+) items/, (m) => `بين ${m[1]} و${m[2]} عناصر.`],
  [/^Must not be after 'to'/, () => "يجب ألا يكون بعد تاريخ النهاية."],
  [/^Must not be more than (\d+) days in the past/, (m) => `لا يمكن أن يكون أقدم من ${m[1]} أيام.`],
  [/^Must not be zero/, () => "لا يمكن أن تكون صفرًا."],
  [/^Only a taken dose has a taken time/, () => "وقت الأخذ للجرعة المأخوذة فقط."],
  [/^The range must not exceed (\d+) days/, (m) => `الفترة لا تتجاوز ${m[1]} يومًا.`],
  [/^Unknown status/, () => "حالة غير معروفة."],
  [/^Use multipart\/form-data/, () => "أرفق الملف من النموذج."],
  [/^Must be between the allowed early time and now/, () => "وقت الأخذ يجب أن يكون بين بداية نافذة الجرعة والآن."],
  [/^Must be between (\d{4}-\d{2}-\d{2}) and (\d{4}-\d{2}-\d{2})/, (m) => `التاريخ بين ${m[1]} و${m[2]}.`],
  [/^A restock must add stock/, () => "التوريد يزيد المخزون فقط. استخدم التسوية للإنقاص."],
  [/^Mixed currencies/, () => "عملات مختلفة في نفس الطلب."],
  [/^Header is required/, () => "تعذر إرسال الطلب بأمان. أعد المحاولة."],
  // رسائل Auth (تأتي في message لا في details)
  [/email format is invalid/i, () => "صيغة البريد غير صحيحة."],
  [/phone (must use|format is invalid)|E\.164/i, () => "اكتب الرقم بالصيغة الدولية مثل ‎+963944000000."],
  [/password length must be between (\d+) and (\d+)/i, (m) => `كلمة المرور بين ${m[1]} و${m[2]} حرفًا.`],
  [/(Exactly one of email or phone|Provide either email or phone)/i, () => "أدخل بريدًا إلكترونيًا أو رقم هاتف (واحدًا فقط)."],
  [/code must be exactly 6 digits/i, () => "الرمز 6 أرقام."],
  [/identifier is required/i, () => "أدخل البريد أو رقم الهاتف."],
];

function matchDetail(message) {
  for (const [pattern, render] of detailPatterns) {
    const match = message.match(pattern);
    if (match) return render(match);
  }
  return null;
}

/** سبب الحقل بالعربية. نص الخادم الإنجليزي لا يُعرض للمستخدم أبدًا. */
function translateDetail(message) {
  return matchDetail(message) ?? "قيمة غير صالحة.";
}

export function errorMessage(error) {
  if (error instanceof ApiError) {
    if (error.code === "VALIDATION_ERROR") {
      const first = Object.values(error.details)[0];
      // Auth تضع السبب في الرسالة بلا details.
      if (first) return translateDetail(String(first));
      return matchDetail(error.message) ?? errorMessages.VALIDATION_ERROR;
    }
    return errorMessages[error.code] ?? messageForUnknown(error);
  }
  return errorMessages.INTERNAL_ERROR;
}

export function fieldErrors(error) {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(Object.entries(error.details).map(([key, value]) => [key, translateDetail(String(value))]));
}
