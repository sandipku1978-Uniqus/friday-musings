// Live data the concierge can use. Real APIs, no booking, nothing fictional.
//
//   weather   Open-Meteo (no key)                     https://open-meteo.com
//   places    OpenStreetMap Nominatim (no key)        https://nominatim.org (usage policy: identify
//             the app, at most 1 request/second, cache results)
//   fx        ExchangeRate-API open access (no key)   https://www.exchangerate-api.com
//   flight    AeroDataBox via RapidAPI (AERODATABOX_KEY; free tier) — off until the key is set
//
// Every call has a timeout and an in-memory cache; failures come back as { error } so the agent
// can say what it couldn't check instead of inventing it.

const UA = "FridayMusingsConcierge/1.0 (+https://friday-musings.vercel.app)";
const cache = new Map();
let fetchImpl = (...args) => fetch(...args);
let lastNominatim = 0;

export function setFetch(fn) {
  fetchImpl = fn;
}

export const flightConfigured = () => Boolean(process.env.AERODATABOX_KEY);

async function getJSON(url, { headers = {}, ttlMs = 10 * 60000, timeoutMs = 8000 } = {}) {
  const hit = cache.get(url);
  if (hit && hit.until > Date.now()) return hit.value;
  const res = await fetchImpl(url, { headers: { "User-Agent": UA, Accept: "application/json", ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const value = await res.json();
  cache.set(url, { value, until: Date.now() + ttlMs });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

const WMO = [
  [0, "clear"], [1, "mostly clear"], [2, "partly cloudy"], [3, "overcast"], [45, "fog"], [48, "fog"],
  [51, "light drizzle"], [53, "drizzle"], [55, "heavy drizzle"], [61, "light rain"], [63, "rain"], [65, "heavy rain"],
  [71, "light snow"], [73, "snow"], [75, "heavy snow"], [80, "light showers"], [81, "showers"], [82, "heavy showers"],
  [95, "thunderstorms"], [96, "thunderstorms with hail"], [99, "thunderstorms with hail"],
];
const describe = (code) => (WMO.find(([c]) => c === code) || WMO.filter(([c]) => c <= code).pop() || [0, "unknown"])[1];

const isoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const addDays = (date, n) => new Date(Date.parse(date + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

export async function weather({ place, date_from, days = 1 }, { today }) {
  const name = String(place || "").trim().slice(0, 80);
  if (!name) return { error: "Say which place." };
  const from = isoDate(date_from) ? date_from : today;
  const span = Math.min(Math.max(Number(days) || 1, 1), 7);
  const ahead = (Date.parse(from) - Date.parse(today)) / 86400000;
  if (ahead < 0) return { error: "That date is in the past." };
  if (ahead + span > 16) return { error: "Forecasts only go 16 days ahead. Set a reminder to check closer to the date." };
  const geo = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`, { ttlMs: 86400000 });
  const p = geo?.results?.[0];
  if (!p) return { error: `Couldn't find a place called ${name}.` };
  const to = addDays(from, span - 1);
  const f = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=auto&start_date=${from}&end_date=${to}`);
  const d = f?.daily || {};
  return {
    place: [p.name, p.admin1, p.country].filter(Boolean).join(", "),
    days: (d.time || []).map((date, i) => ({
      date, max_c: d.temperature_2m_max?.[i], min_c: d.temperature_2m_min?.[i],
      rain_chance_pct: d.precipitation_probability_max?.[i], summary: describe(d.weather_code?.[i]),
    })),
    source: "Open-Meteo forecast",
  };
}

const COUNTRY = { INR: "in", AED: "ae", USD: "us" };

export async function places({ what, area }, { cityLabel, currency }) {
  const q = String(what || "").trim().slice(0, 60);
  if (!q) return { error: "Say what kind of place." };
  const where = [String(area || "").trim().slice(0, 60), cityLabel].filter(Boolean).join(", ");
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${q} in ${where}`)}&format=jsonv2&limit=8&extratags=1&countrycodes=${COUNTRY[currency] || ""}`;
  const rows = await getJSON(url, { ttlMs: 6 * 3600000 });
  const found = (Array.isArray(rows) ? rows : []).filter((r) => r.name).slice(0, 4).map((r) => {
    const t = r.extratags || {};
    const parts = String(r.display_name || "").split(", ");
    return {
      name: r.name, kind: String(r.type || "").replace(/_/g, " "),
      address: parts.slice(1, 4).join(", "),
      phone: t.phone || t["contact:phone"] || t.mobile || t["contact:mobile"] || "",
      website: t.website || t["contact:website"] || "",
      opening_hours: t.opening_hours || "",
      map: `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}`,
    };
  });
  return { query: `${q} in ${where}`, places: found, source: "OpenStreetMap contributors", note: found.length ? undefined : "OpenStreetMap has no listed match nearby. Suggest asking a neighbour or a local app." };
}

export async function fx({ amount, from, to }) {
  const a = Number(amount);
  const f = String(from || "").toUpperCase(), t = String(to || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(f) || !/^[A-Z]{3}$/.test(t)) return { error: "Use 3-letter currency codes, e.g. USD, INR, AED." };
  const data = await getJSON(`https://open.er-api.com/v6/latest/${f}`, { ttlMs: 3 * 3600000 });
  const rate = data?.rates?.[t];
  if (data?.result !== "success" || !rate) return { error: `No rate for ${f} to ${t}.` };
  return { amount: a, from: f, to: t, rate, converted: Math.round(a * rate * 100) / 100, as_of: data.time_last_update_utc, source: "ExchangeRate-API" };
}

const pick = (side = {}) => ({
  airport: side.airport?.iata ? `${side.airport.municipalityName || side.airport.name || ""} (${side.airport.iata})` : side.airport?.name || "",
  scheduled: side.scheduledTime?.local || side.scheduledTimeLocal || "",
  revised: side.revisedTime?.local || side.actualTimeLocal || side.predictedTime?.local || "",
  terminal: side.terminal || "", gate: side.gate || "",
});

export async function flight({ flight_number, date }, { today }, consumeQuota) {
  if (!flightConfigured()) return { error: "NOT_CONNECTED", message: "Live flight status isn't connected in this demo yet." };
  const num = String(flight_number || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(num)) return { error: "Give a flight number like AI2631 or EK501." };
  const day = isoDate(date) ? date : today;
  if (consumeQuota && !(await consumeQuota())) return { error: "QUOTA", message: "Today's free flight lookups are used up. Try again tomorrow." };
  const rows = await getJSON(`https://aerodatabox.p.rapidapi.com/flights/number/${num}/${day}?withAircraftImage=false&withLocation=false`, {
    headers: { "x-rapidapi-key": process.env.AERODATABOX_KEY, "x-rapidapi-host": "aerodatabox.p.rapidapi.com" }, ttlMs: 5 * 60000,
  });
  const f = Array.isArray(rows) ? rows[0] : null;
  if (!f) return { error: `No flight ${num} found on ${day}.` };
  return {
    flight: num, date: day, airline: f.airline?.name || "", status: f.status || "Unknown",
    departure: pick(f.departure), arrival: pick(f.arrival), source: "AeroDataBox",
  };
}
