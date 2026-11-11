/**
 * Одна игра — одна вкладка.
 *
 * Сохранение в localStorage общее для всех вкладок, а состояние у каждой
 * своё: вторая вкладка читает сейв при загрузке и, начав играть, затирает
 * всё, что первая наиграла с тех пор. Поэтому сохранение пишет только
 * вкладка, которая открылась первой; остальные ждут, пока она закроется.
 *
 * Кто первый, решает браузер (Web Locks API): замок сам освобождается, когда
 * вкладка закрыта, перезагружена или упала, — следить за «живостью» вкладок
 * не нужно. Где Web Locks нет (старый браузер, страница не по HTTPS), игра
 * работает как раньше, без защиты.
 */
import { SAVE_KEY } from './state';

/** Часть Web Locks API, которая нужна игре. */
export interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable?: boolean },
    callback: (lock: object | null) => Promise<unknown> | void,
  ): Promise<unknown>;
}

export interface SaveClaimHandlers {
  /** Сохранение держит другая вкладка: здесь его нельзя ни писать, ни стирать. */
  onBusy: () => void;
  /** Та вкладка закрылась: сохранение теперь держит эта. */
  onFree: () => void;
}

function browserLocks(): LockManagerLike | null {
  try {
    if (typeof navigator === 'undefined') return null;
    return (navigator as Navigator & { locks?: LockManagerLike }).locks ?? null;
  } catch {
    return null;
  }
}

/** Держать замок, пока жива вкладка: браузер отпустит его сам. */
const untilTabCloses = (): Promise<never> => new Promise<never>(() => {});

/**
 * Занять сохранение для этой вкладки. Первой вкладке не сообщается ничего;
 * остальные получают `onBusy`, а когда дождутся своей очереди — `onFree`.
 */
export function claimSave(
  handlers: SaveClaimHandlers,
  locks: LockManagerLike | null = browserLocks(),
): void {
  if (!locks) return;
  // Отказ браузера (хранилище запрещено для страницы) — не повод ронять
  // игру: она просто остаётся без защиты от второй вкладки.
  const quietly = (request: () => Promise<unknown>): void => {
    try {
      request().catch(() => {});
    } catch {
      /* см. выше */
    }
  };
  quietly(() => locks.request(SAVE_KEY, { ifAvailable: true }, (lock) => {
    if (lock) return untilTabCloses();
    handlers.onBusy();
    quietly(() => locks.request(SAVE_KEY, {}, () => {
      handlers.onFree();
      return untilTabCloses();
    }));
    return undefined;
  }));
}
