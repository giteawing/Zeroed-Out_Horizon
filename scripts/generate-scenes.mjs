/**
 * Генератор крупной графики: фон, логотип и финал.
 * Запуск: npm run art.
 *
 * Модуль можно импортировать: `buildScenes()` возвращает готовые SVG и ничего
 * не пишет. Файлы создаются только при прямом запуске; `--out <папка>`
 * позволяет собрать сцены во временную папку и сравнить с `public/images`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PALETTE as P,
  STROKE,
  argValue,
  assertSvg,
  character,
  chimney,
  circle,
  coin,
  crown,
  derrick,
  drop,
  ellipse,
  fill,
  group,
  isMainModule,
  line,
  path,
  poly,
  rect,
  shine,
  smoke,
  spark,
  star,
  topHat,
} from './lib/art.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const imgDir = resolve(here, '../public/images');

/**
 * Примитивы из art.mjs (`coin`, `drop`, `character`…) ссылаются на градиенты
 * иконок: `url(#gold)`, `url(#oil)`. У сцен свои градиенты с суффиксом Grad,
 * поэтому без перевода имён ссылка указывала в пустоту: монеты и капли в
 * логотипе и финале теряли заливку. Раньше это чинили руками в готовых
 * файлах — до следующего `npm run art`.
 */
const SCENE_GRADIENTS = {
  gold: 'goldGrad',
  oil: 'oilGrad',
  skin: 'skinGrad',
  steel: 'steelGrad',
};

/** Перевести ссылки на градиенты иконок в градиенты сцены. */
function scene(svg) {
  return svg.replace(/url\(#([A-Za-z0-9_-]+)\)/g, (match, id) =>
    Object.hasOwn(SCENE_GRADIENTS, id) ? `url(#${SCENE_GRADIENTS[id]})` : match);
}

const DEFS = `
<defs>
  <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#1d2b45" />
    <stop offset="45%" stop-color="#5a3b56" />
    <stop offset="100%" stop-color="#c8763a" />
  </linearGradient>
  <linearGradient id="oilGrad" x1="0" y1="0" x2="0.3" y2="1">
    <stop offset="0%" stop-color="#4a4a52" />
    <stop offset="100%" stop-color="#1c1c20" />
  </linearGradient>
  <linearGradient id="goldGrad" x1="0" y1="0" x2="0.35" y2="1">
    <stop offset="0%" stop-color="#ffd766" />
    <stop offset="55%" stop-color="#f2b430" />
    <stop offset="100%" stop-color="#c8860f" />
  </linearGradient>
  <linearGradient id="steelGrad" x1="0" y1="0" x2="0.25" y2="1">
    <stop offset="0%" stop-color="#d7dee3" />
    <stop offset="55%" stop-color="#9aa4ad" />
    <stop offset="100%" stop-color="#6d7780" />
  </linearGradient>
  <linearGradient id="rockGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#8a6a4a" />
    <stop offset="100%" stop-color="#5c4029" />
  </linearGradient>
  <linearGradient id="skinGrad" x1="0" y1="0" x2="0.3" y2="1">
    <stop offset="0%" stop-color="#ffd3ae" />
    <stop offset="100%" stop-color="#e8a878" />
  </linearGradient>
</defs>`;

// ------------------------------------------------------------------ фон

const bg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" role="img">
${DEFS}
  <rect width="1920" height="1080" fill="url(#skyGrad)" />
  <circle cx="1520" cy="250" r="120" fill="#ffd766" opacity="0.18" />
  <circle cx="1520" cy="250" r="72" fill="#ffdf8a" opacity="0.5" />
  <!-- дальние вышки -->
  <g opacity="0.32" fill="#141b2a">
    ${[140, 420, 700, 980, 1260, 1540, 1820].map((x, i) => derrick(x, 760, 150 + (i % 3) * 40, '#141b2a')).join('')}
  </g>
  <!-- заводы -->
  <g opacity="0.45">
    ${[240, 980, 1620]
      .map(
        (x) =>
          `${rect(x, 700, 260, 130, '#1c2434', 6)}${chimney(x + 30, 620, 26, 84, '#1c2434')}${chimney(
            x + 80,
            580,
            22,
            124,
            '#1c2434',
          )}${chimney(x + 190, 640, 24, 64, '#1c2434')}`,
      )
      .join('')}
  </g>
  <!-- дым -->
  <g opacity="0.22">
    ${smoke(300, 540, 3.4)}${smoke(380, 480, 2.6)}${smoke(1040, 520, 3.8)}${smoke(1100, 450, 2.8)}${smoke(1690, 560, 3.2)}
  </g>
  <!-- факел -->
  <g opacity="0.5">
    ${line(1400, 700, 1400, 430, 10, '#1c2434')}
    <ellipse cx="1400" cy="404" rx="26" ry="46" fill="#ffb03a" opacity="0.9" />
    <ellipse cx="1400" cy="418" rx="14" ry="28" fill="#fff2b0" opacity="0.9" />
  </g>
  <!-- земля -->
  <path d="M0 810q480 -34 960 -6t960 10v266H0Z" fill="#241a14" />
  <path d="M0 860q480 -26 960 -4t960 14v180H0Z" fill="#171210" />
  <!-- нефтяной пласт в разрезе -->
  <g opacity="0.85">
    <path d="M0 980q480 -30 960 -2t960 6v96H0Z" fill="url(#oilGrad)" stroke="${P.ink}" stroke-width="8" />
    ${Array.from({ length: 14 }, (_, i) => `<circle cx="${90 + i * 140}" cy="${1000 + (i % 3) * 22}" r="${8 + (i % 4) * 5}" fill="#15151a" opacity="0.9" />`).join('')}
  </g>
  <!-- трубы по горизонту -->
  <g opacity="0.35">
    ${line(0, 940, 1920, 928, 14, '#3a3a42')}${line(0, 908, 1920, 898, 8, '#2b2b32')}
  </g>
  <!-- световые блики -->
  <circle cx="300" cy="180" r="220" fill="#fff" opacity="0.04" />
  <circle cx="1200" cy="120" r="320" fill="#fff" opacity="0.03" />
</svg>
`;

// --------------------------------------------------------------- логотип

const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 660 330" role="img">
${DEFS}
  <g transform="translate(6,4)">
    <!-- подложка-плашка -->
    <path d="M8 168h644a30 30 0 0 1 -30 30H38a30 30 0 0 1 -30 -30Z" fill="#1c1c20" opacity="0.22" />

    <!-- вышка с монетой -->
    ${derrick(104, 250, 150, P.ink)}
    ${circle(104, 92, 44, 'url(#goldGrad)')}
    ${circle(104, 92, 31, P.ink)}
    <path d="M104 66v26l18 11" fill="none" stroke="#ffd766" stroke-width="8" stroke-linecap="round" />
    ${rect(72, 244, 64, 12, P.ink, 4)}

    <!-- текст -->
    <text x="196" y="96" font-family="Georgia, 'Times New Roman', serif" font-size="54" font-weight="700"
      fill="url(#goldGrad)" stroke="${P.ink}" stroke-width="8" paint-order="stroke" letter-spacing="1">ИМПЕРИЯ</text>
    <text x="196" y="164" font-family="Georgia, 'Times New Roman', serif" font-size="50" font-weight="700"
      fill="#fdf3dd" stroke="${P.ink}" stroke-width="8" paint-order="stroke" letter-spacing="1">НУЛЕВОГО</text>
    <text x="196" y="232" font-family="Georgia, 'Times New Roman', serif" font-size="50" font-weight="700"
      fill="#fdf3dd" stroke="${P.ink}" stroke-width="8" paint-order="stroke" letter-spacing="2">ГОРИЗОНТА</text>

    <!-- акценты -->
    ${drop(268, 44, 1.1)}${drop(300, 30, 0.7)}${drop(600, 268, 1)}
    ${spark(628, 60, 12)}${spark(40, 40, 9)}
  </g>
</svg>
`;

// ------------------------------------------------------------- финал

const finale = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img">
${DEFS}
  <rect width="1024" height="1024" fill="#2a1d18" />
  <circle cx="512" cy="470" r="430" fill="#3a2a20" />
  <circle cx="512" cy="470" r="430" fill="none" stroke="#f2b430" stroke-width="10" opacity="0.5" />
  <!-- лучи -->
  <g opacity="0.14">
    ${Array.from({ length: 16 }, (_, i) => {
      const a = (Math.PI * 2 * i) / 16;
      return `<path d="M512 470L${(512 + Math.cos(a) * 500).toFixed(0)} ${(470 + Math.sin(a) * 500).toFixed(0)}L${(512 + Math.cos(a + 0.12) * 500).toFixed(0)} ${(470 + Math.sin(a + 0.12) * 500).toFixed(0)}Z" fill="#f2b430" />`;
    }).join('')}
  </g>

  <!-- гора монет -->
  <g>
    ${Array.from({ length: 26 }, (_, i) => {
      const col = i % 13;
      const row = Math.floor(i / 13);
      const x = 220 + col * 48 + row * 20;
      const y = 860 - row * 46 - (col % 3) * 8;
      return coin(x, y, 26);
    }).join('')}
    ${coin(214, 900, 30)}${coin(300, 916, 26)}${coin(760, 894, 30)}${coin(690, 918, 24)}
  </g>

  <!-- ванна -->
  <g>
    <path d="M250 700h524v96a92 92 0 0 1 -92 92H342a92 92 0 0 1 -92 -92Z" fill="#fdf3dd" stroke="${P.ink}" stroke-width="12" />
    <path d="M250 700h524" stroke="${P.ink}" stroke-width="12" fill="none" />
    <ellipse cx="512" cy="700" rx="262" ry="42" fill="#ffd766" opacity="0.9" />
    ${Array.from({ length: 9 }, (_, i) => coin(300 + i * 52, 696 + (i % 3) * 12, 18)).join('')}
    <path d="M774 720h72a34 34 0 0 1 34 34v34" fill="none" stroke="#9aa4ad" stroke-width="16" stroke-linecap="round" />
    <path d="M232 720h-58a30 30 0 0 0 -30 30v26" fill="none" stroke="#9aa4ad" stroke-width="16" stroke-linecap="round" />
  </g>

  <!-- буржуй -->
  <g id="bourgeois">
    <!-- спина и тело в ванне -->
    <path d="M400 700q0-104 112-104t112 104Z" fill="url(#skinGrad)" stroke="${P.ink}" stroke-width="12" />
    <!-- голова -->
    ${circle(512, 505, 128, 'url(#skinGrad)')}
    <!-- щёки -->
    <circle cx="430" cy="540" r="26" fill="#e8836a" opacity="0.55" />
    <circle cx="594" cy="540" r="26" fill="#e8836a" opacity="0.55" />
    <!-- глаза -->
    <ellipse cx="462" cy="492" rx="17" ry="20" fill="${P.ink}" />
    <ellipse cx="562" cy="492" rx="17" ry="20" fill="${P.ink}" />
    <circle cx="468" cy="486" r="6" fill="#fff" />
    <circle cx="568" cy="486" r="6" fill="#fff" />
    <!-- брови -->
    <path d="M436 458q26-16 52-4" fill="none" stroke="${P.ink}" stroke-width="10" stroke-linecap="round" />
    <path d="M536 454q26-12 52 4" fill="none" stroke="${P.ink}" stroke-width="10" stroke-linecap="round" />
    <!-- усы -->
    <path d="M456 556q56-26 112 0q-56 26 -112 0Z" fill="${P.inkSoft}" stroke="${P.ink}" stroke-width="7" />
    <!-- улыбка -->
    <path d="M474 596q38 30 76 0" fill="none" stroke="${P.ink}" stroke-width="10" stroke-linecap="round" />
    <!-- двойной подбородок -->
    <path d="M458 640q54 30 108 0" fill="none" stroke="${P.ink}" stroke-width="7" opacity="0.45" />
    <!-- цилиндр -->
    ${rect(430, 356, 164, 96, P.ink, 8)}
    ${rect(404, 440, 216, 26, P.ink, 8)}
    <path d="M446 366h26v74h-26Z" fill="#ffffff" opacity="0.14" />
    <path d="M430 404h164" stroke="#f2b430" stroke-width="9" />
    <!-- сигара -->
    <g>
      <path d="M628 596q76-30 132-14" fill="none" stroke="#6b4a2f" stroke-width="22" stroke-linecap="round" />
      <path d="M628 596q76-30 132-14" fill="none" stroke="${P.ink}" stroke-width="26" stroke-linecap="round" opacity="0.25" />
      <path d="M628 596q76-30 132-14" fill="none" stroke="#8a5c2c" stroke-width="18" stroke-linecap="round" />
      <circle cx="762" cy="580" r="9" fill="#ff8a2b" />
      ${smoke(790, 540, 2.2, 0.5)}${smoke(826, 486, 1.6, 0.4)}
    </g>
    <!-- монеты в руках -->
    <circle cx="392" cy="650" r="34" fill="url(#goldGrad)" stroke="${P.ink}" stroke-width="9" />
    <circle cx="632" cy="650" r="34" fill="url(#goldGrad)" stroke="${P.ink}" stroke-width="9" />
  </g>

  <!-- летящие монеты -->
  ${coin(300, 300, 22)}${coin(760, 330, 26)}${coin(840, 470, 20)}${coin(200, 470, 18)}
  ${star(880, 210, 26)}${star(160, 220, 22)}${star(512, 130, 30)}
  ${spark(350, 400, 16)}${spark(700, 420, 18)}

  <!-- подпись -->
  <text x="512" y="1000" font-family="Georgia, serif" font-size="34" fill="#fdf3dd" text-anchor="middle" opacity="0.75">полный контроль</text>
</svg>
`;

/** Готовые сцены: имя файла → SVG. Ничего не пишет на диск. */
export function buildScenes() {
  return {
    'bg.svg': scene(bg),
    'logo.svg': scene(logo),
    'finale.svg': scene(finale),
  };
}

function main() {
  const outDir = resolve(argValue('--out') ?? imgDir);
  const scenes = buildScenes();
  // Сначала проверяем всё, потом пишем: битая сцена не затрёт рабочую.
  for (const [name, svg] of Object.entries(scenes)) assertSvg(name, svg);
  mkdirSync(outDir, { recursive: true });
  for (const [name, svg] of Object.entries(scenes)) {
    writeFileSync(resolve(outDir, name), svg, 'utf8');
  }
  console.log(`готово: ${Object.keys(scenes).join(', ')} в ${outDir}`);
}

void STROKE;
void ellipse;
void fill;
void group;
void character;
void crown;
void topHat;
void shine;
void poly;
void star;
void chimney;
void spark;
void smoke;
void circle;
void derrick;
void drop;
void line;
void path;
void rect;

if (isMainModule(import.meta.url)) main();
