// Шаг 4. Решение и тексты: сборка промта (факты + вердикт + страницы инструкций из operator-data),
// разбор итогового ответа в три поля.

import { $, val, copyText } from "../ui.js";
import { state, save } from "../state.js";
import { goTo } from "../nav.js";
import { DOCS } from "../config.js";
import { ghGet } from "../github.js";
import { verdict } from "./step1.js";
import { parseAnswer, LABELS4 } from "../parser.js";

const factsText = () => [
  "Суть проблемы: " + val("problem"), "Требование клиента: " + val("demand"),
  val("changed") && "Требование менялось: " + val("changed"), val("legal") && "Юридические упоминания: " + val("legal"),
  val("contacts") && "Контакты: " + val("contacts"), val("tasks") && "Задачи: " + val("tasks"),
  "Темы обращения: " + state.themes.map(t => t.path + " (" + t.status + ")").join("; ")
].filter(Boolean).join("\n");

// предупреждение о незаполненных [квадратных скобках] в итоговых текстах
export const updPh = () => {
  const n = ["out-check", "out-reply", "out-comment"].reduce((a, id) => a + (($(id).value.match(/\[[^\]\n]+\]/g) || []).length), 0);
  $("ph-note").textContent = n ? "⚠️ Незаполненных полей в [квадратных скобках]: " + n + ". Заполните перед копированием." : "";
};

export function initStep4() {
  // чекбоксы страниц инструкций
  DOCS.forEach(d => {
    const l = document.createElement("label"); l.className = "chk";
    const i = document.createElement("input"); i.type = "checkbox"; i.checked = true; i.id = "doc-" + d.id;
    const sp = document.createElement("span"); sp.id = "sz-" + d.id; sp.className = "hint";
    l.append(i, " " + d.title + " ", sp); $("pages-list").appendChild(l);
  });

  $("build-prompt").addEventListener("click", async () => {
    const st = $("prompt4-state");
    st.textContent = "Загружаю инструкции…";
    try {
      const tpl = await (await fetch("prompts/step003.md", { cache: "no-store" })).text();
      const blocks = []; let total = 0;
      for (const d of DOCS.filter(x => $("doc-" + x.id).checked)) {
        const raw = await ghGet("cache/pages/" + d.path + ".md");
        const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
        const meta = k => ((fm && fm[1].match(new RegExp("^" + k + ": (.*)$", "m"))) || [])[1] || "";
        const body = (fm ? raw.slice(fm[0].length) : raw).trim();
        $("sz-" + d.id).textContent = "(" + body.length + " симв.)"; total += body.length;
        blocks.push("=== СТРАНИЦА: " + (meta("title") || d.title) + " | адрес: " + meta("url") + " | дата страницы: " + (meta("pageDate") || "нет") + " ===\n" + body + "\n=== КОНЕЦ СТРАНИЦЫ ===");
      }
      const prompt = tpl.replace("{{ФАКТЫ}}", factsText()).replace("{{КОНТЕКСТ}}", verdict()).replace("{{ИНСТРУКЦИИ}}", blocks.join("\n\n"));
      $("prompt4-text").textContent = prompt;
      const ok = await copyText(prompt);
      st.textContent = (ok ? "Промт скопирован ✅ " : "Не удалось скопировать ⚠️ ") + "(" + prompt.length + " симв.)" + (prompt.length > 70000 ? " Много: снимите галочку с Tone of Voice." : "");
    } catch (e) { st.textContent = "Ошибка: " + e.message + ". Проверьте подключение вверху страницы."; }
  });

  ["out-check", "out-reply", "out-comment"].forEach(id => $(id).addEventListener("input", updPh));

  $("parse4").addEventListener("click", () => {
    const res = parseAnswer($("answer4").value, LABELS4, true);
    const msg = $("parse4-msg");
    if (!Object.keys(res).length) { msg.textContent = "Не нашёл меток ЧЕКЛИСТ:, СООБЩЕНИЕ:, КОММЕНТАРИЙ:. Вставьте итоговый ответ DeepSeek, который он дал после вашего выбора варианта."; return; }
    const map = { check: "out-check", reply: "out-reply", comment: "out-comment" };
    Object.keys(res).forEach(k => { $(map[k]).value = res[k]; });
    msg.textContent = "Заполнено: " + Object.keys(res).map(k => ({ check: "чеклист", reply: "ответ клиенту", comment: "комментарий" })[k]).join(", ") + ".";
    updPh();
    const h4 = $("helper4");
    if (h4) h4.open = false;
    save();
  });

  document.querySelectorAll(".cp").forEach(b => b.addEventListener("click", async () => {
    const ok = await copyText($(b.dataset.for).value);
    const lb = b.querySelector("span");   // в кнопке есть иконка, меняем только подпись
    lb.textContent = ok ? "✅ Скопировано" : "⚠️ Не удалось";
    setTimeout(() => { lb.textContent = "Копировать"; }, 1500);
  }));

  const nextBtn = $("next-4");
  if (nextBtn) nextBtn.addEventListener("click", () => goTo(5));
}
