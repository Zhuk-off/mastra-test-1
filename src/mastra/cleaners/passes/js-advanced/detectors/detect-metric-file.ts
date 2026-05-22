import * as walk from 'acorn-walk';
import type { Program, Node } from 'acorn';

/** Глобалы-трекеры, присвоение которых = сигнатура метрик-файла */
const METRIC_GLOBALS = new Set([
  'fbq', 'dataLayer', 'gtag', 'ym', '_paq', '_gaq',
  'mixpanel', 'amplitude', 'clarity', '_hsq', 'heap',
  'Intercom', 'zE', 'hj', 'hjid',
]);

const USEFUL_PATTERNS = [
  // Признаки полезного кода
  'addEventListener',
  'querySelector',
  'getElementById',
  'getElementsBy',
  'module.exports',
];

export interface MetricFileCheck {
  isMetricFile: boolean;
  reason: string;
}

export function detectMetricFile(ast: Program, source: string): MetricFileCheck {
  let hasMetricGlobal = false;
  let hasExport = false;
  let hasUsefulCode = false;

  // Ищем присвоение window.X = ... где X — метрик-глобал
  walk.simple(ast, {
    AssignmentExpression(node: Node) {
      const n = node as any;
      if (
        n.left?.type === 'MemberExpression' &&
        n.left.object?.name === 'window' &&
        METRIC_GLOBALS.has(n.left.property?.name)
      ) {
        hasMetricGlobal = true;
      }
      // window.fbq = window.fbq || function(){...}
      if (n.left?.name && METRIC_GLOBALS.has(n.left.name)) {
        hasMetricGlobal = true;
      }
    },
    ExportDefaultDeclaration() { hasExport = true; },
    ExportNamedDeclaration() { hasExport = true; },
  });

  // Грубая проверка полезных паттернов через текст (быстро)
  for (const pat of USEFUL_PATTERNS) {
    if (source.includes(pat)) {
      hasUsefulCode = true;
      break;
    }
  }

  if (hasMetricGlobal && !hasExport && !hasUsefulCode) {
    return { isMetricFile: true, reason: 'Только трекерный глобал, без полезного кода' };
  }
  return { isMetricFile: false, reason: '' };
}
