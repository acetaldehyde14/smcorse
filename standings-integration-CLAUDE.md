# Integration Summary - Live Standings & Position Updates

## Status: ✅ Implemented (approach differs from original plan)

The original plan used a separate `race_position` table and a new `/api/iracing/standings`
endpoint. The actual implementation stores position data directly in `race_state` columns
and serves it through the existing `/api/races/:id/state` endpoint. The standings panel
was built in the Next.js frontend (`race/page.tsx`), not in the legacy `race.html`.

---

## What Was Actually Built

### Step 1 — Database: columns added to `race_state` ✅

No separate `race_position` table was created. Instead, 9 columns were added directly
to `race_state` via `ALTER TABLE` statements in `setup-database.sql`:

```sql
ALTER TABLE race_state ADD COLUMN IF NOT EXISTS position        INTEGER;
ALTER TABLE race_state ADD COLUMN IF NOT EXISTS class_position  INTEGER;
ALTER TABLE race_state ADD COLUMN IF NOT EXISTS gap_to_leader   FLOAT;
ALTER TABLE race_state ADD COLUMN IF NOT EXISTS gap_ahead       FLOAT;
ALTER TABLE race_state ADD COLUMN IF NOT EXISTS gap_behind      FLOAT;
ALTER TABLE race_state ADD COLUMN IF NOT EXISTS laps_completed  INTEGER;
ALTER TABLE race_state ADD COLUMN IF NOT EXISTS last_lap_time   FLOAT;
ALTER TABLE race_state ADD COLUMN IF NOT EXISTS best_lap_time   FLOAT;
ALTER TABLE race_state ADD COLUMN IF NOT EXISTS nearby_cars     JSONB;
```

These are already applied to the live database.

---

### Step 2 — `position_update` handler in `src/routes/iracing.js` ✅

The `position_update` event case was added to `router.post('/event', ...)`:

```javascript
} else if (event === 'position_update') {
  await handlePositionUpdate(race, data);
}
```

`handlePositionUpdate` writes directly to `race_state` using the existing `query()` helper:

```javascript
async function handlePositionUpdate(race, data) {
  const {
    position, class_position, gap_to_leader, gap_ahead, gap_behind,
    laps_completed, last_lap_time, best_lap_time, nearby_cars,
  } = data;
  if (!position) return;

  await query(
    `UPDATE race_state SET
       position        = $1,
       class_position  = $2,
       gap_to_leader   = $3,
       gap_ahead       = $4,
       gap_behind      = $5,
       laps_completed  = $6,
       last_lap_time   = $7,
       best_lap_time   = $8,
       nearby_cars     = $9::jsonb,
       last_event_at   = NOW()
     WHERE race_id = $10`,
    [
      position, class_position ?? null, gap_to_leader ?? null,
      gap_ahead ?? null, gap_behind ?? null, laps_completed ?? null,
      last_lap_time ?? null, best_lap_time ?? null,
      JSON.stringify(nearby_cars ?? []), race.id,
    ]
  );
}
```

**Note:** No debounce is applied here (unlike the original plan's 2s debounce). The
`position_update` event is sent every poll cycle by the desktop client.

---

### Step 3 — Data served via existing `/api/races/:id/state` ✅

No separate `/api/iracing/standings` endpoint was created. The existing
`GET /api/races/:id/state` in `src/routes/races.js` does `SELECT * FROM race_state`,
which now includes all the new position columns. The Next.js frontend consumes this.

The original plan's `/api/iracing/standings` endpoint was **not built** — it is not
needed because the Next.js frontend uses the per-race state endpoint instead.

---

### Step 4 — Standings panel in Next.js frontend ✅

The standings panel was added to `frontend/app/(protected)/race/page.tsx`, **not** to
the legacy `public/race.html`.

**`StandingsPanel` component** (in `race/page.tsx`):
- Receives `RaceState` which now includes all position fields
- Shows: overall position, class position, laps completed, last/best lap times
- Shows nearby cars table (`nearby_cars` JSONB array)
- Only rendered when `race.is_active && raceState`
- Polled every 5 seconds via the existing `loadData()` interval

**`RaceState` type** (in `frontend/lib/types.ts`) was extended:
```typescript
position?: number | null;
class_position?: number | null;
gap_to_leader?: number | null;
gap_ahead?: number | null;
gap_behind?: number | null;
laps_completed?: number | null;
last_lap_time?: number | null;
best_lap_time?: number | null;
nearby_cars?: NearbyCar[] | null;
```

**`NearbyCar` interface** was also added to `types.ts`.

---

### Step 5 — Desktop client sends `position_update` ✅

`public/iracing-enduro-client/iracing_monitor.py` was updated with a `_check_position()`
method that runs every poll cycle. It reads:
- `CarIdxPosition`, `CarIdxClassPosition`
- `CarIdxF2Time` (gap to leader)
- `CarIdxLap`, `CarIdxLastLapTime`, `CarIdxBestLapTime`

It builds a `nearby_cars` list (±2 positions from player) with relative gaps,
then fires a `position_update` event to `POST /api/iracing/event`.

---

## What the Original Plan Called For (Not Built / Changed)

| Original Plan | Actual Implementation | Notes |
|---|---|---|
| `race_position` table | Columns on `race_state` | Simpler, avoids JOIN |
| `pool.query` in handler | `query()` helper | Consistent with rest of file |
| `GET /api/iracing/standings` | Not built | Not needed — frontend uses `/api/races/:id/state` |
| Standings panel in `race.html` | Panel in `race/page.tsx` | Project migrated to Next.js |
| Full standings array | Not implemented | Only nearby_cars and own position stored |
| 2s debounce on position writes | No debounce | Desktop client controls poll frequency |

---

## Data Flow

```
iracing_monitor.py
  → POST /api/iracing/event { event: 'position_update', data: { position, nearby_cars, ... } }
    → handlePositionUpdate()
      → UPDATE race_state SET position=..., nearby_cars=...

frontend/race/page.tsx (every 5s)
  → GET /api/races/:id/state
    → SELECT * FROM race_state
      → StandingsPanel renders position + nearby cars
```

---

## Verification Checklist

- [x] `position_update` case handled in `router.post('/event', ...)`
- [x] `race_state` has all 9 new columns
- [x] `GET /api/races/:id/state` returns position fields (via `SELECT *`)
- [x] `StandingsPanel` renders in Next.js race page when race is active
- [x] `NearbyCar` type defined in `types.ts`
- [x] `RaceState` type extended in `types.ts`
- [x] Desktop client sends `position_update` each poll cycle
- [ ] `public/race.html` standings panel — **NOT built** (legacy page, not a priority)
- [ ] Full field-level standings array — **NOT built** (only own car + nearby stored)
