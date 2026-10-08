// Шаг 3. Контекст клиента: критичность, метки, цифры → вердикт по Памятке.

import { $, val, num } from "../ui.js";
import { MEMO_URL } from "../config.js";
import { tabUrls } from "../crm.js";
import { save } from "../state.js";
import { goTo, onRender } from "../nav.js";

// доля в процентах с одним знаком после запятой; без числа заказов считать нечего
const pctOf = (part, total) => (part === null || total === null || total <= 0) ? null : Math.round(part / total * 1000) / 10;

export function verdict() {
  const crit = ["k1", "k2"].some(i => $(i).checked);
  const labs = [["l1", "«фрод: злоупотребляет»"], ["l2", "«хамит, ругается»"], ["l3", "«бан купонов»"], ["l4", "негативные комментарии других подразделений"]].filter(x => $(x[0]).checked).map(x => x[1]);
  const acc = num("c-acc"), tot = num("c-orders");
  const ret = pctOf(num("c-returns"), tot), can = pctOf(num("c-cancels"), tot);
  const mark = ok => ok === null ? "нет данных" : ok ? "в норме" : "вне нормы";
  const rows = [
    ["начисления за 2 месяца: " + (acc === null ? "?" : acc) + " (норма до 3)", acc === null ? null : acc <= 3],
    ["метки: " + (labs.length ? labs.join(", ") : "негативных нет"), labs.length === 0],
    ["возвраты: " + (ret === null ? "?" : ret + "%") + " (норма не более 50%)", ret === null ? null : ret <= 50],
    ["отмены: " + (can === null ? "?" : can + "%") + " (норма не более 50%)", can === null ? null : can <= 50]
  ];
  const match = rows.some(r => r[1] === false) ? false : rows.every(r => r[1] === true) ? true : null;
  const lines = ["Ситуация " + (crit ? "критичная" : "некритичная") + ". Клиент " + (match === true ? "соответствует критериям." : match === false ? "не соответствует критериям." : "пока не оценён: не хватает данных.")];
  rows.forEach(r => lines.push("- " + r[0] + ": " + mark(r[1])));
  const sum = num("c-sum");
  if (sum !== null) lines.push("Стоимость заказа: " + sum + " ₽ (компенсация не больше стоимости заказа).");
  if (val("c-status")) lines.push("Статус и доходность: " + val("c-status") + ".");
  lines.push(match === null ? "По Памятке: заполните данные, чтобы получить вывод." :
    crit && match ? "По Памятке: индивидуальные решения, компенсация не больше стоимости заказа." :
    !crit && !match ? "По Памятке: стандартные решения, можно без компенсации или с небольшой суммой." :
    "По Памятке такой случай не описан (критичность и критерии расходятся): решение за вами, при сомнении посоветуйтесь с РГ.");
  return lines.join("\n");
}

function renderShares() {
  const tot = num("c-orders"), cn = num("c-cancels"), rn = num("c-returns");
  const c = pctOf(cn, tot), r = pctOf(rn, tot);
  let t = tot === null || tot <= 0 ? "Доли отмен и возвратов посчитаются, когда будет указано число заказов." :
    "Доля отмен: " + (c === null ? "—" : c + "%") + " · Доля возвратов: " + (r === null ? "—" : r + "%");
  if (tot > 0 && ((cn !== null && cn > tot) || (rn !== null && rn > tot))) t += ". Проверьте числа: отмен или возвратов больше, чем заказов.";
  $("calc-shares").textContent = t;
}

function renderTabs() {
  const box = $("tablinks"), urls = tabUrls();
  box.textContent = "";
  if (!urls) { box.textContent = "Чтобы здесь появились ссылки на вкладки карточки клиента, вставьте её адрес на шаге 1."; return; }
  box.append("Вкладки карточки клиента: ");
  urls.forEach(([name, href], i) => {
    if (i) box.append(" · ");
    const a = document.createElement("a");
    a.href = href; a.target = "_blank"; a.rel = "noopener"; a.textContent = name;
    box.append(a);
  });
}

export function renderVerdict() { renderShares(); $("verdict").textContent = verdict(); }

export function initStep3() {
  $("memo-link").href = MEMO_URL;
  onRender(3, renderVerdict);
  onRender(3, renderTabs);
  document.querySelectorAll("#step-3 input").forEach(i => {
    i.addEventListener("input", () => { renderVerdict(); save(); });
    i.addEventListener("change", () => { renderVerdict(); save(); });
  });
  $("next-3").addEventListener("click", () => goTo(4));
}
