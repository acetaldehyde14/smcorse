'use client';

import { useEffect } from 'react';

// Temporarily redirect to the existing HTML page served by Express
export default function SessionsPage() {
  useEffect(() => {
    window.location.href = '/sessions.html';
  }, []);
  return (
    <div className="text-center py-12 text-dark-muted animate-pulse">
      Loading sessions…
    </div>
  );
}
