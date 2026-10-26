/** [قرار المستخدم] رسائل المريض مع الصيدليات (shared/chat.js). */

import { mountMessagesPage } from "../shared/chat.js";
import { $ } from "../shared/dom.js";
import { startPage } from "../shared/layout.js";

await startPage("PATIENT");

mountMessagesPage($("#messages"), { role: "PATIENT" });
