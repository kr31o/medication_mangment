/**
 * الاتصال بالخدمات: الجلسة (رمزا الدخول)، إرسال الطلبات، وكل روابط الـ API في مكان واحد.
 *
 * كل طلب يذهب إلى /api/v1/… على نفس العنوان، والبوابة (scripts/web.py) توصله للخدمة
 * صاحبته. المتصفح لا يعرف منافذ الخدمات.
 *
 * الجلسة:
 * - رمز الدخول (access، 15 دقيقة) ورمز التجديد (refresh) محفوظان في localStorage، فتبقى
 *   الجلسة بين الصفحات وبعد إغلاق المتصفح، وتشترك فيها كل تبويبات المتصفح نفسه.
 * - قبل انتهاء رمز الدخول بنصف دقيقة يُجدَّد مرة واحدة. Web Locks تمنع تبويبين من
 *   التجديد معًا: الخادم يعتبر استعمال رمز التجديد مرتين سرقة ويلغي الجلسة كلها.
 * - الخروج من تبويب يحذف الرمزين، فتخرج كل التبويبات (layout.js يراقب ذلك).
 */

/** خطأ موحد لكل استجابة فاشلة: status و code من الخادم، و details أخطاء الحقول. */
export class ApiError extends Error {
  constructor(status, code, message, details = {}, requestId = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

const NETWORK_ERROR = () => new ApiError(0, "NETWORK_ERROR", "تعذر الاتصال بالخادم.");

// ----------------------------------------------------------------------------- إعدادات الواجهة

/**
 * من ملف .env عبر البوابة (/config.json): عملة المنصة، هل يُطلب رمز تحقق عند إنشاء الحساب،
 * وعنوان خدمة مسافة الطريق.
 */
async function loadConfig() {
  const fallback = { currency: "SYP", routing_url: "https://router.project-osrm.org" };
  try {
    const response = await fetch("/config.json", { cache: "no-store" });
    return response.ok ? { ...fallback, ...(await response.json()) } : fallback;
  } catch {
    return fallback;
  }
}

export const CONFIG = await loadConfig();

// ----------------------------------------------------------------------------- الجلسة

const ACCESS_KEY = "medplat.access";
export const REFRESH_KEY = "medplat.refresh";

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* تخزين المتصفح معطّل: الجلسة لا تبقى بين الصفحات */
  }
}

/** هوية المستخدم من رمز الدخول: { userId, role, expiresAt }. */
function decode(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return { userId: payload.sub, role: payload.role, expiresAt: payload.exp * 1000 };
  } catch {
    return null;
  }
}

const fresh = (token) => {
  const principal = token ? decode(token) : null;
  return principal && principal.expiresAt - Date.now() > 30_000 ? token : null;
};

let refreshing = null;

async function doRefresh() {
  const run = async () => {
    // داخل القفل: ربما جدّد تبويب آخر قبل لحظة، فنقرأ آخر ما حُفظ.
    const current = fresh(read(ACCESS_KEY));
    if (current) return current;
    const token = read(REFRESH_KEY);
    if (!token) return null;
    let response;
    try {
      response = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: token }),
      });
    } catch {
      // انقطاع الشبكة ليس رفضًا للجلسة: نُبقي رمز التجديد.
      throw NETWORK_ERROR();
    }
    if (!response.ok) {
      if (response.status === 401 && read(REFRESH_KEY) === token) session.clear();
      return null;
    }
    const data = (await response.json()).data;
    session.set(data.access_token, data.refresh_token);
    return data.access_token;
  };
  return navigator.locks ? navigator.locks.request("medplat-refresh", run) : run();
}

function refreshOnce() {
  if (!refreshing) refreshing = doRefresh().finally(() => (refreshing = null));
  return refreshing;
}

export const session = {
  /** من الداخل الآن (من رمز الدخول المحفوظ)، أو null. */
  principal() {
    const token = read(ACCESS_KEY);
    return token && read(REFRESH_KEY) ? decode(token) : null;
  },
  set(access, refresh) {
    write(ACCESS_KEY, access);
    write(REFRESH_KEY, refresh);
  },
  /** خروج: يحذف الرمزين، ومعهما ما حفظه هذا التبويب (موقع المريض مثلًا) فلا يبقى لمن يدخل بعده. */
  clear() {
    write(ACCESS_KEY, null);
    write(REFRESH_KEY, null);
    try {
      sessionStorage.clear();
    } catch {
      /* لا شيء */
    }
  },
  /** رمز دخول صالح (يُجدَّد إن قارب الانتهاء)، أو null إن لم يكن هناك جلسة. */
  async token() {
    return fresh(read(ACCESS_KEY)) ?? (read(REFRESH_KEY) ? refreshOnce() : null);
  },
  /** يتأكد أن الجلسة صالحة ويرجع صاحبها، أو null. */
  async check() {
    try {
      return (await session.token()) ? session.principal() : null;
    } catch {
      // الخادم لا يرد: نعتمد آخر هوية معروفة، والصفحة تعرض خطأ الاتصال بنفسها.
      return session.principal();
    }
  },
  refreshToken: () => read(REFRESH_KEY),
};

// ----------------------------------------------------------------------------- الطلبات

function buildUrl(path, query) {
  if (!query) return path;
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  });
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

async function send(path, options, retried = false) {
  const headers = { Accept: "application/json", ...(options.headers ?? {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.auth !== false) {
    const token = await session.token();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      headers,
      body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    });
  } catch {
    throw NETWORK_ERROR();
  }
  // رمز رُفض (انتهى للتو): نجدده مرة ونعيد الطلب.
  if (response.status === 401 && options.auth !== false && !retried && read(REFRESH_KEY)) {
    write(ACCESS_KEY, null);
    if (await refreshOnce()) return send(path, options, true);
  }
  return response;
}

async function parse(response) {
  if (response.status === 204) return null;
  let body = null;
  let readable = true;
  try {
    body = await response.json();
  } catch {
    readable = false;
  }
  if (!response.ok) {
    const error = body?.error ?? {};
    throw new ApiError(
      response.status,
      error.code ?? (response.status >= 500 ? "SERVICE_UNAVAILABLE" : "INVALID_REQUEST"),
      error.message ?? response.statusText,
      error.details ?? {},
      body?.request_id,
    );
  }
  // رد ناجح انقطع قبل اكتماله: يُعامل كانقطاع اتصال لا كنتيجة فارغة.
  if (!readable) throw NETWORK_ERROR();
  return body;
}

/** طلب عادي: يرجع حقل data. الخيارات: method, body, query, headers, auth, form. */
export async function api(path, options = {}) {
  return (await parse(await send(path, options)))?.data ?? null;
}

/** قائمة بصفحات: يرجع { items, total, limit, offset }. */
async function apiPage(path, query) {
  const body = await parse(await send(path, { query }));
  return { items: body.data, ...body.meta };
}

/** ملف من الخادم كـ Blob (صورة وصفة تُعرض في الصفحة): { blob, type }. */
async function apiBlob(path) {
  const response = await send(path, {});
  if (!response.ok) await parse(response);
  return { blob: await response.blob(), type: response.headers.get("Content-Type") ?? "" };
}

/** تنزيل ملف (وثيقة صيدلية) باسمه الأصلي. */
async function apiDownload(path) {
  const response = await send(path, {});
  if (!response.ok) await parse(response);
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  // filename* (UTF-8) أولًا: الاسم العربي لا يصل سليمًا إلا فيه.
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  let name = "document";
  try {
    name = encoded ? decodeURIComponent(encoded[1]) : plain ? plain[1] : name;
  } catch {
    name = plain ? plain[1] : name;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** مفتاح لمحاولة طلب واحدة: إعادة الإرسال بنفسه لا تنشئ طلبين. */
export function newIdempotencyKey() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID().replace(/-/g, "");
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ----------------------------------------------------------------------------- auth-service

export const auth = {
  register: (body) => api("/api/v1/auth/register", { method: "POST", body, auth: false }),
  login: (identifier, password) => api("/api/v1/auth/login", { method: "POST", body: { identifier, password }, auth: false }),
  logout: (refresh_token) => api("/api/v1/auth/logout", { method: "POST", body: { refresh_token }, auth: false }),
};

/** حسابات المرضى (للأدمن). */
export const accounts = {
  patients: (query) => apiPage("/api/v1/auth/admin/patients", query),
  patientsSummary: () => api("/api/v1/auth/admin/patients/summary"),
  suspendPatient: (id, reason) => api(`/api/v1/auth/admin/patients/${id}/suspend`, { method: "POST", body: { reason } }),
  reactivatePatient: (id) => api(`/api/v1/auth/admin/patients/${id}/reactivate`, { method: "POST" }),
};

// ----------------------------------------------------------------------------- patient-service

export const patients = {
  /** ملف المريض، أو null إن لم يُنشئه بعد. */
  me: async () => {
    try {
      return await api("/api/v1/patients/me");
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  create: (body) => api("/api/v1/patients/me", { method: "POST", body }),
  update: (body) => api("/api/v1/patients/me", { method: "PATCH", body }),
};

// ----------------------------------------------------------------------------- medication-service

export const medications = {
  /** query: { q, category, include_inactive, limit, offset } */
  search: (query) => apiPage("/api/v1/medications", query),
  /** [{ category, medications }]: التصنيفات بترتيبها وعدد الأدوية النشطة في كل منها. */
  categories: () => api("/api/v1/medications/categories"),
  get: (id) => api(`/api/v1/medications/${id}`),
  /** بدائل دواء بنفس التركيبة: { medication, items }. */
  alternatives: (id) => api(`/api/v1/medications/${id}/alternatives`),
  create: (body) => api("/api/v1/admin/medications", { method: "POST", body }),
  update: (id, body) => api(`/api/v1/admin/medications/${id}`, { method: "PATCH", body }),
};

// [قرار المستخدم] طلبات للإدارة: دواء ناقص أو دواء جديد، ورد الأدمن.
export const medicationRequests = {
  /** طلباتي (مريض أو صيدلية). query: { status, limit, offset } */
  mine: (query) => apiPage("/api/v1/medication-requests", query),
  /** body: { request_type: SHORTAGE | NEW_MEDICATION, medication_id | medication_name, details, note } */
  create: (body) => api("/api/v1/medication-requests", { method: "POST", body }),
  /** كل الطلبات (أدمن). query: { status, request_type, limit, offset } */
  all: (query) => apiPage("/api/v1/admin/medication-requests", query),
  summary: () => api("/api/v1/admin/medication-requests/summary"),
  resolve: (id, reply) => api(`/api/v1/admin/medication-requests/${id}/resolve`, { method: "POST", body: reply ? { reply } : {} }),
  reject: (id, reply) => api(`/api/v1/admin/medication-requests/${id}/reject`, { method: "POST", body: { reply } }),
};

// ----------------------------------------------------------------------------- pharmacy-service

const ME = "/api/v1/pharmacies/me";

export const pharmacies = {
  /** query: { lat, lng, radius_km, medication_id, quantity } */
  nearby: (query) => api("/api/v1/pharmacies/nearby", { query }),
  /** بدائل دواء بنفس التركيبة ومع كل بديل أقرب صيدليات فيها. query: { lat, lng, radius_km, medication_id, quantity } */
  nearbyAlternatives: (query) => api("/api/v1/pharmacies/nearby/alternatives", { query }),
  /** الصيدليات المعتمدة. query: { lat, lng, q, limit, offset } — مع النقطة: الأقرب أولًا. */
  directory: (query) => apiPage("/api/v1/pharmacies", query),
  get: (id) => api(`/api/v1/pharmacies/${id}`),
  /** أدوية صيدلية كما يراها المريض: { items, total, categories }، ومعها alternatives إن لم يجد ما بحث عنه. */
  offers: (id, query) => api(`/api/v1/pharmacies/${id}/medications`, { query }),
  /** صيدلية المستخدم، أو null إن لم يُنشئ ملفها بعد. */
  me: async () => {
    try {
      return await api(ME);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  create: (body) => api(ME, { method: "POST", body }),
  update: (body) => api(ME, { method: "PATCH", body }),
  resubmit: () => api(`${ME}/resubmit`, { method: "POST" }),
  history: () => api(`${ME}/history`),
  documents: () => api(`${ME}/documents`),
  upload: (documentType, file) => {
    const form = new FormData();
    form.append("document_type", documentType);
    form.append("file", file);
    return api(`${ME}/documents`, { method: "POST", form });
  },
  download: (id) => apiDownload(`${ME}/documents/${id}/file`),
  deleteDocument: (id) => api(`${ME}/documents/${id}`, { method: "DELETE" }),
  pharmacists: () => api(`${ME}/pharmacists`, { query: { include_inactive: true } }),
  addPharmacist: (body) => api(`${ME}/pharmacists`, { method: "POST", body }),
  updatePharmacist: (id, body) => api(`${ME}/pharmacists/${id}`, { method: "PATCH", body }),
  // الأدمن
  adminList: (query) => apiPage("/api/v1/admin/pharmacies", query),
  adminSummary: () => api("/api/v1/admin/pharmacies/summary"),
  adminGet: (id) => api(`/api/v1/admin/pharmacies/${id}`),
  adminAction: (id, action, reason, reviewToken) =>
    api(`/api/v1/admin/pharmacies/${id}/${action}`, {
      method: "POST",
      body: { ...(reason ? { reason } : {}), ...(action === "approve" && reviewToken ? { review_token: reviewToken } : {}) },
    }),
  adminDownload: (pharmacyId, documentId) => apiDownload(`/api/v1/admin/pharmacies/${pharmacyId}/documents/${documentId}/file`),
};

// ----------------------------------------------------------------------------- inventory-service

export const inventory = {
  /** query: { q, category, low_stock, limit, offset } */
  list: (query) => apiPage("/api/v1/inventory", query),
  /** عدة أدوية دفعة واحدة: [{ medication_id, quantity, unit_price }]، كلها أو لا شيء. */
  bulkCreate: (items) => api("/api/v1/inventory/bulk", { method: "POST", body: { items } }),
  update: (id, body) => api(`/api/v1/inventory/${id}`, { method: "PATCH", body }),
  move: (id, body) => api(`/api/v1/inventory/${id}/movements`, { method: "POST", body }),
  movements: (id, query = {}) => apiPage(`/api/v1/inventory/${id}/movements`, query),
};

// ----------------------------------------------------------------------------- order-service

export const orders = {
  place: (body, idempotencyKey) => api("/api/v1/orders", { method: "POST", body, headers: { "Idempotency-Key": idempotencyKey } }),
  /** [قرار المستخدم] صورة وصفة إلى صيدلية: طلب «بانتظار مراجعة الوصفة». */
  sendPrescription: (pharmacyId, file, note, idempotencyKey) => {
    const form = new FormData();
    form.append("pharmacy_id", pharmacyId);
    if (note) form.append("note", note);
    form.append("file", file);
    return api("/api/v1/orders/prescriptions", { method: "POST", form, headers: { "Idempotency-Key": idempotencyKey } });
  },
  mine: (query) => apiPage("/api/v1/orders", query),
  get: (id) => api(`/api/v1/orders/${id}`),
  prescription: (id) => apiBlob(`/api/v1/orders/${id}/prescription`),
  /** موافقة المريض على عرض الصيدلية لوصفته. */
  approve: (id) => api(`/api/v1/orders/${id}/approve`, { method: "POST" }),
  cancel: (id, reason) => api(`/api/v1/orders/${id}/cancel`, { method: "POST", body: reason ? { reason } : {} }),
  queue: (query) => apiPage("/api/v1/pharmacy/orders", query),
  queueSummary: () => api("/api/v1/pharmacy/orders/summary"),
  pharmacyGet: (id) => api(`/api/v1/pharmacy/orders/${id}`),
  pharmacyPrescription: (id) => apiBlob(`/api/v1/pharmacy/orders/${id}/prescription`),
  /** عرض الوصفة: items [{ medication_id, quantity }]، missing [أسماء ما ليس عندها]. */
  quote: (id, body) => api(`/api/v1/pharmacy/orders/${id}/quote`, { method: "POST", body }),
  /** طريقة الاستعمال لصنف: { days_of_week, times: [{ time, dose_amount }], duration_days, instructions }، أو null للحذف. */
  setDosePlan: (orderId, itemId, plan) =>
    api(`/api/v1/pharmacy/orders/${orderId}/items/${itemId}/dose-plan`, plan ? { method: "PUT", body: plan } : { method: "DELETE" }),
  pharmacyAction: (id, action, reason) => api(`/api/v1/pharmacy/orders/${id}/${action}`, { method: "POST", body: reason ? { reason } : undefined }),
  adminList: (query) => apiPage("/api/v1/admin/orders", query),
  adminSummary: () => api("/api/v1/admin/orders/summary"),
  adminGet: (id) => api(`/api/v1/admin/orders/${id}`),
};

// [قرار المستخدم] الرسائل بين المريض والصيدلية (في order-service).
export const conversations = {
  list: (query) => apiPage("/api/v1/conversations", query),
  unreadCount: () => api("/api/v1/conversations/unread-count"),
  /** المريض يراسل صيدلية: المحادثة العامة بينهما (تُنشأ أول مرة). */
  withPharmacy: (pharmacyId) => api("/api/v1/conversations", { method: "POST", body: { pharmacy_id: pharmacyId } }),
  forOrder: (orderId) => api(`/api/v1/conversations/for-order/${orderId}`, { method: "POST" }),
  /** query: { after } للأحدث، أو { before } للأقدم. */
  thread: (id, query) => api(`/api/v1/conversations/${id}`, { query }),
  send: (id, body) => api(`/api/v1/conversations/${id}/messages`, { method: "POST", body: { body } }),
  markRead: (id) => api(`/api/v1/conversations/${id}/read`, { method: "POST" }),
};

// ----------------------------------------------------------------------------- health-service

export const health = {
  medications: () => api("/api/v1/health/medications"),
  medication: (id) => api(`/api/v1/health/medications/${id}`),
  updateMedication: (id, body) => api(`/api/v1/health/medications/${id}`, { method: "PATCH", body }),
  createSchedule: (medicationId, body) => api(`/api/v1/health/medications/${medicationId}/schedules`, { method: "POST", body }),
  /** body: { status, end_date, instructions }، و replace_open لتفعيل جدول مقترح مكان المفتوح. */
  updateSchedule: (id, body) => api(`/api/v1/health/schedules/${id}`, { method: "PATCH", body }),
  day: (date) => api("/api/v1/health/doses", { query: { date } }),
  record: (body) => api("/api/v1/health/doses", { method: "POST", body }),
  history: (query) => apiPage("/api/v1/health/doses/history", query),
  adherence: () => api("/api/v1/health/adherence"),
};

// ----------------------------------------------------------------------------- ai-service و notification-service

export const insights = {
  list: (query = {}) => apiPage("/api/v1/insights", query),
  get: (id) => api(`/api/v1/insights/${id}`),
  generate: () => api("/api/v1/insights/generate", { method: "POST" }),
};

export const notifications = {
  list: (query) => apiPage("/api/v1/notifications", query),
  unreadCount: () => api("/api/v1/notifications/unread-count"),
  markRead: (id) => api(`/api/v1/notifications/${id}/read`, { method: "POST" }),
  markAllRead: () => api("/api/v1/notifications/read-all", { method: "POST" }),
};
