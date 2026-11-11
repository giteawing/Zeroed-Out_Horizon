/**
 * Web Locks API в миниатюре — для тестов «одна игра — одна вкладка».
 *
 * Правила те же, что в браузере: у имени один держатель, остальные ждут в
 * очереди, запрос с `ifAvailable` не ждёт и получает `null`. Замок держится,
 * пока не завершится промис колбэка; в браузере его отпускает ещё и закрытие
 * вкладки — здесь это `close()` у «другой вкладки».
 */
type LockCallback = (lock: { name: string } | null) => unknown;

export class FakeLocks {
  /** Имена замков в порядке запросов. */
  readonly requested: string[] = [];
  private readonly held = new Set<string>();
  private readonly waiting = new Map<string, Array<() => void>>();
  /** Ответ браузера приходит не раньше этого промиса (см. `pause()`). */
  private answer: Promise<void> = Promise.resolve();
  private releaseAnswers = (): void => {};

  request(
    name: string,
    options: { ifAvailable?: boolean } | LockCallback,
    callback?: LockCallback,
  ): Promise<unknown> {
    const run = typeof options === 'function' ? options : callback;
    const ifAvailable = typeof options !== 'function' && options.ifAvailable === true;
    if (!run) return Promise.reject(new TypeError('request: нет колбэка'));
    this.requested.push(name);
    return new Promise((resolve, reject) => {
      const answer = this.answer;
      const grant = (): void => {
        this.held.add(name);
        answer
          .then(() => run({ name }))
          .then(resolve, reject)
          .finally(() => this.release(name));
      };
      if (!this.held.has(name)) grant();
      else if (ifAvailable) answer.then(() => run(null)).then(resolve, reject);
      else this.queueOf(name).push(grant);
    });
  }

  /**
   * Придержать ответы на новые запросы до `resume()`. В браузере ответ
   * приходит через миллисекунды после запроса — за это время страница
   * успевает что-то сделать.
   */
  pause(): void {
    this.answer = new Promise<void>((resolve) => { this.releaseAnswers = resolve; });
  }

  resume(): void {
    this.releaseAnswers();
    this.answer = Promise.resolve();
  }

  /** Замок сейчас кто-то держит. */
  isHeld(name: string): boolean {
    return this.held.has(name);
  }

  /** Сколько запросов ждёт своей очереди. */
  waitingFor(name: string): number {
    return this.queueOf(name).length;
  }

  /** Другая вкладка с игрой: держит замок, пока её не закроют. */
  openOtherTab(name: string): { close: () => void } {
    let release = (): void => {};
    void this.request(name, () => new Promise<void>((resolve) => { release = resolve; }));
    return { close: () => release() };
  }

  private queueOf(name: string): Array<() => void> {
    let queue = this.waiting.get(name);
    if (!queue) {
      queue = [];
      this.waiting.set(name, queue);
    }
    return queue;
  }

  private release(name: string): void {
    this.held.delete(name);
    this.queueOf(name).shift()?.();
  }
}

/** Дать отработать колбэкам замков: в браузере они приходят асинхронно. */
export async function settleLocks(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
