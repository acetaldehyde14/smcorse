# Task: Live Telemetry Ingestion & Storage

The desktop client sends a `telemetry_batch` every 2 seconds containing ~20
high-frequency samples (10Hz), gzip-compressed, to `POST /api/iracing/telemetry`.

Store everything in PostgreSQL only — no in-memory cache.
Serve live data and lap history from DB queries.
Add a live graph panel to `race.html`.

Do NOT modify any existing routes or tables. Only add new things.
Check before creating anything — if it already exists, skip it.

---

## Step 1 — Add database table

Check if `live_telemetry` already exists in your schema. If not, add it to
`database/schema.sql` and run it against the live DB:

```sql
CREATE TABLE IF NOT EXISTS live_telemetry (
  id           BIGSERIAL PRIMARY KEY,
  race_id      INTEGER REFERENCES races(id),
  user_id      INTEGER REFERENCES users(id),
  lap          INTEGER,
  samples      JSONB NOT NULL,
  sample_count INTEGER,
  received_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_telem_race ON live_telemetry(race_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_telem_lap  ON live_telemetry(race_id, lap);
```

Run it:
```bash
psql $DATABASE_URL -c "
CREATE TABLE IF NOT EXISTS live_telemetry (
  id BIGSERIAL PRIMARY KEY,
  race_id INTEGER REFERENCES races(id),
  user_id INTEGER REFERENCES users(id),
  lap INTEGER,
  samples JSONB NOT NULL,
  sample_count INTEGER,
  received_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_live_telem_race ON live_telemetry(race_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_telem_lap ON live_telemetry(race_id, lap);
"
```

---

## Step 2 — Register raw body middleware in server.js

Open `server.js`. Find where `express.json()` is registered. BEFORE that line,
add raw body parsing for the telemetry route only (needed to decompress gzip):

```javascript
// Must be before express.json()
app.use('/api/iracing/telemetry', express.raw({ type: '*/*', limit: '2mb' }));
```

If `express.raw` is already used somewhere for another route, just add this one
line for this path — do not remove the existing one.

---

## Step 3 — Add POST /api/iracing/telemetry

Open `src/routes/iracing.js`. Add these requires at the top of the file if not
already present:

```javascript
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);
```

Then add the route. Check that `/telemetry` doesn't already exist first:

```javascript
router.post('/telemetry', authenticateToken, async (req, res) => {
  try {
    // Decompress if gzip
    let body;
    if (req.headers['content-encoding'] === 'gzip') {
      const decompressed = await gunzip(req.body);
      body = JSON.parse(decompressed.toString('utf-8'));
    } else {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }

    const { lap, samples } = body;
    if (!samples || !Array.isArray(samples) || samples.length === 0) {
      return res.status(400).json({ error: 'No samples provided' });
    }

    // Get active race
    const raceResult = await pool.query(
      'SELECT id FROM races WHERE is_active = TRUE LIMIT 1'
    );
    if (raceResult.rowCount === 0) {
      return res.json({ ok: true, skipped: 'no_active_race' });
    }
    const raceId = raceResult.rows[0].id;

    // Persist to DB
    await pool.query(
      `INSERT INTO live_telemetry (race_id, user_id, lap, samples, sample_count)
       VALUES ($1, $2, $3, $4, $5)`,
      [raceId, req.user.id, lap ?? null, JSON.stringify(samples), samples.length]
    );

    res.json({ ok: true, stored: samples.length });
  } catch (err) {
    console.error('[POST /telemetry]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});
```

---

## Step 4 — Add GET /api/iracing/telemetry/live

Frontend polls this every second. Uses `?since=` cursor (SessionTime float) so
it only returns new samples the client hasn't seen yet.

```javascript
router.get('/telemetry/live', authenticateToken, async (req, res) => {
  try {
    const raceResult = await pool.query(
      'SELECT id FROM races WHERE is_active = TRUE LIMIT 1'
    );
    if (raceResult.rowCount === 0) {
      return res.json({ active: false, samples: [] });
    }
    const raceId = raceResult.rows[0].id;

    const since = req.query.since ? parseFloat(req.query.since) : null;

    // Fetch last 5 batches (~10 seconds of data)
    const result = await pool.query(
      `SELECT samples FROM live_telemetry
       WHERE race_id = $1
       ORDER BY received_at DESC
       LIMIT 5`,
      [raceId]
    );

    // Flatten all batches, sort by session time
    let samples = result.rows
      .flatMap(row => row.samples)
      .sort((a, b) => a.t - b.t);

    // Filter to only samples newer than cursor
    if (since !== null) {
      samples = samples.filter(s => s.t > since);
    } else {
      samples = samples.slice(-100);
    }

    res.json({ active: true, race_id: raceId, samples });
  } catch (err) {
    console.error('[GET /telemetry/live]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});
```

---

## Step 5 — Add GET /api/iracing/telemetry/lap/:raceId/:lap

For replay and coaching comparison — returns all samples for a specific lap.

```javascript
router.get('/telemetry/lap/:raceId/:lap', authenticateToken, async (req, res) => {
  try {
    const raceId = parseInt(req.params.raceId);
    const lap    = parseInt(req.params.lap);

    const result = await pool.query(
      `SELECT samples FROM live_telemetry
       WHERE race_id = $1 AND lap = $2
       ORDER BY received_at ASC`,
      [raceId, lap]
    );

    const allSamples = result.rows
      .flatMap(row => row.samples)
      .sort((a, b) => a.t - b.t);

    res.json({
      race_id:      raceId,
      lap:          lap,
      sample_count: allSamples.length,
      samples:      allSamples,
    });
  } catch (err) {
    console.error('[GET /telemetry/lap]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});
```

---

## Step 6 — Add live telemetry panel to race.html

Open `public/race.html`. After the standings panel, paste this full block.
It is self-contained — inline styles and vanilla JS only. Matches the existing
blue/white theme (Montserrat, Rajdhani, #0066cc/#00aaff palette).

```html
<style>
  .telem-panel {
    background: #0d1526;
    border: 1px solid #1a2a4a;
    border-radius: 8px;
    margin: 24px 0;
    overflow: hidden;
  }
  .telem-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    background: #0a0f1c;
    border-bottom: 1px solid #1a2a4a;
  }
  .telem-panel-header h3 {
    margin: 0;
    font-family: 'Montserrat', sans-serif;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #00aaff;
  }
  .telem-live-dot {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: 'Rajdhani', sans-serif;
    font-size: 12px;
    color: #556;
  }
  .telem-live-dot.active { color: #00cc66; }
  .telem-live-dot .live-dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    background: #334;
  }
  .telem-live-dot.active .live-dot {
    background: #00cc66;
    box-shadow: 0 0 6px #00cc66;
    animation: tlpulse 1.5s infinite;
  }
  @keyframes tlpulse { 0%,100%{opacity:1}50%{opacity:0.4} }
  .telem-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: #1a2a4a;
    padding: 1px;
  }
  .telem-graph-wrap {
    background: #0d1526;
    padding: 12px 16px;
  }
  .telem-graph-label {
    font-family: 'Rajdhani', sans-serif;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #445;
    margin-bottom: 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .telem-val {
    color: #7799bb;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
    font-family: 'Rajdhani', sans-serif;
  }
  canvas.telem-canvas {
    width: 100%;
    height: 80px;
    display: block;
    border-radius: 3px;
    background: #080d18;
  }
  .tyre-section {
    background: #0d1526;
    padding: 12px 16px;
    border-top: 1px solid #1a2a4a;
  }
  .tyre-section-label {
    font-family: 'Rajdhani', sans-serif;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #445;
    margin-bottom: 10px;
  }
  .tyre-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .tyre-corner {
    background: #080d18;
    border-radius: 4px;
    padding: 10px 12px;
  }
  .tyre-corner-label {
    font-family: 'Rajdhani', sans-serif;
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #334;
    margin-bottom: 4px;
  }
  .tyre-temp-val {
    font-family: 'Rajdhani', sans-serif;
    font-size: 20px;
    font-weight: 700;
    color: #e0eeff;
    line-height: 1;
    margin-bottom: 6px;
  }
  .tyre-wear-bar {
    height: 4px;
    background: #1a2a4a;
    border-radius: 2px;
    overflow: hidden;
  }
  .tyre-wear-fill {
    height: 100%;
    border-radius: 2px;
    background: #00cc66;
    transition: width 0.4s, background 0.4s;
  }
  .telem-inactive {
    padding: 32px;
    text-align: center;
    font-family: 'Rajdhani', sans-serif;
    color: #334;
    font-size: 14px;
  }
</style>

<div class="telem-panel">
  <div class="telem-panel-header">
    <h3>Live Telemetry</h3>
    <div class="telem-live-dot" id="telemDot">
      <div class="live-dot"></div>
      <span id="telemDotLabel">Waiting...</span>
    </div>
  </div>

  <div id="telemInactive" class="telem-inactive">No active race or telemetry stream</div>

  <div id="telemActive" style="display:none">
    <div class="telem-grid">
      <div class="telem-graph-wrap">
        <div class="telem-graph-label">
          Speed
          <span class="telem-val" id="valSpeed">— kph</span>
        </div>
        <canvas class="telem-canvas" id="cvSpeed" width="600" height="80"></canvas>
      </div>
      <div class="telem-graph-wrap">
        <div class="telem-graph-label">
          <span><span style="color:#00cc66">▮</span> Throttle &nbsp;<span style="color:#ff4455">▮</span> Brake</span>
          <span class="telem-val" id="valThrBrk">—</span>
        </div>
        <canvas class="telem-canvas" id="cvThrBrk" width="600" height="80"></canvas>
      </div>
      <div class="telem-graph-wrap">
        <div class="telem-graph-label">
          Gear
          <span class="telem-val" id="valGear">—</span>
        </div>
        <canvas class="telem-canvas" id="cvGear" width="600" height="80"></canvas>
      </div>
      <div class="telem-graph-wrap">
        <div class="telem-graph-label">
          RPM
          <span class="telem-val" id="valRpm">—</span>
        </div>
        <canvas class="telem-canvas" id="cvRpm" width="600" height="80"></canvas>
      </div>
    </div>

    <div class="tyre-section">
      <div class="tyre-section-label">Tyre Temperatures &amp; Wear</div>
      <div class="tyre-grid">
        <div class="tyre-corner">
          <div class="tyre-corner-label">Front Left</div>
          <div class="tyre-temp-val" id="tTFL">—</div>
          <div class="tyre-wear-bar"><div class="tyre-wear-fill" id="wFL" style="width:100%"></div></div>
        </div>
        <div class="tyre-corner">
          <div class="tyre-corner-label">Front Right</div>
          <div class="tyre-temp-val" id="tTFR">—</div>
          <div class="tyre-wear-bar"><div class="tyre-wear-fill" id="wFR" style="width:100%"></div></div>
        </div>
        <div class="tyre-corner">
          <div class="tyre-corner-label">Rear Left</div>
          <div class="tyre-temp-val" id="tTRL">—</div>
          <div class="tyre-wear-bar"><div class="tyre-wear-fill" id="wRL" style="width:100%"></div></div>
        </div>
        <div class="tyre-corner">
          <div class="tyre-corner-label">Rear Right</div>
          <div class="tyre-temp-val" id="tTRR">—</div>
          <div class="tyre-wear-bar"><div class="tyre-wear-fill" id="wRR" style="width:100%"></div></div>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
(function () {
  var MAX_PTS  = 150;
  var lastSince = null;

  var bufs = { spd: [], thr: [], brk: [], gear: [], rpm: [] };

  function push(buf, v) {
    buf.push(v === null || v === undefined ? null : v);
    if (buf.length > MAX_PTS) buf.shift();
  }

  function drawLine(id, buf, color, lo, hi) {
    var cv = document.getElementById(id);
    if (!cv) return;
    var ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    var pts = buf.filter(function(v) { return v !== null; });
    if (pts.length < 2) return;
    var range = (hi - lo) || 1;
    ctx.beginPath();
    var drawn = 0;
    for (var i = 0; i < buf.length; i++) {
      if (buf[i] === null) continue;
      var x = (i / (MAX_PTS - 1)) * W;
      var y = H - ((buf[i] - lo) / range) * (H - 4) - 2;
      if (drawn === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      drawn++;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    var rgb = color.match(/\d+/g);
    ctx.fillStyle = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.12)';
    ctx.fill();
  }

  function drawOverlay(id, b1, c1, b2, c2) {
    var cv = document.getElementById(id);
    if (!cv) return;
    var ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    function draw(buf, color) {
      var drawn = 0;
      ctx.beginPath();
      for (var i = 0; i < buf.length; i++) {
        if (buf[i] === null) continue;
        var x = (i / (MAX_PTS - 1)) * W;
        var y = H - buf[i] * (H - 4) - 2;
        if (drawn === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        drawn++;
      }
      if (!drawn) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
      var rgb = color.match(/\d+/g);
      ctx.fillStyle = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.18)';
      ctx.fill();
    }
    draw(b1, c1);
    draw(b2, c2);
  }

  function avgArr(arr) {
    if (!arr) return null;
    var v = arr.filter(function(x) { return x !== null && x !== undefined; });
    if (!v.length) return null;
    return v.reduce(function(a, b) { return a + b; }, 0) / v.length;
  }

  function tempColor(t) {
    if (!t) return '#e0eeff';
    if (t < 70)  return '#4488ff';
    if (t < 85)  return '#00cc66';
    if (t < 100) return '#ffaa00';
    return '#ff4455';
  }

  function updateTyre(idTemp, idWear, tempArr, wear) {
    var t   = avgArr(tempArr);
    var tel = document.getElementById(idTemp);
    if (tel) {
      tel.textContent = t ? Math.round(t) + '°C' : '—';
      tel.style.color = tempColor(t);
    }
    var wel = document.getElementById(idWear);
    if (wel && wear !== null && wear !== undefined) {
      var pct = Math.round((1 - wear) * 100);
      wel.style.width = pct + '%';
      wel.style.background = wear > 0.5 ? '#ff4455' : wear > 0.25 ? '#ffaa00' : '#00cc66';
    }
  }

  function ingest(samples) {
    if (!samples || !samples.length) return;
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      push(bufs.spd,  s.spd !== null && s.spd !== undefined ? s.spd * 3.6 : null);
      push(bufs.thr,  s.thr);
      push(bufs.brk,  s.brk);
      push(bufs.gear, s.gear);
      push(bufs.rpm,  s.rpm);
    }

    var last = samples[samples.length - 1];

    // Value labels
    var el;
    var spd = last.spd !== null ? Math.round(last.spd * 3.6) : null;
    el = document.getElementById('valSpeed');  if (el) el.textContent = spd !== null ? spd + ' kph' : '—';
    el = document.getElementById('valGear');   if (el) el.textContent = last.gear === 0 ? 'N' : last.gear === -1 ? 'R' : (last.gear || '—');
    el = document.getElementById('valRpm');    if (el) el.textContent = last.rpm ? Math.round(last.rpm) + ' rpm' : '—';
    el = document.getElementById('valThrBrk');
    if (el) {
      var ts = last.thr !== null ? Math.round(last.thr * 100) + '%T' : '';
      var bs = last.brk !== null ? Math.round(last.brk * 100) + '%B' : '';
      el.textContent = [ts, bs].filter(Boolean).join('  ') || '—';
    }

    // Tyres
    updateTyre('tTFL', 'wFL', last.tfl, last.wfl);
    updateTyre('tTFR', 'wFR', last.tfr, last.wfr);
    updateTyre('tTRL', 'wRL', last.trl, last.wrl);
    updateTyre('tTRR', 'wRR', last.trr, last.wrr);

    // Graphs
    var spdPts = bufs.spd.filter(function(v) { return v !== null; });
    var maxSpd = spdPts.length ? Math.max.apply(null, spdPts) : 300;
    var maxRpm = 9000;
    drawLine('cvSpeed',  bufs.spd,  'rgb(0,170,255)',   0, Math.max(maxSpd, 80));
    drawOverlay('cvThrBrk', bufs.thr, 'rgb(0,204,102)', bufs.brk, 'rgb(255,68,85)');
    drawLine('cvGear',   bufs.gear, 'rgb(255,170,0)',   0, 8);
    drawLine('cvRpm',    bufs.rpm,  'rgb(180,100,255)', 0, maxRpm);
  }

  function poll() {
    var url = '/api/iracing/telemetry/live';
    if (lastSince !== null) url += '?since=' + lastSince;

    fetch(url)
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        var dot   = document.getElementById('telemDot');
        var label = document.getElementById('telemDotLabel');
        var inactive = document.getElementById('telemInactive');
        var active   = document.getElementById('telemActive');

        if (!data || !data.active) {
          dot.classList.remove('active');
          label.textContent = 'No active race';
          inactive.style.display = 'block';
          active.style.display   = 'none';
          return;
        }

        inactive.style.display = 'none';
        active.style.display   = 'block';
        dot.classList.add('active');

        var samples = data.samples || [];
        if (samples.length) {
          label.textContent = samples.length + ' new samples';
          lastSince = samples[samples.length - 1].t;
          ingest(samples);
        } else {
          label.textContent = 'Live';
        }
      })
      .catch(function(e) { console.warn('[telem poll]', e); });
  }

  poll();
  setInterval(poll, 1000);
})();
</script>
```

---

## Step 7 — Verify

- [ ] `POST /api/iracing/telemetry` returns `{ ok: true, stored: N }` — not 500
- [ ] `GET /api/iracing/telemetry/live` returns `{ active: false, samples: [] }` with no active race — not 500
- [ ] `GET /api/iracing/telemetry/lap/1/1` returns `{ samples: [...] }` — not 500
- [ ] `race.html` loads without JS console errors
- [ ] Existing routes (`/api/iracing/event`, `/api/iracing/status`, `/api/iracing/standings`) still work
- [ ] Server starts cleanly with `npm start`

## Key notes

- `zlib` and `util` are Node built-ins — no extra npm packages needed
- The `express.raw()` line in `server.js` MUST come before `express.json()` or
  Express will reject the gzip body
- Use the same `pool` and `authenticateToken` already imported in `iracing.js` —
  do not add new imports for these
- Sample field reference (from desktop client):
  `t` session time, `spd` speed m/s, `thr` throttle 0-1, `brk` brake 0-1,
  `steer` steering radians, `gear` gear number, `rpm` RPM, `ldp` lap dist pct,
  `tfl/tfr/trl/trr` tyre temps [L,C,R], `wfl/wfr/wrl/wrr` tyre wear 0-1,
  `glat/glon/gver` G-forces m/s²
