// Константы и справочники. Здесь нет логики и обращений к DOM.

export const TOTAL = 5;         // 5 активных шагов: 1 прочитать, 2 что произошло, 3 контекст клиента,
                                // 4 решение и тексты, 5 запись кейса
export const STEP_COUNT = 5;    // секций на странице

export const STORAGE_KEY = "claim-guide";
export const CONN_KEY = "operator-conn";

// Поля (value), которые сохраняются в localStorage и восстанавливаются при загрузке
export const FIELDS = [
  "case-datetime", "ticket", "order", "problem", "demand", "changed", "legal",
  "contacts", "tasks", "helper-chat", "answer",
  "chrono", "status", "answer2",
  "c-acc", "c-orders", "c-cancels", "c-returns", "c-sum", "c-status", "client-url",
  "answer4", "out-check", "out-reply", "out-comment",
  "case-title", "what-worked", "qc-comments"
];

// Чекбоксы (checked), которые сохраняются так же
export const CHECKS = ["k1", "k2", "l1", "l2", "l3", "l4"];

// Справочник тем обращений лежит в приватном operator-data и читается по токену (собирает tools/build_claim_types.py)
export const THEMES_PATH = "derived/claim-types.json";
export const THEME_RULES_PATH = "derived/theme-rules.md";

// Инструкция «Памятка» (Loyalty team): основание критериев шага 3
export const MEMO_URL = "https://customer-support-help.o3t.ru/instrukcii-vydelennyh-grupp/instrukciya-dlya-vydelennoi-gruppy-loyalty-team/problemy-i-resheniya/pamyatka";

// Вкладки карточки клиента в CRM: [название, путь после /clients/<клиент>]
export const CRM_TABS = [
  ["Клиент", ""], ["Коммуникации", "communications"], ["Заказы", "orders"], ["Озон Доставка", "ozon-delivery"],
  ["Возвраты и арбитражи", "returns-arbitrations"], ["Баланс", "balance"], ["CTASK", "ctask"],
  ["Комментарии", "comments"], ["Отзывы", "reviews"], ["Premium", "loyalty"]
];

// Страницы инструкций Loyalty для промта шага 4 (путь внутри operator-data/cache/pages/)
export const LOY = "instrukcii-vydelennyh-grupp/instrukciya-dlya-vydelennoi-gruppy-loyalty-team/";
export const DOCS = [
  { id: "schema", title: "Общая схема", path: LOY + "problemy-i-resheniya/obshchaya-shema" },
  { id: "memo", title: "Памятка", path: LOY + "problemy-i-resheniya/pamyatka" },
  { id: "examples", title: "Примеры индивидуальных решений", path: LOY + "problemy-i-resheniya/primery-individualnyh-reshenii" },
  { id: "accruals", title: "Начисления", path: LOY + "problemy-i-resheniya/nachisleniya" },
  { id: "tov", title: "Tone of Voice Loyalty", path: LOY + "mehanika-raboty-na-aktivnostyah/tone-of-voice-loyalty1" }
];
