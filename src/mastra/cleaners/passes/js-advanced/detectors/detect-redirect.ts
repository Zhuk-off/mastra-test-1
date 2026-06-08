import * as walk from 'acorn-walk';
import type { Program, Node } from 'acorn';
import type { DetectionResult, DetectorContext } from '../ast/types.js';
import { posToLine, snippetAt } from '../ast/parse.js';
import { isExternalUrl, extractStringArg } from './helpers.js';

/**
 * Detects JS redirects to external URLs.
 * Patterns:
 *  - window.location = 'https://external...'
 *  - window.location.href = 'https://external...'
 *  - location.href = 'https://external...'
 *  - location.replace('https://external...')
 *  - window.location.replace('https://external...')
 *
 * shouldRemove is always false — WARN only.
 */
export function detectRedirect(ast: Program, ctx: DetectorContext): DetectionResult[] {
  const results: DetectionResult[] = [];
  const { source, mainHost } = ctx;

  walk.simple(ast, {
    AssignmentExpression(node: Node) {
      const n = node as any;
      const left = n.left;

      if (left?.type !== 'MemberExpression') return;

      const obj = left.object;
      const prop = left.property?.name as string | undefined;

      // window.location = '...' or location.href = '...' or window.location.href = '...'
      const isLocationAssign =
        (obj?.name === 'location' && (prop === 'href' || prop === 'replace')) ||
        (obj?.type === 'MemberExpression' &&
          obj.object?.name === 'window' &&
          obj.property?.name === 'location' &&
          (prop === 'href' || prop === 'replace')) ||
        (obj?.name === 'window' && prop === 'location');

      if (!isLocationAssign) return;

      const url = extractStringArg(n.right);
      if (!url || !isExternalUrl(url, mainHost)) return;

      results.push({
        line: posToLine(source, n.start),
        start: n.start,
        end: n.end,
        threatType: 'redirect',
        description: `Редирект на внешний хост: ${url}`,
        snippet: snippetAt(source, n.start, n.end),
        shouldRemove: false,
        node,
      });
    },

    CallExpression(node: Node) {
      const n = node as any;
      // location.replace('https://...') or window.location.replace('https://...')
      const callee = n.callee;
      if (callee?.type !== 'MemberExpression') return;
      if (callee.property?.name !== 'replace') return;

      const obj = callee.object;
      const isLocationReplace =
        obj?.name === 'location' ||
        (obj?.type === 'MemberExpression' &&
          obj.object?.name === 'window' &&
          obj.property?.name === 'location');

      if (!isLocationReplace) return;

      const url = extractStringArg(n.arguments[0]);
      if (!url || !isExternalUrl(url, mainHost)) return;

      results.push({
        line: posToLine(source, n.start),
        start: n.start,
        end: n.end,
        threatType: 'redirect',
        description: `Редирект на внешний хост через location.replace(): ${url}`,
        snippet: snippetAt(source, n.start, n.end),
        shouldRemove: false,
        node,
      });
    },
  });

  return results;
}
