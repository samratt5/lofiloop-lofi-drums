import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'xs' | 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  active?: boolean;
}

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 shadow-[0_6px_20px_-8px_var(--glow)] font-semibold',
  secondary: 'bg-surface-3 text-fg hover:bg-[color-mix(in_oklab,var(--surface-3),var(--fg)_8%)]',
  ghost: 'text-fg-muted hover:text-fg hover:bg-surface-3',
  outline: 'border border-line-strong text-fg hover:bg-surface-3',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25',
};

const sizes: Record<Size, string> = {
  xs: 'h-6 px-2 text-[11px] gap-1 rounded-md',
  sm: 'h-8 px-2.5 text-xs gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-sm gap-2 rounded-xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, active, className, children, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background-color,color,filter,box-shadow] duration-150 select-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0',
        variants[variant],
        sizes[size],
        active && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  variant?: Variant;
  active?: boolean;
  /** Show a tooltip below (default) or above */
  tip?: 'bottom' | 'top' | 'none';
}

const iconSizes = {
  xs: 'size-6 rounded-md [&_svg]:size-3.5',
  sm: 'size-8 rounded-lg [&_svg]:size-4',
  md: 'size-9 rounded-lg [&_svg]:size-[18px]',
  lg: 'size-11 rounded-xl [&_svg]:size-5',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'sm', variant = 'ghost', active, tip = 'bottom', className, children, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      data-tip={tip === 'none' ? undefined : label}
      data-tip-pos={tip}
      className={cn(
        'tip relative inline-flex shrink-0 items-center justify-center transition-colors duration-150 select-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0',
        variants[variant],
        iconSizes[size],
        active && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
