/**
 * Генератор иконок покупок: public/images/icons/<icon>.svg
 * Запуск: npm run art
 *
 * Каждая иконка — самостоятельный SVG 100×100 в едином стиле (см. art.mjs).
 * Файлы можно править руками: генератор перезапишет только при повторном запуске,
 * а тест content.test.ts проверяет, что файл для каждой покупки существует.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PALETTE as P,
  character,
  chimney,
  circle,
  coin,
  pipe,
  crown,
  derrick,
  drop,
  ellipse,
  fill,
  group,
  icon,
  line,
  path,
  poly,
  rect,
  shine,
  smoke,
  spark,
  stamp,
  star,
  topHat,
} from './lib/art.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../public/images/icons');

// ------------------------------------------------------------ примитивы сцены

const ground = (y = 82) =>
  path(`M8 ${y}q42 -7 84 0v10H8Z`, 'url(#green)', 'opacity="0.35"');

const bar = (x, y, w, h, fillColor) => rect(x, y, w, h, fillColor, 3);

/** Скважина-качалка. */
const pumpjack = (cx, yBase, s = 1) => {
  const parts = [];
  parts.push(poly([[cx - 4 * s, yBase], [cx, yBase - 26 * s], [cx + 4 * s, yBase]], P.inkSoft));
  parts.push(
    path(
      `M${cx - 30 * s} ${yBase - 30 * s}l${20 * s} ${6 * s}l${2 * s} ${-6 * s}l${-20 * s} ${-6 * s}Z`,
      'url(#steel)',
    ),
  );
  parts.push(circle(cx + 6 * s, yBase - 26 * s, 6 * s, 'url(#crimson)'));
  parts.push(rect(cx - 34 * s, yBase - 34 * s, 8 * s, 10 * s, 'url(#steel)', 2));
  parts.push(path(`M${cx + 24 * s} ${yBase - 22 * s}l10 ${18 * s}`, 'none'));
  return group(parts);
};

/** Долото-шарошка. */
const rollerBit = (cx, cy, s = 1, color = 'url(#steel)') => {
  const parts = [];
  parts.push(rect(cx - 8 * s, cy - 26 * s, 16 * s, 20 * s, color, 4));
  parts.push(circle(cx - 11 * s, cy - 2 * s, 9 * s, 'url(#steel)'));
  parts.push(circle(cx + 11 * s, cy - 2 * s, 9 * s, 'url(#steel)'));
  parts.push(circle(cx, cy + 8 * s, 7 * s, 'url(#steel)'));
  for (const [dx, dy] of [[-14, -5], [-8, -6], [-14, 2], [14, -5], [8, -6], [14, 2], [0, 12], [-4, 8], [4, 8]]) {
    parts.push(
      `<circle cx="${n(cx + dx * s)}" cy="${n(cy + dy * s)}" r="${n(1.6 * s)}" fill="${P.inkSoft}" />`,
    );
  }
  return group(parts);
};

const n = (value) => Math.round(value * 100) / 100;

const factory = (x, y, w, h, bodyColor = 'url(#steel)') => {
  const parts = [rect(x, y, w, h, bodyColor, 3)];
  parts.push(poly([[x, y], [x + w / 2, y - 9], [x + w, y]], 'url(#crimson)'));
  parts.push(rect(x + w * 0.18, y + h * 0.35, w * 0.18, h * 0.3, P.gold, 1.5));
  parts.push(rect(x + w * 0.58, y + h * 0.35, w * 0.18, h * 0.3, P.gold, 1.5));
  return group(parts);
};

const ship = (cx, cy, s = 1, color = 'url(#crimson)') => {
  const parts = [];
  parts.push(
    path(`M${cx - 30 * s} ${cy}h${60 * s}l${-8 * s} ${12 * s}h${-44 * s}Z`, color),
  );
  parts.push(rect(cx - 14 * s, cy - 14 * s, 26 * s, 14 * s, 'url(#steel)', 2));
  parts.push(rect(cx - 2 * s, cy - 26 * s, 7 * s, 12 * s, P.inkSoft, 1.5));
  return group(parts);
};

const tank = (x, y, w, h) => {
  const parts = [rect(x, y, w, h, 'url(#steel)', 5)];
  parts.push(fill(`M${x + 3} ${y + 6}h${w - 6}v${h * 0.28}h${-(w - 6)}Z`, P.steelDark, 0.35));
  parts.push(line(x + 2, y + h * 0.62, x + w - 2, y + h * 0.62, 2));
  return group(parts);
};

const gem = (cx, cy, s = 1, color = 'url(#sky)') =>
  poly(
    [
      [cx - 10 * s, cy - 4 * s],
      [cx - 4 * s, cy - 10 * s],
      [cx + 6 * s, cy - 10 * s],
      [cx + 11 * s, cy - 2 * s],
      [cx + 1 * s, cy + 10 * s],
      [cx - 8 * s, cy + 4 * s],
    ],
    color,
  );

const document = (x, y, w, h, color = P.cream) => {
  const parts = [rect(x, y, w, h, color, 3)];
  for (let i = 0; i < 4; i++) {
    parts.push(line(x + 5, y + 9 + i * 8, x + w - 6 - (i % 2) * 8, y + 9 + i * 8, 2, P.inkSoft));
  }
  return group(parts);
};

const money = (cx, cy, s = 1) => `${rect(cx - 15 * s, cy - 9 * s, 30 * s, 18 * s, 'url(#green)', 3)}${circle(
  cx,
  cy,
  5 * s,
  'url(#gold)',
)}`;

const sauna = () => {
  const parts = [rect(16, 34, 68, 48, '#c98f52', 5)];
  parts.push(rect(26, 22, 10, 12, '#a9743c', 2));
  parts.push(rect(64, 22, 10, 12, '#a9743c', 2));
  for (let i = 0; i < 4; i++) parts.push(line(22, 44 + i * 9, 78, 44 + i * 9, 2, '#8a5c2c'));
  parts.push(
    path('M44 78c0-10 5-16 5-16s5 6 5 16Z', 'url(#sky)'),
    path('M30 78c0-8 4-13 4-13s4 5 4 13Z', 'url(#sky)'),
  );
  return group(parts);
};

const temple = () => {
  const parts = [poly([[28, 42], [50, 20], [72, 42]], 'url(#gold)')];
  parts.push(rect(24, 42, 52, 6, P.creamDark, 2));
  for (const x of [30, 42, 54, 66]) parts.push(rect(x, 50, 6, 26, P.cream, 2));
  parts.push(rect(22, 76, 56, 7, P.creamDark, 2));
  parts.push(path('M46 40h8v14h-8Z', 'url(#gold)'));
  return group(parts);
};

const person = (opts) => character({ ...opts, baseY: 86, scale: 0.95 });

const yachts = {
  'lux-boat': `${fill('M10 74q40 10 80 0v6H10Z', 'url(#green)', 0.3)}${path(
    'M20 66h52l-8 12H26Z',
    'url(#crimson)',
  )}${rect(34, 50, 26, 16, P.cream, 3)}${rect(52, 36, 6, 16, P.inkSoft, 2)}${path('M56 36l16 8H56Z', P.cream)}`,
  'lux-speedboat': `${fill('M8 76q42 12 84 0v6H8Z', 'url(#green)', 0.3)}${path(
    'M16 62h44l26 12H12Z',
    'url(#gold)',
  )}${rect(30, 46, 24, 16, P.cream, 4)}${rect(36, 50, 12, 8, 'url(#sky)', 2)}${path('M14 58l10-6v8Z', P.crimson)}`,
  'lux-yacht': `${fill('M6 78q44 12 88 0v4H6Z', 'url(#green)', 0.3)}${path(
    'M12 64h64l14 12H8Z',
    P.white,
  )}${rect(26, 48, 30, 16, P.cream, 4)}${rect(44, 30, 6, 18, P.inkSoft, 2)}${path('M50 30l18 10H50Z', P.cream)}${circle(
    18,
    60,
    3,
    P.gold,
  )}`,
  'lux-superyacht': `${fill('M4 80q46 12 92 0v4H4Z', 'url(#green)', 0.3)}${path(
    'M8 62h66l16 14H4Z',
    P.white,
  )}${rect(20, 40, 40, 22, P.cream, 5)}${rect(30, 44, 14, 8, 'url(#sky)', 2)}${circle(72, 72, 8, 'url(#steel)')}${line(
    72,
    64,
    72,
    56,
    3,
    P.ink,
  )}${path('M60 56l24 0', 'none')}`,
  'lux-islandyacht': `${fill('M2 82q48 12 96 0v4H2Z', 'url(#green)', 0.35)}${path(
    'M6 58h72l16 16H2Z',
    P.white,
  )}${rect(16, 34, 44, 24, P.cream, 6)}${rect(26, 38, 12, 8, 'url(#sky)', 2)}${poly(
    [[70, 58], [78, 40], [86, 58]],
    'url(#green)',
  )}${circle(88, 46, 8, 'url(#green)')}`,
};

const cars = {
  'lux-car-old': `${rect(14, 54, 72, 20, 'url(#steel)', 6)}${poly(
    [[24, 54], [34, 38], [64, 38], [74, 54]],
    '#8fb3c7',
  )}${circle(30, 76, 8, 'url(#oil)')}${circle(70, 76, 8, 'url(#oil)')}${circle(
    30,
    76,
    3,
    P.steelLight,
  )}${circle(70, 76, 3, P.steelLight)}${rect(32, 42, 12, 10, P.cream, 2)}`,
  'lux-car-suv': `${rect(12, 50, 76, 26, 'url(#green)', 7)}${poly(
    [[22, 50], [30, 32], [68, 32], [78, 50]],
    '#63d18d',
  )}${circle(30, 78, 10, 'url(#oil)')}${circle(70, 78, 10, 'url(#oil)')}${circle(
    30,
    78,
    4,
    P.steelLight,
  )}${circle(70, 78, 4, P.steelLight)}${rect(34, 36, 14, 10, P.cream, 2)}${rect(52, 36, 14, 10, P.cream, 2)}`,
  'lux-car-limo': `${rect(6, 52, 88, 24, P.ink, 8)}${rect(14, 34, 72, 20, P.ink, 8)}${rect(
    18,
    38,
    26,
    12,
    '#7fc6e8',
    2,
  )}${rect(50, 38, 30, 12, '#7fc6e8', 2)}${circle(26, 78, 9, 'url(#gold)')}${circle(74, 78, 9, 'url(#gold)')}${line(
    50,
    34,
    50,
    54,
    3,
    P.gold,
  )}`,
  'lux-car-retro': `${rect(12, 54, 76, 18, 'url(#crimson)', 10)}${path(
    'M30 54c2-14 14-18 20-18s18 4 20 18',
    '#a52a2a',
  )}${circle(28, 74, 10, 'url(#oil)')}${circle(72, 74, 10, 'url(#oil)')}${circle(
    28,
    74,
    4,
    'url(#gold)',
  )}${circle(72, 74, 4, 'url(#gold)')}${rect(42, 40, 8, 12, P.cream, 2)}${rect(56, 40, 8, 12, P.cream, 2)}`,
  'lux-cortege': `${rect(10, 46, 80, 28, P.ink, 6)}${rect(20, 30, 60, 18, P.ink, 6)}${rect(
    26,
    34,
    18,
    10,
    '#6b7c8a',
    2,
  )}${rect(54, 34, 18, 10, '#6b7c8a', 2)}${circle(28, 78, 10, 'url(#oil)')}${circle(
    72,
    78,
    10,
    'url(#oil)',
  )}${rect(44, 24, 12, 6, P.crimson, 2)}${line(44, 26, 40, 18, 2, P.crimson)}`,
  'lux-heli': `${rect(20, 50, 56, 22, 'url(#crimson)', 10)}${rect(28, 58, 16, 8, '#9fd8f2', 2)}${path(
    'M64 50l14 -6v14l-14 4Z',
    'url(#gold)',
  )}${line(24, 34, 72, 34, 4, P.ink)}${line(48, 34, 48, 46, 3, P.inkSoft)}${line(
    24,
    74,
    76,
    74,
    4,
    P.steelDark,
  )}`,
  'lux-plane': `${path('M10 58h66l14-10-2 18-14 6H10Z', P.white)}${poly(
    [[26, 58], [40, 34], [52, 34], [46, 56]],
    'url(#steel)',
  )}${poly([[44, 46], [30, 52], [50, 52]], P.crimson)}${circle(18, 60, 2.4, '#9fd8f2')}${circle(
    26,
    60,
    2.4,
    '#9fd8f2',
  )}${circle(34, 60, 2.4, '#9fd8f2')}`,
  'lux-icebreaker': `${ship(50, 58, 0.85, 'url(#crimson)')}${rect(30, 40, 30, 18, P.cream, 3)}${poly(
    [[18, 74], [26, 62], [34, 74]],
    '#cfe8f5',
  )}${poly([[62, 74], [70, 60], [80, 74]], '#cfe8f5')}`,
  'lux-airship': `${ellipse(50, 48, 34, 18, 'url(#gold)')}${ellipse(50, 48, 34, 18, 'none')}${path(
    'M50 30c-16 0-30 8-30 18',
    'none',
  )}${rect(30, 62, 40, 14, 'url(#crimson)', 6)}${line(44, 62, 46, 56, 2, P.ink)}${line(
    56,
    62,
    54,
    56,
    2,
    P.ink,
  )}${circle(38, 70, 3, P.gold)}${circle(62, 70, 3, P.gold)}`,
};

const bling = {
  'lux-ring': `${circle(50, 58, 18, 'url(#gold)')}${circle(50, 58, 9, 'url(#soft)')}${gem(
    50,
    30,
    1.2,
    'url(#sky)',
  )}`,
  'lux-signet': `${rect(30, 46, 40, 30, 'url(#gold)', 8)}${gem(50, 46, 1.6, 'url(#purple)', '')}${shine(
    40,
    56,
    6,
    0.5,
  )}`,
  'lux-necklace': `${path('M22 30q28 44 56 0', 'none')}${path('M22 30q28 44 56 0', 'none')}${gem(
    50,
    68,
    1.5,
    'url(#sky)',
  )}${circle(30, 34, 4, 'url(#gold)')}${circle(70, 34, 4, 'url(#gold)')}${circle(
    40,
    46,
    3.5,
    'url(#gold)',
  )}${circle(60, 46, 3.5, 'url(#gold)')}`,
  'lux-crown': crown(50, 52, 2.4),
  'lux-watch-1': `${circle(50, 52, 20, 'url(#steel)')}${circle(50, 52, 15, P.cream)}${line(
    50,
    52,
    50,
    42,
    3,
  )}${line(50, 52, 58, 55, 2.4)}${rect(42, 18, 16, 10, P.inkSoft, 2)}${rect(42, 76, 16, 10, P.inkSoft, 2)}`,
  'lux-watch-2': `${circle(50, 52, 21, 'url(#gold)')}${circle(50, 52, 16, P.ink)}${line(
    50,
    52,
    50,
    41,
    3,
    P.goldLight,
  )}${line(50, 52, 59, 56, 2.4, P.goldLight)}${rect(40, 16, 20, 10, 'url(#gold)', 2)}${rect(
    40,
    78,
    20,
    10,
    'url(#gold)',
    2,
  )}${gem(50, 52, 0.5, P.goldLight)}`,
  'lux-watch-3': `${circle(50, 52, 22, 'url(#gold)')}${circle(50, 52, 17, '#1a2030')}${line(
    50,
    52,
    50,
    40,
    2.6,
    '#e8f3ff',
  )}${line(50, 52, 61, 57, 2.2, '#e8f3ff')}${rect(38, 14, 24, 10, 'url(#gold)', 2)}${rect(
    38,
    80,
    24,
    10,
    'url(#gold)',
    2,
  )}${spark(74, 30, 6)}${spark(26, 70, 5)}`,
  'lux-jacket-1': jacket(P.crimson, P.crimsonLight),
  'lux-jacket-2': jacket('url(#gold)', P.goldLight),
  'lux-jacket-3': `${jacket('url(#gold)', P.goldLight)}${crown(50, 34, 0.85)}`,
  'lux-cane': `${line(34, 78, 62, 28, 6, P.ink)}${line(34, 78, 62, 28, 3, '#8a5c2c')}${circle(
    64,
    26,
    8,
    'url(#gold)',
  )}`,
  'lux-fur': `${path('M26 30q24-8 48 0v40q-24 10-48 0Z', '#e8d7c3')}${path(
    'M38 30v40M50 28v44M62 30v40',
    'none',
  )}${circle(50, 52, 4, P.inkSoft)}`,
  'lux-cigars': `${rect(22, 52, 56, 24, 'url(#gold)', 4)}${rect(28, 40, 18, 12, '#6b4a2f', 5)}${rect(
    50,
    40,
    18,
    12,
    '#6b4a2f',
    5,
  )}${smoke(60, 32, 0.7)}`,
};

function jacket(main, light) {
  return `${path('M28 30h14l8 10 8-10h14l6 46H22Z', main)}${path('M42 30l8 10 8-10-8 -6Z', P.cream)}${fill(
    `M50 40l3 6 -3 26 -3-26Z`,
    P.crimson,
  )}${path('M28 30l-6 8 6 38', 'none')}${path('M72 30l6 8-6 38', 'none')}${shine(38, 46, 5, 0.4)}`;
}

const realty = {
  'lux-courchevel': `${poly([[50, 18], [86, 46], [14, 46]], '#f4f7fb')}${rect(20, 46, 60, 34, '#8a5c2c', 3)}${rect(
    34,
    58,
    14,
    22,
    '#4a3728',
    2,
  )}${rect(56, 54, 14, 12, P.gold, 2)}${poly([[50, 62], [58, 56], [64, 62]], '#f4f7fb')}${smoke(
    70,
    30,
    0.7,
  )}`,
  'lux-penthouse': `${rect(18, 46, 64, 36, 'url(#steel)', 3)}${rect(18, 30, 64, 18, 'url(#gold)', 3)}${rect(
    24,
    34,
    12,
    10,
    '#9fd8f2',
    2,
  )}${rect(42, 34, 12, 10, '#9fd8f2', 2)}${rect(60, 34, 12, 10, '#9fd8f2', 2)}${line(
    28,
    72,
    72,
    72,
    2,
    P.inkSoft,
  )}${derrick(30, 82, 16)}`,
  'lux-castle': `${rect(20, 42, 60, 38, '#a9a29a', 3)}${rect(14, 28, 16, 52, '#a9a29a', 3)}${rect(
    70,
    28,
    16,
    52,
    '#a9a29a',
    3,
  )}${poly([[14, 28], [22, 16], [30, 28]], P.crimson)}${poly([[70, 28], [78, 16], [86, 28]], P.crimson)}${poly(
    [[40, 42], [50, 26], [60, 42]],
    P.crimson,
  )}${rect(44, 56, 12, 24, '#4a3728', 6)}<circle cx="62" cy="52" r="5" fill="${P.cream}" opacity="0.85" />`,
  'lux-island': `${ellipse(50, 62, 34, 18, '#f2dfae')}${ellipse(50, 60, 22, 11, 'url(#green)')}<circle cx="50" cy="34" r="13" fill="url(#green)" stroke="${
    P.ink
  }" stroke-width="3.4" />${rect(47, 44, 6, 14, '#8a5c2c', 2)}<path d="M20 74q30 10 60 0" stroke="#7fd0f0" stroke-width="4" fill="none" stroke-linecap="round" />`,
};

const fun = {
  'lux-toilet': `${path('M30 40h40v14q0 12-20 12t-20-12Z', 'url(#gold)')}${rect(
    26,
    30,
    48,
    10,
    'url(#gold)',
    4,
  )}${rect(40, 64, 20, 14, 'url(#gold)', 3)}${shine(38, 34, 8, 0.6)}`,
  'lux-champagne': `${ellipse(50, 52, 32, 22, P.cream)}${ellipse(50, 50, 26, 16, '#f7e2a1')}${circle(
    36,
    48,
    3,
    P.white,
  )}${circle(50,
    44,
    2.4,
    P.white,
  )}${circle(62, 50, 3.4, P.white)}${circle(44, 56, 2.4, P.white)}${path('M50 74v8', 'none')}${coin(24, 40, 6)}`,
  'lux-chef': `${person({ suit: P.white, suitLight: P.cream, tie: null, hat: (cx, cy, s) =>
    `${rect(cx - 11 * s, cy - 18 * s, 22 * s, 16 * s, P.white, 3)}${circle(cx - 7 * s, cy - 20 * s, 6 * s, P.white)}${circle(
      cx + 7 * s,
      cy - 20 * s,
      6 * s,
      P.white,
    )}${circle(cx, cy - 22 * s, 7 * s, P.white)}`,
  })}${star(72, 34, 7)}${star(82, 50, 5)}`,
  'lux-wine': `${path('M40 22h20v16q0 14-10 22-10-8-10-22Z', '#3a1f2e')}${rect(46, 60, 8, 14, '#3a1f2e', 2)}${rect(
    38,
    74,
    24,
    8,
    P.creamDark,
    3,
  )}${rect(42, 40, 16, 10, P.crimson, 2)}`,
  'lux-caviar': `${ellipse(50, 58, 28, 16, '#2b2b30')}${ellipse(50, 55, 20, 10, '#40404a')}${rect(
    22,
    62,
    56,
    14,
    'url(#gold)',
    4,
  )}${path('M60 24l14 6-10 10Z', 'url(#steel)')}${circle(48, 54, 2, P.goldLight)}${circle(56, 52, 2, P.goldLight)}`,
  'lux-square': `${rect(24, 22, 52, 52, P.ink, 2)}${rect(28, 26, 44, 44, '#0d0d10', 1)}${shine(
    40,
    38,
    7,
    0.12,
  )}${rect(20, 72, 60, 6, 'url(#gold)', 2)}`,
  'lux-orchestra': `${circle(32, 64, 12, 'url(#gold)')}${circle(32, 64, 5, P.ink)}${line(
    44,
    64,
    74,
    44,
    5,
    P.inkSoft,
  )}${path('M74 44q10 -6 6 8', 'none')}${line(44, 62, 40, 78, 3)}${line(
    44,
    62,
    34,
    76,
    3,
  )}${star(70, 28, 6)}`,
  'lux-footballclub': `${circle(50, 52, 24, P.white)}${poly([[50, 34], [58, 44], [54, 54], [46, 54], [42, 44]], P.ink)}${path(
    'M50 34l0-10M58 44l10-2M54 54l8 8M46 54l-8 8M42 44l-10-2',
    'none',
  )}`,
  'lux-stadium': `${ellipse(50, 60, 38, 22, 'url(#green)')}${ellipse(50, 60, 26, 13, '#1d7048')}${ellipse(
    50,
    46,
    38,
    18,
    'none',
  )}${rect(12, 42, 6, 18, P.crimson, 2)}${rect(82, 42, 6, 18, P.crimson, 2)}${coin(70, 30, 7)}`,
  'lux-monument': `${rect(38, 30, 24, 44, 'url(#steel)', 6)}${circle(50, 26, 10, 'url(#steel)')}${rect(
    30,
    74,
    40,
    10,
    '#8a8f95',
    3,
  )}${line(50, 34, 60, 44, 3)}${line(40, 44, 60, 44, 3)}`,
  'lux-portrait': `${rect(18, 20, 64, 60, 'url(#gold)', 3)}${rect(23, 25, 54, 50, '#2b3a52', 2)}${person({
    suit: P.crimson,
    hair: '#6b4a2f',
    mustache: true,
    hat: (cx, cy, s) => crown(cx, cy - 11 * s, s * 0.6),
  })}`,
  'lux-fountain': `${ellipse(50, 74, 30, 10, 'url(#steel)')}${path('M20 74q0-20 30-20t30 20Z', 'url(#steel)')}${line(
    50,
    54,
    50,
    34,
    4,
    P.inkSoft,
  )}${drop(50, 30, 1.1)}${drop(38, 42, 0.8)}${drop(62, 42, 0.8)}`,
  'lux-throne': `${poly([[34, 26], [38, 52], [62, 52], [66, 26]], 'url(#gold)')}${rect(
    26,
    52,
    48,
    20,
    'url(#gold)',
    4,
  )}${rect(32, 72, 8, 10, 'url(#gold)', 2)}${rect(60, 72, 8, 10, 'url(#gold)', 2)}${circle(
    50,
    30,
    4,
    P.crimson,
  )}${spark(74, 34, 6)}`,
  'lux-santa': `${person({ suit: P.crimson, suitLight: P.crimsonLight, beard: true, hat: (cx, cy, s) =>
    `${poly([[cx - 14 * s, cy - 8 * s], [cx + 2 * s, cy - 26 * s], [cx + 14 * s, cy - 8 * s]], P.crimson)}<circle cx="${
      cx + 4 * s
    }" cy="${cy - 27 * s}" r="${5 * s}" fill="${P.white}" stroke="${P.ink}" stroke-width="2.6" />`,
  })}${spark(76, 30, 6)}${spark(22, 46, 5)}`,
};

const buildings = {
  refinery: `${factory(18, 42, 64, 34)}${chimney(24, 24, 10, 18)}${chimney(42, 18, 10, 24)}${smoke(
    30,
    16,
    0.8,
  )}${smoke(48, 10, 0.7)}${derrick(76, 76, 22)}`,
  depot: `${tank(22, 44, 26, 32)}${tank(52, 40, 26, 36)}${path('M6 78h88', 'none')}${line(
    38,
    78,
    38,
    84,
    4,
  )}${line(68, 78, 68, 84, 4)}`,
  azs: `${rect(24, 40, 52, 38, P.cream, 3)}${poly([[16, 40], [50, 18], [84, 40]], 'url(#crimson)')}${rect(
    32,
    52,
    16,
    12,
    '#9fd8f2',
    2,
  )}${rect(56, 48, 10, 20, 'url(#gold)', 2)}${line(56, 48, 50, 44, 3)}${circle(71, 74, 3, P.ink)}`,
  pipeline: `${pipe('M6 60q30-16 60 -6t28 4', 'url(#steel)', 10)}${circle(24, 53, 5, 'url(#steelDark)')}${circle(50,
    54,
    5,
    'url(#steelDark)',
  )}${circle(78, 58, 5, 'url(#steelDark)')}${drop(70, 68, 0.9)}`,
  terminal: `${ship(50, 50, 0.9, 'url(#crimson)')}${line(30, 30, 70, 30, 4, P.steelDark)}${rect(
    14,
    62,
    72,
    8,
    'url(#steel)',
    2,
  )}${drop(82, 44, 0.8)}`,
  rail: `${rect(12, 56, 76, 14, 'url(#steel)', 3)}${rect(16, 42, 22, 14, P.inkSoft, 3)}${rect(
    42,
    42,
    22,
    14,
    P.inkSoft,
    3,
  )}${line(20, 70, 20, 82, 4)}${line(80, 70, 80, 82, 4)}${line(8, 84, 92, 84, 3, P.inkSoft)}${circle(
    26,
    74,
    4,
    P.steelLight,
  )}${circle(52, 74, 4, P.steelLight)}`,
  gasplant: `${factory(20, 40, 60, 36, '#a3c7b5')}${path('M30 76v-10h6v10M26 66v-8h6v8M38 76v-10h6v10M34 66v-8h6v8', 'none')}${smoke(
    36,
    26,
    0.9,
  )}${spark(76, 30, 7)}${star(20, 26, 6)}`,
  power: `${rect(28, 34, 44, 44, 'url(#steel)', 4)}${path('M54 40l-8 18h10l-4 18 12-22H52Z', 'url(#gold)')}${chimney(
    24,
    24,
    9,
    14,
  )}${smoke(20,
    16,
    0.6,
  )}${line(36, 78, 30, 84, 4)}${line(64, 78, 70, 84, 4)}`,
  well: `${fill('M12 78q38 -9 76 0v8H12Z', '#8a5c2c', 0.9)}${derrick(38, 76, 46)}${pumpjack(70, 80, 0.72)}${drop(50, 34, 1)}${drop(66, 22, 0.6)}${circle(38, 76, 0)}`,
  motor: `${rect(28, 36, 44, 30, 'url(#steel)', 8)}${path('M72 46l14 6-14 6Z', 'url(#gold)')}${line(
    34,
    30,
    34,
    36,
    4,
  )}${line(66, 30, 66, 36, 4)}${circle(50, 51, 8, 'url(#crimson)')}${star(50, 51, 4, P.cream)}`,
  rss: `${rect(24, 28, 52, 46, 'url(#steel)', 6)}${circle(50, 46, 12, 'url(#gold)')}${path(
    'M42 46l4 12h8l4-12',
    'none',
  )}${line(34, 70, 66, 70, 5)}${circle(50, 46, 4, P.ink)}${spark(74, 32, 6)}`,
  topdrive: `${line(30, 16, 30, 86, 5, P.ink)}${line(70, 16, 70, 86, 5, P.ink)}${line(30, 20, 70, 20, 4, P.ink)}${rect(34, 26, 32, 20, 'url(#gold)', 4)}${circle(50, 36, 6, P.crimson)}${rect(46, 46, 8, 26, 'url(#steel)', 3)}${rect(38, 70, 24, 10, 'url(#steel)', 3)}${line(70, 26, 84, 40, 3)}${circle(84, 44, 5, P.gold)}`,
  mud: `${rect(34, 24, 32, 54, 'url(#steel)', 10)}${rect(40, 32, 20, 12, '#9fd8f2', 3)}${rect(40, 50, 20, 22, '#5f5140', 3)}${drop(50, 44, 0.75)}${circle(50, 62, 4, P.cream)}${circle(50, 70, 3, P.goldLight)}${line(34, 24, 26, 16, 4)}`,
  frac: `${fill('M10 74q40 -12 80 0v12H10Z', '#8a5c2c', 0.85)}${pipe('M50 22v30', 'url(#steel)', 9)}${poly([[50, 52], [34, 72], [40, 74], [50, 62]], '#3b2f26')}${poly([[50, 52], [66, 72], [60, 74], [50, 62]], '#3b2f26')}${poly([[50, 52], [50, 78], [44, 74]], '#3b2f26')}${spark(28, 34, 7)}${spark(72, 30, 6)}${spark(50, 14, 5)}`,
  smart: `${rect(26, 32, 48, 36, P.ink, 5)}${rect(32, 38, 36, 24, '#63d18d', 2)}${path(
    'M38 54l6-8 5 6 6-10 5 12',
    'none',
  )}${line(40, 74, 60, 74, 4)}${circle(38, 26, 4, P.gold)}${circle(62, 26, 4, P.gold)}`,
  esp: `${rect(40, 24, 20, 32, 'url(#steel)', 6)}${rect(42, 56, 16, 22, 'url(#gold)', 4)}${path(
    'M50 60v14',
    'none',
  )}${circle(50, 30, 4, P.crimson)}${drop(74, 40, 0.8)}${drop(26, 52, 0.7)}`,
  twin: `${rect(22, 34, 26, 26, 'url(#steel)', 4)}${rect(52, 34, 26, 26, 'url(#sky)', 4)}${line(
    48,
    47,
    52,
    47,
    3,
  )}${derrick(35, 56, 16)}${derrick(65, 56, 16)}${spark(50, 20, 6)}`,
  neuro: `${circle(50, 50, 22, 'url(#purple)')}${circle(44, 44, 4, P.white)}${circle(58, 44, 4, P.white)}${path(
    'M40 60q10 8 20 0',
    'none',
  )}${line(50, 28, 50, 18, 3)}${circle(50, 16, 4, P.gold)}${spark(74,
    32,
    6,
  )}${spark(26, 68, 5)}`,
  drones: `${rect(28, 44, 44, 18, 'url(#steel)', 5)}${line(20, 44, 26, 34, 3)}${line(80, 44, 74, 34, 3)}${line(
    34,
    40,
    28,
    30,
    2.4,
  )}${line(66, 40, 72, 30, 2.4)}${circle(50, 53, 5, 'url(#crimson)')}${line(36, 62, 64, 62, 3)}`,
  roga: `${rect(20, 46, 60, 32, P.cream, 3)}${rect(20, 38, 60, 10, 'url(#crimson)', 3)}${rect(
    44,
    58,
    14,
    20,
    '#8a5c2c',
    2,
  )}${path('M28 38q-10-6-6-16 2 6 10 8', 'url(#cream)')}${path('M72 38q10-6 6-16-2 6-10 8', '#e6d6b4')}${circle(34,
    66,
    4,
    P.inkSoft,
  )}${circle(66,
    66,
    4,
    P.inkSoft,
  )}${line(30, 54, 70, 54, 2, P.inkSoft)}`,
  krs: `${derrick(34, 78, 40)}${rect(52, 48, 30, 30, 'url(#gold)', 4)}${rect(56, 52, 22, 14, '#14202e', 2)}${line(60, 58, 74, 58, 2, P.greenLight)}${circle(70, 70, 5, P.ink)}${drop(24, 40, 0.8)}${spark(76, 36, 5)}`,
  dashboard: `${rect(20, 26, 60, 48, P.ink, 4)}${rect(26, 32, 48, 26, '#14202e', 2)}${path(
    'M30 52l8-8 6 6 8-12 8 14',
    'none',
  )}${fill('M30 52l8-8 6 6 8-12 8 14', 'none')}${rect(30, 64, 14, 6, P.gold, 2)}${rect(
    48,
    64,
    20,
    6,
    P.green,
    2,
  )}`,
};

// ------------------------------------------------------------- политические

const political = {
  monarch: `${person({ suit: P.crimson, hat: (cx, cy, s) => crown(cx, cy - 12 * s, s * 0.8), mustache: true })}${coin(
    24,
    32,
    8,
  )}${coin(76, 44, 6)}`,
  forum: `${rect(28, 46, 44, 30, 'url(#crimson)', 4)}${rect(20, 22, 60, 24, 'url(#gold)', 3)}${line(
    30,
    74,
    26,
    82,
    4,
  )}${line(70,
    74,
    74,
    82,
    4,
  )}${coin(34, 34, 7)}${coin(66, 34, 7)}`,
  forum2: `${rect(26, 44, 48, 32, 'url(#crimson)', 4)}${rect(18, 20, 64, 26, 'url(#gold)', 3)}${coin(
    32,
    33,
    6,
  )}${coin(50,
    33,
    6,
  )}${coin(68,
    33,
    6,
  )}${path('M40 66q10 8 20 0', 'none')}`,
  ministry: `${facade()}${stamp(70, 44, 12)}`,
  sauna: sauna(),
  senate: `${facade()}${person({ suit: P.oil, baseY: 82, scale: 0.55, cx: 50 })}${line(
    26,
    40,
    74,
    40,
    3,
    P.creamDark,
  )}`,
  fund: `${rect(26, 34, 48, 44, P.cream, 4)}${path(
    'M50 44c-7-10-20-2 0 14 20-16 7-24 0-14Z',
    'url(#crimson)',
  )}${line(50,
    64,
    50,
    68,
    3,
  )}${coin(72, 30, 6)}`,
  offshore: `${ellipse(50, 66, 32, 14, '#f2dfae')}${rect(38, 40, 24, 26, P.cream, 3)}${poly(
    [[38, 40], [50, 26], [62, 40]],
    P.crimson,
  )}${circle(72, 40, 9, 'url(#green)')}${circle(72,
    40,
    9,
    'none',
  )}${path('M18 74q30 10 60 0', 'none')}`,
  optimize: `${document(28, 28, 44, 50)}${line(38, 46, 62, 46, 3)}${line(38, 56, 58, 56, 3)}${circle(
    68,
    66,
    11,
    'url(#green)',
  )}${path('M62 66l4 5 8-10', 'none')}`,
  export: `${ship(46, 50, 0.95, 'url(#crimson)')}${line(60, 46, 84, 30, 4, P.greenDark)}${poly(
    [[84, 30], [74, 28], [80, 38]],
    'url(#green)',
  )}${drop(24, 66, 0.9)}${coin(76, 66, 7)}`,
  crisis: `${circle(50, 50, 24, 'url(#crimson)')}${path('M50 32v22', 'none')}${circle(
    50,
    62,
    3.6,
    P.cream,
  )}${spark(20, 24, 6)}${spark(80, 30, 5)}${spark(24, 74, 5)}`,
  fuelcrisis: `${rect(28, 34, 34, 44, 'url(#gold)', 4)}${rect(40, 24, 12, 10, P.inkSoft, 3)}${path(
    'M62 44h10q4 0 4 6v20',
    'none',
  )}${path('M50 44l-8 18h10l-6 16 14-22H50Z', 'url(#crimson)')}`,
  lawyer: `${document(26, 24, 42, 56)}${line(36, 38, 58, 38, 3)}${rect(58, 52, 24, 18, '#8a5c2c', 3)}${line(
    62,
    52,
    62,
    44,
    3,
  )}${line(78,
    52,
    78,
    44,
    3,
  )}${coin(72, 30, 6)}`,
  field: `${fill('M8 78q42 -10 84 0v10H8Z', '#8a5c2c', 0.9)}${fill('M8 56q30 -8 84 4 -34 10 -84 4Z', 'url(#oil)', 0.95)}${derrick(40, 74, 34)}${line(62, 60, 62, 78, 4, P.inkSoft)}${drop(74, 50, 0.9)}${coin(22, 32, 7)}`,
  'refinery-grab': `${factory(18, 42, 60, 34)}${chimney(26, 24, 10, 18)}${path('M66 26l18 6-14 10Z', 'url(#gold)')}${circle(
    72,
    66,
    7,
    'url(#green)',
  )}${path('M68 66l3 4 6-7', 'none')}`,
  press: `${rect(18, 22, 64, 14, 'url(#steel)', 4)}${rect(40, 36, 20, 18, 'url(#crimson)', 3)}${rect(20, 62, 60, 20, 'url(#steelDark)', 4)}${path('M34 62q0-10 8-10t8 10', 'none')}${circle(70, 72, 5, P.cream)}${line(20, 56, 80, 56, 3, P.ink)}${star(84, 26, 7)}`,
  gov: `${facade()}${person({ suit: P.ink, baseY: 80, scale: 0.5, tie: P.gold, cx: 50 })}${coin(
    74,
    26,
    7,
  )}${coin(26, 26, 6)}`,
  contractor: `${person({ suit: '#c9a227', smiling: false })}${path('M62 62l16 -14', 'none')}${spark(
    80,
    40,
    6,
  )}${spark(64, 80, 5)}`,
  newspaper: `${rect(20, 30, 60, 44, P.cream, 3)}${rect(26, 36, 24, 12, P.steelDark, 2)}${line(
    56,
    38,
    74,
    38,
    2.4,
  )}${line(56, 44, 74, 44, 2.4)}${line(26, 56, 74, 56, 2.4)}${line(26,
    62,
    66,
    62,
    2.4,
  )}${line(26,
    68,
    74,
    68,
    2.4,
  )}`,
  puppy: `${circle(50, 56, 20, '#c98f52')}${circle(34, 44, 8, '#a9743c')}${circle(
    66,
    44,
    8,
    '#a9743c',
  )}${circle(44, 52, 3, P.ink)}${circle(56, 52, 3, P.ink)}${ellipse(50, 64, 5, 4, P.ink)}${path(
    'M50 68q-6 6-2 10',
    'none',
  )}${path('M50 30l-8 8h16Z', 'url(#gold)')}`,
  temple: temple(),
  expertise: `${document(24, 24, 40, 56)}${line(32, 38, 56, 38, 3)}${line(32,
    48,
    52,
    48,
    3,
  )}${stamp(66, 62, 14)}${star(76, 26, 7)}`,
};

function facade() {
  const parts = [rect(22, 40, 56, 40, P.cream, 3)];
  parts.push(poly([[16, 40], [50, 20], [84, 40]], 'url(#crimson)'));
  for (let i = 0; i < 4; i++) parts.push(rect(28 + i * 12, 46, 7, 28, P.creamDark, 1.5));
  parts.push(rect(22, 74, 56, 6, P.creamDark, 2));
  return group(parts);
}

// -------------------------------------------------------------- технические

const drills = {
  'drill-blade': `${rect(42, 22, 16, 24, 'url(#steel)', 4)}${poly(
    [[34, 46], [66, 46], [58, 74], [42, 74]],
    'url(#steel)',
  )}${line(40, 56, 60, 56, 2.4)}${line(44, 66, 56, 66, 2.4)}`,
  'drill-milled': rollerBit(50, 52, 1),
  'drill-tci': `${rollerBit(50, 52, 1)}${circle(39, 50, 2, P.goldLight)}${circle(61,
    50,
    2,
    P.goldLight,
  )}${circle(50,
    62,
    2,
    P.goldLight,
  )}${spark(76, 26, 5)}`,
  'drill-hybrid': `${rect(44, 20, 12, 18, 'url(#gold)', 3)}${circle(38,
    54,
    10,
    'url(#steel)',
  )}${poly([[52, 42], [68, 52], [56, 74], [48, 60]], 'url(#crimson)')}${circle(50,
    50,
    3,
    P.ink,
  )}`,
  'drill-pdc': `${rect(44, 18, 12, 16, 'url(#gold)', 3)}${poly(
    [[44, 34], [56, 34], [62, 74], [38, 74]],
    'url(#sky)',
  )}${path('M50 38v30', 'none')}${gem(50, 46, 0.7, P.white)}${gem(50, 56, 0.7, P.white)}${spark(
    72,
    30,
    5,
  )}`,
  'drill-impreg': `${rect(44, 16, 12, 14, 'url(#gold)', 3)}${poly(
    [[42, 30], [58, 30], [64, 76], [36, 76]],
    '#26303a',
  )}${circle(50, 40, 1.8, P.sky)}${circle(50, 50, 1.8, P.sky)}${circle(50,
    60,
    1.8,
    P.sky,
  )}${circle(50,
    70,
    1.8,
    P.sky,
  )}${circle(44,
    46,
    1.6,
    P.sky,
  )}${circle(56,
    56,
    1.6,
    P.sky,
  )}`,
  'drill-terminator': `${rect(42, 14, 16, 12, 'url(#crimson)', 3)}${poly(
    [[40, 26], [60, 26], [68, 78], [32, 78]],
    'url(#steel)',
  )}${path('M50 30v42', 'none')}${path('M36 44l14 6M64 44l-14 6M34 62l16 6M66 62l-16 6', 'none')}${circle(
    50,
    40,
    4,
    P.crimson,
  )}${circle(50, 58, 4, P.crimson)}${spark(76, 24, 6)}${spark(24, 30, 5)}`,
};

const pumps = {
  'pump-piston': `${rect(20, 42, 40, 26, 'url(#steel)', 5)}${rect(24, 30, 12, 12, 'url(#crimson)', 3)}${rect(50, 34, 22, 10, 'url(#gold)', 3)}${circle(74, 46, 11, 'url(#steel)')}${circle(74, 46, 4, P.ink)}${line(44, 46, 50, 46, 4)}${rect(14, 68, 72, 8, 'url(#steelDark)', 3)}${drop(88, 62, 0.6)}`,
  'pump-hp': `${rect(22, 36, 56, 36, 'url(#crimson)', 6)}${circle(50, 54, 12, 'url(#gold)')}${line(
    50,
    54,
    58,
    46,
    3,
  )}${rect(40, 20, 20, 16, 'url(#steel)', 3)}${line(22, 44, 12, 44, 3)}${line(88,
    44,
    78,
    44,
    3,
  )}${spark(76,
    26,
    5,
  )}`,
  'pump-digital': `${rect(24, 38, 52, 34, P.ink, 5)}${rect(30, 44, 26, 14, '#63d18d', 2)}${path(
    'M34 54l5-6 4 4 5-8 4 10',
    'none',
  )}${circle(66, 52, 6, 'url(#gold)')}${rect(40, 26, 20, 10, 'url(#steel)', 2)}`,
  'pump-giant': `${rect(14, 32, 72, 46, 'url(#gold)', 8)}${circle(50, 55, 18, 'url(#steel)')}${circle(
    50,
    55,
    8,
    'url(#crimson)',
  )}${rect(30, 72, 40, 10, P.inkSoft, 3)}${star(50, 24, 9)}${spark(16,
    24,
    5,
  )}${spark(84,
    30,
    6,
  )}`,
};

const geology = {
  carat: `${rect(28, 34, 44, 40, 'url(#crimson)', 4)}${rect(34, 40, 32, 18, '#14202e', 2)}${path(
    'M38 52l6-6 5 5 6-8 5 9',
    'none',
  )}${rect(44, 22, 12, 12, 'url(#steel)', 2)}${circle(50, 78, 4, P.gold)}`,
  imager: `${circle(50, 50, 24, '#14202e')}${circle(50, 50, 16, 'url(#sky)')}${path(
    'M50 34v32M34 50h32',
    'none',
  )}${circle(50,
    50,
    6,
    P.ink,
  )}${spark(76,
    30,
    5,
  )}`,
  cartographer: `${rect(22, 30, 56, 44, P.cream, 2)}${path('M22 44h22v30H22M66 30v22h12', 'none')}${path(
    'M60 44l8 8 8-4',
    'none',
  )}${circle(58, 56, 3.6, 'url(#crimson)')}${line(58, 56, 44, 68, 3)}`,
  mwd: `${rect(30, 30, 40, 40, P.ink, 5)}${rect(36, 36, 28, 16, '#63d18d', 2)}${path(
    'M42 44h4l3-5 3 10 3-7h5',
    'none',
  )}${line(50, 22, 50, 30, 4)}${circle(50, 18, 5, 'url(#crimson)')}${spark(76,
    66,
    5,
  )}`,
  resist: `${circle(50, 54, 24, 'url(#steel)')}${path('M26 54a24 24 0 0 1 48 0Z', '#14202e')}${fill('M26 54a24 24 0 0 1 48 0Z', 'url(#sky)', 0.35)}${line(50, 54, 50, 34, 3, P.gold)}${line(50, 54, 66, 44, 3, P.gold)}${line(50, 54, 34, 44, 3, P.gold)}${circle(50, 54, 4, P.cream)}${rect(40, 76, 20, 8, 'url(#crimson)', 3)}${spark(76, 26, 6)}`,
  core: `${rect(34, 26, 32, 56, 'url(#steel)', 6)}${rect(42, 24, 16, 10, P.inkSoft, 3)}${circle(
    50,
    46,
    8,
    '#8a5c2c',
  )}${circle(50,
    62,
    6,
    '#6b4a2f',
  )}${drop(72,
    36,
    0.8,
  )}`,
};

const staff = {
  geomav: `${person({ suit: P.ink, tie: P.gold, glasses: true })}${coin(76, 34, 7)}${spark(
    24,
    30,
    5,
  )}`,
  gti: `${person({ suit: '#3d5568', tie: P.green, hat: (cx, cy, s) =>
    `${path(`M${cx - 13 * s} ${cy - 6 * s}q${13 * s} ${-14 * s} ${26 * s} 0Z`, P.gold)}`,
  })}${coin(24, 36, 7)}${coin(76, 40, 7)}`,
  brigade: `${person({ suit: '#e0762a', tie: null, cx: 32, baseY: 78, scale: 0.62 })}${person({ suit: '#e0762a', tie: null, cx: 68, baseY: 78, scale: 0.62 })}${person({ suit: '#c9622a', tie: null, cx: 50, baseY: 88, scale: 0.8 })}${star(76, 68, 7)}`,
  technolog: `${person({ suit: P.oil, tie: P.gold, glasses: true })}${rect(70, 40, 18, 20, 'url(#steel)', 3)}${path(
    'M74 46h10v8H74Z',
    '#63d18d',
  )}`,
};

// --------------------------------------------------------------- финал и лого

const special = {
  'win-pump': `${rect(10, 30, 80, 48, 'url(#gold)', 10)}${circle(50, 54, 20, 'url(#steel)')}${circle(
    50,
    54,
    9,
    'url(#crimson)',
  )}${path('M30 54h-14M70 54h14', 'none')}${star(50,
    20,
    9,
  )}${star(24,
    26,
    6,
  )}${star(76,
    26,
    6,
  )}${drop(50, 84, 0.7)}`,
};


// ------------------------------------------------- новые механики (v2)
// ЧВК, убыточный банк, отмывание, реприватизация — отдельные сюжеты,
// а не переиспользованные иконки политики.
const extra = {
  // ЧВК: щит, каска и звезда.
  'pmc-chvk': `${path('M50 14l30 10v26c0 18-14 28-30 36C34 78 20 68 20 50V24Z', P.oliveDark)}${path('M50 22l22 7v22c0 14-10 22-22 29-12-7-22-15-22-29V29Z', 'none')}${path('M32 46h36l-4 8H36Z', 'url(#steel)')}${star(50, 66, 9)}`,
  // Ветераны охраны: щит с двумя шевронами.
  'pmc-vet': `${path('M50 16l28 9v24c0 17-13 26-28 33-15-7-28-16-28-33V25Z', P.oliveDark)}${path('M34 52l16 14 16-14', 'none')}${path('M34 44l16 14 16-14', 'none')}`,
  // Убыточный банк: здание с колоннами и зачёркнутая монета.
  'badbank': `${rect(24, 38, 52, 40, P.cream, 4)}${poly([[18, 38], [50, 22], [82, 38]], 'url(#steel)')}${rect(32, 48, 8, 22, 'url(#steel)', 2)}${rect(46, 48, 8, 22, 'url(#steel)', 2)}${rect(60, 48, 8, 22, 'url(#steel)', 2)}${circle(68, 66, 15, 'url(#crimson)')}${line(60, 74, 76, 58, 3.4, P.cream)}`,
  // Отмывание: стиральная машина с монетой внутри — визуальная шутка,
  // которая читается сразу и не путается с канистрой.
  'launder': `${rect(22, 20, 56, 62, P.cream, 8)}${rect(30, 28, 40, 12, 'url(#steel)', 4)}${circle(36, 34, 3.4, 'url(#green)')}${circle(64, 34, 3.4, 'url(#gold)')}${circle(50, 58, 19, 'url(#steel)')}${circle(50, 58, 13, 'url(#sky)')}${coin(50, 58, 8)}${path('M30 76q20 8 40 0', 'none')}`,
  // Закон о налоговом вычете: бумага с параграфом, печатью и перечёркнутой монетой.
  'papers': `${document(20, 16, 46, 60)}${path('M40 40h12M40 50h12M40 60h8', 'none')}${circle(66, 62, 16, 'url(#crimson)')}${coin(66, 62, 7)}${line(56, 72, 76, 52, 3.4, P.crimson)}${stamp(74, 30, 12)}`,
  // Реприватизация: завод с чужой печатью и галочкой «теперь наше».
  'reprivat': `${factory(16, 52, 40, 26)}${circle(44, 44, 13, 'url(#crimson)')}${line(38, 44, 43, 50, 3.4, P.cream)}${line(43, 50, 51, 38, 3.4, P.cream)}${stamp(74, 64, 15)}`,
};

// --------------------------------------------------------------- сборка

const icons = {
  ...extra,
  ...buildings,
  ...drills,
  ...pumps,
  ...geology,
  ...staff,
  ...political,
  ...yachts,
  ...cars,
  ...bling,
  ...realty,
  ...fun,
  ...special,
};

/** Всё, что не описано выше — собираем по типу/группе. */
/** Иконки покупок этапа 5: банк-масштаб, ЧОП, телеканал, секретарь, трубы и ветка. */
icons['bank-scale'] = `${rect(20, 40, 60, 40, P.cream, 4)}${poly([[14, 40], [50, 22], [86, 40]], 'url(#gold)')}${rect(28, 48, 8, 24, 'url(#steel)', 2)}${rect(46, 48, 8, 24, 'url(#steel)', 2)}${rect(64, 48, 8, 24, 'url(#steel)', 2)}${path('M18 80h64', 'none')}${path('M62 22l14 -8 6 10-14 8Z', 'url(#green)')}${circle(78, 18, 7, 'url(#gold)')}${line(74, 18, 82, 14, 3, P.ink)}`;

icons['bank-payroll'] = `${rect(24, 30, 48, 30, 'url(#steel)', 4)}${rect(30, 36, 20, 12, 'url(#gold)', 2)}${line(38, 42, 46, 42, 2, P.ink)}${circle(64, 50, 6, 'url(#crimson)')}${coin(50, 74, 12)}${path('M20 74h60', 'none')}${spark(78, 30, 6)}`;

icons['pmc-chop'] = `${path('M50 14l30 10v26c0 18-14 28-30 36C34 78 20 68 20 50V24Z', P.oliveDark)}${path('M50 22l22 7v22c0 14-10 22-22 29-12-7-22-15-22-29V29Z', 'none')}${rect(38, 40, 24, 18, 'url(#steel)', 3)}${path('M44 40v-6a6 6 0 0 1 12 0v6', 'none')}${rect(60, 44, 16, 10, 'url(#gold)', 3)}`;

icons['tv-channel'] = `${rect(18, 32, 64, 44, P.ink, 5)}${rect(25, 38, 50, 32, '#14202e', 2)}${path('M32 58l10 -10 8 8 12 -14 8 10', 'none')}${path('M68 56l6 -8', 'none')}${line(50, 24, 38, 12, 4, P.steel)}${line(50, 24, 62, 12, 4, P.steel)}${star(84, 26, 7)}`;

icons['secretary'] = `${facade()}${person({ suit: P.ink, tie: P.gold, baseY: 84, scale: 0.55, cx: 50 })}${document(62, 20, 26, 32)}${stamp(76, 36, 11)}${star(22, 26, 6)}`;

icons['rail-branch'] = `${rect(10, 58, 80, 12, 'url(#steel)', 3)}${line(18, 64, 28, 76, 4, P.inkSoft)}${line(28, 76, 40, 64, 4, P.inkSoft)}${line(60, 64, 72, 76, 4, P.inkSoft)}${line(72, 76, 82, 64, 4, P.inkSoft)}${rect(18, 34, 40, 20, 'url(#crimson)', 4)}${circle(28, 78, 7, 'url(#gold)')}${circle(72, 78, 7, 'url(#gold)')}${drop(76, 20, 0.7)}`;

icons['refinery-pipe'] = `${factory(16, 44, 40, 28)}${pipe('M56 58h22q10 0 10 10v12', 'url(#steel)', 10)}${circle(78, 74, 6, 'url(#steelDark)')}${drop(42, 24, 0.7)}${spark(30, 22, 6)}`;

icons['export-pipe'] = `${fill('M4 74q46 10 92 0v12H4Z', '#8a5c2c', 0.55)}${pipe('M6 62q30 -10 46 0t42 -6', 'url(#steel)', 12)}${circle(34, 57, 8, 'url(#gold)')}${circle(34, 57, 3.4, P.ink)}${circle(78, 57, 8, 'url(#gold)')}${circle(78, 57, 3.4, P.ink)}${rect(46, 22, 6, 30, P.crimson, 2)}${poly([[42, 22], [56, 22], [49, 12]], 'url(#gold)')}${drop(88, 30, 0.75)}`;

icons['export-terminal'] = `${fill('M2 80q48 8 96 0v14H2Z', 'url(#sky)', 0.5)}${rect(8, 68, 84, 8, 'url(#steel)', 3)}${rect(10, 42, 26, 26, 'url(#gold)', 4)}${rect(16, 38, 14, 6, 'url(#steel)', 2)}${ship(66, 62, 0.7, 'url(#crimson)')}${line(34, 56, 52, 56, 6, P.steelDark)}${rect(52, 24, 6, 26, P.inkSoft, 2)}${line(55, 24, 76, 18, 4, P.inkSoft)}${circle(76, 18, 5, 'url(#gold)')}${drop(46, 20, 0.6)}`;

const FALLBACKS = {
  technical: (def) => `${factory(24, 44, 50, 32)}${spark(72, 30, 6)}`,
  political: (def) => `${facade()}${coin(72, 30, 7)}`,
  luxury: (def) => `${coin(50, 50, 20)}${shine(42, 42, 9, 0.6)}`,
  goals: (def) => `${star(50, 50, 22)}`,
};

function build(iconName) {
  if (icons[iconName] && icons[iconName].trim()) return icon(icons[iconName]);
  return null;
}

function main() {
  const contentPath = resolve(here, '../src/content/upgrades.json');
  const data = JSON.parse(readFileSync(contentPath, 'utf8'));
  mkdirSync(outDir, { recursive: true });

  let created = 0;
  const missing = [];
  for (const def of data.upgrades) {
    const svg = build(def.icon);
    if (!svg) {
      missing.push(def.icon);
      const fallback = (FALLBACKS[def.tab] ?? FALLBACKS.technical)(def);
      writeFileSync(resolve(outDir, `${def.icon}.svg`), icon(fallback), 'utf8');
      created++;
      continue;
    }
    writeFileSync(resolve(outDir, `${def.icon}.svg`), svg, 'utf8');
    created++;
  }
  if (missing.length) console.log('собрано из фолбэка:', missing.join(', '));
  console.log(`готово: ${created} иконок в public/images/icons`);
}

main();
