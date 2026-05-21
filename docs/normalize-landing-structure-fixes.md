# ТЗ: Исправление багов и улучшения в `normalize-landing-structure.ts`

**Файл:** `src/mastra/cleaners/utils/normalize-landing-structure.ts`
**Тесты:** `src/mastra/cleaners/utils/__tests__/normalize-landing-structure.test.ts`
**Тестовый раннер:** `vitest` (`npm test`)
**Уровень:** middle

---

## 0. Контекст

Утилита `normalizeLandingStructure(siteDir)` принимает директорию со скачанным сайтом (произвольной структуры) и приводит её к канонической форме:

- находит главный HTML/PHP-файл,
- кладёт его в корень `siteDir` под именем `index.html` (или `index.php`),
- сортирует ресурсы по подпапкам (`css/`, `js/`, `images/`, `fonts/`, `video/`, `audio/`, `assets/`),
- переписывает все ссылки в HTML и в перенесённых CSS-файлах так, чтобы сайт открывался из корня.

Запускается под Linux (Node.js ≥ 22.13), но код должен оставаться кросс-платформенным (Windows-разделители обрабатываются).

В коде уже есть фиксы Bug #1–#5 (см. комментарии в файле). Это ТЗ закрывает следующий пакет проблем (Bug #6 — Bug #16).

---

## 1. Общие требованияф

1. **Не ломать существующие тесты.** `npm test` должен проходить полностью после каждого фикса.
2. **TDD-подход.** Для каждого бага сначала пишется падающий тест в существующий test-файл, затем код-фикс, затем тест должен пройти.
3. **Стиль:** TypeScript strict, `import` с `.js` суффиксами (как уже принято в проекте), без новых зависимостей.
4. **Не менять публичный контракт** — экспорт `normalizeLandingStructure` и тип `NormalizeStats` сохранить (расширять можно, удалять/переименовывать поля — нельзя; см. п. 14 про исключение).
5. **Без `any` в новой логике.** Если нужен внешний тип — описать `interface`/`type`.
6. **Каждый фикс — отдельный коммит** с сообщением вида `fix(normalize): #6 PHP main file kept as .php`.
7. После всех фиксов запустить `npm run build` — должно собираться без ошибок.

### Локальные тестовые хелперы

Использовать уже существующие `setup`, `read`, `exists` из `__tests__/normalize-landing-structure.test.ts`. Не дублировать.

Если нужен новый хелпер (например, чтение бинарного файла) — добавить в тот же файл рядом с существующими.

---

## 2. Bug #6 — PHP main file переименовывается в `.html` и ломает сайт

### Симптом
Если `findMainFile` возвращает `index.php` (или иной `.php`), `normalizeLandingStructure` всё равно переименовывает его в `index.html`. Содержимое остаётся PHP — браузер показывает исходный код или сервер отдаёт битую страницу.

### Где
```
src/mastra/cleaners/utils/normalize-landing-structure.ts:292-296
```

```ts
const targetIndexPath = join(siteDir, 'index.html');
if (main.path !== targetIndexPath) {
  await rename(main.path, targetIndexPath);
  stats.mainFileRenamed = true;
}
```

Флаг `main.isPhp` уже вычисляется в `findMainFile`, но не используется.

### Требуемое поведение
- Если `main.isPhp === true` → целевой путь `join(siteDir, 'index.php')`.
- Иначе → `join(siteDir, 'index.html')`.
- В `NormalizeStats` добавить поле `mainFileExtension: 'html' | 'php'`. Заполнять всегда, когда `main` найден (по умолчанию `'html'`).
- Все дальнейшие операции с `targetIndexPath` (чтение, запись HTML) работают с этим путём независимо от расширения.

### Тест
Файл: `__tests__/normalize-landing-structure.test.ts`. Новый блок `describe('BUG #6 — PHP main file kept as .php', …)`:

1. **Кейс**: только `landing.php` в корне с `<link href="style.css">` и `style.css`.
   - Ожидание: создан `siteDir/index.php` (не `index.html`), `style.css` переехал в `css/`, в `index.php` ссылка переписана на `css/style.css`.
   - `stats.mainFileExtension === 'php'`, `stats.mainFileRenamed === true`.
2. **Кейс**: `index.php` уже в корне.
   - Ожидание: файл не переименовывается, `mainFileRenamed === false`, `mainFileExtension === 'php'`.
3. **Регресс**: обычный `index.html` в корне → `mainFileExtension === 'html'` (поле должно появиться без поломки старого поведения).

---

## 3. Bug #7 — `<source src="...">` для video/audio не собирается

### Симптом
HTML вида
```html
<video controls>
  <source src="video.mp4" type="video/mp4">
  <source src="video.webm" type="video/webm">
</video>
```
не обрабатывается: `video.mp4` и `video.webm` не переезжают в `video/`, ссылки не переписываются.

### Где
`collectResources`, массив `patterns`:
```
src/mastra/cleaners/utils/normalize-landing-structure.ts:216-227
```
Там есть только `<source srcset>`, но нет `<source src>`.

### Требуемое поведение
- Добавить паттерн `{ regex: /<source\b[^>]*?\bsrc\s*=\s*['"]([^'"]+)['"]/gi }` (без `isSrcset`).
- Все остальные шаги обработки (определение целевой папки, перенос, переписывание) должны работать без изменений.

### Тест
Новый блок `describe('BUG #7 — <source src> in <video>/<audio>', …)`:

1. HTML с `<video><source src="hero.mp4" type="video/mp4"><source src="hero.webm" type="video/webm"></video>` и пустые файлы `hero.mp4`, `hero.webm` в корне.
2. После запуска оба файла должны быть в `video/`, в HTML — `src="video/hero.mp4"` и `src="video/hero.webm"`.
3. Аналогичный кейс для `<audio>`: `track.mp3` → `audio/track.mp3`.

---

## 4. Bug #8 — URL-encoded пути не декодируются → ресурс молча теряется

### Симптом
HTML может содержать `<img src="моя%20картинка.png">`, а на диске файл называется `моя картинка.png`. Сейчас:
```
src/mastra/cleaners/utils/normalize-landing-structure.ts:240-247
```
- `fsUrl = 'моя%20картинка.png'`
- `resolve(baseDir, fsUrl)` → путь с `%20`
- `stat()` падает (файла с `%20` в имени нет)
- ресурс пропускается без ошибки.

То же касается `name%2Bfile.js` (`+`), кириллицы в `%D0…` и т.п.

### Где
- Сбор HTML-ресурсов: `collectResources`, до `stat`.
- Сбор CSS-ресурсов: блок CSS-rewrite (`urlRegex.exec(css)`), строка
  ```
  src/mastra/cleaners/utils/normalize-landing-structure.ts:347-353
  ```

### Требуемое поведение
1. Перед `resolve(baseDir, fsUrl)` декодировать:
   ```ts
   let fsPath = fsUrl;
   try { fsPath = decodeURIComponent(fsUrl); } catch { /* keep raw */ }
   const absolutePath = resolve(baseDir, fsPath);
   ```
2. Если `decodeURIComponent` падает (битый URL), использовать сырое значение и не выкидывать исключение.
3. **Важно:** при переписывании путей в HTML должна заменяться **именно та строка, что была в HTML** (`rawUrl`), а не декодированная. Уже так — но убедиться, что новый путь (`newRelativePath`) не содержит `%`, и в HTML просто заменяется сырой URL на чистый относительный путь без процент-кодирования.
4. Добавить хелпер на уровне модуля `decodePathSafe(url: string): string`, переиспользовать в HTML и CSS.

### Тест
Новый блок `describe('BUG #8 — percent-encoded URLs', …)`:

1. **Пробел через `%20`**: HTML `<img src="my%20logo.png">`, файл `my logo.png` (с пробелом). Ожидание: файл в `images/my logo.png`, в HTML `src="images/my logo.png"`.
2. **Кириллица**: HTML `<link rel="stylesheet" href="%D1%81%D1%82%D0%B8%D0%BB%D0%B8.css">`, файл `стили.css`. Ожидание: файл в `css/стили.css`, ссылка перезаписана на `css/стили.css`.
3. **Битая последовательность**: `<img src="bad%ZZ.png">` — функция не должна падать, ресурс просто пропускается (`stat` упадёт по сырому пути и это ок).
4. **CSS-кейс**: `style.css` содержит `url("bg%20img.jpg")`, файл `bg img.jpg` лежит рядом → после нормализации в `css/style.css` должно быть `url("../images/bg img.jpg")`.

---

## 5. Bug #9 — `isRelativeUrl` не отсекает произвольные URL-схемы

### Симптом
Функция перечисляет конкретные префиксы (`http://`, `https://`, `data:` и т.д.). Если в HTML появится `mailto:`, `tel:`, `blob:`, `ws:`, `chrome-extension:`, любой нестандартный URI — он будет считаться относительным и попадёт в `resolve(...)`. Тест BUG #5 сейчас проходит «по совпадению», потому что `<a href>` нет в паттернах сбора. Стоит добавить `<link rel="alternate" href="mailto:...">` или включить `<a>` — функция начнёт пытаться искать `mailto:foo@bar` на диске.

### Где
```
src/mastra/cleaners/utils/normalize-landing-structure.ts:114-129
```

### Требуемое поведение
Заменить набор `startsWith(...)` на одну общую проверку схемы URI плюс проверку абсолютного пути от корня:

```ts
function isRelativeUrl(url: string): boolean {
  if (!url) return false;
  // RFC 3986: scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )
  if (/^[a-z][a-z0-9+.\-]*:/i.test(url)) return false;
  if (url.startsWith('//')) return false; // protocol-relative
  if (url.startsWith('#')) return false;
  if (url.startsWith('/')) return false; // root-relative — мы не знаем root домена
  return true;
}
```

Это должно покрывать `http:`, `https:`, `data:`, `javascript:`, `mailto:`, `tel:`, `blob:`, `file:`, `ftp:`, `ws:`, `wss:`, `chrome-extension:` и любые будущие схемы.

### Тест
В существующий блок `BUG #5` или новый `BUG #9 — generic URI scheme detection`:

1. HTML с `<link rel="alternate" href="mailto:info@example.com">` + `<img src="logo.png">` + `logo.png` на диске.
   - Не должно быть попытки переместить или ресолвить `mailto:`.
   - `stats.filesMoved === 1` (только `logo.png`).
   - В HTML `mailto:` ссылка осталась нетронутой.
2. `<a href="javascript:void(0)">` (если когда-то добавят `<a>` в паттерны) — не должно ломаться. Пока тест может имитировать через `<link href="javascript:foo">`.
3. `<link href="//cdn.example.com/lib.js">` — оставить как есть, не пытаться обработать.

---

## 6. Bug #10 — `getTargetDir` слишком агрессивно угадывает по подстроке

### Симптом
Файл `picture.jpg.html` улетает в `images/`, потому что цикл «ищет любое известное расширение в имени файла» по подстроке. Это подкладывает ошибки на любых нестандартных именах.

### Где
```
src/mastra/cleaners/utils/normalize-landing-structure.ts:131-152
```

```ts
// Поиск любого известного расширения внутри имени файла
for (const [knownExt, dir] of Object.entries(EXT_TO_DIR)) {
  if (name.toLowerCase().includes(knownExt)) {
    return dir;
  }
}
```

### Требуемое поведение
1. Удалить блок substring-поиска полностью.
2. Логика остаётся:
   - Точный матч по `extname(filePath)`.
   - Если не найден — отрезать последнее расширение и взять предпоследнее (`extname(withoutLastExt)`). Это покрывает легитимные случаи `style.css.map`, `bundle.min.js.gz` и т.п.
   - Иначе → `assets`.
3. Поведение для `.css.map` остаётся прежним (попадает в `css/`).

### Тест
Новый блок `describe('BUG #10 — getTargetDir does not classify by substring', …)`:

1. HTML ссылается на `picture.jpg.html` (как iframe или просто файл, упомянутый в `<link>` с `as="document"`):
   - Ожидание: файл уходит в `assets/picture.jpg.html`, **не** в `images/`.
2. Файл `style.css.map`:
   - Ожидание: попадает в `css/style.css.map` (через предпоследнее расширение).
3. Файл `archive.tar.gz` (упомянутый, например, в `<a>` — но т.к. `<a>` не в паттернах, тест построить через `<link rel="alternate" href="archive.tar.gz">`):
   - Ожидание: `assets/archive.tar.gz` (последнее `.gz` неизвестно, предпоследнее `.tar` тоже нет → `assets`).

> Совет: в тест можно класть произвольное расширение в `<iframe src>` или `<link href>`, главное — проверить попадание в нужную папку.

---

## 7. Bug #11 — одинаковый URL дважды в одном `srcset` — переписывается только последний

### Симптом
HTML `<img srcset="logo.png 1x, logo.png 2x">`. Регулярка
```
src/mastra/cleaners/utils/normalize-landing-structure.ts:329-332
```
жадная: `[^"']*` затягивает префикс до **последнего** вхождения `logo.png`, заменяет только его. Первое `logo.png` остаётся.

Аналогично для `srcset="hero.webp 800w, hero.webp 1600w"`.

### Где
HTML-rewrite, обработка srcset:
```
src/mastra/cleaners/utils/normalize-landing-structure.ts:328-332
```

### Требуемое поведение
Перейти от регулярки к функциональной замене srcset:

1. Найти все `srcset="..."` (и одинарные кавычки) функцией:
   ```ts
   html = html.replace(/(\bsrcset\s*=\s*)(['"])([^'"]*)\2/gi, (full, prefix, quote, value) => {
     const rewritten = value
       .split(',')
       .map((entry) => {
         const trimmed = entry.trim();
         if (!trimmed) return entry;
         const [url, ...descriptor] = trimmed.split(/\s+/);
         const ref = resources.get(url);
         if (!ref) return entry;
         return [ref.newRelativePath, ...descriptor].join(' ');
       })
       .join(', ');
     return `${prefix}${quote}${rewritten}${quote}`;
   });
   ```
2. Эту замену выполнять **до** существующего цикла по `resources` (чтобы старые регулярки уже не видели srcset).
3. После такой замены текущая srcset-регулярка становится не нужна — удалить строки 328-332. Регулярка для `="..."` (HTML-атрибуты с одной URL внутри кавычек) и для `url(...)` остаются.
4. Учесть: значение в `srcset` может содержать запятые **внутри** descriptor-а у `image-set()` в CSS — но в HTML `srcset` запятая всегда разделитель. Это безопасно.

### Тест
Новый блок `describe('BUG #11 — same URL repeated in srcset', …)`:

1. HTML `<img srcset="logo.png 1x, logo.png 2x">` + файл `logo.png`.
   - Ожидание: после нормализации `srcset="images/logo.png 1x, images/logo.png 2x"` (оба вхождения переписаны).
2. HTML `<source srcset="hero.webp 800w, hero.webp 1600w">` + `hero.webp`.
   - Ожидание: оба переписаны на `images/hero.webp`.
3. Регресс: существующий тест BUG #1 (`logo.png 1x, logo@2x.png 2x`) должен продолжать проходить.

---

## 8. Bug #12 — `findMainFile` читает каждый HTML/PHP целиком в память

### Симптом
На сайтах с десятками HTML-страниц (например, многостраничные документации, зеркала) код читает каждый файл целиком только для скоринга. Плюс файл-победитель потом читается ещё раз в `collectResources`.

### Где
```
src/mastra/cleaners/utils/normalize-landing-structure.ts:75-112
```

### Требуемое поведение
1. Для скоринга читать **только первые 64 КБ** файла. Достаточно для оценки наличия `<title>`, `<h1>`, `<form>`, `{offer}`, плотности тегов.
   ```ts
   import { open } from 'node:fs/promises';
   async function readHead(file: string, bytes = 64 * 1024): Promise<string> {
     const fh = await open(file, 'r');
     try {
       const buf = Buffer.alloc(bytes);
       const { bytesRead } = await fh.read(buf, 0, bytes, 0);
       return buf.subarray(0, bytesRead).toString('utf8');
     } finally {
       await fh.close();
     }
   }
   ```
2. В `score += content.length / 200` использовать **реальный размер файла** через `stat().size` (а не длину прочитанной головы) — иначе скоринг занижается у больших файлов.
3. Защититься от переполнения: `score += Math.min(stat.size / 200, 100)` — клампим вклад длины.
4. Кэширование контента победителя **не делать** — главный HTML читается один раз в `collectResources` уже после `findMainFile`. Это нормально, оптимизация преждевременная.

### Тест
Регрессионный тест уже есть («picks index.html over other HTML files by score»). Дополнительно:

1. **Огромный мусорный HTML** — создать 200 КБ html-файла без признаков лендинга (`big.html`) рядом с `index.html` (короткий, с формой).
   - Ожидание: главным выбран `index.html`, не `big.html` (его скоринг должен быть ограничен клампом).
2. **Глубокий index** — корневой `landing.html` против вложенного `nested/index.html`.
   - Ожидание: `landing.html` (из-за бонуса за `index` в имени и штрафа за глубину). Это уже работает, но на новый код проверить регресс.

---

## 9. Bug #13 — `moveFileUnique`: TOCTOU между `stat` и `rename`

### Симптом
Между `stat(dest)` (вернул ENOENT) и `rename(src, dest)` сторонний процесс может создать `dest`. На Linux `rename` тогда **тихо перезапишет** созданный файл. В одном процессе сценарий теоретический, но в общем случае инструмент может запускаться параллельно над разными подкаталогами одного диска.

### Где
```
src/mastra/cleaners/utils/normalize-landing-structure.ts:158-199
```

### Требуемое поведение
Использовать атомарную последовательность через `link` + `unlink` (POSIX гарантирует EEXIST для `link`, если назначение уже есть):

```ts
import { link, unlink, copyFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';

async function moveFileUnique(src: string, destDir: string): Promise<string> {
  const name = basename(src);
  let counter = 0;
  while (true) {
    const candidate = counter === 0
      ? join(destDir, name)
      : join(destDir, suffix(name, counter));
    if (src === candidate) return candidate;
    try {
      await link(src, candidate);
      await unlink(src);
      return candidate;
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        counter++;
        if (counter > 100) throw new Error(`Too many collisions moving ${src}`);
        continue;
      }
      if (err.code === 'EXDEV') {
        // Cross-device — копируем с COPYFILE_EXCL и удаляем источник
        try {
          await copyFile(src, candidate, fsConstants.COPYFILE_EXCL);
          await unlink(src).catch(() => {});
          return candidate;
        } catch (copyErr: any) {
          if (copyErr.code === 'EEXIST') {
            counter++;
            if (counter > 100) throw new Error(`Too many collisions moving ${src}`);
            continue;
          }
          throw copyErr;
        }
      }
      throw err;
    }
  }
}

function suffix(name: string, counter: number): string {
  const ext = extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  return `${base}_${counter}${ext}`;
}
```

Важно:
- `link` атомарен и реально проверяет назначение (race-free).
- `unlink(src)` после `link` оставляет на диске только новый путь.
- При `EXDEV` (другой раздел) — `copyFile` с `COPYFILE_EXCL` (не перезаписывает), затем `unlink(src)`.
- Удалить старую логику с `stat → rename → catch` целиком.

### Тест
1. Существующий BUG #3 тест (`theme1/style.css` + `theme2/style.css`) должен продолжать работать.
2. Новый кейс: `index.html` ссылается на три файла с одинаковым именем из трёх разных папок (`a/x.png`, `b/x.png`, `c/x.png`) — все три должны выжить под именами `x.png`, `x_1.png`, `x_2.png`. Проверить, что HTML ссылается на три разных пути.
3. (Опционально) Юнит-тест на саму функцию `moveFileUnique` — потребует её экспорта (см. п. 16). Если решено не экспортировать — пропустить.

---

## 10. Bug #14 — пустые исходные директории не убираются

### Симптом
Если главный файл был `subdir/index.html`, а его ресурсы были `subdir/assets/x.png`, после нормализации остаются пустые `subdir/` и `subdir/assets/`. Не баг с точки зрения корректности, но мусор в корне сайта.

### Где
В `normalizeLandingStructure`, после переноса всех ресурсов:
```
src/mastra/cleaners/utils/normalize-landing-structure.ts:307-318
```

### Требуемое поведение
После переписывания HTML и CSS добавить шаг «удалить пустые директории внутри `siteDir`»:

```ts
async function removeEmptyDirs(root: string, dir: string): Promise<void> {
  if (dir === root) return;
  const { readdir, rmdir } = await import('node:fs/promises');
  let entries;
  try { entries = await readdir(dir); } catch { return; }
  for (const name of entries) {
    const full = join(dir, name);
    const st = await stat(full).catch(() => null);
    if (st?.isDirectory()) await removeEmptyDirs(root, full);
  }
  const remaining = await readdir(dir).catch(() => null);
  if (remaining && remaining.length === 0) {
    await rmdir(dir).catch(() => {});
  }
}
```

Запустить `removeEmptyDirs(siteDir, siteDir)` в самом конце `normalizeLandingStructure` (после CSS-rewrite, перед `return stats`).

Не удалять созданные нами директории-цели (`css/`, `js/`, ... остаются — даже если, теоретически, оказались пусты, это не страшно; обычно они не пусты, потому что что-то туда переехало).

### Тест
Новый блок `describe('BUG #14 — empty source directories cleaned up', …)`:

1. Структура: `subdir/index.html`, `subdir/css/style.css`. После нормализации: `index.html` и `css/style.css` в корне; директория `subdir/` **не должна существовать**.
2. Сложный кейс: `nested/sub/index.html`, `nested/sub/img/logo.png`. После: `index.html` и `images/logo.png` в корне; ни `nested/`, ни `nested/sub/`, ни `nested/sub/img/` не существуют.

---

## 11. Bug #15 — некорректное поле `mainFileRenamed`

### Симптом
Если файл `subdir/index.html` переезжает в `siteDir/index.html`, у него изменилось **местоположение**, а не имя. Поле `mainFileRenamed` называется некорректно.

### Где
`NormalizeStats` (строки 5-11) и присваивание (строки 293-295).

### Требуемое поведение
Это менее критичный косметический фикс. Сохранить обратную совместимость:

1. Добавить новое поле `mainFileMoved: boolean` (`true`, если путь изменился — переехал в корень и/или сменил имя).
2. Поле `mainFileRenamed` оставить, но заполнять его как «имя файла на диске поменялось» (`basename(main.path) !== basename(targetIndexPath)`).
   - Это даст более точную семантику и не сломает существующие тесты — где `subdir/index.html → index.html`, имя не меняется → теперь `mainFileRenamed === false`, `mainFileMoved === true`. **Внимание:** в текущем тесте BUG #2 проверяется `expect(stats.mainFileRenamed).toBe(true)`. Этот тест нужно поправить: ожидать `mainFileMoved === true`, `mainFileRenamed === false`.
3. Где имя реально меняется (PHP→PHP вряд ли, но HTM→HTML или landing.html→index.html) — `mainFileRenamed === true`.

> Документировать смысл полей в JSDoc-комментарии над `NormalizeStats`.

### Тест
1. Поправить ожидание в существующем `BUG #2 — main HTML in subdirectory`: `mainFileMoved: true, mainFileRenamed: false`.
2. Добавить кейс: `landing.htm` в корне → `index.html` в корне. Ожидание: `mainFileMoved === true`, `mainFileRenamed === true`.
3. Регресс: `index.html` уже в корне → оба поля `false`.

---

## 12. Bug #16 — статистика `pathsRewritten` неточна

### Симптом
`stats.pathsRewritten++` инкрементируется по факту «HTML изменился после конкретного `replace`», то есть считаются **ресурсы**, а не реальные **вхождения**. Название поля вводит в заблуждение.

### Где
```
src/mastra/cleaners/utils/normalize-landing-structure.ts:325-333
```

### Требуемое поведение
1. Переименование поля **не делать** (обратная совместимость). Оставить семантику «количество ресурсов, по которым были замены в HTML».
2. Добавить точный JSDoc над `NormalizeStats`:
   ```ts
   /**
    * pathsRewritten — количество ресурсов, по которым в HTML была сделана хотя бы одна замена.
    *                  Не путать с числом изменённых вхождений.
    * cssPathsRewritten — то же самое, но для CSS-файлов.
    */
   ```
3. (Опционально, если останется время) — добавить отдельные поля `htmlPathOccurrencesRewritten`, `cssPathOccurrencesRewritten`. Не обязательное требование.

### Тест
Регрессионный тест, фиксирующий текущую семантику:

1. HTML с одним `<img src="logo.png">` и `logo.png` на диске → `pathsRewritten === 1`.
2. HTML, в котором `logo.png` упоминается дважды (в `src` и `srcset`) → `pathsRewritten === 1` (один уникальный ресурс).
3. HTML с `logo.png` и `bg.png` → `pathsRewritten === 2`.

---

## 13. Порядок выполнения

Жёсткий порядок не обязателен, но рекомендуется такой (от меньшего количества правок к большему):

1. **Bug #6** — PHP main file (минимальная правка + новый тест-блок).
2. **Bug #7** — `<source src>` (один паттерн + тесты).
3. **Bug #9** — `isRelativeUrl` (рефакторинг функции + тесты).
4. **Bug #10** — `getTargetDir` (удаление substring-фолбека + тесты).
5. **Bug #8** — URL-decoding (затрагивает HTML и CSS пути).
6. **Bug #11** — srcset-replace (рефакторинг переписывания).
7. **Bug #16** — JSDoc на `NormalizeStats`.
8. **Bug #15** — добавить `mainFileMoved`, поправить `BUG #2` тест.
9. **Bug #12** — `findMainFile` оптимизация.
10. **Bug #13** — `moveFileUnique` через `link/unlink`.
11. **Bug #14** — очистка пустых директорий.

После каждого пункта: `npm test` зелёный, `npm run build` без ошибок.

---

## 14. Изменения публичного контракта `NormalizeStats`

В рамках этого ТЗ контракт расширяется новыми полями (без удаления существующих):

```ts
export interface NormalizeStats {
  mainFileFound: string;
  mainFileRenamed: boolean;
  /** Новое: главный файл сменил местоположение (переехал в корень). */
  mainFileMoved: boolean;
  /** Новое: расширение, под которым сохранён главный файл. */
  mainFileExtension: 'html' | 'php';
  filesMoved: number;
  /** Количество ресурсов, по которым в HTML сделана хотя бы одна замена. */
  pathsRewritten: number;
  /** Количество ресурсов, по которым в CSS сделана хотя бы одна замена. */
  cssPathsRewritten: number;
}
```

Все потребители функции (см. ниже) перепроверить на компиляцию.

### Потребители

```bash
grep -r "normalizeLandingStructure" src/ scripts/
```
- `scripts/clean-site.ts`
- регистрация в pipeline (`src/mastra/cleaners/passes/...` — проверить).

Если существующий код читает только старые поля — никаких правок. Если кто-то делает `Object.keys(stats)` или сравнения с фиксированной формой — обновить.

---

## 15. Acceptance criteria

- [ ] Все существующие тесты проходят (`npm test`) — включая BUG #1–#5.
- [ ] Для каждого из багов #6–#16 добавлен хотя бы один новый `it(…)` (а лучше блок `describe`).
- [ ] Все новые тесты — зелёные.
- [ ] `npm run build` проходит без ошибок и предупреждений.
- [ ] В исходнике не осталось закомментированного старого кода.
- [ ] В `normalize-landing-structure.ts` нет `any` в новых сигнатурах функций (исключение — `catch (err: any)` остаётся допустимым).
- [ ] JSDoc над `NormalizeStats` актуализирован.
- [ ] `scripts/clean-site.ts` прогоняется (`npm run clean -- <тестовая_директория>`) на одном реальном скачанном лендинге без падений.

---

## 16. Чего делать НЕ нужно

- **Не вводить парсеры HTML/CSS** (`parse5`, `cheerio`, `postcss`) — это отдельный рефакторинг, выходит за рамки ТЗ.
- **Не менять список `EXT_TO_DIR`**, кроме случаев, когда это требуется тестом из этого ТЗ.
- **Не менять `walkFiles`** (`utils/walk.ts`) — её тестируют другие пассы пайплайна.
- **Не экспортировать внутренние хелперы** (`getTargetDir`, `moveFileUnique`, `findMainFile`), если этого прямо не требует тест. Если очень удобно для теста — можно через паттерн «экспорт через `__test__` объект»:
  ```ts
  export const __test__ = { getTargetDir, moveFileUnique, isRelativeUrl };
  ```
  Только если без этого тест становится слишком интеграционным.
- **Не делать изменения в `pipeline.ts`/реестре**, если это не следствие изменения публичного контракта.

---

## 17. Подсказки и подводные камни

- **Vitest и временные директории.** Хелпер `setup` уже создаёт нужную структуру через `mkdtemp`. Не пытайтесь использовать абсолютные пути — все ассерты строятся относительно `tmp`.
- **Порядок ресурсов в `Map`.** Iteration order = insertion order. Если перепишите паттерны — учтите, что одни и те же URL могут быть зарегистрированы из разных тегов; используется `set(rawUrl, ref)` — последний выигрывает. Это ОК.
- **`relative()` на Linux** возвращает разделители `/`. В коде уже есть `.replace(/\\/g, '/')` для кросс-платформенности — сохраняйте этот паттерн.
- **`encodeURIComponent` обратно при записи** — **не делать**. В новый HTML записываем чистый путь (`images/моя картинка.png`). Браузер сам разрулит. Если у пользователя проблемы — это уже задача отдельного пасса, не нашего.
- **`findMainFile` и бинарные файлы.** Файл с расширением `.html`, но не текстовый, может уронить `readFile(file, 'utf8')` на невалидной последовательности. С чтением через буфер (`open + read`) этот риск меньше — `Buffer.toString('utf8')` заменяет битые байты на `U+FFFD` без исключения. Это хорошо.
- **Linux-специфика.** `link()` доступен и на Windows (NTFS), но в WSL/Linux работает гарантированно. Кросс-девайс на одном проекте — маловероятен (обычно один диск). Поэтому `EXDEV`-fallback всё ещё нужен, но он редкий путь.

---

## 18. Ссылки

- Файл: `src/mastra/cleaners/utils/normalize-landing-structure.ts`
- Тесты: `src/mastra/cleaners/utils/__tests__/normalize-landing-structure.test.ts`
- Хелпер обхода: `src/mastra/cleaners/utils/walk.ts`
- Пайплайн (контекст использования): `src/mastra/cleaners/pipeline.ts`
- CLI-вход: `scripts/clean-site.ts`
