/**
 * Общие помощники детекторов (раньше дублировались в exfil/redirect/docwrite).
 */
import { isTrustedHost } from '../../../registry/trusted-hosts.js';

/**
 * Внешний ли URL относительно лендинга — единый источник правды для детекторов.
 *
 * Раньше было 3 копии, каждая через `new URL(url)` БЕЗ базы: протокол-относительный
 * `//evil.com/steal` бросал исключение → `catch` → считался НЕ внешним → обход
 * (DET-3). Здесь:
 *  - относительный путь (`x.js`, `/api`) → НЕ внешний (свой сайт);
 *  - `//host`, `https://host`, `wss://host`, … → внешний, если host не trusted и
 *    не совпадает с mainHost (и не его поддомен).
 *
 * База `https://<mainHost>` нужна, чтобы корректно разрешать `//host` и при этом
 * НЕ считать относительные пути внешними (их host совпал бы с mainHost).
 */
export function isExternalUrl(url: string, mainHost: string): boolean {
  const trimmed = url.trim();
  const isAbsolute = /^[a-z][a-z0-9+.\-]*:/i.test(trimmed) || trimmed.startsWith('//');
  if (!isAbsolute) return false; // относительный/путь — свой сайт
  let host: string;
  try {
    host = new URL(trimmed, `https://${mainHost || 'site.invalid'}`).hostname;
  } catch {
    return false;
  }
  if (!host) return false; // напр. data:/blob: без хоста
  if (isTrustedHost(host)) return false;
  if (mainHost && (host === mainHost || host.endsWith('.' + mainHost))) return false;
  return true;
}

/** Строковое значение узла-аргумента, если это строковый литерал; иначе null. */
export function extractStringArg(node: unknown): string | null {
  if (
    node &&
    typeof node === 'object' &&
    (node as { type?: string }).type === 'Literal' &&
    typeof (node as { value?: unknown }).value === 'string'
  ) {
    return (node as { value: string }).value;
  }
  return null;
}
