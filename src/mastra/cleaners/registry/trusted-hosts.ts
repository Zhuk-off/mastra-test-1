/**
 * Доверенные хосты. Источник правды — policy.ts (allowlist).
 * Этот файл оставлен для обратной совместимости: isExternalUrl/isTrustedHost
 * исторически импортируют TRUSTED_HOSTS отсюда.
 */
import { ALL_TRUSTED_HOSTS } from './policy.js';

/** Доверенные хосты — их внешние URL не считаются угрозой. */
export const TRUSTED_HOSTS = ALL_TRUSTED_HOSTS;

/** Проверяет, является ли хост (или его родитель) доверенным */
export function isTrustedHost(host: string): boolean {
  if (TRUSTED_HOSTS.has(host)) return true;
  for (const trusted of TRUSTED_HOSTS) {
    if (host.endsWith('.' + trusted)) return true;
  }
  return false;
}
