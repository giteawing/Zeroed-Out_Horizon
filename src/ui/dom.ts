/**
 * Крошечный помощник для DOM. Никакой разметки строками: тексты приходят
 * из texts.json и попадают в документ только как текст. Разбора строк как
 * HTML здесь нет намеренно (tests/dead-code.test.ts следит за всем src/).
 *
 *   const button = el('button', { class: 'btn tap', 'aria-label': t('tap') }, [
 *     el('span', { class: 'btn__label' }, t('tap')),
 *   ]);
 */
type Attrs = Record<string, string | number | boolean | undefined | null>;
type Child = Node | string | number | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child | Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else node.setAttribute(key, String(value));
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' || typeof child === 'number' ? String(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Пишет текст, только если он изменился. Запись того же текста всё равно
 * заменяет текстовый узел: браузер заново считает раскладку, а выделение
 * мышью сбрасывается. Для узлов, которые обновляются несколько раз в секунду.
 */
export function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Скрывает или показывает узел, не трогая атрибут без необходимости. */
export function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden;
}

/** Включает или выключает класс, только если его состояние другое. */
export function setClass(node: Element, name: string, on: boolean): void {
  if (node.classList.contains(name) !== on) node.classList.toggle(name, on);
}
