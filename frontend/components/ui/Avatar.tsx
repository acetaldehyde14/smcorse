interface AvatarProps {
  name?: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-lg',
};

function initials(name?: string) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export function Avatar({ name, src, size = 'md', className = '' }: AvatarProps) {
  return (
    <div className={`${sizeClasses[size]} rounded-full overflow-hidden flex-shrink-0 ${className}`}>
      {src ? (
        <img src={src} alt={name ?? ''} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-primary/20 border border-primary/30 flex items-center justify-center font-heading font-bold text-accent">
          {initials(name)}
        </div>
      )}
    </div>
  );
}
