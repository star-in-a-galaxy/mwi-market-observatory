# daily

Append-only, dated record of `data/daily/*.json` — one commit per day, tagged
`daily-YYYY-MM-DD`.

## Commit dates

The commits covering **2026-05-07 → 2026-09-30** were seeded retroactively.
Their commit dates were set to **01:00 UTC on the day after each data date**
(when the daily aggregate normally runs), not the actual time the commits were
created.

Data commits from **2026-10-01** onward use the real commit time.
