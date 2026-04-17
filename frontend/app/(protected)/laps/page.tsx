'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { telemetry as telApi } from '@/lib/api';
import type { AllLap } from '@/lib/types';

function fmtLapTime(secs: number | null | undefined): string {
  if (!secs || secs <= 0) return '—';
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(3).padStart(6, '0');
  return `${m}:${s}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function LapsPage() {
  const [laps, setLaps]       = useState<AllLap[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('');

  useEffect(() => {
    telApi.allLaps()
      .then(setLaps)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = laps.filter(l => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      l.track_name?.toLowerCase().includes(q) ||
      l.car_name?.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading font-bold text-2xl text-white">Lap Library</h1>
          <p className="text-dark-muted text-sm">All recorded laps — click to see traces and features</p>
        </div>
      </div>

      {/* Filter */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Filter by track or car…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="w-full sm:w-72 bg-dark-card border border-dark-border rounded-lg px-3 py-2 text-white text-sm placeholder-dark-muted focus:outline-none focus:border-primary"
        />
      </div>

      {loading ? (
        <div className="text-dark-muted text-sm py-12 text-center">Loading laps…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-24 text-dark-muted">
          <p className="text-5xl mb-4">🏎</p>
          <p className="font-heading font-semibold text-white text-lg mb-2">
            {filter ? 'No matching laps' : 'No laps recorded yet'}
          </p>
          {!filter && (
            <p className="text-sm">Upload a telemetry file or run a live session to populate this library</p>
          )}
        </div>
      ) : (
        <div className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[3fr_3fr_1fr_2fr_2fr_auto] gap-x-4 px-4 py-2 border-b border-dark-border text-xs text-dark-muted uppercase tracking-wider font-body">
            <span>Track</span>
            <span>Car</span>
            <span>Lap</span>
            <span>Time</span>
            <span>Date</span>
            <span />
          </div>

          <div className="divide-y divide-dark-border">
            {filtered.map(lap => (
              <Link
                key={lap.id}
                href={`/laps/${lap.id}`}
                className="grid grid-cols-[3fr_3fr_1fr_2fr_2fr_auto] gap-x-4 items-center px-4 py-3 hover:bg-white/2 transition-colors group"
              >
                <span className="text-white text-sm font-semibold truncate">{lap.track_name || '—'}</span>
                <span className="text-dark-muted text-sm truncate">{lap.car_name || '—'}</span>
                <span className="text-dark-muted text-sm">{lap.lap_number ?? '—'}</span>
                <span className="font-mono text-sm text-white font-semibold">{fmtLapTime(lap.lap_time)}</span>
                <span className="text-dark-muted text-xs">{fmtDate(lap.created_at)}</span>
                <span className="text-dark-muted group-hover:text-[#0066cc] transition-colors text-sm">→</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <p className="text-dark-muted text-xs mt-3 text-right">
        {filtered.length} of {laps.length} laps
      </p>
    </div>
  );
}
