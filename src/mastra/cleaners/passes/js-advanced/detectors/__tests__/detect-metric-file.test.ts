import { describe, it, expect } from 'vitest';
import { parseJs } from '../../ast/parse.js';
import { detectMetricFile } from '../detect-metric-file.js';

const FBEVENTS_LIKE = `
!function(f,b,e,v,n,t,s){
  if(f.fbq)return;n=f.fbq=function(){};
  f._fbq=n;
}(window);
window.fbq = window.fbq || function(){};
window.fbq('init','123456');
window.fbq('track','PageView');
`;

const USEFUL_JS = `
window.fbq = function(){};  // трекер есть
document.addEventListener('click', function() { /* полезно */ });
`;

const WITH_EXPORT = `
window.fbq = function(){};
export default { init: () => {} };
`;

describe('detectMetricFile', () => {
  it('детектирует чистый метрик-файл', () => {
    const ast = parseJs(FBEVENTS_LIKE, 'test.js');
    expect(ast).not.toBeNull();
    const result = detectMetricFile(ast!, FBEVENTS_LIKE);
    expect(result.isMetricFile).toBe(true);
    expect(result.reason).toBe('Только трекерный глобал, без полезного кода');
  });

  it('НЕ детектирует файл с полезным кодом', () => {
    const ast = parseJs(USEFUL_JS, 'test.js');
    expect(ast).not.toBeNull();
    const result = detectMetricFile(ast!, USEFUL_JS);
    expect(result.isMetricFile).toBe(false);
  });

  it('НЕ детектирует файл с export', () => {
    const ast = parseJs(WITH_EXPORT, 'test.js');
    expect(ast).not.toBeNull();
    const result = detectMetricFile(ast!, WITH_EXPORT);
    expect(result.isMetricFile).toBe(false);
  });

  it('НЕ детектирует обычный JS без трекеров', () => {
    const source = 'document.addEventListener("click", function(){});';
    const ast = parseJs(source, 'test.js');
    expect(ast).not.toBeNull();
    const result = detectMetricFile(ast!, source);
    expect(result.isMetricFile).toBe(false);
  });
});
