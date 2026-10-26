/** [قرار المستخدم] طلبات المريض للإدارة: دواء ناقص أو دواء جديد، وردودها (shared/requests.js). */

import { startPage } from "../shared/layout.js";
import { mountMyRequests } from "../shared/requests.js";

await startPage("PATIENT");
await mountMyRequests();
