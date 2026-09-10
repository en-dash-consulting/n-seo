/** Settings page: the module switchboard and the few config fields worth a
 *  form. Sites are edited in the JSON file (they need care: property ids,
 *  brand regexes) — the page shows them and says where to go. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FC } from "hono/jsx";
import { CONFIG_PATH, MODULE_INFO, config, saveConfig, USING_EXAMPLE_CONFIG, loadConfig, engineInfo } from "./config.js";
import * as data from "./data.js";

const expand = (p: string) => (p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);

function serviceAccountEmail(keyPath?: string): { email?: string; exists: boolean; path?: string } {
  const p = keyPath || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!p) return { exists: false };
  const full = expand(p);
  try {
    // Read only the public identity — never the private key.
    const j = JSON.parse(fs.readFileSync(full, "utf8")) as { client_email?: string };
    return { email: j.client_email, exists: true, path: full };
  } catch {
    return { exists: false, path: full };
  }
}

const lines = (v: unknown) => (Array.isArray(v) ? v : []).map((t) => (Array.isArray(t) ? t.join(" | ") : String(t))).join("\n");

export const SettingsPage: FC<{ saved?: boolean; error?: string }> = ({ saved, error }) => {
  loadConfig();
  const cfg = config();
  const sa = serviceAccountEmail(cfg.google.serviceAccountKey);
  const lr = data.lastRun();
  const eng = engineInfo();
  const hookCount = cfg.hooks.beforeRun.length + cfg.hooks.afterRun.length + Object.values(cfg.hooks.afterStep).reduce((n, l) => n + l.length, 0);
  const str = (v: unknown) => (v == null ? "" : String(v));
  return (
    <>
      <div class="strip-head">
        <h1>Settings</h1>
        <div class="chip-row">
          {saved && <span class="chip good">saved</span>}
          {error && <span class="chip bad">{error}</span>}
          <span class="chip mono" title="config file">{USING_EXAMPLE_CONFIG ? "example config (not saved yet)" : CONFIG_PATH}</span>
        </div>
      </div>
      <p class="sub">
        Everything runs from one file: <code>{CONFIG_PATH}</code>. This page edits the module switches and the free-text
        fields; sites and Google auth are edited in the file itself (they need care). {USING_EXAMPLE_CONFIG && <b>Saving this form creates the file from the example.</b>}
      </p>

      <h2>Engine <small>— what is running, and where</small></h2>
      <div class="settings-grid">
        <div class="s-card">
          <div class="s-title">n-seo {eng.version}{eng.commit ? ` · ${eng.commit}` : ""}</div>
          <p class="sub"><span class={`chip ${eng.mode === "instance" ? "good" : ""}`}>{eng.mode}</span> {eng.mode === "instance"
            ? "the engine and this instance live in separate directories; upgrading the engine does not touch your config, queue or data."
            : "config, queue and data live inside the engine checkout. Fine for one person; see docs/INSTANCE.md to split them."}</p>
        </div>
        <div class="s-card">
          <div class="s-title">Engine path</div>
          <div class="mono">{eng.root}</div>
          <p class="sub">Upgrade: <code>n-seo upgrade</code> (git engine) or <code>npm update n-seo</code> (npm engine).</p>
        </div>
        <div class="s-card">
          <div class="s-title">Instance path</div>
          <div class="mono">{eng.instance}</div>
          <p class="sub">{hookCount ? `${hookCount} hook command(s) configured` : "no hooks configured"} — <code>hooks</code> in the config file runs your own commands around the daily run.</p>
          {hookCount > 0 && (
            <ul class="spec">
              {cfg.hooks.beforeRun.map((c) => <li><span class="chip">before run</span> <code>{c}</code></li>)}
              {Object.entries(cfg.hooks.afterStep).flatMap(([step, cmds]) => cmds.map((c) => <li><span class="chip">after {step}</span> <code>{c}</code></li>))}
              {cfg.hooks.afterRun.map((c) => <li><span class="chip">after run</span> <code>{c}</code></li>)}
            </ul>
          )}
        </div>
      </div>

      <h2>Sites <small>— edit <code>sites[]</code> in the config file</small></h2>
      {cfg.sites.length ? (
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>host</th><th>Search Console property</th><th>GA4 property</th><th>brand regex</th><th>hosting</th><th>repo</th></tr></thead>
            <tbody>
              {cfg.sites.map((s) => (
                <tr>
                  <td class="mono">{s.host}{s.gscHost !== s.host && <span class="chip"> pages on {s.gscHost}</span>}</td>
                  <td class="mono">{s.gscProperty ?? <span class="bad-text">none</span>}</td>
                  <td class="mono">{s.ga4Property ?? <span class="muted">none</span>}</td>
                  <td class="mono">{s.brand ?? "—"}</td>
                  <td>{s.hosting ?? "—"}</td>
                  <td class="mono">{s.repo ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p class="empty">No sites yet.</p>
      )}
      <p class="sub">Each site needs at least <code>host</code> and <code>gscProperty</code> (<code>sc-domain:example.com</code> or <code>https://www.example.com/</code>). Add <code>ga4Property</code> (the numeric id from GA4 Admin → Property details) for sessions, landing pages and AI-referral tracking, and <code>brand</code> (a regex) so the trend analysis can split branded from generic demand. See docs/SETUP-GOOGLE.md.</p>

      <h2>Google access <small>— edit <code>google</code> in the config file</small></h2>
      <div class="settings-grid">
        <div class="s-card">
          <div class="s-title">Mode</div>
          <div class="mono">{cfg.google.auth}</div>
          <p class="sub">{cfg.google.auth === "service-account-key"
            ? "A service-account JSON key. The JWT is signed locally with node's crypto module — no gcloud, no openssl, nothing to install."
            : cfg.google.auth === "metadata"
              ? "The runtime service account from the GCE / Cloud Run / GKE metadata server — no key file. It mints its own scoped tokens, which needs Token Creator on itself."
              : cfg.google.auth === "gcloud-impersonate"
                ? `gcloud impersonates ${cfg.google.impersonate || "(impersonate not set)"} — your login needs Token Creator on it.`
                : "gcloud user login — only works if that login already carries the Search Console / Analytics scopes."}</p>
        </div>
        {cfg.google.auth === "service-account-key" && (
          <div class="s-card">
            <div class="s-title">Key file</div>
            <div class="mono">{sa.path ?? "(not set)"}</div>
            <p class="sub">{sa.exists ? <span class="chip good">found</span> : <span class="chip bad">not found</span>}</p>
          </div>
        )}
        <div class="s-card">
          <div class="s-title">Grant access to</div>
          <div class="mono">{sa.email ?? cfg.google.impersonate ?? (cfg.google.auth === "metadata" ? "the runtime service account" : "—")}</div>
          <p class="sub">Add this email as a <b>Full</b> user on each Search Console property and a <b>Viewer</b> on each GA4 property. Then <code>n-seo doctor</code> confirms it can see them.</p>
        </div>
      </div>

      <form method="post" action="/settings">
        <h2>Modules <small>— everything below is opt-in; nothing posts, sends or publishes for you</small></h2>
        <div class="settings-grid">
          {MODULE_INFO.map((m) => {
            const mod = cfg.modules[m.key] ?? { enabled: false };
            return (
              <div class={`s-card ${mod.enabled ? "s-on" : ""}`}>
                <label class="s-toggle">
                  <input type="checkbox" name={`module.${m.key}`} value="1" checked={!!mod.enabled} />
                  <span class="s-title">{m.title}</span>
                </label>
                <p class="sub">{m.blurb}</p>
                {m.needs && <p class="s-needs">needs: {m.needs}</p>}
                {m.key === "llm" && (
                  <>
                    <label class="s-field">command <input type="text" name="llm.command" value={str(mod.command)} placeholder="claude -p --model sonnet" /></label>
                    <label class="s-field">fast command <input type="text" name="llm.fastCommand" value={str(mod.fastCommand)} placeholder="claude -p --model haiku" /></label>
                    <p class="s-help">Any CLI that reads the prompt on stdin and prints the reply: <code>claude -p</code>, <code>llm</code>, <code>ollama run llama3</code>.</p>
                    {(() => {
                      // A server has no CLI signed in, so it uses the http
                      // block instead. Edited in the config file, shown here
                      // so it is obvious which path is actually live.
                      const h = mod.http as Record<string, unknown> | undefined;
                      if (!h || typeof h !== "object" || !h.provider) return null;
                      return (
                        <p class="s-help">
                          <b>http overrides the command</b> when its key resolves: {str(h.provider)} · {str(h.model)}
                          {h.fastModel ? ` (fast: ${str(h.fastModel)})` : ""} · key from <code>{str(h.apiKeyEnv)}</code>
                        </p>
                      );
                    })()}
                  </>
                )}
                {m.key === "hackerNews" && (
                  <>
                    <label class="s-field">HN username <input type="text" name="hackerNews.user" value={str(mod.user)} /></label>
                    <label class="s-field">topics <small>one per line: <code>query | why you can speak to this</code></small>
                      <textarea name="hackerNews.topics" rows={4}>{lines(mod.topics)}</textarea>
                    </label>
                  </>
                )}
                {m.key === "reddit" && (
                  <>
                    <label class="s-field">Reddit username <input type="text" name="reddit.user" value={str(mod.user)} /></label>
                    <label class="s-field">topics <small>one per line: <code>subreddit | search query | why</code></small>
                      <textarea name="reddit.topics" rows={4}>{lines(mod.topics)}</textarea>
                    </label>
                  </>
                )}
                {m.key === "indexNow" && (
                  <label class="s-field">key file <input type="text" name="indexNow.keyFile" value={str(mod.keyFile) || "indexnow.key"} /></label>
                )}
                {m.key === "staticExport" && (
                  <>
                    <label class="s-field">sign-out URL <small>added to every exported page when the mirror sits behind an auth proxy</small>
                      <input type="text" name="staticExport.signOutUrl" value={str(mod.signOutUrl)} placeholder="/oauth2/sign_out" />
                    </label>
                    <label class="s-field">sign-out label <input type="text" name="staticExport.signOutLabel" value={str(mod.signOutLabel) || "Sign out"} /></label>
                  </>
                )}
                {m.key === "publish" && (
                  <>
                    <label class="s-field">target
                      <select name="publish.target">
                        {["gcs", "s3", "rsync", "command"].map((t) => (
                          <option value={t} selected={str(mod.target) === t}>{t}</option>
                        ))}
                      </select>
                    </label>
                    <label class="s-field">destination <input type="text" name="publish.destination" value={str(mod.destination)} placeholder="gs://your-bucket" /></label>
                    <label class="s-check"><input type="checkbox" name="publish.delete" value="1" checked={!!mod.delete} /> delete what is no longer in the export</label>
                    <label class="s-check"><input type="checkbox" name="publish.dryRun" value="1" checked={!!mod.dryRun} /> dry run — print the command, publish nothing</label>
                    {str(mod.command) && (
                      <p class="s-help"><b>command</b> (target <code>command</code>, edited in the config file): <code>{str(mod.command)}</code></p>
                    )}
                    {(() => {
                      // Names only: a publish env is where credential paths live.
                      const keys = Object.keys((mod.env as Record<string, unknown>) ?? {});
                      return keys.length
                        ? <p class="s-help">extra environment for the publish command: <code>{keys.join(", ")}</code> <small>(values are edited in the config file and never shown here)</small></p>
                        : null;
                    })()}
                  </>
                )}
              </div>
            );
          })}
        </div>

        <h2>You <small>— context for briefings</small></h2>
        <div class="s-card s-wide">
          <label class="s-field">expertise <small>who you are and what you genuinely know first-hand; the only context the digest briefings get</small>
            <textarea name="participation.expertise" rows={4}>{cfg.participation?.expertise ?? ""}</textarea>
          </label>
        </div>

        <h2>Watch pages <small>— reported in the daily log every day</small></h2>
        <div class="s-card s-wide">
          <label class="s-field">URLs <small>one per line — pages where you shipped something and want the numbers in front of you daily</small>
            <textarea name="watchPages" rows={4}>{cfg.watchPages.join("\n")}</textarea>
          </label>
        </div>

        <h2>Conversions <small>— the goal the traffic serves</small></h2>
        <div class="s-card s-wide">
          <div class="s-row">
            <label class="s-field">site (host) <input type="text" name="conversions.site" value={cfg.conversions?.site ?? ""} placeholder="example.com" /></label>
            <label class="s-field">GA4 event names <small>comma-separated; the first is the primary</small><input type="text" name="conversions.events" value={(cfg.conversions?.events ?? []).join(", ")} placeholder="sign_up, newsletter_signup" /></label>
            <label class="s-field">source dimension <small>optional custom dimension</small><input type="text" name="conversions.sourceDimension" value={cfg.conversions?.sourceDimension ?? ""} placeholder="customEvent:source_app" /></label>
          </div>
          <p class="s-help">Register these as key events in GA4 Admin. Leave the site empty to hide the conversions panel.</p>
        </div>

        <div class="s-save">
          <button type="submit" class="btn">Save settings</button>
          <span class="sub">writes {CONFIG_PATH}</span>
        </div>
      </form>

      <h2>Status</h2>
      <div class="settings-grid">
        <div class="s-card">
          <div class="s-title">Last daily run</div>
          {lr ? (
            <>
              <div class="mono">{lr.ts}</div>
              <p class="sub">{lr.failures.trim() ? <span class="chip bad">failed: {lr.failures}</span> : <span class="chip good">all steps OK</span>}</p>
            </>
          ) : <p class="sub">never — run <code>n-seo daily</code></p>}
        </div>
        <div class="s-card">
          <div class="s-title">Data freshness</div>
          <table class="slim bare">
            {data.dataFreshness().map((f) => (
              <tr><td>{f.label}</td><td class="mono">{f.mtime}</td></tr>
            ))}
          </table>
        </div>
        <div class="s-card">
          <div class="s-title">This process</div>
          {(() => { const p = data.processFreshness(); return (
            <p class="sub">started {p.startedAt} · up {p.uptimeHours}h · queue file {p.queueMtime}</p>
          ); })()}
        </div>
      </div>
    </>
  );
};

/** Apply a posted settings form to the config file. Only the keys this page
 *  owns are touched; everything else in the JSON is preserved verbatim. */
export function applySettingsForm(body: Record<string, string | File | (string | File)[]>): void {
  const get = (k: string): string => {
    const v = body[k];
    return typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : "";
  };
  const splitLines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const topicLines = (s: string, parts: number, label: string) =>
    splitLines(s).map((l) => {
      const cols = l.split("|").map((x) => x.trim());
      if (cols.length < parts || cols.slice(0, parts).some((x) => !x)) {
        throw new Error(`${label}: each line needs ${parts} parts separated by | — "${l.slice(0, 40)}"`);
      }
      return cols.slice(0, parts);
    });

  saveConfig((raw) => {
    const modules = ((raw.modules as Record<string, Record<string, unknown>>) ??= {});
    for (const m of MODULE_INFO) {
      const cur = (modules[m.key] ??= {});
      cur.enabled = get(`module.${m.key}`) === "1";
    }
    modules.llm.command = get("llm.command") || "claude -p --model sonnet";
    modules.llm.fastCommand = get("llm.fastCommand") || modules.llm.command;
    modules.hackerNews.user = get("hackerNews.user");
    modules.hackerNews.topics = topicLines(get("hackerNews.topics"), 2, "Hacker News topics");
    modules.reddit.user = get("reddit.user");
    modules.reddit.topics = topicLines(get("reddit.topics"), 3, "Reddit topics");
    modules.indexNow.keyFile = get("indexNow.keyFile") || "indexnow.key";
    modules.staticExport.signOutUrl = get("staticExport.signOutUrl").trim();
    modules.staticExport.signOutLabel = get("staticExport.signOutLabel").trim() || "Sign out";
    // `command` and `env` are deliberately not settable here: one runs a
    // shell string, the other holds credential paths. Both live in the file.
    const target = get("publish.target").trim();
    modules.publish.target = ["gcs", "s3", "rsync", "command"].includes(target) ? target : "gcs";
    modules.publish.destination = get("publish.destination").trim();
    modules.publish.delete = get("publish.delete") === "1";
    modules.publish.dryRun = get("publish.dryRun") === "1";

    const participation = ((raw.participation as Record<string, unknown>) ??= {});
    participation.expertise = get("participation.expertise");

    raw.watchPages = splitLines(get("watchPages"));

    const site = get("conversions.site").trim();
    const conv = ((raw.conversions as Record<string, unknown>) ??= {});
    conv.site = site;
    conv.events = get("conversions.events").split(",").map((e) => e.trim()).filter(Boolean);
    conv.sourceDimension = get("conversions.sourceDimension").trim();
  });
}
