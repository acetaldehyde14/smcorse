'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { teams as teamsApi, team as teamApi } from '@/lib/api';
import type { Team, TeamMember, Driver } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { useToast } from '@/components/ui/Toast';

// ── Constants ────────────────────────────────────────────────────────────────

const ROLES = ['Driver', 'Engineer', 'Manager', 'Owner'] as const;
type Role = typeof ROLES[number];

const ROLE_BADGE_VARIANT: Record<Role, 'info' | 'success' | 'warning' | 'admin'> = {
  Driver: 'info',
  Engineer: 'success',
  Manager: 'warning',
  Owner: 'admin',
};

const EMPTY_FORM = {
  name: '',
  role: 'Driver' as Role,
  iracing_name: '',
  irating: '',
  safety_rating: '',
  preferred_car: '',
  discord_user_id: '',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Deterministic hue from a string, for avatar background coloring */
function nameHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return Math.abs(h) % 360;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function MemberCard({
  member,
  onEdit,
  onRemove,
}: {
  member: TeamMember;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const hue = nameHue(member.name);
  const roleBadgeVariant: 'success' | 'info' | 'active' | 'inactive' | 'admin' | 'warning' =
    (member.role ? ROLE_BADGE_VARIANT[member.role as Role] : undefined) ?? 'info';

  return (
    <div className="bg-[#0d1525] border border-[#1a2540] rounded-xl p-5 hover:border-[#0066cc]/50 transition-colors flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {/* Custom colored avatar */}
          <div
            className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center font-heading font-bold text-sm border"
            style={{
              background: `hsla(${hue}, 60%, 20%, 1)`,
              borderColor: `hsla(${hue}, 60%, 40%, 0.5)`,
              color: `hsl(${hue}, 70%, 70%)`,
            }}
          >
            {member.name
              .split(' ')
              .map((w) => w[0])
              .join('')
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-heading font-semibold text-white truncate">{member.name}</p>
            {member.iracing_name && (
              <p className="text-[#8892a4] text-xs truncate">{member.iracing_name}</p>
            )}
          </div>
        </div>
        {/* Action buttons */}
        <div className="flex gap-0.5 flex-shrink-0 ml-2">
          <button
            onClick={onEdit}
            title="Edit member"
            className="text-[#8892a4] hover:text-white transition-colors p-1.5 rounded hover:bg-white/5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={onRemove}
            title="Remove member"
            className="text-[#8892a4] hover:text-red-400 transition-colors p-1.5 rounded hover:bg-red-500/10"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Role + badge row */}
      <div className="flex flex-wrap gap-1.5">
        {member.role && (
          <Badge variant={roleBadgeVariant}>{member.role}</Badge>
        )}
        {member.discord_user_id && <Badge variant="info">Discord</Badge>}
        {member.telegram_chat_id && <Badge variant="success">Telegram</Badge>}
      </div>

      {/* Stats */}
      {(member.irating != null || member.safety_rating || member.preferred_car) && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs border-t border-[#1a2540] pt-3">
          {member.irating != null && (
            <div>
              <span className="text-[#8892a4]">iRating</span>
              <p className="text-white font-semibold">{member.irating.toLocaleString()}</p>
            </div>
          )}
          {member.safety_rating && (
            <div>
              <span className="text-[#8892a4]">Safety</span>
              <p className="text-white font-semibold">{member.safety_rating}</p>
            </div>
          )}
          {member.preferred_car && (
            <div className="col-span-2">
              <span className="text-[#8892a4]">Car: </span>
              <span className="text-white">{member.preferred_car}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const toast = useToast();

  // Teams
  const [teamList, setTeamList] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [teamsLoading, setTeamsLoading] = useState(true);

  // Inline "new team" input
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDiscordChannelId, setNewTeamDiscordChannelId] = useState('');
  const [newTeamDiscordRoleId, setNewTeamDiscordRoleId] = useState('');
  const [creatingTeamSubmitting, setCreatingTeamSubmitting] = useState(false);
  const newTeamInputRef = useRef<HTMLInputElement>(null);

  // Hovering over team row (for delete button)
  const [hoveredTeamId, setHoveredTeamId] = useState<number | null>(null);

  // Team settings
  const [teamSettings, setTeamSettings] = useState({
    name: '',
    description: '',
    discord_channel_id: '',
    discord_role_id: '',
  });
  const [teamSettingsSaving, setTeamSettingsSaving] = useState(false);
  const [discordTestSending, setDiscordTestSending] = useState(false);

  // Members for selected team
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  // Registered users for dropdown
  const [registeredUsers, setRegisteredUsers] = useState<Driver[]>([]);

  // Member modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editMember, setEditMember] = useState<TeamMember | null>(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);

  // ── Load initial data ──────────────────────────────────────────────────────

  const loadTeams = useCallback(async () => {
    try {
      const data = await teamsApi.list();
      setTeamList(data);
      if (data.length > 0 && selectedTeamId === null) {
        setSelectedTeamId(data[0].id);
      }
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setTeamsLoading(false);
    }
  }, [selectedTeamId, toast]);

  useEffect(() => {
    loadTeams();
    teamApi.drivers().then(setRegisteredUsers).catch(console.error);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load members when team changes ────────────────────────────────────────

  const loadMembers = useCallback(async () => {
    if (selectedTeamId === null) return;
    setMembersLoading(true);
    try {
      const data = await teamsApi.members(selectedTeamId);
      setMembers(data);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setMembersLoading(false);
    }
  }, [selectedTeamId, toast]);

  useEffect(() => {
    if (selectedTeamId !== null) loadMembers();
  }, [selectedTeamId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedTeam = teamList.find((t) => t.id === selectedTeamId) ?? null;

  useEffect(() => {
    if (!selectedTeam) return;
    setTeamSettings({
      name: selectedTeam.name,
      description: selectedTeam.description ?? '',
      discord_channel_id: selectedTeam.discord_channel_id ?? '',
      discord_role_id: selectedTeam.discord_role_id ?? '',
    });
  }, [selectedTeam]);

  // ── Focus inline input when shown ────────────────────────────────────────

  useEffect(() => {
    if (creatingTeam) {
      setTimeout(() => newTeamInputRef.current?.focus(), 50);
    }
  }, [creatingTeam]);

  // ── Team CRUD ─────────────────────────────────────────────────────────────

  const handleCreateTeam = async () => {
    const name = newTeamName.trim();
    if (!name) return;
    setCreatingTeamSubmitting(true);
    try {
      const created = await teamsApi.create({
        name,
        discord_channel_id: newTeamDiscordChannelId.trim() || null,
        discord_role_id: newTeamDiscordRoleId.trim() || null,
      });
      toast(`Team "${created.name}" created`, 'success');
      setNewTeamName('');
      setNewTeamDiscordChannelId('');
      setNewTeamDiscordRoleId('');
      setCreatingTeam(false);
      await loadTeams();
      setSelectedTeamId(created.id);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setCreatingTeamSubmitting(false);
    }
  };

  const handleNewTeamKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleCreateTeam();
    if (e.key === 'Escape') {
      setCreatingTeam(false);
      setNewTeamName('');
      setNewTeamDiscordChannelId('');
      setNewTeamDiscordRoleId('');
    }
  };

  const handleSaveTeamSettings = async () => {
    if (!selectedTeam) return;
    if (!teamSettings.name.trim()) {
      toast('Team name is required', 'error');
      return;
    }
    setTeamSettingsSaving(true);
    try {
      const updated = await teamsApi.update(selectedTeam.id, {
        name: teamSettings.name.trim(),
        description: teamSettings.description.trim() || undefined,
        discord_channel_id: teamSettings.discord_channel_id.trim() || null,
        discord_role_id: teamSettings.discord_role_id.trim() || null,
      });
      setTeamList((teams) => teams.map((team) => (
        team.id === updated.id ? { ...team, ...updated, member_count: team.member_count } : team
      )));
      toast('Team settings updated', 'success');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setTeamSettingsSaving(false);
    }
  };

  const handleTestDiscordAlert = async () => {
    if (!selectedTeam) return;
    setDiscordTestSending(true);
    try {
      await teamsApi.testDiscord(selectedTeam.id);
      toast('Discord test alert sent', 'success');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setDiscordTestSending(false);
    }
  };

  const handleDeleteTeam = async (id: number, name: string) => {
    if (!confirm(`Delete team "${name}"? This will also remove all its members.`)) return;
    try {
      await teamsApi.delete(id);
      toast(`Team "${name}" deleted`, 'info');
      const remaining = teamList.filter((t) => t.id !== id);
      setTeamList(remaining);
      if (selectedTeamId === id) {
        setSelectedTeamId(remaining.length > 0 ? remaining[0].id : null);
        setMembers([]);
      }
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  // ── Member CRUD ───────────────────────────────────────────────────────────

  const openAddMember = () => {
    setEditMember(null);
    setSelectedUserId('');
    setForm({ ...EMPTY_FORM });
    setModalOpen(true);
  };

  const openEditMember = (m: TeamMember) => {
    setEditMember(m);
    setSelectedUserId('');
    setForm({
      name: m.name,
      role: (m.role as Role) ?? 'Driver',
      iracing_name: m.iracing_name ?? '',
      irating: m.irating?.toString() ?? '',
      safety_rating: m.safety_rating ?? '',
      preferred_car: m.preferred_car ?? '',
      discord_user_id: m.discord_user_id ?? '',
    });
    setModalOpen(true);
  };

  const handleUserSelect = (userId: string) => {
    setSelectedUserId(userId);
    if (!userId) return;
    const user = registeredUsers.find((u) => String(u.id) === userId);
    if (!user) return;
    setForm((f) => ({
      ...f,
      name: user.iracing_name || user.username,
      iracing_name: user.iracing_name ?? '',
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeamId) return;
    setSubmitting(true);
    try {
      const payload: any = {
        ...form,
        irating: form.irating ? parseInt(form.irating, 10) : undefined,
      };
      if (selectedUserId) payload.linked_user_id = parseInt(selectedUserId, 10);

      if (editMember) {
        await teamsApi.updateMember(selectedTeamId, editMember.id, payload);
        toast('Member updated', 'success');
      } else {
        await teamsApi.addMember(selectedTeamId, payload);
        toast('Member added', 'success');
      }
      setModalOpen(false);
      await loadMembers();
      // Refresh team list to update member_count badges
      loadTeams();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveMember = async (memberId: number) => {
    if (!selectedTeamId) return;
    if (!confirm('Remove this member from the team?')) return;
    try {
      await teamsApi.removeMember(selectedTeamId, memberId);
      toast('Member removed', 'info');
      await loadMembers();
      loadTeams();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  // ── Derived state ──────────────────────────────────────────────────────────

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex gap-0 h-full min-h-[calc(100vh-120px)]">
      {/* ── Left Sidebar: Team List ─────────────────────────────── */}
      <aside className="w-64 flex-shrink-0 bg-[#0d1525] border-r border-[#1a2540] flex flex-col">
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-[#1a2540]">
          <h2 className="font-heading font-bold text-white text-sm uppercase tracking-wider">Teams</h2>
          <button
            onClick={() => setCreatingTeam(true)}
            title="Create new team"
            className="text-[#00aaff] hover:text-white border border-[#00aaff]/40 hover:border-[#00aaff] rounded-md px-2 py-0.5 text-xs font-semibold transition-colors"
          >
            + New
          </button>
        </div>

        {/* Inline new-team input */}
        {creatingTeam && (
          <div className="px-3 py-3 border-b border-[#1a2540] flex flex-col gap-2">
            <input
              ref={newTeamInputRef}
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              onKeyDown={handleNewTeamKeyDown}
              placeholder="Team name…"
              className="flex-1 bg-[#0a0f1c] border border-[#1a2540] focus:border-[#0066cc] rounded px-2 py-1.5 text-white text-sm placeholder-[#8892a4] outline-none transition-colors"
            />
            <input
              value={newTeamDiscordChannelId}
              onChange={(e) => setNewTeamDiscordChannelId(e.target.value)}
              placeholder="Discord Channel ID"
              className="bg-[#0a0f1c] border border-[#1a2540] focus:border-[#0066cc] rounded px-2 py-1.5 text-white text-sm placeholder-[#8892a4] outline-none transition-colors"
            />
            <input
              value={newTeamDiscordRoleId}
              onChange={(e) => setNewTeamDiscordRoleId(e.target.value)}
              placeholder="Discord Role ID (optional)"
              className="bg-[#0a0f1c] border border-[#1a2540] focus:border-[#0066cc] rounded px-2 py-1.5 text-white text-sm placeholder-[#8892a4] outline-none transition-colors"
            />
            <p className="text-[11px] leading-snug text-[#8892a4]">Right-click channel - Copy Channel ID. Optional: Role ID for @team ping.</p>
            <div className="flex items-center gap-2">
            <button
              onClick={handleCreateTeam}
              disabled={creatingTeamSubmitting || !newTeamName.trim()}
              title="Confirm"
              className="text-green-400 hover:text-green-300 disabled:opacity-40 p-1 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </button>
            <button
              onClick={() => {
                setCreatingTeam(false);
                setNewTeamName('');
                setNewTeamDiscordChannelId('');
                setNewTeamDiscordRoleId('');
              }}
              title="Cancel"
              className="text-[#8892a4] hover:text-red-400 p-1 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            </div>
          </div>
        )}

        {/* Team list */}
        <div className="flex-1 overflow-y-auto py-2">
          {teamsLoading ? (
            <p className="text-[#8892a4] text-xs px-4 py-3">Loading…</p>
          ) : teamList.length === 0 ? (
            <p className="text-[#8892a4] text-xs px-4 py-3">No teams yet. Create one above.</p>
          ) : (
            teamList.map((t) => {
              const isSelected = t.id === selectedTeamId;
              return (
                <div
                  key={t.id}
                  onClick={() => setSelectedTeamId(t.id)}
                  onMouseEnter={() => setHoveredTeamId(t.id)}
                  onMouseLeave={() => setHoveredTeamId(null)}
                  className={[
                    'group relative flex items-center justify-between px-4 py-2.5 cursor-pointer transition-colors',
                    isSelected
                      ? 'bg-[#0066cc]/20 border-l-2 border-[#0066cc]'
                      : 'border-l-2 border-transparent hover:bg-white/5',
                  ].join(' ')}
                >
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-semibold truncate ${isSelected ? 'text-white' : 'text-[#c8d0e0] group-hover:text-white'}`}>
                      {t.name}
                    </p>
                    <p className="text-[#8892a4] text-xs">
                      {t.member_count} {t.member_count === 1 ? 'member' : 'members'}
                    </p>
                    <p className={`text-[11px] ${t.discord_channel_id ? 'text-[#00aaff]' : 'text-[#667085]'}`}>
                      Discord: {t.discord_channel_id ? 'Channel configured' : 'Not configured'}
                    </p>
                  </div>
                  {/* Delete button — visible on hover */}
                  {hoveredTeamId === t.id && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteTeam(t.id, t.name); }}
                      title="Delete team"
                      className="flex-shrink-0 ml-2 text-[#8892a4] hover:text-red-400 transition-colors p-1 rounded hover:bg-red-500/10"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* ── Main Area: Members ──────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 px-6 py-6">
        {selectedTeam ? (
          <>
            {/* Main header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="font-heading font-bold text-2xl text-white">{selectedTeam.name}</h1>
                <p className="text-[#8892a4] text-sm mt-0.5">
                  {members.length} {members.length === 1 ? 'member' : 'members'}
                </p>
              </div>
              <button
                onClick={openAddMember}
                className="bg-[#0066cc] hover:bg-[#005bb5] text-white font-heading font-semibold text-sm px-4 py-2 rounded-lg transition-colors inline-flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Member
              </button>
            </div>

            <section className="bg-[#0d1525] border border-[#1a2540] rounded-xl p-4 mb-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="font-heading font-semibold text-white text-sm uppercase tracking-wider">Team Discord Alerts</h2>
                  <p className="text-[#8892a4] text-xs mt-0.5">
                    {selectedTeam.discord_channel_id ? 'Discord channel configured' : 'Not configured'}
                  </p>
                </div>
                <span className={`text-xs rounded-full px-2 py-1 border ${selectedTeam.discord_channel_id ? 'border-[#00aaff]/40 text-[#00aaff] bg-[#00aaff]/10' : 'border-[#1a2540] text-[#8892a4]'}`}>
                  Discord {selectedTeam.discord_channel_id ? 'Configured' : 'Not configured'}
                </span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Input
                  label="Team Name"
                  value={teamSettings.name}
                  onChange={(e) => setTeamSettings((s) => ({ ...s, name: e.target.value }))}
                />
                <Input
                  label="Description"
                  value={teamSettings.description}
                  onChange={(e) => setTeamSettings((s) => ({ ...s, description: e.target.value }))}
                  placeholder="Optional team description"
                />
                <Input
                  label="Discord Channel ID"
                  value={teamSettings.discord_channel_id}
                  onChange={(e) => setTeamSettings((s) => ({ ...s, discord_channel_id: e.target.value }))}
                  placeholder="Right-click channel - Copy Channel ID"
                />
                <Input
                  label="Discord Role ID"
                  value={teamSettings.discord_role_id}
                  onChange={(e) => setTeamSettings((s) => ({ ...s, discord_role_id: e.target.value }))}
                  placeholder="Optional: Role ID for @team ping"
                />
              </div>
              <p className="text-xs text-[#8892a4] mt-3">
                Enable Discord Developer Mode, then right-click the target channel and role to copy IDs.
              </p>
              <div className="flex flex-wrap gap-3 mt-4">
                <button
                  onClick={handleSaveTeamSettings}
                  disabled={teamSettingsSaving}
                  className="bg-[#0066cc] hover:bg-[#005bb5] disabled:opacity-50 text-white font-heading font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
                >
                  {teamSettingsSaving ? 'Saving...' : 'Save Team Settings'}
                </button>
                <button
                  onClick={handleTestDiscordAlert}
                  disabled={discordTestSending || !selectedTeam.discord_channel_id}
                  className="border border-[#1a2540] hover:border-[#00aaff] disabled:opacity-50 disabled:cursor-not-allowed text-white font-heading font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
                >
                  {discordTestSending ? 'Sending...' : 'Test Discord Alert'}
                </button>
              </div>
            </section>

            {/* Members grid */}
            {membersLoading ? (
              <div className="text-center py-16 text-[#8892a4]">Loading members…</div>
            ) : members.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-20">
                <div className="w-16 h-16 rounded-full bg-[#0d1525] border border-[#1a2540] flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-[#8892a4]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <p className="font-heading font-semibold text-white mb-1">No members yet</p>
                <p className="text-[#8892a4] text-sm mb-5">Add your first member to this team</p>
                <button
                  onClick={openAddMember}
                  className="bg-[#0066cc] hover:bg-[#005bb5] text-white font-heading font-semibold text-sm px-5 py-2.5 rounded-lg transition-colors"
                >
                  Add Member
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {members.map((m) => (
                  <MemberCard
                    key={m.id}
                    member={m}
                    onEdit={() => openEditMember(m)}
                    onRemove={() => handleRemoveMember(m.id)}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          /* No team selected / no teams */
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-[#0d1525] border border-[#1a2540] flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-[#8892a4]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <p className="font-heading font-semibold text-white mb-1">No team selected</p>
            <p className="text-[#8892a4] text-sm">
              {teamList.length === 0
                ? 'Create your first team using the sidebar.'
                : 'Select a team from the sidebar to manage its members.'}
            </p>
          </div>
        )}
      </main>

      {/* ── Add / Edit Member Modal ─────────────────────────────── */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editMember ? 'Edit Member' : 'Add Member'}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Registered user picker — only shown when adding */}
          {!editMember && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-body text-[#8892a4]">Select Registered User</label>
              <select
                value={selectedUserId}
                onChange={(e) => handleUserSelect(e.target.value)}
                className="bg-[#0a0f1c] border border-[#1a2540] focus:border-[#0066cc] rounded-lg px-3 py-2 text-white text-sm outline-none transition-colors font-body"
              >
                <option value="">— Enter manually —</option>
                {registeredUsers.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {u.iracing_name ? `${u.iracing_name} (${u.username})` : u.username}
                  </option>
                ))}
              </select>
              {selectedUserId && (
                <p className="text-xs text-[#00aaff]">Pre-filled from account — edit if needed</p>
              )}
            </div>
          )}

          <Input
            label="Name *"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
            placeholder="Full name"
            autoFocus={!selectedUserId}
          />

          <Select
            label="Role"
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>

          <Input
            label="iRacing Name"
            value={form.iracing_name}
            onChange={(e) => setForm((f) => ({ ...f, iracing_name: e.target.value }))}
            placeholder="In-sim name"
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="iRating"
              type="number"
              min={0}
              value={form.irating}
              onChange={(e) => setForm((f) => ({ ...f, irating: e.target.value }))}
              placeholder="e.g. 3500"
            />
            <Input
              label="Safety Rating"
              value={form.safety_rating}
              onChange={(e) => setForm((f) => ({ ...f, safety_rating: e.target.value }))}
              placeholder="e.g. A 3.50"
            />
          </div>

          <Input
            label="Preferred Car"
            value={form.preferred_car}
            onChange={(e) => setForm((f) => ({ ...f, preferred_car: e.target.value }))}
            placeholder="e.g. Porsche 992 GT3 R"
          />

          <Input
            label="Discord User ID"
            value={form.discord_user_id}
            onChange={(e) => setForm((f) => ({ ...f, discord_user_id: e.target.value }))}
            placeholder="18-digit Discord ID"
          />

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-[#0066cc] hover:bg-[#005bb5] disabled:opacity-50 disabled:cursor-not-allowed text-white font-heading font-semibold text-sm py-2 rounded-lg transition-colors inline-flex items-center justify-center gap-2"
            >
              {submitting && (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              )}
              {editMember ? 'Save Changes' : 'Add Member'}
            </button>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="flex-1 bg-transparent border border-[#1a2540] hover:border-[#0066cc] text-white font-heading font-semibold text-sm py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
