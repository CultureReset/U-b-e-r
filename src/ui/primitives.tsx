/**
 * Design-system primitives. Small, unopinionated, styled entirely through the
 * token CSS so a brand change reaches all of them at once.
 */
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { avatarColors, initialsOf } from '@platform/format';
import { appConfig } from '@config';

/* ------------------------------- Button ------------------------------- */

export type ButtonVariant = 'default' | 'primary' | 'accent' | 'ghost' | 'quiet' | 'danger' | 'positive';

export interface ButtonProps {
  children?: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName | string;
  iconAfter?: IconName | string;
  block?: boolean;
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit';
  style?: CSSProperties;
  className?: string;
  'aria-label'?: string;
}

export function Button({
  children,
  onClick,
  variant = 'default',
  size = 'md',
  icon,
  iconAfter,
  block,
  disabled,
  title,
  type = 'button',
  style,
  className = '',
  ...rest
}: ButtonProps) {
  const variantClass = variant === 'default' ? '' : `btn-${variant}`;
  const sizeClass = size === 'md' ? '' : `btn-${size}`;
  const iconOnly = !children && (icon || iconAfter);
  return (
    <button
      type={type}
      className={`btn ${variantClass} ${sizeClass} ${block ? 'btn-block' : ''} ${iconOnly ? 'btn-icon' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={style}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}
      {children}
      {iconAfter && <Icon name={iconAfter} size={size === 'sm' ? 15 : 17} />}
    </button>
  );
}

/* -------------------------------- Chip -------------------------------- */

export function Chip({
  children,
  tone = 'default',
  icon,
  size = 'sm',
  style,
}: {
  children: ReactNode;
  tone?: 'default' | 'outline' | 'positive' | 'warning' | 'danger' | 'info' | 'accent';
  icon?: IconName | string;
  size?: 'sm' | 'lg';
  style?: CSSProperties;
}) {
  return (
    <span className={`chip ${tone === 'default' ? '' : `chip-${tone}`} ${size === 'lg' ? 'chip-lg' : ''}`} style={style}>
      {icon && <Icon name={icon} size={13} strokeWidth={2} />}
      {children}
    </span>
  );
}

/* ------------------------------- Avatar ------------------------------- */

export function Avatar({
  name,
  hue = 210,
  size = 36,
  glyph,
  color,
}: {
  name?: string;
  hue?: number;
  size?: number;
  glyph?: string;
  color?: string;
}) {
  const colors = avatarColors(hue);
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        background: color ?? colors.bg,
        color: color ? '#fff' : colors.fg,
        fontSize: glyph ? size * 0.5 : size * 0.38,
      }}
      aria-hidden="true"
    >
      {glyph ?? (name ? initialsOf(name) : '?')}
    </div>
  );
}

/* -------------------------------- Card -------------------------------- */

export function Card({
  children,
  title,
  action,
  pad = true,
  style,
  className = '',
}: {
  children: ReactNode;
  title?: ReactNode;
  action?: ReactNode;
  pad?: boolean;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <section className={`card ${className}`} style={style}>
      {(title || action) && (
        <header className="card-head">
          {typeof title === 'string' ? <h3 className="t-heading">{title}</h3> : title}
          {action}
        </header>
      )}
      <div className={pad ? 'card-pad' : undefined}>{children}</div>
    </section>
  );
}

/* ------------------------------- Metric ------------------------------- */

export function Metric({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'positive' | 'danger' | 'warning' | 'info';
  icon?: IconName | string;
}) {
  const toneColor = tone ? `var(--c-${tone})` : undefined;
  return (
    <div className="card card-tight col gap-1">
      <div className="row spread">
        <span className="t-caps">{label}</span>
        {icon && <Icon name={icon} size={15} color="var(--c-text-faint)" />}
      </div>
      <strong className="t-title t-num" style={{ color: toneColor }}>
        {value}
      </strong>
      {hint && <span className="t-micro t-faint">{hint}</span>}
    </div>
  );
}

/* ------------------------------- Switch ------------------------------- */

export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const control = (
    <button
      type="button"
      className="switch"
      data-on={checked}
      role="switch"
      aria-checked={checked}
      aria-label={typeof label === 'string' ? label : 'Toggle'}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
    />
  );
  if (!label) return control;
  return (
    <label className="row spread" style={{ gap: 'var(--s-4)', cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <span className="col" style={{ gap: 2 }}>
        <span className="t-body" style={{ fontWeight: 540 }}>
          {label}
        </span>
        {hint && <span className="t-micro t-faint">{hint}</span>}
      </span>
      {control}
    </label>
  );
}

/* ------------------------------ Segmented ----------------------------- */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="seg" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={option.value === value}
          data-active={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------- Meter ------------------------------- */

export function Meter({ value, tone, height = 6 }: { value: number; tone?: string; height?: number }) {
  return (
    <div className="meter" style={{ height }}>
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: tone }} />
    </div>
  );
}

/* -------------------------------- Sheet ------------------------------- */

export function Sheet({
  children,
  onClose,
  grip = true,
  style,
}: {
  children: ReactNode;
  onClose?: () => void;
  grip?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div className="sheet animate-slide-up" style={style}>
      {grip && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{ background: 'none', border: 'none', padding: 0 }}
        >
          <span className="sheet-grip" />
        </button>
      )}
      <div className="sheet-body">{children}</div>
    </div>
  );
}

/* -------------------------------- Modal ------------------------------- */

export function Modal({
  children,
  title,
  onClose,
  footer,
  width,
}: {
  children: ReactNode;
  title?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-scrim" onClick={onClose} role="presentation">
      <div
        className="modal"
        style={width ? { width: `min(${width}px, 100%)` } : undefined}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {title && (
          <header className="card-head">
            {typeof title === 'string' ? <h3 className="t-heading">{title}</h3> : title}
            <Button variant="quiet" icon="x" onClick={onClose} aria-label="Close" />
          </header>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------- Empty -------------------------------- */

export function Empty({ icon = 'info', title, hint, action }: { icon?: IconName | string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={26} color="var(--c-border-strong)" />
      <strong className="t-body" style={{ color: 'var(--c-text-muted)' }}>
        {title}
      </strong>
      {hint && <span className="t-small">{hint}</span>}
      {action}
    </div>
  );
}

/* ------------------------------- Stars -------------------------------- */

export function Stars({
  value,
  onChange,
  size = 20,
  max = 5,
}: {
  value: number;
  onChange?: (next: number) => void;
  size?: number;
  max?: number;
}) {
  return (
    <div className="row gap-1" role={onChange ? 'radiogroup' : undefined}>
      {Array.from({ length: max }, (_, i) => i + 1).map((star) => (
        <button
          key={star}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(star)}
          aria-label={`${star} star${star === 1 ? '' : 's'}`}
          style={{ background: 'none', border: 'none', padding: 0, lineHeight: 0, cursor: onChange ? 'pointer' : 'default' }}
        >
          <Icon
            name="star"
            size={size}
            filled={star <= value}
            color={star <= value ? '#f0a91b' : 'var(--c-border-strong)'}
          />
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ Countdown ----------------------------- */

/** Ring countdown used on dispatch offers. */
export function Countdown({
  expiresAt,
  now,
  size = 40,
  windowMs = appConfig.limits.offerTimeoutSec * 1000,
}: {
  expiresAt: number;
  now: number;
  size?: number;
  windowMs?: number;
}) {
  const totalMs = windowMs;
  const remaining = Math.max(0, expiresAt - now);
  const ratio = Math.max(0, Math.min(1, remaining / totalMs));
  const radius = size / 2 - 3;
  const circumference = 2 * Math.PI * radius;
  const seconds = Math.ceil(remaining / 1000);

  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--c-border)" strokeWidth={3} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={ratio > 0.35 ? 'var(--c-positive)' : 'var(--c-danger)'}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          style={{ transition: 'stroke-dashoffset 300ms linear' }}
        />
      </svg>
      <span
        className="t-small t-num"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          fontWeight: 640,
        }}
      >
        {seconds}
      </span>
    </div>
  );
}

/* ------------------------------ Tooltip ------------------------------- */

export function InfoDot({ hint }: { hint: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  return (
    <span
      ref={ref}
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <Icon name="info" size={13} color="var(--c-text-faint)" />
      {open && (
        <span
          role="tooltip"
          className="t-micro"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--c-text)',
            color: 'var(--c-bg)',
            padding: '5px 8px',
            borderRadius: 'var(--r-sm)',
            whiteSpace: 'nowrap',
            zIndex: 50,
            pointerEvents: 'none',
          }}
        >
          {hint}
        </span>
      )}
    </span>
  );
}

/* ------------------------------- Rows --------------------------------- */

export function ListRow({
  icon,
  iconColor,
  leading,
  title,
  subtitle,
  trailing,
  onClick,
  selected,
  style,
}: {
  icon?: IconName | string;
  iconColor?: string;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  style?: CSSProperties;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className="list-row"
      data-interactive={Boolean(onClick)}
      data-selected={selected}
      onClick={onClick}
      style={style}
      type={onClick ? 'button' : undefined}
    >
      {leading ??
        (icon && (
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 'var(--r-md)',
              background: 'var(--c-accent-soft)',
              display: 'grid',
              placeItems: 'center',
              flex: 'none',
            }}
          >
            <Icon name={icon} size={16} color={iconColor} />
          </span>
        ))}
      <span className="col grow" style={{ gap: 1 }}>
        <span className="t-body t-truncate" style={{ fontWeight: 540 }}>
          {title}
        </span>
        {subtitle && <span className="t-small t-muted t-truncate">{subtitle}</span>}
      </span>
      {trailing}
    </Tag>
  );
}

/* ------------------------------ Skeleton ------------------------------ */

export function Skeleton({ height = 16, width = '100%', radius }: { height?: number; width?: number | string; radius?: number }) {
  return <div className="skeleton" style={{ height, width, borderRadius: radius }} />;
}

export function StatusDot({ tone }: { tone: 'neutral' | 'progress' | 'positive' | 'warning' | 'danger' }) {
  const colors: Record<string, string> = {
    neutral: 'var(--c-text-faint)',
    progress: 'var(--c-info)',
    positive: 'var(--c-positive)',
    warning: 'var(--c-warning)',
    danger: 'var(--c-danger)',
  };
  return <span className={`dot ${tone === 'progress' ? 'pulse' : ''}`} style={{ background: colors[tone] }} />;
}
