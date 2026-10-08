#!/usr/bin/env python3
"""
Скрипт обработки входящих кейсов для репозитория operator-data.
1. Сканирует inbox/cases/*.json
2. Проверяет карточки, выявляет и очищает остаточные PII (телефоны, email)
3. Перемещает проверенные файлы в cases/
4. Пересобирает cases/manifest.json со списком всех кейсов
"""

import os
import sys
import json
import re
from datetime import datetime

INBOX_DIR = "inbox/cases"
CASES_DIR = "cases"
MANIFEST_PATH = "cases/manifest.json"

PHONE_RE = re.compile(r'(?:\+?7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}')
EMAIL_RE = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')

def sanitize_text(text):
    if not isinstance(text, str):
        return text
    s = PHONE_RE.sub("[телефон]", text)
    s = EMAIL_RE.sub("[email]", s)
    return s

def sanitize_card(card):
    for field in ["title", "problem", "demand", "demandChanged", "legal", "contacts", "tasks", "chrono", "status", "whatWorked", "qcComments", "verdict"]:
        if field in card and isinstance(card[field], str):
            card[field] = sanitize_text(card[field])
    
    if "outcome" in card and isinstance(card["outcome"], dict):
        for k in ["check", "reply", "comment"]:
            if k in card["outcome"]:
                card["outcome"][k] = sanitize_text(card["outcome"][k])
                
    if "themes" in card and isinstance(card["themes"], list):
        for t in card["themes"]:
            if isinstance(t, dict) and "note" in t:
                t["note"] = sanitize_text(t["note"])
    return card

def extract_theme_paths(raw_themes):
    paths = []
    if isinstance(raw_themes, list):
        for t in raw_themes:
            if isinstance(t, str) and t.strip():
                paths.append(t.strip())
            elif isinstance(t, dict):
                p = t.get("path") or t.get("name") or t.get("code") or ""
                if p.strip():
                    paths.append(p.strip())
    return paths

def main():
    os.makedirs(CASES_DIR, exist_ok=True)
    os.makedirs(INBOX_DIR, exist_ok=True)

    processed_count = 0
    inbox_files = [f for f in os.listdir(INBOX_DIR) if f.endswith(".json")]

    for fname in inbox_files:
        src = os.path.join(INBOX_DIR, fname)
        dst = os.path.join(CASES_DIR, fname)
        try:
            with open(src, "r", encoding="utf-8") as f:
                card = json.load(f)

            # Валидация базовых полей
            if not card.get("ticket") and not card.get("order"):
                print(f"[WARN] Пропуск {fname}: нет ни номера тикета, ни заказа")
                continue

            card = sanitize_card(card)

            with open(dst, "w", encoding="utf-8") as f:
                json.dump(card, f, ensure_ascii=False, indent=2)

            os.remove(src)
            processed_count += 1
            print(f"[OK] Перенесён кейс: {fname} -> {dst}")
        except Exception as e:
            print(f"[ERR] Ошибка при обработке {fname}: {e}")

    # Пересборка cases/manifest.json
    all_case_files = sorted([f for f in os.listdir(CASES_DIR) if f.endswith(".json") and f != "manifest.json"], reverse=True)
    manifest_cases = []

    for fname in all_case_files:
        cpath = os.path.join(CASES_DIR, fname)
        try:
            with open(cpath, "r", encoding="utf-8") as f:
                c = json.load(f)
            
            theme_paths = extract_theme_paths(c.get("themes"))
            
            # Название кейса: если не задано в c.title, генерируем информативное имя
            title = (c.get("title") or "").strip()
            if not title:
                if c.get("ticket"):
                    title = f"Тикет #{c.get('ticket')}" + (f" ({theme_paths[0]})" if theme_paths else "")
                elif c.get("order"):
                    title = f"Заказ {c.get('order')}"
                else:
                    title = fname.replace(".json", "")

            problem = (c.get("problem") or "").strip()
            verdict = (c.get("verdict") or "").strip()
            what_worked = (c.get("whatWorked") or "").strip()

            digest_obj = {
                "themes": theme_paths,
                "problem": problem,
                "verdict": verdict,
                "whatWorked": what_worked
            }

            digest_text_parts = []
            if theme_paths:
                digest_text_parts.append(f"Темы: {', '.join(theme_paths)}")
            if problem:
                digest_text_parts.append(f"Суть проблемы: {problem}")
            if verdict:
                digest_text_parts.append(f"Вердикт: {verdict}")
            if what_worked:
                digest_text_parts.append(f"Что сработало: {what_worked}")
            digest_text = " | ".join(digest_text_parts)

            manifest_cases.append({
                "id": c.get("id") or fname.replace(".json", ""),
                "file": fname,
                "title": title,
                "date": c.get("date") or "",
                "ticket": c.get("ticket") or "",
                "order": c.get("order") or "",
                "clientId": c.get("clientId") or None,
                "themes": theme_paths if theme_paths else (c.get("themes") or []),
                "problem": problem,
                "demand": (c.get("demand") or "").strip(),
                "whatWorked": what_worked,
                "qcComments": (c.get("qcComments") or "").strip(),
                "verdict": verdict,
                "digest": digest_obj,
                "digestText": digest_text,
                "themesVersion": c.get("themesVersion") or None
            })
        except Exception as e:
            print(f"[WARN] Не удалось прочитать {fname} для манифеста: {e}")

    manifest_data = {
        "updatedAt": datetime.utcnow().isoformat() + "Z",
        "total": len(manifest_cases),
        "cases": manifest_cases
    }

    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, ensure_ascii=False, indent=2)

    print(f"[DONE] Обработано новых кейсов: {processed_count}. Всего в манифесте: {len(manifest_cases)}")

if __name__ == "__main__":
    main()
