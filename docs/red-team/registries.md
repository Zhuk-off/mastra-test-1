# Red Team: реестры (collective)

Файлы-данные в `cleaners/registry/`: `policy`, `trusted-hosts`, `tracker-hosts`, `tracker-filenames`,
`tracker-keywords`, `meta-names`, `event-attrs`, `known-libs`, `cdn-libraries`, `suspicious-globals`,
`offer-patterns`, `js-warning-patterns`. Это **данные, не логика** — поэтому разобраны в анализах их
потребителей. Здесь — сквозная посадка.

## Главный принцип (и где он держится / где нет)

**Дизайн:** трекер/CDN-списки — это «удобство, не граница безопасности». Граница — белый список
(`classifyResource`, default-deny). Поэтому **FN в трекер-списке безопасен**: незнакомый внешний
ресурс не «пропускается», а уходит в **карантин**.

**Где принцип НЕ держится** (реестр работает как блок-лист **в обход** allowlist → FN = угроза
выживает): preconnect/preload ([2A-3](2a-allowlist-src.md)), `<noscript>` ([2A-4](2a-allowlist-src.md)),
inline-`<script>` ([2A-5](2a-allowlist-src.md)), CSS `url()` ([CSS-1](4-css-svg-php-fs.md)),
`_external/` удаление ([EXT-1](4-css-svg-php-fs.md)). → **рекомендация C6**: пропускать эти места
через `classifyResource`, а не через голый блок-лист.

## Реестр-специфичные находки (сводка, детали — у потребителей)

| ID | Реестр | Суть | Где разобрано |
|----|--------|------|---------------|
| REG-1 | suspicious-globals / detect-metric-file | Короткие имена `ga`/`hj`/`zE`/`ym` → FP при **remove/delete** (это destructive, не quarantine) | [DEC-2](3c-detectors.md), MET-3 |
| REG-2 | event-attrs | Нет touch/pointer/wheel/clipboard/history — mobile-векторы не проверяются | [2D-3](2d-defensive.md) |
| REG-3 | meta-names | Узкий список verification; нет robots/индексации, `property=` | [2B-5](2b-structural.md) |
| REG-4 | trusted-hosts vs policy | Два смысла «доверенного» (`ALL_TRUSTED_HOSTS` для всех типов vs per-kind в classify) | [URL-2](url.md) |
| REG-5 | cdn-libraries / known-libs | Извлечение версии из первого токена URL; 4КБ-окно сигнатуры | [CDN-3](cdn-detector.md), [UCDN-3](unversioned-cdn.md) |
| REG-6 | все | Ручное ведение, рост «реактивно»; нет процесса обновления под новых вендоров | — (операционное) |

## Заметки

- `OWN_MACROS` — правильный явный allowlist (не регулярка) → меньше шанс принять чужой токен за свой
  ([POL-4](policy.md) — лишь регистрозависимость).
- Списки `TRACKER_*` полны для топ-вендоров; FN тут безопасен **там, где работает allowlist** (см.
  принцип выше).

## Итог

Реестры сами по себе низкорисковы — ключевое не «дополнить списки», а **C6**: не использовать их как
блок-лист в обход белого списка (preconnect/noscript/CSS/inline), и **REG-1** — короткие имена не
должны вести к destructive-удалению без доп. сигнатуры.
