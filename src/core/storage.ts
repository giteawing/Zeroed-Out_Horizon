/**
 * Сохранение в localStorage. Здесь только чтение/запись строк —
 * вся валидация живёт в state.ts, чтобы её можно было тестировать без браузера.
 */
import { SAVE_KEY } from './state';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function getStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function readSave(storage: StorageLike | null = getStorage()): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
}

export function archiveCorruptSave(data: string, storage: StorageLike | null = getStorage()): boolean {
  if (!storage) return false;
  try {
    const backupKey = `${SAVE_KEY}:corrupt`;
    if (storage.getItem(backupKey) === null) storage.setItem(backupKey, data);
    else storage.setItem(`${backupKey}:${Date.now()}`, data);
    // Архивируем до удаления: следующий запуск не должен снова предлагать битый сейв.
    storage.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function writeSave(data: string, storage: StorageLike | null = getStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SAVE_KEY, data);
    return true;
  } catch {
    return false;
  }
}

export function clearSave(storage: StorageLike | null = getStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(SAVE_KEY);
  } catch {
    /* приватный режим — просто игнорируем */
  }
}
