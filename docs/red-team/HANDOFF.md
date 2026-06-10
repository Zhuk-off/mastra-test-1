# Передача задачи: red-team фиксы чистильщика лендингов (для новой сессии)

> Скопируй весь этот файл как стартовый промпт новой сессии. Самодостаточно: что сделано,
> какие решения владельца зафиксированы (НЕ переспрашивай), что осталось и как продолжать.

## Контекст

Проект — AI-агент очистки лендингов для арбитража трафика (Mastra, TypeScript, ESM, WSL).
Путь: `/home/asus/projects/me-projects/mastra/learn-mastra-2`
Кампания фиксов по red-team разбору. Карта кластеров — `docs/red-team/00-summary.md`; полный реестр
находок со статусами — `docs/red-team/_index.md` (**источник правды**: 🆕 новая · 🛠 частично ·
✅ закрыта · 🚫 won't-fix). Per-file доки рядом (`allowlist.md`, `2a-allowlist-src.md`, и т.д.).

Все правки на ветке **`redteam-fixes`** (≈35 атомарных коммитов, один коммит = одна находка/кластер).
**Статус: весь Critical + весь High (🟧) + кластер C6 + SVG + offer-политика закрыты.** Осталась
только хвостовая часть 🟨/🟩 (харднинг/краевые случаи, не блокеры). Чистильщиком уже можно
пользоваться — **сначала отревьюй/смерджи ветку.**

## Окружение и запуск (ВАЖНО)

cmd.exe с UNC-путём ломается. Все команды — через PowerShell + WSL + nvm:
```
wsl.exe -d Ubuntu-24.04 -e bash -lc 'export NVM_DIR=$HOME/.nvm; . "$NVM_DIR/nvm.sh"; cd /home/asus/projects/me-projects/mastra/learn-mastra-2 && <cmd>'
```
- Тесты: `npx vitest run` (сейчас **460 зелёных + 1 skipped**).
- Типы: `npx tsc --noEmit -p tsconfig.json` (должен быть EXIT=0).
- Очистка: `npm run clean -- <dir>` (AST-advanced включён по умолчанию; `--no-advanced` чтобы выключить).
- Проверка: `npm run verify -- <dir>` (интерактивная — прокликивает).
- Реальный тестовый лендинг: `downloads/1753_landing_archive` (копируй в /tmp перед прогоном).
- **Коммит-сообщения:** многострочные через heredoc ломаются на апострофах/скобках (bash-кавычки).
  Надёжно: записать сообщение в `_commitmsg.tmp` → `git add -A && git reset -q -- _commitmsg.tmp &&
  git commit -F _commitmsg.tmp && rm -f _commitmsg.tmp` (tmp НЕ коммитить).

## Дисциплина фикса (на каждую находку)

1. **TDD**: сперва падающий регресс-тест рядом с существующими в `__tests__/`, потом фикс.
2. Держать ВСЕ тесты зелёными и `tsc --noEmit` чистым.
3. Конвенции: TS strict, ESM-импорты с суффиксом `.js`, без новых зависимостей без нужды.
4. **HTML — только cheerio** (`utils/html-dom.ts`), НЕ regex. Для фрагментов (содержимое `<noscript>`
   и т.п.) — `parseFragment`/`serializeFragment`.
5. `classifyResource` — чистая функция (без I/O). Чинить ВХОД в неё, не модель.
6. После фикса: обнови статус в `_index.md` (🆕→✅/🛠/🚫), коротко отметь в per-file доке, обнови счётчик
   тестов в этом HANDOFF, коммит на `redteam-fixes`. После пачки — прогон clean/verify на копии лендинга.

## Что НЕ ломать (сильные стороны)

Белый список default-deny (`classifyResource`); cheerio для HTML; карантин-вместо-удаления (и для JS);
репин либ на офиц. CDN + SRI от ОФИЦИАЛЬНОГО файла; verify-детектор чужих хостов; base-aware загрузчик;
AST-скан строковых литералов для макросов и детекторов; path-whitelist мультитенантных CDN;
агрессивная offer-политика (см. решение №7); снятие `on*` по префиксу.

## ✅ РЕШЕНИЯ ВЛАДЕЛЬЦА (зафиксированы — НЕ переспрашивай, применяй везде)

1. **Редирект/keylogger на чужой хост = всегда кража** → авто-нейтрализация (не WARN). Сделано
   (`detect-redirect`/`detect-keylogger` → `shouldRemove:true`, `neutralize-detections.ts`). Новые
   детекторы такого рода — тоже действие.
2. **Серверный код (PHP/ASP) в чужом лендинге не используется** → вырезать ВСЕ серверные теги ПЕРВЫМ
   делом и чистить файл полностью. Сделано (`stripServerTags`). Свой PHP (spysecure + форма) — на этапе АДАПТАЦИИ.
3. **Человек отчёты обычно НЕ читает** → всё максимально автоматически; «WARN для ревью» — плохой выбор,
   предпочитать действие (удаление/карантин/нейтрализация).
4. **Лендинги одностраничные.** verify прокликивает; квиз → флаг (ручная перепроверка) — ок.
5. **Артефакты (`_quarantine/`, `clean-report.md`, лог) — ВНУТРИ папки лендинга. QUAR-1 — won't-fix.**
6. **Макросы (`{offer}`, `{_offer_value:...}`) активно используются; карта макросов важна** — сканируется
   и в inline-HTML, и во внешних `.js`/`.css`.
7. **АГРЕССИВНАЯ offer-политика: ВСЕ кликабельные ссылки → `{offer}`** (трафик только на оффер). Чужие
   footer/соцсети/правовые ссылки чаще всего = спрятанное воровство трафика. `replace-offer-links` уже
   переписан: все `<a>`/`<area>` href → `{offer}`, КРОМЕ якорей `#...`, `mailto:`/`tel:` и href с
   макросом `{...}`. **OFFER-1 в консервативную сторону (вайтлист соцсетей) НЕ делать — это анти-фикс.**
   Оригинальные URL пишутся в отчёт для ручного возврата редких исключений. (Память: feedback_offer_all_links.)

## Что уже закрыто (≈35 коммитов на `redteam-fixes`)

**Critical (P0):** AL-1 (схемы `data:`/`javascript:` в script/iframe/href → quarantine/remove),
PIPE-1+DOM-1 (серверный тег больше не выключает очистку — вырезается+чистится), NORM-1 (path traversal —
siteDir-containment), REP-1 (отчёт показывает удаления + PHP-бэкдор).

**High (🟧) — вся серия:** 2D-6 (`strip-dangerous-hrefs`: опасные схемы в `<a>`/`<area>` href),
DET-1 (вычисляемые/обфусцированные URL: `extractStringish` + `obfuscatedDecoderIn`), DET-2
(`collectExfilBindings`: алиасы + 2-строчный Image/createElement-script), DET-3/DEC-1/DEC-2/DOC-1/RED-1/
KEY-1/EUF-1/EUF-2/CJS-1/CJS-2/RIE-1 (детекторы C4/C5), AL-3+CDN-1+POL-2 (path-whitelist мультитенантных
CDN), NORM-3 (сбор lazy-load/poster/`<use>`/`@import`), URL-1 (`extractHostname`→null на относительных),
UCDN-1+UCDN-2 (SRI от CDN-файла; 404→фолбэк), COV-1+ANA-1 (мёртвый-по-coverage JS → карантин;
непарсимое не удаляем), EXT-1, PIPE-2/PIPE-4, WALK-1, VR-1/CST-1.

**C6 «блок-лист → белый список»:** 2A-3 (preconnect/preload через `classifyResource`), 2A-4 (`<noscript>`
вложенным `parseFragment`+allowlist), CSS-1 (CSS `url()` через allowlist), CSS-2 (`clean-inline-css` для
`<style>`/`style=`), MAC-1/CSS-3/CJS-5 (`utils/macro-scan.ts` — макросы во внешних `.js`/`.css`).

**SVG:** SVG-1/SVG-2 (`cleanSvgContent`: self-closing `<script>`, неквотированные `on*`, plain/SVG2 href,
`javascript:`-схема, `<style>` url() в SVG).

**Offer/robustness:** OFFER-1 (🚫 by-design) + OFFER-2 + OFFER-3 (агрессивная политика, см. решение №7),
PIPE-3 (per-file try/catch — один кривой файл не валит прогон), 2D-3 (снятие ЛЮБОГО `on*` по префиксу —
покрыты мобильные touch/pointer/wheel/clipboard/history/media), 2D-2 (значение `on*` через AST
`detectExfilCalls`+`detectRedirect`: обфусцированный/протокол-относительный/`return …` exfil ловится).

**Ключевые новые модули/функции:** `passes/html/strip-dangerous-hrefs.ts`, `passes/html/clean-inline-css.ts`,
`utils/macro-scan.ts`, `utils/html-dom.ts::parseFragment/serializeFragment`,
`utils/allowlist.ts::dangerousSchemeOf` + `MULTITENANT_CDNS`/`TRUSTED_CDN_PACKAGES` (policy),
`cdn-detector.ts::fetchOfficial` (экспортирован), `detectors/helpers.ts::referencedGlobalName/obfuscatedDecoderIn`,
`detect-exfil-calls.ts::collectExfilBindings/srcAssignmentKind`.

## Что осталось — приоритетный порядок для новой сессии

> **2D-2 ✅ закрыта** (обфусцированный/протокол-относительный exfil в значении `on*` теперь идёт через
> AST `detectExfilCalls`+`detectRedirect`). Следующее рекомендованное — кластер **C7** (regex→AST в JS).

**C7 — «regex вместо парсера» в JS-проходах (🟨):**
- ✅ **SW-1/SW-2** → `detect-service-worker.ts`, **EVAL-1/EVAL-2** → `detect-eval-obfuscation.ts` (regex
  файлы удалены; гонятся через `neutralizeDetections`). ✅ **CJS-3/CJS-4** — `clean-js` парсит один раз,
  SW/eval не мутируют сырой текст до парса; непарсимое → `JS_NOT_ANALYZED`, не тишина.
- ✅ **PARSE-1** — закрыт fallback'ом module→script (acorn берёт Annex B `<!--` в script-режиме);
  закреплён регресс-тестами в `ast/__tests__/parse.test.ts`. 🛠 **PARSE-2** — основной путь (`.js`)
  репортит непарсимое через CJS-3 (`JS_NOT_ANALYZED`); `parseJs` остаётся чистым. Inline-сторону закрыл
  ✅ **2D-5** (подозрительный непарсимый inline-`<script>` → карантин). 🟩 **PARSE-3** (module-first
  двойной парс / нет лимита размера) — оставлен.

**Детекторы/PHP (🟨):**
- **OBF-1/MET-1** (🛠) — точнее по AST (идентификаторы/«полезность»). Срочность низкая: удаления обратимы (карантин).
- ✅ **PHP-1** — `.phtml`/`.php5/7/s`/`.inc` теперь маршрутизируются как серверные страницы:
  `stripServerTags` режет их серверный код (owner #2) + `detectPhpBackdoors` сканирует. Узость
  detection-regex стала moot для удаления (режется весь `<?php…?>`-блок). Не-`.php` гейтятся по
  `hasServerTags` (не мангать не-HTML `.inc`).

**Normalize/HTML (🟨):** NORM-4 (контекстно-слепая замена бьёт inline-JS/meta), NORM-5 (`stripPhpCode`
рвёт разметку), NORM-6 (выбор главного файла узкий/недетерминирован), DOM-2/DOM-3/DOM-4, 2B-1
(base-aware normalize; 2B-2 ✅ meta-refresh снят), 2A-5 (inline-трекеры — только вендор-сниппеты).

**Макросы (🟨):** MAC-2 (другие синтаксисы `[..]`/`%..%`/`{{..}}`), MAC-3 (template-скрипты/непарсимый inline).

**CDN/verify/coverage (🟨):** CDN-2/3/4, UCDN-3, RLL-1/3, PIPE-6 (сеть в горячем цикле), VR-2/VR-3,
VIS-2/3, COV-2 (таймаут роняет clean), DL-2.

**Хосты/политика (🟨):** AL-4 (карта «хост→типы»), URL-2 (единый kind-aware оракул), POL-3 (owner-config),
POL-1 (🟧 формально — «CSP это гигиена, не граница»; переоценка ожиданий, не код-фикс).

**🟩 мелочи:** URL-3/4, CDN-5, UCDN-4, REP-2/4, CHG-1, WARN-1, PARSE-3, EUF-3, IDX-1, QUAR-2, SM-1,
CSS-4, 2B-3/4/5/6, MAC-4/5, COV-3/4, POL-4, RLL-2, CST-2, WALK-2, PIPE-5, CJS-6 (см. `_index.md`).

**🚫 won't-fix:** QUAR-1 (артефакты внутри папки — решение владельца №5), OFFER-1 (агрессивная политика
by-design — решение владельца №7).

## Как начать новую сессию

1. Прочитай `docs/red-team/_index.md` (статусы) и `00-summary.md` (кластеры). При сомнении — `git log --oneline`.
2. **Весь Critical + High + C6 + SVG + offer + 2D-2 + C7 + 2B-2 + PHP-1 + 2D-5 закрыты.** Возьми верхнюю
   незакрытую из «Что осталось». Кандидаты на следующий заход: соундность детекторов **OBF-1/MET-1**
   (🛠, по AST — идентификаторы/«полезность»; удаления обратимы, поэтому срочность низкая), либо кластер
   **Normalize/HTML** (NORM-4/5/6 — контекстно-слепая замена/выбор главного файла; 2B-1 base-aware).
3. TDD → фикс → зелёные тесты + чистый `tsc` → обнови `_index.md` + per-file док + счётчик тестов здесь →
   коммит на `redteam-fixes`.
4. После пачки фиксов — `npm run clean -- <copy>` и `npm run verify -- <copy>` на копии реального лендинга
   (`downloads/1753_landing_archive` → /tmp) — убедиться в отсутствии регресса.
