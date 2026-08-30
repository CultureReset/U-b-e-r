/**
 * Merchant/catalogue schema.
 *
 * The generator in data/seed builds a storefront population out of these
 * archetypes. Nothing here is a specific restaurant — an archetype is a
 * template (cuisine, price band, menu section shapes, modifier groups) that
 * produces as many concrete merchants as the market needs. Replace an
 * archetype and the entire storefront population changes shape.
 */

export interface ModifierOptionTemplate {
  name: string;
  /** Price delta expressed as a multiple of the item's base price. */
  priceFactor: number;
  isDefault?: boolean;
}

export interface ModifierGroupTemplate {
  id: string;
  name: string;
  /** 'single' = radio, 'multi' = checkbox. */
  select: 'single' | 'multi';
  required: boolean;
  minSelect: number;
  maxSelect: number;
  options: ModifierOptionTemplate[];
}

export interface ItemTemplate {
  name: string;
  description: string;
  /** Base price band multiplier, combined with the merchant's price tier. */
  priceIndex: number;
  tags: string[];
  /** Modifier group ids attached to this item. */
  modifierGroupIds: string[];
  /** Chance the generated merchant marks it a customer favourite. */
  popularity: number;
  prepMinutes: number;
}

export interface MenuSectionTemplate {
  name: string;
  items: ItemTemplate[];
}

export interface MerchantArchetype {
  id: string;
  cuisine: string;
  category: string;
  /** Naming parts the generator combines into storefront names. */
  nameParts: { prefix: string[]; suffix: string[] };
  priceTier: 1 | 2 | 3 | 4;
  /** Base preparation time in minutes, before load adjustments. */
  basePrepMinutes: number;
  ratingRange: [number, number];
  /** Relative likelihood this archetype appears in a market. */
  weight: number;
  /** Emoji/glyph used as the storefront visual placeholder. */
  glyph: string;
  accent: string;
  menu: MenuSectionTemplate[];
  /** Merchant-level settings the merchant dashboard can edit. */
  defaults: {
    acceptsScheduledOrders: boolean;
    autoAcceptOrders: boolean;
    minimumOrder: number;
    deliveryRadiusKm: number;
    packagingFee: number;
  };
}

export interface CatalogConfig {
  /** Modifier groups shared across archetypes. */
  modifierGroups: ModifierGroupTemplate[];
  archetypes: MerchantArchetype[];
  /** Consumer-facing browse categories in the Eats home. */
  browseCategories: { id: string; label: string; icon: string; matchCuisines: string[] }[];
  /** Storefront opening-hours templates the generator picks from. */
  hoursTemplates: { id: string; label: string; open: number; close: number }[];
  /** Price band → currency amount used as the item base price. */
  priceBands: Record<1 | 2 | 3 | 4, number>;
}

const mg = (
  id: string,
  name: string,
  select: 'single' | 'multi',
  required: boolean,
  minSelect: number,
  maxSelect: number,
  options: ModifierOptionTemplate[],
): ModifierGroupTemplate => ({ id, name, select, required, minSelect, maxSelect, options });

export const catalogConfig: CatalogConfig = {
  priceBands: { 1: 4.5, 2: 8, 3: 14, 4: 24 },
  modifierGroups: [
    mg('size', 'Choose a size', 'single', true, 1, 1, [
      { name: 'Regular', priceFactor: 0, isDefault: true },
      { name: 'Large', priceFactor: 0.28 },
      { name: 'Family', priceFactor: 0.75 },
    ]),
    mg('protein', 'Choose your protein', 'single', true, 1, 1, [
      { name: 'Chicken', priceFactor: 0, isDefault: true },
      { name: 'Beef', priceFactor: 0.15 },
      { name: 'Pork', priceFactor: 0.1 },
      { name: 'Plant-based', priceFactor: 0.12 },
    ]),
    mg('spice', 'Spice level', 'single', false, 0, 1, [
      { name: 'Mild', priceFactor: 0, isDefault: true },
      { name: 'Medium', priceFactor: 0 },
      { name: 'Hot', priceFactor: 0 },
      { name: 'Extra hot', priceFactor: 0 },
    ]),
    mg('addons', 'Add extras', 'multi', false, 0, 5, [
      { name: 'Extra cheese', priceFactor: 0.14 },
      { name: 'Avocado', priceFactor: 0.18 },
      { name: 'Bacon', priceFactor: 0.2 },
      { name: 'Fried egg', priceFactor: 0.12 },
      { name: 'Extra sauce', priceFactor: 0.06 },
    ]),
    mg('side', 'Pick a side', 'single', false, 0, 1, [
      { name: 'No side', priceFactor: 0, isDefault: true },
      { name: 'Fries', priceFactor: 0.3 },
      { name: 'Salad', priceFactor: 0.32 },
      { name: 'Plantain', priceFactor: 0.26 },
    ]),
    mg('drink', 'Add a drink', 'single', false, 0, 1, [
      { name: 'No drink', priceFactor: 0, isDefault: true },
      { name: 'Soda', priceFactor: 0.24 },
      { name: 'Fresh juice', priceFactor: 0.38 },
      { name: 'Sparkling water', priceFactor: 0.26 },
    ]),
    mg('milk', 'Milk choice', 'single', false, 0, 1, [
      { name: 'Whole', priceFactor: 0, isDefault: true },
      { name: 'Oat', priceFactor: 0.12 },
      { name: 'Almond', priceFactor: 0.12 },
      { name: 'None', priceFactor: 0 },
    ]),
  ],
  browseCategories: [
    { id: 'all', label: 'All', icon: 'grid', matchCuisines: [] },
    { id: 'fast', label: 'Fast food', icon: 'burger', matchCuisines: ['Burgers', 'Fried chicken'] },
    { id: 'local', label: 'Local', icon: 'bowl', matchCuisines: ['Colombian', 'Latin'] },
    { id: 'pizza', label: 'Pizza', icon: 'pizza', matchCuisines: ['Pizza'] },
    { id: 'sushi', label: 'Sushi', icon: 'sushi', matchCuisines: ['Japanese'] },
    { id: 'healthy', label: 'Healthy', icon: 'leaf', matchCuisines: ['Bowls', 'Vegetarian'] },
    { id: 'coffee', label: 'Coffee', icon: 'coffee', matchCuisines: ['Coffee', 'Bakery'] },
    { id: 'grocery', label: 'Grocery', icon: 'basket', matchCuisines: ['Grocery', 'Convenience'] },
    { id: 'pharmacy', label: 'Pharmacy', icon: 'cross', matchCuisines: ['Pharmacy'] },
  ],
  hoursTemplates: [
    { id: 'breakfast', label: 'Breakfast & lunch', open: 6, close: 16 },
    { id: 'allday', label: 'All day', open: 8, close: 23 },
    { id: 'dinner', label: 'Dinner service', open: 12, close: 24 },
    { id: 'latenight', label: 'Late night', open: 11, close: 26 },
    { id: 'roundclock', label: '24 hours', open: 0, close: 24 },
  ],
  archetypes: [
    {
      id: 'burgers',
      cuisine: 'Burgers',
      category: 'Fast food',
      nameParts: {
        prefix: ['Smash', 'Brasa', 'Union', 'Corner', 'Iron', 'Golden', 'Doble'],
        suffix: ['Burger Co.', 'Grill', 'Patty House', 'Burgers', 'Diner'],
      },
      priceTier: 2,
      basePrepMinutes: 12,
      ratingRange: [4.1, 4.9],
      weight: 3,
      glyph: '🍔',
      accent: '#c4622b',
      defaults: {
        acceptsScheduledOrders: true,
        autoAcceptOrders: true,
        minimumOrder: 6,
        deliveryRadiusKm: 6,
        packagingFee: 0.6,
      },
      menu: [
        {
          name: 'Signature burgers',
          items: [
            {
              name: 'Classic smash',
              description: 'Double smashed patty, cheddar, pickles, house sauce.',
              priceIndex: 1,
              tags: ['popular'],
              modifierGroupIds: ['addons', 'side', 'drink'],
              popularity: 0.9,
              prepMinutes: 10,
            },
            {
              name: 'Bacon jam burger',
              description: 'Bacon jam, aged cheddar, crispy onion.',
              priceIndex: 1.25,
              tags: [],
              modifierGroupIds: ['addons', 'side'],
              popularity: 0.6,
              prepMinutes: 12,
            },
            {
              name: 'Plant burger',
              description: 'Plant-based patty, vegan cheese, smoked mayo.',
              priceIndex: 1.15,
              tags: ['vegetarian'],
              modifierGroupIds: ['addons', 'side'],
              popularity: 0.4,
              prepMinutes: 11,
            },
          ],
        },
        {
          name: 'Sides',
          items: [
            {
              name: 'Loaded fries',
              description: 'Cheese sauce, jalapeño, spring onion.',
              priceIndex: 0.6,
              tags: [],
              modifierGroupIds: ['size'],
              popularity: 0.7,
              prepMinutes: 7,
            },
            {
              name: 'Onion rings',
              description: 'Beer-battered, chipotle dip.',
              priceIndex: 0.55,
              tags: [],
              modifierGroupIds: ['size'],
              popularity: 0.45,
              prepMinutes: 7,
            },
          ],
        },
        {
          name: 'Drinks',
          items: [
            {
              name: 'Milkshake',
              description: 'Vanilla, chocolate or dulce de leche.',
              priceIndex: 0.7,
              tags: [],
              modifierGroupIds: ['size', 'milk'],
              popularity: 0.5,
              prepMinutes: 5,
            },
          ],
        },
      ],
    },
    {
      id: 'colombian',
      cuisine: 'Colombian',
      category: 'Local',
      nameParts: {
        prefix: ['Doña', 'La', 'El', 'Casa', 'Sabor'],
        suffix: ['Bandeja', 'Fogón', 'Cocina', 'Criolla', 'Paisa'],
      },
      priceTier: 2,
      basePrepMinutes: 18,
      ratingRange: [4.3, 4.95],
      weight: 3,
      glyph: '🍲',
      accent: '#a8541f',
      defaults: {
        acceptsScheduledOrders: true,
        autoAcceptOrders: false,
        minimumOrder: 8,
        deliveryRadiusKm: 7,
        packagingFee: 0.8,
      },
      menu: [
        {
          name: 'Platos fuertes',
          items: [
            {
              name: 'Bandeja paisa',
              description: 'Beans, rice, chicharrón, chorizo, egg, plantain, avocado.',
              priceIndex: 1.4,
              tags: ['popular'],
              modifierGroupIds: ['drink'],
              popularity: 0.95,
              prepMinutes: 20,
            },
            {
              name: 'Ajiaco santafereño',
              description: 'Three-potato chicken soup with guasca, capers and cream.',
              priceIndex: 1.2,
              tags: ['popular'],
              modifierGroupIds: ['size', 'drink'],
              popularity: 0.85,
              prepMinutes: 16,
            },
            {
              name: 'Sancocho de gallina',
              description: 'Hen soup with yuca, plantain and corn.',
              priceIndex: 1.25,
              tags: [],
              modifierGroupIds: ['size'],
              popularity: 0.55,
              prepMinutes: 22,
            },
          ],
        },
        {
          name: 'Entradas',
          items: [
            {
              name: 'Empanadas (3)',
              description: 'Beef and potato, ají on the side.',
              priceIndex: 0.5,
              tags: [],
              modifierGroupIds: ['spice'],
              popularity: 0.8,
              prepMinutes: 8,
            },
            {
              name: 'Arepa de choclo',
              description: 'Sweetcorn arepa with fresh cheese.',
              priceIndex: 0.45,
              tags: ['vegetarian'],
              modifierGroupIds: [],
              popularity: 0.6,
              prepMinutes: 9,
            },
          ],
        },
        {
          name: 'Bebidas',
          items: [
            {
              name: 'Jugo natural',
              description: 'Lulo, maracuyá, mora or mango.',
              priceIndex: 0.4,
              tags: [],
              modifierGroupIds: ['size', 'milk'],
              popularity: 0.7,
              prepMinutes: 4,
            },
          ],
        },
      ],
    },
    {
      id: 'pizza',
      cuisine: 'Pizza',
      category: 'Italian',
      nameParts: {
        prefix: ['Forno', 'Nonna', 'Vera', 'Piccola', 'Napoli'],
        suffix: ['Pizzeria', 'Pizza Co.', 'Forno', 'Napoletana'],
      },
      priceTier: 2,
      basePrepMinutes: 16,
      ratingRange: [4.2, 4.9],
      weight: 2.5,
      glyph: '🍕',
      accent: '#b4342b',
      defaults: {
        acceptsScheduledOrders: true,
        autoAcceptOrders: true,
        minimumOrder: 10,
        deliveryRadiusKm: 6,
        packagingFee: 0.5,
      },
      menu: [
        {
          name: 'Pizzas',
          items: [
            {
              name: 'Margherita',
              description: 'San Marzano, fior di latte, basil.',
              priceIndex: 1,
              tags: ['vegetarian', 'popular'],
              modifierGroupIds: ['size', 'addons'],
              popularity: 0.9,
              prepMinutes: 14,
            },
            {
              name: 'Diavola',
              description: 'Spicy salami, mozzarella, chilli oil.',
              priceIndex: 1.2,
              tags: [],
              modifierGroupIds: ['size', 'addons', 'spice'],
              popularity: 0.7,
              prepMinutes: 14,
            },
            {
              name: 'Quattro formaggi',
              description: 'Mozzarella, gorgonzola, parmesan, provolone.',
              priceIndex: 1.3,
              tags: ['vegetarian'],
              modifierGroupIds: ['size', 'addons'],
              popularity: 0.55,
              prepMinutes: 15,
            },
          ],
        },
        {
          name: 'Starters',
          items: [
            {
              name: 'Garlic knots',
              description: 'Six knots, parmesan, marinara dip.',
              priceIndex: 0.5,
              tags: ['vegetarian'],
              modifierGroupIds: [],
              popularity: 0.65,
              prepMinutes: 8,
            },
          ],
        },
      ],
    },
    {
      id: 'sushi',
      cuisine: 'Japanese',
      category: 'Asian',
      nameParts: { prefix: ['Kaze', 'Hoshi', 'Sakana', 'Ume', 'Kinza'], suffix: ['Sushi', 'Omakase', 'Izakaya', 'Ramen Bar'] },
      priceTier: 3,
      basePrepMinutes: 22,
      ratingRange: [4.4, 4.95],
      weight: 1.6,
      glyph: '🍣',
      accent: '#1f6f8b',
      defaults: {
        acceptsScheduledOrders: true,
        autoAcceptOrders: false,
        minimumOrder: 18,
        deliveryRadiusKm: 8,
        packagingFee: 1.2,
      },
      menu: [
        {
          name: 'Rolls',
          items: [
            {
              name: 'Spicy tuna roll',
              description: 'Eight pieces, chilli mayo, scallion.',
              priceIndex: 1,
              tags: ['popular'],
              modifierGroupIds: ['spice'],
              popularity: 0.85,
              prepMinutes: 18,
            },
            {
              name: 'Salmon avocado',
              description: 'Eight pieces, sesame, ponzu.',
              priceIndex: 0.95,
              tags: [],
              modifierGroupIds: [],
              popularity: 0.75,
              prepMinutes: 18,
            },
            {
              name: 'Dragon roll',
              description: 'Eel, cucumber, avocado, unagi glaze.',
              priceIndex: 1.35,
              tags: [],
              modifierGroupIds: [],
              popularity: 0.5,
              prepMinutes: 20,
            },
          ],
        },
        {
          name: 'Hot dishes',
          items: [
            {
              name: 'Tonkotsu ramen',
              description: 'Pork broth, chashu, ajitama, nori.',
              priceIndex: 1.1,
              tags: ['popular'],
              modifierGroupIds: ['spice', 'addons'],
              popularity: 0.8,
              prepMinutes: 16,
            },
          ],
        },
      ],
    },
    {
      id: 'bowls',
      cuisine: 'Bowls',
      category: 'Healthy',
      nameParts: { prefix: ['Verde', 'Fresh', 'Raíz', 'Bright', 'Nutre'], suffix: ['Bowls', 'Kitchen', 'Greens', 'Table'] },
      priceTier: 3,
      basePrepMinutes: 11,
      ratingRange: [4.3, 4.9],
      weight: 1.8,
      glyph: '🥗',
      accent: '#2f7d4f',
      defaults: {
        acceptsScheduledOrders: true,
        autoAcceptOrders: true,
        minimumOrder: 9,
        deliveryRadiusKm: 5,
        packagingFee: 0.7,
      },
      menu: [
        {
          name: 'Signature bowls',
          items: [
            {
              name: 'Build your bowl',
              description: 'Base, protein, four toppings, house dressing.',
              priceIndex: 1,
              tags: ['popular'],
              modifierGroupIds: ['protein', 'addons', 'size'],
              popularity: 0.95,
              prepMinutes: 9,
            },
            {
              name: 'Andean quinoa bowl',
              description: 'Quinoa, roasted squash, black beans, lime crema.',
              priceIndex: 1.05,
              tags: ['vegetarian'],
              modifierGroupIds: ['protein', 'addons'],
              popularity: 0.6,
              prepMinutes: 10,
            },
          ],
        },
        {
          name: 'Drinks',
          items: [
            {
              name: 'Cold-pressed juice',
              description: 'Green, citrus or beet.',
              priceIndex: 0.55,
              tags: [],
              modifierGroupIds: ['size'],
              popularity: 0.55,
              prepMinutes: 4,
            },
          ],
        },
      ],
    },
    {
      id: 'coffee',
      cuisine: 'Coffee',
      category: 'Cafe',
      nameParts: { prefix: ['Altura', 'Amanecer', 'Grano', 'Cumbre', 'Origen'], suffix: ['Café', 'Roasters', 'Coffee', 'Tostadores'] },
      priceTier: 1,
      basePrepMinutes: 7,
      ratingRange: [4.4, 4.95],
      weight: 2.2,
      glyph: '☕',
      accent: '#7a5230',
      defaults: {
        acceptsScheduledOrders: true,
        autoAcceptOrders: true,
        minimumOrder: 4,
        deliveryRadiusKm: 4,
        packagingFee: 0.3,
      },
      menu: [
        {
          name: 'Espresso bar',
          items: [
            {
              name: 'Flat white',
              description: 'Double ristretto, steamed milk.',
              priceIndex: 1,
              tags: ['popular'],
              modifierGroupIds: ['size', 'milk'],
              popularity: 0.9,
              prepMinutes: 5,
            },
            {
              name: 'Cold brew',
              description: 'Sixteen-hour steep, served over ice.',
              priceIndex: 1.05,
              tags: [],
              modifierGroupIds: ['size', 'milk'],
              popularity: 0.7,
              prepMinutes: 4,
            },
          ],
        },
        {
          name: 'Bakery',
          items: [
            {
              name: 'Almond croissant',
              description: 'Baked in-house each morning.',
              priceIndex: 0.8,
              tags: ['vegetarian'],
              modifierGroupIds: [],
              popularity: 0.65,
              prepMinutes: 3,
            },
            {
              name: 'Pan de bono (4)',
              description: 'Warm cheese bread.',
              priceIndex: 0.6,
              tags: ['vegetarian'],
              modifierGroupIds: [],
              popularity: 0.75,
              prepMinutes: 3,
            },
          ],
        },
      ],
    },
    {
      id: 'grocery',
      cuisine: 'Grocery',
      category: 'Retail',
      nameParts: { prefix: ['Mercado', 'Fresco', 'Barrio', 'Central'], suffix: ['Market', 'Grocer', 'Despensa', 'Provisions'] },
      priceTier: 2,
      basePrepMinutes: 14,
      ratingRange: [4.0, 4.7],
      weight: 1.4,
      glyph: '🛒',
      accent: '#2f6bff',
      defaults: {
        acceptsScheduledOrders: true,
        autoAcceptOrders: true,
        minimumOrder: 12,
        deliveryRadiusKm: 5,
        packagingFee: 0.4,
      },
      menu: [
        {
          name: 'Fresh produce',
          items: [
            {
              name: 'Banana bunch',
              description: 'Approx. 1.2 kg.',
              priceIndex: 0.3,
              tags: [],
              modifierGroupIds: [],
              popularity: 0.8,
              prepMinutes: 2,
            },
            {
              name: 'Avocado (2)',
              description: 'Hass, ripe.',
              priceIndex: 0.45,
              tags: [],
              modifierGroupIds: [],
              popularity: 0.75,
              prepMinutes: 2,
            },
          ],
        },
        {
          name: 'Pantry',
          items: [
            {
              name: 'Coffee beans 500g',
              description: 'Single-origin, medium roast.',
              priceIndex: 1.1,
              tags: [],
              modifierGroupIds: [],
              popularity: 0.5,
              prepMinutes: 2,
            },
            {
              name: 'Arepa flour 1kg',
              description: 'Pre-cooked white corn flour.',
              priceIndex: 0.35,
              tags: [],
              modifierGroupIds: [],
              popularity: 0.6,
              prepMinutes: 2,
            },
          ],
        },
      ],
    },
    {
      id: 'pharmacy',
      cuisine: 'Pharmacy',
      category: 'Retail',
      nameParts: { prefix: ['Salud', 'Vita', 'Cruz', 'Bien'], suffix: ['Farmacia', 'Pharmacy', 'Drugstore'] },
      priceTier: 2,
      basePrepMinutes: 10,
      ratingRange: [4.1, 4.8],
      weight: 0.9,
      glyph: '💊',
      accent: '#1f7a8b',
      defaults: {
        acceptsScheduledOrders: false,
        autoAcceptOrders: true,
        minimumOrder: 5,
        deliveryRadiusKm: 6,
        packagingFee: 0.3,
      },
      menu: [
        {
          name: 'Everyday care',
          items: [
            {
              name: 'Pain relief tablets',
              description: 'Pack of 20.',
              priceIndex: 0.5,
              tags: [],
              modifierGroupIds: [],
              popularity: 0.8,
              prepMinutes: 3,
            },
            {
              name: 'Electrolyte sachets',
              description: 'Box of 8.',
              priceIndex: 0.6,
              tags: [],
              modifierGroupIds: [],
              popularity: 0.6,
              prepMinutes: 3,
            },
          ],
        },
      ],
    },
  ],
};
