/**
 * Application shell.
 *
 * The switcher across the top is the point of the whole prototype: six
 * products, one live world. Switching from Rides to Driver does not reload
 * anything — you are looking at the other side of the same marketplace at the
 * same instant.
 */
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { appConfig, brandConfig, marketConfigs } from '@config';
import { useSimulationLoop } from '@platform/simLoop';
import { useWorld } from '@platform/store';
import { useTheme, readStoredMode, storeMode, type ThemeMode } from '@platform/theme';
import { clock } from '@platform/format';
import { Icon } from '@ui/Icon';
import { Button } from '@ui/primitives';
import { useEffect, useState } from 'react';
import { WorldControls } from './WorldControls';

export function Shell() {
  const [mode, setMode] = useState<ThemeMode>(readStoredMode);
  const resolved = useTheme(mode);
  const location = useLocation();
  const ready = useWorld((s) => s.ready);
  const hydrate = useWorld((s) => s.hydrate);
  const marketId = useWorld((s) => s.state.marketId);
  const now = useWorld((s) => s.state.now);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useSimulationLoop();

  const surfaces = appConfig.surfaces.filter((s) => s.enabled);
  const market = marketConfigs.find((m) => m.id === marketId);
  const active = surfaces.find((s) => location.pathname.startsWith(s.route));

  // Flip whatever is on screen rather than cycling through 'system' — from the
  // system default the first click would otherwise appear to do nothing.
  const toggleTheme = () => {
    const next: ThemeMode = resolved === 'dark' ? 'light' : 'dark';
    setMode(next);
    storeMode(next);
  };

  return (
    <div className="col" style={{ height: '100%', background: 'var(--c-bg)' }}>
      <header
        className="row spread gap-4"
        style={{
          padding: '0 var(--s-5)',
          height: 54,
          borderBottom: '1px solid var(--c-border)',
          background: 'var(--c-bg-elevated)',
          flex: 'none',
        }}
      >
        <div className="row gap-3">
          <span className="row gap-2" style={{ fontWeight: 720, letterSpacing: '-0.03em', fontSize: 17 }}>
            <svg width="21" height="21" viewBox="0 0 24 24" aria-hidden="true">
              <path d={brandConfig.markPath} fill="currentColor" />
            </svg>
            {brandConfig.name}
          </span>
          <span className="t-micro t-faint" style={{ paddingLeft: 'var(--s-2)', borderLeft: '1px solid var(--c-border)' }}>
            {market?.name} · {clock(now)}
          </span>
        </div>

        <nav className="row gap-1" aria-label="Surfaces">
          {surfaces.map((surface) => (
            <NavLink
              key={surface.id}
              to={surface.route}
              className="row gap-2"
              style={({ isActive }) => ({
                padding: '0 var(--s-3)',
                height: 34,
                borderRadius: 'var(--r-md)',
                fontSize: 13.5,
                fontWeight: 560,
                background: isActive ? 'var(--c-accent-soft)' : 'transparent',
                color: isActive ? 'var(--c-text)' : 'var(--c-text-muted)',
                borderBottom: isActive ? `2px solid ${brandConfig.surfaceAccents[surface.id]}` : '2px solid transparent',
              })}
              title={surface.description}
            >
              <Icon name={surface.icon} size={15} />
              {surface.label}
            </NavLink>
          ))}
        </nav>

        <div className="row gap-2">
          <WorldControls />
          <Button
            variant="ghost"
            size="sm"
            icon={resolved === 'dark' ? 'sun' : 'moon'}
            onClick={toggleTheme}
            title={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`}
            aria-label="Toggle theme"
          />
        </div>
      </header>

      <main className="grow" style={{ overflow: 'hidden', display: 'flex' }}>
        {ready ? (
          <Outlet />
        ) : (
          <div className="grow center row">
            <span className="t-small t-faint">Generating {market?.name ?? 'market'}…</span>
          </div>
        )}
      </main>

      {active?.frame === 'device' && (
        <footer
          className="row center gap-2"
          style={{
            padding: 'var(--s-2)',
            borderTop: '1px solid var(--c-border)',
            background: 'var(--c-bg-elevated)',
            flex: 'none',
          }}
        >
          <span className="t-micro t-faint">{active.audience} surface — {active.description}</span>
        </footer>
      )}
    </div>
  );
}
