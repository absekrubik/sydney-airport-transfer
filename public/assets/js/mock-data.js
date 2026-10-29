// =====================================================================
// DEVELOPMENT DATA ONLY (Stage 2).
// Every value in this file is a placeholder so the interface can be built
// before the backend exists. In Stage 3 these are replaced by API calls:
//   GET /api/vehicle-categories, GET /api/routes, POST /api/quotes
// Fares below are NOT real prices and no distance is calculated here.
// =====================================================================

export const DEV_NOTICE =
  'Development preview: fares and vehicles are sample data. Live pricing and booking submission arrive in Stage 3.';

export const LOCATIONS = [
  'Sydney Airport (SYD) – Domestic Terminal',
  'Sydney Airport (SYD) – International Terminal',
  'Sydney CBD',
  'Parramatta',
  'Bondi Beach',
  'Manly',
  'North Sydney',
  'Chatswood',
  'Darling Harbour',
];

export const VEHICLES = [
  { id: 'sedan', name: 'Business Sedan', example: 'Toyota Camry or similar', passengers: 3, luggage: 3, features: ['Air conditioning', 'Bottled water', 'Phone charger'] },
  { id: 'suv', name: 'Premium SUV', example: 'Kia Sorento or similar', passengers: 5, luggage: 5, features: ['Extra luggage space', 'Air conditioning', 'Child seat available'] },
  { id: 'van', name: 'Group Van', example: 'Hyundai Staria or similar', passengers: 7, luggage: 8, features: ['Large luggage area', 'Air conditioning', 'Group travel'] },
  { id: 'luxury', name: 'Luxury Sedan', example: 'Mercedes E-Class or similar', passengers: 3, luggage: 3, features: ['Leather seats', 'Complimentary water', 'Chauffeur service'] },
];

// Sample fixed fares in cents, keyed "origin|destination|vehicle". Illustrative only.
const FIXED_BASE = {
  'Sydney CBD': { sedan: 8500, suv: 11000, van: 14500, luxury: 15500 },
  'Parramatta': { sedan: 11000, suv: 14000, van: 18000, luxury: 19500 },
  'Bondi Beach': { sedan: 9000, suv: 11500, van: 15000, luxury: 16500 },
  'Manly': { sedan: 12500, suv: 15500, van: 19500, luxury: 21000 },
  'North Sydney': { sedan: 9500, suv: 12000, van: 15500, luxury: 17000 },
  'Chatswood': { sedan: 11500, suv: 14500, van: 18500, luxury: 20000 },
  'Darling Harbour': { sedan: 8500, suv: 11000, van: 14500, luxury: 15500 },
};

export const DEV_RULES = {
  returnDiscountPercent: 10,     // placeholder: discount applied to the return leg
  childSeatCents: 1000,          // placeholder: per child seat
  cancellationFeePercent: 50,    // placeholder: client has not confirmed this value yet
};

const isAirport = (s) => /sydney airport/i.test(s || '');
const norm = (s) => (s || '').trim().toLowerCase();
const place = (name) => Object.keys(FIXED_BASE).find((k) => norm(k) === norm(name));

/** Find a sample fixed fare for a leg, or null when no fixed route is configured. */
export function findFixedFare(pickup, destination, vehicleId) {
  const dest = isAirport(pickup) && place(destination);
  const from = isAirport(destination) && place(pickup);
  const key = dest || from;
  return key ? FIXED_BASE[key][vehicleId] ?? null : null;
}
