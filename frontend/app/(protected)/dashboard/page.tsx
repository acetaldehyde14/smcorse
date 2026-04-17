'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';

const featureCards = [
  { href: '/race', icon: '🏁', title: 'Live Race Tracker', desc: 'Monitor active endurance race in real-time', color: 'from-primary/20 to-transparent' },
  { href: '/stint-planner', icon: '📅', title: 'Stint Planner', desc: 'Plan driver availability and stints', color: 'from-accent/20 to-transparent' },
  { href: '/calendar', icon: '🗓️', title: 'Race Calendar', desc: 'Upcoming events and countdown timers', color: 'from-emerald-500/20 to-transparent' },
  { href: '/team', icon: '👥', title: 'Team', desc: 'Manage roster and notification settings', color: 'from-purple-500/20 to-transparent' },
  { href: '/sessions', icon: '📊', title: 'Telemetry', desc: 'Upload and analyse your lap data', color: 'from-yellow-500/20 to-transparent' },
  { href: '/coaching', icon: '🤖', title: 'AI Coaching', desc: 'Compare laps and get AI feedback', color: 'from-pink-500/20 to-transparent' },
  { href: '/assistant', icon: '💬', title: 'Race Engineer', desc: 'Chat with your AI race engineer', color: 'from-orange-500/20 to-transparent' },
  { href: '/library', icon: '📚', title: 'Lap Library', desc: 'Reference laps and leaderboards', color: 'from-teal-500/20 to-transparent' },
  { href: '/settings', icon: '⚙️', title: 'Settings', desc: 'Profile, notifications and preferences', color: 'from-gray-500/20 to-transparent' },
];

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div>
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="font-heading font-bold text-3xl text-white mb-1">
          Welcome back, <span className="text-accent">{user?.username}</span>
        </h1>
        <p className="text-dark-muted">SM CORSE iRacing endurance racing team platform</p>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {featureCards.map(card => (
          <Link
            key={card.href}
            href={card.href}
            className="group relative overflow-hidden bg-dark-card border border-dark-border rounded-xl p-6 hover:border-primary/50 transition-all hover:-translate-y-0.5"
          >
            <div className={`absolute inset-0 bg-gradient-to-br ${card.color} opacity-0 group-hover:opacity-100 transition-opacity`} />
            <div className="relative">
              <div className="text-3xl mb-3">{card.icon}</div>
              <h3 className="font-heading font-semibold text-white mb-1 group-hover:text-accent transition-colors">
                {card.title}
              </h3>
              <p className="text-dark-muted text-sm">{card.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
