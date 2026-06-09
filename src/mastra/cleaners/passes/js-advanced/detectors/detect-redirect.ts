import * as walk from 'acorn-walk';
import type { Program, Node } from 'acorn';
import type { DetectionResult, DetectorContext } from '../ast/types.js';
import { posToLine, snippetAt } from '../ast/parse.js';
import { isExternalUrl, extractStringArg, isLocationRef, memberPropName } from './helpers.js';

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

      // location = url | window.location = url | location.href = url | location['href'] = url
      // | top.location.href = url | self.location = url
      const isBareLocation = isLocationRef(left);
      const isHrefAssign =
        left?.type === 'MemberExpression' &&
        memberPropName(left) === 'href' &&
        isLocationRef(left.object);
      if (!isBareLocation && !isHrefAssign) return;

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
      // location.assign/replace(url) — в т.ч. window/top/self.location и bracket-формы
      const callee = n.callee;
      if (callee?.type !== 'MemberExpression') return;
      const method = memberPropName(callee);
      if (method !== 'assign' && method !== 'replace') return;
      if (!isLocationRef(callee.object)) return;

      const url = extractStringArg(n.arguments[0]);
      if (!url || !isExternalUrl(url, mainHost)) return;

      results.push({
        line: posToLine(source, n.start),
        start: n.start,
        end: n.end,
        threatType: 'redirect',
        description: `Редирект на внешний хост через location.${method}(): ${url}`,
        snippet: snippetAt(source, n.start, n.end),
        shouldRemove: false,
        node,
      });
    },
  });

  return results;
}
