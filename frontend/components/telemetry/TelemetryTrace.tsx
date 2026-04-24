'use client'

import { useRef, useCallback, useMemo } from 'react'
import { useTelemetryCursor, useActiveLdp } from '@/store/telemetry-cursor'
import { findByLdp, type TelemetryPoint } from '@/lib/telemetry'

type Series = {
  key: keyof TelemetryPoint
  color: string
  label: string
  fillOpacity?: number
}

type Props = {
  points:   TelemetryPoint[]
  series:   Series[]
  yMin?:    number
  yMax?:    number
  height?:  number
  label:    string
  zeroline?: boolean
}

const PAD_L = 4
const PAD_R = 4
const PAD_T = 4
const PAD_B = 4

export default function TelemetryTrace({ points, series, yMin, yMax, height = 100, label, zeroline }: Props) {
  const svgRef  = useRef<SVGSVGElement>(null)
  const { setHoverLdp, toggleLock } = useTelemetryCursor()
  const activeLdp = useActiveLdp()
  const isLocked  = useTelemetryCursor(s => s.lockedLdp != null)

  // Compute y range from data if not provided
  const [yLo, yHi] = useMemo(() => {
    if (yMin != null && yMax != null) return [yMin, yMax]
    let lo = Infinity, hi = -Infinity
    for (const s of series) {
      for (const p of points) {
        const v = p[s.key] as number | undefined
        if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v }
      }
    }
    if (!isFinite(lo)) return [0, 1]
    const pad = (hi - lo) * 0.05 || 0.5
    return [lo - pad, hi + pad]
  }, [points, series, yMin, yMax])

  const yRange = yHi - yLo || 1

  // Build SVG polyline points string for each series
  // We use a 1000-unit wide SVG viewBox so ldp maps directly
  const VW = 1000
  const VH = height

  const toSX = (ldp: number) => PAD_L + ldp * (VW - PAD_L - PAD_R)
  const toSY = (v: number)   => PAD_T + (1 - (v - yLo) / yRange) * (VH - PAD_T - PAD_B)

  const polylines = useMemo(() => series.map(s => {
    const pts: string[] = []
    for (const p of points) {
      const v = p[s.key] as number | undefined
      if (v != null) pts.push(`${toSX(p.ldp).toFixed(1)},${toSY(v).toFixed(1)}`)
    }
    return { ...s, pts: pts.join(' ') }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [points, series, yLo, yHi])

  // Fill paths (area under curve)
  const fillPaths = useMemo(() => series.map(s => {
    if (!points.length) return { ...s, d: '' }
    let d = ''
    let started = false
    for (const p of points) {
      const v = p[s.key] as number | undefined
      if (v == null) { started = false; continue }
      if (!started) { d += `M ${toSX(p.ldp).toFixed(1)} ${toSY(v).toFixed(1)}`; started = true }
      else d += ` L ${toSX(p.ldp).toFixed(1)} ${toSY(v).toFixed(1)}`
    }
    if (started) {
      // Close to zero line or bottom
      const zeroY = zeroline ? toSY(0) : VH - PAD_B
      d += ` L ${toSX(1).toFixed(1)} ${zeroY.toFixed(1)} L ${toSX(0).toFixed(1)} ${zeroY.toFixed(1)} Z`
    }
    return { ...s, d }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [points, series, yLo, yHi, zeroline])

  // Cursor position
  const cursorX = activeLdp != null ? toSX(activeLdp) : null
  const selectedPoint = activeLdp != null ? findByLdp(points, activeLdp) : null

  // Mouse → ldp conversion
  const toLdp = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    const relX = (e.clientX - rect.left) / rect.width
    const ldp = Math.max(0, Math.min(1, (relX * VW - PAD_L) / (VW - PAD_L - PAD_R)))
    return ldp
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const ldp = toLdp(e)
    if (ldp != null) setHoverLdp(ldp)
  }, [toLdp, setHoverLdp])

  const onMouseLeave = useCallback(() => setHoverLdp(null), [setHoverLdp])

  const onClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const ldp = toLdp(e)
    if (ldp != null) toggleLock(ldp)
  }, [toLdp, toggleLock])

  return (
    <div className="bg-dark-card rounded-xl border border-dark-border overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-xs text-dark-muted font-body uppercase tracking-widest">{label}</span>
        <div className="flex gap-3">
          {series.map(s => (
            <span key={String(s.key)} className="text-xs font-semibold" style={{ color: s.color }}>
              {s.label}
              {selectedPoint && selectedPoint[s.key] != null && (
                <span className="text-white ml-1.5">
                  {Number(selectedPoint[s.key]).toFixed(s.key === 'rpm' ? 0 : s.key === 'gear' ? 0 : 1)}
                </span>
              )}
            </span>
          ))}
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VW} ${VH}`}
        className="w-full block cursor-crosshair"
        style={{ height }}
        preserveAspectRatio="none"
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
      >
        <rect width={VW} height={VH} fill="#080d18" />

        {/* Zero line */}
        {zeroline && yLo < 0 && yHi > 0 && (
          <line
            x1={PAD_L} y1={toSY(0)} x2={VW - PAD_R} y2={toSY(0)}
            stroke="rgba(255,255,255,0.08)" strokeWidth={1}
          />
        )}

        {/* Area fills */}
        {fillPaths.map(s => {
          if (!s.d) return null
          const [r, g, b] = parseRGB(s.color)
          return (
            <path
              key={`fill-${String(s.key)}`}
              d={s.d}
              fill={`rgba(${r},${g},${b},${s.fillOpacity ?? 0.12})`}
            />
          )
        })}

        {/* Traces */}
        {polylines.map(s => s.pts && (
          <polyline
            key={String(s.key)}
            points={s.pts}
            fill="none"
            stroke={s.color}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Cursor line */}
        {cursorX != null && (
          <line
            x1={cursorX} y1={0} x2={cursorX} y2={VH}
            stroke={isLocked ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.25)'}
            strokeWidth={isLocked ? 1.5 : 1}
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* Dots at cursor for each series */}
        {cursorX != null && selectedPoint && series.map(s => {
          const v = selectedPoint[s.key] as number | undefined
          if (v == null) return null
          return (
            <circle
              key={`dot-${String(s.key)}`}
              cx={cursorX}
              cy={toSY(v)}
              r={4}
              fill={s.color}
              stroke="#080d18"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
      </svg>
    </div>
  )
}

function parseRGB(color: string): [number, number, number] {
  const m = color.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  if (m) return [+m[1], +m[2], +m[3]]
  if (color === '#38bdf8') return [56, 189, 248]
  if (color === '#00aaff') return [0, 170, 255]
  if (color === '#22c55e') return [34, 197, 94]
  if (color === '#ef4444') return [239, 68, 68]
  if (color === '#f59e0b') return [245, 158, 11]
  if (color === '#a78bfa') return [167, 139, 250]
  return [255, 255, 255]
}
