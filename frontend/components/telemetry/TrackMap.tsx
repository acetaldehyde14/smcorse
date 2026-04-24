'use client'

import { useRef, useCallback, useMemo } from 'react'
import { useTelemetryCursor, useActiveLdp } from '@/store/telemetry-cursor'
import {
  projectTrackPoints,
  buildTrackPathD,
  findNearestPointIndex,
  type TelemetryPoint,
} from '@/lib/telemetry'

const SVG_W = 320
const SVG_H = 320

type Props = {
  points: TelemetryPoint[]
}

export default function TrackMap({ points }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const { setHoverLdp, toggleLock } = useTelemetryCursor()
  const activeLdp = useActiveLdp()
  const isLocked  = useTelemetryCursor(s => s.lockedLdp != null)

  const mapped = useMemo(
    () => projectTrackPoints(points, SVG_W, SVG_H, 24),
    [points]
  )

  const trackPath = useMemo(() => buildTrackPathD(mapped), [mapped])

  // Colour each segment by throttle: green = full throttle, red = braking, white = coasting
  const colourSegments = useMemo(() => {
    if (mapped.length < 2) return []
    return mapped.slice(0, -1).map((p, i) => {
      const pt = points.find(tp => Math.abs(tp.ldp - p.ldp) < 0.002)
      const thr = pt?.thr ?? 0
      const brk = pt?.brk ?? 0
      let color: string
      if (brk > 0.05) {
        color = `rgba(255,${Math.round(60 - brk * 60)},60,0.9)`
      } else if (thr > 0.7) {
        color = `rgba(0,${Math.round(160 + thr * 50)},80,0.9)`
      } else {
        color = 'rgba(255,255,255,0.25)'
      }
      return { x1: p.sx, y1: p.sy, x2: mapped[i + 1].sx, y2: mapped[i + 1].sy, color }
    })
  }, [mapped, points])

  // Selected dot position
  const selectedDot = useMemo(() => {
    if (activeLdp == null || !mapped.length) return null
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < mapped.length; i++) {
      const d = Math.abs(mapped[i].ldp - activeLdp)
      if (d < bestD) { bestD = d; best = i }
    }
    return mapped[best]
  }, [activeLdp, mapped])

  // Map SVG-element-local mouse coords
  const toSvgCoords = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return { mx: 0, my: 0 }
    const rect = svg.getBoundingClientRect()
    return {
      mx: ((e.clientX - rect.left) / rect.width)  * SVG_W,
      my: ((e.clientY - rect.top)  / rect.height) * SVG_H,
    }
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!mapped.length) return
    const { mx, my } = toSvgCoords(e)
    const idx = findNearestPointIndex(mapped, mx, my)
    setHoverLdp(mapped[idx].ldp)
  }, [mapped, toSvgCoords, setHoverLdp])

  const onMouseLeave = useCallback(() => {
    setHoverLdp(null)
  }, [setHoverLdp])

  const onClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!mapped.length) return
    const { mx, my } = toSvgCoords(e)
    const idx = findNearestPointIndex(mapped, mx, my)
    toggleLock(mapped[idx].ldp)
  }, [mapped, toSvgCoords, toggleLock])

  if (!mapped.length) {
    return (
      <div className="flex items-center justify-center h-full text-dark-muted text-xs text-center px-4">
        <div>
          <p className="text-2xl mb-2 opacity-40">🗺</p>
          <p>No track position data</p>
          <p className="mt-1 opacity-60">Upload a newer IBT file recorded with the updated client</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full h-full cursor-crosshair"
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
      >
        {/* Background */}
        <rect width={SVG_W} height={SVG_H} fill="transparent" />

        {/* Coloured track segments */}
        {colourSegments.map((seg, i) => (
          <line
            key={i}
            x1={seg.x1} y1={seg.y1}
            x2={seg.x2} y2={seg.y2}
            stroke={seg.color}
            strokeWidth={3}
            strokeLinecap="round"
          />
        ))}

        {/* White outline (thin, behind) */}
        {trackPath && (
          <path
            d={trackPath}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={5}
            strokeLinejoin="round"
          />
        )}

        {/* Start/finish marker */}
        {mapped[0] && (
          <circle cx={mapped[0].sx} cy={mapped[0].sy} r={5} fill="#0066cc" />
        )}

        {/* Selected position dot */}
        {selectedDot && (
          <circle
            cx={selectedDot.sx}
            cy={selectedDot.sy}
            r={isLocked ? 7 : 5}
            fill={isLocked ? '#ffffff' : '#38bdf8'}
            stroke={isLocked ? '#0066cc' : 'none'}
            strokeWidth={2}
          />
        )}
      </svg>

      {isLocked && (
        <div className="absolute top-2 right-2 text-[10px] text-dark-muted bg-dark-card/80 rounded px-1.5 py-0.5">
          locked · click to unlock
        </div>
      )}
    </div>
  )
}
