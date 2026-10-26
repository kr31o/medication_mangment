/** الرابط "/": يفتح الصفحة الرئيسية لصاحب الجلسة، أو صفحة الدخول. */

import { session } from "./shared/api.js";
import { homeFor } from "./shared/layout.js";

const principal = await session.check();
location.replace(principal ? homeFor(principal.role) : "/login");
