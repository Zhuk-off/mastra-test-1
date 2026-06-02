import { describe, it, expect } from 'vitest';
import { identifyLibrary, genericCdnRepin } from '../cdn-detector.js';

describe('identifyLibrary — распознавание библиотек по URL', () => {
  it('фейковый CDN с версией в пути → jquery, репин на code.jquery.com', () => {
    const id = identifyLibrary('https://jsdeliveris.com/ajax/libs/jquery/3.6.1/jquery.js');
    expect(id?.lib.name).toBe('jquery');
    expect(id?.version).toBe('3.6.1');
    expect(id?.cdnUrl).toBe('https://code.jquery.com/jquery-3.6.1.min.js');
  });

  it('локальный jquery с версией в имени', () => {
    const id = identifyLibrary('js/jquery-3.5.1.min.js');
    expect(id?.lib.name).toBe('jquery');
    expect(id?.version).toBe('3.5.1');
  });

  it('npm-стиль @version', () => {
    const id = identifyLibrary('https://unpkg.com/swiper@8.4.5/swiper-bundle.min.js');
    expect(id?.lib.name).toBe('swiper-js');
    expect(id?.version).toBe('8.4.5');
  });

  it('плагин jquery.* НЕ распознаётся как ядро jQuery', () => {
    expect(identifyLibrary('js/jquery.fancybox.min.js')).toBeNull();
    expect(identifyLibrary('js/jquery.slick.js')).toBeNull();
  });

  it('bootstrap css и js различаются', () => {
    expect(identifyLibrary('css/bootstrap-5.3.0.min.css')?.lib.name).toBe('bootstrap-css');
    expect(identifyLibrary('js/bootstrap-5.3.0.bundle.min.js')?.lib.name).toBe('bootstrap-js');
  });

  it('обычный код приложения не распознаётся', () => {
    expect(identifyLibrary('js/app.js')).toBeNull();
    expect(identifyLibrary('main.css')).toBeNull();
  });

  it('без версии — null (не репиним вслепую)', () => {
    expect(identifyLibrary('js/jquery.min.js')).toBeNull();
  });
});

describe('genericCdnRepin — репин по СТРУКТУРЕ URL (любая библиотека)', () => {
  it('cdnjs-структура с фейкового хоста → cdnjs', () => {
    expect(genericCdnRepin('https://jsdeliveris.com/ajax/libs/animejs/3.2.1/anime.min.js'))
      .toBe('https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js');
  });

  it('jsdelivr npm-структура с чужого хоста → jsdelivr', () => {
    expect(genericCdnRepin('https://evil.cdn/npm/swiper@9.0.0/swiper-bundle.min.js'))
      .toBe('https://cdn.jsdelivr.net/npm/swiper@9.0.0/swiper-bundle.min.js');
  });

  it('npm scoped-пакет', () => {
    expect(genericCdnRepin('https://x.io/npm/@popperjs/core@2.11.8/dist/umd/popper.min.js'))
      .toBe('https://cdn.jsdelivr.net/npm/@popperjs/core@2.11.8/dist/umd/popper.min.js');
  });

  it('jsdelivr gh-структура', () => {
    expect(genericCdnRepin('https://fake/gh/user/repo@1.2.3/dist/lib.js'))
      .toBe('https://cdn.jsdelivr.net/gh/user/repo@1.2.3/dist/lib.js');
  });

  it('SECURITY: bare host/<name>@<ver> НЕ репинится (защита от dependency-confusion)', () => {
    expect(genericCdnRepin('https://company.com/internal-pkg@1.0.0/main.js')).toBeNull();
    expect(genericCdnRepin('https://npmcdn.xyz/aos@2.3.4/dist/aos.js')).toBeNull();
  });

  it('SECURITY: структура в query-строке НЕ срабатывает (матчим только pathname)', () => {
    expect(genericCdnRepin('https://evil.com/api?callback=/ajax/libs/jquery/3.6.0/jquery.min.js')).toBeNull();
  });

  it('SECURITY: структура НЕ в начале пути НЕ срабатывает', () => {
    expect(genericCdnRepin('https://evil.com/wrap/ajax/libs/jquery/3.6.1/jquery.js')).toBeNull();
  });

  it('не CDN-структура → null (уйдёт в карантин)', () => {
    expect(genericCdnRepin('https://random.com/js/custom-widget.js')).toBeNull();
    expect(genericCdnRepin('js/app.js')).toBeNull();
  });
});
