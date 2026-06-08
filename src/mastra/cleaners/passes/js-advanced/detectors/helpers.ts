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

/** Глобальные алиасы window для member-форм (`window.fetch`, `self.fetch`, …). */
const GLOBAL_OBJECTS = new Set(['window', 'self', 'globalThis']);

/** Имя свойства member-выражения, поддерживая и `.foo`, и `['foo']`. */
export function memberPropName(member: any): string | null {
  if (!member || member.type !== 'MemberExpression') return null;
  const p = member.property;
  if (!member.computed && p?.type === 'Identifier') return p.name ?? null;
  if (member.computed && p?.type === 'Literal' && typeof p.value === 'string') return p.value;
  return null;
}

/**
 * callee вызывает глобальную функцию `fnName` напрямую (`fetch`), через глобальный
 * объект (`window.fetch`, `self.fetch`, `globalThis.fetch`) или bracket-формой
 * (`window['fetch']`). Закрывает member/bracket-обходы (DET-2).
 */
export function isGlobalCallee(callee: any, fnName: string): boolean {
  if (!callee) return false;
  if (callee.type === 'Identifier') return callee.name === fnName;
  if (callee.type === 'MemberExpression') {
    const obj = callee.object;
    if (obj?.type === 'Identifier' && GLOBAL_OBJECTS.has(obj.name)) {
      return memberPropName(callee) === fnName;
    }
  }
  return false;
}

/**
 * callee вызывает метод `objName.method`: `navigator.sendBeacon`,
 * `navigator['sendBeacon']`, `document.write`, `document['write']`, а также через
 * глобал (`window.navigator.sendBeacon`, `window.document.write`).
 */
export function isMethodCallee(callee: any, objName: string, method: string): boolean {
  if (!callee || callee.type !== 'MemberExpression') return false;
  if (memberPropName(callee) !== method) return false;
  const obj = callee.object;
  if (obj?.type === 'Identifier' && obj.name === objName) return true;
  if (
    obj?.type === 'MemberExpression' &&
    obj.object?.type === 'Identifier' &&
    GLOBAL_OBJECTS.has(obj.object.name) &&
    memberPropName(obj) === objName
  ) {
    return true;
  }
  return false;
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
