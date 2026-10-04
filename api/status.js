// GET /api/status → which live sources are connected, for the page's "What's connected" panel.

import { flightConfigured } from "../lib/live.js";

export default function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=60");
  res.end(JSON.stringify({ live: { weather: true, places: true, fx: true, flight: flightConfigured() } }));
}
