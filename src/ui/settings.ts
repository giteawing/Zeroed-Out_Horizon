/**
 * Панель настроек: звук, частицы, новая игра. Состояние хранится в сохранении.
 */
import { el } from './dom';
import type { Texts } from './texts';

export interface SettingsCallbacks {
  onToggleSound: (enabled: boolean) => void;
  onToggleParticles: (enabled: boolean) => void;
  onNewGame: () => void;
  onClose: () => void;
}

export class Settings {
  readonly root: HTMLElement;
  private readonly soundButton: HTMLButtonElement;
  private readonly particlesButton: HTMLButtonElement;

  constructor(
    private readonly texts: Texts,
    private readonly callbacks: SettingsCallbacks,
  ) {
    this.soundButton = el('button', { class: 'btn btn--row', type: 'button' }, '');
    this.soundButton.addEventListener('click', () => {
      const next = this.soundButton.dataset.on !== 'true';
      this.callbacks.onToggleSound(next);
      this.setSound(next);
    });

    this.particlesButton = el('button', { class: 'btn btn--row', type: 'button' }, '');
    this.particlesButton.addEventListener('click', () => {
      const next = this.particlesButton.dataset.on !== 'true';
      this.callbacks.onToggleParticles(next);
      this.setParticles(next);
    });

    const newGame = el('button', { class: 'btn btn--row btn--danger', type: 'button' }, [
      el('span', {}, texts.get('settings.newGame')),
      el('small', {}, texts.get('settings.resetWarning')),
    ]);
    newGame.addEventListener('click', () => {
      if (window.confirm(texts.get('start.newGameConfirm'))) this.callbacks.onNewGame();
    });

    const close = el('button', { class: 'btn btn--gold', type: 'button' }, texts.get('panel.close'));
    close.addEventListener('click', () => this.callbacks.onClose());

    this.root = el('div', { class: 'sheet', hidden: true, role: 'dialog', 'aria-modal': 'true' }, [
      el('div', { class: 'sheet__inner' }, [
        el('h2', { class: 'sheet__title' }, texts.get('settings.title')),
        this.soundButton,
        this.particlesButton,
        newGame,
        close,
      ]),
    ]);
    this.setSound(true);
    this.setParticles(true);
  }

  setSound(enabled: boolean): void {
    this.soundButton.dataset.on = String(enabled);
    this.soundButton.textContent = this.texts.get(
      enabled ? 'settings.soundOn' : 'settings.soundOff',
    );
  }

  setParticles(enabled: boolean): void {
    this.particlesButton.dataset.on = String(enabled);
    this.particlesButton.textContent = `${this.texts.get('settings.particles')}: ${this.texts.get(
      enabled ? 'settings.particlesOn' : 'settings.particlesOff',
    )}`;
  }

  open(): void {
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }
}
