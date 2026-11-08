/**
 * Форматирование чисел и времени для интерфейса.
 * Русские сокращения, чтобы не было «1.2M» вперемешку с текстом.
 */

const UNITS: Array<[number, string]> = [
  [1e15, 'квдрлн'],
  [1e12, 'трлн'],
  [1e9, 'млрд'],
  [1e6, 'млн'],
  [1e3, 'тыс.'],
];

/** 1 234 567 -> «1,23 млн» */
export function formatMoney(value: number, currency = '₦'): string {
  if (!Number.isFinite(value)) return '∞';
  const abs = Math.abs(value);
  const small = Number(formatSmall(value).replace(',', '.'));
  if (abs < 1000 && Math.abs(small) < 1000) {
    return `${currency}${formatSmall(value)}`;
  }

  // Округление может пересечь границу единиц: 999,6 тыс. → 1 млн,
  // а 999,5 → 1 тыс. Не оставляем значения вида «1000 тыс.».
  let unitIndex = UNITS.findIndex(([threshold]) => abs >= threshold);
  if (unitIndex < 0) unitIndex = UNITS.length - 1;
  while (unitIndex >= 0) {
    const [threshold, suffix] = UNITS[unitIndex];
    const scaled = value / threshold;
    const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
    const rounded = Number(scaled.toFixed(digits));
    if (Math.abs(rounded) >= 1000 && unitIndex > 0) {
      unitIndex -= 1;
      continue;
    }
    return `${currency}${trimZeros(scaled.toFixed(digits)).replace('.', ',')} ${suffix}`;
  }
  return `${currency}${formatSmall(value)}`;
}

function formatSmall(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return trimZeros(value.toFixed(digits)).replace('.', ',');
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** Число без валюты: 12,3 */
export function formatNumber(value: number): string {
  return Number.isFinite(value) ? formatSmall(value) : '∞';
}

/** Секунды -> «12:34» */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Миллисекунды -> «15 мин 20 с» */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} ч ${m} мин`;
  if (m > 0) return `${m} мин ${s} с`;
  return `${s} с`;
}

export function formatPercent(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits).replace('.', ',')}%`;
}

/** Подстановка {key} в строку из texts.json. */
export function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in params ? String(params[key]) : `{${key}}`,
  );
}
