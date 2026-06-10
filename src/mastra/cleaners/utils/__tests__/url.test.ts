import { describe, it, expect } from 'vitest';
import { extractHostname, isExternalUrl } from '../url.js';

describe('extractHostname — хост только у абсолютных/протокол-относительных (URL-1)', () => {
  it('абсолютный http(s) → хост', () => {
    expect(extractHostname('https://evil.com/x.js')).toBe('evil.com');
    expect(extractHostname('http://Sub.Example.COM/a')).toBe('sub.example.com'); // нижний регистр
  });

  it('протокол-относительный //host → хост', () => {
    expect(extractHostname('//cdn.example.net/a.js')).toBe('cdn.example.net');
  });

  it('ведущие пробелы у абсолютного URL обрезаются (как в браузере)', () => {
    expect(extractHostname('   https://evil.com/x')).toBe('evil.com');
  });

  // ── URL-1: относительный путь больше НЕ выдаёт хост базы (example.com) ──
  it('относительный путь → null (а не example.com)', () => {
    expect(extractHostname('js/app.js')).toBeNull();
    expect(extractHostname('../a/b.js')).toBeNull();
    expect(extractHostname('/assets/main.css')).toBeNull();
  });

  it('фрагмент/без authority схемы → null', () => {
    expect(extractHostname('#top')).toBeNull();
    expect(extractHostname('mailto:hi@example.com')).toBeNull();
    expect(extractHostname('data:text/html,x')).toBeNull();
    expect(extractHostname('')).toBeNull();
  });
});

describe('isExternalUrl — относительные не внешние, абсолютные чужие — внешние', () => {
  it('относительный путь НЕ внешний', () => {
    expect(isExternalUrl('js/app.js')).toBe(false);
    expect(isExternalUrl('/assets/x.png')).toBe(false);
  });
  it('абсолютный чужой хост — внешний', () => {
    expect(isExternalUrl('https://evil.com/x')).toBe(true);
    expect(isExternalUrl('//evil.com/x')).toBe(true);
  });
});
