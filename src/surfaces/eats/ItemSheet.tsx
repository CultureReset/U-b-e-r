/**
 * Item customisation. Modifier groups come straight off the merchant's menu,
 * so required/optional, single/multi and min/max selection all behave exactly
 * as the merchant configured them.
 */
import { useMemo, useState } from 'react';
import type { MenuItem } from '@core/types';
import { money } from '@platform/format';
import { round2 } from '@core/util';
import { Icon } from '@ui/Icon';
import { Button, Chip } from '@ui/primitives';
import type { CartSelection } from '@platform/actions/eats';

export function ItemSheet({
  item,
  onAdd,
  onClose,
}: {
  item: MenuItem;
  onAdd: (selections: CartSelection[], quantity: number, note?: string) => void;
  onClose: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const group of item.modifierGroups) {
      const defaults = group.options.filter((o) => o.isDefault && o.available).map((o) => o.id);
      if (defaults.length > 0) initial[group.id] = group.select === 'single' ? [defaults[0]] : defaults;
    }
    return initial;
  });
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');

  const selections = useMemo<CartSelection[]>(
    () =>
      item.modifierGroups
        .map((group) => {
          const optionIds = choices[group.id] ?? [];
          if (optionIds.length === 0) return undefined;
          const options = group.options.filter((o) => optionIds.includes(o.id));
          return {
            groupId: group.id,
            groupName: group.name,
            optionIds,
            optionNames: options.map((o) => o.name),
            priceDelta: round2(options.reduce((acc, o) => acc + o.priceDelta, 0)),
          };
        })
        .filter((s): s is CartSelection => Boolean(s)),
    [choices, item.modifierGroups],
  );

  const unitPrice = round2(item.price + selections.reduce((acc, s) => acc + s.priceDelta, 0));

  const unsatisfied = item.modifierGroups.filter(
    (group) => group.required && (choices[group.id]?.length ?? 0) < Math.max(1, group.minSelect),
  );

  const toggle = (groupId: string, optionId: string, select: 'single' | 'multi', maxSelect: number) => {
    setChoices((current) => {
      const existing = current[groupId] ?? [];
      if (select === 'single') return { ...current, [groupId]: [optionId] };
      if (existing.includes(optionId)) return { ...current, [groupId]: existing.filter((id) => id !== optionId) };
      if (existing.length >= maxSelect) return current;
      return { ...current, [groupId]: [...existing, optionId] };
    });
  };

  return (
    <div className="col" style={{ maxHeight: '100%' }}>
      <div className="col gap-4 grow" style={{ overflowY: 'auto' }}>
        <div
          style={{
            height: 128,
            borderRadius: 'var(--r-lg)',
            background: 'var(--c-bg-sunken)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 54,
          }}
        >
          {item.glyph}
        </div>

        <div className="col gap-1">
          <div className="row spread">
            <span className="t-title">{item.name}</span>
            <span className="t-title t-num">{money(item.price)}</span>
          </div>
          <span className="t-small t-muted">{item.description}</span>
          <div className="row gap-2 wrap" style={{ marginTop: 'var(--s-1)' }}>
            {item.popular && <Chip tone="warning" icon="star">Popular</Chip>}
            {item.tags.map((tag) => (
              <Chip key={tag} tone="outline">
                {tag}
              </Chip>
            ))}
            <Chip tone="outline" icon="clock">
              {item.prepMinutes} min
            </Chip>
          </div>
        </div>

        {item.modifierGroups.map((group) => {
          const selected = choices[group.id] ?? [];
          return (
            <div key={group.id} className="col gap-2">
              <div className="row spread">
                <span className="t-heading">{group.name}</span>
                <Chip tone={group.required ? 'accent' : 'outline'}>
                  {group.required ? 'Required' : group.select === 'multi' ? `Up to ${group.maxSelect}` : 'Optional'}
                </Chip>
              </div>
              <div className="col">
                {group.options.map((option) => {
                  const active = selected.includes(option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className="list-row"
                      data-interactive="true"
                      disabled={!option.available}
                      onClick={() => toggle(group.id, option.id, group.select, group.maxSelect)}
                      style={{ opacity: option.available ? 1 : 0.4, paddingInline: 0 }}
                    >
                      <span
                        style={{
                          width: 19,
                          height: 19,
                          borderRadius: group.select === 'single' ? '50%' : 4,
                          border: `2px solid ${active ? 'var(--accent-surface, var(--c-info))' : 'var(--c-border-strong)'}`,
                          background: active ? 'var(--accent-surface, var(--c-info))' : 'transparent',
                          display: 'grid',
                          placeItems: 'center',
                          flex: 'none',
                        }}
                      >
                        {active && <Icon name="check" size={12} color="#fff" strokeWidth={3} />}
                      </span>
                      <span className="t-body grow" style={{ textAlign: 'left' }}>
                        {option.name}
                        {!option.available && <span className="t-micro t-faint"> · unavailable</span>}
                      </span>
                      {option.priceDelta > 0 && <span className="t-small t-num t-muted">+{money(option.priceDelta)}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="field">
          <label htmlFor="item-note">Special instructions</label>
          <input
            id="item-note"
            className="input"
            placeholder="e.g. no onions"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>

      <div className="row gap-3" style={{ paddingTop: 'var(--s-3)', flex: 'none' }}>
        <div className="row gap-2 panel" style={{ padding: '0 var(--s-2)', height: 50 }}>
          <Button variant="quiet" size="sm" icon="minus" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Decrease" />
          <span className="t-body t-num" style={{ minWidth: 18, textAlign: 'center', fontWeight: 620 }}>
            {quantity}
          </span>
          <Button variant="quiet" size="sm" icon="plus" onClick={() => setQuantity((q) => q + 1)} aria-label="Increase" />
        </div>
        <Button
          variant="primary"
          size="lg"
          block
          disabled={unsatisfied.length > 0}
          onClick={() => {
            onAdd(selections, quantity, note || undefined);
            onClose();
          }}
        >
          {unsatisfied.length > 0 ? `Choose ${unsatisfied[0].name.toLowerCase()}` : `Add · ${money(unitPrice * quantity)}`}
        </Button>
      </div>
    </div>
  );
}
