import { describe, it, expect } from 'vitest';
import { identifyLibrary } from '../cdn-detector.js';

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
