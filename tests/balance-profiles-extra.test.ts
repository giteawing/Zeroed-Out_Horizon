/**
 * Дополнительные профили прохождения: «терпеливый экспорт» и «оптимизатор
 * повторяемых действий». Отделены от базовых, чтобы CPU-bound симуляции не
 * шли одним длинным заданием Vitest worker.
 */
import { describeBalanceProfiles } from './helpers/balance-profiles';

describeBalanceProfiles('extra', 'дополнительные профили прохождения игры');
