// The API only gives camera IDs and coordinates. To give each window a human
// name, we label it with the nearest well-known area (approximate centroids).
// Names are "near X" areas, not official LTA camera names.

const P = (name, lat, lng, region) => ({ name, lat, lng, region });

const PLACES = [
  // North
  P('Woodlands Causeway', 1.4466, 103.7695, 'North'),
  P('Woodlands', 1.4360, 103.7865, 'North'),
  P('Kranji', 1.4250, 103.7620, 'North'),
  P('Sembawang', 1.4491, 103.8185, 'North'),
  P('Yishun', 1.4304, 103.8354, 'North'),
  P('Mandai', 1.4045, 103.7900, 'North'),
  P('Lim Chu Kang', 1.4300, 103.7170, 'North'),
  P('Seletar', 1.4100, 103.8690, 'North-East'),
  // North-East
  P('Ang Mo Kio', 1.3691, 103.8454, 'North-East'),
  P('Serangoon', 1.3554, 103.8679, 'North-East'),
  P('Hougang', 1.3612, 103.8863, 'North-East'),
  P('Sengkang', 1.3868, 103.8914, 'North-East'),
  P('Punggol', 1.4043, 103.9020, 'North-East'),
  // East
  P('Pasir Ris', 1.3721, 103.9474, 'East'),
  P('Tampines', 1.3496, 103.9568, 'East'),
  P('Changi Airport', 1.3644, 103.9915, 'East'),
  P('Changi', 1.3400, 104.0100, 'East'),
  P('Bedok', 1.3236, 103.9273, 'East'),
  P('East Coast', 1.3010, 103.9290, 'East'),
  P('Marine Parade', 1.3020, 103.9070, 'East'),
  P('Paya Lebar', 1.3176, 103.8920, 'East'),
  P('Ubi', 1.3300, 103.9000, 'East'),
  // Central
  P('Kallang', 1.3100, 103.8650, 'Central'),
  P('Bishan', 1.3526, 103.8352, 'Central'),
  P('Thomson', 1.3540, 103.8300, 'Central'),
  P('Toa Payoh', 1.3343, 103.8563, 'Central'),
  P('Novena', 1.3204, 103.8438, 'Central'),
  P('Bukit Timah', 1.3294, 103.8021, 'Central'),
  P('Orchard', 1.3048, 103.8318, 'Central'),
  P('Marina Bay', 1.2820, 103.8585, 'Central'),
  P('Marina South', 1.2720, 103.8650, 'Central'),
  P('City Hall', 1.2930, 103.8520, 'Central'),
  P('Outram', 1.2804, 103.8396, 'Central'),
  P('Tanjong Pagar', 1.2764, 103.8460, 'Central'),
  P('Bukit Merah', 1.2819, 103.8239, 'Central'),
  P('Queenstown', 1.2942, 103.7861, 'Central'),
  P('HarbourFront', 1.2653, 103.8220, 'Central'),
  P('Sentosa Gateway', 1.2600, 103.8237, 'Central'),
  // West
  P('Pasir Panjang', 1.2760, 103.7910, 'West'),
  P('West Coast', 1.2950, 103.7630, 'West'),
  P('Clementi', 1.3162, 103.7649, 'West'),
  P('Jurong East', 1.3329, 103.7436, 'West'),
  P('Jurong West', 1.3404, 103.7090, 'West'),
  P('Bukit Batok', 1.3590, 103.7637, 'West'),
  P('Bukit Panjang', 1.3774, 103.7719, 'West'),
  P('Choa Chu Kang', 1.3840, 103.7470, 'West'),
  P('Tengah', 1.3740, 103.7180, 'West'),
  P('Pioneer', 1.3150, 103.6750, 'West'),
  P('Tuas', 1.3200, 103.6500, 'West'),
  P('Tuas Checkpoint', 1.3480, 103.6360, 'West'),
  P('Jurong Island', 1.2660, 103.6990, 'West'),
];

export const REGIONS = ['North', 'North-East', 'East', 'Central', 'West'];

const cache = new Map();

/** Nearest named area for a coordinate. */
export function placeFor(lat, lng) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  let hit = cache.get(key);
  if (hit) return hit;
  const cos = Math.cos((lat * Math.PI) / 180);
  let best = PLACES[0];
  let bestD = Infinity;
  for (const p of PLACES) {
    const dy = p.lat - lat;
    const dx = (p.lng - lng) * cos;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = p; }
  }
  const km = Math.sqrt(bestD) * 111.2;
  hit = { name: best.name, region: best.region, near: km > 2.5 };
  cache.set(key, hit);
  return hit;
}
