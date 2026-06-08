import { describe, it, expect } from 'vitest';
import { hasServerTags } from '../html-dom.js';

describe('hasServerTags — детект РЕАЛЬНЫХ серверных блоков (DOM-1)', () => {
  // ── Должны детектиться (cheerio их испортит → пропуск DOM-проходов оправдан) ──
  describe('реальные серверные теги → true', () => {
    it('<?php ... ?>', () => {
      expect(hasServerTags('<div><?php echo $x; ?></div>')).toBe(true);
    });
    it('<?php без закрывающего ?> (PHP допускает опускать в конце файла)', () => {
      expect(hasServerTags('<div></div>\n<?php echo $x;')).toBe(true);
    });
    it('<?= short echo с закрытием', () => {
      expect(hasServerTags('<a href="<?= $url ?>">x</a>')).toBe(true);
    });
    it('<?= short echo без закрытия', () => {
      expect(hasServerTags('<title><?=$t')).toBe(true);
    });
    it('короткий <? ... ?> (с пробелом и закрытием)', () => {
      expect(hasServerTags('<p><?  echo 1; ?></p>')).toBe(true);
    });
    it('ASP <% ... %>', () => {
      expect(hasServerTags('<div><% Response.Write(x) %></div>')).toBe(true);
    });
    it('EJS/JSP <%= ... %>', () => {
      expect(hasServerTags('<div><%= user.name %></div>')).toBe(true);
    });
    it('JSP-директива <%@ ... %>', () => {
      expect(hasServerTags('<%@ page language="java" %><html></html>')).toBe(true);
    });
    it('шаблон <% if(x){ %> ... <% } %>', () => {
      expect(hasServerTags('<script type="text/template"><% if(x){ %>hi<% } %></script>')).toBe(true);
    });
  });

  // ── НЕ должны детектиться: это и был тривиальный обход + FP (DOM-1) ──
  describe('обход и ложные срабатывания → false', () => {
    it('ОБХОД: огрызок <% без закрытия (<!-- <% -->) НЕ выключает очистку', () => {
      expect(hasServerTags('<!-- <% --><div>real landing</div>')).toBe(false);
    });
    it('ОБХОД: обычный текст с "<? " без закрытия НЕ выключает очистку', () => {
      expect(hasServerTags('<p>cheap price <? maybe later</p>')).toBe(false);
    });
    it('одинокий <% где-то в тексте без %>', () => {
      expect(hasServerTags('<p>50% > 10</p><span><% leftover</span>')).toBe(false);
    });
    it('XML-декларация <?xml ...?> не считается серверным тегом', () => {
      expect(hasServerTags('<?xml version="1.0" encoding="UTF-8"?><svg></svg>')).toBe(false);
    });
    it('чистый HTML без серверных тегов', () => {
      expect(hasServerTags('<!doctype html><html><body><div>hi</div></body></html>')).toBe(false);
    });
    it('фрагмент без doctype/html', () => {
      expect(hasServerTags('<title>t</title><p>x</p>')).toBe(false);
    });
    it('ИЗВЕСТНЫЙ TRADE-OFF: bare short-open "<? ..." без ?> и без php — не ловим (DOM-1 rec)', () => {
      // Неоднозначно с текстом; ловим только при закрытии или явном <?php/<?=.
      expect(hasServerTags('<p>text <? echo $x;')).toBe(false);
    });
  });
});
