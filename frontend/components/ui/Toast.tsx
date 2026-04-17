'use client';

import { createContext, useCallback, useContext, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

type ToastType = 'success' | 'error' | 'info';

interface ToastMessage {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let idCounter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++idCounter;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  }, []);

  const icons = {
    success: '✓',
    error: '✕',
    info: 'i',
  };
  const colors = {
    success: 'border-green-500/50 bg-green-500/10 text-green-300',
    error: 'border-red-500/50 bg-red-500/10 text-red-300',
    info: 'border-primary/50 bg-primary/10 text-blue-300',
  };

  const toastEl = toasts.length > 0 && typeof document !== 'undefined' ? createPortal(
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-lg border backdrop-blur-sm
            pointer-events-auto animate-in slide-in-from-right duration-300 font-body
            ${colors[t.type]}`}
        >
          <span className="font-bold w-4 text-center">{icons[t.type]}</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>,
    document.body
  ) : null;

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {toastEl}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx.toast;
}
