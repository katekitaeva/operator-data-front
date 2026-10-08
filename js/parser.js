// Разбор ответов DeepSeek по меткам «МЕТКА: значение». Чистая функция, без DOM.

export const LABELS = {
  "ЗАКАЗ": "order",
  "ПРОБЛЕМА": "problem",
  "ТРЕБОВАНИЕ": "demand",
  "ИЗМЕНЕНИЕ": "changed",
  "ИЗМЕНЕНИЯ": "changed",
  "ИЗМЕНЕНИЕ ТРЕБОВАНИЯ": "changed",
  "ЮРИДИЧЕСКОЕ": "legal",
  "ЮРИДИЧЕСКИЕ": "legal",
  "ЮРИДИЧЕСКИЕ УПОМИНАНИЯ": "legal",
  "КОНТАКТЫ": "contacts",
  "ЗАДАЧИ": "tasks"
}; // шаг 1

export const NAMES = {
  order: "заказ",
  problem: "проблема",
  demand: "требование",
  changed: "изменение",
  legal: "юридическое",
  contacts: "контакты",
  tasks: "задачи"
};

export const LABELS2 = { "ХРОНОЛОГИЯ": "chrono", "СТАТУС": "status", "ТЕМЫ": "themes" }; // шаг 2
export const LABELS4 = { "ЧЕКЛИСТ": "check", "СООБЩЕНИЕ": "reply", "КОММЕНТАРИЙ": "comment" }; // шаг 4

const STRIP_QUOTE = ["problem", "demand", "changed", "legal"];

export function parseAnswer(text, labels = LABELS, keepBlank = false) {
  const raw = {};
  let key = null;

  (text || "").split(/\r?\n/).forEach(l => {
    const line = l.replace(/\*+/g, "").trim();
    if (!line && !keepBlank) return;

    // Ищем метку вида «МЕТКА: ...» или «1. МЕТКА: ...»
    const cleaned = line.replace(/^\d+[.)]\s*/, "");
    const m = cleaned.match(/^([A-Za-zА-Яа-яЁё\s]+?)\s*:\s*(.*)$/);
    const candidateTag = m && m[1].trim().toUpperCase();
    const field = candidateTag && labels[candidateTag];

    if (field) {
      key = field;
      raw[key] = m[2] ? [m[2]] : [];
    } else if (key && (line || keepBlank)) {
      raw[key].push(line);
    }
  });

  const res = {};
  for (const k in raw) {
    let v = raw[k].join("\n").trim();
    if (STRIP_QUOTE.includes(k)) {
      v = v.replace(/\s*[—–-]\s*[«"„“].*$/s, "").trim();
    }
    if (k === "order") {
      const n = v.match(/\d[\d-]{4,}\d/);
      if (n) v = n[0];
    }
    if (!v || /^(?:не найден[а-я]?|не указан[а-я]?|отсутству[а-я]+|нет)\b/i.test(v)) {
      if (k === "changed" || k === "legal") {
        res[k] = "нет";
      }
      continue;
    }
    res[k] = v;
  }
  return res;
}
