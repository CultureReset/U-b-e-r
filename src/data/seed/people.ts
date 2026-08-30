/**
 * Person generation — riders, drivers and their vehicles.
 * Every attribute is drawn from a distribution declared in seed.config.
 */
import {
  driverTags,
  getMarket,
  getProductsForMarket,
  getTierForPoints,
  onboardingRequirements,
  paymentMethods,
  seedConfig,
  vehicleClasses,
} from '@config';
import type { Account, DriverProfile, DriverStatus, RiderProfile, SavedPlace, Vehicle } from '@core/types';
import { clamp, nextId, round2, type Rng } from '@core/util';
import { addressFor, randomDemandPoint, randomSupplyPoint } from './places';
import { zoneAt } from '@core/geo';

const PLATE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function makeAccount(marketId: string, rng: Rng, prefix: string, now: number): Account {
  const firstName = rng.pick(seedConfig.names.given);
  const lastName = rng.pick(seedConfig.names.family);
  const displayName = `${firstName} ${lastName.charAt(0)}.`;
  const ageDays = rng.int(3, 900);
  return {
    id: nextId(prefix),
    firstName,
    lastName,
    displayName,
    initials: `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase(),
    phone: `+${rng.int(1, 99)} ${rng.int(300, 399)} ${rng.int(100, 999)} ${rng.int(1000, 9999)}`,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/[^a-z]/g, '')}@example.com`,
    avatarHue: rng.int(0, 360),
    createdAt: now - ageDays * 86_400_000,
    marketId,
  };
}

function makeVehicle(rng: Rng, classId: string): Vehicle {
  const vehicleClass = vehicleClasses.find((v) => v.id === classId) ?? vehicleClasses[0];
  const plate = `${rng.pick(PLATE_LETTERS.split(''))}${rng.pick(PLATE_LETTERS.split(''))}${rng.pick(
    PLATE_LETTERS.split(''),
  )} ${rng.int(100, 999)}`;
  const model = rng.pick(vehicleClass.models);
  const [make, ...rest] = model.split(' ');
  return {
    id: nextId('veh'),
    classId: vehicleClass.id,
    make,
    model: rest.join(' ') || model,
    color: rng.pick(vehicleClass.colors),
    plate,
    year: rng.int(2016, 2025),
    seats: vehicleClass.seats,
  };
}

export function generateRider(marketId: string, rng: Rng, now: number): RiderProfile {
  const market = getMarket(marketId);
  const account = makeAccount(marketId, rng, 'rdr', now);
  const homeAt = randomSupplyPoint(market, rng);
  const workAt = randomDemandPoint(market, rng);

  const savedPlaces: SavedPlace[] = [
    {
      id: nextId('plc'),
      kind: 'home',
      icon: 'home',
      label: 'Home',
      ...addressFor(marketId, homeAt),
      at: homeAt,
    },
    {
      id: nextId('plc'),
      kind: 'work',
      icon: 'briefcase',
      label: 'Work',
      ...addressFor(marketId, workAt),
      at: workAt,
    },
  ];

  const methods = paymentMethods.filter(
    (m) => m.enabled && (m.markets.length === 0 || m.markets.includes(marketId)) && m.kind !== 'corporate',
  );
  const chosen = rng.sample(methods, rng.int(1, Math.min(3, methods.length) + 1)).map((m) => m.id);
  const methodIds = chosen.length > 0 ? chosen : [methods[0].id];

  return {
    ...account,
    rating: round2(clamp(rng.gaussian(4.86, 0.1), 4.3, 5)),
    ratingCount: rng.int(3, 320),
    savedPlaces,
    paymentMethodIds: methodIds,
    defaultPaymentMethodId: methodIds[0],
    walletBalance: round2(rng.float(0, 45)),
    promoRedemptions: {},
    lifetimeTrips: rng.int(0, 480),
    lifetimeOrders: rng.int(0, 260),
  };
}

export function generateDriver(marketId: string, rng: Rng, now: number): DriverProfile {
  const market = getMarket(marketId);
  const account = makeAccount(marketId, rng, 'drv', now);
  const vehicleClass = rng.pickWeighted(vehicleClasses, (v) =>
    v.id === 'compact' || v.id === 'sedan' ? 4 : v.id === 'bicycle' ? 0.6 : v.id === 'luxury' ? 0.8 : 1.6,
  );
  const vehicle = makeVehicle(rng, vehicleClass.id);
  const tierPoints = Math.round(rng.gaussian(1600, 1600, 0, 9000));
  const tier = getTierForPoints(tierPoints);
  const tags = driverTags.filter((t) => rng.bool(t.prevalence)).map((t) => t.id);

  const at = randomSupplyPoint(market, rng);
  const status = pickStatus(rng);
  const rides = getProductsForMarket(marketId, 'ride');
  const deliveries = getProductsForMarket(marketId, 'delivery');

  // Which verticals this earner works, then which products within them.
  const mix = seedConfig.driverVerticalOptIn;
  const roll = rng.next();
  const doesRides = roll < mix.rides + mix.both;
  const doesDeliveries = roll >= mix.rides;

  const eligible = (p: (typeof rides)[number]) =>
    p.eligibleVehicleClasses.includes(vehicle.classId) &&
    p.dispatch.requiredDriverTags.every((t) => tags.includes(t));

  const optedProductIds = [
    ...(doesRides ? rides.filter(eligible).map((p) => p.id) : []),
    ...(doesDeliveries ? deliveries.filter(eligible).map((p) => p.id) : []),
  ];

  const documents = onboardingRequirements.map((req) => {
    const expiresAt = req.expiresInDays > 0 ? now + rng.int(-20, req.expiresInDays) * 86_400_000 : undefined;
    const daysLeft = expiresAt ? (expiresAt - now) / 86_400_000 : Infinity;
    const status: 'valid' | 'expiring' | 'expired' | 'missing' =
      !req.required && rng.bool(0.4) ? 'missing' : daysLeft < 0 ? 'expired' : daysLeft < 30 ? 'expiring' : 'valid';
    return { requirementId: req.id, status, expiresAt };
  });

  const zone = zoneAt(market, at);

  return {
    ...account,
    status: optedProductIds.length === 0 ? 'offline' : status,
    rating: round2(
      clamp(
        rng.gaussian(seedConfig.ratingDistribution.mean, seedConfig.ratingDistribution.spread),
        seedConfig.ratingDistribution.min,
        seedConfig.ratingDistribution.max,
      ),
    ),
    ratingCount: rng.int(20, 4200),
    acceptanceRate: round2(clamp(rng.gaussian(0.78, 0.16), 0.25, 1)),
    cancellationRate: round2(clamp(rng.gaussian(0.05, 0.05), 0, 0.3)),
    completionRate: round2(clamp(rng.gaussian(0.96, 0.04), 0.7, 1)),
    tierPoints,
    tierId: tier.id,
    tags,
    vehicle,
    optedProductIds,
    documents,
    at,
    heading: rng.float(0, 360),
    speedKph: 0,
    routeProgressM: 0,
    stopQueue: [],
    onlineSince: status === 'offline' ? undefined : now - rng.int(60, 5400) * 1000,
    session: { earnings: 0, jobs: 0, onlineSec: 0, distanceKm: 0, tips: 0, promotions: 0 },
    lifetime: {
      earnings: round2(rng.float(400, 42000)),
      jobs: rng.int(20, 5200),
      distanceKm: round2(rng.float(300, 68000)),
    },
    streakCount: 0,
    questProgress: {},
    homeZoneId: zone?.id,
  };
}

function pickStatus(rng: Rng): DriverStatus {
  const mix = seedConfig.driverStateMix;
  const roll = rng.next();
  if (roll < mix.offline) return 'offline';
  if (roll < mix.offline + mix.online) return 'online';
  return 'online'; // on-trip drivers are created by the historical job pass
}

export function generateVehicleFor(classId: string, rng: Rng): Vehicle {
  return makeVehicle(rng, classId);
}
