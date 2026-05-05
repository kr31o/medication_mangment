const Auth = {
  setSession(token, role, user) {
    localStorage.setItem("medtrack_token", token);
    localStorage.setItem("medtrack_role", role);
    localStorage.setItem("medtrack_user", JSON.stringify(user || {}));
  },
  clearSession() {
    localStorage.removeItem("medtrack_token");
    localStorage.removeItem("medtrack_role");
    localStorage.removeItem("medtrack_user");
  },
  isLoggedIn() { return !!localStorage.getItem("medtrack_token"); },
  role() { return localStorage.getItem("medtrack_role"); },
  user() { try { return JSON.parse(localStorage.getItem("medtrack_user") || "{}"); } catch { return {}; } },
  require(role) {
    if (!Auth.isLoggedIn() || (role && Auth.role() !== role)) {
      Auth.clearSession();
      window.location.href = "/login";
      return false;
    }
    return true;
  },
  async logout() {
    try { if (Auth.isLoggedIn()) await Api.auth.logout(); } catch {}
    Auth.clearSession();
    window.location.href = "/login";
  }
};
