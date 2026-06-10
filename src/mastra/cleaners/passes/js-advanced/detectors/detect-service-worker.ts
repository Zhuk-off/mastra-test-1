import * as walk from 'acorn-walk';
import type { Program, Node } from 'acorn';
import type { DetectionResult, DetectorContext } from '../ast/types.js';
import { posToLine, snippetAt } from '../ast/parse.js';
import { memberPropName } from './helpers.js';

/** Глобальные объекты, на которых может висеть `navigator` (`window.navigator`, …). */
const GLOBALS = new Set(['window', 'self', 'globalThis']);

/**
 * Узел ссылается на объект `navigator.serviceWorker`:
 *  - `navigator.serviceWorker` / `navigator['serviceWorker']` (вкл. optional `?.`);
 *  - `window.navigator.serviceWorker` / `self.navigator…`;
 *  - локальный алиас (имя из `aliases`, см. collectSwAliases) — SW-2.
 * memberPropName покрывает и `.serviceWorker`, и `['serviceWorker']`, и optional-формы
 * (acorn оставляет тип MemberExpression при `?.`).
 */
function isServiceWorkerObject(node: any, aliases: Set<string>): boolean {
  if (!node) return false;
  if (node.type === 'Identifier') return aliases.has(node.name);
  if (node.type === 'MemberExpression') {
    if (memberPropName(node) !== 'serviceWorker') return false;
    const obj = node.object;
    if (obj?.type === 'Identifier') return obj.name === 'navigator';
    // window.navigator.serviceWorker / self.navigator.serviceWorker
    if (obj?.type === 'MemberExpression') {
      return (
        memberPropName(obj) === 'navigator' &&
        obj.object?.type === 'Identifier' &&
        GLOBALS.has(obj.object.name)
      );
    }
  }
  return false;
}

/**
 * Простые алиасы `x = navigator.serviceWorker` (SW-2: `const sw = navigator.serviceWorker;
 * sw.register(...)`). Без анализа областей видимости — достаточно, чтобы поймать прямую
 * привязку (как collectExfilBindings в detect-exfil-calls).
 */
function collectSwAliases(ast: Program): Set<string> {
  const aliases = new Set<string>();
  const empty = new Set<string>();
  const bind = (idNode: any, initNode: any): void => {
    if (idNode?.type === 'Identifier' && isServiceWorkerObject(initNode, empty)) aliases.add(idNode.name);
  };
  walk.simple(ast, {
    VariableDeclarator(n: any) {
      bind(n.id, n.init);
    },
    AssignmentExpression(n: any) {
      if (n.operator === '=' && n.left?.type === 'Identifier') bind(n.left, n.right);
    },
  });
  return aliases;
}

/**
 * Detects `navigator.serviceWorker.register(...)` (SW-1/SW-2): литеральная, bracket-,
 * optional-chaining- и алиас-формы. Service worker из СКОПИРОВАННОГО статического лендинга
 * не имеет своего push-бэкенда и не нужен → удаляем.
 *
 * shouldRemove:true; reference-safe нейтрализация (neutralizeDetections) корректно режет
 * вложенные скобки `register(getURL())`, где старый regex (`[^)]*` стопился на первой `)`)
 * оставлял `);` и ломал JS (SW-1).
 */
export function detectServiceWorker(ast: Program, ctx: DetectorContext): DetectionResult[] {
  const results: DetectionResult[] = [];
  const { source } = ctx;
  const aliases = collectSwAliases(ast);

  walk.simple(ast, {
    CallExpression(node: Node) {
      const n = node as any;
      const callee = n.callee;
      if (callee?.type !== 'MemberExpression') return;
      if (memberPropName(callee) !== 'register') return;
      if (!isServiceWorkerObject(callee.object, aliases)) return;
      results.push({
        line: posToLine(source, n.start),
        start: n.start,
        end: n.end,
        threatType: 'service-worker',
        description: 'Service worker register() удалён (скопированный лендинг без push-бэкенда)',
        snippet: snippetAt(source, n.start, n.end),
        shouldRemove: true,
        node,
      });
    },
  });

  return results;
}
