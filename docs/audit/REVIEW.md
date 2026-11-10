# Ревью проекта «Империя обнуленного горизонта»

Документ — задание для coding-агента. Каждый пункт: **где**, **в чём проблема**, **как исправить** (с патчем или примером), **как проверить**.

## 0. Как пользоваться

- Это **статическое ревью**: код, JSON, тесты, CI и документация прочитаны, но `npm run build`, `npm test`, `npm run test:e2e` и `npm run art` **не запускались**. Перед правкой каждого пункта воспроизведи проблему (тестом или чтением кода) и только потом чини.
- Порядок работы — как в `AGENTS.md`: сначала регрессионный тест, затем исправление, затем `npm run build && npm test` (для UI ещё `npm run test:e2e`, для экономики ещё `npm run balance:report`).
- Пункты, которые меняют баланс (помечены ⚖️), нельзя править «на глаз»: после правки обязателен отчёт по четырём профилям (`balance-tuning` skill). Если время прохождения выходит за 12–25 мин, это не повод ослаблять тест.
- Решение «только desktop» принято владельцем; мобильную поддержку не возвращать.

### Сводная таблица

| ID | Важность | Область | Суть |
|---|---|---|---|
| A1 | 🔴 высокая | main.ts | Игра тикает и сохраняется за стартовым экраном; офлайн-доход теряется или удваивается |
| A2 | 🔴 высокая | генераторы SVG | `npm run art` ломает `logo.svg`/`finale.svg` и затирает три рукописные иконки |
| A3 | 🔴 высокая | economy/sales ⚖️ | «Авто» не выбирает выгодный рынок: НПЗ всегда выигрывает у экспорта по построению цены |
| A4 | 🟠 средняя | effects.ts ⚖️ | `exportBonus` на карточках типа `sell` — мёртвые данные (в т. ч. «усиливает контрабанду» у терминала) |
| A5 | 🟠 средняя | market.ts ⚖️ | Карточки сбыта скрыто умножают добычу (×25 и более), правила об этом молчат |
| A6 | 🟠 средняя | flow-controls.ts | Пустое поле потока превращается в «фиксированный 0» вместо «Авто» |
| A7 | 🟠 средняя | rules.ts / main.ts | «Правила игры» не закрываются ни Escape, ни кликом по фону |
| A8 | 🟠 средняя | sound.ts | Звук, включённый из настроек после старта с выключенным звуком, не работает |
| A9 | 🟠 средняя | производительность | `computeDerived` каждый раз считает стоимость всех активов; тесты баланса медленные |
| B1–B9 | 🟠/🟡 | правила ↔ игра | Тексты правил, README и описания карточек расходятся с механикой |
| C1–C12 | 🟡 | прочие дефекты кода | Мёртвый код, латентные баги, рассинхрон данных |
| H1–H14 | 🟠/🟡 | harness | Тесты, CI, AGENTS/skills, документация |

---

## A. Критичные и существенные дефекты кода

### A1. Игра идёт за стартовым экраном (🔴)

**Где:** `src/main.ts` — `boot()`, `frame()`, `onStart()`, `save()`, обработчики `visibilitychange`/`pagehide`/`beforeunload`.

**Проблема.** `requestAnimationFrame(frame)` запускается в `boot()` сразу. Пока на экране «Запустить добычу / Продолжить империю», движок:

1. тикает (новый игрок получает бесплатный прогресс, продолжающий — тоже);
2. автосохраняет раз в 10 с и сохраняет на `pagehide`/`visibilitychange` → обновляется `state.savedAtWallMs`;
3. из-за п. 2 `applyOfflineIncome()` при нажатии «Продолжить» видит разницу не с прошлой сессии, а с последним автосейвом, поэтому **офлайн-доход за время отсутствия теряется** (если игрок думал на стартовом экране > 10 с), а секунды до клика считаются дважды (тик + офлайн).

**Исправление.**

```diff
--- a/src/main.ts
+++ b/src/main.ts
@@ function boot(): void {
+  // Игра стоит на паузе, пока игрок не нажал кнопку на стартовом экране.
+  let started = false;
@@ function onStart(fresh: boolean): void {
     sound.unlock();
     if (fresh) {
       state = createInitialState(config);
       restartWith(state);
     } else if (hasSave) {
       applyOfflineIncome();
       if (game.state.won) finale.show(game.state);
     }
+    started = true;
+    lastFrame = performance.now();
+    accumulator = 0;
     start.hide();
@@ function save(): void {
+    // До старта нельзя перезаписывать savedAtWallMs: от него считается офлайн.
+    if (!started) return;
     const snapshot = game.snapshot();
@@ function frame(now: number): void {
     const dt = Math.min(250, now - lastFrame);
     lastFrame = now;
-    if (!hidden) {
+    if (!hidden && started) {
```

Также в обработчике возврата во вкладку (`visibilitychange` → `visible`) не вызывать `applyOfflineIncome()` при `!started`.

`started` объявлять **выше** `onStart`/`save` (замыкания), `lastFrame`/`accumulator` уже объявлены ниже по файлу через `let` — перенеси объявления цикла выше `onStart` или вынеси сброс в функцию `resetClock()`.

**Тест** (новый файл `tests/dom/start-pause.test.ts`, отдельный от `app.test.ts`, т. к. тому нужен уже запущенный app):

```ts
// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
// ... те же моки SoundEngine/canvas, что в app.test.ts
it('пока не нажат старт, время и деньги не движутся, сейв не пишется', async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="app"></div>';
  await import('../../src/main');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  const game = (window as any).__game;
  const t0 = game.state.playtimeMs;
  await vi.advanceTimersByTimeAsync(30_000);
  expect(game.state.playtimeMs).toBe(t0);
  expect(localStorage.getItem('zeroed-out-horizon:save:v2')).toBeNull();
});
```

(Если happy-dom не прокручивает `requestAnimationFrame` под fake timers — подмени `requestAnimationFrame` на `setTimeout(…, 16)` в setup.)

---

### A2. Генераторы SVG ломают ресурсы (🔴)

**Где:** `scripts/generate-scenes.mjs`, `scripts/generate-icons.mjs`, `scripts/lib/art.mjs`.

**Проблемы.**

1. `generate-scenes.mjs` объявляет градиенты `goldGrad`, `oilGrad`, `skinGrad`, но примитивы из `art.mjs` (`coin`, `drop`, `circle(... 'url(#gold)')`) ссылаются на `url(#gold)`, `url(#oil)` и т. п. В закоммиченных `logo.svg`/`finale.svg` ссылки **исправлены руками** (см. `AUDIT-STATUS` C1), но генератор по-прежнему порождает битые ссылки. Первый же `npm run art` вернёт дефект, а `tests/svg.test.ts` упадёт.
2. `generate-icons.mjs → main()` для любого `def.icon`, которого нет в словаре `icons`, пишет **заглушку** `FALLBACKS`. Файлы `domestic-cartel.svg`, `export-cartel.svg`, `devalue.svg` нарисованы вручную и в генераторе отсутствуют → будут затёрты фасадом с монетой.

**Исправление.**

`scripts/lib/art.mjs` — экспортировать общий набор градиентов:

```diff
-const DEFS = `
+export const DEFS = `
```

`scripts/generate-scenes.mjs` — вставить их в `<defs>` сцен (оставив свои `*Grad`):

```diff
-import {
+import {
+  DEFS as ART_DEFS,
   PALETTE as P,
@@
 const DEFS = `
 <defs>
+  ${ART_DEFS.replace(/^\s*<defs>|<\/defs>\s*$/g, '')}
   <linearGradient id="skyGrad" ...
```

`scripts/generate-icons.mjs` — не перезаписывать рукописные файлы:

```diff
-import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
+import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
@@ function main() {
   for (const def of data.upgrades) {
     const svg = build(def.icon);
     if (!svg) {
+      // Рукописная иконка без записи в генераторе — не трогаем.
+      if (existsSync(resolve(outDir, `${def.icon}.svg`))) continue;
       missing.push(def.icon);
```

**Проверка.** В чистой ветке: `npm run art && git diff --stat && npm test -- tests/svg.test.ts`. Ожидается: diff только в файлах, которые ты осознанно менял; тест SVG зелёный. Добавь в `testing-regressions` skill пункт «после `npm run art` — `git diff` и `tests/svg.test.ts`».

---

### A3. «Авто» не выбирает выгодный рынок: НПЗ выигрывает всегда (🔴 ⚖️)

**Где:** `src/core/economy/sales.ts` — `oilFlowsOf()` и `allocateBatch()`:

```ts
const refinePrice =
  prices.crudeExport *
  (config.oil.channels.refine.priceFactor / Math.max(1e-9, config.oil.channels.export.priceFactor));
```

**Проблема.** «Цена» переработки определяется как `цена экспорта × 2.6`. Она **по построению** всегда выше экспортной, при любых ценах/курсе/картелях. Реальная выручка от переработки — `refineryYield (0.85) × цена продукта` (внутренняя `1.8×base×domesticMult`, экспортная `2.6×base×курс×exportMult`). При девальвации (`p_devalue_currency`, до ×2.65 к курсу) сырой экспорт даёт `1.0×base×2.65`, а переработка с продажей внутри страны — `0.85×1.8×base = 1.53×base`; «авто» всё равно шлёт нефть на НПЗ и теряет деньги. Текст правил обещает обратное («при дорогом экспорте нефть сначала идёт за границу») и README — «Авто распределит по выгодности».

**Исправление (направление).** Считать цену переработки как реально получаемую выручку:

```ts
/** Ожидаемая выручка с тонны сырья, пущенной на НПЗ. */
function refineValuePerTon(
  config: GameConfig,
  prices: { productDomestic: number; productExport: number },
  exportRoom: number,   // свободная мощность экспорта продуктов, т/с
  domesticRoom: number, // свободная мощность внутреннего рынка продуктов, т/с
): number {
  const y = config.oil.refineryYield;
  const best = Math.max(
    exportRoom > 0 ? prices.productExport : 0,
    domesticRoom > 0 ? prices.productDomestic : 0,
  );
  return y * best;
}
```

и использовать её вместо `refinePrice` в `oilFlowsOf` и `allocateBatch` (и в `allocateCrude` не менять — он сортирует по переданной цене). Ограничение по приёмке продуктов уже есть через `refineryCapacity`.

⚖️ **Баланс изменится**: после правки запусти `npm run balance:report` и `npm run balance`; при выходе за 12–25 мин перенастрой цены по протоколу `balance-tuning`, а не тесты.

**Тест:**

```ts
it('при сильной девальвации авто-маршрут предпочитает экспорт сырья переработке с внутренней продажей', () => {
  const caps = { domestic: { crude: 0, products: 1000 }, export: { crude: 1000, products: 0 }, refine: 1000 };
  const flows = oilFlowsOf(limitedConfig, caps, 100, {
    prices: { crudeDomestic: 1, crudeExport: 2.65, productDomestic: 1.8, productExport: 0 },
    productStorage: 0, productStorageFree: 0,
  });
  expect(flows.export).toBeGreaterThan(flows.refined);
});
```

Пока правка не сделана — исправь **текст** (B2), чтобы он не врал.

---

### A4. `exportBonus` на карточках `sell` не работает (🟠 ⚖️)

**Где:** `src/core/economy/derived/effects.ts`, `src/content/upgrades.json`.

`exportBonus` читается только в ветке `case 'passive'`. Но он стоит на `t_terminal` (0.15), `t_exppipe` (0.02), `t_exptanker` (0.03) — все `type: 'sell'`. Для `sell` ветка обрабатывает `value`, `costCut`, `percent`, а `exportBonus` игнорируется. Описание `t_terminal` — «Усиливает «пихнуть нефть заграницу»» — не соответствует механике: `p_export` читает `exportBonus` **из собственного** `effect`, а там его нет.

**Исправление — выбрать одно (решение владельца):**

- **Вариант 1 (рекомендуется, баланс не меняется):** удалить `exportBonus` из трёх карточек и переписать описание `t_terminal`.
- **Вариант 2:** реализовать в `case 'sell'`: `if (effect.exportBonus) result.exportMultiplier += effect.exportBonus * level;`. ⚠️ `t_terminal` при 45 уровнях даст `+675%` к экспортному множителю — значения нужно пересчитывать, затем полный баланс-прогон.

**Тест (общий для обоих вариантов — ловит класс ошибок):**

```ts
it('каждое поле effect, заданное в upgrades.json, потребляется ядром для данного type', () => {
  // Таблица: type -> поля, которые ядро реально читает.
  const READ: Record<string, string[]> = { sell: ['channel','value','channelSplit','exportMode','costCut','percent'], /* ... */ };
  for (const def of content.upgrades) {
    const allowed = READ[def.type];
    if (!allowed) continue;
    const unknown = Object.keys(def.effect).filter(k => !allowed.includes(k));
    expect(unknown, `${def.id}: неиспользуемые поля ${unknown}`).toEqual([]);
  }
});
```

Заполни таблицу `READ` по `effects.ts`/`game.ts`; тест защитит от повторения.

Родственное: `effects.taxAdd` нигде не задаётся в контенте (мёртвое поле), `config.influence.perGroup` не используется после правки A11 аудита — удалить из `types.ts`/`config.json` или пометить `@deprecated`.

---

### A5. Карточки сбыта скрыто умножают добычу (🟠 ⚖️)

**Где:** `src/core/economy/derived/market.ts`:

```ts
const salesVolumeMultiplier = 1 + Math.max(effects.throughputBonus.contract, effects.throughputBonus.export);
const rawOilPerSecond = (wells... ) * config.balance.passiveScale * salesVolumeMultiplier;
```

**Проблема.** Покупка `c_local`, `c_broker`, `c_bourse`, `c_longterm`, `c_tenders`, `s_metering`, `x_*` увеличивает **добычу нефти** (до порядка ×25 при полной прокачке: сумма процентов ≈ 2480%), а ещё и пропускную способность тех же каналов (`rate × (1 + throughputBonus)`), то есть эффект учитывается дважды. Это нарушает инвариант «добыча не равна выручке, сбыт не создаёт нефть» из `economy-accounting`. Игрок и текст правил (`rules.productionText`: «Дебит растёт от производственных улучшений») об этом не знают; описания карточек говорят «эффективная добыча и реализация растут».

**Что сделать.**

1. Принять решение: либо это сознательная механика → задокументировать (B1, `docs/ECONOMY.md`, `rules`), либо убрать множитель добычи и оставить только рост мощности канала (⚖️ потребует перекалибровки).
2. Минимум: добавить в `docs/ECONOMY.md` и `rules.ts` раздел «Как карточки сбыта влияют на добычу», показать в HUD строку «множитель от контрактов».
3. Ограничить суммирование: `Math.max(contract, export)` по сути берёт больший, но каждый сам суммируется линейно по 30+ уровням — подумай про убывающую отдачу.

---

### A6. Пустое поле потока = «фиксированный 0» (🟠)

**Где:** `src/ui/flow-controls.ts → setFixed()`.

`Number('') === 0`. Если игрок стирает значение (плейсхолдер говорит «Авто»), срабатывает `change`, и канал получает `{ mode: 'fixed', value: 0 }` — маршрут молча отключается.

```diff
   private setFixed(channel: Channel, input: HTMLInputElement): void {
-    const value = Number(input.value);
+    // Пустое поле — это «Авто», как подсказывает placeholder.
+    if (input.value.trim() === '') {
+      if (this.game.setFlowControl(channel, { mode: 'auto', value: 0 })) {
+        this.onChange();
+        this.update(this.game.state, this.game.derived());
+      }
+      return;
+    }
+    const value = Number(input.value.replace(',', '.'));
     const setting: FlowControl = { mode: 'fixed', value };
```

**Тест (DOM):** `input.value = ''; input.dispatchEvent(new Event('change'))` → `state.flowControl.contract` равен `{ mode: 'auto', value: 0 }`. Существующий тест `app.test.ts` («изменение значения … переключает в фиксированный режим») использует `'0'` — он остаётся валидным.

Латентно: если `contract.unlimited = true`, то `flowLimits.contract = Infinity`; кнопка «Макс.» вызывает `setFlowControl(..., Infinity)` → `!Number.isFinite` → тихий отказ, а `input.max = "Infinity"`. Решить: для безлимитного канала лимитом считать `produced`.

---

### A7. «Правила игры» не закрываются Escape и кликом по фону (🟠)

**Где:** `src/ui/rules.ts` (нет обработчика `pointerdown` по подложке), `src/main.ts` (обработчик `Escape` знает про `dev`, `settings`, `wealth`, `assetDetails`, но не про `rules`). Остальные шторки по комментариям в коде должны закрываться тремя способами.

```diff
--- a/src/ui/rules.ts
+++ b/src/ui/rules.ts
@@ constructor
     }, [ ... ]);
+    this.root.addEventListener('pointerdown', (event) => {
+      if (event.target === this.root) this.onClose();
+    });
   }
```

```diff
--- a/src/main.ts
+++ b/src/main.ts
     if (event.key === 'Escape') {
+      if (rules.visible) rules.hide();
       if (dev.visible) dev.close();
```

Добавь пункт в e2e-тест «витрина богатства закрывается…» для «Правил» (меню → `[data-menu="rules"]`).

Заодно: у всех шторок `aria-modal="true"`, но нет фокус-ловушки и возврата фокуса; Escape закрывает сразу несколько окон. Минимально — закрывать только верхнее.

---

### A8. Звук не включается из настроек (🟠)

**Где:** `src/audio/sound.ts`, `src/main.ts`.

`SoundEngine.unlock()` вызывается только в `onStart()` и пункте меню «Звук». Если сохранённый `soundOn === false`, `unlock()` на старте возвращается сразу (`if (!this.enabled) return;`), контекст не создаётся. Позже включение через **Настройки** (`onToggleSound`) вызывает `setEnabled(true)`, но `ctx === null` → `ready()` всегда `null` → тишина до перезагрузки. Комментарий в файле обещает «создаётся внутри pointerdown», но глобального слушателя нет.

```diff
--- a/src/main.ts
@@ const settings = new Settings(texts, {
     onToggleSound: (enabled) => {
       sound.setEnabled(enabled);
+      if (enabled) sound.unlock(); // вызов из обработчика клика — это пользовательский жест
       game.setSound(enabled);
```

Надёжнее: в `SoundEngine` повесить одноразовый `pointerdown`-слушатель на `document`, который вызывает `unlock()`.

---

### A9. Производительность ядра: `computeDerived` слишком тяжёлый (🟠)

**Где:** `src/core/economy/derived.ts` вызывает `assetsValueOf(...)` и `assetCountsOf(...)` при **каждом** пересчёте; `assetValueBreakdownOf` перебирает все покупки и для каждого уровня считает `costFor` (с `Math.pow`). `Game` инвалидирует кэш на каждом шаге (50 мс), в `grantCoins`, `addOil`, `commitSpill`, `directExport` и т. д. — это несколько полных пересчётов за шаг. Симулятор дополнительно вызывает полный `computeDerived` на каждого кандидата в `estimatedGain`. Отсюда долгие тесты баланса (см. H2).

**Исправление.** Вынести то, что нужно только UI, из «горячего» пути:

```ts
// derived.ts
return {
  ...,
  get assetsValue() { return assetsValueOf(config, upgrades, state, market.exchangeRate); },
  get assetCounts()  { return assetCountsOf(upgrades, state); },
};
```

(Ленивые геттеры совместимы с типом `DerivedStats`; если нужна сериализуемость — мемоизируй по `JSON`-сигнатуре `levels`+`wells.length`+`luxurySpent`+`exchangeRate`.) Проверь, что ни один тест не делает `toEqual` по всему `DerivedStats`.

Дополнительно: `Game.step()` вызывает `this.invalidate()` в начале каждого шага — можно инвалидировать только если изменились `playtimeMs`-зависимые величины (дебит по формуле падения), но это затрагивает детерминизм → менять только с тестом эквивалентности (`regressions.test.ts` «итог за 10 секунд не зависит от update…»).

**Проверка:** замерь `time npx vitest run tests/balance.test.ts` до/после; результат симуляций должен совпасть бит-в-бит (`result.totalEarned`).

---

## B. Правила игры ↔ реальная механика

Принцип: игроку показывается либо число из `config`, либо текст из `texts.json`; текст не должен утверждать то, чего код не делает.

| ID | Где написано | Что написано | Что делает игра | Действие |
|---|---|---|---|---|
| B1 | `rules.*`, README | Перечень механик | **Нет** в правилах: инвестдоход 1–20 % годовых на остаток, вывоз капитала, топливный демпфер, курс/девальвация и удорожание CAPEX, сжатие цен кривой `currencyCostCurve` (все цены выше 1e5 берутся под корень), множитель добычи от карточек сбыта (A5), офлайн-потолок описан, остальное нет | Добавить разделы в `rules.ts` + ключи в `texts.json`; числа брать из `config` |
| B2 | `texts.json → rules.channelRefine` | «Переработка конкурирует с экспортом по цене, поэтому при дорогом экспорте нефть сначала идёт за границу» | НПЗ всегда «дороже» экспорта по построению цены (A3) | Исправить после A3; до тех пор — убрать утверждение |
| B3 | `rules.channelDomestic` и skill `economy-accounting` п. 7, `docs/TZ.md §12` | «Контракты принимают весь остаток сырой нефти» / «безлимитный контракт» | В `config.json`: `contract.unlimited: false`, регрессионный тест это закрепляет | Обновить текст правил, skill и §12 |
| B4 | `rules.wellsText` | «Дебит падает … (половина уходит за 1800 секунд)» | Пол `minFactor = 0.7` достигается за `1800·log2(1/0.7) ≈ 926 с` (~15,4 мин), «половины» не будет никогда | Писать «падает до 70 % примерно за 15 минут и дальше не снижается»; считать значение формулой в `rules.ts` |
| B5 | README | «коридор ±30 %» для мировой цены | `config.worldPrice`: 0.75–1.28 (−25 % / +28 %). Названия тестов говорят «0.7–1.3» | Привести README/названия тестов к конфигу |
| B6 | README «Инженерное меню» | «остаётся в игре … кнопка 🛠 в шапке» | `main.ts`: пункт добавляется только при `import.meta.env.DEV`; в production его нет. Кнопка внутри меню, не в шапке | Поправить README (или принять решение показывать меню в продакшене) |
| B7 | описания `p_crisis`, `p_fuelcrisis` | «Дорого, результат ×10»; «отдача очень большая» | `factor: 2`, `chance 0.48 / 0.45`, ожидание < 1 (карточка в магазине честно пишет «×2 или ничего») | Переписать описания, чтобы совпали с механикой; ожидание ≈ 0.96/0.90 стоит сказать игроку |
| B8 | описания `p_ministry` (строка из ТЗ), `t_core`, `t_krs`, `t_resist`, `p_senate`, README про влияние | «новые месторождения…», «возвращает к жизни скважины», «усиливает геонавигатора», «укрепляет влияние», «влияние растёт от императора» | Все — обычные периодические выплаты монет (`periodic`) или не делают заявленного: у `p_senate` и `p_monarch` нет `effect.influence`; у `t_resist` нет связи с геонавигатором | Привести описания к механике **или** реализовать эффект. `p_ministry` — «строго» из ТЗ: менять осторожно, согласовать |
| B9 | `achievements`: `a_hat`, `a_brilliant`, `a_drill7`, `a_import` | «любой предмет одежды», «украшение», «Терминатор / 5 уровней долота», «впервые отправь нефть заграницу» | `a_hat` выдаётся и колечком, и часами, и сигарами (правило `ownGroup: bling`); «Терминатор» — 8-е название долота, а условие — 5-й уровень; `a_import` ставится за покупку «Контрабанды», даже если ушло по контрактной цене | Правила достижений привести к тексту |

**Проверка (автоматическая — добавить):**

```ts
it('название покупки в texts.upgrades совпадает с upgrades.json', () => {
  for (const def of content.upgrades) {
    const expected = def.stagedNames?.[0] ?? def.name;
    expect(content.texts.upgrades?.[def.id], def.id).toBe(expected);
  }
});
```

Сейчас точно расходятся `t_tank` («Поставить резервуар на 5 тысяч тонн» против «клёпаный резервуар на двадцать тысяч») и `t_topdrive` («Система автоматического поддержания добычи» против «Верхний привод»); журнал операций показывает имена из `texts.upgrades`, то есть неверные. Лучше устранить дублирование: журнал и так может брать имя из контента (`Game.stagedName`).

Ещё о правилах: `rules.ts` использует `formatMoney(…)` для `winRequirements[].balance` **без** `adjustCurrencyCost`, и так же `Shop.describeLock` — для финальной покупки (`req.balance`) сравнивает с сырым значением, тогда как `isWinReady`/симулятор применяют кривую. Сейчас в конфиге нет `balance`-требований, поэтому баг латентный; при добавлении такого требования подсказка и условие разойдутся. Вынести в общую функцию `winRequirementBlocker()` в ядре.

---

## C. Прочие дефекты кода и данных

| ID | Где | Проблема | Исправление |
|---|---|---|---|
| C1 | `src/core/economy/sales.ts` | `saleProceeds`, `exportTonnes`, `sellOil`, `netForInterval` в игре **не используются**, но покрыты тестами (`economy.test.ts`) → ложное чувство покрытия | Удалить функции и тесты либо подключить; пометить в `AUDIT-STATUS` как выполненное |
| C2 | `src/ui/hud.ts` | `set('exportPipelineCapacity' / 'exportRailCapacity' / 'exportTankerCapacity', …)` — строк с такими ключами в DOM нет; ключи `hud.exportPipelineCapacity…` не используются; `refineries`, `depots`, `azsCount`, `gross`… в `texts.hud` тоже «сироты» | Удалить мёртвые вызовы/ключи; добавить скрипт-проверку неиспользуемых ключей `texts.json` (H8) |
| C3 | `src/core/state.ts` | `SAVE_VERSION = 3`, ключ `…:save:v2`, `config.version = 2`; поле `version` при загрузке игнорируется и перезаписывается | Определить политику версий: либо миграции по `src.version`, либо убрать поле; задокументировать в `project-architecture` |
| C4 | `src/main.ts` | `reportBuyError`/`onError` недостижимы через кнопку: кнопка `disabled`, клик не срабатывает; событие `error` из `Game.buy` никем не обрабатывается; `lastWinShown` — мёртвая переменная | Либо показывать причину бейджем при клике по заблокированной карточке, либо удалить код |
| C5 | `src/ui/news.ts` | `pushRandom()` выбирает любую категорию — «убыточный банк показал рекорд» и «ЧВК получила награду» появляются до покупки банка/ЧВК | Фильтровать категории по состоянию игры или ограничить случайные набором нейтральных (`world`, `sales`, `milestone`, `production`, `influence`) |
| C6 | `src/core/content.ts` | Валидация не проверяет: `config.winRequirements[].upgrade`, `oil.autoDrill.requires`, сумму `wells.classes[].chance === 1`, обязательность `effect.channel` для `type: 'sell'`, `assetKind`, соответствие длины `stagedNames`; нет `validateConfig()` | Добавить `validateConfig(config, upgrades)` и вызвать в `loadContent`; покрыть тестами «ломаем конфиг — получаем понятную ошибку» |
| C7 | `src/core/game.ts → applyImmediateEffect` | Для `p_export`, когда `tonnes <= 0`, функция возвращает пустой результат, но кулдаун уже поставлен, `levels` обновлён → игрок теряет перезарядку без продажи | Проверять `tonnes` до списания/кулдауна (в `checkBuy` вернуть `noOil`/`noCapacity`) |
| C8 | `src/main.ts`, `storage.ts` | Две вкладки с одной игрой затирают друг другу сохранение (нет блокировки) | `BroadcastChannel`/`storage`-событие: при втором экземпляре показать предупреждение и не писать сейв |
| C9 | `src/styles/base.css` | Мёртвые правила `.hud__sales`, `.sale*`, `.hud__chips`, `.hud__chip`, `.hud__progress*`, `.hud__influence*`; `.screen::before` использует абсолютный `url('/images/bg.svg')` | Удалить мёртвое; убедиться (`npm run build` + `vite preview` из подпапки), что фон находится при `base: './'` на GitHub Pages |
| C10 | `index.html` | Мобильные остатки (`apple-mobile-web-app-*`, `maximum-scale`) при desktop-only решении | Почистить или оставить осознанно; в `AGENTS.md` написать, что это не повод возвращать мобильную поддержку |
| C11 | `src/ui/shop.ts` | `update()` каждые 200 мс вызывает `checkBuy` минимум дважды на карточку (подпись + расчёт пачки) и каждый раз сортирует список | Кэшировать `checkBuy` результатом на кадр; сортировку сделать один раз при смене вкладки |
| C12 | `src/ui/dom.ts` | В `el()` поддержан ключ `html` → `innerHTML`; комментарий говорит «innerHTML не нужен», тексты приходят из JSON, но JSON-тексты теперь влияют на разметку | Удалить поддержку `html` (никто не использует) — снижает риск XSS при подмене `texts.json` |

---

## D. Экономика: наблюдения без немедленных дефектов

Это не баги, а места, где стоит принять осознанное решение и зафиксировать в `docs/ECONOMY.md`.

1. **Доминирование кнопок-действий.** `p_launder`/`p_hideprofit`/`p_tranche` бесплатны (`baseCost 0`), выплачивают `payoutBase × value × bankScale` **без налога** (до `(15+25+40)·3.1 ≈ 248` «секунд валовой выручки» за 90 с). Профиль «оптимизатор» их использует и укладывается в 12–25 мин, но игрок, нажимающий кнопки, получает порядка ×3 к доходу. Зафиксировать как задуманное или привязать к стоимости/налогу.
2. **Периодика через `grantCoins`.** Выплаты периодических покупок не проходят налог и расходы (`AGENTS` §9 это допускает); при росте `payoutBase` они масштабируются вместе с империей — следить в отчётах баланса за долей дохода от периодики.
3. **`t_pump4` («Насос-Гигант», `type: passive`, пустой `effect`)** — чистый «налог» на путь к победе (требуется уровень 5, цена растёт ×1.12). Это допустимо, но в карточке должно быть явно сказано, что бонуса нет (сейчас — «Прямого бонуса к добыче нет. Смотрите условия…»).
4. **Расходы привязаны к теоретической `grossPerSecond`**, тогда как выручка приходит пачками раз в 5 с; в среднем сходится (регрессия «расчёт потоков совпадает с кассой»), но при очень нерегулярных потоках налоговая база по отдельным шагам колеблется.
5. **Сжатие цен корнем** (`currencyCostCurve.exponent = 0.5`) означает, что `winCost = 2.5e24` для игрока — `5e14` (500 трлн). В `balance-tuning` skill и README фигурирует `2.5e24`; указать оба числа, чтобы агент не пытался «подбирать» не то.

---

## E. Harness: тесты, CI, документация, правила для агентов

| ID | Важность | Проблема | Исправление |
|---|---|---|---|
| H1 | 🟠 | Документы говорят «три профиля» (`AGENTS.md` ссылки, `testing-regressions`), а профилей **четыре**. `tests/balance-profiles.test.ts` содержит все четыре (заголовок: «Два базовых профиля»), а `balance-profiles-extra.test.ts` **повторяет** профили 303 и 404 — одни и те же симуляции гоняются дважды | Удалить из базового файла профили 303/404 (оставить в extra), поправить заголовки и документы на «четыре профиля» |
| H2 | 🟠 | `tests/balance.test.ts` запускает ~6 длинных симуляций (до 30 игровых минут) в одном файле; skill `testing-regressions` требует ≤60 с на файл из-за RPC-таймаута Vitest. `maxWorkers: 1` + `pool: threads` делает весь прогон последовательным | Разделить на `balance-pace.test.ts`, `balance-content.test.ts`, `balance-growth.test.ts`; сначала сделать A9 (ускорение ядра); измерять время каждого файла в CI (`--reporter=verbose`) |
| H3 | 🟠 | `ci.yml`: нет `timeout-minutes`, нет `concurrency` (параллельные прогоны на каждый push и PR), запуск и на `push: arena/**`, и на `pull_request` → двойные прогоны. Версии actions (`checkout@v7`, `setup-node@v7`, `upload-artifact@v7`, `configure-pages@v6`, `upload-pages-artifact@v5`, `deploy-pages@v5`) нужно **проверить на существование** и закрепить по SHA | Добавить `timeout-minutes: 30`, `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`, пины по SHA (Dependabot для actions) |
| H4 | 🟠 | `deploy.yml` собирает `head_sha` из `workflow_run`, не проверяя, что это всё ещё вершина `main`: поздно завершившийся старый CI может задеплоить старую сборку после новой | В job `build` добавить шаг: `git fetch origin main && test "$(git rev-parse origin/main)" = "${{ github.event.workflow_run.head_sha }}"` (иначе `exit 0` с notice) |
| H5 | 🟠 | `npm run lint:strings` проверяет только `shop.ts`, `hud.ts`, `finale.ts`, хотя `AGENTS.md` запрещает русские строки во **всём** `src/ui/` и `main.ts` | В `tests/content.test.ts` перебирать `src/ui/**/*.ts` и `src/main.ts` через `readdirSync`; разрешить кириллицу в комментариях |
| H6 | 🟠 | Нет проверки согласованности «JSON-тексты ↔ код ↔ контент»: ни неиспользуемых ключей `texts.json`, ни сирот-ключей `texts.upgrades`, ни расхождения имён (B) | Скрипт `scripts/check-texts.ts` + тест: все `texts.get('a.b')` из кода (регуляркой) существуют; все ключи `hud.*`, `shop.*`, `rules.*` используются |
| H7 | 🟠 | Нет **теста «правила ↔ игра»** — главная причина дрейфа из раздела B | Добавить `tests/rules-consistency.test.ts`: правила собираются из `config`, а в тесте сверяются с поведением (дебит достигает пола за ожидаемое время; `contract.unlimited` совпадает с текстом; для каждого `effect`-поля из контента есть потребитель — см. A4) |
| H8 | 🟠 | `docs/TZ.md` помечен «историческим», но содержит §0 с инструкциями агенту («коммить и пушь после каждого шага…») и §12 с **устаревшими** числами: финал `6×10¹⁶`, контракты `unlimited: true`. Агент, читающий TZ, получит ложные факты | Перенести в `docs/archive/TZ.md`, удалить из него §0 и §12 (или заменить §12 ссылкой на актуальные `docs/ECONOMY.md`/`config.json`); в `AGENTS.md` не ссылаться на него как на источник числовых значений |
| H9 | 🟡 | Skills устарели: `economy-accounting` п. 7 («безлимитный контракт»), `balance-tuning` («три профиля») | Обновить в одном коммите с кодом; добавить в `AGENTS.md` правило: «изменил механику → обнови правила игры (`texts.json → rules`), README и skill» |
| H10 | 🟡 | `docs/AUDIT-STATUS.md` ссылается на `AUDIT_PROMPT.md`, которого нет в репозитории; раздел «Отложено» не содержит находок из этого ревью | Положить промпт в `docs/` либо убрать ссылку; после исправлений обновить статус по ID этого отчёта |
| H11 | 🟡 | E2E (`tests/e2e/smoke.spec.ts`) использует `page.waitForTimeout(300)` — прямое нарушение собственного правила в skill; не покрыты: пауза на стартовом экране (A1), Escape по «Правилам» (A7), пустое поле потока (A6), продолжение сохранения с офлайн-доходом, «Новая игра» | Заменить sleep на `expect.poll`/`waitForFunction`; добавить перечисленные сценарии |
| H12 | 🟡 | `AGENTS.md` предписывает прямые push в `main` без PR, а ветка не защищена; единственный барьер — gate деплоя по CI. Так пропущенная регрессия сначала попадает в `main` | Включить branch protection (required status check `build-and-test`) или перейти на PR по умолчанию; отразить в AGENTS |
| H13 | 🟡 | Нет линтера/форматтера (только `tsc`), нет проверки зависимостей (`npm audit`/Dependabot), `.mjs` скрипты не типизируются (`tsconfig` их не включает) | Добавить ESLint (минимум `no-unused-vars`, `no-floating-promises`, `no-restricted-syntax` для кириллицы в `src/ui`), `// @ts-check` в `.mjs`, Dependabot |
| H14 | 🟡 | `AGENTS.md` §1.6–§7 требуют проверять GitHub Actions по HEAD, но не говорят, как это делать без UI (команда `gh run list --commit <sha>`), и что делать при недоступности сети | Добавить команды и правило «если проверить нельзя — так и написать, не объявлять публикацию подтверждённой» (в целом уже требуется, но без конкретики) |

### Предлагаемый skill для harness

Добавить `.agents/skills/rules-docs-sync/SKILL.md`:

```md
---
name: rules-docs-sync
description: Use when changing mechanics, prices, config.json, upgrade effects or any player-facing explanation of how the game works.
---

# Синхронизация правил, текстов и документации

После любого изменения механики проверь по списку:
1. `src/ui/rules.ts` + `texts.json → rules.*` — числа берутся из config, формулировки не противоречат коду.
2. Описания карточек в `upgrades.json` (`description`) и строка эффекта `Shop.describeEffect`.
3. README (разделы «Как играть», «Инженерное меню», «Баланс»).
4. `docs/ECONOMY.md` и skill `economy-accounting`.
5. Тест `tests/rules-consistency.test.ts` зелёный.
Если поле `effect` добавлено в JSON — найди читающий его код; если читателя нет, поле нельзя добавлять.
```

---

## F. Рекомендуемый порядок работ

1. **Пакет 1 (безопасно, без баланса):** A1, A2, A6, A7, A8, C4, C6, C7, H1, H3–H5, H8, B3–B6, B9 (тексты), добавление тестов.
2. **Пакет 2 (производительность):** A9 → H2 (разделение баланс-тестов).
3. **Пакет 3 (решения владельца + баланс ⚖️):** A3, A4, A5, B1, B7, B8 (если реализуем механику, а не меняем тексты), D1. После каждого — `npm run balance:report`, `npm run balance`, при необходимости перекалибровка по `balance-tuning`.
4. **Пакет 4 (гигиена):** C1–C3, C5, C8–C12, H6, H7, H9–H14.

В каждом коммите: тест, исправление, обновление затронутой документации (правило из H9), затем `npm run build && npm test` (+ `test:e2e` для UI). В итоговом сообщении перечисли, что **запускалось** и что нет.

## G. Что осталось непроверенным

- Не запускались сборка, тесты, симуляции — все выводы о коде основаны на чтении; цифры в B4 (≈926 с), A5 (≈×25) и D1 посчитаны вручную по конфигу и требуют подтверждения скриптом/тестом.
- Не просмотрены целиком `texts.json` на предмет всех расхождений имён (подтверждены `t_tank`, `t_topdrive`; тест из раздела B найдёт остальные).
- Не проверялись реальные версии GitHub Actions и фактическая работоспособность деплоя (требует доступа к репозиторию).
- Визуальная вёрстка (CSS-раскладка, читаемость иконок на 64 px) не оценивалась.
