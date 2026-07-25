# Amble

**An unhurried journey down one long road — but the traveller furthest behind always goes next, so every stop you race to is a turn you hand your rivals.**

🎮 Play: https://amble.benrichardson.dev

## What it is

Amble is a quiet, competitive travel game for 1–5. You move a traveller down a single one-way road of
stops, taking a small reward at each — paint a panorama, pick up a souvenir, soak in a spring, eat at
an inn. The twist that makes it a game: after you move, the turn passes to **whoever is now furthest
behind**. So a short hop keeps you at the back and hands you another turn soon; a long leap grabs a
coveted distant stop before a rival can, but then you sit idle while everyone behind mops up everything
you skipped. Stops are single-occupancy on a one-way road, so being there when a rival passes denies
the spot to them for good.

You may claim only so many stops before the road ends, so the whole game is *which* stops to spend your
limited claims on. There are several routes to a win — commit to one deep panorama, collect a spread of
souvenirs, grind springs for the majority, or rush to eat the best meal at each first-come inn. No
dice, no combat, no hidden cards.

## How to play

- **Tap an open stop ahead** to travel there and collect what it offers. Drag to scroll the road.
- At an **inn** (a gather point everyone must stop at), pick a dish — the menu is first-come, so the
  first to arrive eats best.
- **Views** score only your single deepest one, so commit. **Souvenirs** reward a spread of kinds.
  **Springs** are worth a little, plus a bonus for the most. Most points at the end of the road wins.
- Desktop: the same stops are clickable. Works on touch and mouse; no login, nothing installed.

## Multiplayer

Live peer-to-peer for 2–5 players, or solo against travellers of the road. "Play with friends" gives
you a room to share three ways — scan the QR, open the invite link, or type the 4-character code.
It's **lockstep P2P**: no game state ever crosses the wire, only your moves, so there is nothing to
desync and the game keeps running (and can still finish) if the host leaves. There's no server — a
public signalling relay only brokers the first connection. Nothing is stored anywhere.

## Tech

- Vite 6 + vanilla TypeScript
- Canvas 2D road, DOM menus/HUD
- Shared engine (`@ben-gy/game-engine`): P2P netcode, multi-round sessions, lobby + join QR, seeded
  RNG, procedural audio
- Vitest for logic, P2P-sync determinism, a full balance simulation, and contrast
- GitHub Pages hosting

No cookies, no fingerprinting, no third-party fonts. Anonymous, cookie-less page-view counts via
Cloudflare Web Analytics.

## Local dev

```bash
npm install
npm run dev
npm test
npm run build
npm run preview
```

## License

[GNU Affero General Public License v3.0 or later](./LICENSE), with an attribution
requirement added under section 7(b) — see [ADDITIONAL-TERMS.md](./ADDITIONAL-TERMS.md).

A separate commercial licence without the AGPL's source-disclosure obligations is
available on request: <hi@ben.gy>.

Third-party components keep their own licences — see [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
