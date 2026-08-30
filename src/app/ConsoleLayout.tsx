/**
 * Shared chrome for the desktop consoles (merchant, business, ops).
 */
import type { ReactNode } from 'react';
import { Icon } from '@ui/Icon';

export interface ConsoleSection {
  id: string;
  label: string;
  icon: string;
  badge?: number;
}

export function ConsoleLayout({
  sections,
  active,
  onChange,
  brand,
  title,
  subtitle,
  actions,
  footer,
  children,
  flush,
}: {
  sections: { group: string; items: ConsoleSection[] }[];
  active: string;
  onChange: (id: string) => void;
  brand: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <div className="console grow">
      <aside className="console-nav">
        {brand}
        {sections.map((section) => (
          <div key={section.group} className="col gap-1">
            <span className="t-caps" style={{ padding: '0 var(--s-3)' }}>
              {section.group}
            </span>
            {section.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="nav-item"
                data-active={item.id === active}
                onClick={() => onChange(item.id)}
              >
                <Icon name={item.icon} size={16} />
                <span className="grow">{item.label}</span>
                {item.badge ? (
                  <span
                    className="t-micro"
                    style={{
                      minWidth: 18,
                      height: 18,
                      padding: '0 5px',
                      borderRadius: 'var(--r-pill)',
                      background: 'var(--c-danger)',
                      color: '#fff',
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 700,
                    }}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ))}
        {footer && <div style={{ marginTop: 'auto' }}>{footer}</div>}
      </aside>

      <div className="console-main">
        <header className="console-head">
          <div className="col" style={{ gap: 2 }}>
            {typeof title === 'string' ? <h2 className="t-title">{title}</h2> : title}
            {subtitle && <span className="t-small t-muted">{subtitle}</span>}
          </div>
          {actions && <div className="row gap-2">{actions}</div>}
        </header>
        <div className={flush ? 'console-body-flush' : 'console-body'}>{children}</div>
      </div>
    </div>
  );
}
