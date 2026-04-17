'use client';

import { useEffect } from 'react';

export default function LibraryPage() {
  useEffect(() => {
    window.location.href = '/library.html';
  }, []);
  return (
    <div className="text-center py-12 text-dark-muted animate-pulse">
      Loading library…
    </div>
  );
}
