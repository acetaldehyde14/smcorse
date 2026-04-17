import { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  header?: React.ReactNode;
  padding?: boolean;
}

export function Card({ header, padding = true, className = '', children, ...props }: CardProps) {
  return (
    <div
      className={`bg-dark-card border border-dark-border rounded-xl overflow-hidden ${className}`}
      {...props}
    >
      {header && (
        <div className="px-6 py-4 border-b border-dark-border flex items-center justify-between">
          {typeof header === 'string' ? (
            <h3 className="font-heading font-semibold text-white">{header}</h3>
          ) : (
            header
          )}
        </div>
      )}
      <div className={padding ? 'p-6' : ''}>{children}</div>
    </div>
  );
}
