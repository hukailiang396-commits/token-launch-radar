// Token Launch Radar's model: one sealed snapshot in, one ranked board out.
//
// The board ranks protocols that record no token, by an implied value derived only from the
// snapshot's own figures. Nothing here names a protocol: the same function scores every row,
// and the dashboard recomputes each row from the same figures, so the page and board.json
// always agree.
//
//   base      = 1,000,000 x (tvl_usd / 1,000,000) ^ 0.70        log scale, not a TVL table
//   growth    = clamp(change_7d, -40, +80) per cent; unknown change counts as 0
//   growth    = 1 + growth x 0.0075                            +80% -> 1.60x, -40% -> 0.70x
//   patience  = 0.75 + 0.45 x min(age_days, 1460) / 1460        0.75x new, 1.20x after 4 years
//   implied   = round(base x growth x patience), whole dollars, at least $1
//
// Why log scale: a linear TVL multiple would make the board a copy of the TVL table, and a
// $2.7B curator would outrank everything on size alone. The 0.70 power keeps size the
// strongest signal while letting a fast-growing, long-running $50M protocol outrank a
// shrinking $500M one. Growth is clamped so one hot week (the snapshot holds a +4,448%
// outlier) cannot crown a protocol, and patience is capped at four years so age alone
// cannot dominate either. A protocol whose token already trades never enters this board:
// it is shown apart, in the dashboard's live-token section, at its recorded market cap.
//
// The watchlist is the floor, never the ceiling: every watchlist slug is ranked, then the
// radar adds every other launch candidate the list leaves out — pre-token, not an
// exchange, not a bridge or a wrapped/staked product, not a versioned pool — above or
// below the $50M floor, all of them. A $2.8B curator the list leaves out is as much a
// subject as a $5M one. Protocols the snapshot records with a token are not candidates.

import { createHash } from 'node:crypto';

const DAY_MS = 86_400_000;

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelSpec {
  base_scale: number;
  base_exponent: number;
  growth_floor: number;
  growth_cap: number;
  growth_weight: number;
  patience_floor: number;
  patience_range: number;
  patience_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelSpec = {
  base_scale: 1_000_000,
  base_exponent: 0.7,
  growth_floor: -40,
  growth_cap: 80,
  growth_weight: 0.0075,
  patience_floor: 0.75,
  patience_range: 0.45,
  patience_days: 1460,
  unknown_age_days: 240,
};

export const MODEL_VERSION = 'radar-log-1';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'records-no-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    patience_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; the page rebuilds the farm plan from these fields. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  base_usd: number;
  growth_multiplier: number;
  patience_multiplier: number;
}

/** A protocol whose token already trades, shown apart from the launch board. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelSpec;
  model_version: string;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The model's terms for one protocol: base, growth and patience multipliers, and the value. */
export function valueParts(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelSpec = MODEL,
): { implied: number; base: number; growthPct: number; growthMult: number; patienceMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const base = model.base_scale * Math.pow(Math.max(protocol.tvl_usd, 1) / 1_000_000, model.base_exponent);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = 1 + growthPct * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const patienceMult =
    model.patience_floor + (Math.min(Math.max(ageForModel, 0), model.patience_days) / model.patience_days) * model.patience_range;
  const implied = Math.max(1, Math.round(base * growthMult * patienceMult));
  return { implied, base: Math.round(base), growthPct, growthMult, patienceMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories that are not a token launch of their own: exchanges, bridges, wrapped/staked products. */
const NOT_A_LAUNCH = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
/** A category that names a bridge or a wrapper in any wording is the same kind of product. */
const NOT_A_LAUNCH_WORD = /bridge|wrapper/i;
/** A whole word wrapped, staked or staking in the name: a product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether the snapshot records no token for the protocol. DefiLlama's record is not proof. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a launch candidate the board may rank. */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && (NOT_A_LAUNCH.has(p.category) || NOT_A_LAUNCH_WORD.test(p.category))) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  return true;
}

/** The snapshot's protocols by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..N and strictly falling values. */
export function buildBoard(snapshot: Snapshot, model: ModelSpec = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug ranks, whatever its category.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every launch candidate the watchlist leaves out, by TVL, whatever its
  // size. No cap, no cherry-pick: a candidate the floor leaves out is no worse a subject
  // than one on it, and a $2.8B one is not skipped for being big.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isLaunchCandidate(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = valueParts(p, snapshot.as_of, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // Ranks must fall strictly: where rounding ties two values, step the lower one down a dollar.
  // Values are in the millions, so the step never changes what the number means.
  let prev = Number.POSITIVE_INFINITY;
  return scored.map((s, i) => {
    const implied = Math.min(s.v.implied, prev - 1);
    prev = implied;
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'records-no-token' as const,
      age_days: s.v.age,
      implied_value_usd: implied,
      model: {
        base_usd: s.v.base,
        growth_pct: s.v.growthPct,
        growth_multiplier: round4(s.v.growthMult),
        patience_multiplier: round4(s.v.patienceMult),
        age_days: s.v.age,
      },
      farm_steps: farmSteps(s.p, s.v.age).map(stepText),
    };
  });
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The second chain a protocol names, or null when it runs on one chain only. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** How much capital one farm position needs, from the protocol's own TVL band. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 30;
}

/** The category family, from the snapshot's own category string. */
function familyOf(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lend';
  if (c.includes('dex')) return 'dex';
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('basis') || c.includes('leveraged') || c.includes('interest rate')) return 'deriv';
  if (c.includes('curator') || c.includes('allocator')) return 'vault';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('payment') || c.includes('card')) return 'pay';
  if (c.includes('insurance')) return 'cover';
  if (c.includes('prediction')) return 'predict';
  if (c.includes('stable')) return 'stable';
  if (c.includes('yield') || c.includes('farm') || c.includes('staking') || c.includes('restak') || c.includes('liquidity manager')) return 'yield';
  return 'deposit';
}

/** The family's primary position: the action, named for this protocol and chain. */
function primaryAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const name = p.name;
  switch (familyOf(p)) {
    case 'lend':
      return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $20 of USDC against it so the position shows both sides.`;
    case 'dex':
      return `Provide $${capital} of liquidity to ${name}'s largest pool on ${chain} — USDC against the chain's native asset — and keep the LP receipt.`;
    case 'deriv':
      return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position, no more than $25 of notional.`;
    case 'vault':
      return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the vault shares in the same wallet.`;
    case 'rwa':
      return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`;
    case 'pay':
      return `Move $${capital} of USDC through ${name} on ${chain} and leave a $25 balance in its app for the next month.`;
    case 'cover':
      return `Buy $${capital} of cover from ${name} on ${chain} for a protocol you already use, and keep the policy active.`;
    case 'predict':
      return `Fund $${capital} on ${name} on ${chain} and place one small position on a market that settles within 30 days.`;
    case 'stable':
      return `Mint $${capital} of the stable asset through ${name} on ${chain} and hold it instead of swapping it away.`;
    case 'yield':
      return `Deposit $${capital} of USDC into ${name}'s main yield position on ${chain} and leave the rewards unclaimed until week four.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open in the farming wallet.`;
  }
}

/** The family's second leg: a complementary action on the second chain, or a deeper position. */
function secondAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const name = p.name;
  const second = secondChainOf(p);
  const where = second !== null ? `, then repeat the same position on ${second}` : '';
  switch (familyOf(p)) {
    case 'lend':
      return `After a week, repay half the $20 borrow on ${name} on ${chain}${where ? ` and open the same supply-and-borrow pair on ${second}` : ' and re-supply the repaid funds'}.`;
    case 'dex':
      return `Swap $25 of USDC for the pool's other asset on ${name} on ${chain}${where ? `, then add $25 of liquidity on ${second}` : ' and add it to the same pool'}.`;
    case 'deriv':
      return `Close the hedge on ${name} on ${chain} after seven days${where ? `, then open one small hedge on ${second}` : ' and open a fresh one half the size'}.`;
    case 'vault':
      return `Add $25 more to the ${name} vault on ${chain} after two weeks${where ? `, then deposit $25 into its vault on ${second}` : ' so the vault sees a second deposit'}.`;
    case 'rwa':
      return `After a month, redeem $25 of the ${name} asset on ${chain}${where ? ` and mint $25 of it on ${second}` : ' and mint it back the same day'}.`;
    case 'yield':
      return `Compound the first rewards back into ${name} on ${chain} in week four${where ? `, then deposit $25 on ${second}` : ' instead of withdrawing them'}.`;
    default:
      return `Make a second, smaller deposit of $25 into ${name} on ${chain} after two weeks${where ? ` and the same on ${second}` : ' so the protocol sees repeat activity'}.`;
  }
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list
 * of names — two protocols in different families, chains or TVL bands never get the same plan.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 250 ? 8 : capital >= 150 ? 6 : 4;
  return [
    {
      text: `Set up a fresh wallet for ${p.name} only, fund it with $${capital + 15} of USDC on ${chain}, and keep its seed phrase offline.`,
      cost: `about $3 of gas for the first transfer`,
      time: '5 minutes',
    },
    {
      text: primaryAction(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondAction(p, capital, chain),
      cost: 'about $3 of gas, plus the $25 second leg',
      time: '10 minutes',
    },
    {
      text: `Do one qualifying action on ${p.name} every week — a deposit, a swap, a borrow or a vote — and keep the same wallet for all of them.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity spans more than one snapshot, then open ${p.name}'s own points or rewards page and claim only from the link it publishes.`,
      cost: `the $${capital} stays in the position; never pay to claim`,
      time: `${hold} days, then 10 minutes`,
    },
    {
      text: `Log the wallet, the dates and every transaction for ${p.name} on ${chain}, then unwind in two halves a week apart instead of exiting at once.`,
      cost: 'nothing but the log',
      time: '5 minutes to log',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's separate live-token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan rebuilt in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_usd: row.model.base_usd,
    growth_multiplier: row.model.growth_multiplier,
    patience_multiplier: row.model.patience_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelSpec = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist: [...snapshot.watchlist].sort(),
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd >= board[i - 1]!.implied_value_usd) return `row ${i + 1} does not fall below row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  const rows = radar.rows.map((r) => [
    r.rank, r.slug, r.name, r.category, r.chains, r.tvl_usd, r.change_7d, r.listed_at, r.age_days,
    r.implied_value_usd, r.base_usd, r.growth_multiplier, r.patience_multiplier,
  ]);
  const live = radar.live.map((p) => [p.slug, p.name, p.category, p.chains, p.tvl_usd, p.mcap_usd, p.change_7d]);
  const data = {
    as_of: radar.as_of,
    source: radar.source,
    floor_usd: radar.floor_usd,
    model: radar.model,
    model_version: radar.model_version,
    watchlist_size: radar.watchlist_size,
    watchlist: radar.watchlist,
    board_size: radar.board_size,
    early_size: radar.early_size,
    live_size: radar.live_size,
    rows,
    live,
  };
  // A short digest so the page can say the data it renders is the data the program wrote.
  const digest = createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 12);
  return `window.RADAR=${JSON.stringify({ ...data, digest })};\n`;
}
