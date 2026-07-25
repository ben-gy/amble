// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
// Ambient type for the hosted feedback widget (feedback.benrichardson.dev/w.js).

declare global {
  interface Window {
    feedback?: {
      open(o?: { returnFocusTo?: HTMLElement | null; build?: string; label?: string }): void;
      mount(o?: object): void;
    };
  }
}

export {};
