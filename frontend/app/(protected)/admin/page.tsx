'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';

export default function AdminPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      if (!user?.is_admin) {
        router.replace('/dashboard');
      } else {
        window.location.href = '/admin.html';
      }
    }
  }, [user, isLoading, router]);

  return (
    <div className="text-center py-12 text-dark-muted animate-pulse">
      Loading admin panel…
    </div>
  );
}
