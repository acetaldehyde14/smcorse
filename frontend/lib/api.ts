import type {
  User, Race, RaceState, RaceEvent, StintRosterEntry,
  Team, TeamMember, Driver, RaceCalendarEvent,
  Session, Lap, StintPlannerSession, RaceStintPlan, StintPlanAdvance, RaceLap,
  LiveFrame, LiveSessionSummary, LapFeatures, LapChannels, AllLap
} from './types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* noop */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

function get<T>(path: string) {
  return request<T>(path);
}
function post<T>(path: string, body: unknown) {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
}
function patch<T>(path: string, body: unknown) {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}
function put<T>(path: string, body: unknown) {
  return request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
}
function del<T>(path: string) {
  return request<T>(path, { method: 'DELETE' });
}

// ── Auth ───────────────────────────────────────────────────────
export const auth = {
  me: () => get<User>('/api/user'),
  login: (email: string, password: string) =>
    post<{ message: string }>('/api/login', { email, password }),
  signup: (name: string, username: string, email: string, password: string) =>
    post<{ message: string }>('/api/signup', { name, username, email, password }),
  logout: () => post<void>('/api/logout', {}),
};

// ── Races ──────────────────────────────────────────────────────
export const races = {
  list: () => get<Race[]>('/api/races'),
  active: () => get<Race>('/api/races/active'),
  create: (name: string, track?: string) => post<Race>('/api/races', { name, track }),
  start: (id: number) => post<Race>(`/api/races/${id}/start`, {}),
  end: (id: number) => post<Race>(`/api/races/${id}/end`, {}),
  state: (id: number) => get<{ race: Race; state: RaceState | null; last_fuel: RaceEvent | null }>(`/api/races/${id}/state`),
  events: (id: number, limit = 50) => get<RaceEvent[]>(`/api/races/${id}/events?limit=${limit}`),
  laps: (id: number) => get<RaceLap[]>(`/api/races/${id}/laps`),
  postEvent: (id: number, body: Partial<RaceEvent>) => post<{ ok: boolean; stintPlanInfo?: StintPlanAdvance | null }>(`/api/races/${id}/event`, body),
  getRoster: (id: number) => get<StintRosterEntry[]>(`/api/races/${id}/roster`),
  saveRoster: (id: number, roster: { driver_user_id: number; stint_order: number; planned_duration_mins?: number }[]) =>
    post<{ ok: boolean; count: number }>(`/api/races/${id}/roster`, { roster }),
  getStintPlan: (id: number) => get<RaceStintPlan>(`/api/races/${id}/stint-plan`),
  linkStintPlan: (id: number, session_id: number | null) =>
    post<Race>(`/api/races/${id}/stint-plan`, { session_id }),
};

// ── Race Events (Calendar) ─────────────────────────────────────
export const calendar = {
  list: () => get<RaceCalendarEvent[]>('/api/races/events'),
  create: (data: Partial<RaceCalendarEvent>) => post<RaceCalendarEvent>('/api/races/events', data),
  delete: (id: number) => del<{ ok: boolean }>(`/api/races/events/${id}`),
};

// ── Teams (multi-team management) ────────────────────────────
export const teams = {
  list: () => get<Team[]>('/api/teams'),
  create: (name: string, description?: string) => post<Team>('/api/teams', { name, description }),
  delete: (id: number) => del<{ ok: boolean }>(`/api/teams/${id}`),
  members: (teamId: number) => get<TeamMember[]>(`/api/teams/${teamId}/members`),
  addMember: (teamId: number, data: Partial<TeamMember> & { linked_user_id?: number }) =>
    post<TeamMember>(`/api/teams/${teamId}/members`, data),
  updateMember: (teamId: number, memberId: number, data: Partial<TeamMember>) =>
    put<TeamMember>(`/api/teams/${teamId}/members/${memberId}`, data),
  removeMember: (teamId: number, memberId: number) =>
    del<{ ok: boolean }>(`/api/teams/${teamId}/members/${memberId}`),
};

// ── Team ──────────────────────────────────────────────────────
export const team = {
  members: () => get<TeamMember[]>('/api/team/members'),
  addMember: (data: Partial<TeamMember>) => post<TeamMember>('/api/team/members', data),
  updateMember: (id: number, data: Partial<TeamMember>) => put<TeamMember>(`/api/team/members/${id}`, data),
  deleteMember: (id: number) => del<{ ok: boolean }>(`/api/team/members/${id}`),
  drivers: () => get<Driver[]>('/api/team/drivers'),
  profile: () => get<User>('/api/team/profile'),
  updateProfile: (data: Partial<User>) => patch<User>('/api/team/profile', data),
  updateUsername: (username: string) => patch<{ id: number; username: string }>('/api/team/profile/username', { username }),
  updatePassword: (current_password: string, new_password: string) => post<{ message: string }>('/api/team/profile/password', { current_password, new_password }),
};

// ── Telemetry ─────────────────────────────────────────────────
export const telemetry = {
  sessions:    () => get<{ sessions: Session[] }>('/api/telemetry/sessions').then(r => r.sessions),
  session:     (id: number) => get<{ session: Session; laps: Lap[] }>(`/api/telemetry/sessions/${id}`),
  allLaps:     () => get<{ laps: AllLap[] }>('/api/telemetry/all-laps').then(r => r.laps),
  lapTelemetry:(id: number) => get<{ lap: { id: number; lap_number: number; lap_time: number; track: string; car: string }; source: string; telemetry: LiveFrame[] | Record<string, unknown> }>(`/api/telemetry/laps/${id}/telemetry`),
  lapChannels: (id: number) => get<LapChannels>(`/api/telemetry/laps/${id}/channels`),
  lapFeatures: (id: number) => get<{ features: LapFeatures }>(`/api/telemetry/laps/${id}/features`),
  liveFrames:  (sessionId: number, sinceTime = 0, limit = 300) =>
    get<{ session_id: number; latest_session_time: number; frames: LiveFrame[] }>(
      `/api/telemetry/live/session/${sessionId}/frames?since_session_time=${sinceTime}&limit=${limit}`
    ),
  liveSummary: (sessionId: number) => get<LiveSessionSummary>(`/api/telemetry/live/session/${sessionId}/summary`),
  liveStatus:  (sessionId: number) => get<{ session: Session; frame_count: number; lap_count: number }>(`/api/telemetry/live/session/${sessionId}/status`),
};

// ── Stint Planner ─────────────────────────────────────────────
export const stintPlanner = {
  list: () => get<StintPlannerSession[]>('/api/team/stint-sessions'),
  get: (id: number) => get<StintPlannerSession>(`/api/team/stint-sessions/${id}`),
  create: (name: string) => post<StintPlannerSession>('/api/team/stint-sessions', { name }),
  update: (id: number, data: Partial<StintPlannerSession>) =>
    put<StintPlannerSession>(`/api/team/stint-sessions/${id}`, data),
  delete: (id: number) => del<{ ok: boolean }>(`/api/team/stint-sessions/${id}`),
  aiPlan: (id: number, userPrompt?: string) => post<{ plan: StintPlannerSession['plan']; explanation: string; blockMinutes: number; numBlocks: number }>(
    '/api/team/stint-planner/ai-plan', { session_id: id, userPrompt: userPrompt || '' }
  ),
};

// ── Admin ─────────────────────────────────────────────────────
export const admin = {
  stats: () => get<Record<string, number>>('/api/admin/stats'),
  users: () => get<User[]>('/api/admin/users'),
  setAdmin: (id: number, is_admin: boolean) =>
    patch<void>(`/api/admin/users/${id}/admin`, { is_admin }),
  deleteUser: (id: number) => del<void>(`/api/admin/users/${id}`),
};
