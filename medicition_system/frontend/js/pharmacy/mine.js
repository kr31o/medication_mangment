/** صيدلية المستخدم الحالي (لصفحات الصيدلية): ملفها، وهل حدّد مكانها، وبوابة الصفحات التي تحتاج اعتمادها. */

import { pharmacies } from "../shared/api.js";
import { html, render } from "../shared/dom.js";
import { onPlaceCentre } from "../shared/places.js";
import { pharmacyStatus } from "../shared/text.js";
import { alertBox, button, emptyState, errorState, loading } from "../shared/ui.js";

/** النقطة [lat, lng] من ملف أو نموذج، أو null إن لم تُحدَّد بعد. */
export function pointOf(data) {
  const lat = Number(data.latitude);
  const lng = Number(data.longitude);
  return data.latitude !== "" && data.longitude !== "" && data.latitude != null && Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

/** هل حدّد الصيدلي نقطة صيدليته هو؟ نقطة على مركز المدينة بالضبط ليست مكان صيدلية. */
export function hasOwnPoint(data) {
  const point = pointOf(data);
  return Boolean(point) && !onPlaceCentre(data.city, point[0], point[1]);
}

/**
 * الطلبات والمخزون متاحة للصيدلية المعتمدة فقط (الخادم يفرض ذلك أيضًا). تكتب في container
 * ما يقوله للمستخدم إن لم تكن صيدليته معتمدة، وترجع الصيدلية إن كانت معتمدة، وإلا null.
 * known: ملف الصيدلية إن جُلب من قبل (null = لم يُنشأ بعد)، فلا يُطلب مرة ثانية.
 */
export async function activePharmacy(container, known = undefined) {
  let pharmacy = known;
  if (pharmacy === undefined) {
    render(container, loading());
    try {
      pharmacy = await pharmacies.me();
    } catch (error) {
      render(container, errorState(error, { retry: true }));
      container.querySelector("[data-action=retry]").addEventListener("click", () => location.reload());
      return null;
    }
  }
  if (!pharmacy) {
    render(
      container,
      html`<div class="card">${emptyState({
        icon: "store",
        title: "أنشئ ملف صيدليتك أولًا",
        hint: "بعد إنشاء الملف ورفع الرخصة يراجعه مدير النظام.",
        action: button("إنشاء الملف", { variant: "primary", href: "/pharmacy/profile" }),
      })}</div>`,
    );
    return null;
  }
  if (pharmacy.status !== "ACTIVE") {
    render(
      container,
      alertBox(pharmacy.status === "PENDING_APPROVAL" ? "info" : "warning", `صيدليتك ${pharmacyStatus[pharmacy.status]}. الطلبات والمخزون متاحة بعد الاعتماد.`, {
        action: button("ملف الصيدلية", { size: "sm", href: "/pharmacy/profile" }),
      }),
    );
    return null;
  }
  render(container, "");
  container.hidden = true;
  return pharmacy;
}
