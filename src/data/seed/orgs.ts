/**
 * Enterprise programme generation. Members are drawn from the rider population
 * so a business traveller and a consumer are the same account — which is what
 * makes the business profile switch meaningful in the rider surface.
 */
import { orgConfig, seedConfig } from '@config';
import type { Org, OrgMember, RiderProfile } from '@core/types';
import { nextId, round2, type Rng } from '@core/util';

const DEPARTMENTS = ['Engineering', 'Sales', 'Operations', 'Finance', 'People', 'Marketing', 'Clinical', 'Field'];

export function generateOrgs(marketId: string, riders: RiderProfile[], rng: Rng): { orgs: Org[]; riders: RiderProfile[] } {
  const archetypes = rng.sample(orgConfig.archetypes, Math.min(seedConfig.perMarket.orgs, orgConfig.archetypes.length));
  const updatedRiders = new Map(riders.map((r) => [r.id, r] as const));
  const pool = rng.shuffle(riders);
  let cursor = 0;

  const orgs = archetypes.map((archetype) => {
    const orgId = nextId('org');
    const memberCount = Math.min(seedConfig.perMarket.employeesPerOrg, Math.max(0, pool.length - cursor));
    const members: OrgMember[] = [];

    for (let i = 0; i < memberCount; i++) {
      const rider = pool[cursor++];
      if (!rider) break;
      const role = i === 0 ? 'admin' : i < 3 ? 'manager' : 'member';
      const department = rng.pick(DEPARTMENTS);
      const member: OrgMember = {
        id: nextId('mem'),
        riderId: rider.id,
        name: `${rider.firstName} ${rider.lastName}`,
        email: rider.email,
        role,
        department,
        employeeId: `E${(1000 + i).toString()}`,
        monthlySpend: round2(rng.float(0, archetype.monthlyBudget / archetype.employeeCount) * rng.float(0.4, 6)),
        active: rng.bool(0.92),
      };
      members.push(member);
      updatedRiders.set(rider.id, {
        ...rider,
        orgMembership: { orgId, role, department, employeeId: member.employeeId },
      });
    }

    return {
      id: orgId,
      archetypeId: archetype.id,
      marketId,
      name: archetype.name,
      industry: archetype.industry,
      glyph: archetype.glyph,
      monthlyBudget: archetype.monthlyBudget,
      policyRuleIds: archetype.policyRuleIds,
      allowedProductIds: archetype.allowedProductIds,
      members,
      billing: {
        spendThisMonth: round2(members.reduce((acc, m) => acc + m.monthlySpend, 0)),
        invoiceDay: rng.int(1, 28),
        paymentMethodId: 'corporate',
      },
    } satisfies Org;
  });

  return { orgs, riders: [...updatedRiders.values()] };
}
