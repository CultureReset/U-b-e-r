/**
 * Locale-aware formatting. Every user-visible number goes through here so a
 * change of currency or unit in app.config propagates across all six surfaces.
 */
import { appConfig } from '@config';

const currencyFormatter = new Intl.NumberFormat(appConfig.currencyLocale, {
  style: 'currency',
  currency: appConfig.currency,
  minimumFractionDigits: 2,
});

const compactCurrencyFormatter = new Intl.NumberFormat(appConfig.currencyLocale, {
  style: 'currency',
  currency: appConfig.currency,
  notation: 'compact',
  maximumFractionDigits: 1,
});

export const money = (value: number): string => currencyFormatter.format(value ?? 0);
export const moneyCompact = (value: number): string => compactCurrencyFormatter.format(value ?? 0);

/** Signed money for ledger rows: −12.40 / +8.90. */
export const moneySigned = (value: number): string =>
  `${value < 0 ? '−' : '+'}${currencyFormatter.format(Math.abs(value ?? 0))}`;

export const distance = (km: number): string => {
  const unit = appConfig.distanceUnit;
  const value = unit === 'mi' ? km * 0.621371 : km;
  return value < 1 ? `${Math.round(value * 1000)} m` : `${value.toFixed(1)} ${unit}`;
};

export const duration = (minutes: number): string => {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
};

const timeFormatter = new Intl.DateTimeFormat(appConfig.locale, {
  hour: 'numeric',
  minute: '2-digit',
  hour12: appConfig.timeFormat === '12h',
});

const dateFormatter = new Intl.DateTimeFormat(appConfig.locale, { month: 'short', day: 'numeric' });
const dateTimeFormatter = new Intl.DateTimeFormat(appConfig.locale, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: appConfig.timeFormat === '12h',
});
const weekdayFormatter = new Intl.DateTimeFormat(appConfig.locale, { weekday: 'short' });

export const clock = (ts: number): string => timeFormatter.format(ts);
export const day = (ts: number): string => dateFormatter.format(ts);
export const dayTime = (ts: number): string => dateTimeFormatter.format(ts);
export const weekday = (ts: number): string => weekdayFormatter.format(ts);

/** "in 4 min" / "2 min ago" — the relative language the products live on. */
export function relative(ts: number, now: number): string {
  const deltaSec = Math.round((ts - now) / 1000);
  const abs = Math.abs(deltaSec);
  if (abs < 45) return deltaSec >= 0 ? 'now' : 'just now';
  const minutes = Math.round(abs / 60);
  if (minutes < 60) return deltaSec > 0 ? `in ${minutes} min` : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return deltaSec > 0 ? `in ${hours} hr` : `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return deltaSec > 0 ? `in ${days} d` : `${days} d ago`;
}

/** Arrival time from a duration — "arrives 4:52 PM". */
export const arrivalAt = (now: number, minutes: number): string => clock(now + minutes * 60_000);

export const percent = (value: number, digits = 0): string => `${(value * 100).toFixed(digits)}%`;

export const rating = (value: number): string => value.toFixed(2);

export const plural = (count: number, singular: string, pluralForm?: string): string =>
  `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;

export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

/** Stable pastel from an account hue — avatars without image assets. */
export const avatarColors = (hue: number): { bg: string; fg: string } => ({
  bg: `hsl(${hue} 62% 88%)`,
  fg: `hsl(${hue} 68% 26%)`,
});

export const priceTierLabel = (tier: number): string => '$'.repeat(Math.max(1, Math.min(4, tier)));
