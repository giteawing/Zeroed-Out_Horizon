/**
 * Загрузчик контента. Единственное место, которое знает, откуда берутся данные.
 * Чтобы добавить покупку — правится только JSON, код не трогаем.
 */
import configJson from '../content/config.json';
import textsJson from '../content/texts.json';
import upgradesJson from '../content/upgrades.json';
import achievementsJson from '../content/achievements.json';
import type {
  AchievementsFile,
  Content,
  GameConfig,
  TextsFile,
  UpgradeDef,
  UpgradesFile,
} from './types';

const TABS = new Set(['political', 'technical', 'sales', 'luxury', 'goals']);
const TYPES = new Set([
  'perTap', 'well', 'passive', 'multiplier', 'taxCut', 'costCut', 'periodic',
  'oneShot', 'gamble', 'priceBoost', 'luxury', 'autoTap', 'sell', 'storage', 'win',
]);

/** Плейсхолдер из ТЗ (§7.4): пока владелец не положил стихотворение. */
const CREDITS_PLACEHOLDER_MARKER = 'Здесь будет стихотворение';

export interface LoadOptions {
  /** Текст титров. В браузере подставляется из credits.txt через Vite (?raw). */
  credits?: string;
}

export function loadContent(options: LoadOptions = {}): Content {
  const config = configJson as unknown as GameConfig;
  const texts = textsJson as unknown as TextsFile;
  // effect может отсутствовать у роскоши — подставляем пустой объект,
  // чтобы остальной код не проверял его на существование.
  const upgrades = ((upgradesJson as unknown as UpgradesFile).upgrades as UpgradeDef[]).map(
    (def) => ({ ...def, effect: def.effect ?? {} }),
  );
  const achievements = (achievementsJson as unknown as AchievementsFile).achievements;

  validateUpgrades(upgrades);

  return {
    config,
    texts,
    upgrades,
    byId: new Map(upgrades.map((u) => [u.id, u])),
    achievements,
    credits: options.credits ?? '',
  };
}

/** Проверка целостности контента: падаем громко и понятно, а не молча. */
export function validateUpgrades(upgrades: UpgradeDef[]): void {
  const seen = new Set<string>();
  for (const u of upgrades) {
    if (!u.id) throw new Error('upgrades.json: покупка без id');
    if (seen.has(u.id)) throw new Error(`upgrades.json: дублирующийся id «${u.id}»`);
    seen.add(u.id);
    if (!TABS.has(u.tab)) throw new Error(`upgrades.json: неизвестная вкладка «${u.tab}» у ${u.id}`);
    if (!TYPES.has(u.type)) throw new Error(`upgrades.json: неизвестный type «${u.type}» у ${u.id}`);
    if (!u.name) throw new Error(`upgrades.json: пустое имя у ${u.id}`);
    if (!u.description) throw new Error(`upgrades.json: пустое описание у ${u.id}`);
    if (!u.icon) throw new Error(`upgrades.json: пустая иконка у ${u.id}`);
    if (!Number.isFinite(u.baseCost) || u.baseCost < 0) {
      throw new Error(`upgrades.json: некорректная baseCost у ${u.id}`);
    }
    if (u.repeatable && !u.cooldownSeconds) {
      throw new Error(`upgrades.json: repeatable-покупка ${u.id} без cooldownSeconds`);
    }
    if (!Number.isInteger(u.maxLevel) || u.maxLevel < 1) {
      throw new Error(`upgrades.json: некорректный maxLevel у ${u.id}`);
    }
    if (u.unlockAt?.upgrade && !upgrades.some((o) => o.id === u.unlockAt?.upgrade)) {
      throw new Error(
        `upgrades.json: ${u.id} ссылается на несуществующую покупку ${u.unlockAt.upgrade}`,
      );
    }
  }
  if (!upgrades.some((u) => u.win)) {
    throw new Error('upgrades.json: нет финальной покупки (win: true)');
  }
}

/** Лежит ли в credits.txt заглушка вместо стихотворения. */
export function creditsIsPlaceholder(credits: string): boolean {
  const body = credits
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('Империя обнуленного горизонта'))
    .join('\n')
    .trim();
  return body.includes(CREDITS_PLACEHOLDER_MARKER) || body.length < 40;
}

/** Путь к иконке покупки (относительно базы статики). */
export function iconPath(icon: string): string {
  return `images/icons/${icon}.svg`;
}
