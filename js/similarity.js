// Модуль вычисления сходства кейсов по темам обращения (ТЗ §5.2)

export const SIMILARITY_THRESHOLD = 0.40;
export const MAX_SIMILAR_CASES = 3;

/**
 * Нормализация иерархического пути темы:
 * разбиение по разделителям >, приведение к нижнему регистру, очистка меток (DR) и лишних пробелов.
 */
export function normalizeTheme(theme) {
  if (!theme) return { raw: "", path: "", segments: [] };
  const raw = typeof theme === "string" ? theme : (theme.path || theme.name || "");
  const clean = String(raw).replace(/\s+/g, " ").trim();
  const segments = clean
    .split(/[>›→]/)
    .map(s => s.trim().toLowerCase().replace(/\s*\([a-z0-9_-]+\)$/i, "").trim())
    .filter(Boolean);

  return {
    raw,
    path: segments.join(" > "),
    segments
  };
}

/**
 * Вычисление сходства между двумя иерархическими путями тем (от 0.0 до 1.0).
 * Учитывает совпадение префикса пути, глубину и совпадение листового уточнения.
 */
export function themePathSimilarity(themeA, themeB) {
  const normA = normalizeTheme(themeA);
  const normB = normalizeTheme(themeB);
  if (!normA.segments.length || !normB.segments.length) return 0;

  // Точное совпадение нормализованного пути
  if (normA.path === normB.path) {
    const depth = Math.max(normA.segments.length, normB.segments.length);
    // Для общих корневых категорий (глубина 1) сходство чуть ниже, для глубоких тем — полное 1.0
    return depth === 1 ? 0.85 : 1.0;
  }

  const maxLen = Math.max(normA.segments.length, normB.segments.length);
  const minLen = Math.min(normA.segments.length, normB.segments.length);

  // Считаем длину общего префикса от корня
  let prefix = 0;
  while (prefix < minLen && normA.segments[prefix] === normB.segments[prefix]) {
    prefix++;
  }

  if (prefix > 0) {
    // Частичное совпадение иерархии сверху вниз
    return prefix / maxLen;
  }

  // Проверка совпадения листовой темы (если корень отличался)
  const leafA = normA.segments[normA.segments.length - 1];
  const leafB = normB.segments[normB.segments.length - 1];
  if (leafA && leafB && leafA === leafB && leafA.length > 3) {
    return 0.4 / maxLen;
  }

  return 0;
}

/**
 * Симметричное покрытие тем между двумя наборами (ТЗ §5.2).
 * Рассчитывает среднее между cov(A -> B) и cov(B -> A) с учетом специфичности/глубины.
 */
export function calculateThemesSimilarity(currentThemes, candidateThemes) {
  const listA = (Array.isArray(currentThemes) ? currentThemes : [currentThemes])
    .map(normalizeTheme)
    .filter(t => t.segments.length > 0);
  const listB = (Array.isArray(candidateThemes) ? candidateThemes : [candidateThemes])
    .map(normalizeTheme)
    .filter(t => t.segments.length > 0);

  if (!listA.length || !listB.length) return 0;

  // Покрытие A -> B: для каждой темы из A ищем наилучшее совпадение в B
  let sumA = 0;
  for (const a of listA) {
    let best = 0;
    for (const b of listB) {
      const sim = themePathSimilarity(a, b);
      if (sim > best) best = sim;
    }
    sumA += best;
  }

  // Покрытие B -> A: для каждой темы из B ищем наилучшее совпадение в A
  let sumB = 0;
  for (const b of listB) {
    let best = 0;
    for (const a of listA) {
      const sim = themePathSimilarity(b, a);
      if (sim > best) best = sim;
    }
    sumB += best;
  }

  const covAtoB = sumA / listA.length;
  const covBtoA = sumB / listB.length;
  let score = (covAtoB + covBtoA) / 2;

  // Бонус за специфичность (глубину): совпадение узкой темы (глубина >= 3)
  const hasDeepMatch = listA.some(a => a.segments.length >= 3 && listB.some(b => themePathSimilarity(a, b) >= 0.95));
  if (hasDeepMatch) {
    const specificityBonus = listB.length <= 2 ? 0.025 : 0.01;
    score = Math.min(1.0, score + specificityBonus);
  } else if (listA.some(a => a.segments.length >= 2 && listB.some(b => themePathSimilarity(a, b) >= 0.95))) {
    score = Math.min(1.0, score + 0.005);
  }

  return Math.round(score * 100) / 100;
}

/**
 * Функция явного тай-брейка для стабильной сортировки:
 * 1. Балл сходства (по убыванию)
 * 2. Наличие непустого «Что сработало» (кейсы с подтверждённым решением выше)
 * 3. Дата создания/закрытия кейса (более свежие выше)
 * 4. Детерминированный идентификатор (тикет / заказ / id)
 */
export function compareSimilarCandidates(a, b) {
  // 1. Балл сходства
  const diff = b.score - a.score;
  if (Math.abs(diff) > 0.0001) {
    return diff;
  }

  // 2. Наличие «Что сработало»
  const workedA = Boolean((a.case.whatWorked || a.case.digest?.whatWorked || "").trim());
  const workedB = Boolean((b.case.whatWorked || b.case.digest?.whatWorked || "").trim());
  if (workedA !== workedB) {
    return workedB ? 1 : -1;
  }

  // 3. Дата (сначала более свежие)
  const dateA = a.case.date || "";
  const dateB = b.case.date || "";
  if (dateA !== dateB) {
    return dateB.localeCompare(dateA);
  }

  // 4. Детерминированный идентификатор
  const idA = String(a.case.ticket || a.case.order || a.case.id || a.case.file || "");
  const idB = String(b.case.ticket || b.case.order || b.case.id || b.case.file || "");
  return idA.localeCompare(idB);
}

/**
 * Единая функция отбора похожих кейсов:
 * - исключает кейс с тем же тикетом или файлом;
 * - отсекает результаты ниже порога (threshold = 0.40);
 * - ранжирует по явному тай-брейку;
 * - возвращает не более limit (по умолчанию 3) лучших совпадений.
 */
export function findSimilarCases(currentInput, manifestCases, options = {}) {
  const threshold = typeof options.threshold === "number" ? options.threshold : SIMILARITY_THRESHOLD;
  const limit = typeof options.limit === "number" ? options.limit : MAX_SIMILAR_CASES;

  if (!manifestCases || !Array.isArray(manifestCases) || !manifestCases.length) {
    return [];
  }

  let currentThemes = [];
  let currentTicket = "";
  let currentFile = "";

  if (Array.isArray(currentInput)) {
    currentThemes = currentInput;
  } else if (currentInput && typeof currentInput === "object") {
    currentThemes = currentInput.themes || [];
    currentTicket = currentInput.ticket || currentInput.id || "";
    currentFile = currentInput.file || "";
  }

  if (options.excludeTicket) currentTicket = options.excludeTicket;
  if (options.excludeFile) currentFile = options.excludeFile;

  const cleanCurrentThemes = currentThemes
    .map(t => typeof t === "string" ? t : (t.path || t.name || ""))
    .filter(Boolean);

  if (!cleanCurrentThemes.length) {
    return [];
  }

  const scored = [];
  const currTicketStr = String(currentTicket || "").trim().toLowerCase();
  const currFileStr = String(currentFile || "").trim().toLowerCase();

  for (const c of manifestCases) {
    if (!c) continue;

    // Исключение кейса с тем же тикетом (п. 6 ТЗ)
    const cTicketStr = String(c.ticket || c.id || "").trim().toLowerCase();
    if (currTicketStr && cTicketStr && currTicketStr === cTicketStr) {
      continue;
    }

    // Исключение того же файла
    const cFileStr = String(c.file || "").trim().toLowerCase();
    if (currFileStr && cFileStr && currFileStr === cFileStr) {
      continue;
    }

    const cThemes = Array.isArray(c.themes)
      ? c.themes.map(t => typeof t === "string" ? t : (t.path || t.name || ""))
      : (c.digest && Array.isArray(c.digest.themes) ? c.digest.themes : []);

    if (!cThemes.length) continue;

    const score = calculateThemesSimilarity(cleanCurrentThemes, cThemes);

    if (score >= threshold) {
      const matchedThemes = [];
      for (const ct of cThemes) {
        for (const cur of cleanCurrentThemes) {
          if (themePathSimilarity(ct, cur) >= 0.5) {
            if (!matchedThemes.includes(ct)) matchedThemes.push(ct);
          }
        }
      }

      scored.push({
        case: c,
        score,
        matchedThemes: matchedThemes.length ? matchedThemes : cThemes.slice(0, 2)
      });
    }
  }

  scored.sort(compareSimilarCandidates);
  return scored.slice(0, limit);
}
