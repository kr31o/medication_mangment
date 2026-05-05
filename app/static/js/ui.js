const UI = {
  h(v) { return String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); },
  toastBox: null,
  toast(msg, type = "info") {
    if (!UI.toastBox) { UI.toastBox = document.createElement("div"); UI.toastBox.className = "toast-box"; document.body.appendChild(UI.toastBox); }
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    UI.toastBox.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  },
  success(m) { UI.toast(m, "success"); },
  error(m) { UI.toast(m, "error"); },
  info(m) { UI.toast(m, "info"); },
  showError(id, err) {
    const el = document.getElementById(id); if (!el) return;
    const details = err?.errors ? Object.values(err.errors).map(x => `<li>${UI.h(x)}</li>`).join("") : "";
    el.innerHTML = `<div class="alert error">${UI.h(err?.message || "حدث خطأ غير متوقع.")}${details ? `<ul>${details}</ul>` : ""}</div>`;
  },
  clearError(id) { const el = document.getElementById(id); if (el) el.innerHTML = ""; },
  loading(btn, state, text = "جارٍ التنفيذ...") { if (!btn) return; if (state) { btn.dataset.old = btn.innerHTML; btn.disabled = true; btn.innerHTML = text; } else { btn.disabled = false; btn.innerHTML = btn.dataset.old || btn.innerHTML; } },
  open(id) { document.getElementById(id)?.classList.add("open"); },
  close(id) { document.getElementById(id)?.classList.remove("open"); },
  closeAll() { document.querySelectorAll(".modal.open").forEach(x => x.classList.remove("open")); },
  date() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; },
  formatTime(v) { return v ? String(v).slice(0, 5) : "—"; },
  formatDate(v) { return v ? new Date(v).toLocaleDateString("ar") : "—"; },
  formatDateTime(v) { return v ? new Date(v).toLocaleString("ar", { dateStyle:"medium", timeStyle:"short" }) : "—"; },
  badge(v) {
    const labels = {active:"نشط", inactive:"غير نشط", stopped:"متوقف", taken:"تم التأكيد", missed:"فائتة", skipped:"متجاوزة", read:"مقروء", unread:"جديد", dose:"جرعة", low_stock:"نفاد دواء", warning:"تحذير", morning:"صباحًا", evening:"مساءً"};
    return `<span class="badge ${UI.h(v)}">${labels[v] || UI.h(v)}</span>`;
  },
  period(p) { return p === "morning" ? "صباحًا" : p === "evening" ? "مساءً" : "—"; },
  form(v) { const labels = {tablet:"أقراص", capsule:"كبسولات", syrup:"شراب", injection:"حقن", drop:"قطرات", ointment:"مرهم", spray:"بخاخ", other:"أخرى"}; return labels[v] || UI.h(v || "—"); },
  empty(icon, title, text = "") { return `<div class="empty"><div>${icon}</div><h3>${UI.h(title)}</h3><p>${UI.h(text)}</p></div>`; },
  pagination(el, data, fn) {
    if (!el || !data || data.pages <= 1) { if (el) el.innerHTML = ""; return; }
    let html = '<div class="pages">';
    for (let i=1;i<=data.pages;i++) html += `<button class="btn sm ${i===data.page?'primary':'ghost'}" onclick="${fn}(${i})">${i}</button>`;
    el.innerHTML = html + '</div>';
  }
};

document.addEventListener("click", e => { if (e.target.classList.contains("modal")) UI.close(e.target.id); });
function toggleSidebar(){ document.querySelector('.sidebar')?.classList.toggle('open'); }
