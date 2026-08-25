<div align="center">

# VoidStonks 🌌

**A Warframe companion for trading and farming, built for the players who can't run an
in-game overlay: console, Linux and phone.**

[voidstonks.com](https://voidstonks.com)

</div>

---

## What it is

It started as a recruitment-text generator. It is now a set of tools that answer three
questions while you play:

- **What is this worth?** Live warframe.market prices for prime parts, sets, mods, arcanes
  and rivens, plus the ducat value of everything you own.
- **What should I farm next?** Which relic gets you closest to finishing a set, which of the
  open fissures to run for it, and roughly how many runs it takes.
- **Is this riven any good?** A price estimate and a per-stat grade based on the weapon's own
  market data, straight from the reroll screen if you want.

**It never touches your Warframe account.** There is no code injection, no log file to hand
over, no credentials. Everything the app knows about your inventory comes from OCR run on a
screen you choose to share with it, or from what you type in yourself. That constraint is the
whole reason the project exists: on console, on Linux and on a phone, an overlay is not an
option, so the app reads the screen the same way you do.

Everything is stored in your browser. There is no account and no server-side profile.

---

## Features

### Relics and prime sets

Look up any relic to see its drop table with live prices, ducat values, rarity and a link to
warframe.market. The profitability figures are per refinement (Intact through Radiant) and per
squad size, so "is it worth radding this" has an actual number behind it.

The set tracker works the other way round: pick a prime set, mark what you already own and it
shows which relics drop the missing parts. Sets you have half-built are surfaced on their own
so you don't have to remember which ones you started.

### Farm routes

Given the parts you are missing, the relics you own and the fissures currently open, it tells
you which relic to crack, which mission to run and how many runs it usually takes. The
"By relic" side starts from your shelf instead: which of the relics you own gets you closer to
more sets in a single crack. It also works out whether refining a relic pays for itself, in
platinum and in traces.

It needs to know what you own, so it runs off your scanned or hand-entered inventory.

### Prime inventory and the scanner

Share your Warframe window and the app reads your inventory off the screen. It works out on
its own which screen you are on — inventory grid, relic grid, mission rewards, riven card —
and reads accordingly, including the quantity badges on each item.

Details that matter in practice:

- **No calibration.** The item grid is detected per frame from the edges in the image, so it
  survives UI themes, resolutions and a stream that arrives rescaled.
- **Two OCR engines.** Tesseract does the reading; PaddleOCR (ONNX Runtime Web) is available
  as an engine or as a fallback for the captures Tesseract mangles.
- **Closed catalogues.** Names are resolved against the known item list rather than trusted
  verbatim, so a misread either lands on the right item or is dropped.
- **Quantity badges** are read by template-matching digits, which handles the small isolated
  numerals that general OCR gets wrong.
- **Phone as a camera.** If you play on console, point your phone at the screen and scan the
  end-of-mission rewards; results come back in under a second and the screen stays awake while
  the scanner is open.

Debug mode saves the frame that failed, which is what makes bug reports actionable.

### Riven appraisal

Enter a riven by hand or scan it, and you get an estimated price, a range, a grade and a
per-stat breakdown of how good each roll is *for that weapon*.

- Stat weights come from each weapon's own market data, not a global list of "good stats", so
  the Bo and the Kuva Bramma no longer get the same advice.
- How high a stat rolled inside its range counts towards the price, not just which stat it is.
- Negatives are judged per weapon: −Multishot ruins a rifle and barely touches a melee.
- The estimate is compared against live listings for the same combo and against a month of
  price history, with a flag when a weapon looks like a bubble or is simply illiquid.

The model is trained offline on real auction data and served as a distilled JSON table, so the
browser does no inference. It is honest about its limits: across 1434 real auctions it ranks
rolls the way the market ranks them on about 85% of weapons, with a mean error near 47%. Two
identical rivens get listed at different prices, and no amount of tuning fixes that — use the
range, not the single number.

### Riven scanner

Point the scanner at the reroll screen and it reads both cards at once, new roll against the
old one, and prices them side by side. Weapon, stats and values come off the card; the
appraisal is the same one the manual tool uses.

### Farms: fissures, bounties and alarms

The fissure list refreshes on its own and marks the fast mission types, the last five minutes
of each fissure and the ones matching the relic era you are working on. Steel Path and Omnia
are handled separately where it matters.

Bounties for the open worlds are listed with their rotations, and you can set alarms: tell it
which bounty reward, fissure tier, mission type or arbitration tier you care about and it
notifies you when one is up. There is also a countdown to the next S-tier arbitration and a
rotation tracker for Coda and Tenet weapons.

### Vosfor

For arcanes, it compares selling on warframe.market against dissolving into Vosfor. It shows
which Loid pack has the best expected platinum per pull and which sells fastest, accounts for
how liquid each arcane actually is, and simulates how much Vosfor you need for the copies of a
target arcane.

### Ducats

Your scanned prime parts sorted by ducat value, with a threshold you can set to separate what
is worth selling to Baro from what is worth trading for platinum.

### My orders (work in progress)

A tab to manage your warframe.market sales from the app: your orders with the market price
next to them, editing price, quantity and rank, listing sets from your inventory with a
suggested price, and a warning when someone undercuts you.

It is currently marked WIP and gated: it is waiting on warframe.market offering a proper OAuth
login for third-party apps. The desktop build is where this is headed — a native login that
keeps credentials out of any intermediate server (see
[`deploy/js/utils/native_bridge.contract.md`](deploy/js/utils/native_bridge.contract.md)).

### LFG and cross-device sync

The original feature is still here: generated recruitment messages with presets for the runs
that need them (Eidolon roles, Deep Archimedea tiers, relic runs). Write the message on your
phone and pull it up on your PC or console through a four-digit code — a throwaway mailbox
that holds one string and nothing else.

An optional browser extension lets the scanner write to the clipboard while Warframe has
focus, so a scanned reward can be pasted into game chat without alt-tabbing. See
[`extension/README.md`](extension/README.md).

---

## Where it runs

- **Web** — [voidstonks.com](https://voidstonks.com), served from Cloudflare Pages. Works on
  desktop and phone browsers.
- **Desktop** — a Tauri build that wraps the same app in a native window: AppImage, `.deb` and
  `.rpm` on Linux, NSIS `.exe` and `.msi` on Windows. Build notes, requirements and the known
  quirks are in [`desktop/README.md`](desktop/README.md).

---

## Privacy and data

- Your inventory, presets, goals and settings live in your browser's local storage. Clearing
  site data clears them; import/export is there so you can move them yourself.
- No Warframe login, no account linking, no telemetry.
- The sync mailbox holds one short string under a four-digit code, temporarily, and is rate
  limited.
- Warframe Market login, where used, goes through the worker only to reach an API that sends
  no CORS headers. The password is not stored.

## API usage

The app leans on the Warframe Market API and on public world-state data. Requests go through a
rate-limited Cloudflare Worker rather than straight from the browser, responses are cached, and
the app identifies itself as VoidStonks in its headers. The point is to stay a good citizen of
someone else's free API.

---

## Working on the code

`deploy/` is both the source and what gets published — Cloudflare Pages serves the folder as
is, and minification only happens in CI. There is no build step for the web app.

```bash
npm install
npm run dev:site      # static server for deploy/
npm run dev:worker    # local Cloudflare Worker (wrangler)
npm test              # ~1.5k tests, about a minute
npm run lint
```

Start with these:

- [`CLAUDE.md`](CLAUDE.md) — working rules, the traps this repo has (import cycles, XSS,
  where the CSS lives, the globals registry).
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — which layer may import which, enforced by
  `tests/architecture.test.mjs`.
- [`DEUDA.md`](DEUDA.md) — the known debt, frozen in a baseline so it can shrink but not grow.
- `MAINTENANCE_*.md` — the fiddly subsystems: reward OCR, fissure recommendations, Vosfor.

## Roadmap

Development happens in spare time, so the pace varies.

- Native warframe.market login in the desktop build, so orders can leave WIP.
- Tightening riven appraisal on low-volume weapons, where the data is thinnest.
- More of the scanner working from a phone camera without a shared screen.
- Retiring the inline `onclick` handlers in `index.html`, which is what currently blocks a
  content security policy on desktop.

## Feedback

Bug reports and suggestions are welcome, especially scanner failures with the debug capture
attached — that is the only way OCR cases get fixed. Reach me at **w/Parcialsobriedad** on the
Warframe forums.

---

<div align="center">
  <i>Fan-made tool, not affiliated with Digital Extremes.</i>
</div>
