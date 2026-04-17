// ── Auth ───────────────────────────────────────────────────────
export interface User {
  id: number;
  username: string;
  email: string;
  is_admin: boolean;
  iracing_name?: string;
  iracing_id?: string;
  telegram_chat_id?: string;
  discord_user_id?: string;
  discord_webhook?: string;
  avatar_url?: string;
}

// ── Races ──────────────────────────────────────────────────────
export interface Race {
  id: number;
  name: string;
  track?: string;
  is_active: boolean;
  started_at?: string;
  ended_at?: string;
  created_at: string;
  active_stint_session_id?: number | null;
  current_driver_name?: string | null;
  stint_started_at?: string | null;
  event_count?: number;
}

export interface NearbyCar {
  position: number;
  driver_name: string;
  gap: number | null;   // seconds; negative = ahead of us, positive = behind
  is_us: boolean;
  laps: number | null;
  last_lap: number | null;
}

export interface RaceState {
  race_id: number;
  current_driver_name?: string;
  last_fuel_level?: number;
  low_fuel_notified: boolean;
  last_event_at?: string;
  // standings
  position?: number | null;
  class_position?: number | null;
  gap_to_leader?: number | null;
  gap_ahead?: number | null;
  gap_behind?: number | null;
  laps_completed?: number | null;
  last_lap_time?: number | null;
  best_lap_time?: number | null;
  nearby_cars?: NearbyCar[] | null;
}

export interface RaceEvent {
  id: number;
  event_type: 'driver_change' | 'fuel_update';
  race_id: number;
  driver_name?: string;
  fuel_level?: number;
  fuel_pct?: number;
  mins_remaining?: number;
  created_at: string;
  reporter_username?: string;
}

export interface StintRosterEntry {
  id: number;
  race_id: number;
  driver_user_id: number;
  stint_order: number;
  planned_duration_mins?: number;
  username: string;
  iracing_name?: string;
  has_telegram: boolean;
  has_discord: boolean;
}

// ── Teams ─────────────────────────────────────────────────────
export interface Team {
  id: number;
  name: string;
  description?: string;
  member_count: number;
  created_at: string;
}

// ── Team ──────────────────────────────────────────────────────
export interface TeamMember {
  id: number;
  team_id?: number;
  user_id?: number;
  name: string;
  role?: string;
  iracing_name?: string;
  irating?: number;
  safety_rating?: string;
  preferred_car?: string;
  discord_user_id?: string;
  telegram_chat_id?: string;
  created_at: string;
}

export interface Driver {
  id: number;
  username: string;
  iracing_name?: string;
}

// ── Race Events (Calendar) ─────────────────────────────────────
export interface RaceCalendarEvent {
  id: number;
  name: string;
  track?: string;
  series?: string;
  car_class?: string;
  race_date: string;
  duration_hours?: number;
  signup_open: boolean;
  created_by?: number;
  created_by_username?: string;
  created_at: string;
}

// ── Sessions / Telemetry ──────────────────────────────────────
export interface Session {
  id: number;
  track_name?: string;
  car_name?: string;
  session_type?: string;
  lap_count: number;
  best_lap_time?: number;
  created_at: string;
}

export interface Lap {
  id: number;
  session_id: number;
  lap_number: number;
  lap_time: number;
  is_valid: boolean;
}

export interface RaceLap {
  lap_number: number | null;
  driver_name: string | null;
  lap_time: number;
  session_time: number | null;
  recorded_at: string;
}

// ── Race Stint Plan (live link) ───────────────────────────────
export interface RaceStintPlan {
  session: StintPlannerSession | null;
  current_index: number;
  stint_started_at: string | null;
  race_started_at: string | null;
}

export interface StintPlanAdvance {
  isSameDriver: boolean;
  deviationMins: number | null;
  nextNextDriverName: string | null;
  plannedDurationMins: number | null;
  currentIndex: number;
  totalBlocks: number;
  delta?: number;
}

// ── Stint Planner ─────────────────────────────────────────────
export interface StintPlannerSession {
  id: number;
  name: string;
  config: StintConfig;
  availability: AvailabilityMap;
  plan: StintBlock[];
  created_at: string;
  updated_at: string;
}

export interface StintConfig {
  race_name?: string;
  race_date?: string;
  duration_hours?: number;
  start_time?: string;
  min_stint_mins?: number;
  max_stint_mins?: number;
  selected_drivers?: number[];
  team_id?: number;
}

export type AvailabilityStatus = 'unknown' | 'free' | 'inconvenient' | 'unavailable';
export type AvailabilityMap = Record<string, Record<string, AvailabilityStatus>>; // driver_id → hour_key → status

export interface StintBlock {
  driver_id?: number;
  driver_name?: string;
  driver?: string;
  start_hour?: number;
  duration_hours?: number;
  startBlock?: number;
  endBlock?: number;
  startTime?: string;
  endTime?: string;
  color?: string;
}
