'use client';

import { useEffect } from 'react';

export default function AssistantPage() {
  useEffect(() => {
    window.location.href = '/assistant.html';
  }, []);
  return (
    <div className="text-center py-12 text-dark-muted animate-pulse">
      Loading race engineer…
    </div>
  );
}
