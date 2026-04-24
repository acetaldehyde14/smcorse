'use client'

import { useEffect, useCallback } from 'react'
import { useTelemetryCursor, useActiveLdp } from '@/store/telemetry-cursor'
import { findByLdp, type TelemetryPoint } from '@/lib/telemetry'
import TrackMap from './TrackMap'
import TelemetryTrace from './TelemetryTrace'

type Props = {
  points: TelemetryPoint[]
}

function fmt(v: number | undefined, dec = 1, unit = ''): string {
  if (v == null) return '—'
  return `${v.toFixed(dec)}${unit}`
}

export default function LapTraceViewer({ points }: Props) {
  const { clear } = useTelemetryCursor()
  const isLocked  = useTelemetryCursor(s => s.lockedLdp != null)
  const activeLdp = useActiveLdp()
  const selected  = activeLdp != null ? findByLdp(points, activeLdp) : null

  const hasXY = points.some(p => p.x != null && p.y != null)

  // Escape key clears lock
  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') clear()
  }, [clear])

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  // Clear cursor state on unmount
  useEffect(() => () => clear(), [clear])

  if (!points.length) {
    return (
      <div className="text-dark-muted text-sm text-center py-16">
        No frame data available for this lap.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Top row: track map + stats */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Track map */}
        <div className="bg-dark-card border border-dark-border rounded-xl overflow-hidden" style={{ height: 320 }}>
          <div className="px-4 pt-3 pb-1">
            <span className="text-xs text-dark-muted font-body uppercase tracking-widest">Track Map</span>
          </div>
          <div style={{ height: 278 }}>
            <TrackMap points={points} />
          </div>
        </div>

        {/* Stats at cursor */}
        <div className="bg-dark-card border border-dark-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs text-dark-muted font-body uppercase tracking-widest">
              {isLocked ? 'Locked position' : activeLdp != null ? 'Hover position' : 'Cursor stats'}
            </span>
            {isLocked && (
              <button
                onClick={clear}
                className="text-xs text-dark-muted hover:text-white transition-colors"
              >
                Unlock (Esc)
              </button>
            )}
          </div>

          {selected ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatCell label="Lap Position" value={`${((selected.ldp) * 100).toFixed(1)}%`} />
              <StatCell label="Speed" value={fmt(selected.spd, 1, ' km/h')} color="#00aaff" />
              <StatCell label="Throttle" value={fmt(selected.thr != null ? selected.thr * 100 : undefined, 0, '%')} color="#22c55e" />
              <StatCell label="Brake" value={fmt(selected.brk != null ? selected.brk * 100 : undefined, 0, '%')} color="#ef4444" />
              <StatCell label="Steering" value={fmt(selected.steer, 1, '°')} color="#f59e0b" />
              <StatCell label="Gear" value={selected.gear != null ? `G${selected.gear}` : '—'} />
              <StatCell label="RPM" value={fmt(selected.rpm, 0)} />
              <StatCell label="Lat G" value={fmt(selected.lat, 2, 'g')} />
              <StatCell label="Lon G" value={fmt(selected.lon, 2, 'g')} />
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-dark-muted text-sm">
              Hover over any chart or the track map
            </div>
          )}
        </div>
      </div>

      {/* Traces */}
      <TelemetryTrace
        points={points}
        label="Speed"
        height={110}
        yMin={0}
        series={[{ key: 'spd', color: '#00aaff', label: 'kph' }]}
      />

      <TelemetryTrace
        points={points}
        label="Throttle / Brake"
        height={90}
        yMin={0}
        yMax={1}
        series={[
          { key: 'thr', color: '#22c55e', label: 'Thr', fillOpacity: 0.18 },
          { key: 'brk', color: '#ef4444', label: 'Brk', fillOpacity: 0.18 },
        ]}
      />

      <TelemetryTrace
        points={points}
        label="Steering"
        height={80}
        zeroline
        series={[{ key: 'steer', color: '#f59e0b', label: 'deg' }]}
      />

      <TelemetryTrace
        points={points}
        label="RPM / Gear"
        height={80}
        yMin={0}
        series={[
          { key: 'rpm',  color: '#a78bfa', label: 'RPM' },
          { key: 'gear', color: '#64748b', label: 'Gear' },
        ]}
      />

      <p className="text-dark-muted text-xs text-right">
        {points.length} samples · x-axis: lap distance %
        {!hasXY && ' · no track position data (XY)'}
      </p>
    </div>
  )
}

function StatCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-[#0a0f1c] rounded-lg p-3">
      <p className="text-dark-muted text-xs mb-1 font-body uppercase tracking-widest">{label}</p>
      <p className="font-bold text-lg font-heading" style={{ color: color ?? '#ffffff' }}>{value}</p>
    </div>
  )
}
