// @vitest-environment happy-dom
/**
 * Помощник `el()` создаёт узлы и никогда не разбирает строки как разметку
 * (REVIEW C12). Тексты приходят из texts.json; пока они попадают в DOM только
 * как текст, подменённый JSON не может добавить на страницу тег или скрипт.
 */
import { describe, expect, it } from 'vitest';
import { el, setClass, setHidden, setText } from '../../src/ui/dom';

const MARKUP = '<img src="x" onerror="window.__pwned = true"><b>жирный</b>';

describe('el(): строки остаются текстом (REVIEW C12)', () => {
  it('ключа «html» нет: разметка из атрибутов не появляется', () => {
    const node = el('div', { html: MARKUP });
    expect(node.children).toHaveLength(0);
    expect(node.querySelector('img')).toBeNull();
    expect(node.textContent).toBe('');
  });

  it('текст и дети-строки вставляются как текст', () => {
    const byAttr = el('p', { text: MARKUP });
    expect(byAttr.children).toHaveLength(0);
    expect(byAttr.textContent).toBe(MARKUP);

    const byChild = el('p', {}, [MARKUP, el('span', {}, MARKUP)]);
    expect(byChild.children).toHaveLength(1);
    expect(byChild.querySelector('img')).toBeNull();
    expect(byChild.querySelector('b')).toBeNull();
    expect(byChild.textContent).toBe(MARKUP + MARKUP);
  });

  it('атрибуты, класс и пропуски', () => {
    const node = el('button', { class: 'btn btn--gold', type: 'button', disabled: false, title: null, 'data-id': 7 });
    expect(node.className).toBe('btn btn--gold');
    expect(node.getAttribute('type')).toBe('button');
    expect(node.hasAttribute('disabled')).toBe(false);
    expect(node.hasAttribute('title')).toBe(false);
    expect(node.dataset.id).toBe('7');
  });
});

describe('точечные обновления узла', () => {
  it('setText, setHidden и setClass меняют узел только при изменении', () => {
    const node = el('span', {}, 'было');
    const text = node.firstChild;
    setText(node, 'было');
    expect(node.firstChild).toBe(text);
    setText(node, MARKUP);
    expect(node.textContent).toBe(MARKUP);
    expect(node.children).toHaveLength(0);

    setHidden(node, true);
    expect(node.hidden).toBe(true);
    setClass(node, 'on', true);
    setClass(node, 'on', true);
    expect(node.className).toBe('on');
    setClass(node, 'on', false);
    expect(node.className).toBe('');
  });
});
