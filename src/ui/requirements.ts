/**
 * Условие открытия покупки или финала словами.
 *
 * Один формат для карточки магазина и «Правил»: обе подписи получают условие
 * из расчёта ядра (`requirementTerms`), где порог уже итоговый.
 */
import type { Texts } from './texts';
import { formatMoney } from '../core/format';
import type { RequirementTerm } from '../core/economy';
import type { Content } from '../core/types';

export function describeRequirementTerm(
  term: RequirementTerm,
  content: Content,
  texts: Texts,
  currency: string,
): string {
  switch (term.kind) {
    case 'balance':
      return texts.get('shop.unlockHint', { cost: formatMoney(term.value, currency) });
    case 'influence':
      return texts.get('shop.unlockHintInfluence', { value: term.value });
    case 'upgrade':
      return texts.get('shop.unlockHintUpgrade', {
        name: content.byId.get(term.id)?.name ?? term.id,
        level: term.level,
      });
  }
}
