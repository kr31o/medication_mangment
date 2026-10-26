/** [قرار المستخدم] رسائل الصيدلية مع المرضى (shared/chat.js). */

import { mountMessagesPage } from "../shared/chat.js";
import { $ } from "../shared/dom.js";
import { startPage } from "../shared/layout.js";
import { activePharmacy } from "./mine.js";

await startPage("PHARMACY");

if (await activePharmacy($("#gate"))) {
  $("#content").hidden = false;
  mountMessagesPage($("#messages"), { role: "PHARMACY" });
}
