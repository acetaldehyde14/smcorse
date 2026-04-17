'use client';

import { useEffect } from 'react';

export default function CoachingPage() {
  useEffect(() => {
    window.location.href = '/coaching.html';
  }, []);
  return (
    <div className="text-center py-12 text-dark-muted animate-pulse">
      Loading coaching…
    </div>
  );
}
