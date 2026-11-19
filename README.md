# Token Launch Radar

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/hukailiang396-commits/token-launch-radar/rank.svg)](https://make.fun/c/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/hukailiang396-commits/token-launch-radar/reward.svg)](https://make.fun/c/token-radar-01)

Which protocol's token would be worth most if it launched? This radar ranks the
protocols that **record no token** in the sealed DefiLlama snapshot by an implied value
built only from the snapshot's own figures, and gives each one a concrete farm plan.

Built for the [token-radar-01 bounty](https://make.fun/bounty/token-radar-01) on [make.fun](https://make.fun) — $1,325 in prizes,
1st place $1,000.

## The board

- **196 rows**: all 40 watchlist protocols (TVL ≥ $50M, no token recorded) plus all
  156 launch candidates the watchlist leaves out, above or below the floor.
- **Pre-token only.** Exchanges, bridges and wrapped/staked products are not launch
  candidates and never enter the board. Protocols whose token already trades are listed
  apart, at their recorded market cap.
- **Detail view** for every protocol: snapshot figures, the model's terms, and a
  6-step farm plan with costs and times.
- **Filter and sort**: search by name or slug, filter by category and chain, switch
  between all rows, the watchlist, and early finds; sort by rank, TVL, 7-day change,
  age, or implied value.

## The value model (`radar-log-1`, in `lib/model.ts`)

```
base     = $1,000,000 × (TVL / $1,000,000) ^ 0.70
growth   = 1 + clamp(7-day change, −40%, +80%) × 0.0075
patience = 0.75 + 0.45 × min(age in days, 1460) / 1460
implied  = round(base × growth × patience)
```

Log scale, so the board is not a TVL table: size is the strongest signal, but a
fast-growing, long-running $50M protocol can outrank a shrinking $500M one. Growth is
clamped so one hot week cannot crown a protocol; patience is capped at four years so
age alone cannot dominate. No protocol name is special-cased — the same function
scores every row, and the dashboard recomputes each row from the same figures.

Top of the board on this snapshot: Steakhouse Financial ($230.8M implied),
Sentora Curator ($228.2M), Gauntlet ($165.6M) — large, established TVL and no token
recorded. Sentora is not on the watchlist; the radar finds it anyway, which is the
point of the early finds.

## Farm plans

Six steps per protocol, generated from the protocol's own record — category, chains,
TVL band, age — never from a list of names. Each step carries a cost and a time:
set up a dedicated wallet, take the category's primary position, add a second leg
(often on the protocol's second chain), act weekly, hold for an age-based window,
then claim only from the protocol's own published link and log everything.

## Run it

Node 22, standard library only — nothing to install.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

That writes `out/board.json` (196 rows), `out/data.js`, `out/dashboard/`,
`out/screenshots/` and `out/dossier.json`. Run it twice: both runs write identical
bytes.

## Layout

- `main.ts` — entrypoint: read snapshot, score, write outputs, build the dossier.
- `lib/model.ts` — snapshot parsing, the value model, board selection, farm plans.
- `dashboard/` — the static page (no build step, no network): `index.html`,
  `app.css`, `app.js`.
- `screenshots/` — the board, a detail view, and a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied unchanged.

## License

MIT — see `LICENSE`.
