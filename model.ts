// Forecast model for the GTA VI launch-day Twitch viewers bounty.
//
// Idea: a launch day's shape is a property of the launch, not of its size.
// Every past big launch in the case's `comparables` gives one observed shape:
// the log-ratio of each hour's viewers to that launch's own hour-1 print.
// The forecast for the target is the weighted distribution of those shapes,
// anchored on the target's known hour-1 print, with weights favouring launches
// like the target (console-only, midnight-local rolling unlock, no early
// access, similar hour-1 magnitude) and a spread calibrated by
// leave-one-comparable-out validation (see dev/loco.mjs, not shipped).
//
// Pure function of the case object: no clock, no randomness, fixed key order.

export const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
export const Z = [-1.6448536269514722, -0.6744897501960817, 0, 0.6744897501960817, 1.6448536269514722];

export interface HourlyPoint {
  from: string;
  viewers: number;
  channels?: number | null;
}

export interface Comparable {
  name: string;
  day_start: string;
  unlock?: string;
  platforms?: string;
  hourly: HourlyPoint[];
}

export interface CaseInput {
  known: Array<{ hour: number; viewers: number; channels?: number | null }>;
  forecast: Array<{ hour: number }>;
  history_hourly?: Array<{ from: string; viewers: number; channels?: number | null }> | null;
  comparables: Comparable[];
}

const HOUR_MS = 3600 * 1000;

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Weighted quantile of values at probability p (linear interpolation on cumulative weight). */
function weightedQuantile(pairs: Array<[number, number]>, p: number): number {
  const sorted = pairs.slice().sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((s, [, w]) => s + w, 0);
  if (total <= 0 || sorted.length === 0) return 0;
  const target = p * total;
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    const prev = acc;
    acc += sorted[i][1];
    if (acc >= target) {
      if (i === 0) return sorted[0][0];
      const frac = (target - prev) / sorted[i][1];
      return sorted[i - 1][0] + frac * (sorted[i][0] - sorted[i - 1][0]);
    }
  }
  return sorted[sorted.length - 1][0];
}

/** 3-tap smoothing [0.25, 0.5, 0.25] over a per-hour series (edges clamped). */
function smooth3(xs: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const a = xs[Math.max(0, i - 1)];
    const b = xs[i];
    const c = xs[Math.min(xs.length - 1, i + 1)];
    out.push(0.25 * a + 0.5 * b + 0.25 * c);
  }
  return out;
}

export interface ModelParams {
  /** Weight for early-access-contaminated comparables (0..1). */
  earlyAccessWeight: number;
  /** Weight for free-to-play / live-service ("weak") comparables (0..1). */
  weakWeight: number;
  /** Extra weight for console-only launches (no PC in platforms). */
  consoleOnlyBoost: number;
  /** Scale (in log units) of the magnitude-similarity kernel; 0 disables it. */
  magnitudeScale: number;
  /** Global multiplier on the per-hour log spread. */
  spreadCal: number;
  /** Minimum / maximum per-hour log sigma. */
  sigmaFloor: number;
  sigmaCap: number;
  /** Use weighted empirical per-hour quantiles instead of median +/- z*sigma. */
  empiricalTails: boolean;
}

export const DEFAULT_PARAMS: ModelParams = {
  earlyAccessWeight: 0.35,
  weakWeight: 0.35,
  // LOCO grid (dev/loco.mjs, dev/bigtargets.mjs): boosting console-only
  // launches beyond the magnitude/tier weights HURT giant-launch forecasts
  // (overall 0.412 -> 0.449 at boost 2.0), so the boost stays at 1.0.
  consoleOnlyBoost: 1.0,
  magnitudeScale: 1.0,
  spreadCal: 1.0,
  sigmaFloor: 0.12,
  sigmaCap: 0.9,
  empiricalTails: false,
};

function tierOf(comp: Comparable): string {
  const m = (comp.unlock ?? '').match(/Tier:\s*([a-z-]+)/i);
  return m ? m[1].toLowerCase() : 'comparable';
}

function comparableWeight(comp: Comparable, p1: number, v1: number, params: ModelParams): number {
  const tier = tierOf(comp);
  if (tier === 'target-history') return 0;
  let w = 1;
  if (tier === 'early-access-contaminated') w *= params.earlyAccessWeight;
  else if (tier === 'weak') w *= params.weakWeight;
  const platforms = comp.platforms ?? '';
  if (!/PC/i.test(platforms)) w *= params.consoleOnlyBoost;
  if (params.magnitudeScale > 0 && v1 > 0 && p1 > 0) {
    const d = (Math.log(v1) - Math.log(p1)) / params.magnitudeScale;
    w *= Math.exp(-0.5 * d * d);
  }
  return w;
}

/**
 * Forecast hours 2..24 for one case. Returns rows in forecast order:
 * [{hour, q: [q05, q25, q50, q75, q95]}].
 */
export function forecastCase(c: CaseInput, params: ModelParams = DEFAULT_PARAMS): Array<{ hour: number; q: number[] }> {
  const first = c.known.find((k) => k.hour === 1);
  if (first === undefined) throw new Error('case has no hour-1 print');
  const p1 = Math.max(1, first.viewers);
  const logP1 = Math.log(p1);

  // Per comparable, per-hour log-ratio to its own hour-1 print.
  interface ShapeRow {
    w: number;
    x: number[];
  }
  const shapes: ShapeRow[] = [];
  for (const comp of c.comparables) {
    const ds = Date.parse(comp.day_start);
    if (!Number.isFinite(ds)) continue;
    const byHour = new Map<number, number>();
    for (const p of comp.hourly) {
      const t = Date.parse(p.from);
      if (Number.isFinite(t) && p.viewers > 0) byHour.set(t, p.viewers);
    }
    const v1 = byHour.get(ds);
    if (v1 === undefined || v1 <= 0) continue;
    const w = comparableWeight(comp, p1, v1, params);
    if (w <= 0) continue;
    const x: number[] = [];
    let ok = false;
    for (let h = 2; h <= 24; h++) {
      const v = byHour.get(ds + (h - 1) * HOUR_MS);
      if (v !== undefined && v > 0) {
        x.push(Math.log(v / v1));
        ok = true;
      } else {
        x.push(NaN);
      }
    }
    if (ok) shapes.push({ w, x });
  }

  // Fallback: no usable comparables -> house-baseline persistence.
  if (shapes.length === 0) {
    return c.forecast.map(({ hour }) => ({
      hour,
      q: Z.map((z) => round2(p1 * Math.exp(z * 0.15 * Math.sqrt(hour - 1)))),
    }));
  }

  const hours = c.forecast.map((f) => f.hour);
  const medRaw: number[] = [];
  const sigRaw: number[] = [];
  const empRaw: number[][] = LEVELS.map(() => []);
  for (const h of hours) {
    const idx = h - 2;
    const pairs: Array<[number, number]> = [];
    for (const s of shapes) {
      const v = s.x[idx];
      if (Number.isFinite(v)) pairs.push([v, s.w]);
    }
    if (pairs.length === 0) {
      medRaw.push(0);
      sigRaw.push(0.3);
      for (const arr of empRaw) arr.push(0);
      continue;
    }
    const q25 = weightedQuantile(pairs, 0.25);
    const q50 = weightedQuantile(pairs, 0.5);
    const q75 = weightedQuantile(pairs, 0.75);
    medRaw.push(q50);
    sigRaw.push(Math.max(0.05, (q75 - q25) / 1.349));
    LEVELS.forEach((lv, j) => empRaw[j].push(weightedQuantile(pairs, lv)));
  }

  if (params.empiricalTails) {
    const smoothed = empRaw.map((arr) => smooth3(arr));
    const medS = smooth3(medRaw);
    return hours.map((h, i) => {
      const qs = smoothed.map((arr, j) => {
        const centred = arr[i] - medS[i];
        return round2(Math.exp(logP1 + medS[i] + centred * params.spreadCal));
      });
      for (let j = 1; j < qs.length; j++) if (qs[j] < qs[j - 1]) qs[j] = qs[j - 1];
      return { hour: h, q: qs.map((v) => Math.min(1e9, Math.max(0.01, v))) };
    });
  }

  const med = smooth3(medRaw);
  const sig = smooth3(sigRaw).map((s) =>
    Math.min(params.sigmaCap, Math.max(params.sigmaFloor, s * params.spreadCal)),
  );

  return hours.map((h, i) => {
    const qs = Z.map((z) => round2(Math.exp(logP1 + med[i] + z * sig[i])));
    // Enforce non-decreasing (rounding can tie, never invert, but be safe).
    for (let j = 1; j < qs.length; j++) if (qs[j] < qs[j - 1]) qs[j] = qs[j - 1];
    return { hour: h, q: qs.map((v) => Math.min(1e9, Math.max(0.01, v))) };
  });
}

/** House baseline forecast (for comparison in validation only). */
export function baselineCase(c: CaseInput): Array<{ hour: number; q: number[] }> {
  const first = c.known.find((k) => k.hour === 1);
  const p1 = Math.max(1, first?.viewers ?? 1);
  return c.forecast.map(({ hour }) => ({
    hour,
    q: Z.map((z) => round2(p1 * Math.exp(z * 0.15 * Math.sqrt(hour - 1)))),
  }));
}

/** Mean pinball loss on the log scale for one forecast vs actual hourly prints. */
export function pinballLoss(
  rows: Array<{ hour: number; q: number[] }>,
  actual: Map<number, number>,
): { loss: number; items: number } {
  let total = 0;
  let n = 0;
  for (const row of rows) {
    const y = actual.get(row.hour);
    if (y === undefined) continue;
    const ly = Math.log(Math.max(1, y));
    for (let j = 0; j < LEVELS.length; j++) {
      const tau = LEVELS[j];
      const d = ly - Math.log(Math.max(1e-9, row.q[j]));
      total += 2 * Math.max(tau * d, (tau - 1) * d);
      n++;
    }
  }
  return { loss: n > 0 ? total / n : NaN, items: n };
}
