/**
 * Business surface — the enterprise travel and expense console.
 *
 * Every trip and order here was booked by an employee in the consumer surfaces
 * on a business profile. Policy edits made on this screen are evaluated live
 * at the point of booking, so tightening a rule here blocks a booking there.
 */
import { useMemo, useState } from 'react';
import { getProduct, getProductsForMarket, orgConfig } from '@config';
import type { ID, Order, Trip } from '@core/types';
import { dayTime, money, moneyCompact, percent, plural } from '@platform/format';
import { useAction, useCurrentOrg } from '@platform/hooks';
import { useWorld } from '@platform/store';
import * as businessActions from '@platform/actions/business';
import { useSurfaceAccent } from '@platform/theme';
import { ConsoleLayout } from '@app/ConsoleLayout';
import { Icon } from '@ui/Icon';
import { Avatar, Button, Card, Chip, Empty, ListRow, Meter, Metric, Modal, Switch } from '@ui/primitives';
import { FareBreakdown, JobTimeline, StatusBadge, StopList } from '@ui/components';

type Section = 'overview' | 'activity' | 'approvals' | 'policy' | 'people' | 'reports' | 'billing';

export function BusinessSurface() {
  useSurfaceAccent('business');
  const state = useWorld((s) => s.state);
  const org = useCurrentOrg();
  const setSessionOrg = useWorld((s) => s.setSessionOrg);
  const [section, setSection] = useState<Section>('overview');
  const [switching, setSwitching] = useState(false);

  const summary = useMemo(() => (org ? businessActions.orgSummary(state, org.id) : undefined), [state, org]);

  if (!org || !summary) {
    return <Empty title="No business programme" hint="Enable business profiles in config/app.config.ts." />;
  }

  const sections = [
    {
      group: 'Programme',
      items: [
        { id: 'overview', label: 'Overview', icon: 'grid' },
        { id: 'activity', label: 'Activity', icon: 'history' },
        { id: 'approvals', label: 'Approvals', icon: 'check', badge: summary.pendingApprovals },
      ],
    },
    {
      group: 'Administration',
      items: [
        { id: 'policy', label: 'Travel policy', icon: 'shield' },
        { id: 'people', label: 'People', icon: 'users' },
      ],
    },
    {
      group: 'Finance',
      items: [
        { id: 'reports', label: 'Reports', icon: 'chart' },
        { id: 'billing', label: 'Billing', icon: 'card' },
      ],
    },
  ];

  return (
    <ConsoleLayout
      sections={sections}
      active={section}
      onChange={(id) => setSection(id as Section)}
      brand={
        <button
          type="button"
          className="row gap-3"
          onClick={() => setSwitching(true)}
          style={{ background: 'none', border: 'none', padding: 'var(--s-2)', textAlign: 'left', width: '100%' }}
        >
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 'var(--r-md)',
              background: 'var(--c-accent-soft)',
              display: 'grid',
              placeItems: 'center',
              fontSize: 17,
            }}
          >
            {org.glyph}
          </span>
          <span className="col grow" style={{ gap: 1 }}>
            <span className="t-body t-truncate" style={{ fontWeight: 620 }}>
              {org.name}
            </span>
            <span className="t-micro t-faint">{org.industry} · switch org</span>
          </span>
          <Icon name="chevron-down" size={14} color="var(--c-text-faint)" />
        </button>
      }
      title={SECTION_TITLES[section]}
      subtitle={`${plural(summary.activeMembers, 'active member')} · ${moneyCompact(summary.spend)} programme spend`}
      footer={
        <div className="col gap-2" style={{ padding: 'var(--s-2)' }}>
          <div className="row spread">
            <span className="t-micro t-faint">Budget used</span>
            <span className="t-small t-num">{percent(summary.budgetUsed)}</span>
          </div>
          <Meter
            value={summary.budgetUsed}
            tone={summary.budgetUsed > 0.9 ? 'var(--c-danger)' : undefined}
          />
        </div>
      }
    >
      {section === 'overview' && <OverviewSection />}
      {section === 'activity' && <ActivitySection />}
      {section === 'approvals' && <ApprovalsSection />}
      {section === 'policy' && <PolicySection />}
      {section === 'people' && <PeopleSection />}
      {section === 'reports' && <ReportsSection />}
      {section === 'billing' && <BillingSection />}

      {switching && (
        <Modal title="Switch organisation" onClose={() => setSwitching(false)}>
          <div className="col">
            {Object.values(state.orgs).map((candidate) => (
              <ListRow
                key={candidate.id}
                leading={<span style={{ fontSize: 20, width: 26, textAlign: 'center' }}>{candidate.glyph}</span>}
                title={candidate.name}
                subtitle={`${candidate.industry} · ${candidate.members.length} members`}
                selected={candidate.id === org.id}
                onClick={() => {
                  setSessionOrg(candidate.id);
                  setSwitching(false);
                }}
              />
            ))}
          </div>
        </Modal>
      )}
    </ConsoleLayout>
  );
}

const SECTION_TITLES: Record<Section, string> = {
  overview: 'Programme overview',
  activity: 'Travel activity',
  approvals: 'Pending approvals',
  policy: 'Travel policy',
  people: 'People',
  reports: 'Reports',
  billing: 'Billing',
};

/* ------------------------------- Overview -------------------------------- */

function OverviewSection() {
  const state = useWorld((s) => s.state);
  const org = useCurrentOrg()!;
  const summary = businessActions.orgSummary(state, org.id)!;
  const byDay = businessActions.buildReport(state, org.id, 'rep-day');
  const byDept = businessActions.buildReport(state, org.id, 'rep-dept');
  const peak = Math.max(1, ...byDay.map((r) => r.amount));

  return (
    <div className="col gap-4">
      <div className="grid-metrics">
        <Metric label="Programme spend" value={money(summary.spend)} hint={`of ${moneyCompact(org.monthlyBudget)} budget`} />
        <Metric label="Trips" value={summary.trips} />
        <Metric label="Delivery orders" value={summary.orders} />
        <Metric label="Average journey" value={money(summary.averageJob)} />
        <Metric
          label="Policy exceptions"
          value={summary.flagged}
          tone={summary.flagged > 0 ? 'warning' : undefined}
          hint={`${summary.pendingApprovals} awaiting approval`}
        />
      </div>

      <div className="grid-split">
        <Card title="Daily spend">
          {byDay.length === 0 ? (
            <Empty icon="chart" title="No activity yet" />
          ) : (
            <div className="row" style={{ gap: 5, alignItems: 'flex-end', height: 160 }}>
              {byDay.slice(-21).map((row) => (
                <div key={row.key} className="col grow" style={{ alignItems: 'center', gap: 4 }}>
                  <div
                    title={`${row.label} · ${money(row.amount)}`}
                    style={{
                      width: '100%',
                      height: `${Math.max(3, (row.amount / peak) * 128)}px`,
                      borderRadius: 'var(--r-sm)',
                      background: 'var(--accent-surface, var(--c-info))',
                    }}
                  />
                  <span className="t-micro t-faint" style={{ fontSize: 9 }}>
                    {row.label.split(' ')[1] ?? ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Spend by department">
          <div className="col gap-3">
            {byDept.length === 0 && <Empty icon="users" title="No departmental spend yet" />}
            {byDept.slice(0, 8).map((row) => (
              <div key={row.key} className="col gap-1">
                <div className="row spread">
                  <span className="t-small">{row.label}</span>
                  <span className="t-small t-num">
                    {money(row.amount)} · {percent(row.share)}
                  </span>
                </div>
                <Meter value={row.share} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Programme configuration">
        <div className="col gap-3">
          <div className="row spread">
            <span className="t-small t-muted">Approved products</span>
            <span className="row gap-2 wrap">
              {org.allowedProductIds.map((productId) => (
                <Chip key={productId} tone="outline">
                  {getProduct(productId)?.shortName ?? productId}
                </Chip>
              ))}
            </span>
          </div>
          <div className="row spread">
            <span className="t-small t-muted">Active policy rules</span>
            <span className="t-small t-num">
              {org.policyRuleIds.length} of {orgConfig.policyRules.length}
            </span>
          </div>
          <div className="row spread">
            <span className="t-small t-muted">Approval threshold</span>
            <span className="t-small t-num">{money(orgConfig.approvalThreshold)}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------- Activity -------------------------------- */

function ActivitySection() {
  const state = useWorld((s) => s.state);
  const org = useCurrentOrg()!;
  const [selected, setSelected] = useState<ID | undefined>();
  const [filter, setFilter] = useState<'all' | 'flagged' | 'trips' | 'orders'>('all');

  const jobs = businessActions.orgJobs(state, org.id).filter((job) => {
    if (filter === 'flagged') return (job.orgContext?.violations.length ?? 0) > 0;
    if (filter === 'trips') return job.kind === 'trip';
    if (filter === 'orders') return job.kind === 'order';
    return true;
  });

  const detail = selected ? (state.trips[selected] ?? state.orders[selected]) : undefined;

  return (
    <div className="col gap-4">
      <div className="row gap-2">
        {(['all', 'flagged', 'trips', 'orders'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className="pill-filter"
            data-active={filter === option}
            onClick={() => setFilter(option)}
            style={{ textTransform: 'capitalize' }}
          >
            {option}
          </button>
        ))}
        <span className="t-small t-faint" style={{ marginLeft: 'auto' }}>
          {plural(jobs.length, 'journey')}
        </span>
      </div>

      <Card pad={false}>
        <div className="table-scroll" style={{ maxHeight: '62vh' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Employee</th>
                <th>Department</th>
                <th>Journey</th>
                <th>Expense code</th>
                <th>Status</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {jobs.slice(0, 200).map((job) => {
                const riderId = job.kind === 'trip' ? job.riderId : job.customerId;
                const member = org.members.find((m) => m.riderId === riderId);
                const code = orgConfig.expenseCodes.find((c) => c.id === job.orgContext?.expenseCodeId);
                const flagged = (job.orgContext?.violations.length ?? 0) > 0;
                return (
                  <tr key={job.id} onClick={() => setSelected(job.id)} style={{ cursor: 'pointer' }}>
                    <td>
                      <span className="row gap-2">
                        <Icon name={job.kind === 'trip' ? 'car' : 'bag'} size={14} />
                        {job.code}
                      </span>
                    </td>
                    <td>{member?.name ?? state.riders[riderId]?.displayName ?? '—'}</td>
                    <td className="t-muted">{member?.department ?? '—'}</td>
                    <td className="t-truncate" style={{ maxWidth: 220 }}>
                      {job.stops[job.stops.length - 1]?.place.label}
                    </td>
                    <td>{code ? <Chip tone="outline">{code.code}</Chip> : '—'}</td>
                    <td>
                      {flagged ? (
                        <Chip tone="warning">
                          {job.orgContext?.approvalStatus === 'pending' ? 'Awaiting approval' : 'Exception'}
                        </Chip>
                      ) : (
                        <span className="t-muted">{job.status.replace(/_/g, ' ')}</span>
                      )}
                    </td>
                    <td className="num">{money(businessActions.jobAmount(job))}</td>
                  </tr>
                );
              })}
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <Empty icon="history" title="No journeys match this filter" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {detail && <JourneyDetail job={detail} onClose={() => setSelected(undefined)} />}
    </div>
  );
}

function JourneyDetail({ job, onClose }: { job: Trip | Order; onClose: () => void }) {
  const state = useWorld((s) => s.state);
  const org = useCurrentOrg()!;
  const riderId = job.kind === 'trip' ? job.riderId : job.customerId;
  const member = org.members.find((m) => m.riderId === riderId);
  const code = orgConfig.expenseCodes.find((c) => c.id === job.orgContext?.expenseCodeId);

  return (
    <Modal title={`Journey ${job.code}`} onClose={onClose} width={620}>
      <div className="col gap-4">
        <div className="row spread">
          <StatusBadge job={job} />
          <span className="t-heading t-num">{money(businessActions.jobAmount(job))}</span>
        </div>

        <div className="panel col gap-2">
          <div className="row spread">
            <span className="t-small t-muted">Employee</span>
            <span className="t-small">{member?.name ?? '—'}</span>
          </div>
          <div className="row spread">
            <span className="t-small t-muted">Department</span>
            <span className="t-small">{member?.department ?? '—'}</span>
          </div>
          <div className="row spread">
            <span className="t-small t-muted">Expense code</span>
            <span className="t-small">{code ? `${code.code} · ${code.label}` : 'Uncoded'}</span>
          </div>
          {job.orgContext?.memo && (
            <div className="row spread">
              <span className="t-small t-muted">Reason</span>
              <span className="t-small">{job.orgContext.memo}</span>
            </div>
          )}
          <div className="row spread">
            <span className="t-small t-muted">Booked</span>
            <span className="t-small">{dayTime(businessActions.jobTimestamp(job))}</span>
          </div>
        </div>

        {(job.orgContext?.violations.length ?? 0) > 0 && (
          <div className="panel col gap-2">
            <span className="t-caps">Policy exceptions</span>
            {job.orgContext!.violations.map((ruleId) => {
              const rule = orgConfig.policyRules.find((r) => r.id === ruleId);
              return (
                <span key={ruleId} className="row gap-2 t-small" style={{ color: 'var(--c-warning)' }}>
                  <Icon name="alert" size={14} />
                  {rule?.label ?? ruleId} — {rule?.description}
                </span>
              );
            })}
          </div>
        )}

        <StopList job={job} />
        <FareBreakdown quote={job.settlement ?? job.quote} title="Receipt" showPayout />
        <div>
          <span className="t-caps">Timeline</span>
          <div style={{ marginTop: 'var(--s-2)' }}>
            <JobTimeline job={job} now={state.now} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------- Approvals ------------------------------- */

function ApprovalsSection() {
  const state = useWorld((s) => s.state);
  const org = useCurrentOrg()!;
  const act = useAction();
  const pending = businessActions.pendingApprovals(state, org.id);

  if (pending.length === 0) {
    return <Empty icon="check" title="Nothing awaiting approval" hint="Bookings that breach a rule land here." />;
  }

  return (
    <div className="col gap-3">
      {pending.map((job) => {
        const riderId = job.kind === 'trip' ? job.riderId : job.customerId;
        const member = org.members.find((m) => m.riderId === riderId);
        return (
          <Card key={job.id}>
            <div className="row spread gap-4">
              <div className="col gap-2 grow">
                <span className="row gap-2">
                  <Icon name={job.kind === 'trip' ? 'car' : 'bag'} size={15} />
                  <span className="t-body" style={{ fontWeight: 580 }}>
                    {job.code}
                  </span>
                  <Chip tone="warning">Approval required</Chip>
                </span>
                <span className="t-small t-muted">
                  {member?.name ?? '—'} · {member?.department ?? '—'} ·{' '}
                  {dayTime(businessActions.jobTimestamp(job))}
                </span>
                <span className="t-small">
                  {job.stops[0]?.place.label} → {job.stops[job.stops.length - 1]?.place.label}
                </span>
                <div className="col gap-1">
                  {job.orgContext?.violations.map((ruleId) => {
                    const rule = orgConfig.policyRules.find((r) => r.id === ruleId);
                    return (
                      <span key={ruleId} className="t-micro" style={{ color: 'var(--c-warning)' }}>
                        {rule?.label}: {rule?.description}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="col gap-2" style={{ alignItems: 'flex-end' }}>
                <span className="t-title t-num">{money(businessActions.jobAmount(job))}</span>
                <div className="row gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => act(businessActions.resolveApproval(job.id, false), 'reject approval')}
                  >
                    Reject
                  </Button>
                  <Button
                    variant="positive"
                    onClick={() => act(businessActions.resolveApproval(job.id, true), 'approve')}
                  >
                    Approve
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* -------------------------------- Policy --------------------------------- */

function PolicySection() {
  const state = useWorld((s) => s.state);
  const org = useCurrentOrg()!;
  const act = useAction();
  const products = getProductsForMarket(state.marketId);

  const describeValue = (rule: (typeof orgConfig.policyRules)[number]) => {
    if (Array.isArray(rule.value)) {
      return rule.value.length ? rule.value.map((id) => getProduct(id)?.shortName ?? id).join(', ') : 'any';
    }
    if (typeof rule.value === 'number') return money(rule.value);
    return `${rule.value.startHour}:00 – ${rule.value.endHour}:00`;
  };

  return (
    <div className="grid-split">
      <Card title="Policy rules" pad={false}>
        {orgConfig.policyRules.map((rule) => {
          const enabled = org.policyRuleIds.includes(rule.id);
          return (
            <ListRow
              key={rule.id}
              icon="shield"
              iconColor={enabled ? 'var(--c-positive)' : 'var(--c-text-faint)'}
              title={rule.label}
              subtitle={`${rule.description} · ${describeValue(rule)}`}
              trailing={
                <div className="row gap-3">
                  <Chip
                    tone={rule.onViolation === 'block' ? 'danger' : rule.onViolation === 'require_approval' ? 'warning' : 'outline'}
                  >
                    {rule.onViolation.replace(/_/g, ' ')}
                  </Chip>
                  <Switch
                    checked={enabled}
                    onChange={() => act(businessActions.togglePolicyRule(org.id, rule.id), 'toggle policy')}
                  />
                </div>
              }
            />
          );
        })}
      </Card>

      <div className="col gap-4">
        <Card title="Approved products">
          <div className="col gap-2">
            <span className="t-small t-muted">
              Employees can only book these on the business profile. This list is enforced at booking time by the same
              rule engine the rider surface calls.
            </span>
            <div className="col gap-2" style={{ marginTop: 'var(--s-2)' }}>
              {products.map((product) => {
                const allowed = org.allowedProductIds.includes(product.id);
                return (
                  <label key={product.id} className="row spread" style={{ cursor: 'pointer' }}>
                    <span className="row gap-2">
                      <Icon name={product.icon} size={16} />
                      <span className="t-small">{product.name}</span>
                    </span>
                    <Switch
                      checked={allowed}
                      onChange={() =>
                        act(
                          businessActions.setAllowedProducts(
                            org.id,
                            allowed
                              ? org.allowedProductIds.filter((id) => id !== product.id)
                              : [...org.allowedProductIds, product.id],
                          ),
                          'set allowed products',
                        )
                      }
                    />
                  </label>
                );
              })}
            </div>
          </div>
        </Card>

        <Card title="Expense codes" pad={false}>
          {orgConfig.expenseCodes.map((code) => (
            <ListRow
              key={code.id}
              icon="receipt"
              title={`${code.code} · ${code.label}`}
              subtitle={code.requiresMemo ? 'Reason required at booking' : 'No reason required'}
            />
          ))}
        </Card>

        <Card title="Monthly budget">
          <div className="col gap-3">
            <div className="field">
              <label htmlFor="budget">Programme budget</label>
              <input
                id="budget"
                className="input"
                inputMode="decimal"
                value={org.monthlyBudget}
                onChange={(e) => act(businessActions.setMonthlyBudget(org.id, Number(e.target.value) || 0), 'set budget')}
              />
            </div>
            <span className="t-micro t-faint">
              Budget drives the usage meter and the monthly-cap rule. Employee caps are configured per rule in
              config/org.config.ts.
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* -------------------------------- People --------------------------------- */

function PeopleSection() {
  const state = useWorld((s) => s.state);
  const org = useCurrentOrg()!;
  const act = useAction();
  const [inviting, setInviting] = useState(false);

  const spendByMember = businessActions.buildReport(state, org.id, 'rep-employee');

  return (
    <div className="col gap-4">
      <div className="row spread">
        <span className="t-small t-muted">{plural(org.members.length, 'member')}</span>
        <Button variant="primary" icon="plus" onClick={() => setInviting(true)}>
          Add member
        </Button>
      </div>

      <Card pad={false}>
        <div className="table-scroll" style={{ maxHeight: '64vh' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Employee ID</th>
                <th>Department</th>
                <th>Role</th>
                <th className="num">Spend</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {org.members.map((member) => {
                const spend = spendByMember.find((r) => r.key === member.id)?.amount ?? 0;
                const rider = state.riders[member.riderId];
                return (
                  <tr key={member.id}>
                    <td>
                      <span className="row gap-2">
                        <Avatar name={member.name} hue={rider?.avatarHue ?? 200} size={26} />
                        <span className="col" style={{ gap: 0 }}>
                          <span>{member.name}</span>
                          <span className="t-micro t-faint">{member.email}</span>
                        </span>
                      </span>
                    </td>
                    <td className="t-mono">{member.employeeId}</td>
                    <td>
                      <select
                        className="select"
                        style={{ height: 30, width: 'auto', fontSize: 12.5 }}
                        value={member.department}
                        onChange={(e) =>
                          act(businessActions.updateMember(org.id, member.id, { department: e.target.value }), 'update member')
                        }
                      >
                        {[...new Set([...org.members.map((m) => m.department), member.department])].map((dept) => (
                          <option key={dept} value={dept}>
                            {dept}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="select"
                        style={{ height: 30, width: 'auto', fontSize: 12.5 }}
                        value={member.role}
                        onChange={(e) =>
                          act(businessActions.updateMember(org.id, member.id, { role: e.target.value }), 'update role')
                        }
                      >
                        {orgConfig.roles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num">{money(spend)}</td>
                    <td>
                      <Switch
                        checked={member.active}
                        onChange={(next) =>
                          act(businessActions.updateMember(org.id, member.id, { active: next }), 'toggle member')
                        }
                      />
                    </td>
                    <td>
                      <Button
                        variant="quiet"
                        size="sm"
                        icon="trash"
                        aria-label={`Remove ${member.name}`}
                        onClick={() => act(businessActions.removeMember(org.id, member.id), 'remove member')}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {inviting && <InviteModal onClose={() => setInviting(false)} />}
    </div>
  );
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const state = useWorld((s) => s.state);
  const org = useCurrentOrg()!;
  const act = useAction();
  const [department, setDepartment] = useState(org.members[0]?.department ?? 'Operations');
  const [role, setRole] = useState('member');

  const candidates = Object.values(state.riders).filter(
    (r) => r.marketId === state.marketId && !r.orgMembership,
  );

  return (
    <Modal title="Add a member" onClose={onClose} width={520}>
      <div className="col gap-3">
        <div className="row gap-3">
          <div className="field grow">
            <label htmlFor="invite-dept">Department</label>
            <input id="invite-dept" className="input" value={department} onChange={(e) => setDepartment(e.target.value)} />
          </div>
          <div className="field grow">
            <label htmlFor="invite-role">Role</label>
            <select id="invite-role" className="select" value={role} onChange={(e) => setRole(e.target.value)}>
              {orgConfig.roles.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <span className="t-caps">Choose an account</span>
        <div className="col" style={{ maxHeight: 320, overflowY: 'auto' }}>
          {candidates.length === 0 && <Empty icon="users" title="Everyone already belongs to a programme" />}
          {candidates.slice(0, 30).map((rider) => (
            <ListRow
              key={rider.id}
              leading={<Avatar name={rider.displayName} hue={rider.avatarHue} size={28} />}
              title={`${rider.firstName} ${rider.lastName}`}
              subtitle={rider.email}
              onClick={() => {
                act(businessActions.inviteMember(org.id, rider.id, department, role), 'invite member');
                onClose();
              }}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------- Reports -------------------------------- */

function ReportsSection() {
  const state = useWorld((s) => s.state);
  const org = useCurrentOrg()!;
  const [reportId, setReportId] = useState(orgConfig.reports[0].id);
  const rows = businessActions.buildReport(state, org.id, reportId);
  const total = rows.reduce((acc, r) => acc + r.amount, 0);

  return (
    <div className="col gap-4">
      <div className="row gap-2 wrap">
        {orgConfig.reports.map((report) => (
          <button
            key={report.id}
            type="button"
            className="pill-filter"
            data-active={report.id === reportId}
            onClick={() => setReportId(report.id)}
          >
            {report.label}
          </button>
        ))}
      </div>

      <div className="grid-metrics">
        <Metric label="Total" value={money(total)} />
        <Metric label="Rows" value={rows.length} />
        <Metric label="Largest" value={money(rows[0]?.amount ?? 0)} hint={rows[0]?.label} />
        <Metric label="Average" value={money(rows.length ? total / rows.length : 0)} />
      </div>

      <Card
        title={orgConfig.reports.find((r) => r.id === reportId)?.label}
        pad={false}
        action={
          <Button
            variant="ghost"
            size="sm"
            icon="download"
            onClick={() => downloadCsv(reportId, rows)}
          >
            Export CSV
          </Button>
        }
      >
        <div className="table-scroll" style={{ maxHeight: '52vh' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Group</th>
                <th className="num">Journeys</th>
                <th className="num">Amount</th>
                <th style={{ width: 200 }}>Share</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td className="num">{row.count}</td>
                  <td className="num">{money(row.amount)}</td>
                  <td>
                    <span className="row gap-2">
                      <Meter value={row.share} />
                      <span className="t-micro t-faint" style={{ minWidth: 34 }}>
                        {percent(row.share)}
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <Empty icon="chart" title="No data for this report yet" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function downloadCsv(reportId: string, rows: businessActions.ReportRow[]) {
  const header = 'group,journeys,amount,share\n';
  const body = rows
    .map((row) => `"${row.label.replace(/"/g, '""')}",${row.count},${row.amount},${row.share}`)
    .join('\n');
  const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${reportId}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/* -------------------------------- Billing -------------------------------- */

function BillingSection() {
  const state = useWorld((s) => s.state);
  const org = useCurrentOrg()!;
  const jobs = businessActions.orgJobs(state, org.id).filter((j) => j.status !== 'cancelled');
  const spend = jobs.reduce((acc, j) => acc + businessActions.jobAmount(j), 0);
  const tax = jobs.reduce((acc, j) => acc + (j.settlement ?? j.quote).tax, 0);

  return (
    <div className="col gap-4">
      <div className="grid-metrics">
        <Metric label="Invoice total" value={money(spend)} />
        <Metric label="Tax included" value={money(tax)} />
        <Metric label="Journeys billed" value={jobs.length} />
        <Metric label="Invoice day" value={`Day ${org.billing.invoiceDay}`} hint="of each month" />
      </div>

      <Card title="Consolidated invoice" pad={false}>
        <div className="table-scroll" style={{ maxHeight: '58vh' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Reference</th>
                <th>Employee</th>
                <th>Description</th>
                <th className="num">Net</th>
                <th className="num">Tax</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {jobs.slice(0, 120).map((job) => {
                const quote = job.settlement ?? job.quote;
                const riderId = job.kind === 'trip' ? job.riderId : job.customerId;
                const member = org.members.find((m) => m.riderId === riderId);
                return (
                  <tr key={job.id}>
                    <td className="t-muted">{dayTime(businessActions.jobTimestamp(job))}</td>
                    <td className="t-mono">{job.code}</td>
                    <td>{member?.name ?? '—'}</td>
                    <td className="t-truncate" style={{ maxWidth: 240 }}>
                      {getProduct(job.productId)?.name} → {job.stops[job.stops.length - 1]?.place.label}
                    </td>
                    <td className="num">{money(quote.total - quote.tax)}</td>
                    <td className="num">{money(quote.tax)}</td>
                    <td className="num">{money(quote.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
