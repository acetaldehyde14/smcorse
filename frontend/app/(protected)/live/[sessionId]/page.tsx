'use client';

import { useRef, useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { telemetry as telApi } from '@/lib/api';
import type { LiveFrame, LiveSessionSummary } from '@/lib/types';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

// ── Constants ─────────────────────────────────────────────────────
const LIVE_WINDOW_S = 30;   // rolling buffer for live sessions
const POLL_FRAMES   = 500;  // ms between frame polls
const POLL_SUMMARY  = 3000;

// ── Canvas chart helper ───────────────────────────────────────────

function drawSeries(
  canvas: HTMLCanvasElement | null,
  series: Array<{ values: (number | null)[]; color: string }>,
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
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Chart panel component ─────────────────────────────────────────

function ChartPanel({
  label, value, unit = '',
  canvasRef, height = 80,
}: {
  label: string;
  value: string;
  unit?: string;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  height?: number;
}) {
  return (
    <div className="bg-dark-card rounded-xl border border-dark-border p-3">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs text-dark-muted font-body uppercase tracking-widest">{label}</span>
        <span className="text-sm font-semibold text-white font-body tabular-nums">
          {value}{unit && value !== '—' ? ` ${unit}` : ''}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="w-full block rounded bg-[#080d18]"
        style={{ height }}
      />
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────────

function StatCard({ label, value, color = 'text-white', large = false }: {
  label: string; value: string; color?: string; large?: boolean;
}) {
  return (
    <div className="bg-[#0a0f1c] rounded-lg p-3 text-center">
      <p className="text-dark-muted text-xs mb-1 font-body uppercase tracking-widest">{label}</p>
      <p className={`font-bold font-heading ${large ? 'text-3xl' : 'text-xl'} ${color}`}>{value}</p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────

export default function LiveSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const sid = parseInt(sessionId ?? '0');

  const [summary, setSummary]     = useState<LiveSessionSummary | null>(null);
  const [buffer, setBuffer]       = useState<LiveFrame[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'streaming' | 'done' | 'error'>('loading');

  const latestTimeRef    = useRef(0);
  const isOpenRef        = useRef<boolean | null>(null); // null = unknown
  const allFramesDoneRef = useRef(false);

  // Canvas refs
  const cvSpeed = useRef<HTMLCanvasElement>(null);
  const cvTB    = useRef<HTMLCanvasElement>(null);
  const cvSteer = useRef<HTMLCanvasElement>(null);

  // Poll summary — sets isOpenRef so frames polling can use it
  useEffect(() => {
    const poll = async () => {
      try {
        const s = await telApi.liveSummary(sid);
        setSummary(s);
        isOpenRef.current = s.status === 'open';
      } catch { /* session not found or offline */ }
    };
    poll();
    const iv = setInterval(poll, POLL_SUMMARY);
    return () => clearInterval(iv);
  }, [sid]);

  // Poll frames — adapts behaviour for live vs. past sessions
  useEffect(() => {
    allFramesDoneRef.current = false;
    latestTimeRef.current    = 0;
    setBuffer([]);
    setLoadState('loading');

    const poll = async () => {
      if (allFramesDoneRef.current) return;
      try {
        const { frames } = await telApi.liveFrames(sid, latestTimeRef.current, 500);

        if (!frames.length) {
          // No new frames. For ended sessions this means we have everything.
          if (isOpenRef.current === false) {
            allFramesDoneRef.current = true;
            setLoadState('done');
          }
          return;
        }

        setLoadState(isOpenRef.current === false ? 'loading' : 'streaming');
        latestTimeRef.current = Number(frames[frames.length - 1].session_time);

        const newFrames: LiveFrame[] = frames.map((f: any) => ({
          ...f,
          session_time: Number(f.session_time),
          speed_kph:    f.speed_kph    != null ? Number(f.speed_kph)    : null,
          throttle:     f.throttle     != null ? Number(f.throttle)     : null,
          brake:        f.brake        != null ? Number(f.brake)        : null,
          steering_deg: f.steering_deg != null ? Number(f.steering_deg) : null,
        }));

        setBuffer(prev => {
          const next = [...prev, ...newFrames];
          // For ended sessions, keep all frames; for live sessions, rolling window
          if (isOpenRef.current === false) return next;
          const cutoff = latestTimeRef.current - LIVE_WINDOW_S;
          return next.filter((f: LiveFrame) => f.session_time >= cutoff);
        });
      } catch {
        setLoadState('error');
      }
    };

    poll();
    // Use faster interval initially; slow down after first poll settles.
    // For simplicity, always use the faster live interval — React batching handles it.
    const iv = setInterval(poll, POLL_FRAMES);
    return () => clearInterval(iv);
  }, [sid]);

  // Redraw on buffer change
  useEffect(() => {
    if (!buffer.length) return;
    drawSeries(cvSpeed.current, [{ values: buffer.map(f => f.speed_kph), color: 'rgb(0,170,255)' }], 0, 300);
    drawSeries(cvTB.current, [
      { values: buffer.map(f => f.throttle),  color: 'rgb(0,210,100)' },
      { values: buffer.map(f => f.brake != null ? -f.brake : null), color: 'rgb(255,60,60)' },
    ], -1, 1);
    drawSeries(cvSteer.current, [{ values: buffer.map(f => f.steering_deg), color: 'rgb(255,170,0)' }], -180, 180, true);
  }, [buffer]);

  const latest = summary?.latest;
  const isOpen = summary?.status === 'open';

  const gearLabel = (g: number | null | undefined) =>
    g == null ? '—' : g === 0 ? 'N' : g === -1 ? 'R' : String(g);

  const statusDot = () => {
    if (loadState === 'streaming') return { cls: 'bg-green-400 animate-pulse', label: 'Live', color: 'text-green-400' };
    if (loadState === 'loading')   return { cls: 'bg-yellow-400 animate-pulse', label: 'Loading…', color: 'text-yellow-400' };
    if (loadState === 'done')      return { cls: 'bg-blue-400', label: `${buffer.length.toLocaleString()} frames`, color: 'text-blue-400' };
    return { cls: 'bg-dark-muted', label: 'Waiting…', color: 'text-dark-muted' };
  };
  const dot = statusDot();

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/live" className="text-dark-muted hover:text-white transition-colors text-sm flex items-center gap-1">
          ← Live Tracker
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-heading font-bold text-2xl text-white">
              {summary?.session.track_name ?? `Session ${sid}`}
            </h1>
            <Badge variant={isOpen ? 'active' : 'inactive'}>{isOpen ? 'LIVE' : 'Ended'}</Badge>
            <div className={`flex items-center gap-1.5 text-xs font-body ${dot.color}`}>
              <span className={`w-2 h-2 rounded-full ${dot.cls}`} />
              {dot.label}
            </div>
          </div>
          {summary?.session.car_name && (
            <p className="text-dark-muted text-sm mt-0.5">{summary.session.car_name}</p>
          )}
        </div>
      </div>

      {/* 2-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left — charts */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <ChartPanel
            label={isOpen ? 'Speed (last 30 s)' : 'Speed (full session)'}
            value={latest?.speed_kph != null ? Math.round(latest.speed_kph).toString() : '—'}
            unit="kph"
            canvasRef={cvSpeed}
            height={100}
          />
          <ChartPanel
            label="Throttle / Brake"
            value={latest?.throttle != null
              ? `${Math.round(latest.throttle * 100)}% / ${Math.round((latest.brake ?? 0) * 100)}%`
              : '—'}
            canvasRef={cvTB}
            height={80}
          />
          <ChartPanel
            label="Steering"
            value={buffer.length > 0
              ? `${(buffer[buffer.length - 1]?.steering_deg ?? 0).toFixed(1)}°`
              : '—'}
            canvasRef={cvSteer}
            height={80}
          />
        </div>

        {/* Right — info */}
        <div className="flex flex-col gap-4">

          {/* Current values */}
          <Card header="Latest">
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="Speed"    value={latest?.speed_kph != null ? `${Math.round(latest.speed_kph)} kph` : '—'} color="text-[#00aaff]" large />
              <StatCard label="Gear"     value={gearLabel(latest?.gear)} color="text-yellow-400" large />
              <StatCard label="RPM"      value={latest?.rpm != null ? `${Math.round(latest.rpm / 100) / 10}k` : '—'} />
              <StatCard label="Throttle" value={latest?.throttle != null ? `${Math.round(latest.throttle * 100)}%` : '—'} color="text-green-400" />
              <StatCard label="Brake"    value={latest?.brake != null ? `${Math.round(latest.brake * 100)}%` : '—'} color="text-red-400" />
              <StatCard label="Session"  value={fmtSessionTime(summary?.latest_session_time ?? null)} />
            </div>
          </Card>

          {/* Session status */}
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
              <div className="flex justify-between">
                <span className="text-dark-muted">Type</span>
                <span className="text-white capitalize">{summary?.session.ingest_mode ?? '—'}</span>
              </div>
            </div>
          </Card>

          {/* Lap times */}
          {(summary?.laps?.length ?? 0) > 0 && (
            <Card header={`Laps (${summary!.laps.length})`} padding={false}>
              <div className="max-h-64 overflow-y-auto divide-y divide-dark-border">
                {[...summary!.laps].reverse().map((lap, i) => {
                  const isBest = lap.lap_time === summary!.best_lap_time;
                  return (
                    <div key={i} className="flex items-center justify-between px-4 py-2 hover:bg-white/2">
                      <span className="text-dark-muted text-sm">Lap {lap.lap_number ?? '—'}</span>
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

          {loadState === 'error' && !summary && (
            <div className="text-center py-12 text-dark-muted">
              <p className="text-4xl mb-3">📡</p>
              <p className="font-heading font-semibold text-white">Session not found</p>
              <p className="text-sm mt-1">This session may have been deleted or you don't have access.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
