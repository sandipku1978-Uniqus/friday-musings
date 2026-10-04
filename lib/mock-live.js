// Offline stand-ins for the live APIs (dev mode and tests): same response shapes, fixed data.

const FIXTURES = [
  [/geocoding-api\.open-meteo\.com/, () => ({ results: [{ name: "Delhi", latitude: 28.65195, longitude: 77.23149, country: "India", admin1: "Delhi", timezone: "Asia/Kolkata" }] })],
  [/api\.open-meteo\.com\/v1\/forecast/, (u) => {
    const from = /start_date=([\d-]+)/.exec(u)[1];
    return { daily: { time: [from], temperature_2m_max: [29.3], temperature_2m_min: [21.2], precipitation_probability_max: [31], weather_code: [81] } };
  }],
  [/nominatim\.openstreetmap\.org/, () => [
    { name: "Tavaa Restaurant", type: "restaurant", osm_type: "node", osm_id: 4303058599, display_name: "Tavaa Restaurant, 24th Road, Khar, Bandra West, Mumbai", extratags: { cuisine: "indian;mughlai" } },
    { name: "Sahibaan", type: "restaurant", osm_type: "node", osm_id: 5273194232, display_name: "Sahibaan, Manuel Gonsalves Road, Khar, Mumbai", extratags: { phone: "022 3296 9618", website: "https://www.sahibaan.com/" } },
  ]],
  [/open\.er-api\.com/, () => ({ result: "success", time_last_update_utc: "Sat, 03 Oct 2026 00:02:32 +0000", rates: { USD: 1, INR: 96.37, AED: 3.6725 } })],
  [/aerodatabox/, () => [{ status: "Expected", airline: { name: "Air India" }, departure: { airport: { iata: "BOM", municipalityName: "Mumbai" }, scheduledTime: { local: "2026-10-09 06:30+05:30" }, terminal: "2" }, arrival: { airport: { iata: "DEL", municipalityName: "Delhi" }, scheduledTime: { local: "2026-10-09 08:40+05:30" } } }]],
];

export async function fakeFetch(url) {
  const hit = FIXTURES.find(([re]) => re.test(url));
  if (!hit) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => hit[1](String(url)) };
}
