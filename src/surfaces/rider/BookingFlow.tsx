/**
 * Product picker and confirmation.
 *
 * Every tier is quoted against the same route in one pass, so the prices the
 * rider compares are genuinely comparable — same distance, same time, same
 * surge, different rate card.
 */
import { useMemo, useState } from 'react';
import {
  appConfig,
  getPaymentMethodsForMarket,
  getProductsForMarket,
  orgConfig,
  promotions,
} from '@config';
import type { ID, Place } from '@core/types';
import { arrivalAt, distance, money } from '@platform/format';
import { useWorld } from '@platform/store';
import { evaluatePolicy, quoteProducts } from '@platform/actions/rider';
import { Icon } from '@ui/Icon';
import { Button, Chip, Switch } from '@ui/primitives';
import { FareBreakdown, SurgeChip } from '@ui/components';

export interface BookingSelection {
  productId: ID;
  paymentMethodId: ID;
  promotionCode?: string;
  scheduledFor?: number;
  orgContext?: { orgId: ID; expenseCodeId: ID; memo?: string };
  note?: string;
}

export function ProductPicker({
  stops,
  selection,
  onChange,
  onConfirm,
  onBack,
}: {
  stops: Place[];
  selection: BookingSelection;
  onChange: (next: BookingSelection) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const state = useWorld((s) => s.state);
  const rider = state.riders[state.session.riderId];
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [promoDraft, setPromoDraft] = useState(selection.promotionCode ?? '');

  const products = useMemo(() => getProductsForMarket(state.marketId, 'ride'), [state.marketId]);

  const quotes = useMemo(
    () =>
      quoteProducts(
        state,
        products.map((p) => p.id),
        stops.map((s) => s.at),
        selection.promotionCode,
        rider?.id,
      ),
    // Re-quoting on every world tick would thrash; the route and options are
    // what actually change the price.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.marketId, products, stops.map((s) => `${s.at.lat},${s.at.lng}`).join('|'), selection.promotionCode, rider?.id],
  );

  const selected = quotes[selection.productId];
  const paymentOptions = getPaymentMethodsForMarket(state.marketId, 'ride').filter(
    (m) => m.kind === 'corporate' || rider?.paymentMethodIds.includes(m.id),
  );

  const org = selection.orgContext ? state.orgs[selection.orgContext.orgId] : undefined;
  const policy =
    org && selected
      ? evaluatePolicy(state, org.id, selection.productId, selected.quote.total, rider?.id ?? '')
      : undefined;

  const applicablePromos = promotions.filter((p) => p.enabled && p.appliesTo.includes('ride'));

  return (
    <div className="col" style={{ minHeight: 0, flex: 1 }}>
      <div className="col gap-3 grow" style={{ overflowY: 'auto', paddingBottom: 'var(--s-3)' }}>
        <div className="row spread">
          <span className="t-caps">Choose a ride</span>
          {selected && <SurgeChip multiplier={selected.quote.surgeMultiplier} />}
        </div>

        <div className="col">
          {products.map((product) => {
            const entry = quotes[product.id];
            if (!entry) return null;
            const active = product.id === selection.productId;
            return (
              <button
                key={product.id}
                type="button"
                className="list-row"
                data-interactive="true"
                data-selected={active}
                onClick={() => onChange({ ...selection, productId: product.id })}
                style={{ borderRadius: 'var(--r-md)' }}
              >
                <span
                  style={{
                    width: 44,
                    height: 44,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 'var(--r-md)',
                    background: active ? 'var(--c-accent-soft)' : 'transparent',
                    flex: 'none',
                  }}
                >
                  <Icon name={product.icon} size={26} strokeWidth={1.5} />
                </span>
                <span className="col grow" style={{ gap: 1 }}>
                  <span className="row gap-2">
                    <span className="t-body" style={{ fontWeight: 600 }}>
                      {product.name}
                    </span>
                    {product.seats > 0 && (
                      <span className="row t-micro t-faint" style={{ gap: 2 }}>
                        <Icon name="users" size={11} />
                        {product.seats}
                      </span>
                    )}
                    {product.badge && <Chip tone="accent">{product.badge}</Chip>}
                  </span>
                  <span className="t-micro t-faint t-truncate">
                    {arrivalAt(state.now, entry.etaMin)} · {product.description}
                  </span>
                </span>
                <span className="col" style={{ alignItems: 'flex-end', flex: 'none' }}>
                  <span className="t-body t-num" style={{ fontWeight: 620 }}>
                    {money(entry.quote.total)}
                  </span>
                  {entry.quote.discount > 0 && (
                    <span className="t-micro" style={{ color: 'var(--c-positive)' }}>
                      −{money(entry.quote.discount)}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {selected && (
          <>
            <div className="panel col gap-2">
              <div className="row spread">
                <span className="t-small t-muted">Trip</span>
                <span className="t-small">
                  {distance(selected.distanceKm)} · {selected.etaMin} min
                </span>
              </div>
              <button
                type="button"
                className="row spread"
                style={{ background: 'none', border: 'none', padding: 0 }}
                onClick={() => setShowBreakdown((v) => !v)}
              >
                <span className="t-small t-muted">Fare breakdown</span>
                <Icon name={showBreakdown ? 'chevron-up' : 'chevron-down'} size={15} color="var(--c-text-muted)" />
              </button>
              {showBreakdown && <FareBreakdown quote={selected.quote} />}
            </div>

            {/* Payment */}
            <div className="col gap-2">
              <span className="t-caps">Payment</span>
              <div className="scroll-x">
                {paymentOptions.map((method) => {
                  const isCorporate = method.kind === 'corporate';
                  const active = selection.paymentMethodId === method.id;
                  const disabled = isCorporate && !rider?.orgMembership;
                  return (
                    <button
                      key={method.id}
                      type="button"
                      className="pill-filter"
                      data-active={active}
                      disabled={disabled}
                      style={disabled ? { opacity: 0.4 } : undefined}
                      onClick={() =>
                        onChange({
                          ...selection,
                          paymentMethodId: method.id,
                          orgContext:
                            isCorporate && rider?.orgMembership
                              ? {
                                  orgId: rider.orgMembership.orgId,
                                  expenseCodeId: selection.orgContext?.expenseCodeId ?? orgConfig.expenseCodes[0].id,
                                  memo: selection.orgContext?.memo,
                                }
                              : undefined,
                        })
                      }
                    >
                      <Icon name={method.icon} size={14} />
                      {method.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Business booking context */}
            {selection.orgContext && org && (
              <div className="panel col gap-3">
                <span className="row gap-2">
                  <Icon name="briefcase" size={15} />
                  <span className="t-small" style={{ fontWeight: 560 }}>
                    {org.name} business profile
                  </span>
                </span>
                <div className="field">
                  <label htmlFor="expense-code">Expense code</label>
                  <select
                    id="expense-code"
                    className="select"
                    value={selection.orgContext.expenseCodeId}
                    onChange={(e) =>
                      onChange({
                        ...selection,
                        orgContext: { ...selection.orgContext!, expenseCodeId: e.target.value },
                      })
                    }
                  >
                    {orgConfig.expenseCodes.map((code) => (
                      <option key={code.id} value={code.id}>
                        {code.code} · {code.label}
                      </option>
                    ))}
                  </select>
                </div>
                {orgConfig.expenseCodes.find((c) => c.id === selection.orgContext?.expenseCodeId)?.requiresMemo && (
                  <div className="field">
                    <label htmlFor="memo">Reason (required)</label>
                    <input
                      id="memo"
                      className="input"
                      value={selection.orgContext.memo ?? ''}
                      placeholder="e.g. Client meeting — Acme"
                      onChange={(e) =>
                        onChange({ ...selection, orgContext: { ...selection.orgContext!, memo: e.target.value } })
                      }
                    />
                  </div>
                )}
                {policy && policy.violations.length > 0 && (
                  <div className="col gap-1">
                    {policy.violations.map((violation) => (
                      <span
                        key={violation.ruleId}
                        className="row gap-2 t-micro"
                        style={{ color: violation.action === 'block' ? 'var(--c-danger)' : 'var(--c-warning)' }}
                      >
                        <Icon name="alert" size={13} />
                        {violation.label} · {violation.action.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Promo */}
            {appConfig.features.promotions && (
              <div className="col gap-2">
                <span className="t-caps">Promotions</span>
                <div className="row gap-2">
                  <input
                    className="input grow"
                    placeholder="Enter a promo code"
                    value={promoDraft}
                    onChange={(e) => setPromoDraft(e.target.value.toUpperCase())}
                  />
                  <Button variant="ghost" onClick={() => onChange({ ...selection, promotionCode: promoDraft })}>
                    Apply
                  </Button>
                </div>
                <div className="scroll-x">
                  {applicablePromos.map((promo) => (
                    <button
                      key={promo.id}
                      type="button"
                      className="pill-filter"
                      data-active={selection.promotionCode === promo.code}
                      onClick={() => {
                        setPromoDraft(promo.code);
                        onChange({ ...selection, promotionCode: promo.code });
                      }}
                    >
                      <Icon name="gift" size={13} />
                      {promo.code}
                    </button>
                  ))}
                </div>
                {selection.promotionCode && selected.quote.discount === 0 && (
                  <span className="t-micro" style={{ color: 'var(--c-warning)' }}>
                    {selection.promotionCode} is not valid for this trip.
                  </span>
                )}
              </div>
            )}

            {/* Scheduling */}
            {appConfig.features.scheduledRides && (
              <div className="col gap-2">
                <Switch
                  checked={showSchedule}
                  onChange={(next) => {
                    setShowSchedule(next);
                    if (!next) onChange({ ...selection, scheduledFor: undefined });
                  }}
                  label="Schedule for later"
                  hint="We'll dispatch a driver ahead of your pickup time."
                />
                {showSchedule && (
                  <div className="row gap-2">
                    {[15, 30, 60, 120].map((minutes) => (
                      <button
                        key={minutes}
                        type="button"
                        className="pill-filter grow center"
                        data-active={
                          selection.scheduledFor !== undefined &&
                          Math.abs(selection.scheduledFor - (state.now + minutes * 60_000)) < 60_000
                        }
                        onClick={() => onChange({ ...selection, scheduledFor: state.now + minutes * 60_000 })}
                      >
                        {minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="field">
              <label htmlFor="driver-note">Note for the driver</label>
              <input
                id="driver-note"
                className="input"
                placeholder="e.g. I'm by the north entrance"
                value={selection.note ?? ''}
                onChange={(e) => onChange({ ...selection, note: e.target.value })}
              />
            </div>
          </>
        )}
      </div>

      <div className="row gap-2" style={{ flex: 'none', paddingTop: 'var(--s-2)' }}>
        <Button variant="ghost" icon="arrow-left" onClick={onBack} aria-label="Back" />
        <Button
          variant="primary"
          size="lg"
          block
          disabled={!selected || policy?.blocked}
          onClick={onConfirm}
        >
          {policy?.blocked
            ? 'Blocked by travel policy'
            : selection.scheduledFor
              ? `Schedule · ${money(selected?.quote.total ?? 0)}`
              : `Confirm · ${money(selected?.quote.total ?? 0)}`}
        </Button>
      </div>
    </div>
  );
}
