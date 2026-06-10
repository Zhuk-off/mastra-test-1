# Red Team: Тир 2b — структурные проходы

Проходы, удаляющие структурные/редирект-элементы:
- [`remove-base.ts`](src/mastra/cleaners/passes/html/remove-base.ts) — `<base>` ← **твой пример**
- [`remove-meta-refresh.ts`](src/mastra/cleaners/passes/html/remove-meta-refresh.ts) — `<meta refresh>` (тут `isExternalUrl`/T-2)
- [`remove-object-embed.ts`](src/mastra/cleaners/passes/html/remove-object-embed.ts) — `<object>`/`<embed>`
- [`remove-frames.ts`](src/mastra/cleaners/passes/html/remove-frames.ts) — `frameset/frame/noframes`
- [`remove-tracker-metas.ts`](src/mastra/cleaners/passes/html/remove-tracker-metas.ts) — verification-метатеги
- [`remove-tracker-jsonld.ts`](src/mastra/cleaners/passes/html/remove-tracker-jsonld.ts) — трекерный JSON-LD

---

## Находки

### [2B-1] 🟡 Robustness · 🟨 Medium · `<base>` вырезается вслепую — относительные пути могут сломаться (твой кейс)

- **Сейчас:** `removeBase` = `$('base').remove()` безусловно
  ([:4–7](src/mastra/cleaners/passes/html/remove-base.ts:4)). Запускается **первым** DOM-проходом.
- **Проблема (ровно твоя интуиция):** `<base href="...">` менял разрешение **всех** относительных
  URL на странице. Удаляя его, мы молча меняем точку отсчёта для каждого относительного `src`/`href`.
  Хуже — `normalize-landing-structure` (бежит ещё **раньше**, до DOM) про `<base>` **не знает**
  (я перечитал — обработки base там нет): он резолвит относительные пути от каталога файла. Связка:
  - лендинг с `<base href="assets/">` + `<img src="logo.png">` (реально `assets/logo.png`);
  - `normalize` резолвит `logo.png` от каталога файла → не находит → ссылку не трогает;
  - `removeBase` удаляет базу → теперь `logo.png` указывает в корень → **битая картинка**.
- **Последствие:** для лендингов, опирающихся на `<base href>` (а это **частый** случай у скачанных
  зеркал — wget/httrack/«Save As» добавляют `<base href="http://оригинал/">`), пути ломаются.
  Не краш, а тихая порча — как раз «пожар после выгрузки».
- **Рекомендация:** не удалять вслепую. До удаления **разрешить** `<base href>` в относительные
  URL (переписать ссылки от базы), и/или сделать `normalize` base-aware (читать `<base>` как baseDir
  при резолве). `<base target>` тоже удаляется — это меняет поведение ссылок (мелочь, но отметить).
- **Уверенность:** логика подтверждена чтением `remove-base` + `normalize`. Реальная частота —
  зависит от того, добавляет ли наш загрузчик `<base href>` → нить **T-7**.

### [2B-2] 🔴 Bypass · 🟨 Medium · meta-refresh: относительный и закавыченный URL переживают (✅ закрыта)

- **Сейчас:** удаляем `<meta http-equiv=refresh>` если url нет (чистый таймер) **или**
  `isExternalUrl(url)` ([:12](src/mastra/cleaners/passes/html/remove-meta-refresh.ts:12)).
- **Последствия:**
  - **Относительный редирект остаётся:** `content="0;url=offer.html"` → `isExternalUrl(относит.)` =
    false → **kept**. Локальный мгновенный редирект (шаг клоакинга лендинг→оффер) выживает.
  - **Закавыченный URL обходит проверку:** `content="0;url='https://evil.com'"` → захваченное
    `'https://evil.com'` начинается с `'`, поэтому `isExternalUrl` на шаге `/^https?:\/\//` даёт
    false ([url.ts:58](src/mastra/cleaners/utils/url.ts:58)) → **kept**. Браузеры к кавычкам в
    meta-refresh снисходительны и часто исполняют редирект.
  - **T-2 (own-asset):** refresh на CloudFront/jsdelivr → `isExternalUrl`=false → kept (низкий риск).
- **Рекомендация:** любой `meta refresh` **с url** трактовать как подозрительный (quarantine/flag,
  а не только external); снимать кавычки/триммить перед разбором; решить политику по относительным
  редиректам (для арбитража мгновенный редирект — сигнал).
- **Уверенность:** подтверждено чтением кода; исполнение закавыченного — за браузером (потому Medium).

### [2B-3] 🟡 Robustness · 🟩 Low · `<object>` удаляется целиком (с fallback), `<embed>` наследует 2A

- **Сейчас:** все `<object>` удаляются безусловно (вместе с дочерним fallback-контентом)
  ([:9–13](src/mastra/cleaners/passes/html/remove-object-embed.ts:9)); `<embed src>` — через
  `classifyResource('iframe')`.
- **Последствие:** редко, но `<object>` с легитимным fallback-HTML внутри теряет и fallback.
  `<embed src=" data:...">` наследует обход whitespace/`data:` из [2A-1](2a-allowlist-src.md)/[2A-2].
  Удаление object/embed соответствует ручному чек-листу — это намеренно, отмечаем края.
- **Рекомендация:** низкий приоритет; при фиксе 2A-1/2A-2 в `allowlist.ts` `<embed>` подтянется сам.
- **Уверенность:** подтверждено чтением кода.

### [2B-4] 🟡 Robustness · 🟩 Low · `frameset`-лендинг → пустая страница

- **Сейчас:** `frameset/frame/noframes` удаляются безусловно
  ([:6–9](src/mastra/cleaners/passes/html/remove-frames.ts:6)).
- **Последствие:** если главный файл — настоящий frameset (контент в дочерних фреймах), после
  удаления остаётся пустой `<body>`. Архаично и редко, но возможно.
- **Рекомендация:** низкий приоритет; при желании — логировать «страница была frameset» в отчёт.
- **Уверенность:** подтверждено чтением кода.

### [2B-5] 🟢 Soundness · 🟩 Low · verification-метатеги: узкий блок-лист

- **Сейчас:** удаляются только 8 имён из `meta-names.ts` (google/bing/yandex/fb/pinterest/norton/
  alexa/wot verification). Регистр учтён.
- **Последствие:** не удаляются: незнакомые verification-метатеги, `<meta name="robots">`/индексация
  (хотя ручной чек-лист говорит «убрать метатеги индексации»), `property=`-верификации (`fb:app_id`).
  Метатеги инертны (не исполняются) → влияние низкое; основной минус — утечка провенанса прежнего
  владельца (его google-site-verification) и расхождение с заявленным чек-листом.
- **Рекомендация:** свести список с ручным чек-листом (индексация/aria), добавить `property=`-ветку.
- **Уверенность:** подтверждено чтением кода + реестра.

### [2B-6] 🟢 Soundness · 🟩 Low · JSON-LD: узко и инертно

- **Сейчас:** удаляется JSON-LD только при `googletagmanager|google-analytics|gtm-` или схеме
  `WebSite`+`SearchAction` ([:8–11](src/mastra/cleaners/passes/html/remove-tracker-jsonld.ts:8)),
  по regex на тексте (не JSON-parse).
- **Последствие:** прочий JSON-LD остаётся (намеренно — это легитимная разметка). JSON-LD инертен,
  поэтому даже трекерные URL в нём не исполняются. Escaped/минифицированный `gtm-` мог бы ускользнуть.
- **Рекомендация:** оставить консервативным; низкий приоритет.
- **Уверенность:** подтверждено чтением кода.

---

## Сильные стороны

`object`/`frames` удаление и консервативный JSON-LD соответствуют ручному чек-листу владельца.
`embed` идёт через белый список, а не блок-лист. Претензии в основном к `remove-base` (потеря
контекста базы) и `meta-refresh` (относительный/закавыченный редирект).

## Пробелы в тестах

Нужны: 2B-1 (лендинг с `<base href>` + относительные пути → не должны ломаться), 2B-2 (relative и
закавыченный meta-refresh), 2B-5 (robots/`property=` метатеги).

## Итог

1. **2B-1** — `remove-base`: разрешать базу в пути (или сделать `normalize` base-aware), не удалять
   вслепую. Твой кейс — реальный, особенно для скачанных зеркал (T-7).
2. **2B-2 ✅** — `meta-refresh`: триммить/снимать кавычки и трактовать любой url-refresh как подозрительный.

---

## ✅ Статус фиксов

- **2B-2 ✅** — `removeMetaRefresh` снимает ЛЮБОЙ `<meta http-equiv="refresh">` (с url или таймер), а не
  только `isExternalUrl(url)`. Закрывает оба обхода: относительный (`url=offer.html` — клоакинг лендинг→
  оффер) и закавыченный (`url='https://evil'` — кавычка ломала `^https?://`), плюс protocol-relative.
  Под owner decision #1 (чужой/авто-редирект = действие) + #7 (трафик на оффер по клику, не автоматом).
  Оригинальный `content` (целевой URL) → карантин/отчёт (`META_REFRESH_REMOVED`) для ручной привязки к
  офферу. Тест: `remove-meta-refresh.test.ts` (8). **2B-1** — не трогали (base-aware normalize, отдельно).
