/** [قرار المستخدم] طلبات الصيدلية للإدارة: دواء ناقص أو دواء جديد، وردودها (shared/requests.js). */

import { $ } from "../shared/dom.js";
import { startPage } from "../shared/layout.js";
import { mountMyRequests } from "../shared/requests.js";
import { activePharmacy } from "./mine.js";

await startPage("PHARMACY");

if (await activePharmacy($("#gate"))) {
  $("#content").hidden = false;
  await mountMyRequests();
}
