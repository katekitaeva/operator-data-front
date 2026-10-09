// Единое состояние формы и его сохранение в localStorage.
// current и themes лежат в объекте state: модули не могут переприсваивать чужие let.

import { FIELDS, CHECKS, STORAGE_KEY } from "./config.js";

export const state = {
  current: 1,
  themes: [],
  caseSaved: false,
  loadedCase: null,
  actions: null,
  caseMatch: null,
  matchingText: "",
  dictionaryVersion: null,
  lastParse4Summary: ""
};

export function save() {
  try {
    const matchingEl = document.getElementById("matching-text");
    if (matchingEl && matchingEl.value !== undefined) {
      state.matchingText = matchingEl.value;
    }
    const data = {
      current: state.current,
      themes: state.themes,
      caseSaved: !!state.caseSaved,
      loadedCase: state.loadedCase || null,
      actions: state.actions || null,
      caseMatch: state.caseMatch || null,
      matchingText: state.matchingText || "",
      dictionaryVersion: state.dictionaryVersion || null,
      lastParse4Summary: state.lastParse4Summary || "",
      checks: {}
    };
    CHECKS.forEach(c => { const el = document.getElementById(c); if (el) data.checks[c] = el.checked; });
    FIELDS.forEach(f => { const el = document.getElementById(f); if (el) data[f] = el.value; });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) { console.warn("save():", e); }
}

export function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!data) return;
    FIELDS.forEach(f => { const el = document.getElementById(f); if (el && data[f] !== undefined) el.value = data[f]; });
    state.current = data.current || 1;
    state.themes = data.themes || [];
    state.caseSaved = !!data.caseSaved;
    state.loadedCase = data.loadedCase || null;
    state.actions = data.actions || null;
    state.caseMatch = data.caseMatch || null;
    state.matchingText = data.matchingText || (data["matching-text"] || "");
    state.dictionaryVersion = data.dictionaryVersion || null;
    state.lastParse4Summary = data.lastParse4Summary || "";

    // Обратная совместимость для сохранённого состояния старой версии
    if (Array.isArray(state.actions) && state.actions.length > 0) {
      if (!state.actions.some(a => a.type === "call")) {
        const callItem = {
          id: "act-call",
          type: "call",
          title: "Звонок клиенту",
          done: false,
          open: false,
          time: "",
          script: ""
        };
        const themesIdx = state.actions.findIndex(a => a.type === "themes");
        if (themesIdx !== -1) {
          state.actions.splice(themesIdx + 1, 0, callItem);
        } else {
          state.actions.unshift(callItem);
        }
      }
    }

    CHECKS.forEach(c => { const el = document.getElementById(c); if (el && data.checks && data.checks[c]) el.checked = true; });
  } catch (e) { console.warn("load():", e); }
}
