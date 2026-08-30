/**
 * Brand / design tokens.
 * Everything visual in the app resolves from here at runtime via CSS custom
 * properties (see platform/theme.ts). Swap this file to re-skin the entire
 * platform — no component edits required.
 */

export interface BrandPalette {
  bg: string;
  bgElevated: string;
  bgSunken: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  positive: string;
  warning: string;
  danger: string;
  info: string;
  mapLand: string;
  mapRoad: string;
  mapArterial: string;
  mapWater: string;
  mapBuilding: string;
}

export interface BrandConfig {
  /** Product name shown in chrome, receipts and documents. */
  name: string;
  shortName: string;
  tagline: string;
  /** Inline SVG path used as the wordmark glyph. */
  markPath: string;
  fontStack: string;
  monoStack: string;
  radius: { sm: string; md: string; lg: string; xl: string; pill: string };
  space: number;
  palettes: { light: BrandPalette; dark: BrandPalette };
  /** Per-surface accent overrides — lets each product line carry its own hue. */
  surfaceAccents: Record<string, string>;
}

export const brandConfig: BrandConfig = {
  name: 'URUS',
  shortName: 'URUS',
  tagline: 'Move anything, anywhere.',
  markPath:
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 3.4a6.6 6.6 0 0 1 6.34 4.77H5.66A6.6 6.6 0 0 1 12 5.4ZM5.4 12.5h13.2A6.6 6.6 0 0 1 5.4 12.5Z',
  fontStack:
    '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  monoStack: '"SF Mono", ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace',
  radius: { sm: '6px', md: '10px', lg: '16px', xl: '24px', pill: '999px' },
  space: 4,
  palettes: {
    light: {
      bg: '#f4f5f7',
      bgElevated: '#ffffff',
      bgSunken: '#e9ebef',
      surface: '#ffffff',
      surfaceAlt: '#f7f8fa',
      border: '#e2e5ea',
      borderStrong: '#c9ced6',
      text: '#0b0d12',
      textMuted: '#5b6472',
      textFaint: '#8b95a4',
      accent: '#0b0d12',
      accentText: '#ffffff',
      accentSoft: '#e8eaee',
      positive: '#0f8a4a',
      warning: '#b7791f',
      danger: '#c4342b',
      info: '#1a5fd4',
      mapLand: '#e2e6ed',
      mapRoad: '#f6f8fa',
      mapArterial: '#ffffff',
      mapWater: '#c3d8ea',
      mapBuilding: '#dce1e8',
    },
    dark: {
      bg: '#0a0b0e',
      bgElevated: '#14161b',
      bgSunken: '#050609',
      surface: '#14161b',
      surfaceAlt: '#1b1e25',
      border: '#262a33',
      borderStrong: '#39404d',
      text: '#f2f4f7',
      textMuted: '#98a1b0',
      textFaint: '#6b7482',
      accent: '#ffffff',
      accentText: '#0a0b0e',
      accentSoft: '#22262f',
      positive: '#37c07a',
      warning: '#e0a33c',
      danger: '#ef5a50',
      info: '#5b9bff',
      mapLand: '#101319',
      mapRoad: '#232833',
      mapArterial: '#2e3542',
      mapWater: '#122236',
      mapBuilding: '#181c24',
    },
  },
  surfaceAccents: {
    rider: '#2f6bff',
    eats: '#0f8a4a',
    driver: '#7a4bd6',
    merchant: '#b7791f',
    business: '#0e7c86',
    admin: '#c4342b',
  },
};
