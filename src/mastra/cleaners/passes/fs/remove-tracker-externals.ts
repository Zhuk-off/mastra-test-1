import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { TRACKER_HOSTS } from '../../registry/tracker-hosts.js';
import { hostMatches } from '../../utils/url.js';

export async function removeTrackerExternals(siteDir: string): Promise<number> {
  const externalDir = join(siteDir, '_external');
  let removed = 0;
  try {
    const entries = await readdir(externalDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const host = e.name.toLowerCase();
      // Строгое совпадение по хосту/поддомену.
      const matches = TRACKER_HOSTS.some((t) => {
        if (t.includes('/')) return false; // путевые спички не соответствуют имени папки
        return hostMatches(host, t);
      });
      if (matches) {
        await rm(join(externalDir, e.name), { recursive: true, force: true });
        removed++;
      }
    }
  } catch {
    // _external может не существовать — окей
  }
  return removed;
}
