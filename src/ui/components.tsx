/**
 * Domain-aware components shared across surfaces. Anything a rider, an earner
 * and an ops analyst all need to look at lives here so the three of them are
 * literally reading the same rendering of the same record.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { getProduct, getVehicleClass, paymentMethods, type LatLng } from '@config';
import {
  orderStatusPresentation,
  tripStatusPresentation,
  type StatusPresentation,
} from '@core/lifecycle';
import type { ChatMessage, Order, Quote, Trip } from '@core/types';
import { clock, dayTime, distance, duration, money, moneySigned, relative } from '@platform/format';
import { Icon, type IconName } from './Icon';
import { Avatar, Button, Chip, Stars, StatusDot } from './primitives';

/* ------------------------------ Status ------------------------------- */

export const statusOf = (job: Trip | Order): StatusPresentation =>
  job.kind === 'trip' ? tripStatusPresentation[job.status] : orderStatusPresentation[job.status];

export function StatusBadge({ job, audience = 'consumer' }: { job: Trip | Order; audience?: 'consumer' | 'earner' }) {
  const presentation = statusOf(job);
  return (
    <span className="row gap-2">
      <StatusDot tone={presentation.tone} />
      <span className="t-small" style={{ fontWeight: 560 }}>
        {presentation.label}
      </span>
      <span className="t-micro t-faint t-truncate">
        {audience === 'consumer' ? presentation.consumerCopy : presentation.earnerCopy}
      </span>
    </span>
  );
}

export function ProgressSteps({ job }: { job: Trip | Order }) {
  const presentation = statusOf(job);
  const segments = 5;
  return (
    <div className="steps">
      {Array.from({ length: segments }, (_, i) => (
        <i key={i} data-done={presentation.progress >= (i + 1) / segments} />
      ))}
    </div>
  );
}

/* --------------------------- Fare breakdown --------------------------- */

/** The itemised receipt. Identical markup for a quote preview and a receipt. */
export function FareBreakdown({
  quote,
  compact,
  showPayout,
  title,
}: {
  quote: Quote;
  compact?: boolean;
  showPayout?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(!compact);
  const visible = open ? quote.lines : quote.lines.filter((l) => ['goods', 'discount', 'tip'].includes(l.kind));

  return (
    <div className="col gap-2">
      {title && <span className="t-caps">{title}</span>}
      {compact && (
        <button
          type="button"
          className="row spread"
          onClick={() => setOpen((o) => !o)}
          style={{ background: 'none', border: 'none', padding: 0, width: '100%' }}
        >
          <span className="t-small t-muted">{open ? 'Hide breakdown' : 'Show breakdown'}</span>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={15} color="var(--c-text-muted)" />
        </button>
      )}

      {visible.map((line) => (
        <div key={line.id} className="row spread gap-3">
          <span className="row gap-2 grow" style={{ minWidth: 0 }}>
            <span
              className="t-small t-truncate"
              style={{ color: line.kind === 'discount' ? 'var(--c-positive)' : undefined }}
            >
              {line.label}
            </span>
            {line.hint && open && <span className="t-micro t-faint t-truncate">{line.hint}</span>}
          </span>
          <span
            className="t-small t-num"
            style={{
              fontWeight: 540,
              color: line.kind === 'discount' ? 'var(--c-positive)' : undefined,
              whiteSpace: 'nowrap',
            }}
          >
            {line.amount < 0 ? `−${money(Math.abs(line.amount))}` : money(line.amount)}
          </span>
        </div>
      ))}

      <hr className="divider" />
      <div className="row spread">
        <strong className="t-body">Total</strong>
        <strong className="t-heading t-num">{money(quote.total)}</strong>
      </div>

      {showPayout && (
        <div className="panel col gap-1" style={{ marginTop: 'var(--s-1)' }}>
          <div className="row spread">
            <span className="t-small t-muted">Earner receives</span>
            <span className="t-small t-num" style={{ fontWeight: 560 }}>
              {money(quote.earnerPayout)}
            </span>
          </div>
          <div className="row spread">
            <span className="t-small t-muted">Platform revenue</span>
            <span className="t-small t-num">{money(quote.platformRevenue)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Timeline ------------------------------ */

export function JobTimeline({ job, now }: { job: Trip | Order; now: number }) {
  const entries = job.timeline;
  if (entries.length === 0) return null;
  return (
    <ol className="col gap-3">
      {entries.map((entry, index) => {
        const last = index === entries.length - 1;
        return (
          <li key={`${entry.status}-${entry.at}-${index}`} className="row-top row gap-3">
            <span className="col" style={{ alignItems: 'center', alignSelf: 'stretch', flex: 'none' }}>
              <span
                className="dot"
                style={{
                  background: last ? 'var(--accent-surface, var(--c-info))' : 'var(--c-border-strong)',
                  marginTop: 5,
                }}
              />
              {!last && <span style={{ width: 1, flex: 1, background: 'var(--c-border)', marginTop: 3 }} />}
            </span>
            <span className="col grow" style={{ gap: 1, paddingBottom: last ? 0 : 'var(--s-1)' }}>
              <span className="t-small" style={{ fontWeight: 540, textTransform: 'capitalize' }}>
                {entry.status.replace(/_/g, ' ')}
              </span>
              <span className="t-micro t-faint">
                {clock(entry.at)} · {relative(entry.at, now)}
                {entry.actor ? ` · ${entry.actor}` : ''}
                {entry.note ? ` · ${entry.note}` : ''}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------- Stops -------------------------------- */

export function StopList({ job, now }: { job: Trip | Order; now?: number }) {
  return (
    <ol className="col">
      {job.stops.map((stop, index) => {
        const last = index === job.stops.length - 1;
        const done = Boolean(stop.completedAt);
        return (
          <li key={stop.id} className="row row-top gap-3" style={{ paddingBlock: 'var(--s-1)' }}>
            <span className="col" style={{ alignItems: 'center', alignSelf: 'stretch', flex: 'none', width: 12 }}>
              <span
                style={{
                  width: last ? 9 : 9,
                  height: 9,
                  marginTop: 6,
                  borderRadius: last ? 2 : '50%',
                  background: done ? 'var(--c-text-faint)' : last ? 'var(--c-text)' : 'var(--c-positive)',
                }}
              />
              {!last && <span style={{ width: 1, flex: 1, background: 'var(--c-border-strong)', marginBlock: 3 }} />}
            </span>
            <span className="col grow" style={{ gap: 1, paddingBottom: last ? 0 : 'var(--s-3)' }}>
              <span className="t-body t-truncate" style={{ fontWeight: 540, opacity: done ? 0.55 : 1 }}>
                {stop.place.label}
              </span>
              <span className="t-micro t-faint t-truncate">{stop.place.addressLine}</span>
              {stop.place.note && <span className="t-micro" style={{ color: 'var(--c-info)' }}>Note: {stop.place.note}</span>}
              {stop.instructions && <span className="t-micro t-faint">{stop.instructions}</span>}
            </span>
            {now && stop.etaAt && !done && <span className="t-micro t-faint">{clock(stop.etaAt)}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------ Vehicle ------------------------------- */

export function VehicleBadge({ classId, plate, color }: { classId: string; plate?: string; color?: string }) {
  const vehicleClass = getVehicleClass(classId);
  return (
    <span className="row gap-2">
      <Icon name={vehicleClass?.icon ?? 'car'} size={16} />
      <span className="t-small t-muted">{color ? `${color} ` : ''}{vehicleClass?.label ?? classId}</span>
      {plate && (
        <span
          className="t-mono"
          style={{
            padding: '1px 6px',
            borderRadius: 4,
            border: '1px solid var(--c-border-strong)',
            letterSpacing: '0.06em',
            fontWeight: 620,
          }}
        >
          {plate}
        </span>
      )}
    </span>
  );
}

/* ------------------------------- People ------------------------------- */

export function PersonRow({
  name,
  hue = 210,
  rating,
  subtitle,
  size = 44,
  trailing,
  glyph,
  color,
}: {
  name: string;
  hue?: number;
  rating?: number;
  subtitle?: ReactNode;
  size?: number;
  trailing?: ReactNode;
  glyph?: string;
  color?: string;
}) {
  return (
    <div className="row gap-3">
      <Avatar name={name} hue={hue} size={size} glyph={glyph} color={color} />
      <div className="col grow" style={{ gap: 1 }}>
        <span className="t-body t-truncate" style={{ fontWeight: 580 }}>
          {name}
        </span>
        <span className="row gap-2 t-small t-muted">
          {rating !== undefined && (
            <span className="row" style={{ gap: 3 }}>
              <Icon name="star" size={12} filled color="#f0a91b" />
              {rating.toFixed(2)}
            </span>
          )}
          {subtitle}
        </span>
      </div>
      {trailing}
    </div>
  );
}

/* -------------------------------- Chat -------------------------------- */

export const cannedReplies: Record<string, string[]> = {
  rider: ["I'm on my way out", 'Please wait a moment', "I'm at the pickup point", 'Thanks!'],
  driver: ["I'm arriving now", "I'm outside", 'Traffic is heavy, running late', 'On my way'],
  merchant: ['Your order is being prepared', 'Running a few minutes late', 'An item is unavailable — substituting'],
  support: ['How can I help?', 'Looking into this now'],
};

export function ChatPanel({
  messages,
  viewer,
  now,
  onSend,
  placeholder = 'Message…',
}: {
  messages: ChatMessage[];
  viewer: ChatMessage['from'];
  now: number;
  onSend: (body: string, cannedId?: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const canned = cannedReplies[viewer] ?? [];

  const send = (body: string, cannedId?: string) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    onSend(trimmed, cannedId);
    setDraft('');
  };

  return (
    <div className="col gap-3">
      <div className="col gap-2" style={{ maxHeight: 240, overflowY: 'auto' }}>
        {messages.length === 0 && <span className="t-small t-faint">No messages yet.</span>}
        {messages.map((message) => {
          const mine = message.from === viewer;
          return (
            <div key={message.id} className="col" style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: 2 }}>
              <div
                style={{
                  maxWidth: '82%',
                  padding: '7px 11px',
                  borderRadius: 'var(--r-lg)',
                  borderBottomRightRadius: mine ? 4 : undefined,
                  borderBottomLeftRadius: mine ? undefined : 4,
                  background: mine ? 'var(--c-accent)' : 'var(--c-surface-alt)',
                  color: mine ? 'var(--c-accent-text)' : 'var(--c-text)',
                  fontSize: 13.5,
                }}
              >
                {message.body}
              </div>
              <span className="t-micro t-faint">
                {mine ? 'You' : message.fromName} · {relative(message.at, now)}
              </span>
            </div>
          );
        })}
      </div>

      {canned.length > 0 && (
        <div className="scroll-x">
          {canned.map((reply) => (
            <button
              key={reply}
              type="button"
              className="pill-filter"
              onClick={() => send(reply, reply)}
            >
              {reply}
            </button>
          ))}
        </div>
      )}

      <div className="row gap-2">
        <input
          className="input grow"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send(draft);
          }}
        />
        <Button variant="primary" icon="arrow-right" onClick={() => send(draft)} aria-label="Send" />
      </div>
    </div>
  );
}

/* ------------------------------- Rating ------------------------------- */

const RATING_TAGS = [
  'Great conversation',
  'Clean vehicle',
  'Smooth ride',
  'Excellent service',
  'Great route',
  'Above and beyond',
];

export function RatingForm({
  onSubmit,
  tipOptions,
  subject,
  allowTip = true,
}: {
  onSubmit: (stars: number, tags: string[], tip: number, comment?: string) => void;
  tipOptions: number[];
  subject: string;
  allowTip?: boolean;
}) {
  const [stars, setStars] = useState(5);
  const [tags, setTags] = useState<string[]>([]);
  const [tip, setTip] = useState(0);
  const [comment, setComment] = useState('');
  const [customTip, setCustomTip] = useState('');

  const toggleTag = (tag: string) =>
    setTags((current) => (current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]));

  return (
    <div className="col gap-4">
      <div className="col gap-2" style={{ alignItems: 'center' }}>
        <span className="t-body t-muted">How was your experience with {subject}?</span>
        <Stars value={stars} onChange={setStars} size={30} />
      </div>

      <div className="row wrap gap-2">
        {RATING_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            className="pill-filter"
            data-active={tags.includes(tag)}
            onClick={() => toggleTag(tag)}
          >
            {tag}
          </button>
        ))}
      </div>

      {allowTip && (
        <div className="col gap-2">
          <span className="t-caps">Add a tip · 100% goes to them</span>
          <div className="row gap-2">
            {tipOptions.map((amount) => (
              <button
                key={amount}
                type="button"
                className="pill-filter grow center"
                data-active={tip === amount}
                onClick={() => {
                  setTip(tip === amount ? 0 : amount);
                  setCustomTip('');
                }}
              >
                {money(amount)}
              </button>
            ))}
            <input
              className="input"
              style={{ width: 84, height: 34 }}
              placeholder="Other"
              inputMode="decimal"
              value={customTip}
              onChange={(e) => {
                setCustomTip(e.target.value);
                setTip(Number(e.target.value) || 0);
              }}
            />
          </div>
        </div>
      )}

      <textarea
        className="textarea"
        placeholder="Add a comment (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />

      <Button variant="primary" size="lg" block onClick={() => onSubmit(stars, tags, tip, comment || undefined)}>
        Submit rating
      </Button>
    </div>
  );
}

/* --------------------------- Payment method --------------------------- */

export function PaymentMethodRow({ methodId, trailing }: { methodId: string; trailing?: ReactNode }) {
  const method = paymentMethods.find((m) => m.id === methodId);
  return (
    <span className="row gap-2 grow">
      <Icon name={(method?.icon as IconName) ?? 'card'} size={17} />
      <span className="t-small grow t-truncate">{method?.label ?? methodId}</span>
      {trailing}
    </span>
  );
}

/* ------------------------------ Job card ------------------------------ */

export function JobSummaryRow({
  job,
  onClick,
  showAmount = true,
}: {
  job: Trip | Order;
  onClick?: () => void;
  showAmount?: boolean;
}) {
  const product = getProduct(job.productId);
  const settled = job.settlement ?? job.quote;
  const at = job.kind === 'trip' ? (job.completedAt ?? job.requestedAt) : (job.deliveredAt ?? job.placedAt);
  const destination = job.stops[job.stops.length - 1]?.place.label ?? '—';
  const presentation = statusOf(job);
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag className="list-row" data-interactive={Boolean(onClick)} onClick={onClick} type={onClick ? 'button' : undefined}>
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: 'var(--r-md)',
          background: 'var(--c-accent-soft)',
          display: 'grid',
          placeItems: 'center',
          flex: 'none',
        }}
      >
        <Icon name={product?.icon ?? 'car'} size={18} />
      </span>
      <span className="col grow" style={{ gap: 2 }}>
        <span className="t-body t-truncate" style={{ fontWeight: 550 }}>
          {destination}
        </span>
        <span className="t-micro t-faint t-truncate">
          {dayTime(at)} · {product?.shortName ?? job.productId} · {job.code}
        </span>
      </span>
      <span className="col" style={{ alignItems: 'flex-end', gap: 2, flex: 'none' }}>
        {showAmount && <span className="t-body t-num" style={{ fontWeight: 560 }}>{money(settled.total)}</span>}
        <span className="t-micro" style={{ color: `var(--c-${presentation.tone === 'positive' ? 'positive' : presentation.tone === 'danger' ? 'danger' : 'text-faint'})` }}>
          {presentation.label}
        </span>
      </span>
    </Tag>
  );
}

/* ----------------------------- Ledger row ----------------------------- */

export function LedgerRow({ label, amount, at, sublabel }: { label: string; amount: number; at: number; sublabel?: string }) {
  return (
    <div className="row spread gap-3" style={{ paddingBlock: 'var(--s-2)' }}>
      <span className="col grow" style={{ gap: 1 }}>
        <span className="t-small t-truncate" style={{ fontWeight: 520 }}>{label}</span>
        <span className="t-micro t-faint">{dayTime(at)}{sublabel ? ` · ${sublabel}` : ''}</span>
      </span>
      <span
        className="t-small t-num"
        style={{ fontWeight: 560, color: amount >= 0 ? 'var(--c-positive)' : undefined, whiteSpace: 'nowrap' }}
      >
        {moneySigned(amount)}
      </span>
    </div>
  );
}

/* ---------------------------- ETA summary ----------------------------- */

export function RouteSummary({ km, minutes, extra }: { km: number; minutes: number; extra?: ReactNode }) {
  return (
    <span className="row gap-3 t-small t-muted">
      <span className="row gap-1">
        <Icon name="route" size={14} />
        {distance(km)}
      </span>
      <span className="row gap-1">
        <Icon name="clock" size={14} />
        {duration(minutes)}
      </span>
      {extra}
    </span>
  );
}

/* --------------------------- Surge indicator -------------------------- */

export function SurgeChip({ multiplier }: { multiplier: number }) {
  if (multiplier < 1.15) return null;
  return (
    <Chip tone={multiplier >= 1.8 ? 'danger' : 'warning'} icon="bolt">
      {multiplier.toFixed(1)}x demand
    </Chip>
  );
}

export function PointLabel({ at }: { at: LatLng }) {
  return (
    <span className="t-mono t-faint">
      {at.lat.toFixed(4)}, {at.lng.toFixed(4)}
    </span>
  );
}
