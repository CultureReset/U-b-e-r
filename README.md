# URUS

A working prototype of a two-sided mobility marketplace — ride-hailing and
delivery — built as **six products over one live world**.

Everything the product depends on (money, geography, catalogue shape, policy,
branding, population) resolves from `config/`. There are no business values
written inside `src/`. Swap a config file and the market, the price, the menu,
the fleet or the brand changes everywhere at once.

---

## What's in it

| Surface | Audience | What it does |
| --- | --- | --- |
| **Rides** (`/rider`) | Consumer | Search a destination, plan a multi-stop trip, compare every tier quoted against the same route, pay, apply promos, schedule, book on a business profile, track the driver live, share the trip, use safety tools, chat, cancel, rate and tip. |
| **Eats** (`/eats`) | Consumer | Browse live storefronts, customise items through the merchant's own modifier groups, build a cart, choose delivery speed and dropoff preference, check out, then track the kitchen and the courier. |
| **Driver** (`/driver`) | Earner | Go online into the real dispatch pool, receive scored offers with a decision countdown, run trips *and* deliveries stage by stage, see earnings from the shared ledger, cash out, chase quests, read the demand map, manage vehicle, documents and product opt-ins. |
| **Merchant** (`/merchant`) | Business | Live order queue, per-line substitutions, menu and modifier management, hours, minimums, packaging, auto-accept, busy mode, payouts and insights. |
| **Business** (`/business`) | Business | Enterprise travel programme: budget, departmental spend, journey ledger with receipts, approvals queue, live travel policy, member administration, five reports with CSV export, consolidated invoice. |
| **Ops** (`/admin`) | Internal | Live map of every vehicle and job, surge heat, a dispatch inspector that shows *why* each earner was or wasn't offered a job, supply and demand analytics, platform finance, the raw event log, and a configuration inspector. |

The point is that these are **not six mock-ups**. Requesting a ride in Rides
creates a real job, which dispatch scores against the real fleet, which appears
as an offer in Driver, which — once accepted — moves a real vehicle along a
routed path that the rider watches in real time and Ops sees on the map. Place
an order in Eats and it lands in the Merchant queue awaiting a human to accept
it, which starts the kitchen clock the customer's ETA is derived from.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build
npm run test       # core engine tests
```

The world simulation runs from a single clock in the app header. Pause it and
every surface freezes at the same instant — which is how you hand one job from
rider to earner to merchant and inspect each side of it. The speed control
(½× to 12×) advances simulated time; **Reseed** regenerates the entire world
from config.

---

## Architecture

```
config/                 the only place business values live
  brand · app · market · products · pricing · fleet · catalog · payments · org · seed

src/core/               pure domain, framework-free
  geo/                  haversine, bearings, polygons, projection, simplification
  routing/              road-graph generation + A* shortest-time router
  pricing/              itemised quote engine: surge, fees, promos, tax, pay split
  dispatch/             eligibility filtering, weighted scoring, offer waves
  lifecycle/            trip and order state machines with actor permissions
  events/               typed event bus with an append-only audit log
  sim/                  the world clock: movement, queues, offers, demand, settlement
  util/                 seeded RNG, ids, numeric helpers

src/data/
  ports/                WorldState + the DataProvider contract
  adapters/memory/      in-memory + debounced localStorage persistence
  adapters/rest/        REST scaffold — swap in a real backend, change nothing else
  seed/                 world generation: places, people, merchants, orgs, history

src/platform/           store, tick loop, runtime theming, formatting, actions, hooks
src/ui/                 design system, shared domain components, map renderer
src/surfaces/           the six products
src/app/                shell, router, device and console chrome
```

### Design decisions worth knowing

**One world, many views.** A single store holds one `WorldState`. Every surface
is a selector over it. There is no per-surface mock data, so the surfaces cannot
disagree.

**The simulation is a pure reducer.** `core/sim/tick()` takes a `WorldState` and
returns a new one. It never touches React, so the same logic would run on a
server unchanged. Actions issued by a human (a rider requesting, an earner
accepting) run through the *same* internal functions the simulator applies to AI
participants — the human is exempted from the automatic paths, not special-cased
into a parallel one.

**Geography is generated, not shipped.** Each market declares a grid size,
jitter, arterial spacing and prune ratio; the road graph is derived from that,
and the router plans on the same graph the map draws. So a car visibly turns
where its route turns, with no tile server, no API key and no network. `MapProvider`
in `ui/Map.tsx` marks the seam where a real basemap (Mapbox, MapLibre, Google)
would slot in beneath the existing lat/lng overlay.

**Money has one implementation.** `core/pricing` produces every quote in the
product — the rider's price picker, the courier's payout, the merchant's
commission, the enterprise invoice and the replayed history are all the same
engine reading the same rate cards. Change `pricing.config.ts` and every number
in the product moves together.

**The world is deterministic.** Everything is generated from one seed, so a given
config always produces an identical market. That is what makes a marketplace
bug reproducible.

**Storage is behind a port.** `appConfig.dataAdapter` selects the binding. The
in-memory adapter persists to `localStorage` and invalidates on a schema-version
bump; the REST adapter implements the same four methods against an API and falls
back to local generation when the backend is unreachable.

---

## Making it yours

Nothing below requires touching a component.

| To change | Edit |
| --- | --- |
| Colours, typography, radii, per-surface accents | `config/brand.config.ts` |
| Which surfaces exist, feature flags, locale, currency, units, simulation speed | `config/app.config.ts` |
| Cities, geography, zones, road density, congestion curves, tax, regulation | `config/market.config.ts` |
| Ride and delivery tiers, capacity, eligibility, dispatch constraints | `config/products.config.ts` |
| Rate cards, fees, surge curve, earner pay split, cancellation rules | `config/pricing.config.ts` |
| Vehicle classes, earner tiers, certifications, quests, onboarding documents | `config/fleet.config.ts` |
| Merchant archetypes, menu shapes, modifier groups, browse categories, hours | `config/catalog.config.ts` |
| Payment instruments, promotions, payout and commission rules | `config/payments.config.ts` |
| Enterprise policy rules, expense codes, roles, reports | `config/org.config.ts` |
| How many earners, riders, merchants, orgs and how much history to generate | `config/seed.config.ts` |

Adding a **new ride tier** is one entry in `products.config.ts` plus a rate card
in `pricing.config.ts`. It appears in the rider's picker, the earner's opt-in
list, the ops product-mix chart and the enterprise policy editor automatically.

Adding a **new city** is one entry in `market.config.ts`. The road network,
addresses, zones, surge and the entire population generate from it.

Adding a **merchant type** is one archetype in `catalog.config.ts`; the generator
instantiates as many concrete storefronts as the market needs, each with its own
name, prices, hours and availability.

### Pointing it at a real backend

1. Set `dataAdapter: 'rest'` and `restBaseUrl` in `config/app.config.ts`.
2. Implement `GET/PUT/DELETE /world` and `POST /world/seed` against the
   `WorldState` shape in `src/data/ports/index.ts`.

The adapter falls back to local generation if the API is unreachable, so the
prototype stays demonstrable while the backend is being built.

---

## What this is, and what it isn't

It is a **complete working model of how Uber's business works** — the marketplace
mechanics, the economics and all six product surfaces, running live against one
another. It is **not a clone of Uber the company's software**. Missing, by design:

- **No accounts or auth.** Identity is a pointer into the world; each surface has
  a switcher for who you are acting as.
- **No payment processing.** `payment.captured` is an event and a ledger row, not
  a transaction — no processor, authorisation hold, refund or chargeback flow.
- **No real geography.** Streets are generated from each market's parameters, so
  you cannot route to a real address or read real traffic. Swapping in a real
  basemap and routing service is a defined seam (`MapProvider`), not a rewrite.
- **No backend.** The REST adapter satisfies the storage port but the server
  behind it does not exist yet.
- **One language.** Business values are all config-driven, but interface copy is
  written in the components; there is no translation layer.
- **Narrower than the real thing.** No freight, transit, rentals, teen accounts,
  reserve, or the operational systems around them — support tooling, fraud and
  risk, insurance, background-check integrations, per-market tax filing.

## Known limits

Within what is built, a few things are deliberately simplified:

- **Vehicles ignore each other.** There is congestion by hour of day and by road
  class, but no car-following, no signals and no collision.
- **Payments are ledger entries.** There is no processor, no authorisation hold
  and no chargeback flow — `payment.captured` is an event, not a transaction.
- **No accounts or auth.** Identity is a session pointer into the world; the
  switchers in each surface change who you are acting as.
- **Niche products can strand.** Assist, Moto and Black have thin fleets by
  design, so an occasional request finds nobody in range even after retries. The
  dispatch inspector shows exactly why; raising `supplyWeight` or certification
  prevalence in `fleet.config.ts` fixes it.
- **Batched deliveries are modelled but not driven.** The eligibility rules,
  cargo capacity and stop sequencing exist; the simulator does not yet assign a
  second order to a courier mid-run.
