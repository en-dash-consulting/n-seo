/** Profiles in the TypeScript loader, and the parity that matters.
 *
 * The engine ranks by these numbers; Python states them in the daily log and
 * the digests. If the two loaders disagree, the dashboard and the log tell a
 * different story about the same morning. */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { makeSandbox, REPO, type Sandbox } from "./sandbox.ts";

describe("profiles", () => {
  let sb: Sandbox;
  before(() => {
    sb = makeSandbox({ data: false });
    // The sandbox copies src/ but not profiles/; the built-ins resolve from
    // the sandbox's own ROOT, so they have to come along.
    fs.cpSync(path.join(REPO, "profiles"), path.join(sb.root, "profiles"), { recursive: true });
  });
  after(() => sb.cleanup());

  // config() re-reads the file on every call — it is a live view so a hand
  // edit shows up without a restart — so one import is enough and each case
  // just rewrites the file first.
  let cfgMod: any;
  const loadWith = async (cfg: Record<string, unknown>) => {
    sb.write("n-seo.config.json", JSON.stringify({ name: "t", sites: [], ...cfg }));
    cfgMod = cfgMod ?? (await sb.mod("config.ts"));
    return cfgMod.config();
  };

  test("no profile gives the engine defaults", async () => {
    const c = await loadWith({});
    assert.equal(c.profile, undefined);
    assert.equal(c.rules.strikingDistance.minPosition, 5);
    assert.equal(c.operatingRules.titleFreezeDays, 28);
  });

  test("a profile sets what it declares and inherits the rest", async () => {
    const c = await loadWith({ profile: "patient" });
    assert.equal(c.operatingRules.titleFreezeDays, 56, "patient sets this");
    assert.equal(c.operatingRules.decisionWindowDays, 90, "patient does not; inherited");
    assert.equal(c.rules.strikingDistance.minImpressions, 40);
    assert.equal(c.rules.strikingDistance.minPosition, 5, "inherited from the engine");
  });

  test("the instance always wins over the profile", async () => {
    const c = await loadWith({
      profile: "aggressive",
      rules: { strikingDistance: { maxRows: 2 } },
    });
    assert.equal(c.rules.strikingDistance.maxRows, 2, "the instance override");
    assert.equal(c.rules.strikingDistance.maxPosition, 20, "still the profile's");
  });

  test("an unresolvable profile throws rather than falling back", async () => {
    // Silence here would be the dangerous outcome: a client's instance
    // quietly running our defaults while claiming to run their agency's.
    await assert.rejects(
      async () => await loadWith({ profile: "n-seo-profile-nope" }),
      /could not be resolved/,
    );
  });

  test("both loaders agree, on every shipped profile", () => {
    // The real guard. Run each built-in through TypeScript and Python and
    // compare the resolved numbers.
    const specs = fs.readdirSync(path.join(REPO, "profiles"));
    assert.ok(specs.length >= 2, "expected several built-in profiles");
    for (const spec of specs) {
      const inst = fs.mkdtempSync(path.join(sb.root, `parity-${spec}-`));
      fs.writeFileSync(path.join(inst, "n-seo.config.json"),
        JSON.stringify({ name: "t", sites: [], profile: spec }));

      const ts = spawnSync(process.execPath, [
        path.join(REPO, "node_modules/tsx/dist/cli.mjs"), path.join(REPO, "tests/ts/_dump-config.ts"),
      ], { cwd: REPO, env: { ...process.env, N_SEO_INSTANCE: inst }, encoding: "utf8" });
      const py = spawnSync("python3", ["-c",
        "import sys,json;sys.path.insert(0,r'" + path.join(REPO, "ingest") + "');import seo_config;" +
        "c=seo_config.load();print(json.dumps({'rules':c['rules'],'operatingRules':c['operatingRules']},sort_keys=True))",
      ], { env: { ...process.env, N_SEO_INSTANCE: inst }, encoding: "utf8" });

      assert.equal(ts.status, 0, `tsx failed for ${spec}: ${ts.stderr}`);
      assert.equal(py.status, 0, `python failed for ${spec}: ${py.stderr}`);
      assert.deepEqual(
        JSON.parse(ts.stdout.trim()),
        JSON.parse(py.stdout.trim()),
        `${spec}: the two loaders resolved different numbers`,
      );
    }
  });
});
