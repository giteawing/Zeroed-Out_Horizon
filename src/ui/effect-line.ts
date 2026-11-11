/**
 * Строка эффекта на карточке покупки: что она делает, числами из данных.
 *
 * Описание карточки пишет автор, а эта строка собирается из `effect` и
 * `config.json`, поэтому она обязана назвать каждое действующее поле:
 * о чём она молчит, о том игрок не узнает. Порядок и подписи — из
 * `texts.json → shop`; чисел и русских слов в коде нет.
 */
import type { Texts } from './texts';
import { formatMoney, formatNumber, formatPercent } from '../core/format';
import { grantsField } from '../core/economy';
import type { GameConfig, UpgradeDef, Well } from '../core/types';

export interface EffectLineContext {
  texts: Texts;
  config: GameConfig;
  currency: string;
  /** Последняя пробуренная скважина: её показывает карточка бурения. */
  lastWell: Well | undefined;
  /** Названия покупок, которые открывает данная. */
  unlocks: readonly string[];
}

const SEPARATOR = ' · ';

/** Прибавка со знаком: «+6,0%», «−3,0%». */
function signedPercent(ratio: number, digits: number): string {
  return `${ratio < 0 ? '−' : '+'}${formatPercent(Math.abs(ratio), digits)}`;
}

/**
 * @param level купленный уровень; у ещё не купленной карточки показывается
 *   эффект первого уровня.
 */
export function describeEffect(def: UpgradeDef, level: number, context: EffectLineContext): string {
  const { texts, config } = context;
  const e = def.effect;
  const t = (key: string, params: Record<string, string | number> = {}): string =>
    texts.get(`shop.${key}`, params);
  const shownLevel = Math.max(1, level);
  const parts: string[] = [];
  let prefix = '';

  switch (def.type) {
    case 'production':
      parts.push(t('effectProduction', { value: formatNumber(e.value ?? 0) }));
      break;
    case 'passive':
      if (config.oil.autoDrill.requires.includes(def.id)) {
        parts.push(t('effectCrew', { value: formatPercent(config.oil.autoDrill.bonus, 0) }));
      }
      if (def.group === 'staff' || def.group === 'crew') parts.push(t('effectStaff'));
      if (e.exportBonus) {
        parts.push(t('effectPassiveExport', { value: formatPercent(e.exportBonus, 1) }));
      }
      if (e.salaryAdd) {
        parts.push(t('effectPassiveSalary', { value: formatPercent(e.salaryAdd, 1) }));
      }
      if (e.capitalFlightPerSecond) {
        parts.push(t('effectCapitalFlight', {
          value: formatMoney(e.capitalFlightPerSecond, context.currency),
          growth: formatPercent(e.capitalFlightGrowthPerMinute ?? 0, 0),
        }));
      }
      break;
    case 'well':
    case 'field': {
      if (grantsField(def)) {
        // Отжатие и реприватизация приносят месторождение — пакет скважин.
        parts.push(t('effectField', {
          min: config.oil.conquestWells.min,
          max: config.oil.conquestWells.max,
        }));
        break;
      }
      // Бурение — лотерея: показываем последнюю скважину.
      const last = context.lastWell;
      parts.push(last
        ? t('effectWellLast', {
          value: formatNumber(last.dailyTonnes),
          kind: texts.get(`wells.${last.kind}`),
        })
        : t('effectWellHint'));
      break;
    }
    case 'multiplier': {
      if (e.fuelDamper) parts.push(t('effectFuelDamper'));
      // Множитель 1 добычу не меняет: такая карточка даёт только влияние
      // или включает механику, и обещать «к добыче» ей нечего.
      const factor = e.factor ?? 1;
      if (factor !== 1) {
        // Тот же закон, что в ядре: factor^√уровень.
        parts.push(t('effectMultiplier', {
          value: signedPercent(Math.pow(factor, Math.sqrt(shownLevel)) - 1, 1),
        }));
      }
      break;
    }
    case 'taxCut':
      parts.push(t('effectTaxCut', { value: formatPercent((e.percent ?? 0) / 100, 1) }));
      // Банк усиливает операции: показываем, насколько выросли выплаты.
      if (e.bankScale) parts.push(t('effectBankScale', { value: formatPercent(e.bankScale, 0) }));
      break;
    case 'costCut':
      parts.push(t('effectCostCut', { value: (e.percent ?? 0).toFixed(0) }));
      break;
    case 'priceBoost':
      if (e.domesticPriceMultiplier && e.domesticPriceMultiplier !== 1) {
        parts.push(t('effectDomesticPrice', { value: formatPercent(e.domesticPriceMultiplier - 1, 1) }));
      }
      if (e.exportPriceMultiplier && e.exportPriceMultiplier !== 1) {
        parts.push(t('effectExportPrice', { value: formatPercent(e.exportPriceMultiplier - 1, 1) }));
      }
      if (e.exchangeRateDevaluation) {
        parts.push(t('effectDevaluation', { value: formatPercent(e.exchangeRateDevaluation, 1) }));
      }
      break;
    case 'oneShot':
      if (e.sellsOil) {
        // Продаётся нефть со склада: сумму задают запас и цена, не `value`.
        parts.push(t('effectOilBurst'));
      } else {
        // Точная выплата зависит от текущего темпа империи, поэтому в
        // карточке понятное описание, а не фиктивное число.
        parts.push(t('effectOneShotHint'));
        if (e.launder) parts.push(t('effectLaunder'));
      }
      break;
    case 'gamble':
      parts.push(t('effectGamble', {
        seconds: e.seconds ?? 0,
        value: e.factor ?? 2,
        chance: formatPercent(e.chance ?? 0, 0),
      }));
      break;
    case 'periodic':
      parts.push(t('effectPeriodic', { seconds: e.seconds ?? 0, value: (e.value ?? 0) * shownLevel }));
      break;
    case 'sell': {
      const channel = e.channel ?? 'contract';
      parts.push(t('effectSell', { value: formatNumber((e.value ?? 0) * shownLevel) }));
      if (e.percent) {
        const key = channel === 'refine' ? 'effectSellThroughput' : 'effectSellVolume';
        parts.push(t(key, { value: formatPercent(e.percent / 100, 1) }));
      }
      if (e.costCut) parts.push(t('effectCostCut', { value: (e.costCut * 100).toFixed(0) }));
      // В карточке видно, какой именно рынок она расширяет: сырьё,
      // нефтепродукты или оба.
      const split = e.channelSplit;
      const crude = !split || (split.crude ?? 0) > 0;
      const products = !split || (split.products ?? 0) > 0;
      const scope = crude && products ? 'scopeBoth' : products ? 'scopeProducts' : 'scopeCrude';
      prefix = `${texts.get(`sales.${channel}`)}${SEPARATOR}${t(scope)}: `;
      break;
    }
    case 'storage':
      parts.push(t('effectStorage', { value: formatNumber((e.value ?? 0) * shownLevel) }));
      break;
    case 'luxury':
      parts.push(t('effectLuxury'));
      break;
    case 'win':
      parts.push(texts.get('finale.pumpName'));
      break;
  }

  // Влияние и скидку на отжатие ядро применяет у покупки любого типа.
  if (e.influence) parts.push(t('effectInfluence', { value: formatNumber(e.influence) }));
  if (e.conquestCut) parts.push(t('effectConquestCut', { value: formatPercent(e.conquestCut, 0) }));

  // Обязательный уровень для финала — из того же конфига, что и сам финал.
  const goal = config.winRequirements.find((req) => req.upgrade === def.id);
  if (goal) parts.push(t('effectGoalStage', { level: goal.level ?? 1 }));

  if (def.type === 'passive') {
    if (context.unlocks.length > 0) {
      parts.push(t('effectUnlocks', { names: context.unlocks.slice(0, 3).join(', ') }));
    }
    // Покупка без единого действующего поля ничего не прибавляет, и карточка
    // говорит это прямо. Бригада — исключение: её полный состав удваивает добычу.
    const crew = config.oil.autoDrill.requires.includes(def.id);
    if (Object.keys(e).length === 0 && !crew) parts.push(t('effectNoDirectBonus'));
  }

  return prefix + parts.join(SEPARATOR);
}
