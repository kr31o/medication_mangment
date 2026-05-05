const API_BASE = "/api";

const Api = {
  token() { return localStorage.getItem("medtrack_token"); },
  qs(params = {}) {
    if (!params) return "";
    if (typeof params === "number") params = { page: params };
    if (typeof params === "string") return params ? `?q=${encodeURIComponent(params)}` : "";
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") sp.append(k, v); });
    const q = sp.toString();
    return q ? `?${q}` : "";
  },
  async request(method, path, body = null) {
    const headers = { Accept: "application/json" };
    const token = Api.token();
    if (token) headers.Authorization = `Bearer ${token}`;
    const opts = { method, headers };
    if (body !== null && body !== undefined) {
      headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${API_BASE}${path}`, opts);
    const text = await res.text();
    let data = {};
    if (text) {
      try { data = JSON.parse(text); } catch { data = { success: false, message: text }; }
    }
    if (!res.ok) {
      const err = new Error(data.message || "تعذر تنفيذ الطلب.");
      err.status = res.status;
      err.errors = data.errors || null;
      if (res.status === 401) Auth.clearSession();
      throw err;
    }
    return data;
  },
  get(path) { return Api.request("GET", path); },
  post(path, body = {}) { return Api.request("POST", path, body); },
  patch(path, body = {}) { return Api.request("PATCH", path, body); },
  put(path, body = {}) { return Api.request("PUT", path, body); },
  delete(path) { return Api.request("DELETE", path); },

  auth: {
    register: d => Api.post("/auth/register", d),
    login: d => Api.post("/auth/login", d),
    loginAdmin: d => Api.post("/auth/admin/login", d),
    logout: () => Api.post("/auth/logout", {}),
  },
  medications: {
    categories: () => Api.get("/medications/categories"),
    list: params => Api.get(`/medications${Api.qs(params)}`),
    myList: status => Api.get(`/medications/my${status ? Api.qs({status}) : ""}`),
    add: d => Api.post("/medications/my", d),
    update: (id, d) => Api.patch(`/medications/my/${id}`, d),
    stop: id => Api.post(`/medications/my/${id}/stop`, {}),
    activate: (id, d) => Api.post(`/medications/my/${id}/activate`, d),
    getSchedule: id => Api.get(`/medications/my/${id}/schedule`),
    setSchedule: (id, d) => Api.post(`/medications/my/${id}/schedule`, d),
    updateSchedule: (id, d) => Api.put(`/medications/my/schedule/${id}`, d),
  },
  doses: {
    history: (id, params) => Api.get(`/doses/my/${id}/history${Api.qs(params)}`),
    allHistory: params => Api.get(`/doses/my/history${Api.qs(params)}`),
    adherence: id => Api.get(`/doses/my/${id}/adherence`),
  },
  notifications: {
    list: params => Api.get(`/notifications/my${Api.qs(params)}`),
    unread: () => Api.get("/notifications/my/unread"),
    markRead: id => Api.patch(`/notifications/my/${id}/read`, {}),
    confirmDose: id => Api.post(`/notifications/my/${id}/confirm-dose`, {}),
    missDose: id => Api.post(`/notifications/my/${id}/miss-dose`, {}),
  },
  admin: {
    stats: () => Api.get("/admin/stats"),
    categories: () => Api.get("/admin/medications/categories"),
    patients: params => Api.get(`/admin/patients${Api.qs(params)}`),
    getPatient: id => Api.get(`/admin/patients/${id}`),
    patientMedications: id => Api.get(`/admin/patients/${id}/medications`),
    updatePatient: (id, d) => Api.patch(`/admin/patients/${id}`, d),
    deactivatePatient: id => Api.post(`/admin/patients/${id}/deactivate`, {}),
    activatePatient: id => Api.post(`/admin/patients/${id}/activate`, {}),
    medications: params => Api.get(`/admin/medications${Api.qs(params)}`),
    addMedication: d => Api.post("/admin/medications", d),
    updateMedication: (id, d) => Api.patch(`/admin/medications/${id}`, d),
    deleteMedication: id => Api.delete(`/admin/medications/${id}`),
    activateMedication: id => Api.post(`/admin/medications/${id}/activate`, {}),
    sendWarning: d => Api.post("/admin/notifications/warning", d),
  }
};
