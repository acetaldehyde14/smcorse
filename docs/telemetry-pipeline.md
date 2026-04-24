# Telemetry Pipeline

## Overview

Telemetry data flows through three stages:

```
Desktop Client (Python)
        │
        │  POST /api/iracing/telemetry
        │  gzip-compressed JSON batch: { lap, samples[], track, car }
        ▼
┌──────────────────────────────────────────────┐
│  Stage 1: Raw Ingest (live_telemetry)        │
│  One row per batch. 14-day retention.        │
│  Used ONLY by /api/iracing/telemetry/live    │
│  and /api/iracing/telemetry/lap endpoints.   │
└──────────────────────────────────────────────┘
        │
        │  findOrCreateLiveSession()
        │  insertTelemetryFrames()
        ▼
┌──────────────────────────────────────────────┐
│  Stage 2: Canonical Frames (telemetry_frames)│
│  One row per sample point. Long retention.   │
│  Source of truth for ALL analytics reads.    │
└──────────────────────────────────────────────┘
        │
        │  (post-lap computation, not yet automated)
        ▼
┌──────────────────────────────────────────────┐
│  Stage 3: Derived Facts                      │
│  fact_lap — per-lap aggregates               │
│  fact_lap_segment — per-corner metrics       │
└──────────────────────────────────────────────┘
```

## Ingest Path (iracing.js)

### `POST /api/iracing/telemetry`

The desktop client sends compressed batches of ~100–200 samples every poll cycle (~1–2 seconds).

**Step 1:** `findOrCreateLiveSession(userId, track, car)`
- Reuses any open `live` session for this user + track
- Creates one if not found
- Returns `session_id`

**Step 2:** `insertTelemetryFrames(sessionId, userId, samples, lapNumber)`
- Writes to `telemetry_frames` in chunks of 200
- Maps sample fields:
  - `s.t` → `session_time`
  - `s.spd` → `speed_kph` (m/s → km/h conversion)
  - `s.thr` → `throttle`
  - `s.brk` → `brake`
  - `s.steer` → `steering_deg` (rad → degrees)
  - `s.gear` → `gear`
  - `s.rpm` → `rpm`
  - `s.ldp` → `lap_dist_pct`
  - `s.glat` → `lat_accel`
  - `s.x` → `x_pos` (world position)
  - `s.y` → `y_pos`
- `ts` = `NOW()` (server time; not sample time — limitation)

**Step 3:** Write to `live_telemetry` (raw buffer, race only)
- Only if a race is active AND this client is accepted (driver's client or fallback)
- Includes `session_id` FK (added by migration 003)

## IBT Upload Path (telemetry.js)

IBT files (`.ibt`) are uploaded via `POST /api/telemetry/upload`.

The parser (`src/services/parser.js`) extracts:
- Track name, car name from session YAML
- Individual lap times, sectors
- Downsampled telemetry at ~10 Hz

Writes to:
- `sessions` (creates a new `file` session)
- `laps` (one per lap)
- `telemetry_frames` (downsampled frames per lap)
- `lap_features` (via `ON CONFLICT DO NOTHING` — legacy path)

**Note:** IBT upload currently writes to `lap_features`. New feature computation should write to `fact_lap` instead. Use the `lap_features_v` view for reads to get data from both.

## Analytics Read Path

All replay, coaching, and analysis reads should use:

### Session replay
```sql
SELECT session_time, lap_dist_pct, speed_kph, throttle, brake, steering_deg, x_pos, y_pos
FROM telemetry_frames
WHERE session_id = $1 AND lap_number = $2
ORDER BY session_time;
```

### Lap overlay
```sql
SELECT lap_dist_pct, speed_kph, throttle, brake, steering_deg
FROM telemetry_frames
WHERE lap_id = $1
ORDER BY lap_dist_pct;
```

### Lap comparison (distance-bucketed)
```sql
SELECT * FROM mart_lap_comparison($ref_lap_id, $cmp_lap_id);
```
This function bins both laps by `lap_dist_pct` and returns channel deltas.

### Corner analysis
```sql
SELECT segment_name, entry_speed_kph, apex_speed_kph, exit_speed_kph, time_loss
FROM mart_corner_time_loss
WHERE session_id = $1
ORDER BY segment_number;
```

## Live Race Telemetry

### Fast live cursor (for race page)
```
GET /api/iracing/telemetry/live?since=<session_time>
```
Reads last 5 `live_telemetry` batches, flattens and filters by `since`.

**Why `live_telemetry` not `telemetry_frames`?**
`live_telemetry` stores the original JSON batches preserving the exact sample rate from the client. `telemetry_frames` stores normalised rows which are slightly heavier to read for the raw live feed. For historical replay, `telemetry_frames` is always preferred.

### Full lap playback (historical)
```
GET /api/iracing/telemetry/lap/:raceId/:lap
```
Currently reads from `live_telemetry`. For historical accuracy, this should be updated to query `telemetry_frames` instead — see Phase 9 of the refactor plan.

## Session Lifecycle

```
1. Client starts sending → findOrCreateLiveSession() creates session (status='open')
2. Client sends batches → frames accumulate in telemetry_frames
3. Client stops / race ends → session status remains 'open' (no explicit close yet)
4. Post-lap: fact_lap computed from telemetry_frames (TODO: automate)
5. Post-session: session.ended_at can be set manually or via a close endpoint
```

## Retention

| Store | Retention | Cleanup |
|---|---|---|
| `live_telemetry` | 14 days | `SELECT * FROM cleanup_live_telemetry(14);` |
| `telemetry_frames` | Indefinite | Manual archival if disk pressure |
| `fact_lap` / `fact_lap_segment` | Indefinite | — |

Schedule the cleanup function weekly (e.g. via pg_cron or a cron job running psql):
```sql
SELECT * FROM cleanup_live_telemetry(14);
VACUUM ANALYZE live_telemetry;
```

## Known Limitations

1. `ts` in `telemetry_frames` is server receive time, not client sample time. For precise delta-time analysis, use `session_time` (seconds from session start).
2. `lap_id` is NULL for frames ingested before the lap is matched to a `laps` row. The live ingest path does not yet write `lap_id` — it must be back-populated after the lap is created.
3. Feature computation (`fact_lap`, `fact_lap_segment`) is not yet automated — currently only triggered by IBT uploads via the existing lap_features path. A post-lap computation job is a planned improvement.
