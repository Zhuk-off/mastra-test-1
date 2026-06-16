import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  verifySiteRuntime,
  verifySite,
  DESKTOP_PROFILE,
  MOBILE_PROFILE,
} from '../verify-runtime.js';

// Интеграционные тесты: поднимают реальный headless Chromium.
// Покрывают: фикс «ложно-зелёного» verify (#3), мобильный профиль (#4),
// мультистраничность (#7) и визуальный diff против оригинала (#5).

const PAGE = (title: string) =>
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title></head>` +
  `<body><h1>${title}</h1><p>Только локальный контент, без чужих запросов.</p>` +
  `<a href="#form">Кнопка</a></body></html>`;

let dir: string;
let baseDir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'verify-rt-'));
  await writeFile(join(dir, 'index.html'), PAGE('Главная'), 'utf8');
  await writeFile(join(dir, 'about.html'), PAGE('О нас'), 'utf8');

  // Идентичный «оригинал» для визуального diff (расхождение должно быть ~0%).
  baseDir = await mkdtemp(join(tmpdir(), 'verify-base-'));
  await writeFile(join(baseDir, 'index.html'), PAGE('Главная'), 'utf8');
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(baseDir, { recursive: true, force: true });
});

describe('verifySiteRuntime (одна страница, один профиль)', () => {
  it('чистая локальная страница → loaded=true, нет чужих запросов, ok=true', async () => {
    const res = await verifySiteRuntime(dir);
    expect(res.loaded).toBe(true);
    expect(res.httpStatus).toBe(200);
    expect(res.foreignRequests).toEqual([]);
    expect(res.ok).toBe(true);
  }, 60_000);

  it('несуществующая страница (404) → loaded=false, ok=false (не ложно-зелёный)', async () => {
    const res = await verifySiteRuntime(dir, 'no-such-page.html');
    expect(res.loaded).toBe(false);
    expect(res.ok).toBe(false);
  }, 60_000);

  it('мобильный профиль работает → loaded=true, ok=true, profile=mobile', async () => {
    const res = await verifySiteRuntime(dir, 'index.html', { profile: MOBILE_PROFILE });
    expect(res.profile).toBe('mobile');
    expect(res.loaded).toBe(true);
    expect(res.ok).toBe(true);
  }, 60_000);
});

describe('verifySite (оркестратор: страницы × профили + visual diff)', () => {
  it('находит все HTML-страницы и прогоняет каждую → ok=true', async () => {
    const res = await verifySite(dir, { profiles: [DESKTOP_PROFILE] });
    expect(res.pages).toContain('index.html');
    expect(res.pages).toContain('about.html');
    expect(res.runs.length).toBe(res.pages.length); // 1 профиль × N страниц
    expect(res.ok).toBe(true);
    expect(res.foreignRequests).toEqual([]);
  }, 90_000);

  it('визуальный diff против идентичного оригинала → расхождение ~0%', async () => {
    const res = await verifySite(dir, {
      pages: ['index.html'],
      profiles: [DESKTOP_PROFILE],
      baselineDir: baseDir,
    });
    expect(res.maxVisualDiffPercent).not.toBeNull();
    expect(res.maxVisualDiffPercent!).toBeLessThan(5);
  }, 60_000);
});
