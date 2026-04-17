'use client';

import { useState, useEffect, useCallback } from 'react';
import { stintPlanner as plannerApi, team as teamApi, teams as teamsApi } from '@/lib/api';
import type { StintPlannerSession, Driver, AvailabilityStatus, AvailabilityMap, Team, TeamMember, StintBlock } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

// ── Constants ────────────────────────────────────────────────
const BLOCK_MINUTES = 45;
const BLOCK_COLORS = ['#0066cc','#00aaff','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#06b6d4'];

// ── Helpers ──────────────────────────────────────────────────
function blockToTime(startISO: string | undefined, blockIdx: number): string {
  let baseH = 0, baseM = 0;
  if (startISO) {
    const d = new Date(startISO);
    if (!isNaN(d.getTime())) { baseH = d.getHours(); baseM = d.getMinutes(); }
  }
  const total = baseH * 60 + baseM + blockIdx * BLOCK_MINUTES;
  return `${String(Math.floor(total / 60) % 24).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
}

function driverColor(name: string, idx: number): string {
  return BLOCK_COLORS[idx % BLOCK_COLORS.length];
}

function hourToTime(startISO: string | undefined, hourIdx: number): string {
  let baseH = 0, baseM = 0;
  if (startISO) {
    const d = new Date(startISO);
    if (!isNaN(d.getTime())) { baseH = d.getHours(); baseM = d.getMinutes(); }
  }
  const total = baseH * 60 + baseM + hourIdx * 60;
  return `${String(Math.floor(total / 60) % 24).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
}

function getRaceDates(startStr: string | undefined, durationHours: number): { value: string; label: string }[] {
  if (!startStr) return [];
  const start = new Date(startStr);
  if (isNaN(start.getTime())) return [];
  const result: { value: string; label: string }[] = [];
  const seen = new Set<string>();
  for (let h = 0; h <= Math.ceil(durationHours) + 1; h++) {
    const d = new Date(start.getTime() + h * 3_600_000);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    const key = `${y}-${mo}-${dy}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({
        value: key,
        label: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      });
    }
  }
  return result;
}

function periodToHourIndices(
  raceStartStr: string | undefined,
  fromDate: string, fromHour: number, fromMinute: number,
  toDate: string, toHour: number, toMinute: number,
): number[] {
  if (!raceStartStr || !fromDate || !toDate) return [];
  const raceStart = new Date(raceStartStr).getTime();
  const fromMs = new Date(`${fromDate}T${String(fromHour).padStart(2,'0')}:${String(fromMinute).padStart(2,'0')}:00`).getTime();
  const toMs   = new Date(`${toDate}T${String(toHour).padStart(2,'0')}:${String(toMinute).padStart(2,'0')}:00`).getTime();
  if (isNaN(fromMs) || isNaN(toMs) || fromMs >= toMs) return [];
  const fromIdx = Math.floor((fromMs - raceStart) / 3_600_000);
  const toIdx   = Math.ceil((toMs   - raceStart) / 3_600_000);
  const indices: number[] = [];
  for (let h = Math.max(0, fromIdx); h < toIdx; h++) indices.push(h);
  return indices;
}

// ── Availability Period type ──────────────────────────────────
interface AvailPeriod {
  driverId: string;
  status: AvailabilityStatus;
  fromDate: string; fromHour: number; fromMinute: number;
  toDate:   string; toHour:   number; toMinute:   number;
}
const defaultPeriod = (): AvailPeriod => ({
  driverId: '', status: 'free',
  fromDate: '', fromHour: 8, fromMinute: 0,
  toDate:   '', toHour:  12, toMinute:   0,
});

const AVAIL_COLOR: Record<AvailabilityStatus, string> = {
  unknown:      'bg-[#1a2540]',
  free:         'bg-green-500/70',
  inconvenient: 'bg-yellow-500/70',
  unavailable:  'bg-red-500/60',
};

// ── Availability Overview ─────────────────────────────────────
function AvailabilityOverview({ availability, sessionDrivers, startISO, durationHours }: {
  availability: AvailabilityMap;
  sessionDrivers: Driver[];
  startISO?: string;
  durationHours: number;
}) {
  const totalHours = Math.min(Math.ceil(durationHours), 48);
  const hours = Array.from({ length: totalHours }, (_, i) => i);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-max">
        {/* Header row: time labels */}
        <div className="flex items-end mb-1">
          <div className="w-32 flex-shrink-0" />
          {hours.map(h => (
            <div key={h} className="w-10 flex-shrink-0 text-center">
              {h % 3 === 0 ? (
                <span className="text-[#8892a4] text-[10px] leading-none">{hourToTime(startISO, h)}</span>
              ) : (
                <span className="text-transparent text-[10px]">.</span>
              )}
            </div>
          ))}
        </div>

        {/* Driver rows */}
        {sessionDrivers.map(driver => (
          <div key={driver.id} className="flex items-center mb-1">
            <div className="w-32 flex-shrink-0 pr-3">
              <span className="text-white text-sm font-semibold truncate block" title={driver.iracing_name || driver.username}>
                {driver.iracing_name || driver.username}
              </span>
            </div>
            <div className="flex gap-0.5">
              {hours.map(h => {
                const status: AvailabilityStatus = availability[String(driver.id)]?.[String(h)] ?? 'unknown';
                return (
                  <div
                    key={h}
                    className={`w-10 h-7 rounded-sm ${AVAIL_COLOR[status]} transition-colors`}
                    title={`${driver.iracing_name || driver.username} — ${hourToTime(startISO, h)}: ${status === 'unknown' ? 'not set' : status}`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mt-4 pt-3 border-t border-[#1a2540] text-xs">
        {(['free', 'inconvenient', 'unavailable', 'unknown'] as AvailabilityStatus[]).map(s => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`w-4 h-3 rounded-sm inline-block ${AVAIL_COLOR[s]}`} />
            <span className="text-[#8892a4]">
              {s === 'free' ? 'Available' : s === 'inconvenient' ? 'Not optimal' : s === 'unavailable' ? 'Unavailable' : 'Not set'}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Availability Form Card ────────────────────────────────────
const SELECT_CLS = 'bg-[#0a0f1c] border border-[#1a2540] rounded-lg px-2.5 py-2 text-white text-sm focus:outline-none focus:border-[#0066cc] appearance-none';
const LABEL_CLS  = 'block text-[#8892a4] text-xs mb-1';

function AvailabilityFormCard({ sessionDrivers, raceDates, raceStartStr, onSave }: {
  sessionDrivers: Driver[];
  raceDates: { value: string; label: string }[];
  raceStartStr: string | undefined;
  onSave: (driverId: string, status: AvailabilityStatus, hourIndices: number[]) => void;
}) {
  const [periods, setPeriods] = useState<AvailPeriod[]>([defaultPeriod()]);

  const updatePeriod = (i: number, patch: Partial<AvailPeriod>) =>
    setPeriods(ps => ps.map((p, idx) => idx === i ? { ...p, ...patch } : p));

  const removePeriod = (i: number) =>
    setPeriods(ps => ps.filter((_, idx) => idx !== i));

  const savePeriod = (p: AvailPeriod) => {
    if (!p.driverId) return;
    const indices = periodToHourIndices(raceStartStr, p.fromDate, p.fromHour, p.fromMinute, p.toDate, p.toHour, p.toMinute);
    if (indices.length === 0) return;
    onSave(p.driverId, p.status, indices);
  };

  const hours   = Array.from({ length: 24 }, (_, i) => i);
  const minutes = [0, 10, 20, 30, 40, 50];

  const statusLabel: Record<AvailabilityStatus, string> = {
    free: 'Available', inconvenient: 'Not optimal', unavailable: 'Unavailable', unknown: 'Unknown',
  };

  return (
    <div className="flex flex-col gap-4">
      {periods.map((p, i) => (
        <div key={i} className="bg-[#0a0f1c] border border-[#1a2540] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#8892a4] text-xs font-medium uppercase tracking-wide">Period {i + 1}</span>
            {periods.length > 1 && (
              <button onClick={() => removePeriod(i)} className="text-[#8892a4] hover:text-red-400 text-xs transition-colors">Remove</button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            {/* Driver */}
            <div>
              <label className={LABEL_CLS}>Driver</label>
              <select value={p.driverId} onChange={e => updatePeriod(i, { driverId: e.target.value })} className={`${SELECT_CLS} w-full`}>
                <option value="">— select driver —</option>
                {sessionDrivers.map(d => (
                  <option key={d.id} value={String(d.id)}>{d.iracing_name || d.username}</option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div>
              <label className={LABEL_CLS}>Status</label>
              <select value={p.status} onChange={e => updatePeriod(i, { status: e.target.value as AvailabilityStatus })} className={`${SELECT_CLS} w-full`}>
                {(['free', 'inconvenient', 'unavailable'] as AvailabilityStatus[]).map(s => (
                  <option key={s} value={s}>{statusLabel[s]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            {/* From */}
            <div>
              <label className={LABEL_CLS}>From</label>
              <div className="flex gap-1.5">
                <select value={p.fromDate} onChange={e => updatePeriod(i, { fromDate: e.target.value })} className={`${SELECT_CLS} flex-1 min-w-0`}>
                  <option value="">Date</option>
                  {raceDates.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
                <select value={p.fromHour} onChange={e => updatePeriod(i, { fromHour: Number(e.target.value) })} className={`${SELECT_CLS} w-16`}>
                  {hours.map(h => <option key={h} value={h}>{String(h).padStart(2,'0')}</option>)}
                </select>
                <select value={p.fromMinute} onChange={e => updatePeriod(i, { fromMinute: Number(e.target.value) })} className={`${SELECT_CLS} w-14`}>
                  {minutes.map(m => <option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}
                </select>
              </div>
            </div>

            {/* To */}
            <div>
              <label className={LABEL_CLS}>To</label>
              <div className="flex gap-1.5">
                <select value={p.toDate} onChange={e => updatePeriod(i, { toDate: e.target.value })} className={`${SELECT_CLS} flex-1 min-w-0`}>
                  <option value="">Date</option>
                  {raceDates.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
                <select value={p.toHour} onChange={e => updatePeriod(i, { toHour: Number(e.target.value) })} className={`${SELECT_CLS} w-16`}>
                  {hours.map(h => <option key={h} value={h}>{String(h).padStart(2,'0')}</option>)}
                </select>
                <select value={p.toMinute} onChange={e => updatePeriod(i, { toMinute: Number(e.target.value) })} className={`${SELECT_CLS} w-14`}>
                  {minutes.map(m => <option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}
                </select>
              </div>
            </div>
          </div>

          <button
            onClick={() => savePeriod(p)}
            disabled={!p.driverId || !p.fromDate || !p.toDate}
            className="w-full sm:w-auto px-4 py-1.5 rounded-lg bg-[#0066cc] hover:bg-[#0055aa] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
          >
            Save Period
          </button>
        </div>
      ))}

      <button
        onClick={() => setPeriods(ps => [...ps, defaultPeriod()])}
        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-[#1a2540] hover:border-[#0066cc]/50 text-[#8892a4] hover:text-white text-sm transition-colors"
      >
        <span className="text-lg leading-none">+</span> Add Another Period
      </button>
    </div>
  );
}

// ── Drag Handle Icon ─────────────────────────────────────────
function DragHandle() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[#4a5568] flex-shrink-0 cursor-grab active:cursor-grabbing">
      <circle cx="5" cy="4" r="1.2" fill="currentColor" />
      <circle cx="5" cy="8" r="1.2" fill="currentColor" />
      <circle cx="5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="10" cy="4" r="1.2" fill="currentColor" />
      <circle cx="10" cy="8" r="1.2" fill="currentColor" />
      <circle cx="10" cy="12" r="1.2" fill="currentColor" />
    </svg>
  );
}

// ── Stint Card List ───────────────────────────────────────────
function StintCardList({ plan, startISO, onReorder, onEdit, onDelete }: {
  plan: StintBlock[];
  startISO?: string;
  onReorder: (newPlan: StintBlock[]) => void;
  onEdit: (i: number) => void;
  onDelete: (i: number) => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, i: number) => {
    setDragIdx(i);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIdx !== i) setDragOverIdx(i);
  };

  const handleDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === targetIdx) {
      setDragIdx(null); setDragOverIdx(null); return;
    }
    const reordered = [...plan];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(targetIdx, 0, moved);

    // Recalculate startBlock/endBlock contiguously, preserving each block's duration
    let cursor = 0;
    const recalculated = reordered.map(b => {
      const dur = Math.max(1, (b.endBlock ?? 1) - (b.startBlock ?? 0));
      const newStart = cursor;
      cursor += dur;
      return { ...b, startBlock: newStart, endBlock: cursor };
    });

    setDragIdx(null); setDragOverIdx(null);
    onReorder(recalculated);
  };

  const handleDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  return (
    <div>
      <p className="text-[#8892a4] text-sm mb-4">
        Drag stints to reorder drivers. The race timeline will be recalculated to reflect the new order.
      </p>

      {plan.map((block, i) => {
        const start = block.startBlock ?? 0;
        const end = Math.max(start + 1, block.endBlock ?? start + 1);
        const dur = end - start;
        const durationMins = dur * BLOCK_MINUTES;
        const name = block.driver_name ?? block.driver ?? '—';
        const color = block.color ?? BLOCK_COLORS[i % BLOCK_COLORS.length];
        const startTime = blockToTime(startISO, start);
        const endTime = blockToTime(startISO, end);
        const isDragging = dragIdx === i;
        const isDragOver = dragOverIdx === i && dragIdx !== i;

        return (
          <div key={i}>
            {/* Card */}
            <div
              draggable
              onDragStart={e => handleDragStart(e, i)}
              onDragOver={e => handleDragOver(e, i)}
              onDrop={e => handleDrop(e, i)}
              onDragEnd={handleDragEnd}
              className={`rounded-xl border transition-all select-none ${
                isDragOver
                  ? 'border-[#0066cc] bg-[#0066cc]/10 shadow-lg shadow-[#0066cc]/10'
                  : 'border-[#1a2540] bg-[#0d1525]'
              } ${isDragging ? 'opacity-40' : ''}`}
            >
              {/* Top row */}
              <div className="flex items-center gap-3 px-4 pt-4 pb-3">
                <DragHandle />

                {/* Number badge */}
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: color }}
                >
                  {i + 1}
                </div>

                {/* Driver + time window */}
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm leading-tight">{name}</p>
                  <p className="text-[#8892a4] text-xs mt-0.5">{startTime} – {endTime}</p>
                </div>

                {/* Edit / Delete */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => onEdit(i)}
                    className="text-[#8892a4] hover:text-white text-xs px-2.5 py-1 rounded-lg bg-[#1a2540] hover:bg-[#0066cc]/30 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onDelete(i)}
                    className="text-[#8892a4] hover:text-red-400 text-xs px-2.5 py-1 rounded-lg bg-[#1a2540] hover:bg-red-500/20 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Footer row */}
              <div className="flex items-center gap-4 px-4 pb-3 border-t border-[#1a2540]/60 pt-2.5 text-xs text-[#8892a4]">
                <span className="flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-60">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  {durationMins} min
                </span>
                <span className="flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-60">
                    <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
                  </svg>
                  {dur} block{dur !== 1 ? 's' : ''}
                </span>
                <span className="ml-auto text-[#4a5568]">
                  B{start} → B{end}
                </span>
              </div>
            </div>

            {/* Pit Stop divider */}
            {i < plan.length - 1 && (
              <div className="flex items-center gap-3 py-2 px-2">
                <div className="h-px flex-1 bg-[#1a2540]" />
                <span className="text-[#4a5568] text-xs font-medium tracking-wide flex items-center gap-1.5">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-70">
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3-3a1 1 0 0 0 0-1.4l-1.6-1.6a1 1 0 0 0-1.4 0z"/><path d="M5 20l1.5-1.5M9 16l-4 4M3 12l9 9"/><path d="M9.5 2.5 20 13"/>
                  </svg>
                  Pit Stop
                </span>
                <div className="h-px flex-1 bg-[#1a2540]" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Block Editor Modal ────────────────────────────────────────
function BlockEditModal({ open, block, blockIdx, numBlocks, drivers, onSave, onClose }: {
  open: boolean;
  block: StintBlock | null;
  blockIdx: number;
  numBlocks: number;
  drivers: Driver[];
  onSave: (updated: StintBlock) => void;
  onClose: () => void;
}) {
  const [driverName, setDriverName] = useState('');
  const [startBlock, setStartBlock] = useState(0);
  const [endBlock, setEndBlock] = useState(1);

  useEffect(() => {
    if (block) {
      const sb = block.startBlock ?? 0;
      setDriverName(block.driver_name ?? block.driver ?? '');
      setStartBlock(sb);
      setEndBlock(Math.max(sb + 1, block.endBlock ?? sb + 1));
    }
  }, [block]);

  if (!block) return null;

  const durBlocks = endBlock - startBlock;

  return (
    <Modal open={open} onClose={onClose} title="Edit Plan Block">
      <div className="flex flex-col gap-4">
        <div>
          <label className="block text-[#8892a4] text-xs mb-1">Driver</label>
          <select
            value={driverName}
            onChange={e => setDriverName(e.target.value)}
            className="w-full bg-[#0a0f1c] border border-[#1a2540] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#0066cc]"
          >
            <option value="">— select driver —</option>
            {drivers.map(d => (
              <option key={d.id} value={d.iracing_name || d.username}>
                {d.iracing_name || d.username}
              </option>
            ))}
            <option value={driverName}>{driverName} (current)</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[#8892a4] text-xs mb-1">Start Block</label>
            <input
              type="number" min={0} max={numBlocks - 1}
              value={startBlock}
              onChange={e => setStartBlock(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-full bg-[#0a0f1c] border border-[#1a2540] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#0066cc]"
            />
          </div>
          <div>
            <label className="block text-[#8892a4] text-xs mb-1">End Block (exclusive)</label>
            <input
              type="number" min={startBlock + 1} max={numBlocks}
              value={endBlock}
              onChange={e => setEndBlock(Math.max(startBlock + 1, parseInt(e.target.value) || startBlock + 1))}
              className="w-full bg-[#0a0f1c] border border-[#1a2540] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#0066cc]"
            />
          </div>
        </div>
        <p className="text-[#8892a4] text-xs">
          Duration: <span className="text-white font-semibold">{durBlocks} blocks · {durBlocks * BLOCK_MINUTES} min</span>
        </p>
        <div className="flex gap-3">
          <Button className="flex-1 justify-center" onClick={() => onSave({ ...block, driver_name: driverName, startBlock, endBlock: Math.max(startBlock + 1, endBlock) })}>
            Save
          </Button>
          <Button variant="secondary" className="flex-1 justify-center" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Main Page ────────────────────────────────────────────────
export default function StintPlannerPage() {
  const toast = useToast();

  // Sessions sidebar
  const [sessions, setSessions] = useState<StintPlannerSession[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [session, setSession] = useState<StintPlannerSession | null>(null);
  const [newSessionName, setNewSessionName] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  // Teams + drivers
  const [teamList, setTeamList] = useState<Team[]>([]);
  const [allDrivers, setAllDrivers] = useState<Driver[]>([]);

  // Plan state
  const [planning, setPlanning] = useState(false);
  const [explanation, setExplanation] = useState('');
  const [numBlocks, setNumBlocks] = useState(0);
  const [aiPrompt, setAiPrompt] = useState('');
  const [showAiPrompt, setShowAiPrompt] = useState(false);

  // Block editor
  const [editingBlockIdx, setEditingBlockIdx] = useState<number | null>(null);
  const [addingBlock, setAddingBlock] = useState(false);

  // ── Load ─────────────────────────────────────────────────
  const loadSessions = useCallback(async () => {
    try { const d = await plannerApi.list(); setSessions(d); } catch {}
  }, []);

  useEffect(() => {
    loadSessions();
    teamApi.drivers().then(setAllDrivers).catch(console.error);
    teamsApi.list().then(setTeamList).catch(console.error);
  }, [loadSessions]);

  useEffect(() => {
    if (!selectedId) return;
    plannerApi.get(selectedId).then(s => {
      setSession(s);
      setExplanation('');
      const dur = s.config?.duration_hours ?? 6;
      setNumBlocks(Math.ceil((dur * 60) / BLOCK_MINUTES));
    }).catch(console.error);
  }, [selectedId]);

  // Drivers currently in this session (by selected_drivers IDs)
  const sessionDrivers = session
    ? allDrivers.filter(d => session.config.selected_drivers?.includes(d.id))
    : [];

  // ── Session ops ──────────────────────────────────────────
  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSessionName.trim()) return;
    setCreating(true);
    try {
      const s = await plannerApi.create(newSessionName.trim());
      setSessions(prev => [s, ...prev]);
      setSelectedId(s.id);
      setNewSessionName('');
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setCreating(false); }
  };

  const handleDeleteSession = async (id: number) => {
    if (!confirm('Delete this planning session?')) return;
    try {
      await plannerApi.delete(id);
      setSessions(prev => prev.filter(s => s.id !== id));
      if (selectedId === id) { setSelectedId(null); setSession(null); }
      toast('Session deleted', 'info');
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const saveSession = useCallback(async (updates: Partial<StintPlannerSession>) => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const updated = await plannerApi.update(selectedId, updates);
      setSession(updated);
      const dur = updated.config?.duration_hours ?? 6;
      setNumBlocks(Math.ceil((dur * 60) / BLOCK_MINUTES));
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  }, [selectedId, toast]);

  const updateConfig = (key: string, value: unknown) => {
    if (!session) return;
    const newConfig = { ...session.config, [key]: value };
    setSession(s => s ? { ...s, config: newConfig } : null);
    saveSession({ config: newConfig });
  };

  // ── Team auto-select ──────────────────────────────────────
  const handleSelectTeam = async (teamId: number | '') => {
    if (!session) return;
    if (teamId === '') {
      updateConfig('selected_drivers', []);
      updateConfig('team_id', null);
      return;
    }
    try {
      const members = await teamsApi.members(Number(teamId));
      // Match team members to registered users by name/iracing_name
      const matchedIds: number[] = [];
      members.forEach((m: TeamMember) => {
        const match = allDrivers.find(d =>
          (m.iracing_name && d.iracing_name && d.iracing_name.toLowerCase() === m.iracing_name.toLowerCase()) ||
          d.username.toLowerCase() === m.name.toLowerCase()
        );
        if (match) matchedIds.push(match.id);
      });
      const newConfig = { ...session.config, selected_drivers: matchedIds, team_id: Number(teamId) };
      setSession(s => s ? { ...s, config: newConfig } : null);
      saveSession({ config: newConfig });
      toast(`Loaded ${matchedIds.length} driver(s) from team`, matchedIds.length > 0 ? 'success' : 'info');
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const toggleDriver = (driverId: number) => {
    if (!session) return;
    const current = session.config.selected_drivers ?? [];
    const next = current.includes(driverId)
      ? current.filter(id => id !== driverId)
      : [...current, driverId];
    updateConfig('selected_drivers', next);
  };

  // ── Availability ──────────────────────────────────────────
  const handleSaveAvailPeriod = (driverId: string, status: AvailabilityStatus, hourIndices: number[]) => {
    if (!session) return;
    const current = session.availability[driverId] ?? {};
    const updated = { ...current };
    hourIndices.forEach(h => { updated[String(h)] = status; });
    const newAvail = { ...session.availability, [driverId]: updated };
    setSession(s => s ? { ...s, availability: newAvail } : null);
    saveSession({ availability: newAvail });
    toast(`Saved ${hourIndices.length}h of availability`, 'success');
  };

  const durationHours = session?.config?.duration_hours ?? 6;

  // ── Plan generation ───────────────────────────────────────
  const handleGeneratePlan = async () => {
    if (!selectedId || !session || sessionDrivers.length === 0) return;
    setPlanning(true);
    setExplanation('');
    try {
      const result = await plannerApi.aiPlan(selectedId, aiPrompt);
      setSession(s => s ? { ...s, plan: result.plan } : null);
      setExplanation(result.explanation);
      if (result.numBlocks) setNumBlocks(result.numBlocks);
      setShowAiPrompt(false);
      setAiPrompt('');
      toast('AI plan generated!', 'success');
    } catch (e: any) {
      // Fallback: even distribution
      const nb = Math.ceil((durationHours * 60) / BLOCK_MINUTES);
      const drivers = sessionDrivers.length > 0 ? sessionDrivers : allDrivers;
      if (drivers.length === 0) { toast('No drivers selected', 'error'); setPlanning(false); return; }
      const blocksEach = Math.max(1, Math.floor(nb / drivers.length));
      const plan: StintBlock[] = drivers.map((d, i) => {
        const sBlock = i * blocksEach;
        const eBlock = i === drivers.length - 1 ? Math.max(sBlock + 1, nb) : (i + 1) * blocksEach;
        return {
          driver_name: d.iracing_name || d.username,
          driver_id: d.id,
          startBlock: sBlock,
          endBlock: eBlock,
          color: BLOCK_COLORS[i % BLOCK_COLORS.length],
        };
      });
      setSession(s => s ? { ...s, plan } : null);
      saveSession({ plan });
      setNumBlocks(nb);
      setExplanation('Basic even-distribution plan (AI unavailable).');
      toast('Basic plan generated', 'info');
    }
    finally { setPlanning(false); }
  };

  // ── Plan manual edit ──────────────────────────────────────
  const handleSavePlanBlock = (updated: StintBlock) => {
    if (!session) return;
    const plan = session.plan ? [...session.plan] : [];
    if (addingBlock) {
      plan.push(updated);
    } else if (editingBlockIdx !== null) {
      plan[editingBlockIdx] = updated;
    }
    setSession(s => s ? { ...s, plan } : null);
    saveSession({ plan });
    setEditingBlockIdx(null);
    setAddingBlock(false);
  };

  const handleDeletePlanBlock = (i: number) => {
    if (!session) return;
    const plan = session.plan.filter((_, idx) => idx !== i);
    setSession(s => s ? { ...s, plan } : null);
    saveSession({ plan });
  };

  const handleReorderPlan = (newPlan: StintBlock[]) => {
    setSession(s => s ? { ...s, plan: newPlan } : null);
    saveSession({ plan: newPlan });
  };

  const handleAddBlock = () => {
    if (!session) return;
    setAddingBlock(true);
    setEditingBlockIdx(-1);
  };

  const editingBlock: StintBlock | null = (() => {
    if (addingBlock) {
      const lastBlock = session?.plan?.at(-1);
      const start = lastBlock?.endBlock ?? 0;
      return { startBlock: start, endBlock: Math.min(start + 4, numBlocks), driver_name: '' };
    }
    if (editingBlockIdx !== null && editingBlockIdx >= 0 && session?.plan) {
      return session.plan[editingBlockIdx] ?? null;
    }
    return null;
  })();

  return (
    <div className="flex gap-5 h-full min-h-0">
      {/* ── Sidebar ── */}
      <div className="w-52 flex-shrink-0 flex flex-col gap-3">
        <Card header="Sessions" padding={false}>
          <form onSubmit={handleCreateSession} className="p-3 border-b border-[#1a2540]">
            <input
              value={newSessionName}
              onChange={e => setNewSessionName(e.target.value)}
              placeholder="Session name…"
              className="w-full bg-[#0a0f1c] border border-[#1a2540] rounded px-2 py-1.5 text-white text-sm placeholder-[#8892a4] focus:outline-none focus:border-[#0066cc] mb-2"
            />
            <Button type="submit" size="sm" loading={creating} className="w-full justify-center">+ New</Button>
          </form>
          <div className="divide-y divide-[#1a2540]">
            {sessions.length === 0 && (
              <p className="text-[#8892a4] text-xs p-3">No sessions yet</p>
            )}
            {sessions.map(s => (
              <div
                key={s.id}
                className={`flex items-center group ${selectedId === s.id ? 'bg-[#0066cc]/15 border-l-2 border-[#0066cc]' : 'hover:bg-white/3'}`}
              >
                <button
                  onClick={() => setSelectedId(s.id)}
                  className={`flex-1 text-left px-3 py-2.5 text-sm truncate ${selectedId === s.id ? 'text-white font-semibold' : 'text-[#8892a4] hover:text-white'}`}
                >
                  {s.name}
                </button>
                <button
                  onClick={() => handleDeleteSession(s.id)}
                  className="opacity-0 group-hover:opacity-100 pr-2.5 text-[#8892a4] hover:text-red-400 transition-all"
                  title="Delete"
                >✕</button>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ── Main ── */}
      <div className="flex-1 min-w-0 flex flex-col gap-5 overflow-y-auto">
        {!session ? (
          <div className="text-center py-24 text-[#8892a4]">
            <p className="text-5xl mb-4">📋</p>
            <p className="font-heading font-semibold text-white text-lg mb-2">No session selected</p>
            <p className="text-sm">Create or select a planning session from the sidebar</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="font-heading font-bold text-xl text-white">{session.name}</h1>
                <p className="text-[#8892a4] text-xs mt-0.5">
                  {saving ? 'Saving…' : 'Auto-saved'}
                  {sessionDrivers.length > 0 && ` · ${sessionDrivers.length} driver${sessionDrivers.length !== 1 ? 's' : ''} selected`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowAiPrompt(v => !v)}
                  disabled={sessionDrivers.length === 0}
                >
                  {showAiPrompt ? 'Cancel' : '✦ AI Plan'}
                </Button>
                <Button
                  size="sm"
                  onClick={handleGeneratePlan}
                  loading={planning}
                  disabled={sessionDrivers.length === 0}
                >
                  Generate
                </Button>
              </div>
            </div>

            {/* AI prompt */}
            {showAiPrompt && (
              <div className="bg-[#0d1525] border border-[#0066cc]/30 rounded-lg p-4">
                <p className="text-[#8892a4] text-xs mb-2">Optional notes for the AI planner (strategy preferences, constraints, etc.)</p>
                <textarea
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  placeholder="e.g. Keep Max away from the night stint. Prefer drivers with more free hours early in the race."
                  rows={2}
                  className="w-full bg-[#0a0f1c] border border-[#1a2540] rounded px-3 py-2 text-white text-sm resize-none placeholder-[#8892a4] focus:outline-none focus:border-[#0066cc]"
                />
              </div>
            )}

            {/* Race config */}
            <Card header="Race Configuration">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-[#8892a4] text-xs mb-1">Duration (hours)</label>
                  <input
                    type="number" step="0.5" min="1" max="48"
                    value={session.config.duration_hours ?? ''}
                    onChange={e => updateConfig('duration_hours', parseFloat(e.target.value) || 6)}
                    className="w-full bg-[#0a0f1c] border border-[#1a2540] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#0066cc]"
                    placeholder="6"
                  />
                </div>
                <div>
                  <label className="block text-[#8892a4] text-xs mb-1">Start Time</label>
                  <input
                    type="datetime-local"
                    value={session.config.start_time ?? ''}
                    onChange={e => updateConfig('start_time', e.target.value)}
                    className="w-full bg-[#0a0f1c] border border-[#1a2540] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#0066cc]"
                  />
                </div>
                <div>
                  <label className="block text-[#8892a4] text-xs mb-1">Min Stint (min)</label>
                  <input
                    type="number" step="15" min="15"
                    value={session.config.min_stint_mins ?? ''}
                    onChange={e => updateConfig('min_stint_mins', parseInt(e.target.value))}
                    className="w-full bg-[#0a0f1c] border border-[#1a2540] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#0066cc]"
                    placeholder="45"
                  />
                </div>
                <div>
                  <label className="block text-[#8892a4] text-xs mb-1">Max Stint (min)</label>
                  <input
                    type="number" step="15" min="15"
                    value={session.config.max_stint_mins ?? ''}
                    onChange={e => updateConfig('max_stint_mins', parseInt(e.target.value))}
                    className="w-full bg-[#0a0f1c] border border-[#1a2540] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#0066cc]"
                    placeholder="180"
                  />
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-[#1a2540]">
                <p className="text-[#8892a4] text-xs">
                  Plan uses <span className="text-white font-semibold">45-minute blocks</span> ·{' '}
                  <span className="text-white font-semibold">{numBlocks} blocks</span> total ({durationHours}h)
                </p>
              </div>
            </Card>

            {/* Driver selection */}
            <Card header="Drivers">
              {/* Team auto-load */}
              {teamList.length > 0 && (
                <div className="mb-4">
                  <label className="block text-[#8892a4] text-xs mb-1.5">Load from team</label>
                  <select
                    value={session.config.team_id ?? ''}
                    onChange={e => handleSelectTeam(e.target.value === '' ? '' : Number(e.target.value) as any)}
                    className="w-full sm:w-72 bg-[#0a0f1c] border border-[#1a2540] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#0066cc]"
                  >
                    <option value="">— pick a team to auto-select drivers —</option>
                    {teamList.map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({t.member_count} members)</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Manual driver toggles */}
              <div>
                <p className="text-[#8892a4] text-xs mb-2">Or toggle drivers manually:</p>
                {allDrivers.length === 0 ? (
                  <p className="text-[#8892a4] text-sm">No registered users found.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {allDrivers.map(d => {
                      const selected = session.config.selected_drivers?.includes(d.id) ?? false;
                      return (
                        <button
                          key={d.id}
                          onClick={() => toggleDriver(d.id)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all ${
                            selected
                              ? 'bg-[#0066cc]/30 border-[#0066cc] text-white'
                              : 'bg-[#0a0f1c] border-[#1a2540] text-[#8892a4] hover:border-[#0066cc]/40 hover:text-white'
                          }`}
                        >
                          {d.iracing_name || d.username}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {sessionDrivers.length === 0 && allDrivers.length > 0 && (
                <p className="text-yellow-400/80 text-xs mt-3">⚠ Select at least one driver to enable the availability grid and plan generation.</p>
              )}
            </Card>

            {/* Availability overview */}
            {sessionDrivers.length > 0 && (
              <Card header="Availability Overview" padding={false}>
                <div className="p-4 overflow-x-auto">
                  {sessionDrivers.length === 0 ? (
                    <p className="text-[#8892a4] text-sm">No drivers selected.</p>
                  ) : (
                    <AvailabilityOverview
                      availability={session.availability}
                      sessionDrivers={sessionDrivers}
                      startISO={session.config.start_time}
                      durationHours={durationHours}
                    />
                  )}
                </div>
              </Card>
            )}

            {/* Add availability */}
            {sessionDrivers.length > 0 && (
              <Card header="Add Your Availability" padding={false}>
                <div className="p-4">
                  <p className="text-[#8892a4] text-xs mb-4">
                    Select periods when each driver is available. Times are shown in your local timezone.
                  </p>
                  <AvailabilityFormCard
                    key={session.id}
                    sessionDrivers={sessionDrivers}
                    raceDates={getRaceDates(session.config.start_time, durationHours)}
                    raceStartStr={session.config.start_time}
                    onSave={handleSaveAvailPeriod}
                  />
                </div>
              </Card>
            )}

            {/* Generated plan */}
            {session.plan && session.plan.length > 0 && numBlocks > 0 && (
              <Card
                header={
                  <div className="flex items-center justify-between w-full">
                    <span className="font-heading font-semibold text-white">
                      Stint Plan · {session.plan.length} stints
                    </span>
                    <Button size="sm" variant="secondary" onClick={handleAddBlock}>+ Add Stint</Button>
                  </div>
                }
                padding={false}
              >
                <div className="p-4">
                  {explanation && (
                    <div className="mb-4 p-3 bg-[#0066cc]/10 border border-[#0066cc]/20 rounded-lg">
                      <p className="text-[#8892a4] text-xs">AI Strategy Note</p>
                      <p className="text-white text-sm mt-0.5">{explanation}</p>
                    </div>
                  )}

                  <StintCardList
                    plan={session.plan}
                    startISO={session.config.start_time}
                    onReorder={handleReorderPlan}
                    onEdit={i => { setEditingBlockIdx(i); setAddingBlock(false); }}
                    onDelete={handleDeletePlanBlock}
                  />
                </div>
              </Card>
            )}

            {/* Empty plan CTA */}
            {(!session.plan || session.plan.length === 0) && sessionDrivers.length > 0 && (
              <div className="text-center py-12 bg-[#0d1525] border border-[#1a2540] rounded-xl">
                <p className="text-3xl mb-3">📊</p>
                <p className="text-white font-heading font-semibold mb-1">No plan yet</p>
                <p className="text-[#8892a4] text-sm mb-4">
                  Set driver availability above, then click <strong>Generate</strong> to create an AI-powered plan.
                </p>
                <Button onClick={handleGeneratePlan} loading={planning}>Generate Plan</Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Block editor modal */}
      <BlockEditModal
        open={editingBlockIdx !== null || addingBlock}
        block={editingBlock}
        blockIdx={editingBlockIdx ?? -1}
        numBlocks={numBlocks || 1}
        drivers={sessionDrivers}
        onSave={handleSavePlanBlock}
        onClose={() => { setEditingBlockIdx(null); setAddingBlock(false); }}
      />
    </div>
  );
}
