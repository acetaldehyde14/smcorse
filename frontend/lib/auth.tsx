'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { auth as authApi } from './api';
import type { User } from './types';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (
    name: string,
    username: string,
    email: string,
    password: string,
    discordUserId: string,
    telegramChatId?: string
  ) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const u = await authApi.me();
      setUser(u);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setIsLoading(false));
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    await authApi.login(email, password);
    await refresh();
    router.push('/dashboard');
  }, [refresh, router]);

  const signup = useCallback(async (
    name: string,
    username: string,
    email: string,
    password: string,
    discordUserId: string,
    telegramChatId?: string
  ) => {
    await authApi.signup(name, username, email, password, discordUserId, telegramChatId);
    await refresh();
    router.push('/dashboard');
  }, [refresh, router]);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
    router.push('/');
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, signup, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
