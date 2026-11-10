/**
 * Базовые профили прохождения: «быстрый экспорт» и «сбалансированная
 * логистика». Остальные два — в balance-profiles-extra.test.ts.
 * Всего профилей четыре, список один: BALANCE_PROFILES в симуляторе.
 */
import { describeBalanceProfiles } from './helpers/balance-profiles';

describeBalanceProfiles('base', 'профили прохождения игры');
