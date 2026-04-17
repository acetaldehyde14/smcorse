'use client';

import { useState, useEffect, useCallback } from 'react';
import { calendar as calendarApi } from '@/lib/api';
import type { RaceCalendarEvent } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';

function useCountdown(targetDate: string) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const update = () => {
      const diff = new Date(targetDate).getTime() - Date.now();
      if (diff <= 0) { setTimeLeft('Race started!'); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setTimeLeft(`${d}d ${h}h ${m}m`);
    };
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, [targetDate]);

  return timeLeft;
}

function EventCard({ event, onDelete }: { event: RaceCalendarEvent; onDelete: () => void }) {
  const countdown = useCountdown(event.race_date);
  const isPast = new Date(event.race_date) < new Date();

  return (
    <div className={`bg-dark-card border rounded-xl p-5 transition-colors ${isPast ? 'border-dark-border opacity-60' : 'border-dark-border hover:border-primary/50'}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-heading font-semibold text-white text-lg mb-1">{event.name}</h3>
          <div className="flex flex-wrap gap-2">
            {event.series && <Badge variant="info">{event.series}</Badge>}
            {event.car_class && <Badge variant="inactive">{event.car_class}</Badge>}
          </div>
        </div>
        <button onClick={onDelete} className="text-dark-muted hover:text-red-400 transition-colors p-1">✕</button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
        {event.track && (
          <div>
            <span className="text-dark-muted text-xs block">Track</span>
            <span className="text-white">{event.track}</span>
          </div>
        )}
        {event.duration_hours && (
          <div>
            <span className="text-dark-muted text-xs block">Duration</span>
            <span className="text-white">{event.duration_hours}h</span>
          </div>
        )}
        <div>
          <span className="text-dark-muted text-xs block">Date</span>
          <span className="text-white">{new Date(event.race_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>
        <div>
          <span className="text-dark-muted text-xs block">Time</span>
          <span className="text-white">{new Date(event.race_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>

      {!isPast && (
        <div className="bg-primary/10 border border-primary/20 rounded-lg px-4 py-2 text-center">
          <span className="text-dark-muted text-xs block">Countdown</span>
          <span className="text-accent font-heading font-bold text-lg">{countdown}</span>
        </div>
      )}
      {isPast && (
        <div className="text-center">
          <Badge variant="inactive">Completed</Badge>
        </div>
      )}
    </div>
  );
}

export default function CalendarPage() {
  const toast = useToast();
  const [events, setEvents] = useState<RaceCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', track: '', series: '', car_class: '', race_date: '', duration_hours: '' });
  const [submitting, setSubmitting] = useState(false);

  const loadEvents = useCallback(async () => {
    try {
      const data = await calendarApi.list();
      setEvents(data);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await calendarApi.create({
        ...form,
        duration_hours: form.duration_hours ? parseFloat(form.duration_hours) : undefined,
      });
      setCreateOpen(false);
      setForm({ name: '', track: '', series: '', car_class: '', race_date: '', duration_hours: '' });
      toast('Event created', 'success');
      loadEvents();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this event?')) return;
    try {
      await calendarApi.delete(id);
      toast('Event deleted', 'info');
      loadEvents();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const upcoming = events.filter(e => new Date(e.race_date) >= new Date());
  const past = events.filter(e => new Date(e.race_date) < new Date());

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading font-bold text-2xl text-white">Race Calendar</h1>
          <p className="text-dark-muted text-sm">Upcoming events and countdowns</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ Add Event</Button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-dark-muted">Loading events…</div>
      ) : events.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-4xl mb-4">🗓️</p>
          <p className="font-heading font-semibold text-white mb-2">No events scheduled</p>
          <p className="text-dark-muted mb-6">Add your first race event to start tracking countdowns</p>
          <Button onClick={() => setCreateOpen(true)}>Add Event</Button>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <div className="mb-8">
              <h2 className="font-heading font-semibold text-white mb-4 flex items-center gap-2">
                <span className="text-accent">●</span> Upcoming ({upcoming.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {upcoming.map(ev => (
                  <EventCard key={ev.id} event={ev} onDelete={() => handleDelete(ev.id)} />
                ))}
              </div>
            </div>
          )}
          {past.length > 0 && (
            <div>
              <h2 className="font-heading font-semibold text-dark-muted mb-4">Past Events ({past.length})</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {past.map(ev => (
                  <EventCard key={ev.id} event={ev} onDelete={() => handleDelete(ev.id)} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Add Race Event">
        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          <Input label="Event Name *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required autoFocus placeholder="e.g. Spa 6 Hours" />
          <Input label="Track" value={form.track} onChange={e => setForm(f => ({ ...f, track: e.target.value }))} placeholder="e.g. Spa-Francorchamps" />
          <Input label="Series" value={form.series} onChange={e => setForm(f => ({ ...f, series: e.target.value }))} placeholder="e.g. iRacing Endurance" />
          <Input label="Car Class" value={form.car_class} onChange={e => setForm(f => ({ ...f, car_class: e.target.value }))} placeholder="e.g. GTP, GT3" />
          <Input label="Race Date & Time *" type="datetime-local" value={form.race_date} onChange={e => setForm(f => ({ ...f, race_date: e.target.value }))} required />
          <Input label="Duration (hours)" type="number" step="0.5" value={form.duration_hours} onChange={e => setForm(f => ({ ...f, duration_hours: e.target.value }))} placeholder="e.g. 6" />
          <div className="flex gap-3 pt-2">
            <Button type="submit" loading={submitting} className="flex-1 justify-center">Add Event</Button>
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)} className="flex-1 justify-center">Cancel</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
