import * as walk from 'acorn-walk';
import type { Program, Node } from 'acorn';
import type { DetectionResult } from '../ast/types.js';
import { posToLine, snippetAt } from '../ast/parse.js';

const KEY_EVENTS = new Set(['keydown', 'keypress', 'keyup', 'input']);

const NETWORK_CALL_NAMES = new Set([
  'fetch', 'sendBeacon', 'XMLHttpRequest', 'open',
]);

/** Returns true if the AST node is a network-related call */
function containsNetworkCall(node: Node): boolean {
  let found = false;
  walk.simple(node, {
    CallExpression(n: Node) {
      const cn = n as any;
      // fetch(...) or sendBeacon(...)
      if (cn.callee?.name && NETWORK_CALL_NAMES.has(cn.callee.name)) {
        found = true;
      }
      // navigator.sendBeacon(...)
      if (
        cn.callee?.type === 'MemberExpression' &&
        cn.callee.object?.name === 'navigator' &&
        cn.callee.property?.name === 'sendBeacon'
      ) {
        found = true;
      }
      // xhr.open(...) / xhr.send(...)
      if (
        cn.callee?.type === 'MemberExpression' &&
        (cn.callee.property?.name === 'open' || cn.callee.property?.name === 'send')
      ) {
        found = true;
      }
    },
    NewExpression(n: Node) {
      const cn = n as any;
      // new XMLHttpRequest()
      if (cn.callee?.name === 'XMLHttpRequest') {
        found = true;
      }
    },
  });
  return found;
}

/**
 * Detects keylogger-like patterns:
 * addEventListener('keydown'|'keypress'|'input', function() { ...<network call>... })
 *
 * shouldRemove is always false — this is a WARN-only detector.
 */
export function detectKeylogger(ast: Program, source: string): DetectionResult[] {
  const results: DetectionResult[] = [];

  walk.simple(ast, {
    CallExpression(node: Node) {
      const n = node as any;

      // addEventListener('keydown', callback) or element.addEventListener(...)
      const isAddEventListener =
        n.callee?.name === 'addEventListener' ||
        (n.callee?.type === 'MemberExpression' &&
          n.callee.property?.name === 'addEventListener');

      if (!isAddEventListener) return;
      if (n.arguments.length < 2) return;

      const eventArg = n.arguments[0];
      const eventName: string | null =
        eventArg?.type === 'Literal' && typeof eventArg.value === 'string'
          ? eventArg.value
          : null;

      if (!eventName || !KEY_EVENTS.has(eventName)) return;

      const callback = n.arguments[1] as Node;
      if (!callback) return;

      if (containsNetworkCall(callback)) {
        results.push({
          line: posToLine(source, n.start),
          start: n.start,
          end: n.end,
          threatType: 'keylogger',
          description: `Подозрительный keylogger: addEventListener('${eventName}', ...) + сетевой вызов внутри`,
          snippet: snippetAt(source, n.start, n.end),
          shouldRemove: false,
          node,
        });
      }
    },
  });

  return results;
}
