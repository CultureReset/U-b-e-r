/**
 * Business (enterprise) programme: org policies, expense codes, approval flows.
 * The business surface reads all of its rules from here.
 */

export interface TravelPolicyRule {
  id: string;
  label: string;
  description: string;
  /** What the rule constrains. */
  kind: 'product_allowlist' | 'spend_cap_per_trip' | 'time_window' | 'geo_fence' | 'requires_reason' | 'monthly_cap';
  /** Interpretation depends on kind: product ids, an amount, hour bounds, or zone ids. */
  value: string[] | number | { startHour: number; endHour: number };
  /** What happens when a booking violates the rule. */
  onViolation: 'block' | 'flag' | 'require_approval';
  enabled: boolean;
}

export interface ExpenseCodeConfig {
  id: string;
  code: string;
  label: string;
  requiresMemo: boolean;
}

export interface OrgRoleConfig {
  id: string;
  label: string;
  permissions: string[];
}

export interface OrgProgramConfig {
  /** Programme archetypes the seed generator instantiates per market. */
  archetypes: {
    id: string;
    name: string;
    industry: string;
    employeeCount: number;
    monthlyBudget: number;
    policyRuleIds: string[];
    allowedProductIds: string[];
    glyph: string;
  }[];
  policyRules: TravelPolicyRule[];
  expenseCodes: ExpenseCodeConfig[];
  roles: OrgRoleConfig[];
  /** Approval threshold above which a trip needs manager sign-off. */
  approvalThreshold: number;
  /** Which reports the business dashboard renders. */
  reports: { id: string; label: string; groupBy: 'employee' | 'department' | 'expenseCode' | 'day' | 'product' }[];
}

export const orgConfig: OrgProgramConfig = {
  approvalThreshold: 60,
  policyRules: [
    {
      id: 'pol-products',
      label: 'Approved ride types',
      description: 'Employees may only book economy and comfort tiers.',
      kind: 'product_allowlist',
      value: ['go', 'comfort', 'share', 'eats-standard'],
      onViolation: 'block',
      enabled: true,
    },
    {
      id: 'pol-cap',
      label: 'Per-trip spend cap',
      description: 'Trips above the cap require manager approval.',
      kind: 'spend_cap_per_trip',
      value: 45,
      onViolation: 'require_approval',
      enabled: true,
    },
    {
      id: 'pol-hours',
      label: 'Business hours',
      description: 'Trips outside 06:00–22:00 are flagged for review.',
      kind: 'time_window',
      value: { startHour: 6, endHour: 22 },
      onViolation: 'flag',
      enabled: true,
    },
    {
      id: 'pol-reason',
      label: 'Trip reason required',
      description: 'Every business trip must carry a reason code.',
      kind: 'requires_reason',
      value: [],
      onViolation: 'block',
      enabled: true,
    },
    {
      id: 'pol-monthly',
      label: 'Monthly per-employee cap',
      description: 'Employees are capped monthly.',
      kind: 'monthly_cap',
      value: 600,
      onViolation: 'flag',
      enabled: true,
    },
  ],
  expenseCodes: [
    { id: 'ec-client', code: 'CLIENT', label: 'Client meeting', requiresMemo: true },
    { id: 'ec-airport', code: 'TRAVEL', label: 'Airport transfer', requiresMemo: false },
    { id: 'ec-late', code: 'LATE', label: 'Late-night commute', requiresMemo: false },
    { id: 'ec-team', code: 'TEAM', label: 'Team meal', requiresMemo: true },
    { id: 'ec-offsite', code: 'OFFSITE', label: 'Offsite / event', requiresMemo: true },
  ],
  roles: [
    { id: 'admin', label: 'Programme admin', permissions: ['manage_policy', 'manage_members', 'view_reports', 'approve_trips', 'manage_billing'] },
    { id: 'manager', label: 'Manager', permissions: ['view_reports', 'approve_trips'] },
    { id: 'member', label: 'Member', permissions: ['book_trips'] },
  ],
  reports: [
    { id: 'rep-employee', label: 'Spend by employee', groupBy: 'employee' },
    { id: 'rep-dept', label: 'Spend by department', groupBy: 'department' },
    { id: 'rep-code', label: 'Spend by expense code', groupBy: 'expenseCode' },
    { id: 'rep-day', label: 'Daily trend', groupBy: 'day' },
    { id: 'rep-product', label: 'Spend by ride type', groupBy: 'product' },
  ],
  archetypes: [
    {
      id: 'org-tech',
      name: 'Northwind Labs',
      industry: 'Software',
      employeeCount: 180,
      monthlyBudget: 14000,
      policyRuleIds: ['pol-products', 'pol-cap', 'pol-reason', 'pol-monthly'],
      allowedProductIds: ['go', 'comfort', 'share', 'eats-standard'],
      glyph: '◆',
    },
    {
      id: 'org-consult',
      name: 'Meridian Partners',
      industry: 'Consulting',
      employeeCount: 60,
      monthlyBudget: 22000,
      policyRuleIds: ['pol-cap', 'pol-hours', 'pol-reason'],
      allowedProductIds: ['go', 'comfort', 'black', 'xl'],
      glyph: '▲',
    },
    {
      id: 'org-health',
      name: 'Ciudad Health Group',
      industry: 'Healthcare',
      employeeCount: 420,
      monthlyBudget: 31000,
      policyRuleIds: ['pol-products', 'pol-monthly', 'pol-reason'],
      allowedProductIds: ['go', 'assist', 'xl', 'eats-standard'],
      glyph: '✚',
    },
  ],
};
