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
