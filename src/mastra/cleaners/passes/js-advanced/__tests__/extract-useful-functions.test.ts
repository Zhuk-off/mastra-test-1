import { describe, it, expect } from 'vitest';
import { parseJs } from '../ast/parse.js';
import { extractUsefulFunctions } from '../extract-useful-functions.js';
import type { DetectorContext } from '../ast/types.js';
import type { ChangelogEntry } from '../../../types.js';

function run(source: string) {
  const ast = parseJs(source, 'test.js');
  if (!ast) throw new Error('Не удалось распарсить тестовый JS');
  const ctx: DetectorContext = { source, relPath: 'test.js', mainHost: 'example.com' };
  const log: ChangelogEntry[] = [];
  const result = extractUsefulFunctions(source, ast, ctx, log);
  return { ...result, log };
}

describe('extractUsefulFunctions — удаляемые функции', () => {
  it('удаляет FunctionDeclaration только с вызовом трекер-глобала', () => {
    const source = `function trackPageView() { fbq('track', 'PageView'); }`;
    const { code, removed, log } = run(source);

    expect(removed).toBe(1);
    expect(code.trim()).toBe('');
    expect(log[0]?.type).toBe('PARTIAL_JS_CLEAN');
    expect(log[0]?.description).toContain('trackPageView');
  });

  it('удаляет FunctionDeclaration с несколькими трекер-вызовами', () => {
    const source = `
function sendAnalytics() {
  fbq('track', 'Lead');
  gtag('event', 'conversion');
}`;
    const { code, removed } = run(source);
    expect(removed).toBe(1);
    expect(code.trim()).toBe('');
  });

  it('удаляет var с FunctionExpression только из трекер-вызовов', () => {
    const source = `var trackEvent = function() { fbq('track', 'Click'); };`;
    const { code, removed } = run(source);
    expect(removed).toBe(1);
    expect(code.trim()).toBe('');
  });

  it('удаляет treker-функцию и оставляет остальной код', () => {
    const source = `
var x = 1;
function trackPageView() { fbq('track', 'PageView'); }
var y = 2;`;
    const { code, removed } = run(source);
    expect(removed).toBe(1);
    expect(code).toContain('var x = 1');
    expect(code).toContain('var y = 2');
    expect(code).not.toContain('trackPageView');
  });
});

describe('extractUsefulFunctions — не удаляемые функции', () => {
  it('НЕ удаляет функцию со смешанной логикой (treker + бизнес-вызов)', () => {
    const source = `function trackAndSubmit(e) { fbq('track', e); submitForm(); }`;
    const { code, removed } = run(source);
    expect(removed).toBe(0);
    expect(code).toContain('trackAndSubmit');
  });

  it('НЕ удаляет функцию с DOM-операциями', () => {
    const source = `
function trackAndShow() {
  fbq('track', 'PageView');
  document.querySelector('.modal').style.display = 'block';
}`;
    const { code, removed } = run(source);
    expect(removed).toBe(0);
    expect(code).toContain('trackAndShow');
  });

  it('НЕ удаляет пустую функцию (нет вызовов)', () => {
    const source = `function noop() {}`;
    const { removed } = run(source);
    expect(removed).toBe(0);
  });

  it('НЕ удаляет функцию только с return (нет вызовов)', () => {
    const source = `function getX() { return 42; }`;
    const { removed } = run(source);
    expect(removed).toBe(0);
  });

  it('НЕ удаляет функцию если вызов не является трекером', () => {
    const source = `function showMenu() { document.getElementById('menu').style.display = 'block'; }`;
    const { removed } = run(source);
    expect(removed).toBe(0);
  });

  it('НЕ удаляет функцию с обычным API-вызовом (fetch на внутренний URL)', () => {
    const source = `function submit() { fetch('/api/contact', { method: 'POST' }); }`;
    const { removed } = run(source);
    expect(removed).toBe(0);
  });
});

describe('extractUsefulFunctions — EUF-1: reference-safe удаление', () => {
  it('pure-exfil функцию, которую ВЫЗЫВАЮТ, не удаляем целиком — обнуляем тело (символ жив)', () => {
    const source = [
      `function track(){ fbq('track','x'); }`,
      `document.addEventListener('click', track);`,
      `track();`,
    ].join('\n');
    const { code, removed } = run(source);

    expect(removed).toBe(1);
    expect(code).toContain('function track'); // символ сохранён → нет ReferenceError
    expect(code).not.toContain('fbq'); // exfil вырезан
    expect(code).toContain('addEventListener'); // место использования цело
    expect(code).toContain('track()'); // вызов цел
    expect(parseJs(code, 't.js')).not.toBeNull(); // валидный JS
  });

  it('pure-exfil функция БЕЗ ссылок — удаляется целиком (как раньше)', () => {
    const source = `function track(){ fbq('track','x'); }`;
    const { code, removed } = run(source);
    expect(removed).toBe(1);
    expect(code.trim()).toBe('');
  });
});

describe('extractUsefulFunctions — несколько функций', () => {
  it('удаляет только treker-функции, оставляя полезные', () => {
    const source = `
function initSlider() {
  fbq('track', 'View');
  swiper.init();
}

function trackPageView() {
  fbq('track', 'PageView');
}

function setupForm() {
  document.getElementById('form').addEventListener('submit', function(e) {
    e.preventDefault();
  });
}`;
    const { code, removed } = run(source);
    expect(removed).toBe(1);
    expect(code).toContain('initSlider');
    expect(code).not.toContain('trackPageView');
    expect(code).toContain('setupForm');
  });
});
