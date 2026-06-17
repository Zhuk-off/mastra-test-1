import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanSite } from '../pipeline.js';

// PHP-1: серверный код/бэкдоры в .phtml/.inc/... должны вырезаться (owner decision #2).
//
// ВАЖНО — почему payload собирается ИЗ ФРАГМЕНТОВ, а не пишется литералом:
// литеральный PHP-вебшелл (функция исполнения + суперглобал) совпадает с сигнатурой
// антивируса (Microsoft Defender: Backdoor:PHP/Chopper / Remoteshell). Defender real-time
// сканирует файл при записи через \\wsl.localhost\ и КВАРАНТИНИТ его → тест исчезает с диска,
// прогон ломается. Сборка из фрагментов даёт тот же payload в рантайме (во временном файле),
// но БАЙТЫ этого исходника AV-сигнатуру не содержат. Поведение теста не меняется.
const OPEN = '<' + '?php';
const CLOSE = '?' + '>';
const FN_EXEC = 'ev' + 'al';
const SUPERGLOBAL = '$' + '_POST';
// .phtml: серверный блок с вебшелл-паттерном (для проверки и вырезания, и backdoor-флага).
const PHTML_SHELL =
  `<!doctype html><html><body><h1>Hi</h1>${OPEN} ${FN_EXEC}(${SUPERGLOBAL}["x"]); ${CLOSE}</body></html>`;
// .inc: достаточно ЛЮБОГО серверного тега — проверяем, что блок вырезается (без backdoor-сигнатуры).
const INC_SERVER = `${OPEN} echo "config"; ${CLOSE}`;

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'phppages-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const MAIN = '<!doctype html><html><head></head><body>main</body></html>';

describe('PHP-1 — серверные страницы помимо .php (phtml/inc) чистятся', () => {
  it('.phtml: серверный код + бэкдор вырезаются и флажатся', async () => {
    await writeFile(join(tmp, 'index.html'), MAIN, 'utf8');
    await writeFile(join(tmp, 'page.phtml'), PHTML_SHELL, 'utf8');

    const stats = await cleanSite(tmp, { runAdvanced: true });

    const out = await readFile(join(tmp, 'page.phtml'), 'utf8');
    expect(out).not.toContain(OPEN); // серверный блок вырезан (stripServerTags)
    expect(out).not.toContain(FN_EXEC + '('); // тело вебшелла не уехало в прод
    expect(stats.phpBackdoorWarning).toBe(true); // и просканирован/зафлажен
  });

  it('.inc с серверным кодом: блок вырезан', async () => {
    await writeFile(join(tmp, 'index.html'), MAIN, 'utf8');
    await writeFile(join(tmp, 'config.inc'), INC_SERVER, 'utf8');

    await cleanSite(tmp, { runAdvanced: true });

    const out = await readFile(join(tmp, 'config.inc'), 'utf8');
    expect(out).not.toContain(OPEN); // серверный код .inc вырезан, не уехал в прод
  });

  it('НЕ-регресс: .inc БЕЗ серверных тегов не трогается (не-HTML фрагмент)', async () => {
    await writeFile(join(tmp, 'index.html'), MAIN, 'utf8');
    const partial = '.btn { color: red; } /* css partial, not a server page */';
    await writeFile(join(tmp, 'styles.inc'), partial, 'utf8');

    await cleanSite(tmp, { runAdvanced: true });

    const out = await readFile(join(tmp, 'styles.inc'), 'utf8');
    expect(out).toBe(partial); // нетронут — не обёрнут cheerio
  });

  it('#1: бэкдор в .php флажится и в ОБЫЧНОМ (не advanced) прогоне', async () => {
    await writeFile(join(tmp, 'index.html'), MAIN, 'utf8');
    await writeFile(join(tmp, 'shell.php'), PHTML_SHELL, 'utf8');

    const stats = await cleanSite(tmp); // без runAdvanced — скан теперь работает всегда

    expect(stats.phpBackdoorWarning).toBe(true);
  });
});
