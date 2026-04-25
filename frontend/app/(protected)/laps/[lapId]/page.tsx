'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { telemetry as telApi } from '@/lib/api';
import type { LiveFrame, LapFeatures, LapChannels } from '@/lib/types';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

// ── Types ─────────────────────────────────────────────────────────

type LapMeta = { id: number; lap_number: number; lap_time: number; track: string; car: string };
type Tab = 'overview' | 'traces' | 'ai';

// ── Formatters ───────────────────────────────────────────────────

function fmtLapTime(secs: number | null | undefined): string {
  if (!secs || secs <= 0) return '—';
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(3).padStart(6, '0');
  return `${m}:${s}`;
}

function fmt(v: number | null | undefined, decimals = 1, unit = ''): string {
  if (v == null) return '—';
  return `${Number(v).toFixed(decimals)}${unit}`;
}

// ── Canvas chart ──────────────────────────────────────────────────

function drawSeries(
  canvas: HTMLCanvasElement | null,
  series: Array<{ values: (number | null)[]; color: string }>,
  xValues: (number | null)[],
  yMin: number,
  yMax: number,
  zeroline = false
) {
  if (!canvas || !series.length) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth * dpr;
  const ch = canvas.clientHeight * dpr;
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  ctx.clearRect(0, 0, cw, ch);

  const n = series[0].values.length;
  if (n < 2) return;
  const yRange = (yMax - yMin) || 1;

  // Determine x range
  const validX = xValues.filter(v => v != null) as number[];
  const xMin = validX.length ? Math.min(...validX) : 0;
  const xMax = validX.length ? Math.max(...validX) : 1;
  const xRange = (xMax - xMin) || 1;
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
      const xv = xValues[i];
      if (v == null || xv == null) { moved = false; continue; }
      const x = ((xv - xMin) / xRange) * cw;
      const y = ch - ((v - yMin) / yRange) * (ch - pad * 2) - pad;
      if (!moved) { ctx.moveTo(x, y); moved = true; } else { ctx.lineTo(x, y); }
    }
    ctx.strokeStyle = s.color; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
    ctx.lineTo(cw, ch); ctx.lineTo(0, ch); ctx.closePath();
    const m = s.color.match(/[\d.]+/g) ?? ['100', '170', '255'];
    ctx.fillStyle = `rgba(${m[0]},${m[1]},${m[2]},0.10)`; ctx.fill();
  }
}

// ── Chart panel ───────────────────────────────────────────────────

function ChartPanel({ label, canvasRef, height = 100, children }: {
  label: string; canvasRef: React.RefObject<HTMLCanvasElement>; height?: number; children?: React.ReactNode;
}) {
  return (
    <div className="bg-dark-card rounded-xl border border-dark-border p-4">
      <div className="flex justify-between items-center mb-3">
        <span className="text-xs text-dark-muted font-body uppercase tracking-widest">{label}</span>
        {children}
      </div>
      <canvas ref={canvasRef} className="w-full block rounded bg-[#080d18]" style={{ height }} />
    </div>
  );
}

// ── Feature stat card ─────────────────────────────────────────────

function FeatureStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[#0a0f1c] rounded-lg p-3">
      <p className="text-dark-muted text-xs mb-1 font-body uppercase tracking-widest">{label}</p>
      <p className="text-white font-bold text-xl font-heading">{value}</p>
      {sub && <p className="text-dark-muted text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Smoothness bar ────────────────────────────────────────────────

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;
  const pct = Math.max(0, Math.min(100, value));
  const color = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div>
      <div className="flex justify-between text-xs text-dark-muted mb-1">
        <span>{label}</span><span className="text-white font-semibold">{pct.toFixed(1)}</span>
      </div>
      <div className="h-2 rounded-full bg-dark-border overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────

export default function LapDetailPage() {
  const { lapId } = useParams<{ lapId: string }>();
  const lid = parseInt(lapId ?? '0');

  const [tab, setTab] = useState<Tab>('overview');
  const [lapMeta, setLapMeta]   = useState<LapMeta | null>(null);
  const [frames, setFrames]     = useState<LiveFrame[]>([]);
  const [features, setFeatures] = useState<LapFeatures | null>(null);
  const [channels, setChannels] = useState<LapChannels | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  // Canvas refs
  const cvSpeed = useRef<HTMLCanvasElement>(null);
  const cvTB    = useRef<HTMLCanvasElement>(null);
  const cvSteer = useRef<HTMLCanvasElement>(null);

  // Load data on mount
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [telResult, chResult] = await Promise.allSettled([
          telApi.lapTelemetry(lid),
          telApi.lapChannels(lid),
        ]);

        if (telResult.status === 'fulfilled') {
          setLapMeta(telResult.value.lap);
          // Normalise frames: may come from telemetry_frames or IBT fallback
          const raw = telResult.value.telemetry;
          if (Array.isArray(raw)) {
            setFrames(raw.map((f: any) => ({
              session_time:  Number(f.session_time ?? f.time ?? 0),
              lap_number:    f.lap_number ?? f.lap ?? null,
              lap_dist_pct:  f.lap_dist_pct ?? f.distPct ?? null,
              speed_kph:     f.speed_kph ?? (f.speed != null ? f.speed : null),
              throttle:      f.throttle != null ? Number(f.throttle) / (f.throttle > 1 ? 100 : 1) : null,
              brake:         f.brake    != null ? Number(f.brake)    / (f.brake > 1    ? 100 : 1) : null,
              steering_deg:  f.steering_deg ?? (f.steering != null ? f.steering * (180 / Math.PI) : null),
              gear:          f.gear ?? null,
              rpm:           f.rpm ?? null,
            })));
          }
        } else {
          setError('Could not load telemetry for this lap');
        }

        if (chResult.status === 'fulfilled') setChannels(chResult.value);

        // Try features — may 404 if not computed
        try {
          const { features: f } = await telApi.lapFeatures(lid);
          setFeatures(f);
        } catch { /* not available */ }

      } catch (e: any) {
        setError(e.message ?? 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [lid]);

  // Redraw charts when frames change or tab switches to traces
  const redrawCharts = useCallback(() => {
    if (!frames.length) return;
    // Use lap_dist_pct when available, fall back to session_time
    const hasDistPct = frames.some(f => f.lap_dist_pct != null);
    const xVals = frames.map(f => hasDistPct ? f.lap_dist_pct : f.session_time);

    drawSeries(cvSpeed.current, [{ values: frames.map(f => f.speed_kph), color: 'rgb(0,170,255)' }], xVals, 0, 350);
    drawSeries(cvTB.current, [
      { values: frames.map(f => f.throttle),                           color: 'rgb(0,210,100)' },
      { values: frames.map(f => f.brake != null ? -f.brake : null),   color: 'rgb(255,60,60)' },
    ], xVals, -1, 1);
    drawSeries(cvSteer.current, [{ values: frames.map(f => f.steering_deg), color: 'rgb(255,170,0)' }], xVals, -180, 180, true);
  }, [frames]);

  useEffect(() => {
    if (tab === 'traces') {
      // Give canvas a frame to mount before drawing
      setTimeout(redrawCharts, 50);
    }
  }, [tab, redrawCharts]);

  // Also redraw on resize
  useEffect(() => {
    if (tab !== 'traces') return;
    const handler = () => redrawCharts();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [tab, redrawCharts]);

  if (loading) {
    return <div className="text-dark-muted py-24 text-center">Loading lap data…</div>;
  }
  if (error) {
    return (
      <div className="text-center py-24">
        <p className="text-red-400 mb-4">{error}</p>
        <Link href="/laps" className="text-[#0066cc] hover:underline text-sm">← Back to Laps</Link>
      </div>
    );
  }

  const hasDistPct = frames.some(f => f.lap_dist_pct != null);
  const xAxisLabel = hasDistPct ? 'Lap distance %' : 'Session time (s)';

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/laps" className="text-dark-muted hover:text-white transition-colors text-sm">
          ← Laps
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-heading font-bold text-2xl text-white">
              {lapMeta?.track ?? 'Lap Detail'}
            </h1>
            {lapMeta?.lap_number != null && (
              <Badge variant="info">Lap {lapMeta.lap_number}</Badge>
            )}
          </div>
          <p className="text-dark-muted text-sm mt-0.5">
            {lapMeta?.car}{lapMeta?.lap_time ? ` · ${fmtLapTime(lapMeta.lap_time)}` : ''}
            {channels?.source && (
              <span className="ml-2 text-dark-muted/60">({channels.source})</span>
            )}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-dark-border">
        {(['overview', 'traces', 'ai'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-body font-semibold capitalize rounded-t transition-colors -mb-px border-b-2 ${
              tab === t
                ? 'text-[#00aaff] border-[#00aaff]'
                : 'text-dark-muted border-transparent hover:text-white'
            }`}
          >
            {t === 'ai' ? 'AI Notes' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Overview tab ── */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {/* Time summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <FeatureStat label="Lap Time"  value={fmtLapTime(lapMeta?.lap_time)} />
            <FeatureStat label="Avg Speed" value={fmt(features?.avg_speed_kph, 1, ' kph')} />
            <FeatureStat label="Top Speed" value={fmt(features?.max_speed_kph, 1, ' kph')} />
            <FeatureStat label="Frames"    value={channels?.frame_count?.toLocaleString() ?? (frames.length > 0 ? frames.length.toLocaleString() : '—')} sub={channels?.sample_rate_hz ? `${channels.sample_rate_hz} Hz` : undefined} />
          </div>

          {/* Inputs summary */}
          <Card header="Driver Inputs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <FeatureStat label="Full Throttle" value={fmt(features?.throttle_full_pct, 1, '%')} />
              <FeatureStat label="Peak Brake"    value={fmt(features?.brake_peak ? features.brake_peak * 100 : null, 0, '%')} />
              <FeatureStat label="Brake Zones"   value={features?.brake_zone_count != null ? String(features.brake_zone_count) : '—'} />
              <FeatureStat label="Lift Count"    value={features?.lift_count != null ? String(features.lift_count) : '—'} />
            </div>
          </Card>

          {/* Scores */}
          {(features?.smoothness_score != null || features?.consistency_score != null) && (
            <Card header="Scores">
              <div className="space-y-4">
                <ScoreBar label="Smoothness" value={features.smoothness_score} />
                <ScoreBar label="Consistency" value={features.consistency_score} />
              </div>
            </Card>
          )}

          {/* Channels available */}
          {channels && (
            <Card header="Available Channels">
              <div className="flex flex-wrap gap-2">
                {channels.channels.map(ch => (
                  <span key={ch.name} className="text-xs bg-[#0a0f1c] border border-dark-border rounded px-2 py-1 text-[#8892a4] font-mono">
                    {ch.name}
                    {ch.min != null && ch.max != null && (
                      <span className="text-dark-muted/60 ml-1">[{Number(ch.min).toFixed(0)}–{Number(ch.max).toFixed(0)}]</span>
                    )}
                  </span>
                ))}
              </div>
              <p className="text-dark-muted text-xs mt-3">
                X axis: {xAxisLabel} · {channels.frame_count} frames · {channels.duration_s?.toFixed(1)}s
              </p>
            </Card>
          )}

          {!features && (
            <p className="text-dark-muted text-sm text-center py-4">
              Features not yet computed — complete a live lap or re-upload the file.
            </p>
          )}
        </div>
      )}

      {/* ── Traces tab ── */}
      {tab === 'traces' && (
        <div className="space-y-4">
          {frames.length === 0 ? (
            <div className="text-dark-muted text-sm text-center py-16">
              No frame data available for this lap.
            </div>
          ) : (
            <>
              <p className="text-dark-muted text-xs">
                X axis: {xAxisLabel} · {frames.length} samples
              </p>

              <ChartPanel label="Speed (kph)" canvasRef={cvSpeed} height={120}>
                <span className="text-xs text-[#00aaff] font-mono">
                  {fmt(features?.max_speed_kph, 0)} kph max
                </span>
              </ChartPanel>

              <ChartPanel label="Throttle (green) / Brake (red)" canvasRef={cvTB} height={100}>
                <span className="text-xs text-dark-muted">
                  {fmt(features?.throttle_full_pct, 1)}% full throttle
                </span>
              </ChartPanel>

              <ChartPanel label="Steering (deg)" canvasRef={cvSteer} height={100}>
                <span className="text-xs text-yellow-400">
                  {fmt(features?.steering_variance != null ? Math.sqrt(features.steering_variance) : null, 1, '° σ')}
                </span>
              </ChartPanel>
            </>
          )}
        </div>
      )}

      {/* ── AI tab ── */}
      {tab === 'ai' && (
        <div className="text-center py-16 text-dark-muted">
          <p className="text-4xl mb-4">🤖</p>
          <p className="font-heading font-semibold text-white text-lg mb-2">AI coaching coming soon</p>
          <p className="text-sm">Use the Coaching page to compare laps with AI analysis.</p>
          <Link href="/coaching" className="mt-4 inline-block text-[#0066cc] hover:underline text-sm">
            Go to Coaching →
          </Link>
        </div>
      )}
    </div>
  );
}
