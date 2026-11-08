import { describe, expect, it } from 'vitest';
import { SAVE_KEY } from '../src/core/state';
import { archiveCorruptSave } from '../src/core/storage';

describe('архив повреждённого сохранения', () => {
  it('сохраняет исходный текст отдельно и удаляет его из активного ключа', () => {
    const values = new Map<string, string>([[SAVE_KEY, '{invalid json']]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    expect(archiveCorruptSave('{invalid json', storage)).toBe(true);
    expect(values.get(SAVE_KEY + ':corrupt')).toBe('{invalid json');
    expect(values.has(SAVE_KEY)).toBe(false);
  });
});
