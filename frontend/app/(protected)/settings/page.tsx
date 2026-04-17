'use client';

import { useState, useEffect } from 'react';
import { team as teamApi } from '@/lib/api';
import type { User } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';

export default function SettingsPage() {
  const toast = useToast();
  const { user, refresh } = useAuth();
  const [profile, setProfile] = useState<Partial<User>>({});
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [username, setUsername] = useState('');
  const [editingUsername, setEditingUsername] = useState(false);
  const [savingUsername, setSavingUsername] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    teamApi.profile().then(p => {
      setProfile({ iracing_name: p.iracing_name ?? '', discord_user_id: p.discord_user_id ?? '', discord_webhook: p.discord_webhook ?? '' });
      setUsername(p.username ?? '');
      setLoaded(true);
    }).catch(console.error);
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await teamApi.updateProfile(profile);
      await refresh();
      toast('Settings saved', 'success');
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleUsernameChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingUsername(true);
    try {
      await teamApi.updateUsername(username);
      await refresh();
      toast('Username updated', 'success');
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSavingUsername(false); }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { toast('New passwords do not match', 'error'); return; }
    setSavingPassword(true);
    try {
      await teamApi.updatePassword(currentPassword, newPassword);
      toast('Password updated', 'success');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSavingPassword(false); }
  };

  if (!loaded) return <div className="text-center py-12 text-dark-muted">Loading…</div>;

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="font-heading font-bold text-2xl text-white">Settings</h1>
        <p className="text-dark-muted text-sm">Manage your profile and notification preferences</p>
      </div>

      {/* Profile */}
      <form onSubmit={handleUsernameChange} className="flex flex-col gap-6 mb-6">
        <Card header="Profile">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center font-heading font-bold text-accent text-lg flex-shrink-0">
                {user?.username?.[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                {editingUsername ? (
                  <input
                    autoFocus
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    onBlur={() => setEditingUsername(false)}
                    onKeyDown={e => { if (e.key === 'Escape') { setUsername(user?.username ?? ''); setEditingUsername(false); } }}
                    className="bg-transparent border-b border-accent text-white font-semibold text-base outline-none w-full"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingUsername(true)}
                    className="flex items-center gap-1.5 group text-left"
                    title="Click to edit username"
                  >
                    <span className="font-semibold text-white">{username || user?.username}</span>
                    <svg className="w-3.5 h-3.5 text-dark-muted group-hover:text-accent transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828A2 2 0 0110 16.414H8v-2a2 2 0 01.586-1.414z" />
                    </svg>
                  </button>
                )}
                <p className="text-dark-muted text-sm">{user?.email}</p>
              </div>
            </div>
            <Button type="submit" loading={savingUsername} variant="secondary">Save Username</Button>
          </div>
        </Card>
      </form>

      {/* Password */}
      <form onSubmit={handlePasswordChange} className="flex flex-col gap-6 mb-6">
        <Card header="Change Password">
          <div className="flex flex-col gap-4">
            <Input
              label="Current Password"
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
            />
            <Input
              label="New Password"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
            <Input
              label="Confirm New Password"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Repeat new password"
            />
            <Button type="submit" loading={savingPassword}>Update Password</Button>
          </div>
        </Card>
      </form>

      <form onSubmit={handleSave} className="flex flex-col gap-6">
        {/* Profile */}
        <Card header="iRacing & Notifications">
          <div className="flex flex-col gap-4">
            <Input
              label="iRacing Name"
              value={profile.iracing_name ?? ''}
              onChange={e => setProfile(p => ({ ...p, iracing_name: e.target.value }))}
              placeholder="Your iRacing display name"
            />
          </div>
        </Card>

        {/* Telegram */}
        <Card header="Telegram Notifications">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">&#x2708;&#xFE0F;</span>
              <div>
                <p className="text-white font-semibold">Telegram Bot</p>
                {user?.telegram_chat_id ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="success">Linked</Badge>
                    <span className="text-dark-muted text-xs">Chat ID: {user.telegram_chat_id}</span>
                  </div>
                ) : (
                  <Badge variant="inactive">Not linked</Badge>
                )}
              </div>
            </div>
            {!user?.telegram_chat_id && (
              <div className="bg-dark border border-dark-border rounded-lg p-4 text-sm text-dark-muted">
                <p className="font-semibold text-white mb-2">How to link Telegram:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Search for the SM CORSE bot on Telegram</li>
                  <li>Send <code className="text-accent bg-dark-border px-1 rounded">/start</code> to the bot</li>
                  <li>The bot will auto-link if your Telegram username matches your account</li>
                </ol>
              </div>
            )}
          </div>
        </Card>

        {/* Discord */}
        <Card header="Discord Notifications">
          <div className="flex flex-col gap-4">
            <Input
              label="Discord User ID"
              value={profile.discord_user_id ?? ''}
              onChange={e => setProfile(p => ({ ...p, discord_user_id: e.target.value }))}
              placeholder="Your Discord numeric user ID"
            />
            <Input
              label="Discord Webhook URL"
              value={profile.discord_webhook ?? ''}
              onChange={e => setProfile(p => ({ ...p, discord_webhook: e.target.value }))}
              placeholder="https://discord.com/api/webhooks/..."
            />
            <p className="text-dark-muted text-xs">
              Webhook URL is used for channel notifications. User ID is for direct message pings.
            </p>
          </div>
        </Card>

        <Button type="submit" loading={saving} size="lg">Save Settings</Button>
      </form>
    </div>
  );
}
