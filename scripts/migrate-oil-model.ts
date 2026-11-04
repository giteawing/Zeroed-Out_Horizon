/**
 * Миграция контента к «нефтяной» модели (v2).
 *
 * Скрипт одноразовый, но полезный: он собирает upgrades.json из базовой
 * версии + правки новой механики. Так видно, что именно изменилось в балансе,
 * и можно пересобрать контент с нуля.
 *
 * Запуск: npx tsx scripts/migrate-oil-model.ts <путь к базовому upgrades.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Def {
  id: string;
  tab: string;
  group: string;
  name: string;
  description: string;
  icon: string;
  type: string;
  baseCost: number;
  maxLevel: number;
  costGrowth?: number;
  effect: Record<string, unknown>;
  cooldownSeconds?: number;
  repeatable?: boolean;
  unlockAt?: Record<string, unknown>;
  tag?: string;
  conquest?: boolean;
  achievement?: string;
  win?: boolean;
}

const [, , basePath] = process.argv;
if (!basePath) {
  console.error('укажите базовый upgrades.json');
  process.exit(1);
}

const base = (JSON.parse(readFileSync(resolve(basePath), 'utf8')) as { upgrades: Def[] }).upgrades;
const ups: Def[] = base.map((u) => ({ ...u, effect: { ...u.effect } }));
const by = new Map(ups.map((u) => [u.id, u]));

function patch(id: string, changes: Partial<Def>): void {
  const def = by.get(id);
  if (!def) throw new Error(`нет покупки ${id}`);
  Object.assign(def, changes);
}

function add(def: Def): void {
  if (by.has(def.id)) return;
  ups.push(def);
  by.set(def.id, def);
}

// ---------------------------------------------------------------- скважина
// Пассивный доход теперь измеряется в ТОННАХ в секунду.
patch('t_well', {
  description: 'Фонтанный способ: нефть сама идёт в резервуары.',
  effect: { value: 0.6 },
});

// --------------------------------------------------------------------- НПЗ
// Требование владельца: постройка НПЗ — от 80 млрд до 630 млрд.
// НПЗ — это канал переработки (дорогая продажа), а не «пассив».
patch('t_refinery', {
  name: 'Построить нефтеперерабатывающий завод',
  description:
    'Свой завод: гонит мазут в бензин и приносит втрое больше, чем сырая нефть.',
  type: 'sell',
  baseCost: 80_000_000_000,
  maxLevel: 16,
  costGrowth: 1.1475, // 80 млрд · 1.1475^15 ≈ 630 млрд
  effect: { channel: 'refine', value: 3 },
  unlockAt: { balance: 8_000_000_000 },
  tag: 'pinned',
});

// ----------------------------------------------------------------- нефтебаза
// Требование владельца: нефтебаза — от 40 млн до 2 млрд. Это ёмкость склада.
patch('t_depot', {
  description:
    'Резервуарный парк. Больше ёмкость — больше нефти можно накопить и продать в удачный момент.',
  type: 'storage',
  baseCost: 40_000_000,
  maxLevel: 29,
  costGrowth: 1.15, // 40 млн · 1.15^28 ≈ 2 млрд
  effect: { value: 25_000 },
  unlockAt: { balance: 4_000_000 },
  tag: 'pinned',
});

// Ранние резервуары: без них новая механика не даёт играть первые минуты.
add({
  id: 't_canister',
  tab: 'technical',
  group: 'infrastructure',
  name: 'Прицепить цистерну',
  description: 'Старая цистерна на телеге: немного, зато сразу.',
  icon: 'depot',
  type: 'storage',
  baseCost: 320,
  maxLevel: 20,
  effect: { value: 150 },
  unlockAt: { balance: 900 },
});
add({
  id: 't_tank',
  tab: 'technical',
  group: 'infrastructure',
  name: 'Поставить резервуар на 5 тысяч тонн',
  description: 'Клёпаный резервуар. Нефть больше не льётся через край.',
  icon: 'depot',
  type: 'storage',
  baseCost: 24_000,
  maxLevel: 24,
  effect: { value: 2_500 },
  unlockAt: { balance: 60_000 },
});

// ------------------------------------------------- инфраструктура → пропускная
// Труба, терминал, эстакада дают не «доход», а возможность продавать больше.
patch('t_azs', { type: 'sell', effect: { channel: 'contract', value: 50 } });
patch('t_pipeline', { type: 'sell', effect: { channel: 'export', value: 90 } });
patch('t_terminal', { type: 'sell', effect: { channel: 'export', value: 240, exportBonus: 0.15 } });
patch('t_rail', { type: 'sell', effect: { channel: 'export', value: 700 } });
patch('t_gasplant', { type: 'sell', effect: { channel: 'refine', value: 800 } });
patch('t_power', { type: 'sell', effect: { channel: 'refine', value: 2200, costCut: 0.03 } });

// ---------------------------------------------------- бригада автодобычи (5 чел.)
patch('t_geonav', {
  id: 's_geonav',
  group: 'crew',
  name: 'Нанять геонавигатора',
  description: 'Ведёт долото по пласту. С ним добыча идёт ровнее.',
  type: 'passive',
  baseCost: 99,
  maxLevel: 45,
  effect: { value: 0.5 },
});
add({
  id: 's_geolog',
  tab: 'technical',
  group: 'crew',
  name: 'Нанять геолога',
  description: 'Геолог знает, где нефть. Без него бурят в основном в пустоту.',
  icon: 'core',
  type: 'passive',
  baseCost: 420,
  maxLevel: 45,
  effect: { value: 2.2 },
});
add({
  id: 's_operator',
  tab: 'technical',
  group: 'crew',
  name: 'Нанять операторов буровой установки',
  description: 'Крутят ключи и следят за давлением. Добыча не встаёт даже ночью.',
  icon: 'topdrive',
  type: 'passive',
  baseCost: 1_900,
  maxLevel: 45,
  effect: { value: 9 },
});
add({
  id: 's_engineer',
  tab: 'technical',
  group: 'crew',
  name: 'Нанять инженера',
  description: 'Считает режимы бурения и чинит то, что уже сломалось.',
  icon: 'technolog',
  type: 'passive',
  baseCost: 22_000,
  maxLevel: 45,
  effect: { value: 45, costCut: 0.01 },
});
patch('t_brigade', {
  id: 's_brigade',
  group: 'crew',
  name: 'Нанять буровую бригаду-стахановцев',
  description: 'Пять человек и один кувалдометр. Работают за троих и просят прибавку.',
  type: 'passive',
  baseCost: 401,
  maxLevel: 45,
  effect: { value: 4.5, salaryAdd: 0.4 },
});

// Долота и насосы: тонны за тап (было — «монеты за тап»).
const drillTonnes: Record<string, number> = {
  d1_blade: 1, d2_milled: 2.5, d3_tci: 6.5, d4_hybrid: 17,
  d5_pdc: 55, d6_impreg: 165, d7_terminator: 520,
  t_pump1: 1.6, t_pump2: 4.2, t_pump3: 12,
  t_mwd: 26, t_motor: 9, t_rss: 32,
};
for (const [id, value] of Object.entries(drillTonnes)) {
  const def = by.get(id);
  if (def) def.effect = { ...def.effect, value };
}
patch('t_pump4', { effect: { value: 3200 } });
patch('t_topdrive', { maxLevel: 12 });

// Отжатия качают нефть сами (и стоят дешевле постройки).
patch('p_field', {
  type: 'passive',
  effect: { value: 260 },
  conquest: true,
  description: 'Скважины соседа переходят под ваше оперативное управление.',
});

// --------------------------------------------------------------- вкладка сбыта
const salesTab: Def[] = [
  ['c_local', 'Договориться с местным трестом', 'Скупают всё, что льётся, по грабительской цене. Зато стабильно.',
    'contractor', 540, 30, { channel: 'contract', value: 12, percent: 6 }, 3_000],
  ['c_broker', 'Нанять трейдера-брокера', 'Знает всех, кому нужна нефть. Контракты растут и дорожают.',
    'lawyer', 9_000, 25, { channel: 'contract', value: 40, percent: 9 }, 100_000],
  ['c_bourse', 'Пробить место на нефтяной бирже', 'Без места на бирже на вас смотрят как на ларёк.',
    'expertise', 260_000, 20, { channel: 'contract', value: 140, percent: 12 }, 3_000_000],
  ['c_longterm', 'Подписать долгосрочные контракты с «друзьями»', 'Цена фиксируется на десять лет. Как всегда, не в вашу пользу.',
    'ministry', 6_800_000, 18, { channel: 'contract', value: 460, percent: 15 }, 80_000_000],
  ['c_tenders', 'Выиграть все госконтракты сразу', 'Конкурс из одного участника. Победа единогласная.',
    'gov', 190_000_000, 16, { channel: 'contract', value: 1400, percent: 20 }, 2_000_000_000],
  ['x_cistern', 'Гонять нефть за границу цистернами', 'Железная дорога, таможня, «ускорение оформления».',
    'export', 8_200, 25, { channel: 'export', value: 6, percent: 8 }, 90_000],
  ['x_tanker', 'Фрахтовать танкер «на один рейс» (навсегда)', 'Судно старое, трюмы большие. Капитан подписывает всё.',
    'terminal', 410_000, 20, { channel: 'export', value: 20, percent: 10 }, 5_000_000],
  ['x_nordstream', 'Провести трубу по дну холодного моря', 'Экологическое заключение уже готово. Осталось найти море.',
    'pipeline', 1_400_000, 18, { channel: 'export', value: 60, percent: 14 }, 20_000_000],
  ['x_offtake', 'Взять offtake-контракт на всю добычу', 'Покупатель обязуется брать всё. Продавать больше некому.',
    'contractor', 46_000_000, 16, { channel: 'export', value: 180, percent: 18 }, 600_000_000],
  ['x_fleet', 'Купить собственный танкерный флот', 'Пять танкеров, два из них ещё даже на плаву.',
    'lux-yacht', 900_000_000, 14, { channel: 'export', value: 520, percent: 22 }, 12_000_000_000],
  ['r_uzine', 'Добавить на НПЗ установку каталитического крекинга', 'Из мазута получается бензин, из бензина — деньги.',
    'refinery', 210_000_000, 16, { channel: 'refine', value: 14, percent: 10 }, 3_000_000_000],
  ['r_alkyl', 'Наладить алкилирование и висбрекинг', 'Названия страшные, маржа прекрасная.',
    'refinery', 1_900_000_000, 14, { channel: 'refine', value: 46, percent: 14 }, 25_000_000_000],
  ['r_aromatics', 'Гнать ароматику прямо в пластмассу', 'Нефть превращается в тазики. Тазики дороже нефти.',
    'refinery', 25_000_000_000, 12, { channel: 'refine', value: 150, percent: 18 }, 300_000_000_000],
  ['r_chemical', 'Стать нефтехимическим комбинатом', 'Мазут → полимеры → всё, что можно продать в розницу.',
    'refinery', 450_000_000_000, 10, { channel: 'refine', value: 420, percent: 25 }, 6_000_000_000_000],
  ['s_railtank', 'Купить сливную эстакаду на узловой станции', 'Своя эстакада: не стоим в очереди за чужим подъездным путём.',
    'rail', 620_000, 20, { channel: 'export', value: 26 }, 6_000_000],
  ['s_metering', 'Поставить узлы учёта расхода нефти', 'Считать то, что продаёшь. Революционная идея.',
    'dashboard', 4_300_000, 18, { channel: 'contract', value: 90, percent: 6 }, 40_000_000],
] as const;

for (const [id, name, description, icon, cost, maxLevel, effect, unlock] of salesTab) {
  add({
    id,
    tab: 'sales',
    group: id.startsWith('x_') ? 'export' : id.startsWith('r_') ? 'refine'
      : id.startsWith('s_') ? 'infrastructure' : 'contracts',
    name,
    description,
    icon,
    type: 'sell',
    baseCost: cost,
    maxLevel,
    effect: effect as Record<string, unknown>,
    unlockAt: { balance: unlock },
    costGrowth: 1.15,
  });
}

// ------------------------------------------------------------ ЧВК и отжатия
const pmc: Array<[string, string, string, string, number, Record<string, unknown>, number]> = [
  ['pmc_vet', 'Нанять ветеранов в охрану',
    'Двадцать человек с опытом и без лишних вопросов.',
    'brigade', 2_400_000, { influence: 4 }, 40_000_000],
  ['pmc_chvk', 'Создать свою ЧВК «Горизонт-Охрана»',
    'Юридически — охранное предприятие. Фактически — маленькая армия с бухгалтерией.',
    'press', 68_000_000, { influence: 12 }, 900_000_000],
  ['pmc_airbase', 'Купить вертолётную площадку у месторождения',
    'Логистика для людей, которые решают вопросы быстро.',
    'lux-heli', 540_000_000, { influence: 18 }, 7_000_000_000],
  ['pmc_legal', 'Оформить ЧВК в тёплой юрисдикции',
    'В отчётности — консалтинг. В реальности — то же самое, но дешевле.',
    'offshore', 3_100_000_000, { influence: 26, conquestCut: 0.03 }, 40_000_000_000],
  ['pmc_drone', 'Завести дронов-разведчиков',
    'С высоты видно, какие заводы у конкурента плохо охраняются.',
    'drones', 18_000_000_000, { influence: 35, conquestCut: 0.04 }, 300_000_000_000],
  ['pmc_army', 'Содержать частную армию на постоянной основе',
    'Штат, казармы, полигон. Партнёры начинают кивать уважительно.',
    'lux-cortege', 210_000_000_000, { influence: 45, conquestCut: 0.05 }, 3_000_000_000_000],
];
for (const [id, name, description, icon, cost, effect, unlock] of pmc) {
  add({
    id, tab: 'political', group: 'pmc', name, description, icon,
    type: 'multiplier', baseCost: cost, maxLevel: 1,
    effect: { factor: 1, ...effect },
    unlockAt: { balance: unlock },
  });
}

// Реприватизация месторождения! (требование владельца)
add({
  id: 'p_reprivatize',
  tab: 'political',
  group: 'conquest',
  name: 'Устроить реприватизацию месторождения со скважинами конкурента',
  description: 'Скважины конкурента внезапно оказываются стратегически важными для страны.',
  icon: 'field',
  type: 'passive',
  baseCost: 260_000_000,
  maxLevel: 10,
  effect: { value: 2400 },
  conquest: true,
  unlockAt: { balance: 30_000_000_000, influence: 40 },
});

// ------------------------------- убыточный банк: отмывание и уход от налогов
add({
  id: 'p_badbank',
  tab: 'political',
  group: 'taxes',
  name: 'Купить убыточный банк «Последний кредит»',
  description: 'Отделение с разбитым стеклом, зато своя лицензия и «дружественный» аудит.',
  icon: 'fund',
  type: 'taxCut',
  baseCost: 90_000_000,
  maxLevel: 12,
  effect: { percent: 2.5 },
  unlockAt: { balance: 1_200_000_000 },
});
const laundering: Array<[string, string, string, string, number, number, number]> = [
  ['p_launder', 'Провести отмывание через убыточный банк',
    'Деньги уходят в банк, банк отдаёт их обратно. Налоговая видит только убыток.',
    'offshore', 90, 500_000_000, 0],
  ['p_hideprofit', 'Провести уход от налогов через банк',
    'Прибыль становится «технической переоценкой активов» и налогом не облагается.',
    'lawyer', 160, 5_000_000_000, 0],
  ['p_tranche', 'Спрятать очередной транш в убыточном банке',
    'Транш за траншем. Банк всё ещё убыточный, а вы всё ещё богатый.',
    'fund', 420, 40_000_000_000, 0],
];
for (const [id, name, description, icon, value, balance] of laundering) {
  add({
    id, tab: 'political', group: 'taxes', name, description, icon,
    type: 'oneShot', baseCost: 0, maxLevel: 1,
    effect: { value, launder: true },
    cooldownSeconds: 90, repeatable: true,
    unlockAt: { balance, upgrade: 'p_badbank', level: 1 },
  });
}

// Отжатый НПЗ: тот же канал, что у своего, но дешевле и требует влияния+ЧВК.
patch('p_refinery', {
  name: 'Отжать нефтеперерабатывающий завод у конкурентов',
  description:
    'Тот же завод, только прежний владелец пишет жалобы. Дешевле, но нужно влияние и своя ЧВК.',
  type: 'sell',
  baseCost: 900_000_000,
  maxLevel: 14,
  effect: { channel: 'refine', value: 3 },
  conquest: true,
  unlockAt: { balance: 90_000_000_000, influence: 35, upgrade: 'pmc_chvk', level: 1 },
});

// --------------------------------------------------- влияние: газета, парламент
patch('p_newspaper', { effect: { factor: 1.08, influence: 3 } });
patch('p_gov', { effect: { factor: 1.15, influence: 10 } });
add({
  id: 'p_parliament',
  tab: 'political',
  group: 'taxes',
  name: 'Купить голоса в парламенте',
  description: 'Депутаты теперь голосуют по звонку. Иногда даже по вашему.',
  icon: 'senate',
  type: 'multiplier',
  baseCost: 21_000_000,
  maxLevel: 10,
  effect: { factor: 1, influence: 6 },
  unlockAt: { balance: 200_000_000 },
});

// ----------------------------------------- экспорт: продаёт нефть со склада
patch('p_export', {
  description:
    'Слить накопленную нефть за границу по мировому курсу. Чем полнее резервуары — тем выгоднее.',
  effect: { value: 40, usesWorldPrice: true, sellsOil: true, burstChannel: 'export' },
  unlockAt: { balance: 400 },
});

// --------------------------------------------------- рост цен по типам покупок
const growth: Record<string, number> = {
  t_well: 1.24, s_geonav: 1.24, s_geolog: 1.24, s_brigade: 1.24,
  s_operator: 1.22, s_engineer: 1.22, t_depot: 1.15, t_tank: 1.26,
  t_canister: 1.30, t_azs: 1.20, t_pipeline: 1.20, t_terminal: 1.18,
  t_rail: 1.18, t_gasplant: 1.18, t_power: 1.18, t_pump4: 1.18,
};
for (const [id, value] of Object.entries(growth)) {
  const def = by.get(id);
  if (def) def.costGrowth = value;
}

// ---------------------------------------------------- ссылки на переименованные id
for (const def of ups) {
  const req = def.unlockAt as { upgrade?: string } | undefined;
  if (req?.upgrade === 't_geonav') req.upgrade = 's_geonav';
  if (req?.upgrade === 't_brigade') req.upgrade = 's_brigade';
}

const out = { upgrades: ups };
writeFileSync(
  resolve('src/content/upgrades.json'),
  JSON.stringify(out, null, 2),
  'utf8',
);
console.log(`готово: ${ups.length} покупок`);
const counts = new Map<string, number>();
for (const u of ups) counts.set(u.tab, (counts.get(u.tab) ?? 0) + 1);
console.log('по вкладкам:', Object.fromEntries(counts));
