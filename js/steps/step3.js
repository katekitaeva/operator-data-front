// Шаг 3. Инструкции & правила (раздел в разработке)

import { $ } from "../ui.js";
import { goTo } from "../nav.js";
import { verdict, renderVerdict } from "./step1.js";
export { verdict, renderVerdict };

export function initStep3() {
  const memo = $("step3-memo-link");
  if (memo) memo.href = "https://customer-support-help.o3t.ru/";

  $("next-3")?.addEventListener("click", () => goTo(4));
}
