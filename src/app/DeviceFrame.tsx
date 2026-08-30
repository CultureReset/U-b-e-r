/**
 * Phone chrome for the consumer and earner surfaces. Purely presentational —
 * it exists so the mobile products read as mobile products next to the
 * desktop consoles.
 */
import type { ReactNode } from 'react';
import { clock } from '@platform/format';
import { useWorld } from '@platform/store';
import { Icon } from '@ui/Icon';

export interface DeviceTab {
  id: string;
  label: string;
  icon: string;
  badge?: number;
}

export function DeviceFrame({
  children,
  tabs,
  activeTab,
  onTabChange,
  aside,
}: {
  children: ReactNode;
  tabs?: DeviceTab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  aside?: ReactNode;
}) {
  const now = useWorld((s) => s.state.now);

  return (
    <div
      className="row gap-6 grow"
      style={{ justifyContent: 'center', alignItems: 'stretch', padding: 'var(--s-5)', overflow: 'hidden' }}
    >
      <div className="device">
        <div className="device-statusbar">
          <span>{clock(now)}</span>
          <span className="row gap-1">
            <Icon name="signal" size={12} strokeWidth={2.2} />
            <Icon name="wifi" size={12} strokeWidth={2.2} />
            <Icon name="battery" size={12} strokeWidth={2.2} />
          </span>
        </div>
        <div className="device-screen">{children}</div>
        {tabs && tabs.length > 0 && (
          <nav className="device-tabbar" aria-label="App sections">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                data-active={tab.id === activeTab}
                onClick={() => onTabChange?.(tab.id)}
                type="button"
              >
                <span style={{ position: 'relative', lineHeight: 0 }}>
                  <Icon name={tab.icon} size={20} strokeWidth={tab.id === activeTab ? 2 : 1.7} />
                  {tab.badge ? (
                    <span
                      className="t-micro"
                      style={{
                        position: 'absolute',
                        top: -5,
                        right: -8,
                        minWidth: 15,
                        height: 15,
                        padding: '0 3px',
                        borderRadius: 'var(--r-pill)',
                        background: 'var(--c-danger)',
                        color: '#fff',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 9.5,
                        fontWeight: 700,
                      }}
                    >
                      {tab.badge > 9 ? '9+' : tab.badge}
                    </span>
                  ) : null}
                </span>
                {tab.label}
              </button>
            ))}
          </nav>
        )}
      </div>

      {aside && (
        <div className="col grow" style={{ maxWidth: 520, overflowY: 'auto', gap: 'var(--s-4)' }}>
          {aside}
        </div>
      )}
    </div>
  );
}

/** Full-bleed screen header used inside the phone. */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  action?: ReactNode;
}) {
  return (
    <header
      className="row gap-3"
      style={{
        padding: 'var(--s-3) var(--s-4)',
        paddingTop: 'calc(var(--s-3) + 30px)',
        borderBottom: '1px solid var(--c-border)',
        background: 'var(--c-surface)',
        flex: 'none',
      }}
    >
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          style={{ background: 'none', border: 'none', padding: 0, lineHeight: 0 }}
        >
          <Icon name="arrow-left" size={20} />
        </button>
      )}
      <span className="col grow" style={{ gap: 1 }}>
        <span className="t-heading t-truncate">{title}</span>
        {subtitle && <span className="t-micro t-faint t-truncate">{subtitle}</span>}
      </span>
      {action}
    </header>
  );
}
