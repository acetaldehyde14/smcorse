'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/ui/Avatar';

const navLinks = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/race', label: 'Live Race' },
  { href: '/stint-planner', label: 'Stint Planner' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/team', label: 'Team' },
  { href: '/laps', label: 'Laps' },
];

export default function Header() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="border-b border-dark-border bg-dark/80 backdrop-blur-sm sticky top-0 z-40">
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/img/sm_corse_only_blue.png"
              alt="SM CORSE"
              className="h-10 w-auto group-hover:opacity-80 transition-opacity"
              style={{ filter: 'brightness(0) invert(1)' }}
            />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-2 rounded-lg text-sm font-body font-semibold transition-colors ${
                  pathname === link.href
                    ? 'bg-primary/20 text-accent'
                    : 'text-dark-muted hover:text-white hover:bg-white/5'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* User menu */}
          <div className="flex items-center gap-3">
            {user?.is_admin && (
              <Link
                href="/admin"
                className="hidden md:block text-xs text-accent border border-accent/30 px-2 py-1 rounded-md hover:bg-accent/10 transition-colors font-body"
              >
                Admin
              </Link>
            )}
            <Link href="/settings">
              <Avatar name={user?.username} size="sm" className="cursor-pointer hover:ring-2 hover:ring-primary transition-all" />
            </Link>
            <button
              onClick={() => logout()}
              className="hidden md:block text-dark-muted hover:text-white text-sm font-body transition-colors"
            >
              Logout
            </button>
            {/* Mobile menu toggle */}
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="md:hidden text-dark-muted hover:text-white p-1"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d={menuOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} />
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile nav */}
        {menuOpen && (
          <nav className="md:hidden pb-4 flex flex-col gap-1">
            {navLinks.map(link => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className={`px-3 py-2 rounded-lg text-sm font-body font-semibold transition-colors ${
                  pathname === link.href
                    ? 'bg-primary/20 text-accent'
                    : 'text-dark-muted hover:text-white hover:bg-white/5'
                }`}
              >
                {link.label}
              </Link>
            ))}
            <button
              onClick={() => { setMenuOpen(false); logout(); }}
              className="text-left px-3 py-2 text-sm text-dark-muted hover:text-white font-body"
            >
              Logout
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}
