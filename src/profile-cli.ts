/** `n-seo profile` — what method is running, and where you depart from it. */
import { profileReport, builtinProfiles } from "./profile-report.js";

const r = profileReport();
const built = builtinProfiles();

console.log(`profile   ${r.name}${r.version ? ` ${r.version}` : ""}${r.spec ? "" : "  (no profile set)"}`);
if (r.spec) console.log(`spec      ${r.spec}`);
if (r.dir) console.log(`from      ${r.dir}`);
if (r.description) {
  console.log("");
  for (const line of r.description.match(/.{1,72}(\s|$)/g) ?? []) console.log(`  ${line.trim()}`);
}

console.log("");
if (r.departures.length === 0) {
  console.log(r.spec
    ? "this instance changes nothing — it runs the profile as published"
    : "this instance changes nothing — it runs the engine defaults");
} else {
  console.log(`this instance overrides ${r.departures.length} value(s):\n`);
  const w = Math.max(...r.departures.map((d) => d.key.length));
  for (const d of r.departures) {
    console.log(`  ${d.key.padEnd(w)}  ${JSON.stringify(d.inherited)} → ${JSON.stringify(d.instance)}`);
  }
}

if (built.length) {
  console.log(`\nshipped with this engine:`);
  const w = Math.max(...built.map((b) => b.spec.length));
  for (const b of built) console.log(`  ${b.spec.padEnd(w)}  ${b.name}`);
  console.log(`\nset one with "profile": "<name>" in n-seo.config.json, or point it at`);
  console.log(`a directory or an installed package. See docs/PROFILES.md.`);
}
