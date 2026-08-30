/**
 * Single-source icon set. Icons are referenced by key from config (product
 * icons, surface icons, payment methods) so adding a product never means
 * touching a component — only adding a path here.
 */
import type { CSSProperties } from 'react';

export type IconName = keyof typeof PATHS;

const PATHS = {
  car: 'M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11m-14 0h14m-14 0v5a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h8v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-5M7.5 14h.01M16.5 14h.01',
  'car-comfort': 'M4 12l1.6-5A2 2 0 0 1 7.5 5.5h9A2 2 0 0 1 18.4 7L20 12M4 12h16M4 12v5.5h2.5V16h11v1.5H20V12M7 15h.01M17 15h.01M12 5.5V3',
  'car-premium': 'M4 12l1.6-5A2 2 0 0 1 7.5 5.5h9A2 2 0 0 1 18.4 7L20 12M4 12h16M4 12v5.5h2.5V16h11v1.5H20V12M8 3l1.2 2M16 3l-1.2 2',
  van: 'M3 16V8a1 1 0 0 1 1-1h9v9M13 10h4l3 3.5V16m-17 0h2m2 0h9m2 0h2M7 16a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 0 0-3.2 0Zm10 0a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 0 0-3.2 0Z',
  moto: 'M5.5 17a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm13 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm-13-2.5h5l3-5h4M13.5 9.5 12 6.5h3M16 9.5l2.5 5',
  bike: 'M6 17.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm12 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-12-3h6l3-6M12 8.5h3.5l2.5 6M9 8.5h4',
  users: 'M15.5 18v-1.5a3.5 3.5 0 0 0-3.5-3.5H7a3.5 3.5 0 0 0-3.5 3.5V18M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm11 8v-1.5a3.5 3.5 0 0 0-2.6-3.4M16 4.1a3 3 0 0 1 0 5.8',
  accessible: 'M12 6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm-2.5 3h5M10 9v4h4l2 5m-9-4a4 4 0 1 0 5 4',
  bag: 'M6 8h12l-1 11a1 1 0 0 1-1 .9H8a1 1 0 0 1-1-.9L6 8Zm3 0V6a3 3 0 0 1 6 0v2',
  box: 'M12 3.5 20 7v10l-8 3.5L4 17V7l8-3.5Zm0 0v17M4 7l8 3.5L20 7',
  bolt: 'M13 3 5.5 13.5H11L10.5 21 18.5 10H13V3Z',
  store: 'M4 9.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9.5M3.5 9.5h17L19 4.5H5L3.5 9.5Zm4.5 0a2.5 2.5 0 0 0 5 0m0 0a2.5 2.5 0 0 0 5 0M9.5 20v-5h5v5',
  briefcase: 'M4 8.5h16a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1Zm5 0V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v2.5M3 13h18',
  grid: 'M4 4.5h6v6H4v-6Zm10 0h6v6h-6v-6Zm-10 9h6v6H4v-6Zm10 0h6v6h-6v-6Z',
  wheel: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0-6V3m2.6 10.5 3.9 3.1M9.4 13.5l-3.9 3.1',
  home: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8.5Z',
  pin: 'M12 21s6.5-6 6.5-11a6.5 6.5 0 1 0-13 0C5.5 15 12 21 12 21Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm4.8-1.7L20 20',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13.5V12l3 2',
  star: 'm12 3.8 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 10l5.9-.9L12 3.8Z',
  card: 'M3.5 7.5a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-9Zm0 3h17M6.5 14H10',
  cash: 'M3.5 7h17a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-17a.5.5 0 0 1-.5-.5v-9A.5.5 0 0 1 3.5 7Zm8.5 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  wallet: 'M4 7.5h13a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5A1.5 1.5 0 0 1 4.5 5h11m1.5 8.5h.01',
  bank: 'M3.5 9.5 12 4.5l8.5 5M5 9.5V17m4-7.5V17m6-7.5V17m4-7.5V17M3.5 20h17',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  x: 'm6 6 12 12M18 6 6 18',
  chevron: 'm9 5 7 7-7 7',
  'chevron-down': 'm5 9 7 7 7-7',
  'chevron-up': 'm5 15 7-7 7 7',
  'arrow-left': 'M19 12H5m6-7-7 7 7 7',
  'arrow-right': 'M5 12h14m-7-7 7 7-7 7',
  'arrow-up': 'M12 19V5m-7 7 7-7 7 7',
  navigation: 'M3.5 11 20.5 4l-7 17-2.5-7-7.5-3Z',
  phone: 'M6 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 5.7 2 2 0 0 1 6 3.5Z',
  message: 'M4 5.5h16a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5H9L4.5 20v-3.5H4a.5.5 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5Z',
  shield: 'M12 3.5 19.5 6v6c0 4.4-3.2 7.4-7.5 8.5C7.7 19.4 4.5 16.4 4.5 12V6L12 3.5Zm-2.5 8.7 1.8 1.8 3.5-3.6',
  share: 'M17 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm-10 6a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm10 6a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm-2.2-9.7-5.6 3.2m0 2 5.6 3.2',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 0-.14-1.5l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.6-1.5L14.5 2h-4l-.36 2.6a8 8 0 0 0-2.6 1.5l-2.4-1-2 3.4 2 1.5a8 8 0 0 0 0 3l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2.6 1.5l.36 2.6h4l.36-2.6a8 8 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.5A8 8 0 0 0 20 12Z',
  receipt: 'M6 3.5h12v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5v-17Zm3 5h6m-6 4h6',
  history: 'M4 12a8 8 0 1 0 2.4-5.7M4 4.5V9h4.5M12 8v4.5l3 1.8',
  leaf: 'M20 4c-8 0-13 3.5-13 9.5a6 6 0 0 0 1.2 3.7M20 4c0 8-3.5 13-9.5 13a6 6 0 0 1-3.3-1M20 4 5 19',
  coffee: 'M4 8h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Zm12 1h2.5a2.5 2.5 0 0 1 0 5H16M6 4.5v-2m4 2v-2m4 2v-2',
  burger: 'M4 9.5c0-2.5 3.6-4.5 8-4.5s8 2 8 4.5M4 9.5h16M4 14h16M4.5 17h15a1 1 0 0 0 0-2h-15a1 1 0 0 0 0 2Zm0-4.5h15',
  pizza: 'M12 3.5 21 20a24 24 0 0 1-18 0L12 3.5Zm-1.5 7h.01M14 13h.01M10 15.5h.01',
  sushi: 'M4 9.5h16a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Zm8 0v5M4 6.5h16',
  bowl: 'M3.5 11h17a8.5 8.5 0 0 1-17 0Zm4-3.5c0-1.5 1.5-2 1.5-3.5m4 3.5c0-1.5 1.5-2 1.5-3.5',
  basket: 'M3.5 9.5h17l-1.6 8.6a1 1 0 0 1-1 .9H6.1a1 1 0 0 1-1-.9L3.5 9.5Zm5-5 1.5 5m5.5-5-1.5 5',
  cross: 'M10 3.5h4V10h6.5v4H14v6.5h-4V14H3.5v-4H10V3.5Z',
  filter: 'M4 6h16M7 12h10M10 18h4',
  layers: 'm12 3.5 8.5 4.5L12 12.5 3.5 8 12 3.5Zm8.5 8L12 16 3.5 11.5m17 4.5L12 20.5 3.5 16',
  activity: 'M3.5 12.5h4l2.5-7 4 14 2.5-7h4',
  chart: 'M4 20V9m5 11V4m5 16v-7m5 7V7',
  play: 'm7 4.5 12 7.5-12 7.5v-15Z',
  pause: 'M8 5v14M16 5v14',
  refresh: 'M20 11a8 8 0 1 0-1.8 6M20 5v6h-6',
  logout: 'M14 7V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2m3-8 3 3-3 3m3-3H9',
  camera: 'M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Zm8 9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  alert: 'M12 4 2.5 20h19L12 4Zm0 5.5V14m0 3h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-9.5V16m0-7.5h.01',
  eye: 'M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Zm9.5 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4',
  trash: 'M5 7h14M9 7V5h6v2m-8 0 1 12h8l1-12',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Zm11-15 4 4',
  copy: 'M8 8V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3M5 8h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z',
  download: 'M12 4v10m-4-4 4 4 4-4M4 18h16',
  flag: 'M5 21V4h13l-2.5 4L18 12H5',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0-3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  route: 'M6.5 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm11 14a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM6.5 7.5V13a4 4 0 0 0 4 4h3a4 4 0 0 1 4 4',
  package: 'M12 3.5 20 7.5v9L12 20.5 4 16.5v-9l8-4Zm0 8.5v8.5M4 7.5l8 4.5 8-4.5M8 5.5l8 4.5',
  gift: 'M3.5 11h17v8.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V11Zm-.5-3.5h18V11H3V7.5ZM12 7.5v13M12 7.5S10.5 3 8.5 3a2.25 2.25 0 0 0 0 4.5H12Zm0 0s1.5-4.5 3.5-4.5a2.25 2.25 0 0 1 0 4.5H12Z',
  key: 'M15 9.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-2.4 2.4L4 20.5H2v-2l8.6-8.6',
  wifi: 'M2.5 9.5a14 14 0 0 1 19 0M6 13a9 9 0 0 1 12 0m-8.5 3.5a4 4 0 0 1 5 0M12 20h.01',
  battery: 'M3.5 8h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-14a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Zm17 2v4M5 10.5h6v3H5v-3Z',
  signal: 'M4 18v-3m4.5 3v-7m4.5 7V8m4.5 10V4',
  utensils: 'M6 3v7a2 2 0 0 0 4 0V3M8 12v9M17 3c-1.5 1.5-2 3-2 5.5 0 1.5.7 2.5 2 2.5v10',
  building: 'M5 20V4.5h9V20M14 9.5h5V20M3.5 20h17M8 8h2M8 12h2M8 16h2m6-4h1m-1 4h1',
} as const;

export interface IconProps {
  name: IconName | string;
  size?: number;
  strokeWidth?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
  filled?: boolean;
}

export function Icon({ name, size = 18, strokeWidth = 1.7, color, className, style, filled }: IconProps) {
  const d = PATHS[name as IconName] ?? PATHS.info;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? (color ?? 'currentColor') : 'none'}
      stroke={filled ? 'none' : (color ?? 'currentColor')}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

export const hasIcon = (name: string): name is IconName => name in PATHS;
