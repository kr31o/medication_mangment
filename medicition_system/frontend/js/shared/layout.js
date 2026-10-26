/**
 * الإطار المشترك لكل الصفحات. كل صفحة HTML فيها محتواها فقط (<main class="page">)،
 * وهذا الملف يبني حوله ما يتكرر:
 *   startPage(role)  صفحات ما بعد الدخول: يتأكد من الجلسة والدور، ثم يضيف القائمة
 *                    الجانبية، الشريط العلوي مع جرس الإشعارات، وشريطًا سفليًا على الجوال.
 *   startAuthPage()  صفحات الحساب (الدخول وأخواتها): اللوحة الخضراء بجانب النموذج.
 *
 * الصفحة مخفية (body.is-loading) حتى ينتهي ذلك، فلا يظهر محتوى لمن لا يحق له.
 */

import { auth, conversations, notifications, REFRESH_KEY, session } from "./api.js";
import { $, cx, html, raw, render } from "./dom.js";
import { formatDayLong, todayLocal } from "./format.js";
import { fillIcons, icon } from "./icons.js";
import { roleLabel } from "./text.js";
import { iconButton, showFlash, wirePasswordToggles } from "./ui.js";

const HOME = { PATIENT: "/patient", PHARMACY: "/pharmacy", ADMIN: "/admin" };
export const homeFor = (role) => HOME[role] ?? "/login";

/** الصفحة التي حاول المستخدم فتحها قبل الدخول: يعود إليها بعده. */
export const FROM_KEY = "medplat.from";

// short: الاسم المختصر في الشريط السفلي على الجوال. يظهر فيه أول أربعة عناصر ليست bar: false.
const NAV = {
  PATIENT: [
    { to: "/patient", label: "الرئيسية", icon: "house" },
    { to: "/patient/search", label: "البحث عن دواء", short: "بحث", icon: "search" },
    // بجوار البحث في القائمة، وعلى الجوال تحت «المزيد» حتى تبقى الجرعات في الشريط.
    { to: "/patient/pharmacies", label: "الصيدليات", icon: "store", bar: false },
    { to: "/patient/orders", label: "طلباتي", icon: "receipt_text" },
    // [قرار المستخدم] الرسائل مع الصيدليات. على الجوال تحت «المزيد» (وعددها على زر «المزيد»).
    { to: "/patient/messages", label: "الرسائل", icon: "messages_square", bar: false, messages: true },
    { to: "/patient/doses", label: "الجرعات", icon: "alarm_clock" },
    { to: "/patient/medications", label: "أدويتي", icon: "pill" },
    { to: "/patient/insights", label: "ملخصات الالتزام", icon: "sparkles" },
    { to: "/patient/requests", label: "طلبات للإدارة", icon: "inbox" },
    { to: "/patient/profile", label: "ملفي الشخصي", icon: "user_round" },
  ],
  PHARMACY: [
    { to: "/pharmacy", label: "الرئيسية", icon: "house" },
    { to: "/pharmacy/orders", label: "الطلبات", icon: "receipt_text" },
    { to: "/pharmacy/messages", label: "الرسائل", icon: "messages_square", messages: true },
    { to: "/pharmacy/inventory", label: "المخزون", icon: "boxes" },
    { to: "/pharmacy/pharmacists", label: "الصيادلة", icon: "id_card" },
    { to: "/pharmacy/requests", label: "طلبات للإدارة", icon: "inbox" },
    { to: "/pharmacy/profile", label: "ملف الصيدلية", icon: "store" },
  ],
  ADMIN: [
    { to: "/admin", label: "لوحة التحكم", short: "اللوحة", icon: "layout_dashboard" },
    { to: "/admin/pharmacies", label: "الصيدليات", icon: "store" },
    { to: "/admin/patients", label: "المرضى", icon: "users_round" },
    { to: "/admin/medications", label: "كتالوج الأدوية", short: "الكتالوج", icon: "pill" },
    { to: "/admin/orders", label: "الطلبات", icon: "clipboard_list" },
    { to: "/admin/requests", label: "طلبات للإدارة", icon: "inbox" },
  ],
};

const WHO_ICON = { ADMIN: "shield_check", PHARMACY: "store", PATIENT: "user_round" };

/** يفتح صفحة أخرى بدل هذه (لا تبقى في سجل الرجوع). */
const go = (path) => location.replace(path);
// صفحة لن تكتمل لأن المتصفح ينتقل لغيرها: ما بعدها لا يُنفَّذ.
const never = () => new Promise(() => {});

/** شعار المنصة: كبسولة مائلة نصفها كهرماني. */
const brand = (to = "/") =>
  html`<a href="${to}" class="brand"><span class="brand__mark" aria-hidden="true"><span class="brand__capsule"></span></span><span class="brand__name">منصة الأدوية</span></a>`;

/** الرابط الحالي ضمن هذا القسم؟ الرئيسية فقط بالتطابق التام. */
function isCurrent(to) {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  return path === to || (!Object.values(HOME).includes(to) && path.startsWith(`${to}/`));
}

/** تسجيل الخروج من هذا التبويب، ومن كل تبويبات المتصفح معه. */
export async function logout() {
  const refresh = session.refreshToken();
  session.clear();
  if (refresh) {
    try {
      await auth.logout(refresh);
    } catch {
      /* الجلسة أُزيلت محليًا في كل الأحوال */
    }
  }
  go("/login");
}

// ----------------------------------------------------------------------------- جرس الإشعارات

function startBell(bell) {
  let previous = null;
  const refresh = async () => {
    let unread;
    try {
      unread = (await notifications.unreadCount()).unread ?? 0;
    } catch {
      return;
    }
    bell.setAttribute("aria-label", `الإشعارات: ${unread} غير مقروء`);
    $(".bell__count", bell)?.remove();
    if (unread > 0) bell.insertAdjacentHTML("beforeend", `<span class="bell__count">${unread > 99 ? "99+" : unread}</span>`);
    // يهتز الجرس حين يصل إشعار جديد.
    if (previous !== null && unread > previous) {
      bell.classList.add("is-ringing");
      setTimeout(() => bell.classList.remove("is-ringing"), 900);
    }
    previous = unread;
  };
  refresh();
  setInterval(() => document.visibilityState === "visible" && refresh(), 30_000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refresh());
  // صفحة الإشعارات تطلب تحديث العدد بعد «قراءة» إشعار.
  window.addEventListener("medplat:notifications", refresh);
}

/**
 * [قرار المستخدم] عدد الرسائل غير المقروءة بجانب «الرسائل» (وعلى زر «المزيد» في الجوال إن كانت
 * تحته). صفحة الرسائل ترسل medplat:messages بعد قراءة محادثة فيُحدَّث فورًا.
 */
function startMessagesCount(shell) {
  const targets = shell.querySelectorAll("[data-messages]");
  if (!targets.length) return;
  const refresh = async () => {
    let unread;
    try {
      unread = (await conversations.unreadCount()).unread ?? 0;
    } catch {
      return; // صيدلية لم يكتمل ملفها بعد، أو الخدمة لا ترد: بلا عدد.
    }
    targets.forEach((el) => {
      el.querySelector(".nav__count")?.remove();
      if (unread > 0) el.insertAdjacentHTML("beforeend", `<span class="nav__count" aria-label="${unread} غير مقروءة">${unread > 99 ? "99+" : unread}</span>`);
    });
  };
  refresh();
  setInterval(() => document.visibilityState === "visible" && refresh(), 30_000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refresh());
  window.addEventListener("medplat:messages", refresh);
}

// ----------------------------------------------------------------------------- الإطار

function buildShell(principal) {
  const main = $("main.page");
  const items = NAV[principal.role];
  const home = homeFor(principal.role);

  const shell = document.createElement("div");
  shell.className = "shell";
  render(
    shell,
    html`<div class="shell__content">
        <header class="topbar">
          ${iconButton("menu", "القائمة", { action: "open-menu", size: 22, className: "topbar__menu" })}
          <div class="topbar__brand">${brand(home)}</div>
          <span class="topbar__date">${formatDayLong(todayLocal())}</span>
          <span class="grow"></span>
          <a class="bell" href="/notifications" aria-label="الإشعارات" title="الإشعارات">${icon("bell", 21)}</a>
        </header>
      </div>
      <div class="shell__scrim" hidden></div>
      <aside class="sidebar">
        <div class="sidebar__top">${brand(home)}${iconButton("x", "إغلاق القائمة", { action: "close-menu", size: 20, className: "sidebar__close" })}</div>
        <nav class="nav" aria-label="القائمة الرئيسية">
          ${items.map(
            (item) =>
              html`<a href="${item.to}" class="${cx("nav__item", isCurrent(item.to) && "active")}"${isCurrent(item.to) ? raw(' aria-current="page"') : ""}${item.messages ? raw(" data-messages") : ""}>${icon(item.icon, 20)}<span>${item.label}</span></a>`,
          )}
        </nav>
        <div class="sidebar__foot">
          <div class="who"><span class="who__avatar">${icon(WHO_ICON[principal.role], 18)}</span><span class="small soft">${roleLabel[principal.role]}</span></div>
          <button type="button" class="nav__item nav__item--logout" data-action="logout">${icon("log_out", 20)}<span>تسجيل الخروج</span></button>
        </div>
      </aside>
      <nav class="bottom-nav" aria-label="تنقل سريع">
        ${items
          .filter((item) => item.bar !== false)
          .slice(0, 4)
          .map(
            (item) =>
              html`<a href="${item.to}" class="${cx("bottom-nav__item", isCurrent(item.to) && "active")}"${item.messages ? raw(" data-messages") : ""}>${icon(item.icon, 21)}<span>${item.short ?? item.label}</span></a>`,
          )}
        <button type="button" class="bottom-nav__item" data-action="open-menu"${items.some((item) => item.messages && item.bar === false) ? raw(" data-messages") : ""}>${icon("menu", 21)}<span>المزيد</span></button>
      </nav>`,
  );
  main.replaceWith(shell);
  $(".shell__content", shell).append(main);

  const sidebar = $(".sidebar", shell);
  const scrim = $(".shell__scrim", shell);
  const setOpen = (open) => {
    sidebar.classList.toggle("is-open", open);
    scrim.hidden = !open;
  };
  shell.querySelectorAll("[data-action=open-menu]").forEach((el) => el.addEventListener("click", () => setOpen(true)));
  $("[data-action=close-menu]", shell).addEventListener("click", () => setOpen(false));
  scrim.addEventListener("click", () => setOpen(false));
  $("[data-action=logout]", shell).addEventListener("click", logout);
  startBell($(".bell", shell));
  startMessagesCount(shell);
}

/**
 * أول ما تستدعيه كل صفحة بعد الدخول. role: PATIENT | PHARMACY | ADMIN، أو ANY لصفحة
 * مشتركة (الإشعارات). غير المسجل يذهب لصفحة الدخول (ويعود بعدها لهذه الصفحة)، وصاحب
 * دور آخر يذهب لصفحته الرئيسية. يرجع { userId, role }.
 */
export async function startPage(role) {
  const principal = await session.check();
  if (!principal) {
    try {
      sessionStorage.setItem(FROM_KEY, location.pathname + location.search);
    } catch {
      /* لا شيء */
    }
    go("/login");
    return never();
  }
  if (role !== "ANY" && principal.role !== role) {
    go(homeFor(principal.role));
    return never();
  }

  fillIcons();
  buildShell(principal);
  // خروج من تبويب آخر، أو دخول بحساب آخر فيه: هذه الصفحة لم تعد لصاحبها.
  window.addEventListener("storage", (event) => {
    if (event.key === REFRESH_KEY && !event.newValue) {
      session.clear();
      go("/login");
    } else if (event.newValue && session.principal()?.userId !== principal.userId) {
      go("/");
    }
  });
  document.body.classList.remove("is-loading");
  showFlash();
  return principal;
}

// ----------------------------------------------------------------------------- صفحات الحساب

const FLOATIES = [
  "--w: 150px; --a: #ffc857; --tilt: -24deg; --t: 7s; top: 8%; left: 7%",
  "--w: 190px; --a: #ff8f78; --tilt: 18deg; --t: 9s; --d: -3s; bottom: 11%; left: 9%",
  "--w: 92px; --a: #8ec9ff; --tilt: -52deg; --t: 6s; --d: -1.5s; top: 47%; left: 5%",
];
const ROUND_FLOATIES = [
  "--w: 50px; --a: #ffffff; --tilt: 0deg; --t: 8s; --d: -4s; top: 13%; left: 40%",
  "--w: 36px; --a: #ffc857; --tilt: 0deg; --t: 6.5s; --d: -2s; bottom: 7%; left: 42%",
];

/**
 * صفحات الحساب: لوحة خضراء فيها كبسولات تطفو، وبجانبها بطاقة النموذج (main.auth__panel).
 * signedInGoesHome: من دخل أصلًا يذهب لصفحته (صفحة الدخول).
 */
export async function startAuthPage({ signedInGoesHome = false } = {}) {
  if (signedInGoesHome) {
    const principal = session.principal();
    if (principal) {
      go(homeFor(principal.role));
      return never();
    }
  }
  const main = $("main.auth__panel");
  const frame = document.createElement("div");
  frame.className = "auth";
  render(
    frame,
    html`<aside class="auth__hero">
      ${brand()}
      <p class="auth__headline display">دواؤك أقرب مما تظن</p>
      <p class="auth__lead">ابحث عن دوائك في الصيدليات القريبة، اطلبه واستلمه، ثم تابع جرعاتك في مكان واحد.</p>
      <ul class="auth__points">
        <li><span>${icon("search")}</span>اعرف أين يتوفر دواؤك وكم سعره</li>
        <li><span>${icon("store")}</span>اطلبه واستلمه من الصيدلية جاهزًا</li>
        <li><span>${icon("alarm_clock")}</span>تذكير بكل جرعة في وقتها</li>
      </ul>
      ${FLOATIES.map((style) => html`<span class="floaty" style="${style}"></span>`)}
      ${ROUND_FLOATIES.map((style) => html`<span class="floaty floaty--round" style="${style}"></span>`)}
    </aside>`,
  );
  main.replaceWith(frame);
  frame.append(main);
  fillIcons();
  wirePasswordToggles(main);
  document.body.classList.remove("is-loading");
  showFlash();
}
