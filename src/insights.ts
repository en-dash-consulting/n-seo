/** Optional hand-written marketer briefing: config/insights.json.
 *  Numbers render live from the latest data/trends-*.json; this file holds
 *  the interpretation. Re-read per request so edits show up immediately. */
import fs from "node:fs";
import path from "node:path";
import { INSTANCE } from "./config.js";

export interface Insight {
  title: string;
  verdict: "opportunity" | "warning" | "momentum" | "deprioritize";
  body: string[];
  move: string;
}

export function insights(): { date: string; insights: Insight[] } {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(INSTANCE, "config", "insights.json"), "utf8"));
    return { date: raw.date || "", insights: Array.isArray(raw.insights) ? raw.insights : [] };
  } catch {
    return { date: "", insights: [] };
  }
}
