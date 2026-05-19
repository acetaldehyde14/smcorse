'use client';

import { useState, useEffect, useCallback } from 'react';
import { setups as setupsApi } from '@/lib/api';
import type { Setup } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';

// ── SetupCard ────────────────────────────────────────────────────────────────

function SetupCard({
  setup,
  isAdmin,
  onDownload,
  onDelete,
}: {
  setup: Setup;
  isAdmin: boolean;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const date = new Date(setup.created_at).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });

  return (
    <div className="bg-[#0d1525] border border-[#1a2540] rounded-xl p-5 hover:border-[#0066cc]/50 transition-colors flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-heading font-semibold text-white truncate">{setup.label}</p>
          <p className="text-[#00aaff] text-xs mt-0.5 truncate">{setup.track_name}</p>
          <p className="text-[#8892a4] text-xs truncate">{setup.car_name}</p>
        </div>
        {isAdmin && (
          <button
            onClick={onDelete}
            title="Delete setup"
            className="flex-shrink-0 text-[#8892a4] hover:text-red-400 transition-colors p-1.5 rounded hover:bg-red-500/10"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>

      {setup.notes && (
        <p className="text-[#8892a4] text-xs line-clamp-2">{setup.notes}</p>
      )}

      <div className="flex items-center justify-between border-t border-[#1a2540] pt-3 mt-auto">
        <span className="text-[#667085] text-xs">{date}</span>
        <button
          onClick={onDownload}
          className="inline-flex items-center gap-1.5 text-xs font-semibold font-heading text-[#00aaff] hover:text-white border border-[#00aaff]/40 hover:border-[#00aaff] px-3 py-1.5 rounded-lg transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download
        </button>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

const EMPTY_FORM = { track_name: '', car_name: '', label: '', notes: '', file: null as File | null };

export default function SetupsPage() {
  const { user } = useAuth();
  const toast = useToast();

  const [items, setItems] = useState<Setup[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTrack, setFilterTrack] = useState('');
  const [filterCar, setFilterCar] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [uploading, setUploading] = useState(false);

  const fetchSetups = useCallback(async (track?: string, car?: string) => {
    setLoading(true);
    try {
      const data = await setupsApi.list(track || undefined, car || undefined);
      setItems(data);
    } catch (e: any) {
      toast(e.message ?? 'Failed to load setups', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchSetups(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFilter = () => fetchSetups(filterTrack, filterCar);

  const handleClear = () => {
    setFilterTrack('');
    setFilterCar('');
    fetchSetups();
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('track_name', form.track_name);
      fd.append('car_name', form.car_name);
      fd.append('label', form.label);
      fd.append('notes', form.notes);
      fd.append('file', form.file);
      await setupsApi.upload(fd);
      toast('Setup uploaded', 'success');
      setShowModal(false);
      setForm({ ...EMPTY_FORM });
      fetchSetups();
    } catch (e: any) {
      toast(e.message ?? 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this setup?')) return;
    try {
      await setupsApi.delete(id);
      toast('Setup deleted', 'info');
      setItems((prev) => prev.filter((s) => s.id !== id));
    } catch (e: any) {
      toast(e.message ?? 'Delete failed', 'error');
    }
  };

  return (
    <div className="space-y-6 px-6 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading font-bold text-2xl text-white">Car Setups</h1>
          <p className="text-[#8892a4] text-sm mt-0.5">Download and share iRacing setup files</p>
        </div>
        {user?.is_admin && (
          <button
            onClick={() => setShowModal(true)}
            className="bg-[#0066cc] hover:bg-[#005bb5] text-white font-heading font-semibold text-sm px-4 py-2 rounded-lg transition-colors inline-flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Upload Setup
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[#8892a4] font-body">Track</label>
          <input
            value={filterTrack}
            onChange={(e) => setFilterTrack(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleFilter()}
            placeholder="e.g. Spa"
            className="bg-[#0d1525] border border-[#1a2540] focus:border-[#0066cc] rounded-lg px-3 py-2 text-white text-sm placeholder-[#8892a4] outline-none transition-colors w-48"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[#8892a4] font-body">Car</label>
          <input
            value={filterCar}
            onChange={(e) => setFilterCar(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleFilter()}
            placeholder="e.g. Porsche"
            className="bg-[#0d1525] border border-[#1a2540] focus:border-[#0066cc] rounded-lg px-3 py-2 text-white text-sm placeholder-[#8892a4] outline-none transition-colors w-48"
          />
        </div>
        <button
          onClick={handleFilter}
          className="bg-[#0066cc] hover:bg-[#005bb5] text-white font-heading font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
        >
          Filter
        </button>
        {(filterTrack || filterCar) && (
          <button
            onClick={handleClear}
            className="border border-[#1a2540] hover:border-[#0066cc] text-[#8892a4] hover:text-white font-heading font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Setup grid */}
      {loading ? (
        <div className="text-center py-20 text-[#8892a4]">Loading setups...</div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-[#0d1525] border border-[#1a2540] flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-[#8892a4]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="font-heading font-semibold text-white mb-1">No setups yet</p>
          <p className="text-[#8892a4] text-sm">
            {user?.is_admin ? 'Upload the first setup using the button above.' : 'No setups have been uploaded yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((setup) => (
            <SetupCard
              key={setup.id}
              setup={setup}
              isAdmin={!!user?.is_admin}
              onDownload={() => setupsApi.download(setup.id, setup.filename)}
              onDelete={() => handleDelete(setup.id)}
            />
          ))}
        </div>
      )}

      {/* Upload modal — admin only */}
      {showModal && user?.is_admin && (
        <Modal
          open={showModal}
          onClose={() => { setShowModal(false); setForm({ ...EMPTY_FORM }); }}
          title="Upload Setup"
          maxWidth="max-w-md"
        >
          <form onSubmit={handleUpload} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-body text-[#8892a4] uppercase tracking-wider">Track / Car Combination *</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  required
                  value={form.track_name}
                  onChange={(e) => setForm((f) => ({ ...f, track_name: e.target.value }))}
                  placeholder="Track (e.g. Spa)"
                  className="bg-[#0a0f1c] border border-[#1a2540] focus:border-[#0066cc] rounded-lg px-3 py-2 text-white text-sm placeholder-[#8892a4] outline-none transition-colors"
                />
                <input
                  required
                  value={form.car_name}
                  onChange={(e) => setForm((f) => ({ ...f, car_name: e.target.value }))}
                  placeholder="Car (e.g. Porsche 992)"
                  className="bg-[#0a0f1c] border border-[#1a2540] focus:border-[#0066cc] rounded-lg px-3 py-2 text-white text-sm placeholder-[#8892a4] outline-none transition-colors"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-body text-[#8892a4]">Label *</label>
              <input
                required
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Spa quali — low fuel"
                className="bg-[#0a0f1c] border border-[#1a2540] focus:border-[#0066cc] rounded-lg px-3 py-2 text-white text-sm placeholder-[#8892a4] outline-none transition-colors"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-body text-[#8892a4]">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional notes about this setup..."
                rows={3}
                className="bg-[#0a0f1c] border border-[#1a2540] focus:border-[#0066cc] rounded-lg px-3 py-2 text-white text-sm placeholder-[#8892a4] outline-none transition-colors resize-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-body text-[#8892a4]">Setup File (.sto) *</label>
              <input
                type="file"
                accept=".sto"
                required
                onChange={(e) => setForm((f) => ({ ...f, file: e.target.files?.[0] ?? null }))}
                className="text-sm text-[#8892a4] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:font-heading file:bg-[#0066cc] file:text-white hover:file:bg-[#005bb5] cursor-pointer"
              />
            </div>
            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={uploading}
                className="flex-1 bg-[#0066cc] hover:bg-[#005bb5] disabled:opacity-50 disabled:cursor-not-allowed text-white font-heading font-semibold text-sm py-2 rounded-lg transition-colors inline-flex items-center justify-center gap-2"
              >
                {uploading && (
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                )}
                {uploading ? 'Uploading...' : 'Upload Setup'}
              </button>
              <button
                type="button"
                onClick={() => { setShowModal(false); setForm({ ...EMPTY_FORM }); }}
                className="flex-1 bg-transparent border border-[#1a2540] hover:border-[#0066cc] text-white font-heading font-semibold text-sm py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
