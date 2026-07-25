// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
// Amble — the 3-2-1-GO count-in (principle #15).

/**
 * A round never begins the instant the board appears: whoever happened to be
 * looking would get a free head start. Each peer counts locally from the moment
 * the host's start arrives, so the two are in step to within one network hop.
 *
 * Driven by setInterval, not rAF: a backgrounded tab never fires rAF, and a
 * count-in that silently never finishes is a hang.
 */

import type { Sfx } from '@ben-gy/game-engine/sound';

export interface Countdown {
  cancel(): void;
}

export function runCountdown(
  container: HTMLElement,
  sfx: Sfx,
  onDone: () => void,
  steps: string[] = ['3', '2', '1', 'Set off'],
): Countdown {
  const el = document.createElement('div');
  el.className = 'countdown';
  el.setAttribute('aria-live', 'assertive');
  container.appendChild(el);

  let i = 0;
  let done = false;

  const finish = (): void => {
    if (done) return;
    done = true;
    clearInterval(timer);
    el.remove();
    onDone();
  };

  const show = (): void => {
    if (i >= steps.length) {
      finish();
      return;
    }
    el.textContent = steps[i];
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
    try {
      sfx.play(i === steps.length - 1 ? 'powerup' : 'blip');
    } catch {
      /* audio is never allowed to break the round starting */
    }
    i++;
  };

  show();
  const timer = setInterval(show, 700);

  return {
    cancel() {
      if (done) return;
      done = true;
      clearInterval(timer);
      el.remove();
    },
  };
}
