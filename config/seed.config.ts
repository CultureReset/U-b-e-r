/**
 * Population parameters for the world generator.
 * These control *how many* of each entity exists and the distributions they
 * are drawn from. No entity is written by hand anywhere in the codebase.
 */

export interface SeedConfig {
  /** Per-market population counts. */
  perMarket: {
    drivers: number;
    riders: number;
    merchants: number;
    /** Historical jobs generated to back the analytics/earnings screens. */
    historicalTrips: number;
    historicalOrders: number;
    orgs: number;
    employeesPerOrg: number;
  };
  /** Name pools used to synthesise people. Swap for another locale freely. */
  names: { given: string[]; family: string[] };
  /** Distribution of driver states at boot. */
  driverStateMix: { offline: number; online: number; onTrip: number };
  /** Fraction of drivers opted into each vertical. */
  driverVerticalOptIn: { rides: number; deliveries: number; both: number };
  ratingDistribution: { mean: number; spread: number; min: number; max: number };
  /** How far back historical records reach, in days. */
  historyWindowDays: number;
  /** Fraction of generated consumers that hold a business profile. */
  businessProfileRate: number;
}

export const seedConfig: SeedConfig = {
  perMarket: {
    drivers: 110,
    riders: 60,
    merchants: 34,
    historicalTrips: 220,
    historicalOrders: 160,
    orgs: 3,
    employeesPerOrg: 14,
  },
  names: {
    given: [
      'Ana', 'Camilo', 'Valentina', 'Mateo', 'Isabella', 'Santiago', 'Lucía', 'Andrés',
      'Daniela', 'Julián', 'Mariana', 'Sebastián', 'Paula', 'Felipe', 'Sofía', 'Nicolás',
      'Carolina', 'Diego', 'Gabriela', 'Esteban', 'Laura', 'Ricardo', 'Natalia', 'Óscar',
      'Priya', 'Marcus', 'Elena', 'Tomas', 'Amara', 'Jonas', 'Yuki', 'Noor',
    ],
    family: [
      'Rodríguez', 'Gómez', 'Martínez', 'Cárdenas', 'Restrepo', 'Herrera', 'Vargas', 'Ospina',
      'Quintero', 'Moreno', 'Pineda', 'Salazar', 'Beltrán', 'Cifuentes', 'Arango', 'Muñoz',
      'Okafor', 'Nakamura', 'Silva', 'Petrov', 'Haddad', 'Lindqvist', 'Duarte', 'Mejía',
    ],
  },
  driverStateMix: { offline: 0.34, online: 0.52, onTrip: 0.14 },
  driverVerticalOptIn: { rides: 0.4, deliveries: 0.25, both: 0.35 },
  ratingDistribution: { mean: 4.82, spread: 0.14, min: 4.2, max: 5 },
  historyWindowDays: 28,
  businessProfileRate: 0.3,
};
