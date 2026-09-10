#!/usr/bin/env node
/* Run a Python script with whichever interpreter this machine actually has.
 *
 * The npm scripts used to hardcode `python3`, which does not exist on
 * Windows: Python installs there as `python`, or only behind the `py`
 * launcher. Worse, Windows ships an App Execution Alias at `python3.exe`
 * that opens the Microsoft Store instead of running anything, so a hardcoded
 * `python3` fails in a way that looks like Python is missing when it is not.
 * Probing for one that answers `--version` is the only reliable answer.
 *
 *   node ops/py.mjs ops/doctor.py --offline
 *
 * $PYTHON overrides, which is also how the n-seo CLI behaves.
 */
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const CANDIDATES = process.platform === "win32"
  ? ["python", "python3", "py"]
  : ["python3", "python"];

export function pythonBin() {
  if (process.env.PYTHON) return process.env.PYTHON;
  for (const c of CANDIDATES) {
    const probe = spawnSync(c, ["--version"], { stdio: "ignore" });
    if (!probe.error && probe.status === 0) return c;
  }
  return CANDIDATES[0]; // let the real command fail with a useful message
}

// Only act as a launcher when invoked directly, not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const child = spawn(pythonBin(), process.argv.slice(2), { stdio: "inherit" });
  child.on("error", (err) => {
    console.error(`could not start ${pythonBin()}: ${err.message}`);
    console.error("install Python 3.10+, or set $PYTHON to its path");
    process.exit(127);
  });
  child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 1));
}
