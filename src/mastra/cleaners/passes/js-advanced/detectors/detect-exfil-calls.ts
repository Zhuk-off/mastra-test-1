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
  referencedGlobalName,
} from './helpers.js';

/** Сток с опасным `.src`: пиксель (Image/<img>) или динамический внешний `<script>`. */
type SrcSinkKind = 'image' | 'script';

interface ExfilBindings {
  /** Локальное имя → глобальная функция, которой оно присвоено (`const f = fetch`). DET-2. */
  fnAlias: Map<string, string>;
  /** Локальное имя → тип стока, если присвоен `new Image()` / `createElement('script'|'img')`. DET-2. */
  srcSinkVars: Map<string, SrcSinkKind>;
}

/**
 * Лёгкий data-flow (DET-2): собирает простые алиасы глобалов и переменные-стоки, чтобы
 * детект не обходился косвенностью `const f = fetch; f(evil)` или двухстрочным
 * `var img = new Image(); img.src = evil`. Без анализа областей видимости (этого
 * достаточно: судьбу всё равно решает внешний/обфусцированный URL — см. ниже).
 */
function collectExfilBindings(ast: Program): ExfilBindings {
  const fnAlias = new Map<string, string>();
  const srcSinkVars = new Map<string, SrcSinkKind>();

  const bind = (idNode: any, initNode: any): void => {
    if (idNode?.type !== 'Identifier' || !initNode) return;
    const name = idNode.name;
    const ref = referencedGlobalName(initNode);
    if (ref === 'fetch' || ref === 'WebSocket') {
      fnAlias.set(name, ref);
      return;
    }
    if (initNode.type === 'NewExpression' && isGlobalCallee(initNode.callee, 'Image')) {
      srcSinkVars.set(name, 'image');
      return;
    }
    if (initNode.type === 'CallExpression' && isMethodCallee(initNode.callee, 'document', 'createElement')) {
      const tag = extractStringArg(initNode.arguments[0])?.toLowerCase();
      if (tag === 'script') srcSinkVars.set(name, 'script');
      else if (tag === 'img') srcSinkVars.set(name, 'image');
    }
  };

  walk.simple(ast, {
    VariableDeclarator(n: any) {
      bind(n.id, n.init);
    },
    AssignmentExpression(n: any) {
      if (n.operator === '=' && n.left?.type === 'Identifier') bind(n.left, n.right);
    },
  });
  return { fnAlias, srcSinkVars };
}

/**
 * Тип стока с опасным `.src` по объекту присваивания `<obj>.src = url`: инлайн
 * `new Image()`, инлайн `document.createElement('script'|'img')`, либо переменная,
 * ранее связанная с одним из них (двухстрочные формы). DET-2.
 */
function srcAssignmentKind(objNode: any, srcSinkVars: Map<string, SrcSinkKind>): SrcSinkKind | null {
  if (!objNode) return null;
  if (objNode.type === 'NewExpression' && isGlobalCallee(objNode.callee, 'Image')) return 'image';
  if (objNode.type === 'CallExpression' && isMethodCallee(objNode.callee, 'document', 'createElement')) {
    const tag = extractStringArg(objNode.arguments[0])?.toLowerCase();
    if (tag === 'script') return 'script';
    if (tag === 'img') return 'image';
    return null;
  }
  if (objNode.type === 'Identifier') return srcSinkVars.get(objNode.name) ?? null;
  return null;
}

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
  const { fnAlias, srcSinkVars } = collectExfilBindings(ast);

  // callee — глобал fnName напрямую/через window, ИЛИ локальный алиас на него (DET-2).
  const callsGlobal = (callee: any, fnName: string): boolean =>
    isGlobalCallee(callee, fnName) ||
    (callee?.type === 'Identifier' && fnAlias.get(callee.name) === fnName);

  walk.simple(ast, {
    NewExpression(node: Node) {
      const n = node as any;
      const { source, mainHost } = ctx;
      // new WebSocket('wss://external...') / new window.WebSocket(...) / new WS(...) (alias)
      // DET-1: extractStringish резолвит склейку/template ('ws'+'s://evil'); опасный
      // декодер (atob/...) в аргументе → подозрительно даже без видимого URL.
      if (callsGlobal(n.callee, 'WebSocket')) {
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

      // fetch('https://external...') / window.fetch / window['fetch'] / f(...) (alias, DET-2)
      // DET-1: extractStringish резолвит склейку схемы по кускам ('htt'+'ps://evil') и
      // template-литералы; опасный декодер (atob/unescape/fromCharCode) в аргументе →
      // подозрительно даже без видимого URL. Голая переменная/относительный путь — нет.
      if (callsGlobal(n.callee, 'fetch')) {
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
      const { source, mainHost } = ctx;
      // <sink>.src = url, где <sink> — new Image() / createElement('script'|'img') / связанная
      // с ними переменная (DET-2: двухстрочные и инлайн формы). Пиксель (Image/img) или
      // динамический внешний <script>. DET-1: extractStringish резолвит склейку/template,
      // обфусцированный декодер в правой части → подозрительно.
      if (n.left?.type !== 'MemberExpression' || memberPropName(n.left) !== 'src') return;
      const kind = srcAssignmentKind(n.left.object, srcSinkVars);
      if (!kind) return;

      const url = extractStringish(n.right);
      let why: string | null = null;
      if (url && isExternalUrl(url, mainHost)) why = `внешний URL: ${url}`;
      else {
        const dec = obfuscatedDecoderIn(n.right);
        if (dec) why = `обфусцированный URL (${dec})`;
      }
      if (!why) return;

      const isScript = kind === 'script';
      results.push({
        line: posToLine(source, n.start),
        start: n.start,
        end: n.end,
        threatType: isScript ? 'exfil-script-src' : 'exfil-pixel',
        description: isScript
          ? `Динамический <script>.src на ${why}`
          : `Tracking pixel через .src — ${why}`,
        snippet: snippetAt(source, n.start, n.end),
        shouldRemove: true,
        node,
      });
    },
  });

  return results;
}
