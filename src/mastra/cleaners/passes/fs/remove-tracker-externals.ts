import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyResource } from '../../utils/allowlist.js';
import { quarantineDir } from '../../utils/quarantine.js';
import type { QuarantineItem } from '../../types.js';

/**
 * Решает судьбу `_external/<host>/` по БЕЛОМУ СПИСКУ (а не блок-листу): чужой хост,
 * локализованный загрузчиком в `_external/`, прогоняется через `classifyResource`
 * как обычный внешний ресурс (EXT-1). Раньше удалялись только хосты из списка трекеров,
 * а неизвестный чужой хост «оставался локальным» и уезжал в прод.
 *
 * - доверенный одно-тенантный CDN (lib) → оставляем;
 * - известный трекер → удаляем;
 * - прочий чужой хост → карантин (перемещаем в `_quarantine/_external/<host>/`, не удаляем тихо).
 *
 * `kind: 'script'` — строжайший trust-set (только библиотечные CDN), т.к. содержимое чужое
 * и тип ресурсов в папке заранее неизвестен.
 *
 * AL-3: для МУЛЬТИТЕНАНТНЫХ CDN (jsdelivr/unpkg) `classifyResource('https://host/')` теперь
 * даёт quarantine (доверие зависит от ПУТИ, а на уровне папки `_external/<host>/` путь каждого
 * файла не верифицируем) → такой mirror уходит в карантин целиком. Безопасно и восстановимо.
 */
export async function removeTrackerExternals(
  siteDir: string,
  quarantine?: QuarantineItem[],
): Promise<number> {
  const externalDir = join(siteDir, '_external');
  let removed = 0;
  try {
    const entries = await readdir(externalDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const host = e.name.toLowerCase();
      const c = classifyResource(`https://${host}/`, 'script');
      if (c.action === 'keep') continue; // доверенный хост — оставляем локально

      const abs = join(externalDir, e.name);
      if (c.action === 'remove') {
        await rm(abs, { recursive: true, force: true }); // известный трекер
        removed++;
        continue;
      }

      // c.action === 'quarantine' — неизвестный чужой хост
      if (quarantine) {
        const ok = await quarantineDir(
          siteDir,
          abs,
          join('_external', e.name),
          quarantine,
          'external-host',
          `чужой хост в _external вне белого списка: ${host}`,
        );
        if (!ok) await rm(abs, { recursive: true, force: true });
      } else {
        await rm(abs, { recursive: true, force: true });
      }
      removed++;
    }
  } catch {
    // _external может не существовать — окей
  }
  return removed;
}
