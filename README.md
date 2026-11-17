# twitch-ccu-forecast

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/panji81/twitch-ccu-forecast/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/panji81/twitch-ccu-forecast/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Forecast Grand Theft Auto VI's launch-day Twitch viewers hour by hour: for each of hours 2–24 of release day, five quantiles (5/25/50/75/95%) of the category's concurrent viewers.

## Run it

```sh
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

## How it forecasts

A launch day's shape is a property of the launch, not of its size. Every past big launch in the case's `comparables` gives one observed shape — the log-ratio of each hour's viewers to that launch's own hour-1 print. The forecast is the weighted distribution of those shapes, anchored on the target's known hour-1 print:

- weights favour launches like the target: similar hour-1 magnitude (Gaussian kernel, scale 1.0 in log units — the single most important weight), no early access, no free-to-play;
- per hour, the weighted median log-ratio and the IQR-based log spread, smoothed across adjacent hours;
- quantiles are median ± z·σ in log space, so the median follows the typical launch-day shape (a pre-dawn lull, rising through the US unlock waves, peaking in US prime time, then decaying) instead of flat persistence.

Validated by leave-one-comparable-out: treating each of the 38 comparables as a pseudo-case and forecasting it from the other 37, the model scores mean pinball loss **0.412** vs **0.930** for the house baseline (persistence); on the eight biggest launches the model beats the baseline on six. No practice-case loss can be computed locally — the practice answers are not in the kit.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>
