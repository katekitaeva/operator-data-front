// Единое состояние формы и его сохранение в localStorage.
// current и themes лежат в объекте state: модули не могут переприсваивать чужие let.

import { FIELDS, CHECKS, STORAGE_KEY } from "./config.js";

export const state = { current: 1, themes: [], caseSaved: false, loadedCase: null };

export function save() {
  try {
    const data = {
      current: state.current,
      themes: state.themes,
      caseSaved: !!state.caseSaved,
      loadedCase: state.loadedCase || null,
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
    CHECKS.forEach(c => { const el = document.getElementById(c); if (el && data.checks && data.checks[c]) el.checked = true; });
  } catch (e) { console.warn("load():", e); }
}
