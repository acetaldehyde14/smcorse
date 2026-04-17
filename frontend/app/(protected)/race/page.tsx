'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { races as racesApi, team as teamApi, stintPlanner } from '@/lib/api';
import type {
  Race, RaceEvent, StintRosterEntry, Driver, RaceState,
  RaceStintPlan, StintBlock, StintPlannerSession, NearbyCar, RaceLap,
} from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';

const BLOCK_MINS = 45;

// ── Helpers ────────────────────────────────────────────────────

function getBlockDriverName(b: StintBlock) {
  return b.driver_name || b.driver || '';
}
function getBlockStart(b: StintBlock): number {
  if (b.startBlock != null) return b.startBlock;
  if (b.start_hour != null) return Math.round(b.start_hour * 60 / BLOCK_MINS);
  return 0;
}
function getBlockEnd(b: StintBlock): number {
  if (b.endBlock != null) return b.endBlock;
  if (b.start_hour != null && b.duration_hours != null)
    return Math.round((b.start_hour + b.duration_hours) * 60 / BLOCK_MINS);
  return 0;
}
function blockToClockTime(raceStartedAt: string, blockIdx: number): string {
  const ms = new Date(raceStartedAt).getTime() + blockIdx * BLOCK_MINS * 60 * 1000;
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}
function deviationLabel(mins: number | null) {
  if (mins === null) return null;
  const abs = Math.abs(mins);
  if (abs <= 2) return { text: 'On schedule', cls: 'text-green-400' };
  if (mins > 0)  return { text: `${abs}m early`, cls: 'text-green-400' };
  return { text: `${abs}m late`, cls: 'text-red-400' };
}

// ── Race Card (grid view) ─────────────────────────────────────

function RaceCard({ race, onClick }: { race: Race; onClick: () => void }) {
  const stintElapsed = race.stint_started_at
    ? Math.round((Date.now() - new Date(race.stint_started_at).getTime()) / 60000)
    : null;

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-[#0d1525] border border-[#1a2540] rounded-xl p-5 hover:border-[#0066cc]/60 hover:bg-[#0d1525]/80 transition-all group focus:outline-none focus:ring-2 focus:ring-[#0066cc]/50"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={race.is_active ? 'active' : 'inactive'}>
            {race.is_active ? 'LIVE' : 'Inactive'}
          </Badge>
          {race.active_stint_session_id && (
            <Badge variant="info">Plan linked</Badge>
          )}
        </div>
        <span className="text-dark-muted text-xs group-hover:text-[#0066cc] transition-colors">
          View →
        </span>
      </div>

      <h3 className="font-heading font-bold text-white text-lg mb-1 leading-tight">{race.name}</h3>
      {race.track && <p className="text-dark-muted text-sm mb-3">{race.track}</p>}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm border-t border-[#1a2540] pt-3 mt-auto">
        {race.current_driver_name ? (
          <div>
            <span className="text-dark-muted text-xs block">Current driver</span>
            <span className="text-white font-semibold">{race.current_driver_name}</span>
            {stintElapsed !== null && (
              <span className="text-dark-muted text-xs ml-1">({stintElapsed}m)</span>
            )}
          </div>
        ) : (
          <span className="text-dark-muted text-xs">No driver logged</span>
        )}
        {race.event_count != null && Number(race.event_count) > 0 && (
          <div className="ml-auto">
            <span className="text-dark-muted text-xs block">Events</span>
            <span className="text-white font-semibold">{race.event_count}</span>
          </div>
        )}
      </div>

      {race.started_at && (
        <p className="text-dark-muted text-xs mt-2">
          {race.is_active ? `Started ${timeAgo(race.started_at)}` : `Ended ${race.ended_at ? timeAgo(race.ended_at) : '—'}`}
        </p>
      )}
    </button>
  );
}

// ── Standings Panel ───────────────────────────────────────────

function formatGap(secs: number | null | undefined): string {
  if (secs == null) return '—';
  const abs = Math.abs(secs);
  if (abs < 60) return `${abs.toFixed(1)}s`;
  const m = Math.floor(abs / 60);
  const s = (abs % 60).toFixed(0).padStart(2, '0');
  return `${m}:${s}`;
}

function formatLapTime(secs: number | null | undefined): string {
  if (!secs || secs <= 0) return '—';
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(3).padStart(6, '0');
  return `${m}:${s}`;
}

// ── Telemetry Panel ────────────────────────────────────────────
const MAX_PTS = 150;

function drawLine(canvas: HTMLCanvasElement, buf: number[], color: string, lo: number, hi: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (buf.filter(v => v != null).length < 2) return;
  const range = (hi - lo) || 1;
  ctx.beginPath();
  let drawn = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] == null) continue;
    const x = (i / (MAX_PTS - 1)) * W;
    const y = H - ((buf[i] - lo) / range) * (H - 4) - 2;
    drawn === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    drawn++;
  }
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  const m = color.match(/\d+/g)!;
  ctx.fillStyle = `rgba(${m[0]},${m[1]},${m[2]},0.12)`; ctx.fill();
}

function fmtGap(g: number | null | undefined) {
  if (g == null) return '—';
  const sign = g >= 0 ? '+' : '';
  return `${sign}${g.toFixed(3)}s`;
}

function TelemetryPanel() {
  const [bufs, setBufs] = useState<Record<string, number[]>>({ spd: [], gear: [], rpm: [] });
  const [lastSample, setLastSample] = useState<Record<string, any> | null>(null);
  const [nearby, setNearby]         = useState<any[]>([]);
  const [position, setPosition]     = useState<{ pos: number | null; cls: number | null }>({ pos: null, cls: null });
  const [active, setActive]         = useState(false);
  const lastSinceRef                = useRef<number | null>(null);
  const cvSpd  = useRef<HTMLCanvasElement>(null);
  const cvGear = useRef<HTMLCanvasElement>(null);
  const cvRpm  = useRef<HTMLCanvasElement>(null);

  const push = (buf: number[], v: number | null) => {
    const next = [...buf, v as number];
    return next.length > MAX_PTS ? next.slice(next.length - MAX_PTS) : next;
  };

  // Poll telemetry for speed/gear/rpm graphs
  useEffect(() => {
    const poll = async () => {
      try {
        let url = '/api/iracing/telemetry/live';
        if (lastSinceRef.current !== null) url += `?since=${lastSinceRef.current}`;
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) return;
        const data = await r.json();
        setActive(!!data.active);
        if (!data.active || !data.samples?.length) return;
        const samples: any[] = data.samples;
        lastSinceRef.current = samples[samples.length - 1].t;
        setLastSample(samples[samples.length - 1]);
        setBufs(prev => {
          const next = { ...prev };
          for (const s of samples) {
            next.spd  = push(next.spd,  s.spd != null ? s.spd * 3.6 : null);
            next.gear = push(next.gear, s.gear);
            next.rpm  = push(next.rpm,  s.rpm);
          }
          return next;
        });
      } catch {}
    };
    const iv = setInterval(poll, 1000);
    poll();
    return () => clearInterval(iv);
  }, []);

  // Poll race_state for position + nearby cars (uses existing /api/races/:id/state via status endpoint)
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch('/api/iracing/status', { credentials: 'include' });
        if (!r.ok) return;
        const data = await r.json();
        const state = data.state ?? data; // handle both shapes
        setPosition({ pos: state.position ?? null, cls: state.class_position ?? null });
        setNearby(state.nearby_cars ?? []);
      } catch {}
    };
    const iv = setInterval(poll, 3000);
    poll();
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const spdPts = bufs.spd.filter(v => v != null);
    const maxSpd = spdPts.length ? Math.max(...spdPts) : 300;
    if (cvSpd.current)  drawLine(cvSpd.current,  bufs.spd,  'rgb(0,170,255)',   0, Math.max(maxSpd, 80));
    if (cvGear.current) drawLine(cvGear.current, bufs.gear, 'rgb(255,170,0)',   0, 8);
    if (cvRpm.current)  drawLine(cvRpm.current,  bufs.rpm,  'rgb(180,100,255)', 0, 9000);
  }, [bufs]);

  const s = lastSample;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-2 h-2 rounded-full ${active ? 'bg-green-400 shadow-[0_0_6px_#4ade80]' : 'bg-dark-border'}`} />
        <span className="text-xs text-dark-muted font-body uppercase tracking-widest">
          {active ? 'Live' : 'Waiting for telemetry...'}
        </span>
      </div>

      {!active ? (
        <p className="text-dark-muted text-sm py-4 text-center">No telemetry stream — desktop client must be running</p>
      ) : (
        <div className="space-y-4">
          {/* Position strip */}
          <div className="grid grid-cols-2 gap-px bg-dark-border rounded overflow-hidden">
            {[
              { label: 'Overall Position', val: position.pos != null ? `P${position.pos}` : '—', color: '#00aaff' },
              { label: 'Class Position',   val: position.cls != null ? `P${position.cls}` : '—', color: '#e0eeff' },
            ].map(({ label, val, color }) => (
              <div key={label} className="bg-dark-card p-3 text-center">
                <p className="text-xs text-dark-muted font-body uppercase tracking-widest mb-1">{label}</p>
                <p className="text-3xl font-bold font-heading" style={{ color }}>{val}</p>
              </div>
            ))}
          </div>

          {/* Nearby cars */}
          {nearby.length > 0 && (
            <div className="bg-[#080d18] rounded p-3">
              <p className="text-xs text-dark-muted font-body uppercase tracking-widest mb-2">Relative</p>
              <table className="w-full text-sm font-body">
                <tbody>
                  {nearby.map((car: any, i: number) => {
                    const isUs = car.is_us ?? car.is_player;
                    const gap  = car.gap;
                    const gapColor = isUs ? '#00aaff' : gap == null ? '#445566' : gap < 0 ? '#00cc66' : '#ff4455';
                    return (
                      <tr key={i} className={isUs ? 'bg-[#0d1e33] rounded' : ''}>
                        <td className="py-1 px-2 text-dark-muted w-8 text-center">{car.position}</td>
                        <td className="py-1 px-2 text-white">{car.driver_name}</td>
                        <td className="py-1 px-2 text-right font-mono text-xs" style={{ color: gapColor }}>
                          {isUs ? 'YOU' : fmtGap(gap)}
                        </td>
                        <td className="py-1 px-2 text-right text-dark-muted text-xs font-mono">
                          {car.last_lap ? car.last_lap.toFixed(3) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Graphs: speed, gear, rpm */}
          <div className="grid grid-cols-3 gap-px bg-dark-border rounded overflow-hidden">
            {[
              { ref: cvSpd,  label: 'Speed', val: s?.spd != null ? `${Math.round(s.spd * 3.6)} kph` : '—' },
              { ref: cvGear, label: 'Gear',  val: s?.gear === 0 ? 'N' : s?.gear === -1 ? 'R' : (s?.gear ?? '—') },
              { ref: cvRpm,  label: 'RPM',   val: s?.rpm ? `${Math.round(s.rpm)} rpm` : '—' },
            ].map(({ ref, label, val }) => (
              <div key={label} className="bg-dark-card p-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-dark-muted font-body uppercase tracking-widest">{label}</span>
                  <span className="text-sm font-semibold text-white font-body">{val}</span>
                </div>
                <canvas ref={ref} width={600} height={80} className="w-full h-20 rounded bg-[#080d18] block" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StandingsPanel({ state }: { state: RaceState }) {
  const pos   = state.position;
  const cls   = state.class_position;
  const nearby = state.nearby_cars ?? [];

  if (!pos) {
    return (
      <p className="text-dark-muted text-sm p-4">
        Waiting for position data from the desktop client...
      </p>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Position + gap summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[#0a0f1c] rounded-lg p-3 text-center">
          <p className="text-dark-muted text-xs mb-1">Overall P</p>
          <p className="text-white font-bold text-2xl">P{pos}</p>
        </div>
        {cls != null && cls !== pos && (
          <div className="bg-[#0a0f1c] rounded-lg p-3 text-center">
            <p className="text-dark-muted text-xs mb-1">Class P</p>
            <p className="text-white font-bold text-2xl">P{cls}</p>
          </div>
        )}
        <div className="bg-[#0a0f1c] rounded-lg p-3 text-center">
          <p className="text-dark-muted text-xs mb-1">Gap to leader</p>
          <p className="text-white font-bold text-lg">
            {state.gap_to_leader != null && state.gap_to_leader > 0
              ? `+${formatGap(state.gap_to_leader)}`
              : pos === 1 ? 'Leader' : '—'}
          </p>
        </div>
        {state.laps_completed != null && (
          <div className="bg-[#0a0f1c] rounded-lg p-3 text-center">
            <p className="text-dark-muted text-xs mb-1">Lap</p>
            <p className="text-white font-bold text-2xl">{state.laps_completed}</p>
          </div>
        )}
      </div>

      {/* Lap times */}
      {(state.last_lap_time || state.best_lap_time) && (
        <div className="flex gap-4 text-sm">
          {state.last_lap_time && (
            <div>
              <span className="text-dark-muted text-xs">Last lap </span>
              <span className="text-white font-mono font-semibold">{formatLapTime(state.last_lap_time)}</span>
            </div>
          )}
          {state.best_lap_time && (
            <div>
              <span className="text-dark-muted text-xs">Best lap </span>
              <span className="text-purple-400 font-mono font-semibold">{formatLapTime(state.best_lap_time)}</span>
            </div>
          )}
        </div>
      )}

      {/* Nearby cars table */}
      {nearby.length > 0 && (
        <div>
          <p className="text-dark-muted text-xs mb-2 uppercase tracking-wide">Nearby cars</p>
          <div className="rounded-lg overflow-hidden border border-dark-border">
            {nearby.map((car: NearbyCar, i: number) => {
              const gapLabel = car.is_us ? null
                : car.gap != null && car.gap < 0 ? `+${formatGap(Math.abs(car.gap))} ahead`
                : car.gap != null ? `+${formatGap(car.gap)} behind` : null;
              return (
                <div
                  key={i}
                  className={`flex items-center gap-3 px-4 py-2.5 text-sm border-b border-dark-border last:border-0
                    ${car.is_us ? 'bg-[#0066cc]/15' : 'hover:bg-white/2'}`}
                >
                  <span className={`w-8 text-center font-bold text-base ${car.is_us ? 'text-[#0066cc]' : 'text-dark-muted'}`}>
                    P{car.position}
                  </span>
                  <span className={`flex-1 font-semibold ${car.is_us ? 'text-white' : 'text-[#c8d0e0]'}`}>
                    {car.driver_name}
                    {car.is_us && <span className="ml-2 text-xs text-[#0066cc] font-normal">← us</span>}
                  </span>
                  {car.last_lap && (
                    <span className="text-dark-muted font-mono text-xs">{formatLapTime(car.last_lap)}</span>
                  )}
                  {gapLabel && (
                    <span className={`text-xs font-semibold tabular-nums ${car.gap != null && car.gap < 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {gapLabel}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Stint Plan Panel ──────────────────────────────────────────

function DeviationBadge({ block }: { block: StintBlock & { deviation_mins?: number | null } }) {
  const d = deviationLabel(block.deviation_mins ?? null);
  if (!d) return null;
  return <span className={`text-xs font-semibold ${d.cls}`}>{d.text}</span>;
}

function StintPlanPanel({ plan, raceStartedAt }: { plan: RaceStintPlan; raceStartedAt: string | null }) {
  const { session, current_index, stint_started_at } = plan;
  if (!session) return null;

  const blocks: StintBlock[] = Array.isArray(session.plan) ? session.plan : [];
  const stintElapsedMins = stint_started_at
    ? Math.round((Date.now() - new Date(stint_started_at).getTime()) / 60000)
    : null;

  return (
    <>
      {blocks[current_index] && (
        <div className="px-4 py-3 bg-[#0066cc]/10 border-b border-dark-border flex items-center justify-between">
          <div>
            <p className="text-xs text-dark-muted mb-0.5">Driving now</p>
            <p className="text-white font-bold text-lg">{getBlockDriverName(blocks[current_index])}</p>
          </div>
          <div className="text-right">
            {stintElapsedMins !== null && (
              <p className="text-sm text-dark-muted">
                In car: <span className="text-white font-semibold">{stintElapsedMins}m</span>
              </p>
            )}
            {(() => {
              const endBlock = getBlockEnd(blocks[current_index]);
              if (raceStartedAt && endBlock) {
                const plannedEndMs = new Date(raceStartedAt).getTime() + endBlock * BLOCK_MINS * 60 * 1000;
                const minsLeft = Math.round((plannedEndMs - Date.now()) / 60000);
                const color = minsLeft < 0 ? 'text-red-400' : minsLeft < 10 ? 'text-yellow-400' : 'text-green-400';
                return <p className={`text-sm font-semibold ${color}`}>{minsLeft < 0 ? `${Math.abs(minsLeft)}m over` : `${minsLeft}m left`}</p>;
              }
              return null;
            })()}
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dark-border">
              <th className="text-left px-4 py-2 text-dark-muted text-xs">#</th>
              <th className="text-left px-4 py-2 text-dark-muted text-xs">Driver</th>
              <th className="text-left px-4 py-2 text-dark-muted text-xs">Planned window</th>
              <th className="text-left px-4 py-2 text-dark-muted text-xs">Status</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((block, idx) => {
              const isCurrent = idx === current_index;
              const isDone    = !!(block as any).actual_end_at;
              const startIdx  = getBlockStart(block);
              const endIdx    = getBlockEnd(block);
              const startClock = raceStartedAt && startIdx != null ? blockToClockTime(raceStartedAt, startIdx) : (block.startTime ?? '—');
              const endClock   = raceStartedAt && endIdx != null   ? blockToClockTime(raceStartedAt, endIdx)   : (block.endTime   ?? '—');
              return (
                <tr key={idx} className={`border-b border-dark-border last:border-0 transition-colors ${isCurrent ? 'bg-[#0066cc]/10' : isDone ? 'opacity-40' : 'hover:bg-white/2'}`}>
                  <td className="px-4 py-2 text-dark-muted">{idx + 1}</td>
                  <td className="px-4 py-2 font-semibold text-white">{getBlockDriverName(block) || '—'}</td>
                  <td className="px-4 py-2 text-dark-muted font-mono text-xs">
                    {startClock} → {endClock}
                    {endIdx > startIdx && <span className="ml-1 text-dark-muted/60">({(endIdx - startIdx) * BLOCK_MINS}m)</span>}
                  </td>
                  <td className="px-4 py-2">
                    {isCurrent ? <Badge variant="active">Driving</Badge>
                      : isDone ? <span className="flex items-center gap-1.5"><Badge variant="inactive">Done</Badge><DeviationBadge block={block as any} /></span>
                      : <Badge variant="info">Upcoming</Badge>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Race Detail View ──────────────────────────────────────────

function RaceDetail({
  raceId,
  onBack,
  drivers,
  allSessions,
  onRaceListRefresh,
}: {
  raceId: number;
  onBack: () => void;
  drivers: Driver[];
  allSessions: StintPlannerSession[];
  onRaceListRefresh: () => void;
}) {
  const toast = useToast();

  const [raceState, setRaceState] = useState<{ race: Race; state: RaceState | null; last_fuel: RaceEvent | null } | null>(null);
  const [events, setEvents]       = useState<RaceEvent[]>([]);
  const [roster, setRoster]       = useState<StintRosterEntry[]>([]);
  const [stintPlan, setStintPlan] = useState<RaceStintPlan | null>(null);
  const [laps, setLaps]           = useState<RaceLap[]>([]);

  const [driverChangeOpen, setDriverChangeOpen] = useState(false);
  const [fuelUpdateOpen, setFuelUpdateOpen]     = useState(false);
  const [planPickerOpen, setPlanPickerOpen]     = useState(false);
  const [driverChangeName, setDriverChangeName] = useState('');
  const [fuelLevel, setFuelLevel]   = useState('');
  const [fuelPct, setFuelPct]       = useState('');
  const [minsRemaining, setMinsRemaining] = useState('');
  const [pickedSessionId, setPickedSessionId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    const [stateData, eventsData, rosterData] = await Promise.allSettled([
      racesApi.state(raceId),
      racesApi.events(raceId),
      racesApi.getRoster(raceId),
    ]);
    if (stateData.status === 'fulfilled')  setRaceState(stateData.value);
    if (eventsData.status === 'fulfilled') setEvents(eventsData.value);
    if (rosterData.status === 'fulfilled') setRoster(rosterData.value);

    try {
      setStintPlan(await racesApi.getStintPlan(raceId));
    } catch (e) { console.error('[StintPlan]', e); }
    try {
      setLaps(await racesApi.laps(raceId));
    } catch (e) { /* not critical */ }
  }, [raceId]);

  useEffect(() => {
    loadData();
    const iv = setInterval(loadData, 5000);
    return () => clearInterval(iv);
  }, [loadData]);

  const race = raceState?.race;

  const handleStartRace = async () => {
    try {
      await racesApi.start(raceId);
      await loadData(); onRaceListRefresh();
      toast('Race started!', 'success');
    } catch (e: any) { toast(e.message, 'error'); }
  };
  const handleEndRace = async () => {
    try {
      await racesApi.end(raceId);
      await loadData(); onRaceListRefresh();
      toast('Race ended', 'info');
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const handleLinkPlan = async () => {
    setSubmitting(true);
    try {
      const sid = pickedSessionId ? parseInt(pickedSessionId) : null;
      await racesApi.linkStintPlan(raceId, sid);
      await loadData();
      setPlanPickerOpen(false);
      toast(sid ? 'Stint plan linked' : 'Stint plan removed', 'success');
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSubmitting(false); }
  };

  const handleDriverChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await racesApi.postEvent(raceId, { event_type: 'driver_change', driver_name: driverChangeName });
      setDriverChangeOpen(false);
      setDriverChangeName('');
      await loadData(); onRaceListRefresh();
      toast('Driver change logged', 'success');
      if (result.stintPlanInfo) {
        const { isSameDriver, deviationMins, plannedDurationMins } = result.stintPlanInfo;
        if (isSameDriver) toast(`Boxed early and back out — schedule updated (+${plannedDurationMins ?? 0}m)`, 'info');
        else if (deviationMins !== null) {
          const abs = Math.abs(deviationMins);
          if (abs <= 2) toast('Stint plan: on schedule ✓', 'success');
          else if (deviationMins > 0) toast(`Stint plan: ${abs}m early`, 'success');
          else toast(`Stint plan: ${abs}m late`, 'error');
        }
      }
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSubmitting(false); }
  };

  const handleFuelUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await racesApi.postEvent(raceId, {
        event_type: 'fuel_update',
        fuel_level: parseFloat(fuelLevel),
        fuel_pct: fuelPct ? parseFloat(fuelPct) : undefined,
        mins_remaining: minsRemaining ? parseFloat(minsRemaining) : undefined,
      });
      setFuelUpdateOpen(false);
      setFuelLevel(''); setFuelPct(''); setMinsRemaining('');
      await loadData();
      toast('Fuel update logged', 'success');
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSubmitting(false); }
  };

  const handleSaveRoster = async (newRoster: { driver_user_id: number; stint_order: number; planned_duration_mins?: number }[]) => {
    try {
      await racesApi.saveRoster(raceId, newRoster);
      await loadData();
      toast('Roster saved', 'success');
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const addDriverToRoster = () => {
    if (!drivers.length) return;
    handleSaveRoster([
      ...roster.map(r => ({ driver_user_id: r.driver_user_id, stint_order: r.stint_order, planned_duration_mins: r.planned_duration_mins })),
      { driver_user_id: drivers[0].id, stint_order: roster.length + 1 },
    ]);
  };
  const removeFromRoster = (idx: number) =>
    handleSaveRoster(roster.filter((_, i) => i !== idx).map((r, i) => ({ driver_user_id: r.driver_user_id, stint_order: i + 1, planned_duration_mins: r.planned_duration_mins })));
  const updateRosterDriver = (idx: number, driver_user_id: number) =>
    handleSaveRoster(roster.map((r, i) => ({ driver_user_id: i === idx ? driver_user_id : r.driver_user_id, stint_order: r.stint_order, planned_duration_mins: r.planned_duration_mins })));

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={onBack} className="text-dark-muted hover:text-white transition-colors flex items-center gap-1.5 text-sm">
          ← All Races
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="font-heading font-bold text-2xl text-white">{race?.name ?? '…'}</h1>
            {race && <Badge variant={race.is_active ? 'active' : 'inactive'}>{race.is_active ? 'LIVE' : 'Inactive'}</Badge>}
            {race?.track && <span className="text-dark-muted text-sm">{race.track}</span>}
          </div>
        </div>
        {race && (
          !race.is_active
            ? <Button size="sm" onClick={handleStartRace}>Start Race</Button>
            : <Button size="sm" variant="danger" onClick={handleEndRace}>End Race</Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Status + Plan + Roster */}
        <div className="lg:col-span-2 flex flex-col gap-6">

          {/* Live Status */}
          <Card header="Live Status">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-dark-muted text-xs mb-1">Current Driver</p>
                <p className="text-white font-semibold text-lg">{raceState?.state?.current_driver_name ?? '—'}</p>
              </div>
              <div>
                <p className="text-dark-muted text-xs mb-1">Last Fuel Level</p>
                <p className="text-white font-semibold text-lg">
                  {raceState?.last_fuel?.fuel_level != null ? `${raceState.last_fuel.fuel_level.toFixed(1)}L` : '—'}
                </p>
                {raceState?.last_fuel?.fuel_pct != null && (
                  <div className="mt-1 h-2 bg-dark-border rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${raceState.last_fuel.fuel_pct > 30 ? 'bg-green-500' : raceState.last_fuel.fuel_pct > 15 ? 'bg-yellow-500' : 'bg-red-500'}`}
                      style={{ width: `${raceState.last_fuel.fuel_pct}%` }} />
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              <Button size="sm" variant="secondary" onClick={() => setDriverChangeOpen(true)}>Log Driver Change</Button>
              <Button size="sm" variant="secondary" onClick={() => setFuelUpdateOpen(true)}>Log Fuel Update</Button>
            </div>
          </Card>

          {/* Standings */}
          {race?.is_active && raceState && (
            <Card
              padding={false}
              header={<span className="font-heading font-semibold text-white">Live Standings</span>}
            >
              <StandingsPanel state={raceState.state ?? ({} as RaceState)} />
            </Card>
          )}

          {/* Live Telemetry */}
          {race?.is_active && (
            <Card
              padding={true}
              header={<span className="font-heading font-semibold text-white">Live Telemetry</span>}
            >
              <TelemetryPanel />
            </Card>
          )}

          {/* Stint Plan */}
          <Card
            padding={false}
            header={
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <span className="font-heading font-semibold text-white">Stint Plan</span>
                  {stintPlan?.session && <span className="text-dark-muted text-sm">— {stintPlan.session.name}</span>}
                  {stintPlan?.session && (
                    <Badge variant="active">
                      Stint {(stintPlan.current_index ?? 0) + 1}/{Array.isArray(stintPlan.session.plan) ? stintPlan.session.plan.length : '?'}
                    </Badge>
                  )}
                </div>
                <Button size="sm" variant="secondary" disabled={allSessions.length === 0} onClick={() => {
                  setPickedSessionId(stintPlan?.session?.id?.toString() ?? '');
                  setPlanPickerOpen(true);
                }}>
                  {stintPlan?.session ? 'Change Plan' : 'Link Plan'}
                </Button>
              </div>
            }
          >
            {stintPlan?.session
              ? <StintPlanPanel plan={stintPlan} raceStartedAt={race?.started_at ?? null} />
              : <p className="text-dark-muted text-sm p-6">No stint plan linked. Click "Link Plan" to attach one from the stint planner.</p>}
          </Card>

          {/* Stint Roster */}
          <Card
            padding={false}
            header={
              <div className="flex items-center justify-between w-full">
                <span className="font-heading font-semibold text-white">Stint Roster</span>
                <Button size="sm" variant="secondary" onClick={addDriverToRoster}>+ Add Driver</Button>
              </div>
            }
          >
            {roster.length === 0
              ? <p className="text-dark-muted text-sm p-6">No drivers in roster.</p>
              : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-dark-border">
                      <th className="text-left px-4 py-2 text-dark-muted text-xs">#</th>
                      <th className="text-left px-4 py-2 text-dark-muted text-xs">Driver</th>
                      <th className="text-left px-4 py-2 text-dark-muted text-xs">Duration (min)</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((entry, idx) => (
                      <tr key={entry.id} className="border-b border-dark-border last:border-0 hover:bg-white/2">
                        <td className="px-4 py-2 text-dark-muted text-sm">{entry.stint_order}</td>
                        <td className="px-4 py-2">
                          <select value={entry.driver_user_id} onChange={e => updateRosterDriver(idx, Number(e.target.value))}
                            className="bg-dark border border-dark-border rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-primary">
                            {drivers.map(d => <option key={d.id} value={d.id}>{d.iracing_name || d.username}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-2 text-dark-muted text-sm">{entry.planned_duration_mins ?? '—'}</td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => removeFromRoster(idx)} className="text-red-400 hover:text-red-300 text-sm">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </Card>
        </div>

        {/* Right: Event Log + Lap Times */}
        <div className="flex flex-col gap-6">
          <Card header="Event Log" padding={false}>
            {events.length === 0
              ? <p className="text-dark-muted text-sm p-4">No events yet</p>
              : (
                <div className="max-h-[600px] overflow-y-auto divide-y divide-dark-border">
                  {events.map(ev => (
                    <div key={ev.id} className="px-4 py-3 hover:bg-white/2">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs">{ev.event_type === 'driver_change' ? '🏎️' : '⛽'}</span>
                        <span className="text-white text-sm font-semibold">
                          {ev.event_type === 'driver_change'
                            ? ev.driver_name
                            : `${ev.fuel_level?.toFixed(1)}L${ev.fuel_pct ? ` (${ev.fuel_pct.toFixed(0)}%)` : ''}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-dark-muted">
                        <span>{formatTime(ev.created_at)}</span>
                        {ev.reporter_username && <span>· {ev.reporter_username}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </Card>

          <Card header={`Lap Times${laps.length ? ` (${laps.length})` : ''}`} padding={false}>
            {laps.length === 0
              ? <p className="text-dark-muted text-sm p-4">No laps recorded yet</p>
              : (() => {
                  const best = Math.min(...laps.map(l => l.lap_time));
                  return (
                    <div className="max-h-[400px] overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-dark-card">
                          <tr className="border-b border-dark-border">
                            <th className="text-left px-3 py-2 text-dark-muted text-xs">Lap</th>
                            <th className="text-left px-3 py-2 text-dark-muted text-xs">Driver</th>
                            <th className="text-right px-3 py-2 text-dark-muted text-xs">Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...laps].reverse().map((lap, i) => {
                            const isBest = lap.lap_time === best;
                            return (
                              <tr key={i} className="border-b border-dark-border last:border-0 hover:bg-white/2">
                                <td className="px-3 py-2 text-dark-muted">{lap.lap_number ?? '—'}</td>
                                <td className="px-3 py-2 text-white text-xs truncate max-w-[100px]">{lap.driver_name ?? '—'}</td>
                                <td className={`px-3 py-2 text-right font-mono text-xs font-semibold ${isBest ? 'text-purple-400' : 'text-white'}`}>
                                  {formatLapTime(lap.lap_time)}
                                  {isBest && <span className="ml-1 text-purple-500 text-[10px]">▲</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()
            }
          </Card>
        </div>
      </div>

      {/* Modals */}
      <Modal open={planPickerOpen} onClose={() => setPlanPickerOpen(false)} title="Link Stint Plan">
        <div className="flex flex-col gap-4">
          <p className="text-dark-muted text-sm">Select a stint planner session. Driver changes will automatically advance the plan and update Discord.</p>
          <Select label="Stint Plan Session" value={pickedSessionId} onChange={e => setPickedSessionId(e.target.value)}>
            <option value="">— No plan (remove link) —</option>
            {allSessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <div className="flex gap-2">
            <Button onClick={handleLinkPlan} loading={submitting} className="flex-1 justify-center">
              {pickedSessionId ? 'Link Plan' : 'Remove Link'}
            </Button>
            <Button variant="secondary" onClick={() => setPlanPickerOpen(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>

      <Modal open={driverChangeOpen} onClose={() => setDriverChangeOpen(false)} title="Log Driver Change">
        <form onSubmit={handleDriverChange} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm text-dark-muted mb-1">New Driver</label>
            <select value={driverChangeName} onChange={e => setDriverChangeName(e.target.value)} required
              className="w-full bg-dark border border-dark-border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-primary">
              <option value="">Select driver…</option>
              {drivers.map(d => {
                const name = d.iracing_name || d.username;
                return <option key={d.id} value={name}>{name}</option>;
              })}
              <option value="__manual__">— Type manually —</option>
            </select>
          </div>
          {driverChangeName === '__manual__' && (
            <Input label="Driver name" value={''} onChange={e => setDriverChangeName(e.target.value)} autoFocus placeholder="iRacing name" />
          )}
          {stintPlan?.session && (
            <p className="text-xs text-[#0066cc] bg-[#0066cc]/10 rounded px-3 py-2">
              Stint plan active — will advance automatically.
            </p>
          )}
          <Button type="submit" loading={submitting} disabled={!driverChangeName || driverChangeName === '__manual__'} className="w-full justify-center">
            Log Change
          </Button>
        </form>
      </Modal>

      <Modal open={fuelUpdateOpen} onClose={() => setFuelUpdateOpen(false)} title="Log Fuel Update">
        <form onSubmit={handleFuelUpdate} className="flex flex-col gap-4">
          <Input label="Fuel Level (L)" type="number" step="0.1" value={fuelLevel} onChange={e => setFuelLevel(e.target.value)} required autoFocus />
          <Input label="Fuel % (optional)" type="number" step="0.1" value={fuelPct} onChange={e => setFuelPct(e.target.value)} />
          <Input label="Mins Remaining (optional)" type="number" step="1" value={minsRemaining} onChange={e => setMinsRemaining(e.target.value)} />
          <Button type="submit" loading={submitting} className="w-full justify-center">Log Update</Button>
        </form>
      </Modal>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────

export default function RacePage() {
  const toast = useToast();

  const [raceList, setRaceList]         = useState<Race[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState<number | null>(null);
  const [drivers, setDrivers]           = useState<Driver[]>([]);
  const [allSessions, setAllSessions]   = useState<StintPlannerSession[]>([]);
  const [createRaceOpen, setCreateRaceOpen] = useState(false);
  const [newRaceName, setNewRaceName]   = useState('');
  const [newRaceTrack, setNewRaceTrack] = useState('');
  const [submitting, setSubmitting]     = useState(false);

  const loadRaces = useCallback(async () => {
    try {
      const list = await racesApi.list();
      setRaceList(list);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    loadRaces();
    teamApi.drivers().then(setDrivers).catch(console.error);
    stintPlanner.list().then(setAllSessions).catch(console.error);
    // Refresh race list every 10s to update current driver on cards
    const iv = setInterval(loadRaces, 10000);
    return () => clearInterval(iv);
  }, [loadRaces]);

  const handleCreateRace = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const race = await racesApi.create(newRaceName, newRaceTrack || undefined);
      setRaceList(prev => [race, ...prev]);
      setCreateRaceOpen(false);
      setNewRaceName(''); setNewRaceTrack('');
      toast('Race created', 'success');
      setSelectedRaceId(race.id); // go straight into the new race
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSubmitting(false); }
  };

  // ── Detail view ──────────────────────────────────────────────
  if (selectedRaceId !== null) {
    return (
      <RaceDetail
        raceId={selectedRaceId}
        onBack={() => { setSelectedRaceId(null); loadRaces(); }}
        drivers={drivers}
        allSessions={allSessions}
        onRaceListRefresh={loadRaces}
      />
    );
  }

  // ── Grid view ────────────────────────────────────────────────
  const liveRaces     = raceList.filter(r => r.is_active);
  const inactiveRaces = raceList.filter(r => !r.is_active);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading font-bold text-2xl text-white">Live Race Tracker</h1>
          <p className="text-dark-muted text-sm">Real-time monitoring for endurance races</p>
        </div>
        <Button onClick={() => setCreateRaceOpen(true)} variant="secondary" size="sm">+ New Race</Button>
      </div>

      {raceList.length === 0 ? (
        <div className="text-center py-24 text-dark-muted">
          <p className="text-5xl mb-4">🏁</p>
          <p className="font-heading font-semibold text-white text-lg mb-2">No races yet</p>
          <p className="mb-6">Create your first race to get started</p>
          <Button onClick={() => setCreateRaceOpen(true)}>Create Race</Button>
        </div>
      ) : (
        <>
          {liveRaces.length > 0 && (
            <div className="mb-8">
              <h2 className="font-heading font-semibold text-white text-sm uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />
                Live
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {liveRaces.map(r => <RaceCard key={r.id} race={r} onClick={() => setSelectedRaceId(r.id)} />)}
              </div>
            </div>
          )}

          {inactiveRaces.length > 0 && (
            <div>
              <h2 className="font-heading font-semibold text-dark-muted text-sm uppercase tracking-wider mb-3">Past Races</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {inactiveRaces.map(r => <RaceCard key={r.id} race={r} onClick={() => setSelectedRaceId(r.id)} />)}
              </div>
            </div>
          )}
        </>
      )}

      <Modal open={createRaceOpen} onClose={() => setCreateRaceOpen(false)} title="Create Race">
        <form onSubmit={handleCreateRace} className="flex flex-col gap-4">
          <Input label="Race Name" value={newRaceName} onChange={e => setNewRaceName(e.target.value)} required autoFocus placeholder="e.g. Spa 6 Hours" />
          <Input label="Track (optional)" value={newRaceTrack} onChange={e => setNewRaceTrack(e.target.value)} placeholder="e.g. Spa-Francorchamps" />
          <Button type="submit" loading={submitting} className="w-full justify-center">Create</Button>
        </form>
      </Modal>
    </div>
  );
}
