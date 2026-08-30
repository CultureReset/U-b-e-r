/**
 * Vehicles, earner tiers, onboarding requirements and incentive programmes.
 */

export interface VehicleClassConfig {
  id: string;
  label: string;
  icon: string;
  seats: number;
  /** Relative cruising speed vs. the road's nominal speed. Motorcycles filter traffic. */
  speedFactor: number;
  /** Congestion applies at this fraction — bikes are barely affected. */
  congestionFactor: number;
  /** Cargo capacity in abstract units; delivery batching uses this. */
  cargoUnits: number;
  models: string[];
  colors: string[];
}

export interface DriverTierConfig {
  id: string;
  label: string;
  /** Lifetime points required to hold the tier. */
  pointsRequired: number;
  color: string;
  perks: string[];
}

export interface DriverTagConfig {
  id: string;
  label: string;
  description: string;
  /** Fraction of the generated fleet that holds this tag. */
  prevalence: number;
}

export interface IncentiveConfig {
  id: string;
  label: string;
  description: string;
  kind: 'quest' | 'streak' | 'boost' | 'guarantee';
  /** Trips required (quest/streak) or zone multiplier (boost). */
  target: number;
  reward: number;
  /** Only counts jobs in these zones — empty means anywhere. */
  zoneIds: string[];
  /** Hour-of-day window in which qualifying jobs count. */
  window: { startHour: number; endHour: number };
  enabled: boolean;
}

export interface OnboardingRequirement {
  id: string;
  label: string;
  description: string;
  required: boolean;
  /** Days until the document must be renewed; 0 = never expires. */
  expiresInDays: number;
}

export const vehicleClasses: VehicleClassConfig[] = [
  {
    id: 'compact',
    label: 'Compact',
    icon: 'car',
    seats: 4,
    speedFactor: 1,
    congestionFactor: 1,
    cargoUnits: 4,
    models: ['Chevrolet Onix', 'Renault Kwid', 'Kia Picanto', 'Hyundai i10', 'Toyota Yaris'],
    colors: ['White', 'Silver', 'Grey', 'Red', 'Blue'],
  },
  {
    id: 'sedan',
    label: 'Sedan',
    icon: 'car',
    seats: 4,
    speedFactor: 1.02,
    congestionFactor: 1,
    cargoUnits: 6,
    models: ['Toyota Corolla', 'Mazda 3', 'Honda Civic', 'Nissan Sentra', 'Volkswagen Jetta'],
    colors: ['Black', 'White', 'Grey', 'Dark blue'],
  },
  {
    id: 'suv',
    label: 'SUV',
    icon: 'van',
    seats: 6,
    speedFactor: 0.98,
    congestionFactor: 1.05,
    cargoUnits: 10,
    models: ['Toyota RAV4', 'Mazda CX-5', 'Chevrolet Tracker', 'Renault Duster'],
    colors: ['Black', 'White', 'Silver', 'Green'],
  },
  {
    id: 'van',
    label: 'Van',
    icon: 'van',
    seats: 7,
    speedFactor: 0.92,
    congestionFactor: 1.1,
    cargoUnits: 18,
    models: ['Mercedes Vito', 'Hyundai H1', 'Toyota Hiace'],
    colors: ['White', 'Silver', 'Black'],
  },
  {
    id: 'luxury',
    label: 'Luxury',
    icon: 'car-premium',
    seats: 4,
    speedFactor: 1.05,
    congestionFactor: 1,
    cargoUnits: 6,
    models: ['Mercedes E-Class', 'BMW 5 Series', 'Audi A6', 'Volvo S90'],
    colors: ['Black', 'Graphite', 'Midnight blue'],
  },
  {
    id: 'motorcycle',
    label: 'Motorcycle',
    icon: 'moto',
    seats: 1,
    speedFactor: 1.15,
    congestionFactor: 0.35,
    cargoUnits: 3,
    models: ['Bajaj Pulsar', 'Yamaha FZ', 'Honda CB125', 'AKT NKD'],
    colors: ['Black', 'Red', 'Blue'],
  },
  {
    id: 'bicycle',
    label: 'Bicycle',
    icon: 'bike',
    seats: 0,
    speedFactor: 0.45,
    congestionFactor: 0.2,
    cargoUnits: 2,
    models: ['City bike', 'E-bike'],
    colors: ['Black', 'Teal', 'Orange'],
  },
];

export const driverTiers: DriverTierConfig[] = [
  { id: 'bronze', label: 'Bronze', pointsRequired: 0, color: '#a4703c', perks: ['Standard support'] },
  { id: 'silver', label: 'Silver', pointsRequired: 800, color: '#9aa3b0', perks: ['Priority support', '+2% earnings'] },
  {
    id: 'gold',
    label: 'Gold',
    pointsRequired: 2200,
    color: '#c9992a',
    perks: ['Priority support', '+5% earnings', 'Airport queue priority'],
  },
  {
    id: 'platinum',
    label: 'Platinum',
    pointsRequired: 5000,
    color: '#5f6d80',
    perks: ['Dedicated support', '+8% earnings', 'Airport queue priority', 'Free tuition benefit'],
  },
];

export const driverTags: DriverTagConfig[] = [
  { id: 'comfort-certified', label: 'Comfort certified', description: 'Newer vehicle, high rating.', prevalence: 0.45 },
  { id: 'black-certified', label: 'Black certified', description: 'Professional licence, luxury vehicle.', prevalence: 0.12 },
  { id: 'assist-certified', label: 'Assist certified', description: 'Trained in mobility assistance.', prevalence: 0.18 },
  { id: 'food-safety', label: 'Food safety', description: 'Insulated bag and handling training.', prevalence: 0.62 },
  { id: 'alcohol-delivery', label: 'Alcohol delivery', description: 'Licensed to deliver alcohol.', prevalence: 0.3 },
];

export const incentives: IncentiveConfig[] = [
  {
    id: 'q-morning-20',
    label: 'Morning quest',
    description: 'Complete 20 trips between 5am and 11am.',
    kind: 'quest',
    target: 20,
    reward: 34,
    zoneIds: [],
    window: { startHour: 5, endHour: 11 },
    enabled: true,
  },
  {
    id: 'q-evening-15',
    label: 'Evening quest',
    description: 'Complete 15 trips between 4pm and 10pm.',
    kind: 'quest',
    target: 15,
    reward: 28,
    zoneIds: [],
    window: { startHour: 16, endHour: 22 },
    enabled: true,
  },
  {
    id: 's-consecutive-3',
    label: 'Streak bonus',
    description: 'Accept 3 trips back to back without going offline.',
    kind: 'streak',
    target: 3,
    reward: 6,
    zoneIds: [],
    window: { startHour: 0, endHour: 24 },
    enabled: true,
  },
  {
    id: 'b-downtown-boost',
    label: 'Downtown boost',
    description: 'Earn 1.3x on trips starting downtown during peak.',
    kind: 'boost',
    target: 1.3,
    reward: 0,
    zoneIds: ['bog-chapinero', 'bog-centro', 'sfo-soma', 'sfo-downtown'],
    window: { startHour: 17, endHour: 20 },
    enabled: true,
  },
];

export const onboardingRequirements: OnboardingRequirement[] = [
  { id: 'licence', label: 'Driver licence', description: 'Valid, unexpired licence.', required: true, expiresInDays: 1460 },
  { id: 'insurance', label: 'Vehicle insurance', description: 'Proof of active coverage.', required: true, expiresInDays: 365 },
  { id: 'registration', label: 'Vehicle registration', description: 'Matching the vehicle on file.', required: true, expiresInDays: 365 },
  { id: 'background', label: 'Background check', description: 'Annual screening.', required: true, expiresInDays: 365 },
  { id: 'inspection', label: 'Vehicle inspection', description: 'Safety inspection certificate.', required: true, expiresInDays: 365 },
  { id: 'profile-photo', label: 'Profile photo', description: 'Clear, forward-facing photo.', required: true, expiresInDays: 0 },
  { id: 'food-bag', label: 'Insulated bag', description: 'Required for food delivery opt-in.', required: false, expiresInDays: 0 },
];
