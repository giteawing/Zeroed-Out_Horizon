/**
 * Частицы и всплывающие цифры.
 *
 * Требования ТЗ §8.1:
 *   • пул, не больше 40 частиц одновременно (и 18 цифр);
 *   • рисуем в canvas, а двигаем только transform/opacity;
 *   • при prefers-reduced-motion и выключенных частицах — не рисуем вовсе.
 *
 * Canvas масштабируется под devicePixelRatio, но не выше 2 — чтобы
 * на телефоне не гонять 3x буфер без нужды.
 */
import type { GameConfig } from '../core/types';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  kind: 'oil' | 'spark' | 'coin';
}

interface Floating {
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  text: string;
  tone: 'gain' | 'warning' | 'gold';
}

export class Effects {
  private ctx: CanvasRenderingContext2D | null;
  private particles: Particle[] = [];
  private floats: Floating[] = [];
  private width = 0;
  private height = 0;
  private dpr = 1;
  private readonly maxParticles: number;
  private readonly maxFloats: number;
  private enabled = true;
  private rafId = 0;
  private lastTime = 0;
  private reduced = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    config: GameConfig,
  ) {
    this.ctx = canvas.getContext('2d');
    this.maxParticles = config.particles.maxParticles;
    this.maxFloats = config.particles.maxFloating;
    this.reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.particles = [];
      this.floats = [];
      this.clear();
    }
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    if (this.ctx) {
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
  }

  /** Брызги нефти при тапе. x/y — в координатах canvas. */
  splash(x: number, y: number, power = 1): void {
    if (!this.enabled || this.reduced) return;
    const count = 3 + Math.floor(power * 3);
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
      const speed = 90 + Math.random() * 190 * power;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 0.5 + Math.random() * 0.4,
        size: 2 + Math.random() * 4,
        kind: 'oil',
      });
    }
    this.start();
  }

  /** Искры при крупном событии. */
  burst(x: number, y: number, count = 14): void {
    if (!this.enabled || this.reduced) return;
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      const angle = Math.random() * Math.PI * 2;
      const speed = 120 + Math.random() * 260;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 0.6 + Math.random() * 0.5,
        size: 2 + Math.random() * 3,
        kind: 'spark',
      });
    }
    this.start();
  }

  /** Всплывающая цифра «+N». */
  floatText(x: number, y: number, text: string, tone: Floating['tone'] = 'gain'): void {
    if (!this.enabled) return;
    if (this.floats.length >= this.maxFloats) this.floats.shift();
    this.floats.push({
      x: x + (Math.random() - 0.5) * 40,
      y,
      vy: this.reduced ? -20 : -70 - Math.random() * 40,
      life: 0,
      maxLife: 0.9,
      text,
      tone,
    });
    this.start();
  }

  private start(): void {
    if (this.rafId) return;
    this.lastTime = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  private frame = (time: number): void => {
    const dt = this.lastTime ? Math.min(0.05, (time - this.lastTime) / 1000) : 0.016;
    this.lastTime = time;
    this.update(dt);
    this.draw();
    if (this.particles.length > 0 || this.floats.length > 0) {
      this.rafId = requestAnimationFrame(this.frame);
    } else {
      this.rafId = 0;
      this.clear();
    }
  };

  private update(dt: number): void {
    for (const p of this.particles) {
      p.life += dt;
      p.vy += 900 * dt; // гравитация
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life < p.maxLife);

    for (const f of this.floats) {
      f.life += dt;
      f.y += f.vy * dt;
      f.vy *= 0.96;
    }
    this.floats = this.floats.filter((f) => f.life < f.maxLife);
  }

  private clear(): void {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.width, this.height);

    for (const p of this.particles) {
      const alpha = 1 - p.life / p.maxLife;
      ctx.globalAlpha = Math.max(0, alpha);
      if (p.kind === 'oil') {
        ctx.fillStyle = '#1b1b20';
      } else if (p.kind === 'spark') {
        ctx.fillStyle = '#ffd766';
      } else {
        ctx.fillStyle = '#f2b430';
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.6 + alpha * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.textAlign = 'center';
    for (const f of this.floats) {
      const progress = f.life / f.maxLife;
      const alpha = progress < 0.15 ? progress / 0.15 : 1 - (progress - 0.15) / 0.85;
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.font = `800 ${Math.round(20 + (1 - progress) * 6)}px system-ui, -apple-system, sans-serif`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(23,17,12,0.85)';
      ctx.fillStyle = f.tone === 'warning' ? '#ff8f8f' : f.tone === 'gold' ? '#ffd766' : '#7ef2a3';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  destroy(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.particles = [];
    this.floats = [];
  }
}
