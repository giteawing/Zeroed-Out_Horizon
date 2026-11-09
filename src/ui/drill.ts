/**
 * Центральная сцена: скважина с долотом. Тап — через Pointer Events
 * (мгновенно и с мультитачем, ТЗ §8.1).
 *
 * Технические детали:
 *   • pointerdown, а не click — нет задержки 300 мс и работает мультитач;
 *   • touch-action: manipulation задаётся в CSS;
 *   • анимация вращения шарошек — CSS, а не JS: 60 fps без нагрузки;
 *   • события отдаются наружу координатами внутри сцены для частиц.
 */
import { el } from './dom';
import { image } from '../core/assets';
import type { Texts } from './texts';

export interface DrillCallbacks {
  onTap: (info: { x: number; y: number; pointerId: number }) => void;
  onFirstTouch: () => void;
}

export class Drill {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  private readonly stage: HTMLElement;
  private readonly image: HTMLImageElement;
  private firstTouchDone = false;
  private pulseTimer = 0;

  constructor(texts: Texts, private readonly callbacks: DrillCallbacks) {
    this.canvas = el('canvas', { class: 'drill__fx', 'aria-hidden': 'true' });
    this.image = el('img', {
      class: 'drill__art',
      src: image('drill.svg'),
      alt: texts.data.meta.title,
      draggable: 'false',
      width: 512,
      height: 512,
    });
    this.stage = el('button', {
      class: 'drill__stage',
      type: 'button',
      'aria-label': texts.get('start.tagline'),
      'data-testid': 'drill',
    }, [this.image, this.canvas]);

    this.stage.addEventListener('pointerdown', this.handlePointer, { passive: true });
    // Клавиатура тоже должна работать (доступность), но без двойного счёта.
    this.stage.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.emitTap(event);
      }
    });

    this.root = el('section', { class: 'drill' }, [this.stage]);
  }

  private handlePointer = (event: PointerEvent): void => {
    this.emitTap(event);
  };

  private emitTap(event: Event): void {
    const rect = this.stage.getBoundingClientRect();
    let x: number;
    let y: number;
    let pointerId = 0;
    if (typeof PointerEvent !== 'undefined' && event instanceof PointerEvent) {
      x = event.clientX - rect.left;
      y = event.clientY - rect.top;
      pointerId = event.pointerId;
    } else {
      x = rect.width / 2;
      y = rect.height / 2;
    }
    if (!this.firstTouchDone) {
      this.firstTouchDone = true;
      this.callbacks.onFirstTouch();
    }
    this.animateTap();
    this.callbacks.onTap({ x, y, pointerId });
  }

  /** Короткая анимация удара: класс снимается через 140 мс. */
  private animateTap(): void {
    this.root.classList.remove('drill--hit');
    // Форсируем пересчёт стилей, чтобы анимация перезапускалась.
    void this.root.offsetWidth;
    this.root.classList.add('drill--hit');
    window.clearTimeout(this.pulseTimer);
    this.pulseTimer = window.setTimeout(() => this.root.classList.remove('drill--hit'), 160);
  }

  /** Крупное событие: тряска всей сцены. */
  shake(): void {
    this.root.classList.add('drill--shake');
    window.setTimeout(() => this.root.classList.remove('drill--shake'), 600);
  }

  get size(): { width: number; height: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }
}
