<div align="center">

# VoidStonks

**A Warframe companion for trading and farming. It reads your screen, so it works where
overlays can't: Linux, console and phone.**

[voidstonks.com](https://voidstonks.com)

</div>

## Scanner

Share your Warframe window and the app reads what's on screen by itself: your inventory page
by page, the relic you equip, the reward screen, the end-of-mission summary and the riven
reroll. There's nothing to calibrate.

![The scanner reading the prime parts inventory](.github/readme/scanner-inventory.jpg)

It notices the relic you equip and takes it off your inventory once the rewards show up.

![Equipping an Axi A6 relic and the app detecting it](.github/readme/relicrun.webp)

On the reward screen it tells you which pick is worth the most in platinum and in ducats, and
how many of each you already have.

![The rewards detected, with the best pick highlighted](.github/readme/liverelicrewards.jpg)

Playing on console? Open the site on your phone, point the camera at the reward screen and take
the shot.

![Scanning the reward screen with a phone](.github/readme/mobile.webp)

When the mission ends, it reads the summary screen and adds what you got to your inventory, so
you don't have to scan it again.

On the reroll screen it prices each riven as it appears and compares the new roll with the
old one.

![A riven detected and priced during a reroll](.github/readme/rivengrader1.jpg)
![The new roll compared with the current one](.github/readme/rivengrader2.jpg)

## Inventory

Everything you own, priced. Prime parts show what your whole inventory is worth and which of
your sets are going up or down. Relics show how many runs each one takes to finish a set and
what it makes per run, in platinum and in ducats.

<table>
  <tr>
    <td><img src=".github/readme/invmanagement.webp" width="380" alt="Prime parts with their prices and set trends"></td>
    <td><img src=".github/readme/invmanagement-relics.webp" width="380" alt="Relics sorted by runs to finish a set"></td>
  </tr>
</table>

## Relics and sets

Look up a relic and pick its refinement and squad size: you see what's inside, what each part
sells for and its ducats, and whether opening it pays more than selling it intact. Drag a part
onto the set tracker and it tells you how many runs it takes on average.

![Relic lookup and set progress](.github/readme/setsrelics.gif)

## Rivens

Pick a weapon to see what its rivens sell for (unrolled, rerolled and listed on
warframe.market) and which stats it wants. Enter a riven, or let the scanner read it, and you
get a price range and a grade for each stat. It also tells you when locking a stat is worth
the kuva.

<table>
  <tr>
    <td><img src=".github/readme/riven1.png" width="380" alt="Riven prices and stat guide for a weapon"></td>
    <td><img src=".github/readme/riven2.png" width="380" alt="A riven appraised with its price range and grades"></td>
  </tr>
</table>

## Farms

The bounties worth running right now, the Coda and Tenet weapon rotation, the open fissures
and the arbitration schedule. Set alarms for the rewards, fissures and arbitrations you want
and it lets you know when they're up.

![Weapon rotation, alarms and bounties](.github/readme/farmstab-alarms.webp)

## Vosfor

Sell an arcane or dissolve it into Vosfor? It ranks the Loid packs by platinum per Vosfor and
by how fast they sell, and works out how many packs you need for the arcane you're after.

![Loid packs and target arcane odds](.github/readme/vosfor.webp)

## Ducats

Your prime parts by what they're worth in ducats against platinum: what to hand to Baro Ki'Teer
and what to sell instead. Parts you no longer own can be hidden.

![Ducats against platinum for your prime parts](.github/readme/ducats.gif)

## LFG

Ready-made recruitment messages that you can write on your phone and pick up on your PC with
a four-digit code.

## Your data stays with you

- No Warframe login, no game files, nothing injected into the game.
- Your inventory and settings live in your browser. There's no account and no telemetry.
- Prices come from warframe.market through a cached, rate-limited server, so the app doesn't
  flood their API.

## Where it runs

- **Web:** [voidstonks.com](https://voidstonks.com), on desktop and phone browsers.
- **Desktop:** the same app in its own window, for Linux and Windows. See
  [desktop/](desktop/README.md).
- **Browser extension (optional):** lets the scanner copy results to the clipboard while the
  game has focus. See [extension/](extension/README.md).

## What's in this repository

| Folder | What it is |
|---|---|
| `deploy/` | The app. There's no build step: CI only minifies it before publishing. |
| `desktop/` | The desktop build. |
| `extension/` | The clipboard extension. |
| `tests/` | The tests, run on every push. |
| `scripts/`, `scripts-actu/` | The jobs that keep game data, market stats and the riven model up to date. |
| `.github/` | The workflows (publishing, tests and those jobs) and the images in this README. |

To run it locally:

```bash
npm install
npm run dev:site    # serves deploy/ at http://127.0.0.1:8080
npm test
```

## Feedback

Bug reports are welcome in the issues. If the scanner misread something, record it
(DIAG → RECORD, then ZIP) and attach the file: it has the frame and what the scanner saw.

<div align="center">
  <i>Fan-made tool, not affiliated with Digital Extremes.</i>
</div>
