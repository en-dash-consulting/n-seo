/** The dashboard's view of the update check: from the file, never the network. */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeSandbox, type Sandbox } from "./sandbox.ts";

describe("updateCheck()", () => {
  let sb: Sandbox;
  let data: any;
  let version: string;

  before(async () => {
    sb = makeSandbox({ data: false });
    data = await sb.mod("data.ts");
    version = (await sb.mod("config.ts")).ENGINE_VERSION;
  });
  after(() => sb.cleanup());

  const write = (v: Record<string, unknown> | null) => {
    const f = path.join(sb.root, "data", "update-check.json");
    if (v === null) { fs.rmSync(f, { force: true }); return; }
    fs.writeFileSync(f, JSON.stringify(v));
  };

  test("null with no file, and with a file that names no version", () => {
    write(null);
    assert.equal(data.updateCheck(), null);
    write({ checked: "2026-01-01T00:00Z" });
    assert.equal(data.updateCheck(), null);
  });

  test("a newer published version is reported as newer", () => {
    write({ checked: "x", current: "0.0.1", latest: "999.0.0", newer: false, notes: "n" });
    const u = data.updateCheck();
    assert.equal(u.newer, true, "999.0.0 is newer than any engine version");
    assert.equal(u.latest, "999.0.0");
    assert.equal(u.notes, "n");
  });

  test("the running engine wins over the version recorded in the file", () => {
    // Upgrading does not rewrite this file — only the next daily run does —
    // so a stale `current` would advertise an update already installed.
    write({ checked: "x", current: "0.0.1", latest: version, newer: true, notes: "n" });
    const u = data.updateCheck();
    assert.equal(u.newer, false, "an already-installed version must not be advertised");
    assert.equal(u.current, version, "current comes from the engine, not the file");
  });

  test("an older published version is not an update", () => {
    write({ checked: "x", current: "9.9.9", latest: "0.0.1", newer: true, notes: "" });
    assert.equal(data.updateCheck().newer, false);
  });

  test("a latest that is not a release version is never newer", () => {
    write({ checked: "x", current: "0.1.0", latest: "nightly", newer: true, notes: "" });
    assert.equal(data.updateCheck().newer, false);
  });

  test("ordering is numeric, not lexical", () => {
    // Derived from whatever this engine is, so the assertion cannot rot when
    // the version moves. Adding 10 to the minor is deliberately a lexical
    // trap: against an 0.3.x engine that is "0.13.0", and "0.13.0" < "0.3.3"
    // when compared as strings while being plainly newer as a version.
    const [maj, min, pat] = version.split(".").map(Number);
    write({ checked: "x", current: "x", latest: `${maj}.${min + 10}.0`, newer: false, notes: "" });
    assert.equal(data.updateCheck().newer, true, `${maj}.${min + 10}.0 is newer than ${version}`);

    write({ checked: "x", current: "x", latest: `${maj}.${min}.${pat}`, newer: true, notes: "" });
    assert.equal(data.updateCheck().newer, false, "the same version is not an update");
  });
});
