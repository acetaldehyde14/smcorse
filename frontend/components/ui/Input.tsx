import { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

interface BaseProps {
  label?: string;
  error?: string;
  className?: string;
}

export function Input({
  label, error, className = '', ...props
}: BaseProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && <label className="text-sm font-body text-dark-muted">{label}</label>}
      <input
        className={`bg-dark border rounded-lg px-3 py-2 text-white placeholder-dark-muted
          focus:outline-none focus:border-primary transition-colors w-full font-body
          ${error ? 'border-red-500' : 'border-dark-border'}`}
        {...props}
      />
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

export function Select({
  label, error, className = '', children, ...props
}: BaseProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && <label className="text-sm font-body text-dark-muted">{label}</label>}
      <select
        className={`bg-dark border rounded-lg px-3 py-2 text-white
          focus:outline-none focus:border-primary transition-colors w-full font-body
          ${error ? 'border-red-500' : 'border-dark-border'}`}
        {...props}
      >
        {children}
      </select>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

export function Textarea({
  label, error, className = '', ...props
}: BaseProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && <label className="text-sm font-body text-dark-muted">{label}</label>}
      <textarea
        className={`bg-dark border rounded-lg px-3 py-2 text-white placeholder-dark-muted
          focus:outline-none focus:border-primary transition-colors w-full font-body resize-none
          ${error ? 'border-red-500' : 'border-dark-border'}`}
        {...props}
      />
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
