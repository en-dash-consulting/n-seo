/** Resolved rules as JSON, for the loader-parity test in profiles.test.ts. */
import { config } from "../../src/config.js";
const c = config();
console.log(JSON.stringify({ rules: c.rules, operatingRules: c.operatingRules }));
