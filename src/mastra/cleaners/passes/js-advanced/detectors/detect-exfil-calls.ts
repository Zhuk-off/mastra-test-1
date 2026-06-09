import * as walk from 'acorn-walk';
import type { Program, Node } from 'acorn';
import { SUSPICIOUS_CALL_GLOBALS } from '../../../registry/suspicious-globals.js';
import type { DetectionResult, DetectorContext } from '../ast/types.js';
import { posToLine, snippetAt } from '../ast/parse.js';
import {
  isExternalUrl,
  extractStringArg,
  extractStringish,
  obfuscatedDecoderIn,
  findInjectedExternalResource,
  isGlobalCallee,
  isMethodCallee,
  memberPropName,
} from './helpers.js';

/**
 * Имена, объявленные в файле (function/var/let/const/параметры) — это собственные
 * сущности сайта, а не внешние трекер-глобалы. Нужно, чтобы короткое имя вроде
 * `ga` (get attribute), `hj`, `ym` не приняли за трекер и не удалили (DEC-2).
 */
function collectLocalBindings(ast: Program): Set<string> {
  const names = new Set<string>();
  const addParams = (params: any[]) => {
    for (const p of params ?? []) if (p?.type === 'Identifier') names.add(p.name);
  };
  walk.simple(ast, {
    FunctionDeclaration(n: any) { if (n.id?.name) names.add(n.id.name); addParams(n.params); },
    FunctionExpression(n: any) { if (n.id?.name) names.add(n.id.name); addParams(n.params); },
    ArrowFunctionExpression(n: any) { addParams(n.params); },
    VariableDeclarator(n: any) { if (n.id?.type === 'Identifier') names.add(n.id.name); },
  });
  return names;
}

export function detectExfilCalls(
  ast: Program,
  ctx: DetectorContext,
): DetectionResult[] {
  const results: DetectionResult[] = [];
  const localBindings = collectLocalBindings(ast);

  walk.simple(ast, {
    NewExpression(node: Node) {
      const n = node as any;
      const { source, mainHost } = ctx;
      // new WebSocket('wss://external...') / new window.WebSocket(...)
      // DET-1: extractStringish резолвит склейку/template ('ws'+'s://evil'); опасный
      // декодер (atob/...) в аргументе → подозрительно даже без видимого URL.
      if (isGlobalCallee(n.callee, 'WebSocket')) {
        const raw = extractStringish(n.arguments[0]);
        const httpish = raw ? raw.replace('wss://', 'https://').replace('ws://', 'http://') : null;
        let description: string | null = null;
        if (raw && httpish && isExternalUrl(httpish, mainHost)) {
          description = `WebSocket на внешний хост: ${raw}`;
        } else {
          const dec = obfuscatedDecoderIn(n.arguments[0]);
          if (dec) description = `WebSocket с обфусцированным URL (${dec})`;
        }
        if (description) {
          results.push({
            line: posToLine(source, n.start),
            start: n.start,
            end: n.end,
            threatType: 'exfil-websocket',
            description,
            snippet: snippetAt(source, n.start, n.end),
            shouldRemove: true,
            node,
          });
        }
      }
    },

    CallExpression(node: Node) {
      const n = node as any;
      const { source, mainHost } = ctx;

      // fetch('https://external...') / window.fetch / window['fetch']
      // DET-1: extractStringish резолвит склейку схемы по кускам ('htt'+'ps://evil') и
      // template-литералы; опасный декодер (atob/unescape/fromCharCode) в аргументе →
      // подозрительно даже без видимого URL. Голая переменная/относительный путь — нет.
      if (isGlobalCallee(n.callee, 'fetch')) {
        const url = extractStringish(n.arguments[0]);
        let description: string | null = null;
        if (url && isExternalUrl(url, mainHost)) {
          description = `fetch() на внешний хост: ${url}`;
        } else {
          const dec = obfuscatedDecoderIn(n.arguments[0]);
          if (dec) description = `fetch() с обфусцированным URL (${dec})`;
        }
        if (description) {
          results.push({
            line: posToLine(source, n.start),
            start: n.start,
            end: n.end,
            threatType: 'exfil-fetch',
            description,
            snippet: snippetAt(source, n.start, n.end),
            shouldRemove: true,
            node,
          });
        }
      }

      // navigator.sendBeacon(url) / navigator['sendBeacon'] / window.navigator.sendBeacon
      if (isMethodCallee(n.callee, 'navigator', 'sendBeacon')) {
        const url = extractStringArg(n.arguments[0]);
        if (!url || isExternalUrl(url, mainHost)) {
          results.push({
            line: posToLine(source, n.start),
            start: n.start,
            end: n.end,
            threatType: 'exfil-beacon',
            description: `sendBeacon() на внешний хост`,
            snippet: snippetAt(source, n.start, n.end),
            shouldRemove: true,
            node,
          });
        }
      }

      // fbq(...), gtag(...), ym(...) и другие трекерные глобалы — но НЕ если имя
      // объявлено локально в файле (собственная функция сайта, DEC-2).
      if (
        n.callee?.type === 'Identifier' &&
        SUSPICIOUS_CALL_GLOBALS.has(n.callee.name) &&
        !localBindings.has(n.callee.name)
      ) {
        results.push({
          line: posToLine(source, n.start),
          start: n.start,
          end: n.end,
          threatType: 'tracker-call',
          description: `Вызов трекера: ${n.callee.name}(...)`,
          snippet: snippetAt(source, n.start, n.end),
          shouldRemove: true,
          node,
        });
      }

      // document.write/writeln('<script src="https://external.com/...">') + bracket-формы
      if (
        isMethodCallee(n.callee, 'document', 'write') ||
        isMethodCallee(n.callee, 'document', 'writeln')
      ) {
        const html = extractStringish(n.arguments[0]);
        const injected = html ? findInjectedExternalResource(html, mainHost) : null;
        if (injected) {
          results.push({
            line: posToLine(source, n.start),
            start: n.start,
            end: n.end,
            threatType: 'exfil-document-write',
            description: `document.write() инжектит внешний ${injected.tag}: ${injected.src}`,
            snippet: snippetAt(source, n.start, n.end),
            shouldRemove: true,
            node,
          });
        }
      }
    },

    AssignmentExpression(node: Node) {
      const n = node as any;
      // new Image().src = 'https://external.com/pixel'
      // DET-1: extractStringish резолвит склейку/template; декодер в правой части → подозрительно.
      if (
        n.left?.type === 'MemberExpression' &&
        memberPropName(n.left) === 'src' &&
        n.left.object?.type === 'NewExpression' &&
        isGlobalCallee(n.left.object?.callee, 'Image')
      ) {
        const url = extractStringish(n.right);
        let description: string | null = null;
        if (url && isExternalUrl(url, ctx.mainHost)) {
          description = `Tracking pixel через new Image().src`;
        } else {
          const dec = obfuscatedDecoderIn(n.right);
          if (dec) description = `Tracking pixel через new Image().src (обфусцированный URL: ${dec})`;
        }
        if (description) {
          results.push({
            line: posToLine(ctx.source, n.start),
            start: n.start,
            end: n.end,
            threatType: 'exfil-pixel',
            description,
            snippet: snippetAt(ctx.source, n.start, n.end),
            shouldRemove: true,
            node,
          });
        }
      }
    },
  });

  return results;
}
