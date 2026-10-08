// Обезличивание перед сборкой промта: имя клиента и имена сотрудников заменяются ролями.
// Номера заказов и задач остаются (они нужны для работы). Это пометки по правилам, не гарантия:
// имена, написанные в свободном тексте иначе, чем в приветствии бота, формой не находятся.

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function redact(parsed) {
  const staffLabel = {};
  const label = m => {
    if (m.role === "staff") {
      const key = m.staffId || m.author || "?";
      staffLabel[key] ||= "Сотрудник " + (Object.keys(staffLabel).length + 1);
      return staffLabel[key];
    }
    return { client: "Клиент", bot: "Бот", system: "Система" }[m.role] || "Неизвестно";
  };
  const re = parsed.clientName ? new RegExp("(?<![\\p{L}])" + esc(parsed.clientName) + "(?![\\p{L}])", "giu") : null;
  const messages = parsed.messages.map(m => ({
    ...m, author: label(m),
    text: re ? m.text.replace(re, "[клиент]") : m.text
  }));
  return { ...parsed, clientName: null, clientId: null, messages };
}
