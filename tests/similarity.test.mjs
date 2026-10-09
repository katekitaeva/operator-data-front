import { describe, it, expect } from "bun:test";
import {
  normalizeTheme,
  themePathSimilarity,
  calculateThemesSimilarity,
  compareSimilarCandidates,
  findSimilarCases,
  SIMILARITY_THRESHOLD,
  MAX_SIMILAR_CASES
} from "../js/similarity.js";

describe("Модуль алгоритма сходства тем (ТЗ §5.2)", () => {
  describe("1. Нормализация иерархических путей (normalizeTheme)", () => {
    it("очищает разделители, пробелы и приводит к нижнему регистру", () => {
      const res = normalizeTheme("  Жалобы на работу продавца > Доставка > Сроки  ");
      expect(res.segments).toEqual(["жалобы на работу продавца", "доставка", "сроки"]);
      expect(res.path).toBe("жалобы на работу продавца > доставка > сроки");
    });

    it("удаляет технический суффикс (DR) из листовой темы", () => {
      const res = normalizeTheme("Товары > Несоответствие описанию (DR)");
      expect(res.segments).toEqual(["товары", "несоответствие описанию"]);
      expect(res.path).toBe("товары > несоответствие описанию");
    });

    it("корректно обрабатывает объекты тем вида { path: '...' }", () => {
      const res = normalizeTheme({ path: "Претензии > Качество обслуживания" });
      expect(res.segments).toEqual(["претензии", "качество обслуживания"]);
    });

    it("возвращает пустую структуру для пустых или некорректных значений", () => {
      const res = normalizeTheme("");
      expect(res.segments).toEqual([]);
      expect(res.path).toBe("");
    });
  });

  describe("2. Попарное сходство иерархических путей (themePathSimilarity)", () => {
    it("дает 1.0 для точного совпадения глубоких тем", () => {
      const s = themePathSimilarity(
        "Жалобы на работу продавца > Доставка > Сроки (DR)",
        "жалобы на работу продавца > доставка > сроки"
      );
      expect(s).toBe(1.0);
    });

    it("дает сниженное сходство (0.85) для общих одноуровневых категорий без подтем", () => {
      const s = themePathSimilarity("Жалобы на работу продавца", "Жалобы на работу продавца");
      expect(s).toBe(0.85);
    });

    it("рассчитывает частичное покрытие префикса (prefix / maxLen)", () => {
      const s = themePathSimilarity(
        "Доставка > Курьер > Опоздание",
        "Доставка > Курьер > Утеря"
      );
      // Общий префикс 2 из 3
      expect(s).toBeCloseTo(2 / 3, 2);
    });

    it("возвращает 0 при отсутствии общих узлов", () => {
      const s = themePathSimilarity(
        "Возвраты > Отказ от товара",
        "Финансы > Начисление бонусов"
      );
      expect(s).toBe(0);
    });
  });

  describe("3. Симметричное покрытие и эталонные кейсы («Кошка», «Вобла», «Палатка», «Стол»)", () => {
    // Текущий кейс «Кошка» (3 темы)
    const koshkaThemes = [
      "Жалобы на работу продавца > Доставка > Сроки (DR)",
      "Возвраты > Отказ от товара > По вине продавца",
      "Претензии > Качество обслуживания"
    ];

    // Кандидат «Вобла» (2 темы: 1 совпавшая глубокая + 1 несовпавшая)
    const voblaThemes = [
      "Жалобы на работу продавца > Доставка > Сроки (DR)",
      "Финансы > Компенсация расходов"
    ];

    // Кандидат «Палатка» (3 темы: 1 совпавшая + 2 несовпавших)
    const palatkaThemes = [
      "Жалобы на работу продавца > Доставка > Сроки (DR)",
      "Маркетплейс > Карточка товара",
      "Уведомления > СМС оповещения"
    ];

    // Кандидат «Стол» (4 темы: 1 совпавшая + 3 несовпавших)
    const stolThemes = [
      "Жалобы на работу продавца > Доставка > Сроки (DR)",
      "Маркетплейс > Карточка товара",
      "Уведомления > СМС оповещения",
      "Акции > Скидки продавца"
    ];

    it("вычисляет сходство для «Воблы» выше порога 0.40 (~0.44)", () => {
      const score = calculateThemesSimilarity(koshkaThemes, voblaThemes);
      expect(score).toBe(0.44);
      expect(score).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
    });

    it("вычисляет сходство для «Палатки» ниже порога 0.40 (~0.34)", () => {
      const score = calculateThemesSimilarity(koshkaThemes, palatkaThemes);
      expect(score).toBe(0.34);
      expect(score).toBeLessThan(SIMILARITY_THRESHOLD);
    });

    it("вычисляет сходство для «Стола» ниже порога 0.40 (~0.30)", () => {
      const score = calculateThemesSimilarity(koshkaThemes, stolThemes);
      expect(score).toBe(0.30);
      expect(score).toBeLessThan(SIMILARITY_THRESHOLD);
    });

    it("findSimilarCases оставляет «Воблу» первой и отсекает «Палатку» и «Стол»", () => {
      const manifest = [
        { ticket: "101", title: "Стол", date: "2026-10-08", themes: stolThemes, whatWorked: "Возврат" },
        { ticket: "102", title: "Палатка", date: "2026-10-07", themes: palatkaThemes, whatWorked: "Замена" },
        { ticket: "103", title: "Вобла", date: "2026-10-05", themes: voblaThemes, whatWorked: "Промокод" },
        { ticket: "104", title: "Китай", date: "2026-10-04", themes: stolThemes }
      ];

      const currentCase = { ticket: "999", title: "Кошка", themes: koshkaThemes };
      const res = findSimilarCases(currentCase, manifest, { threshold: 0.40, limit: 3 });

      expect(res.length).toBe(1);
      expect(res[0].case.title).toBe("Вобла");
      expect(res[0].score).toBe(0.44);
    });
  });

  describe("4. Явный тай-брейк кандидатов (compareSimilarCandidates)", () => {
    it("сортирует в первую очередь по баллу сходства (убывание)", () => {
      const a = { score: 0.55, case: { date: "2026-10-01" } };
      const b = { score: 0.65, case: { date: "2026-10-01" } };
      expect(compareSimilarCandidates(a, b)).toBeGreaterThan(0);
      expect(compareSimilarCandidates(b, a)).toBeLessThan(0);
    });

    it("при равном балле отдает приоритет кейсу с заполненным «Что сработало»", () => {
      const withoutWorked = { score: 0.50, case: { date: "2026-10-09", whatWorked: "" } };
      const withWorked = { score: 0.50, case: { date: "2026-10-01", whatWorked: "Решили вопрос бонусами" } };
      expect(compareSimilarCandidates(withWorked, withoutWorked)).toBeLessThan(0);
      expect(compareSimilarCandidates(withoutWorked, withWorked)).toBeGreaterThan(0);
    });

    it("при равном балле и наличии «Что сработало» отдает приоритет более свежей дате", () => {
      const newer = { score: 0.50, case: { date: "2026-10-08", whatWorked: "Да" } };
      const older = { score: 0.50, case: { date: "2026-10-02", whatWorked: "Да" } };
      expect(compareSimilarCandidates(newer, older)).toBeLessThan(0);
      expect(compareSimilarCandidates(older, newer)).toBeGreaterThan(0);
    });
  });

  describe("5. Исключение текущего тикета и дубликатов", () => {
    it("исключает кейс с тем же номером тикета из выдачи", () => {
      const manifest = [
        { ticket: "777", title: "Тот же тикет", themes: ["Тема > А"], whatWorked: "Решение" },
        { ticket: "888", title: "Другой тикет", themes: ["Тема > А"], whatWorked: "Решение" }
      ];

      const res = findSimilarCases({ ticket: "777", themes: ["Тема > А"] }, manifest);
      expect(res.length).toBe(1);
      expect(res[0].case.ticket).toBe("888");
    });

    it("исключает кейс с тем же именем файла", () => {
      const manifest = [
        { file: "case_01.json", ticket: "111", themes: ["Тема > А"] },
        { file: "case_02.json", ticket: "222", themes: ["Тема > А"] }
      ];

      const res = findSimilarCases({ file: "case_01.json", themes: ["Тема > А"] }, manifest);
      expect(res.length).toBe(1);
      expect(res[0].case.file).toBe("case_02.json");
    });
  });

  describe("6. Лимит выдачи и порог отсечения", () => {
    it("возвращает пустой массив, если ни один кейс не преодолел порог 0.40", () => {
      const manifest = [
        { ticket: "1", themes: ["Абсолютно > Другая > Тема"] }
      ];
      const res = findSimilarCases({ themes: ["Претензии > Логистика"] }, manifest, { threshold: 0.40 });
      expect(res).toEqual([]);
    });

    it("ограничивает результат ровно 3 кейсами даже при большом числе совпадений", () => {
      const manifest = [
        { ticket: "1", themes: ["Тема > Общая > Путь"], date: "2026-10-01", whatWorked: "Ок" },
        { ticket: "2", themes: ["Тема > Общая > Путь"], date: "2026-10-02", whatWorked: "Ок" },
        { ticket: "3", themes: ["Тема > Общая > Путь"], date: "2026-10-03", whatWorked: "Ок" },
        { ticket: "4", themes: ["Тема > Общая > Путь"], date: "2026-10-04", whatWorked: "Ок" },
        { ticket: "5", themes: ["Тема > Общая > Путь"], date: "2026-10-05", whatWorked: "Ок" }
      ];

      const res = findSimilarCases({ themes: ["Тема > Общая > Путь"] }, manifest, { limit: 3 });
      expect(res.length).toBe(MAX_SIMILAR_CASES);
      expect(res.length).toBe(3);
    });
  });
});
