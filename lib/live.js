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

// Places: geocode the area with Nominatim, then ask Overpass for OSM features by tag around it.
// Nominatim's free-text search only understands a bare category ("restaurant in Bandra"); a word
// like "vegetarian" or "plumber" makes it a name search and it finds nothing. Tags don't have that
// problem. Every Overpass filter below is a fixed string: nothing the visitor typed reaches a query.
// The main instance's two servers, then its shared gateway (which 504s under load when they don't).
const OVERPASS = ["https://lz4.overpass-api.de/api/interpreter", "https://z.overpass-api.de/api/interpreter", "https://overpass-api.de/api/interpreter"];

// [words, label, exact filters, related filters (shown, labelled, only when nothing exact is listed), related label]
const KINDS = [
  [/\b(restaurants?|dinner|lunch|brunch|eat|food|dine|dining|table)\b/, "restaurant", ['["amenity"="restaurant"]']],
  [/\b(caf[eé]s?|coffee)\b/, "café", ['["amenity"="cafe"]']],
  [/\b(dentists?|dental)\b/, "dentist", ['["amenity"="dentist"]', '["healthcare"="dentist"]']],
  [/\b(physio\w*)\b/, "physiotherapist", ['["healthcare"="physiotherapist"]'], ['["amenity"~"^(clinic|doctors)$"]'], "clinic"],
  [/\b(doctors?|gp|clinics?|physician)\b/, "clinic", ['["amenity"~"^(clinic|doctors)$"]', '["healthcare"~"^(clinic|doctor)$"]']],
  [/\b(hospitals?)\b/, "hospital", ['["amenity"="hospital"]']],
  [/\b(pharmac\w*|chemists?|medical stores?|drugstores?)\b/, "pharmacy", ['["amenity"="pharmacy"]', '["healthcare"="pharmacy"]']],
  [/\b(plumb\w*)\b/, "plumber", ['["craft"="plumber"]', '["shop"="plumbing"]'], ['["shop"~"^(hardware|doityourself|bathroom_furnishing|trade)$"]'], "hardware and plumbing shop"],
  [/\b(electrician|electrical|wiring)\b/, "electrician", ['["craft"="electrician"]'], ['["shop"~"^(electrical|hardware|doityourself)$"]'], "electrical and hardware shop"],
  [/\b(ac|a\/c|air[- ]?con\w*|hvac)\b/, "AC service", ['["craft"="hvac"]', '["shop"="hvac"]'], ['["shop"~"^(appliance|electronics|electrical)$"]'], "appliance shop"],
  [/\b(carpenter|carpentry)\b/, "carpenter", ['["craft"="carpenter"]'], ['["shop"~"^(hardware|doityourself)$"]'], "hardware shop"],
  [/\b(gyms?|fitness)\b/, "gym", ['["leisure"="fitness_centre"]']],
  [/\b(salons?|barbers?|hair\w*|beauty|spa)\b/, "salon", ['["shop"~"^(hairdresser|beauty)$"]']],
  [/\b(supermarkets?|grocer\w*|kirana)\b/, "grocery", ['["shop"~"^(supermarket|convenience|greengrocer)$"]']],
  [/\b(bakery|bakeries|cakes?|pastry)\b/, "bakery", ['["shop"~"^(bakery|pastry|confectionery)$"]']],
  [/\b(florists?|flowers?)\b/, "florist", ['["shop"="florist"]']],
  [/\b(gifts?)\b/, "gift shop", ['["shop"~"^(gift|toys)$"]']],
  [/\b(laundry|dry[- ]?clean\w*)\b/, "laundry", ['["shop"~"^(laundry|dry_cleaning)$"]']],
  [/\b(vets?|veterinar\w*)\b/, "vet", ['["amenity"="veterinary"]']],
  [/\b(mechanics?|garages?|car repair|car service)\b/, "car repair", ['["shop"="car_repair"]']],
  [/\b(atms?)\b/, "ATM", ['["amenity"="atm"]']],
  [/\b(banks?)\b/, "bank", ['["amenity"="bank"]']],
  [/\b(petrol|fuel|gas station)\b/, "fuel station", ['["amenity"="fuel"]']],
  [/\b(hotels?)\b/, "hotel", ['["tourism"="hotel"]']],
];
// Diet and cuisine narrow food places only. Each is [words, label, alternative tag filters].
const DIETS = [
  [/\b(veg|vegetarian|pure veg|jain)\b/, "vegetarian", ['["diet:vegetarian"~"^(yes|only)$"]', '["cuisine"~"vegetarian",i]']],
  [/\b(vegan)\b/, "vegan", ['["diet:vegan"~"^(yes|only)$"]', '["cuisine"~"vegan",i]']],
  [/\b(halal)\b/, "halal", ['["diet:halal"~"^(yes|only)$"]']],
];
const CUISINES = ["south indian", "north indian", "indian", "chinese", "italian", "japanese", "sushi", "thai", "mexican", "lebanese", "arab", "seafood", "pizza", "burger", "korean", "mediterranean", "continental"];
const FOOD = new Set(["restaurant", "café"]);

export function parsePlaceQuery(what) {
  const text = String(what || "").toLowerCase();
  const kind = KINDS.find(([re]) => re.test(text));
  const diet = DIETS.find(([re]) => re.test(text));
  const cuisine = CUISINES.find((c) => new RegExp(`\\b${c}\\b`).test(text));
  if (!kind && !diet && !cuisine) return null;
  const [, label, exact, related = [], relatedLabel] = kind || KINDS[0];
  const food = FOOD.has(label);
  const narrow = food ? [diet?.[2], cuisine && [`["cuisine"~"${cuisine.replace(/ /g, "_")}",i]`]].filter(Boolean) : [];
  return { label: [food && diet?.[1], food && cuisine, label].filter(Boolean).join(" "), exact, narrow, related, relatedLabel };
}

// Each filter set is OR'd; each narrowing group is AND'd with it (and OR'd within itself). A bounding
// box, not (around:...): around makes Overpass test every candidate's distance and routinely times
// out on busy servers, where the same box query answers in about a second.
function overpassQuery(filters, narrow, lat, lon, radius) {
  let combos = filters.map((f) => [f]);
  for (const group of narrow) combos = combos.flatMap((c) => group.map((g) => [...c, g]));
  const dLat = radius / 111320, dLon = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  const box = `(${(lat - dLat).toFixed(5)},${(lon - dLon).toFixed(5)},${(lat + dLat).toFixed(5)},${(lon + dLon).toFixed(5)})`;
  return `[out:json][timeout:10];(${combos.map((c) => `nwr${c.join("")}["name"]${box};`).join("")});out center tags 60;`;
}

async function overpass(query) {
  const hit = cache.get(query);
  if (hit && hit.until > Date.now()) return hit.value;
  let last;
  for (const endpoint of OVERPASS) {
    try {
      const res = await fetchImpl(endpoint, { method: "POST", headers: { "User-Agent": UA, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(query), signal: AbortSignal.timeout(7000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const value = await res.json();
      // A timed-out query still answers 200, with no elements and a remark. That's "couldn't check", not "none".
      if (/error/i.test(String(value?.remark || ""))) throw new Error(String(value.remark).slice(0, 120));
      cache.set(query, { value, until: Date.now() + 6 * 3600000 });
      return value;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

async function nominatim(params) {
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  return getJSON(`https://nominatim.openstreetmap.org/search?${params}`, { ttlMs: 24 * 3600000 });
}

const km = (aLat, aLon, bLat, bLon) => {
  const r = Math.PI / 180, x = (bLon - aLon) * r * Math.cos(((aLat + bLat) / 2) * r), y = (bLat - aLat) * r;
  return 6371 * Math.hypot(x, y);
};

// OSM allows several numbers in one tag ("+91 …;+91 …"); a Call button needs one.
const firstPhone = (v) => String(v || "").split(/[;,/]/)[0].trim();

function fromOverpass(el, lat, lon) {
  const t = el.tags || {};
  const pLat = el.lat ?? el.center?.lat, pLon = el.lon ?? el.center?.lon;
  const diet = t["diet:vegetarian"] === "only" ? "pure vegetarian" : t["diet:vegetarian"] === "yes" ? "vegetarian options" : "";
  const kind = [String(t.amenity || t.shop || t.craft || t.healthcare || t.leisure || t.tourism || "").replace(/_/g, " "), diet, t.cuisine && String(t.cuisine).split(";").slice(0, 2).join(", ").replace(/_/g, " ")].filter(Boolean).join(" · ");
  const dist = pLat != null ? km(lat, lon, pLat, pLon) : null;
  return {
    name: t["name:en"] || t.name, kind,
    address: [t["addr:housename"], [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" "), t["addr:suburb"] || t["addr:city"]].filter(Boolean).join(", "),
    phone: firstPhone(t.phone || t["contact:phone"] || t.mobile || t["contact:mobile"]),
    website: t.website || t["contact:website"] || "",
    opening_hours: t.opening_hours || "",
    distance_km: dist == null ? null : Math.round(dist * 10) / 10,
    map: `https://www.openstreetmap.org/${el.type}/${el.id}`,
  };
}

const pickBest = (els, lat, lon) => {
  const seen = new Set();
  return els.map((e) => fromOverpass(e, lat, lon)).filter((p) => p.name && !seen.has(p.name.toLowerCase()) && seen.add(p.name.toLowerCase()))
    // Nearest first, but a listed phone number is worth about a kilometre.
    .sort((a, b) => ((a.distance_km ?? 99) - (a.phone ? 1 : 0)) - ((b.distance_km ?? 99) - (b.phone ? 1 : 0)))
    .slice(0, 4);
};

export async function places({ what, area }, { cityLabel, currency }) {
  const q = String(what || "").trim().slice(0, 60);
  if (!q) return { error: "Say what kind of place." };
  const areaName = String(area || "").trim().slice(0, 60);
  const where = [areaName, cityLabel].filter(Boolean).join(", ");
  const cc = COUNTRY[currency] || "";
  const base = { query: `${q} in ${where}`, source: "OpenStreetMap contributors" };

  const parsed = parsePlaceQuery(q);
  if (parsed) {
    let centre = (await nominatim(`q=${encodeURIComponent(where)}&format=jsonv2&limit=1&countrycodes=${cc}`))?.[0];
    if (!centre && areaName) centre = (await nominatim(`q=${encodeURIComponent(cityLabel)}&format=jsonv2&limit=1&countrycodes=${cc}`))?.[0];
    if (centre) {
      const lat = Number(centre.lat), lon = Number(centre.lon);
      try {
        // An area gets a walkable radius first; a whole city starts wider. Widen once if it's thin,
        // unless the first answer was slow: the visitor is watching this run live.
        const radii = areaName ? [2500, 5000] : [5000, 9000];
        const started = Date.now();
        let found = [];
        for (const radius of radii) {
          found = pickBest((await overpass(overpassQuery(parsed.exact, parsed.narrow, lat, lon, radius)))?.elements || [], lat, lon);
          if (found.length >= 3 || Date.now() - started > 6000) break;
        }
        if (found.length) return { ...base, places: found, summary: `${found.length} ${parsed.label}${found.length === 1 ? "" : "s"} near ${areaName || cityLabel}` };
        if (parsed.related.length) {
          const near = pickBest((await overpass(overpassQuery(parsed.related, [], lat, lon, radii[1])))?.elements || [], lat, lon);
          if (near.length) {
            return { ...base, places: near, related: true,
              summary: `No ${parsed.label}s listed; ${near.length} ${parsed.relatedLabel}${near.length === 1 ? "" : "s"} nearby`,
              note: `OpenStreetMap lists no ${parsed.label}s near ${areaName || cityLabel}. These are the nearest ${parsed.relatedLabel}s, which can often recommend one.`,
              for_agent: `These are not ${parsed.label}s. Say no ${parsed.label}s are listed and offer these as places that may know one.` };
          }
        }
        return { ...base, places: [], summary: `No ${parsed.label}s listed near ${areaName || cityLabel}`, note: `OpenStreetMap lists no ${parsed.label}s near ${areaName || cityLabel}. A local app or a neighbour may know one.` };
      } catch (e) {
        console.error(JSON.stringify({ at: "live.places.overpass", error: String(e?.message || e) }));
        // Fall through to Nominatim's text search below, which can't filter by diet or trade.
      }
    }
  }

  const word = parsed ? (KINDS.find(([, l]) => parsed.label.endsWith(l))?.[1] ?? q) : q;
  const rows = await nominatim(`q=${encodeURIComponent(`${word} in ${where}`)}&format=jsonv2&limit=8&extratags=1&countrycodes=${cc}`);
  const found = (Array.isArray(rows) ? rows : []).filter((r) => r.name).slice(0, 4).map((r) => {
    const t = r.extratags || {};
    const parts = String(r.display_name || "").split(", ");
    return {
      name: r.name, kind: String(r.type || "").replace(/_/g, " "),
      address: parts.slice(1, 4).join(", "),
      phone: firstPhone(t.phone || t["contact:phone"] || t.mobile || t["contact:mobile"]),
      website: t.website || t["contact:website"] || "",
      opening_hours: t.opening_hours || "",
      map: `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}`,
    };
  });
  const narrowed = parsed && parsed.label !== word;
  return { ...base, places: found,
    summary: found.length ? `${found.length} ${word}${found.length === 1 ? "" : "s"} near ${areaName || cityLabel}` : `No ${parsed?.label || q} listed near ${areaName || cityLabel}`,
    note: !found.length ? "OpenStreetMap has no listed match nearby. A local app or a neighbour may know one." : narrowed ? `Couldn't check which are ${parsed.label}s just now; these are ${word}s nearby.` : undefined,
    for_agent: narrowed && found.length ? `These are not filtered for "${parsed.label}". Say so.` : undefined };
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
