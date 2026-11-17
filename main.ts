// Forecast GTA VI's launch-day Twitch viewers hour by hour.
//
// Reads every <id>.in in the input directory and writes one <id>.out per
// case with 23 rows (hours 2..24) of five quantiles each. Node 22, standard
// library only, no network. Deterministic: a pure function of the case file.
//
// The forecast (model.ts): each past big launch in the case's `comparables`
// gives one observed launch-day shape — the log-ratio of each hour's viewers
// to that launch's own hour-1 print. The forecast is the weighted
// distribution of those shapes, anchored on the target's known hour-1 print,
// favouring launches like the target (console-only, midnight-local rolling
// unlock, no early access, similar hour-1 magnitude). The median follows the
// typical launch-day shape — rising through the unlock waves, then decaying —
// instead of flat persistence.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { forecastCase, LEVELS } from './model.ts';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  try {
    const id = file.slice(0, -'.in'.length);
    const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Parameters<typeof forecastCase>[0];
    if (!Array.isArray(c.levels) || c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
      throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
    }
    const hours = forecastCase(c);
    const text = `${JSON.stringify({ hours })}\n`;
    // The rules cap an output at 65,536 bytes; a bigger file would make the
    // whole case invalid, so fail loudly here instead of writing it.
    if (Buffer.byteLength(text, 'utf8') > 65536) {
      throw new Error(`${file} forecast is ${Buffer.byteLength(text, 'utf8')} bytes, over the 65,536-byte cap`);
    }
    writeFileSync(join(OUTPUT_DIR, `${id}.out`), text);
  } catch (err) {
    // One bad case file must not kill the whole run: the other cases still
    // get their forecasts, and only this one is left invalid.
    process.stderr.write(`[entry] skipping ${file}: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
