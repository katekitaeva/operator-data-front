// Подключение к приватному репозиторию operator-data (токен хранится в localStorage браузера).

import { CONN_KEY } from "./config.js";
import { $, val } from "./ui.js";

export function conn() { try { return JSON.parse(localStorage.getItem(CONN_KEY) || "null"); } catch (e) { return null; } }

export async function ghGet(path) {
  const c = conn();
  if (!c || !c.token) throw new Error("нет подключения к operator-data");
  const url = "https://api.github.com/repos/" + encodeURIComponent(c.owner) + "/" + encodeURIComponent(c.repo) +
    "/contents/" + path.split("/").map(encodeURIComponent).join("/") + "?ref=" + encodeURIComponent(c.branch || "main");
  const r = await fetch(url, { headers: { Authorization: "Bearer " + c.token, Accept: "application/vnd.github.raw+json" }, cache: "no-store" });
  if (!r.ok) throw new Error(r.status + " " + path);
  return r.text();
}

export const b64 = s => {
  const u = new TextEncoder().encode(s);
  let o = "";
  for (let i = 0; i < u.length; i += 0x8000) o += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(o);
};

export async function ghPut(path, text, message = "Запись") {
  const c = conn();
  if (!c || !c.token) throw new Error("нет подключения к operator-data");
  const encPath = path.split("/").map(encodeURIComponent).join("/");
  const br = encodeURIComponent(c.branch || "main");
  let sha;
  try {
    const metaUrl = "https://api.github.com/repos/" + encodeURIComponent(c.owner) + "/" + encodeURIComponent(c.repo) +
      "/contents/" + encPath + "?ref=" + br;
    const r = await fetch(metaUrl, { headers: { Authorization: "Bearer " + c.token, Accept: "application/vnd.github+json" }, cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      sha = j.sha;
    }
  } catch (e) {}

  const url = "https://api.github.com/repos/" + encodeURIComponent(c.owner) + "/" + encodeURIComponent(c.repo) +
    "/contents/" + encPath;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: "Bearer " + c.token,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message,
      content: b64(text),
      branch: c.branch || "main",
      ...(sha ? { sha } : {})
    })
  });
  if (!res.ok) {
    let detail = "";
    try { const ej = await res.json(); detail = ej.message || ""; } catch (e) { detail = await res.text(); }
    throw new Error("GitHub " + res.status + " " + path + (detail ? ": " + detail : ""));
  }
  return res.json();
}

export function connSummary() {
  const c = conn();
  const bd = $("conn-sum"), on = !!(c && c.token);
  if (bd) {
    bd.textContent = on ? "подключено: " + c.owner + "/" + c.repo + " (" + (c.branch || "main") + ")" : "🔌 Подключить GitHub (не подключено)";
    bd.className = "sync-badge " + (on ? "ok" : "off");
  }
  const ownerEl = $("c-owner");
  const repoEl = $("c-repo");
  const branchEl = $("c-branch");
  const tokenEl = $("c-token");
  if (ownerEl) ownerEl.value = (c && c.owner) || ownerEl.value || "katekitaeva";
  if (repoEl) repoEl.value = (c && c.repo) || repoEl.value || "operator-data";
  if (branchEl) branchEl.value = (c && c.branch) || branchEl.value || "main";
  if (tokenEl && on) {
    tokenEl.placeholder = "Токен сохранён (введите новый для замены)";
  }
}

export function initConnection() {
  // шестерёнка в шапке и бейдж подключения открывают и закрывают панель настроек
  const togglePanel = () => $("conn")?.classList.toggle("open");
  $("settingsBtn")?.addEventListener("click", togglePanel);
  $("conn-sum")?.addEventListener("click", togglePanel);

  $("c-save")?.addEventListener("click", async () => {
    const prevConn = conn();
    const ownerVal = (val("c-owner") || "katekitaeva").trim();
    const repoVal = (val("c-repo") || "operator-data").trim();
    const branchVal = (val("c-branch") || "main").trim();
    let tokenVal = ($("c-token")?.value || "").trim();

    // Если поле токена пустое, но токен уже был сохранён ранее — используем прежний токен
    if (!tokenVal && prevConn && prevConn.token) {
      tokenVal = prevConn.token;
    }

    const c = { owner: ownerVal, repo: repoVal, branch: branchVal, token: tokenVal };
    const msg = $("c-msg");

    if (!c.token) {
      if (msg) {
        msg.className = "hint msg er";
        msg.textContent = "Введите персональный токен GitHub (Fine-grained token с правами Contents: Read and write).";
      }
      return;
    }
    if (!c.owner || !c.repo) {
      if (msg) {
        msg.className = "hint msg er";
        msg.textContent = "Заполните владельца и имя репозитория.";
      }
      return;
    }

    if (msg) {
      msg.className = "hint msg";
      msg.textContent = "Проверяю подключение к GitHub…";
    }

    // Сначала проверяем доступ к репозиторию через GitHub API
    try {
      const repoCheckUrl = `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`;
      const repoRes = await fetch(repoCheckUrl, {
        headers: {
          Authorization: `Bearer ${c.token}`,
          Accept: "application/vnd.github+json"
        },
        cache: "no-store"
      });

      if (!repoRes.ok) {
        if (repoRes.status === 401) throw new Error("401 Неверный токен (Unauthorized). Проверьте корректность токена.");
        if (repoRes.status === 404) throw new Error(`404 Репозиторий ${c.owner}/${c.repo} не найден. Проверьте права токена на приватный репозиторий.`);
        if (repoRes.status === 403) throw new Error("403 Доступ запрещен (Forbidden). Проверьте права токена (Contents: Read and write).");
        throw new Error(`${repoRes.status} Ошибка проверки репозитория.`);
      }

      // Сохраняем проверенное подключение
      try { localStorage.setItem(CONN_KEY, JSON.stringify(c)); } catch (e) {}

      // Дополнительно проверяем наличие манифеста
      let cacheNote = "";
      try {
        const m = JSON.parse(await ghGet("cache/manifest.json"));
        cacheNote = ` Страниц в кэше: ${Object.keys(m.pages || {}).length}.`;
      } catch (err) {
        cacheNote = " (кэш манифеста пока не создан в репозитории).";
      }

      if (msg) {
        msg.className = "hint msg ok";
        msg.textContent = `Подключено к ${c.owner}/${c.repo}!${cacheNote}`;
      }
      if ($("c-token")) $("c-token").value = "";
      connSummary();
      document.dispatchEvent(new CustomEvent("operator:changed"));
      setTimeout(() => { $("conn")?.classList.remove("open"); }, 1800);
    } catch (e) {
      if (msg) {
        msg.className = "hint msg er";
        msg.textContent = `Не удалось подключиться: ${e.message}`;
      }
    }
  });

  $("c-forget")?.addEventListener("click", () => {
    try { localStorage.removeItem(CONN_KEY); } catch (e) {}
    connSummary();
    const tokenEl = $("c-token");
    if (tokenEl) {
      tokenEl.value = "";
      tokenEl.placeholder = "github_pat_...";
    }
    const msg = $("c-msg");
    if (msg) {
      msg.className = "hint msg";
      msg.textContent = "Токен удалён из браузера.";
    }
    document.dispatchEvent(new CustomEvent("operator:changed"));
  });
}
