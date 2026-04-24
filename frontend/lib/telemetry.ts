export type TelemetryPoint = {
  t: number
  ldp: number       // 0..1 lap distance percent
  spd?: number      // km/h
  thr?: number      // 0..1
  brk?: number      // 0..1
  steer?: number    // degrees
  gear?: number
  rpm?: number
  lat?: number      // lateral accel m/s²
  lon?: number      // longitudinal accel m/s²
  x?: number        // track x position (m)
  y?: number        // track y position (m)
}

/** Normalize raw API frames into TelemetryPoints sorted by ldp. */
export function normalizeLapSamples(raw: any[]): TelemetryPoint[] {
  const points: TelemetryPoint[] = raw
    .filter(f => f.lap_dist_pct != null)
    .map(f => {
      const thr = f.throttle != null ? Number(f.throttle) : undefined
      const brk = f.brake    != null ? Number(f.brake)    : undefined
      return {
        t:     Number(f.session_time ?? f.t ?? 0),
        ldp:   Number(f.lap_dist_pct),
        spd:   f.speed_kph  != null ? Number(f.speed_kph)  : undefined,
        thr:   thr != null ? (thr > 1 ? thr / 100 : thr) : undefined,
        brk:   brk != null ? (brk > 1 ? brk / 100 : brk) : undefined,
        steer: f.steering_deg != null ? Number(f.steering_deg) : undefined,
        gear:  f.gear != null ? Number(f.gear) : undefined,
        rpm:   f.rpm  != null ? Number(f.rpm)  : undefined,
        lat:   f.lat_accel   != null ? Number(f.lat_accel)   : undefined,
        lon:   f.long_accel  != null ? Number(f.long_accel)  : undefined,
        x:     f.x_pos != null ? Number(f.x_pos) : undefined,
        y:     f.y_pos != null ? Number(f.y_pos) : undefined,
      }
    })

  // Sort by ldp ascending
  points.sort((a, b) => a.ldp - b.ldp)

  // Dedupe near-equal ldp values (< 0.0005 apart keeps ~2000 unique positions)
  const deduped: TelemetryPoint[] = []
  for (const p of points) {
    const last = deduped[deduped.length - 1]
    if (last && Math.abs(p.ldp - last.ldp) < 0.0004) continue
    deduped.push(p)
  }

  return deduped
}

/** Find the nearest TelemetryPoint for a given ldp value. */
export function findByLdp(points: TelemetryPoint[], ldp: number): TelemetryPoint | null {
  if (!points.length) return null
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < points.length; i++) {
    const d = Math.abs(points[i].ldp - ldp)
    if (d < bestDist) { bestDist = d; best = i }
  }
  return points[best]
}

/** Find the nearest point by XY screen distance, returns point index. */
export function findNearestPointIndex(
  mapped: { sx: number; sy: number }[],
  mx: number, my: number
): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < mapped.length; i++) {
    const dx = mapped[i].sx - mx
    const dy = mapped[i].sy - my
    const d = dx * dx + dy * dy
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

/** Project track XY world coords to SVG pixel space. Returns empty array if no XY data. */
export function projectTrackPoints(
  points: TelemetryPoint[],
  svgW: number, svgH: number,
  padding = 24
): { sx: number; sy: number; ldp: number }[] {
  const valid = points.filter(p => p.x != null && p.y != null)
  if (!valid.length) return []

  const xs = valid.map(p => p.x!)
  const ys = valid.map(p => p.y!)
  const xMin = Math.min(...xs), xMax = Math.max(...xs)
  const yMin = Math.min(...ys), yMax = Math.max(...ys)
  const xRange = xMax - xMin || 1
  const yRange = yMax - yMin || 1

  const usableW = svgW - padding * 2
  const usableH = svgH - padding * 2
  const scale = Math.min(usableW / xRange, usableH / yRange)

  const offX = padding + (usableW - xRange * scale) / 2
  const offY = padding + (usableH - yRange * scale) / 2

  return valid.map(p => ({
    sx:  offX + (p.x! - xMin) * scale,
    sy:  offY + (yMax - p.y!) * scale, // flip Y (SVG grows downward)
    ldp: p.ldp
  }))
}

/** Build an SVG polyline points string from projected track points. */
export function buildTrackPath(mapped: { sx: number; sy: number }[]): string {
  if (!mapped.length) return ''
  return mapped.map(p => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(' ')
}

/** Convert an array of projected points to an SVG path d= string (for smooth lines). */
export function buildTrackPathD(mapped: { sx: number; sy: number }[]): string {
  if (!mapped.length) return ''
  let d = `M ${mapped[0].sx.toFixed(1)} ${mapped[0].sy.toFixed(1)}`
  for (let i = 1; i < mapped.length; i++) {
    d += ` L ${mapped[i].sx.toFixed(1)} ${mapped[i].sy.toFixed(1)}`
  }
  return d
}
