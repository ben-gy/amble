// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
// Amble — the winding vertical road, drawn on a canvas.

/**
 * render.ts — a woodblock road that scrolls down a paper page. Flat layered colour
 * planes, a dark ink path, bright waypoint discs each with a distinct icon, and
 * lantern-pawn travellers. All geometry lives here and is recomputed on resize —
 * never only inside the draw call, or a tap before the first frame is dropped
 * (sporeline's bug). Layout is in CONTENT space; draw() applies the scroll offset.
 */

import { type GameState, type StopKind } from './game';
import { PALETTE, SEAT_COLOUR, SEAT_DEEP, SEAT_INK } from './palette';

export interface Layout {
  sp: number; // vertical spacing between stops
  cx: number; // centre x of the winding path
  amp: number; // horizontal amplitude
  disc: number; // waypoint disc radius
  w: number;
  h: number;
  contentH: number;
}

export interface TravAnim {
  from: number;
  to: number;
  t: number; // 0..1
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
}

export interface ViewState {
  game: GameState;
  seat: number | null;
  reachable: number[];
  selected: number | null;
  scrollY: number;
  anims: TravAnim[]; // per player index
  particles: Particle[];
  motion: boolean;
  shake: number;
}

const TOP_MARGIN = 0.9; // in units of sp

export function computeLayout(len: number, w: number, h: number): Layout {
  const disc = Math.max(20, Math.min(30, w * 0.075));
  const sp = disc * 2.5;
  const amp = Math.min(w * 0.24, 64);
  const cx = w / 2;
  const contentH = (len - 1 + TOP_MARGIN * 2) * sp;
  return { sp, cx, amp, disc, w, h, contentH };
}

export function stopY(l: Layout, i: number): number {
  return (i + TOP_MARGIN) * l.sp;
}
export function stopX(l: Layout, i: number): number {
  return l.cx + l.amp * Math.sin(i * 0.55);
}

/** Interpolated screen position of a traveller (content space), stacking aside. */
function travPos(l: Layout, view: ViewState, seat: number): { x: number; y: number } {
  const p = view.game.players[seat];
  const anim = view.anims[seat];
  let idx = p.pos;
  if (anim && anim.t < 1) idx = anim.from + (anim.to - anim.from) * ease(anim.t);
  const x = l.cx + l.amp * Math.sin(idx * 0.55);
  const y = (idx + TOP_MARGIN) * l.sp;
  // Fan out travellers sharing a stop (start / inn / end).
  const here = view.game.players
    .map((q, i) => ({ i, pos: q.pos }))
    .filter((q) => q.pos === p.pos && (!view.anims[q.i] || view.anims[q.i].t >= 1));
  const slot = here.findIndex((q) => q.i === seat);
  const spread = here.length > 1 ? (slot - (here.length - 1) / 2) * (l.disc * 1.1) : 0;
  return { x: x + spread, y };
}

function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Which reachable stop (if any) is under a content-space point. */
export function stopAt(l: Layout, view: ViewState, cx: number, cy: number): number | null {
  const r = l.disc * 1.5;
  let best: number | null = null;
  let bestD = r * r;
  for (const i of view.reachable) {
    const dx = cx - stopX(l, i);
    const dy = cy - stopY(l, i);
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/* ── drawing ──────────────────────────────────────────────────────────────── */

export function draw(ctx: CanvasRenderingContext2D, l: Layout, view: ViewState, tMs: number): void {
  const { w, h } = l;
  ctx.clearRect(0, 0, w, h);

  // Paper page + layered hills (static, woodblock planes).
  ctx.fillStyle = PALETTE.paper;
  ctx.fillRect(0, 0, w, h);
  drawHills(ctx, l);

  const shakeX = view.shake > 0 ? (Math.random() - 0.5) * view.shake : 0;
  const shakeY = view.shake > 0 ? (Math.random() - 0.5) * view.shake : 0;
  ctx.save();
  ctx.translate(shakeX, -view.scrollY + shakeY);

  const g = view.game;
  const len = g.road.stops.length;

  // The road stroke.
  ctx.beginPath();
  for (let i = 0; i < len; i++) {
    const x = stopX(l, i);
    const y = stopY(l, i);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = PALETTE.road;
  ctx.lineWidth = l.disc * 0.9;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.strokeStyle = PALETTE.roadEdge;
  ctx.lineWidth = l.disc * 0.5;
  ctx.stroke();

  // Waypoint discs.
  const pulse = 0.5 + 0.5 * Math.sin(tMs / 300);
  for (let i = 0; i < len; i++) {
    const s = g.road.stops[i];
    if (s.kind === 'start') continue;
    drawStop(ctx, l, i, s.kind, s.tag, g.taken[i], view.reachable.includes(i), view.selected === i, pulse);
  }

  // Particles under the pawns.
  for (const p of view.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, l.disc * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Travellers, painted back-to-front (highest index last so leaders sit on top).
  const order = g.players.map((_, i) => i).sort((a, b) => g.players[a].pos - g.players[b].pos);
  for (const seat of order) drawTraveller(ctx, l, view, seat);

  ctx.restore();
}

function drawHills(ctx: CanvasRenderingContext2D, l: Layout): void {
  const { w, h } = l;
  const bands: Array<[number, string]> = [
    [0.16, PALETTE.paperDeep],
    [0.34, '#e0cfa4'],
  ];
  for (const [yFrac, col] of bands) {
    const base = h * yFrac;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, base + 40);
    for (let x = 0; x <= w; x += w / 6) {
      ctx.lineTo(x, base + Math.sin(x / 90 + yFrac * 10) * 18);
    }
    ctx.lineTo(w, base + 40);
    ctx.closePath();
    ctx.fill();
  }
}

function drawStop(
  ctx: CanvasRenderingContext2D,
  l: Layout,
  i: number,
  kind: StopKind,
  tag: number,
  taken: boolean,
  reachable: boolean,
  selected: boolean,
  pulse: number,
): void {
  const x = stopX(l, i);
  const y = stopY(l, i);
  const r = kind === 'inn' || kind === 'end' ? l.disc * 1.15 : l.disc;
  const color = stopColor(kind, tag);

  if (reachable) {
    ctx.beginPath();
    ctx.arc(x, y, r + 6 + pulse * 4, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.reach;
    ctx.globalAlpha = 0.35 + pulse * 0.25;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = taken ? PALETTE.taken : color;
  ctx.fill();
  if (selected) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = PALETTE.text;
    ctx.stroke();
  }

  ctx.globalAlpha = taken ? 0.45 : 1;
  drawIcon(ctx, kind, tag, x, y, r * 0.62);
  ctx.globalAlpha = 1;
}

function drawIcon(ctx: CanvasRenderingContext2D, kind: StopKind, tag: number, x: number, y: number, s: number): void {
  if (kind === 'vista') {
    drawVistaIcon(ctx, tag, x, y, s);
    return;
  }
  ctx.strokeStyle = PALETTE.glyph;
  ctx.fillStyle = PALETTE.glyph;
  ctx.lineWidth = Math.max(2, s * 0.24);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (kind) {
    case 'market':
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - s, y);
      ctx.closePath();
      ctx.stroke();
      return;
    case 'spring':
      for (let k = -1; k <= 1; k++) {
        ctx.moveTo(x + k * s * 0.6, y + s * 0.7);
        ctx.quadraticCurveTo(x + k * s * 0.6 + s * 0.5, y, x + k * s * 0.6, y - s * 0.7);
      }
      ctx.stroke();
      return;
    case 'inn':
      ctx.moveTo(x - s, y + s * 0.2);
      ctx.lineTo(x, y - s);
      ctx.lineTo(x + s, y + s * 0.2);
      ctx.moveTo(x - s * 0.7, y + s * 0.2);
      ctx.lineTo(x - s * 0.7, y + s);
      ctx.lineTo(x + s * 0.7, y + s);
      ctx.lineTo(x + s * 0.7, y + s * 0.2);
      ctx.stroke();
      return;
    case 'end':
      // a flag
      ctx.moveTo(x - s * 0.5, y + s);
      ctx.lineTo(x - s * 0.5, y - s);
      ctx.lineTo(x + s * 0.7, y - s * 0.5);
      ctx.lineTo(x - s * 0.5, y);
      ctx.stroke();
      return;
    default:
      return;
  }
  return;
}

/** Vista glyphs vary by view (Sea / Hills / Dusk). */
function drawVistaIcon(ctx: CanvasRenderingContext2D, view: number, x: number, y: number, s: number): void {
  ctx.strokeStyle = PALETTE.glyph;
  ctx.lineWidth = Math.max(2, s * 0.24);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (view === 0) {
    // Sea: two wavy lines
    for (let row = -1; row <= 0; row++) {
      const yy = y + row * s * 0.6 + s * 0.3;
      ctx.moveTo(x - s, yy);
      ctx.quadraticCurveTo(x - s * 0.5, yy - s * 0.5, x, yy);
      ctx.quadraticCurveTo(x + s * 0.5, yy + s * 0.5, x + s, yy);
    }
    ctx.stroke();
  } else if (view === 1) {
    // Hills: a mountain triangle
    ctx.moveTo(x - s, y + s * 0.7);
    ctx.lineTo(x - s * 0.2, y - s * 0.6);
    ctx.lineTo(x + s * 0.3, y + s * 0.1);
    ctx.lineTo(x + s * 0.6, y - s * 0.3);
    ctx.lineTo(x + s, y + s * 0.7);
    ctx.closePath();
    ctx.stroke();
  } else {
    // Dusk: a crescent
    ctx.arc(x, y, s * 0.85, Math.PI * 0.25, Math.PI * 1.75);
    ctx.stroke();
  }
}

export function stopColor(kind: StopKind, tag: number): string {
  switch (kind) {
    case 'vista':
      return tag === 0 ? PALETTE.vistaSea : tag === 1 ? PALETTE.vistaHill : PALETTE.vistaDusk;
    case 'market':
      return PALETTE.market;
    case 'spring':
      return PALETTE.spring;
    case 'inn':
      return PALETTE.inn;
    case 'end':
      return PALETTE.market;
    default:
      return PALETTE.taken;
  }
}

function drawTraveller(ctx: CanvasRenderingContext2D, l: Layout, view: ViewState, seat: number): void {
  const { x, y } = travPos(l, view, seat);
  const r = l.disc * 0.66;
  const col = SEAT_COLOUR[seat % SEAT_COLOUR.length];
  const deep = SEAT_DEEP[seat % SEAT_DEEP.length];

  // shadow
  ctx.fillStyle = PALETTE.shadow;
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.9, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();

  // lantern-pawn body
  ctx.beginPath();
  ctx.arc(x, y - r * 0.2, r, 0, Math.PI * 2);
  ctx.fillStyle = col;
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.18);
  ctx.strokeStyle = deep;
  ctx.stroke();

  // numeral
  ctx.fillStyle = SEAT_INK;
  ctx.font = `700 ${Math.round(r * 1.05)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(seat + 1), x, y - r * 0.16);
}

/* ── particles ────────────────────────────────────────────────────────────── */

export function spawnBurst(list: Particle[], x: number, y: number, color: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 40 + Math.random() * 120;
    list.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0.6, max: 0.6, color });
  }
}

export function stepParticles(list: Particle[], dt: number): void {
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 260 * dt;
    p.life -= dt;
    if (p.life <= 0) list.splice(i, 1);
  }
}
