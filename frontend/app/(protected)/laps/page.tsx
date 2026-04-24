'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { telemetry as telApi } from '@/lib/api';
import type { AllLap } from '@/lib/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

function fmtLapTime(secs: number | null | undefined): string {
  if (!secs || secs <= 0) return '—';
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(3).padStart(6, '0');
  return `${m}:${s}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

type UploadState = 'idle' | 'uploading' | 'done' | 'error';

export default function LapsPage() {
  const [laps, setLaps]           = useState<AllLap[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState('');
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadMsg, setUploadMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function loadLaps() {
    return telApi.allLaps()
      .then(data => { setLaps(data); })
      .catch(() => { /* keep existing laps visible on transient errors */ })
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadLaps(); }, []);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';           // reset so same file can be re-selected
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['ibt', 'blap', 'olap'].includes(ext ?? '')) {
      setUploadState('error');
      setUploadMsg('Only .ibt, .blap and .olap files are supported');
      return;
    }

    setUploadState('uploading');
    setUploadMsg(`Uploading ${file.name}…`);

    try {
      const form = new FormData();
      form.append('telemetry', file);
      const res = await fetch(`${API_BASE}/api/telemetry/upload`, {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      let json: any = {};
      try { json = await res.json(); } catch { /* non-JSON response */ }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);

      const lapCount = json.session?.lap_count ?? json.lap_count ?? json.laps?.length ?? '?';
      setUploadState('done');
      setUploadMsg(`Uploaded — ${lapCount} lap${lapCount === 1 ? '' : 's'} added`);
      setLoading(true);
      loadLaps();
      setTimeout(() => setUploadState('idle'), 4000);
    } catch (err: any) {
      setUploadState('error');
      setUploadMsg(err.message || 'Upload failed');
      setTimeout(() => setUploadState('idle'), 5000);
    }
  }

  const filtered = laps.filter(l => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      l.track_name?.toLowerCase().includes(q) ||
      l.car_name?.toLowerCase().includes(q)
    );
  });

  const uploadBtnClass =
    uploadState === 'uploading' ? 'opacity-60 cursor-not-allowed' :
    uploadState === 'done'      ? 'bg-green-600 border-green-600' :
    uploadState === 'error'     ? 'bg-red-600 border-red-600'     :
    'hover:bg-primary/20';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading font-bold text-2xl text-white">Lap Library</h1>
          <p className="text-dark-muted text-sm">All recorded laps — click to see traces and features</p>
        </div>

        <div className="flex items-center gap-3">
        {/* Analysis tool link */}
        <a
          href="/lap-analysis.html"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-dark-border text-sm font-semibold text-dark-muted hover:text-white hover:border-accent transition-colors font-body"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Analysis Tool
        </a>

        {/* Upload button */}
        <div className="flex flex-col items-end gap-1">
          <input
            ref={fileRef}
            type="file"
            accept=".ibt,.blap,.olap"
            className="hidden"
            onChange={handleFile}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploadState === 'uploading'}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border border-primary text-sm font-semibold text-white transition-colors font-body ${uploadBtnClass}`}
          >
            {uploadState === 'uploading' ? (
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            )}
            {uploadState === 'uploading' ? 'Uploading…' : 'Upload Telemetry'}
          </button>
          {uploadMsg && (
            <p className={`text-xs ${uploadState === 'error' ? 'text-red-400' : uploadState === 'done' ? 'text-green-400' : 'text-dark-muted'}`}>
              {uploadMsg}
            </p>
          )}
          <p className="text-dark-muted text-xs">.ibt · .blap · .olap</p>
        </div>
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
            <p className="text-sm">Upload a .ibt, .blap or .olap file using the button above</p>
          )}
        </div>
      ) : (
        <div className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">
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
