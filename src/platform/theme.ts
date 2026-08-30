/**
 * Turns the brand config into CSS custom properties at runtime, and manages the
 * light/dark preference. Because every component styles against variables, a
 * change to brand.config.ts re-skins the entire platform.
 */
import { useEffect } from 'react';
import { brandConfig, type BrandPalette } from '@config';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'urus.theme';
const CAMEL_TO_KEBAB = /[A-Z]/g;

const cssVarName = (key: string) => `--c-${key.replace(CAMEL_TO_KEBAB, (m) => `-${m.toLowerCase()}`)}`;

function applyPalette(palette: BrandPalette): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(palette)) {
    root.style.setProperty(cssVarName(key), value);
  }
}

function applyStaticTokens(): void {
  const root = document.documentElement;
  root.style.setProperty('--font-sans', brandConfig.fontStack);
  root.style.setProperty('--font-mono', brandConfig.monoStack);
  for (const [key, value] of Object.entries(brandConfig.radius)) {
    root.style.setProperty(`--r-${key}`, value);
  }
  for (let i = 0; i <= 12; i++) {
    root.style.setProperty(`--s-${i}`, `${i * brandConfig.space}px`);
  }
  for (const [surface, accent] of Object.entries(brandConfig.surfaceAccents)) {
    root.style.setProperty(`--accent-${surface}`, accent);
  }
}

export function resolveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function readStoredMode(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system';
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

export function storeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode — the choice simply won't persist */
  }
}

/** Applies the theme and keeps it in sync with the OS preference. */
export function useTheme(mode: ThemeMode): 'light' | 'dark' {
  const resolved = resolveMode(mode);

  useEffect(() => {
    applyStaticTokens();
  }, []);

  useEffect(() => {
    applyPalette(brandConfig.palettes[resolved]);
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  useEffect(() => {
    if (mode !== 'system' || typeof window === 'undefined') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const next = media.matches ? 'dark' : 'light';
      applyPalette(brandConfig.palettes[next]);
      document.documentElement.dataset.theme = next;
    };
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, [mode]);

  return resolved;
}

/** Sets the accent hue for the surface currently on screen. */
export function useSurfaceAccent(surfaceId: string): void {
  useEffect(() => {
    const accent = brandConfig.surfaceAccents[surfaceId];
    const root = document.documentElement;
    if (accent) root.style.setProperty('--accent-surface', accent);
    return () => {
      root.style.removeProperty('--accent-surface');
    };
  }, [surfaceId]);
}
