/**
 * Арт-движок игры. Единый стиль (см. skill content-ui-art):
 *   • viewBox 0 0 100 100, всё векторное, без растровых вставок;
 *   • толстая тёмная обводка 3.4 px, round join/cap;
 *   • плоские заливки + мягкий градиент + блик;
 *   • не больше 8 основных цветов.
 *
 * Иконки собираются из примитивов ниже. Сгенерированные файлы — финальная
 * графика, а не заглушки. Их можно менять руками: генератор по умолчанию не
 * трогает существующие файлы (см. generate-icons.mjs, флаг --force).
 */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PALETTE = {
  ink: '#17110c',
  inkSoft: '#3b2f26',
  oil: '#2b2b30',
  oilLight: '#4a4a52',
  gold: '#f2b430',
  goldLight: '#ffd766',
  goldDark: '#c8860f',
  crimson: '#b3243b',
  crimsonLight: '#e0485f',
  green: '#2f9e5f',
  greenDark: '#1d7048',
  greenLight: '#63d18d',
  steel: '#9aa4ad',
  steelLight: '#d7dee3',
  steelDark: '#6d7780',
  sky: '#6ec6f0',
  cream: '#fdf3dd',
  creamDark: '#e6d6b4',
  purple: '#7b3fa0',
  skin: '#f3b98c',
  skinDark: '#d4956a',
  white: '#ffffff',
  olive: '#4d6142',
  oliveDark: '#36452f',
};

export const STROKE = 3.4;
const OUTLINE = `stroke="${PALETTE.ink}" stroke-width="${STROKE}" stroke-linejoin="round" stroke-linecap="round"`;

/** Подложка-диск, чтобы иконка читалась на любом фоне. */
const BACKDROP = `
  <circle cx="50" cy="50" r="47" fill="url(#soft)" />
  <circle cx="50" cy="50" r="47" fill="none" stroke="${PALETTE.ink}" stroke-width="2.2" opacity="0.14" />`;

/** Дефолтные градиенты, доступные всем иконкам по id: soft, gold, green, oil, sky, crimson, steel. */
export const DEFS = `
<defs>
  <radialGradient id="soft" cx="38%" cy="28%" r="85%">
    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.98" />
    <stop offset="60%" stop-color="${PALETTE.cream}" stop-opacity="0.98" />
    <stop offset="100%" stop-color="${PALETTE.creamDark}" stop-opacity="0.98" />
  </radialGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="0.4" y2="1">
    <stop offset="0%" stop-color="${PALETTE.goldLight}" />
    <stop offset="55%" stop-color="${PALETTE.gold}" />
    <stop offset="100%" stop-color="${PALETTE.goldDark}" />
  </linearGradient>
  <linearGradient id="green" x1="0" y1="0" x2="0.3" y2="1">
    <stop offset="0%" stop-color="${PALETTE.greenLight}" />
    <stop offset="60%" stop-color="${PALETTE.green}" />
    <stop offset="100%" stop-color="${PALETTE.greenDark}" />
  </linearGradient>
  <linearGradient id="oil" x1="0" y1="0" x2="0.2" y2="1">
    <stop offset="0%" stop-color="${PALETTE.oilLight}" />
    <stop offset="100%" stop-color="${PALETTE.oil}" />
  </linearGradient>
  <linearGradient id="sky" x1="0" y1="0" x2="0.2" y2="1">
    <stop offset="0%" stop-color="#bfe9ff" />
    <stop offset="100%" stop-color="${PALETTE.sky}" />
  </linearGradient>
  <linearGradient id="crimson" x1="0" y1="0" x2="0.3" y2="1">
    <stop offset="0%" stop-color="${PALETTE.crimsonLight}" />
    <stop offset="100%" stop-color="${PALETTE.crimson}" />
  </linearGradient>
  <linearGradient id="steel" x1="0" y1="0" x2="0.3" y2="1">
    <stop offset="0%" stop-color="${PALETTE.steelLight}" />
    <stop offset="55%" stop-color="${PALETTE.steel}" />
    <stop offset="100%" stop-color="${PALETTE.steelDark}" />
  </linearGradient>
  <linearGradient id="steelDark" x1="0" y1="0" x2="0.3" y2="1">
    <stop offset="0%" stop-color="${PALETTE.steel}" />
    <stop offset="100%" stop-color="${PALETTE.steelDark}" />
  </linearGradient>
  <linearGradient id="cream" x1="0" y1="0" x2="0.3" y2="1">
    <stop offset="0%" stop-color="${PALETTE.white}" />
    <stop offset="100%" stop-color="${PALETTE.cream}" />
  </linearGradient>
  <linearGradient id="purple" x1="0" y1="0" x2="0.3" y2="1">
    <stop offset="0%" stop-color="#a563cc" />
    <stop offset="100%" stop-color="${PALETTE.purple}" />
  </linearGradient>
  <linearGradient id="skin" x1="0" y1="0" x2="0.3" y2="1">
    <stop offset="0%" stop-color="#ffd0ac" />
    <stop offset="100%" stop-color="${PALETTE.skin}" />
  </linearGradient>
</defs>`;

/**
 * Что не так с готовым SVG: ссылки `url(#id)` на неопределённые градиенты и
 * следы незаполненных шаблонов (`undefined`, `NaN`). Пустой список — файл цел.
 *
 * Генераторы вызывают проверку перед записью, а тест `tests/svg.test.ts` —
 * для каждого результата: битый ресурс не должен попасть в `public/images`.
 *
 * @param {string} svg
 * @returns {string[]}
 */
export function svgProblems(svg) {
  const ids = new Set([...svg.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
  const refs = [...svg.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1]);
  const missing = [...new Set(refs.filter((id) => !ids.has(id)))];
  const problems = missing.map((id) => `ссылка на неопределённый id: url(#${id})`);
  if (svg.includes('undefined')) problems.push('в разметке есть undefined');
  if (/\bNaN\b/.test(svg)) problems.push('в разметке есть NaN');
  return problems;
}

/**
 * Вернуть SVG или упасть с понятной ошибкой, если ресурс битый.
 *
 * @param {string} name
 * @param {string} svg
 * @returns {string}
 */
export function assertSvg(name, svg) {
  const problems = svgProblems(svg);
  if (problems.length > 0) throw new Error(`${name}: ${problems.join('; ')}`);
  return svg;
}

/**
 * Запущен ли модуль как скрипт (`node file.mjs`), а не импортирован тестом.
 * Генераторы пишут файлы только при прямом запуске.
 *
 * @param {string} metaUrl
 * @returns {boolean}
 */
export function isMainModule(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    // Сравниваем настоящие пути: скрипт могли запустить через симлинк.
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

/**
 * Значение аргумента `--name value` из командной строки.
 *
 * @param {string} name
 * @param {string[]} [argv]
 * @returns {string | undefined}
 */
export function argValue(name, argv = process.argv.slice(2)) {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined;
}

/** Собирает готовый SVG-файл иконки. */
export function icon(body, { backdrop = true } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img">
${DEFS}${backdrop ? BACKDROP : ''}
${body.trim()}
</svg>
`;
}

// ------------------------------------------------------------------ примитивы

/** Прямоугольник со скруглением и обводкой. */
export const rect = (x, y, w, h, fill, rx = 4) =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(rx)}" fill="${fill}" ${OUTLINE} />`;

export const circle = (cx, cy, r, fill) =>
  `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}" ${OUTLINE} />`;

export const ellipse = (cx, cy, rx, ry, fill, rotate = 0) =>
  `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}" ${OUTLINE}${
    rotate ? ` transform="rotate(${rotate} ${n(cx)} ${n(cy)})"` : ''
  } />`;

export const path = (d, fill = 'none', extra = '') =>
  `<path d="${d}" fill="${fill}" ${OUTLINE} ${extra} />`;

/** Толстая обводка-«труба» без заливки: рисует только stroke. */
export const pipe = (d, color = 'url(#steel)', width = 10) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round" />`;

/** Заливка без обводки (для теней, бликов, стекла). */
export const fill = (d, fillColor, opacity = 1) =>
  `<path d="${d}" fill="${fillColor}" opacity="${opacity}" />`;

export const shade = (d, fillColor, opacity = 0.18) => fill(d, fillColor, opacity);

export const line = (x1, y1, x2, y2, width = STROKE, color = PALETTE.ink) =>
  `<path d="M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}" stroke="${color}" stroke-width="${n(width)}" stroke-linecap="round" fill="none" />`;

export const poly = (points, fillColor) =>
  `<polygon points="${points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="${fillColor}" ${OUTLINE} />`;

export const group = (children, extra = '') => `<g ${extra}>${children.join('')}</g>`;

/** Блик: мягкое белое пятно без обводки. */
export const shine = (cx, cy, r, opacity = 0.55) =>
  `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(r)}" ry="${n(r * 0.55)}" fill="#fff" opacity="${opacity}" transform="rotate(-18 ${n(cx)} ${n(cy)})" />`;

/** Монета с бликом и насечкой по краю. */
export const coin = (cx, cy, r) =>
  `${circle(cx, cy, r, 'url(#gold)')}<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(
    r * 0.62,
  )}" fill="none" stroke="${PALETTE.goldDark}" stroke-width="${n(Math.max(1.4, r * 0.12))}" opacity="0.8" />${shine(
    cx - r * 0.28,
    cy - r * 0.34,
    r * 0.34,
    0.75,
  )}`;

/** Капля нефти. */
export const drop = (x, y, s = 1) =>
  path(
    `M${n(x)} ${n(y - 8 * s)}c${n(5 * s)} ${n(6 * s)} ${n(7 * s)} ${n(9 * s)} ${n(7 * s)} ${n(11 * s)}a${n(
      7 * s,
    )} ${n(7 * s)} 0 0 1 ${n(-14 * s)} 0c0 ${n(-2 * s)} ${n(2 * s)} ${n(-5 * s)} ${n(7 * s)} ${n(-11 * s)}Z`,
    'url(#oil)',
  );

/** Искры/звёздочки. */
export const spark = (cx, cy, r = 5, fillColor = PALETTE.goldLight) =>
  fill(
    `M${n(cx)} ${n(cy - r)}L${n(cx + r * 0.28)} ${n(cy - r * 0.28)}L${n(cx + r)} ${n(cy)}L${n(
      cx + r * 0.28,
    )} ${n(cy + r * 0.28)}L${n(cx)} ${n(cy + r)}L${n(cx - r * 0.28)} ${n(cy + r * 0.28)}L${n(
      cx - r,
    )} ${n(cy)}L${n(cx - r * 0.28)} ${n(cy - r * 0.28)}Z`,
    fillColor,
    0.95,
  );

/** Звезда (для «крутости» и наград). */
export const star = (cx, cy, r, fillColor = PALETTE.gold) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r * 0.45;
    pts.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
  return poly(pts, fillColor);
};

/** Нефтяная вышка (силуэт). */
export const derrick = (cx, baseY, height, color = PALETTE.ink) => {
  const w = height * 0.42;
  const d = [
    `M${n(cx - w / 2)} ${n(baseY)}`,
    `L${n(cx)} ${n(baseY - height)}`,
    `L${n(cx + w / 2)} ${n(baseY)}`,
    'Z',
  ].join('');
  const braces = [
    `M${n(cx - w / 2)} ${n(baseY)}L${n(cx + w / 2)} ${n(baseY)}`,
    `M${n(cx - w * 0.34)} ${n(baseY - height * 0.35)}L${n(cx + w * 0.34)} ${n(baseY - height * 0.35)}`,
    `M${n(cx - w * 0.2)} ${n(baseY - height * 0.68)}L${n(cx + w * 0.2)} ${n(baseY - height * 0.68)}`,
    `M${n(cx - w * 0.34)} ${n(baseY - height * 0.35)}L${n(cx + w * 0.2)} ${n(baseY - height * 0.68)}`,
    `M${n(cx + w * 0.34)} ${n(baseY - height * 0.35)}L${n(cx - w * 0.2)} ${n(baseY - height * 0.68)}`,
  ]
    .map((dd) => `<path d="${dd}" stroke="${PALETTE.ink}" stroke-width="2.4" fill="none" stroke-linecap="round" />`)
    .join('');
  return `${fill(d, color, 0.9)}${braces}`;
};

/** Дым из трубы. */
export const smoke = (cx, cy, s = 1, opacity = 0.75) =>
  [
    circle(cx, cy, 6 * s, PALETTE.steelLight),
    circle(cx + 7 * s, cy - 6 * s, 5 * s, PALETTE.cream),
    circle(cx - 6 * s, cy - 5 * s, 4 * s, PALETTE.steelLight),
  ]
    .join('')
    .replace(/stroke="[^"]*" stroke-width="[^"]*" stroke-linejoin="round" stroke-linecap="round"/g, 'stroke="none"')
    .replace(/opacity="1"/g, `opacity="${opacity}"`);

/** Труба завода. */
export const chimney = (x, y, w, h, fillColor = PALETTE.crimson) =>
  `${rect(x, y, w, h, fillColor, 2)}${rect(x - 1.5, y - 3, w + 3, 5, PALETTE.inkSoft, 2)}`;

/** Человечек: один шаблон с вариациями (ТЗ §9, персонажи). */
export function character({
  suit = PALETTE.oil,
  suitLight = PALETTE.oilLight,
  skin = 'url(#skin)',
  hair = PALETTE.inkSoft,
  hat = null,
  beard = false,
  glasses = false,
  mustache = false,
  tie = PALETTE.crimson,
  smiling = true,
  accessory = '',
  scale = 1,
  cx = 50,
  baseY = 92,
} = {}) {
  const s = scale;
  const body = [];
  // Туловище
  body.push(
    path(
      `M${n(cx - 22 * s)} ${n(baseY)}c0-${n(16 * s)} ${n(6 * s)}-${n(26 * s)} ${n(19 * s)}-${n(
        29 * s,
      )}h${n(6 * s)}c${n(13 * s)} ${n(3 * s)} ${n(19 * s)} ${n(13 * s)} ${n(19 * s)} ${n(29 * s)}Z`,
      suit,
    ),
  );
  // Рубашка и галстук
  body.push(fill(`M${n(cx - 6 * s)} ${n(baseY - 29 * s)}h${n(12 * s)}v${n(12 * s)}h${n(-12 * s)}Z`, PALETTE.cream));
  body.push(tie ? fill(`M${n(cx - 2.5 * s)} ${n(baseY - 28 * s)}l${n(2.5 * s)} ${n(3 * s)}l${n(2.5 * s)} ${n(-3 * s)}l${n(-1 * s)} ${n(16 * s)}l${n(-1.5 * s)} ${n(3 * s)}l${n(-1.5 * s)} ${n(-3 * s)}Z`, tie) : '');
  // Голова
  body.push(circle(cx, baseY - 40 * s, 13 * s, skin));
  // Волосы
  body.push(
    fill(
      `M${n(cx - 13 * s)} ${n(baseY - 41 * s)}a${n(13 * s)} ${n(13 * s)} 0 0 1 ${n(26 * s)} 0c${n(
        -4 * s,
      )} ${n(-5 * s)} ${n(-22 * s)} ${n(-5 * s)} ${n(-26 * s)} 0Z`,
      hair,
    ),
  );
  if (beard) {
    body.push(
      fill(
        `M${n(cx - 11 * s)} ${n(baseY - 36 * s)}c${n(2 * s)} ${n(14 * s)} ${n(20 * s)} ${n(14 * s)} ${n(22 * s)} 0c${n(-6 * s)} ${n(4 * s)} ${n(-16 * s)} ${n(4 * s)} ${n(-22 * s)} 0Z`,
        hair,
      ),
    );
  }
  // Глаза
  body.push(
    `<circle cx="${n(cx - 4.6 * s)}" cy="${n(baseY - 42 * s)}" r="${n(1.7 * s)}" fill="${PALETTE.ink}" />` +
      `<circle cx="${n(cx + 4.6 * s)}" cy="${n(baseY - 42 * s)}" r="${n(1.7 * s)}" fill="${PALETTE.ink}" />`,
  );
  if (smiling) {
    body.push(
      `<path d="M${n(cx - 5 * s)} ${n(baseY - 35 * s)}q${n(5 * s)} ${n(4 * s)} ${n(10 * s)} 0" stroke="${PALETTE.ink}" stroke-width="${n(
        2 * s,
      )}" fill="none" stroke-linecap="round" />`,
    );
  }
  if (mustache) {
    body.push(
      fill(
        `M${n(cx - 6 * s)} ${n(baseY - 37 * s)}q${n(6 * s)} ${n(-3 * s)} ${n(12 * s)} 0q${n(-6 * s)} ${n(
          4 * s,
        )} ${n(-12 * s)} 0Z`,
        hair,
      ),
    );
  }
  if (glasses) {
    body.push(
      `<circle cx="${n(cx - 4.6 * s)}" cy="${n(baseY - 42 * s)}" r="${n(4.4 * s)}" fill="none" stroke="${
        PALETTE.ink
      }" stroke-width="${n(1.8 * s)}" />` +
        `<circle cx="${n(cx + 4.6 * s)}" cy="${n(baseY - 42 * s)}" r="${n(4.4 * s)}" fill="none" stroke="${
          PALETTE.ink
        }" stroke-width="${n(1.8 * s)}" />` +
        `<path d="M${n(cx - 0.4 * s)} ${n(baseY - 42 * s)}h${n(0.8 * s)}" stroke="${PALETTE.ink}" stroke-width="${n(
          1.8 * s,
        )}" />`,
    );
  }
  if (hat) body.push(hat(cx, baseY - 40 * s, s));
  if (accessory) body.push(accessory(cx, baseY, s));
  return body.join('');
}

/** Цилиндр — для буржуя и «императора». */
export const topHat = (cx, cy, s = 1, color = PALETTE.ink) =>
  `${rect(cx - 11 * s, cy - 20 * s, 22 * s, 18 * s, color, 3)}${rect(cx - 16 * s, cy - 3 * s, 32 * s, 5 * s, color, 2)}${fill(
    `M${cx - 9 * s} ${cy - 16 * s}h${4 * s}v${10 * s}h${-4 * s}Z`,
    PALETTE.white,
    0.18,
  )}`;

/** Корона. */
export const crown = (cx, cy, s = 1) =>
  poly(
    [
      [cx - 12 * s, cy + 5 * s],
      [cx - 14 * s, cy - 8 * s],
      [cx - 6 * s, cy - 1 * s],
      [cx, cy - 12 * s],
      [cx + 6 * s, cy - 1 * s],
      [cx + 14 * s, cy - 8 * s],
      [cx + 12 * s, cy + 5 * s],
    ],
    'url(#gold)',
  );

/** Круглая печать/штамп. */
export const stamp = (cx, cy, r) =>
  `${circle(cx, cy, r, 'url(#crimson)')}<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(
    r * 0.72,
  )}" fill="none" stroke="${PALETTE.cream}" stroke-width="2.4" stroke-dasharray="3 3" opacity="0.9" />`;

/** Аккуратное число: не больше 2 знаков после запятой. */
function n(value) {
  return Math.round(value * 100) / 100;
}
