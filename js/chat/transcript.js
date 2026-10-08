// Нумерованная расшифровка для промта и проверка цитат DeepSeek по тексту чата.

const ROLE_RU = { client: "Клиент", bot: "Бот", system: "Система", staff: "Сотрудник", unknown: "?" };

export function buildTranscript(parsed, { taskId = null, collapse = true } = {}) {
  const out = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const range = run.length > 1 ? `#${run[0].seq}–#${run[run.length - 1].seq}` : `#${run[0].seq}`;
    out.push(`[${range}] Клиент нажимал кнопки меню бота: ${run.map(m => m.text.replace(/\s+/g, " ")).join(" → ")}`);
    run = [];
  };
  let skipped = 0;
  for (const m of parsed.messages) {
    if (taskId && m.taskId !== taskId) continue;
    if (collapse && m.kind === "boilerplate") { skipped++; continue; }
    if (collapse && m.kind === "menu-click") { run.push(m); continue; }
    flush();
    if (m.kind === "order-select") {
      out.push(`[#${m.seq}] ${m.date?.slice(5).split("-").reverse().join(".") || "??"} ${m.time || "??"} Клиент выбрал заказ ${m.orders.join(", ")}`);
      continue;
    }
    const who = m.author && m.role === "staff" ? m.author : ROLE_RU[m.role];
    const body = m.text || (m.files.length ? `[вложение: ${m.files.length}]` : "");
    out.push(`[#${m.seq}] ${m.date?.slice(5).split("-").reverse().join(".") || "??"} ${m.time || "??"} ${who}: ${body}${m.text && m.files.length ? ` [+вложений: ${m.files.length}]` : ""}`);
  }
  flush();
  return { text: out.join("\n"), skippedBoilerplate: skipped };
}

const fold = s => s.toLowerCase().replace(/ё/g, "е").replace(/[«»"„“”'’]/g, "").replace(/\s+/g, " ").replace(/[.…]+$/, "").trim();

/** Ищет цитату в репликах. Возвращает совпавшие реплики с метаданными, пустой массив если цитаты нет. */
export function verifyQuote(parsed, quote, { taskId = null } = {}) {
  const q = fold(quote);
  if (q.length < 4) return [];
  return parsed.messages
    .filter(m => (!taskId || m.taskId === taskId) && fold(m.text).includes(q))
    .map(m => ({ seq: m.seq, role: m.role, ts: m.ts, taskId: m.taskId, kind: m.kind }));
}
