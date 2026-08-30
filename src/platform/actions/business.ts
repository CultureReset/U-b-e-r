/**
 * Enterprise programme administration and reporting.
 * Reads run over the same trips and orders the consumer surfaces created —
 * a business trip is a trip, tagged.
 */
import { orgConfig } from '@config';
import type { ID, Order, Org, OrgMember, Trip } from '@core/types';
import { nextId, round2, sortBy } from '@core/util';
import type { WorldState } from '@data';

export function orgJobs(state: WorldState, orgId: ID): (Trip | Order)[] {
  const trips = Object.values(state.trips).filter((t) => t.orgContext?.orgId === orgId);
  const orders = Object.values(state.orders).filter((o) => o.orgContext?.orgId === orgId);
  return sortBy([...trips, ...orders], (j) => (j.kind === 'trip' ? j.requestedAt : j.placedAt), 'desc');
}

export const jobAmount = (job: Trip | Order): number => (job.settlement ?? job.quote).total;
export const jobTimestamp = (job: Trip | Order): number => (job.kind === 'trip' ? job.requestedAt : job.placedAt);

export interface ReportRow {
  key: string;
  label: string;
  amount: number;
  count: number;
  share: number;
}

/** One report engine, driven by the groupBy declared in org.config. */
export function buildReport(state: WorldState, orgId: ID, reportId: ID): ReportRow[] {
  const report = orgConfig.reports.find((r) => r.id === reportId);
  const org = state.orgs[orgId];
  if (!report || !org) return [];

  const jobs = orgJobs(state, orgId).filter((j) => !['cancelled'].includes(j.status));
  const buckets = new Map<string, { label: string; amount: number; count: number }>();

  for (const job of jobs) {
    const riderId = job.kind === 'trip' ? job.riderId : job.customerId;
    const member = org.members.find((m) => m.riderId === riderId);
    let key: string;
    let label: string;

    switch (report.groupBy) {
      case 'employee':
        key = member?.id ?? riderId;
        label = member?.name ?? state.riders[riderId]?.displayName ?? 'Unknown';
        break;
      case 'department':
        key = member?.department ?? 'Unassigned';
        label = key;
        break;
      case 'expenseCode': {
        const code = orgConfig.expenseCodes.find((c) => c.id === job.orgContext?.expenseCodeId);
        key = code?.id ?? 'none';
        label = code ? `${code.code} · ${code.label}` : 'Uncoded';
        break;
      }
      case 'day': {
        const d = new Date(jobTimestamp(job));
        // Zero-padded so the key sorts chronologically across month boundaries.
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        break;
      }
      case 'product':
      default:
        key = job.productId;
        label = job.productId;
        break;
    }

    const bucket = buckets.get(key) ?? { label, amount: 0, count: 0 };
    bucket.amount = round2(bucket.amount + jobAmount(job));
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const total = round2([...buckets.values()].reduce((acc, b) => acc + b.amount, 0)) || 1;
  const rows = [...buckets.entries()].map(([key, b]) => ({
    key,
    label: b.label,
    amount: b.amount,
    count: b.count,
    share: round2(b.amount / total),
  }));

  // A time series reads chronologically; every other report reads by size.
  return report.groupBy === 'day'
    ? [...rows].sort((a, b) => a.key.localeCompare(b.key))
    : sortBy(rows, (r) => r.amount, 'desc');
}

export function pendingApprovals(state: WorldState, orgId: ID): (Trip | Order)[] {
  return orgJobs(state, orgId).filter((j) => j.orgContext?.approvalStatus === 'pending');
}

export function resolveApproval(jobId: ID, approve: boolean) {
  return (state: WorldState): void => {
    const trip = state.trips[jobId];
    if (trip?.orgContext) {
      state.trips[jobId] = {
        ...trip,
        orgContext: { ...trip.orgContext, approvalStatus: approve ? 'approved' : 'rejected' },
      };
      return;
    }
    const order = state.orders[jobId];
    if (order?.orgContext) {
      state.orders[jobId] = {
        ...order,
        orgContext: { ...order.orgContext, approvalStatus: approve ? 'approved' : 'rejected' },
      };
    }
  };
}

export function togglePolicyRule(orgId: ID, ruleId: ID) {
  return (state: WorldState): void => {
    const org = state.orgs[orgId];
    if (!org) return;
    const policyRuleIds = org.policyRuleIds.includes(ruleId)
      ? org.policyRuleIds.filter((r) => r !== ruleId)
      : [...org.policyRuleIds, ruleId];
    state.orgs[orgId] = { ...org, policyRuleIds };
  };
}

export function setAllowedProducts(orgId: ID, productIds: ID[]) {
  return (state: WorldState): void => {
    const org = state.orgs[orgId];
    if (!org) return;
    state.orgs[orgId] = { ...org, allowedProductIds: productIds };
  };
}

export function setMonthlyBudget(orgId: ID, amount: number) {
  return (state: WorldState): void => {
    const org = state.orgs[orgId];
    if (!org) return;
    state.orgs[orgId] = { ...org, monthlyBudget: amount };
  };
}

export function updateMember(orgId: ID, memberId: ID, patch: Partial<OrgMember>) {
  return (state: WorldState): void => {
    const org = state.orgs[orgId];
    if (!org) return;
    state.orgs[orgId] = {
      ...org,
      members: org.members.map((m) => (m.id === memberId ? { ...m, ...patch } : m)),
    };
  };
}

export function inviteMember(orgId: ID, riderId: ID, department: string, role: string) {
  return (state: WorldState): void => {
    const org = state.orgs[orgId];
    const rider = state.riders[riderId];
    if (!org || !rider || org.members.some((m) => m.riderId === riderId)) return;

    const member: OrgMember = {
      id: nextId('mem'),
      riderId,
      name: `${rider.firstName} ${rider.lastName}`,
      email: rider.email,
      role,
      department,
      employeeId: `E${1000 + org.members.length}`,
      monthlySpend: 0,
      active: true,
    };

    state.orgs[orgId] = { ...org, members: [...org.members, member] };
    state.riders[riderId] = {
      ...rider,
      orgMembership: { orgId, role, department, employeeId: member.employeeId },
    };
  };
}

export function removeMember(orgId: ID, memberId: ID) {
  return (state: WorldState): void => {
    const org = state.orgs[orgId];
    if (!org) return;
    const member = org.members.find((m) => m.id === memberId);
    state.orgs[orgId] = { ...org, members: org.members.filter((m) => m.id !== memberId) };
    if (member) {
      const rider = state.riders[member.riderId];
      if (rider) state.riders[member.riderId] = { ...rider, orgMembership: undefined };
    }
  };
}

export function orgSummary(state: WorldState, orgId: ID) {
  const org: Org | undefined = state.orgs[orgId];
  if (!org) return undefined;
  const jobs = orgJobs(state, orgId).filter((j) => j.status !== 'cancelled');
  const spend = round2(jobs.reduce((acc, j) => acc + jobAmount(j), 0));
  const trips = jobs.filter((j) => j.kind === 'trip').length;
  const orders = jobs.length - trips;
  const flagged = jobs.filter((j) => (j.orgContext?.violations.length ?? 0) > 0).length;

  return {
    org,
    spend,
    trips,
    orders,
    flagged,
    budgetUsed: org.monthlyBudget > 0 ? round2(spend / org.monthlyBudget) : 0,
    activeMembers: org.members.filter((m) => m.active).length,
    averageJob: jobs.length ? round2(spend / jobs.length) : 0,
    pendingApprovals: pendingApprovals(state, orgId).length,
  };
}
