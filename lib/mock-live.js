// Offline stand-ins for the live APIs (dev mode and tests): same response shapes, fixed data.

const node = (id, lat, lon, tags) => ({ type: "node", id, lat, lon, tags });
// Overpass answers by what the query asks for: vegetarian restaurants, restaurants, hardware shops,
// and no plumbers, which is what OpenStreetMap actually has around Bandra.
function overpass(body) {
  const q = decodeURIComponent(String(body || "").replace(/^data=/, ""));
  if (/"craft"="plumber"|"shop"="plumbing"/.test(q)) return { elements: [] };
  if (/hardware/.test(q)) return { elements: [
    node(4400000001, 19.0601, 72.8329, { shop: "hardware", name: "Padmavati Ceramic", "addr:street": "Hill Road" }),
    node(4400000002, 19.0655, 72.8361, { shop: "hardware", name: "Public Stores", phone: "+91 90299 11436;+91 22 2640 0000" }),
  ] };
  if (/diet:vegetarian/.test(q)) return { elements: [
    node(4303058611, 19.0561, 72.8331, { amenity: "restaurant", name: "Balaji Restaurant", "diet:vegetarian": "yes", cuisine: "indian" }),
    node(4303058612, 19.0644, 72.8340, { amenity: "restaurant", name: "Love in Langos", "diet:vegetarian": "only", phone: "+91 93210 55321" }),
  ] };
  if (/"amenity"="restaurant"/.test(q)) return { elements: [
    node(4303058599, 19.0679, 72.8312, { amenity: "restaurant", name: "Tavaa Restaurant", cuisine: "indian;mughlai", "addr:street": "24th Road", "addr:suburb": "Khar" }),
    node(5273194232, 19.0702, 72.8355, { amenity: "restaurant", name: "Sahibaan", phone: "022 3296 9618", website: "https://www.sahibaan.com/", "addr:street": "Manuel Gonsalves Road" }),
  ] };
  return { elements: [] };
}

const FIXTURES = [
  [/geocoding-api\.open-meteo\.com/, () => ({ results: [{ name: "Delhi", latitude: 28.65195, longitude: 77.23149, country: "India", admin1: "Delhi", timezone: "Asia/Kolkata" }] })],
  [/api\.open-meteo\.com\/v1\/forecast/, (u) => {
    const from = /start_date=([\d-]+)/.exec(u)[1];
    return { daily: { time: [from], temperature_2m_max: [29.3], temperature_2m_min: [21.2], precipitation_probability_max: [31], weather_code: [81] } };
  }],
  [/overpass-api\.de/, (u, opts) => overpass(opts?.body)],
  [/nominatim\.openstreetmap\.org/, () => [
    { name: "Tavaa Restaurant", type: "restaurant", lat: "19.0583", lon: "72.8303", osm_type: "node", osm_id: 4303058599, display_name: "Tavaa Restaurant, 24th Road, Khar, Bandra West, Mumbai", extratags: { cuisine: "indian;mughlai" } },
    { name: "Sahibaan", type: "restaurant", lat: "19.0702", lon: "72.8355", osm_type: "node", osm_id: 5273194232, display_name: "Sahibaan, Manuel Gonsalves Road, Khar, Mumbai", extratags: { phone: "022 3296 9618", website: "https://www.sahibaan.com/" } },
  ]],
  [/open\.er-api\.com/, () => ({ result: "success", time_last_update_utc: "Sat, 03 Oct 2026 00:02:32 +0000", rates: { USD: 1, INR: 96.37, AED: 3.6725 } })],
  [/aerodatabox/, () => [{ status: "Expected", airline: { name: "Air India" }, departure: { airport: { iata: "BOM", municipalityName: "Mumbai" }, scheduledTime: { local: "2026-10-09 06:30+05:30" }, terminal: "2" }, arrival: { airport: { iata: "DEL", municipalityName: "Delhi" }, scheduledTime: { local: "2026-10-09 08:40+05:30" } } }]],
];

export async function fakeFetch(url, opts) {
  const hit = FIXTURES.find(([re]) => re.test(url));
  if (!hit) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => hit[1](String(url), opts) };
}
