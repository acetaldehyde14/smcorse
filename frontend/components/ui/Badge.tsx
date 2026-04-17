interface BadgeProps {
  variant?: 'active' | 'inactive' | 'admin' | 'warning' | 'info' | 'success';
  children: React.ReactNode;
  className?: string;
}

const variantClasses = {
  active:   'bg-green-500/20 text-green-400 border border-green-500/30',
  inactive: 'bg-gray-500/20 text-gray-400 border border-gray-500/30',
  admin:    'bg-primary/20 text-accent border border-primary/30',
  warning:  'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  info:     'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  success:  'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
};

export function Badge({ variant = 'info', children, className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${variantClasses[variant]} ${className}`}>
      {children}
    </span>
  );
}
