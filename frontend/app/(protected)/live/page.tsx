'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { telemetry as telApi, races as racesApi } from '@/lib/api';
import type { LiveFrame, LiveSessionSummary, Race, RaceState } from '@/lib/types';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

// ── Constants ────────────────────────────────────────────────────
const WINDOW_S     = 30;
const POLL_FRAMES  = 500;
const POLL_SUMMARY = 3000;
const POLL_ACTIVE  = 5000;
const POLL_RACE    = 10000;

// ── Canvas chart ─────────────────────────────────────────────────

function drawSeries(
  canvas: HTMLCanvasElement | null,
  series: Array<{ values: (number | null)[]; color: string; fill?: boolean }>,
  yMin: number,
  yMax: number,
  zeroline = false
) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth * dpr;
  const ch = canvas.clientHeight * dpr;
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  ctx.clearRect(0, 0, cw, ch);
  const n = series[0]?.values.length ?? 0;
  if (n < 2) return;
  const yRange = (yMax - yMin) || 1;
  const pad = 2;
  if (zeroline && yMin < 0 && yMax > 0) {
    const zy = ch - ((0 - yMin) / yRange) * (ch - pad * 2) - pad;
    ctx.beginPath(); ctx.moveTo(0, zy); ctx.lineTo(cw, zy);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();
  }
  for (const s of series) {
    ctx.beginPath();
    let moved = false;
    for (let i = 0; i < s.values.length; i++) {
      const v = s.values[i];
      if (v == null) { moved = false; continue; }
      const x = (i / (n - 1)) * cw;
      const y = ch - ((v - yMin) / yRange) * (ch - pad * 2) - pad;
      if (!moved) { ctx.moveTo(x, y); moved = true; } else { ctx.lineTo(x, y); }
    }
    ctx.strokeStyle = s.color; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
    ctx.lineTo(cw, ch); ctx.lineTo(0, ch); ctx.closePath();
    const m = s.color.match(/[\d.]+/g) ?? ['100', '170', '255'];
    ctx.fillStyle = `rgba(${m[0]},${m[1]},${m[2]},0.10)`; ctx.fill();
  }
}

// ── Formatters ───────────────────────────────────────────────────

function fmtLapTime(secs: number | null | undefined): string {
  if (!secs || secs <= 0) return '—';
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(3).padStart(6, '0');
  return `${m}:${s}`;
}
function fmtSessionTime(secs: number | null): string {
  if (secs == null) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

// ── Active Race Banner ────────────────────────────────────────────

function ActiveRaceBanner() {
  const [race, setRace]   = useState<Race | null>(null);
  const [raceState, setRaceState] = useState<RaceState | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await racesApi.active();
        setRace(r);
        if (r?.id) {
          try {
            const { state } = await racesApi.state(r.id);
            setRaceState(state);
          } catch { /* state not available yet */ }
        }
      } catch {
        setRace(null);
        setRaceState(null);
      }
    };
    load();
    const iv = setInterval(load, POLL_RACE);
    return () => clearInterval(iv);
  }, []);

  if (!race) return null;

  const stintMins = race.stint_started_at
    ? Math.floor((Date.now() - new Date(race.stint_started_at).getTime()) / 60000)
    : null;

  return (
    <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 mb-6">
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className="flex items-center gap-1.5 text-green-400 text-xs font-semibold uppercase tracking-wider">
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          Active Race
        </span>
        <span className="text-white font-heading font-bold">{race.name}</span>
        {race.track && <span className="text-dark-muted text-sm">{race.track}</span>}
        <Link href="/race" className="ml-auto text-xs text-[#0066cc] hover:underline font-semibold">
          Manage race →
        </Link>
      </div>

      <div className="flex flex-wrap gap-6">
        {race.current_driver_name ? (
          <div>
            <p className="text-dark-muted text-xs mb-0.5">Current driver</p>
            <p className="text-white font-semibold">{race.current_driver_name}</p>
            {stintMins !== null && (
              <p className="text-dark-muted text-xs">{stintMins}m into stint</p>
            )}
          </div>
        ) : (
          <div>
            <p className="text-dark-muted text-xs mb-0.5">Current driver</p>
            <p className="text-dark-muted text-sm">No driver set</p>
          </div>
        )}

        {raceState?.last_fuel_level != null && (
          <div>
            <p className="text-dark-muted text-xs mb-0.5">Fuel</p>
            <p className={`font-semibold text-lg font-heading ${raceState.last_fuel_level < 20 ? 'text-red-400' : raceState.last_fuel_level < 40 ? 'text-yellow-400' : 'text-white'}`}>
              {raceState.last_fuel_level.toFixed(1)}%
            </p>
          </div>
        )}

        {raceState?.laps_completed != null && (
          <div>
            <p className="text-dark-muted text-xs mb-0.5">Laps</p>
            <p className="text-white font-semibold text-lg font-heading">{raceState.laps_completed}</p>
          </div>
        )}

        {raceState?.position != null && (
          <div>
            <p className="text-dark-muted text-xs mb-0.5">Position</p>
            <p className="text-yellow-400 font-bold text-2xl font-heading">P{raceState.position}</p>
          </div>
        )}

        {raceState?.best_lap_time != null && (
          <div>
            <p className="text-dark-muted text-xs mb-0.5">Best lap</p>
            <p className="text-purple-400 font-mono text-sm font-semibold">{fmtLapTime(raceState.best_lap_time)}</p>
          </div>
        )}

        {raceState?.gap_ahead != null && (
          <div>
            <p className="text-dark-muted text-xs mb-0.5">Gap ahead</p>
            <p className="text-white font-mono text-sm">{raceState.gap_ahead.toFixed(1)}s</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────

function ChartPanel({ label, value, canvasRef, height = 100 }: {
  label: string; value: string; canvasRef: React.RefObject<HTMLCanvasElement>; height?: number;
}) {
  return (
    <div className="bg-dark-card rounded-xl border border-dark-border p-4">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs text-dark-muted font-body uppercase tracking-widest">{label}</span>
        <span className="text-sm font-semibold text-white tabular-nums">{value}</span>
      </div>
      <canvas ref={canvasRef} className="w-full block rounded bg-[#080d18]" style={{ height }} />
    </div>
  );
}

function Stat({ label, value, color = 'text-white', large = false }: {
  label: string; value: string; color?: string; large?: boolean;
}) {
  return (
    <div className="bg-[#0a0f1c] rounded-lg p-3 text-center">
      <p className="text-dark-muted text-xs mb-1 uppercase tracking-widest font-body">{label}</p>
      <p className={`font-bold font-heading ${large ? 'text-3xl' : 'text-xl'} ${color}`}>{value}</p>
    </div>
  );
}

// ── Live telemetry view (shown once a session is active) ─────────

function LiveView({ sessionId, isLive }: { sessionId: number; isLive: boolean }) {
  const [summary, setSummary]     = useState<LiveSessionSummary | null>(null);
  const [buffer, setBuffer]       = useState<LiveFrame[]>([]);
  const [streaming, setStreaming] = useState(false);
  const latestTimeRef = useRef(0);
  const cvSpeed = useRef<HTMLCanvasElement>(null);
  const cvTB    = useRef<HTMLCanvasElement>(null);
  const cvSteer = useRef<HTMLCanvasElement>(null);

  // Poll summary
  useEffect(() => {
    const poll = async () => {
      try { setSummary(await telApi.liveSummary(sessionId)); } catch {}
    };
    poll();
    const iv = setInterval(poll, POLL_SUMMARY);
    return () => clearInterval(iv);
  }, [sessionId]);

  // Poll frames
  useEffect(() => {
    latestTimeRef.current = 0;
    setBuffer([]);
    const poll = async () => {
      try {
        const { frames } = await telApi.liveFrames(sessionId, latestTimeRef.current, 300);
        if (!frames.length) return;
        setStreaming(true);
        latestTimeRef.current = Number(frames[frames.length - 1].session_time);
        setBuffer(prev => {
          const next = [...prev, ...frames.map((f: any) => ({
            ...f,
            session_time:  Number(f.session_time),
            speed_kph:     f.speed_kph    != null ? Number(f.speed_kph)    : null,
            throttle:      f.throttle     != null ? Number(f.throttle)     : null,
            brake:         f.brake        != null ? Number(f.brake)        : null,
            steering_deg:  f.steering_deg != null ? Number(f.steering_deg) : null,
          }))];
          const cutoff = latestTimeRef.current - WINDOW_S;
          return next.filter((f: LiveFrame) => f.session_time >= cutoff);
        });
      } catch { setStreaming(false); }
    };
    poll();
    const iv = setInterval(poll, POLL_FRAMES);
    return () => clearInterval(iv);
  }, [sessionId]);

  // Redraw
  useEffect(() => {
    if (!buffer.length) return;
    drawSeries(cvSpeed.current, [{ values: buffer.map(f => f.speed_kph), color: 'rgb(0,170,255)' }], 0, 300);
    drawSeries(cvTB.current, [
      { values: buffer.map(f => f.throttle),                          color: 'rgb(0,210,100)' },
      { values: buffer.map(f => f.brake != null ? -f.brake : null),  color: 'rgb(255,60,60)' },
    ], -1, 1);
    drawSeries(cvSteer.current, [{ values: buffer.map(f => f.steering_deg), color: 'rgb(255,170,0)' }], -180, 180, true);
  }, [buffer]);

  const l = summary?.latest;
  const gearLabel = (g: number | null | undefined) =>
    g == null ? '—' : g === 0 ? 'N' : g === -1 ? 'R' : String(g);

  return (
    <div>
      {/* Active race banner above telemetry */}
      <ActiveRaceBanner />

      {/* Session strip */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div>
          <h2 className="font-heading font-bold text-xl text-white">
            {summary?.session.track_name ?? `Session ${sessionId}`}
          </h2>
          {summary?.session.car_name && (
            <p className="text-dark-muted text-sm">{summary.session.car_name}</p>
          )}
        </div>
        {isLive
          ? <Badge variant="active">LIVE</Badge>
          : <Badge variant="info">Replay</Badge>}
        <div className={`flex items-center gap-1.5 text-xs ${streaming ? 'text-green-400' : 'text-dark-muted'}`}>
          <span className={`w-2 h-2 rounded-full ${streaming ? 'bg-green-400 animate-pulse' : 'bg-dark-muted'}`} />
          {isLive ? (streaming ? 'Streaming' : 'Waiting for data…') : (streaming ? 'Loading frames…' : 'Done')}
        </div>
        <Link href={`/live/${sessionId}`} className="ml-auto text-xs text-[#0066cc] hover:underline">
          Full view →
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Charts */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <ChartPanel
            label="Speed"
            value={l?.speed_kph != null ? `${Math.round(l.speed_kph)} kph` : '—'}
            canvasRef={cvSpeed}
            height={110}
          />
          <ChartPanel
            label="Throttle (green) / Brake (red)"
            value={l?.throttle != null
              ? `${Math.round(l.throttle * 100)}% / ${Math.round((l.brake ?? 0) * 100)}%`
              : '—'}
            canvasRef={cvTB}
            height={90}
          />
          <ChartPanel
            label="Steering"
            value={buffer.length ? `${(buffer[buffer.length - 1]?.steering_deg ?? 0).toFixed(1)}°` : '—'}
            canvasRef={cvSteer}
            height={90}
          />
        </div>

        {/* Info panel */}
        <div className="flex flex-col gap-4">
          <Card header="Now">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Speed"    value={l?.speed_kph != null ? Math.round(l.speed_kph).toString() : '—'} color="text-[#00aaff]" large />
              <Stat label="Gear"     value={gearLabel(l?.gear)} color="text-yellow-400" large />
              <Stat label="RPM"      value={l?.rpm != null ? `${(l.rpm / 1000).toFixed(1)}k` : '—'} />
              <Stat label="Throttle" value={l?.throttle != null ? `${Math.round(l.throttle * 100)}%` : '—'} color="text-green-400" />
              <Stat label="Brake"    value={l?.brake != null ? `${Math.round(l.brake * 100)}%` : '—'} color="text-red-400" />
              <Stat label="Time"     value={fmtSessionTime(summary?.latest_session_time ?? null)} />
            </div>
          </Card>

          <Card header="Session">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-dark-muted">Current lap</span>
                <span className="text-white font-semibold">{summary?.current_lap ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-muted">Best lap</span>
                <span className="text-purple-400 font-mono font-semibold">{fmtLapTime(summary?.best_lap_time)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-muted">Frames</span>
                <span className="text-white">{summary?.frame_count?.toLocaleString() ?? '—'}</span>
              </div>
            </div>
          </Card>

          {(summary?.laps?.length ?? 0) > 0 && (
            <Card header={`Laps (${summary!.laps.length})`} padding={false}>
              <div className="max-h-56 overflow-y-auto divide-y divide-dark-border">
                {[...summary!.laps].reverse().map((lap, i) => {
                  const isBest = lap.lap_time === summary!.best_lap_time;
                  return (
                    <div key={i} className="flex justify-between items-center px-4 py-2 hover:bg-white/2">
                      <span className="text-dark-muted text-sm">Lap {lap.lap_number}</span>
                      <span className={`font-mono text-sm font-semibold ${isBest ? 'text-purple-400' : 'text-white'}`}>
                        {fmtLapTime(lap.lap_time)}
                        {isBest && <span className="ml-1 text-purple-500 text-[10px]">▲</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ── No-session state — shows active race + recent live sessions ───

function NoSession() {
  const [sessions, setSessions] = useState<any[]>([]);

  useEffect(() => {
    telApi.liveSessions().then(setSessions).catch(console.error);
  }, []);

  return (
    <div>
      {/* Active race banner — always show if a race is live */}
      <ActiveRaceBanner />

      <div className="text-center py-12">
        <p className="text-5xl mb-4">📡</p>
        <p className="font-heading font-semibold text-white text-xl mb-2">No active telemetry session</p>
        <p className="text-dark-muted text-sm mb-6">
          Start the desktop client to stream live telemetry from your car.
        </p>
      </div>

      {sessions.length > 0 && (
        <div className="max-w-2xl mx-auto">
          <h3 className="font-heading font-semibold text-white text-sm uppercase tracking-wider mb-3">
            Recent live sessions
          </h3>
          <div className="bg-dark-card border border-dark-border rounded-xl divide-y divide-dark-border overflow-hidden">
            {sessions.slice(0, 10).map(s => (
              <Link
                key={s.id}
                href={`/live/${s.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-white/2 transition-colors group"
              >
                <div>
                  <p className="text-white text-sm font-semibold">{s.track_name || 'Unknown track'}</p>
                  <p className="text-dark-muted text-xs">{s.car_name} · {new Date(s.created_at).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={s.status === 'open' ? 'active' : 'inactive'}>{s.status}</Badge>
                  <span className="text-dark-muted group-hover:text-[#0066cc] transition-colors">→</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────

export default function LivePage() {
  const [sessionId, setSessionId] = useState<number | null | undefined>(undefined);
  const [isLive, setIsLive]       = useState(false);
  // undefined = loading, null = nothing found, number = found

  useEffect(() => {
    const check = async () => {
      try {
        const res = await telApi.liveActive();
        setSessionId(res.session_id ?? null);
        setIsLive(!!(res as any).is_live);
      } catch {
        setSessionId(prev => prev === undefined ? null : prev);
      }
    };
    check();
    const iv = setInterval(check, POLL_ACTIVE);
    return () => clearInterval(iv);
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading font-bold text-2xl text-white">Live Race Tracker</h1>
          <p className="text-dark-muted text-sm">Real-time telemetry and race status</p>
        </div>
        <a href="/lap-analysis.html" className="text-xs text-dark-muted hover:text-white transition-colors">
          Lap Library →
        </a>
      </div>

      {sessionId === undefined && (
        <div className="text-dark-muted text-sm text-center py-16">Checking for active session…</div>
      )}
      {(sessionId === null || (sessionId !== undefined && !isLive)) && <NoSession />}
      {sessionId != null && isLive && <LiveView key={sessionId} sessionId={sessionId} isLive={isLive} />}
    </div>
  );
}
