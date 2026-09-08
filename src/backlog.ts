/**
 * The curated queue: config/backlog.json.
 *
 * { actions: Action[], shippedWatch: { [pageUrl]: note } }
 *
 * Why this is hot-reloaded: a static import binds once for the life of the
 * process. Everything in data.ts is re-read from disk per call, so a
 * long-lived reader (the stdio MCP server, spawned once by its client and
 * left running for days) would look healthy — fresh probes, fresh GSC —
 * while serving a queue frozen at startup. Re-reading on change keeps the
 * dashboard and the MCP server honest.
 *
 * watchFile (stat polling) rather than watch (inode): editors save by
 * writing a new file and renaming over the old one, which detaches an inode
 * watcher after the first edit. persistent:false so this never holds a CLI
 * open.
 */
import fs from "node:fs";
import path from "node:path";
import { INSTANCE } from "./config.js";

export type Effort = "S" | "M" | "L";

export interface Action {
  id: string;
  host: string;
  title: string;
  /** what kind of work this is — "New page", "Meta/template change", "Content rewrite", … */
  kind: string;
  /** the data making the case — numbers included */
  why: string;
  /** the concrete move */
  how: string;
  /** full spec, shown in the detail modal: URL, outline, schema, links, success metric */
  spec: string[];
  /** estimated organic clicks/month gained — for ORDERING, not a forecast */
  impact: number;
  effort: Effort;
  tag: string;
  /** set when a fix already shipped and the data is being watched */
  watching?: string;
  /** rule = derived from data each request; backlog = curated in config/backlog.json */
  source?: "rule" | "backlog" | "proposal";
}

interface BacklogFile {
  _comment?: string;
  actions: Action[];
  shippedWatch: Record<string, string>;
}

export const BACKLOG_PATH = path.join(INSTANCE, "config", "backlog.json");
const PROPOSALS_PATH = path.join(INSTANCE, "data", "opportunity-proposals.json");

export const slug = (s: string) =>
  s.toLowerCase().replace(/https?:\/\//, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

const EMPTY: BacklogFile = { actions: [], shippedWatch: {} };

const EFFORTS = new Set<Effort>(["S", "M", "L"]);

/** config/backlog.json is edited by hand — that is the documented workflow —
 *  so it is untrusted input. An effort outside S|M|L used to give the whole
 *  queue a NaN comparator (score = impact / weight), and V8 then leaves the
 *  order of every other card arbitrary. Coerce here, the same way
 *  acceptProposal() already does on the write path. */
function readBacklog(): BacklogFile {
  const raw = JSON.parse(fs.readFileSync(BACKLOG_PATH, "utf8")) as Partial<BacklogFile>;
  const seen = new Map<string, number>();
  const actions = (raw.actions ?? []).map((a) => {
    const impact = Number(a.impact);
    const base = a.id || slug(`${a.host}-${a.title}`);
    // slug() truncates at 80 chars, so two long titles can collide; a shared
    // id would make retire() delete both and setWatching() annotate whichever
    // came first. Suffix duplicates so every id addresses exactly one card.
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return {
      ...a,
      id: n === 1 ? base : `${base}-${n}`,
      spec: a.spec ?? [],
      impact: Number.isFinite(impact) ? impact : 0,
      effort: EFFORTS.has(a.effort) ? a.effort : ("M" as Effort),
      source: "backlog" as const,
    };
  });
  return { _comment: raw._comment, actions, shippedWatch: raw.shippedWatch ?? {} };
}

let current: BacklogFile = EMPTY;
let loadedMtime = 0;

function reload(): void {
  try {
    current = readBacklog();
    loadedMtime = fs.statSync(BACKLOG_PATH).mtimeMs;
  } catch (err) {
    // A missing file is the normal state of an instance before its first
    // curated item; only a real problem (a syntax error mid-edit) is worth
    // reporting, and it must not take down the dashboard or the MCP server.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") current = EMPTY;
    else console.error("[backlog] keeping the last good queue:", (err as Error).message);
  }
}
reload();

try {
  fs.watchFile(BACKLOG_PATH, { interval: 2000, persistent: false }, (curr, prev) => {
    if (curr.mtimeMs !== prev.mtimeMs) reload();
  });
} catch {
  // A watch-less environment still gets the startup snapshot.
}

/** Cheap staleness guard for callers between poll ticks (e.g. right after a write). */
function ensureFresh(): void {
  try {
    if (fs.statSync(BACKLOG_PATH).mtimeMs !== loadedMtime) reload();
  } catch {
    /* file missing: keep last good */
  }
}

export function BACKLOG(): Action[] {
  ensureFresh();
  return current.actions;
}

export function SHIPPED_WATCH(): Record<string, string> {
  ensureFresh();
  return current.shippedWatch;
}

// ---------- writes (the dashboard's accept / watch / retire buttons) ----------

function write(file: BacklogFile): void {
  const out = {
    ...(file._comment ? { _comment: file._comment } : {}),
    actions: file.actions.map(({ source: _s, ...a }) => a),
    shippedWatch: file.shippedWatch,
  };
  fs.writeFileSync(BACKLOG_PATH, JSON.stringify(out, null, 2) + "\n");
  reload();
}

/** Move proposal #index from data/opportunity-proposals.json into the queue. */
export function acceptProposal(index: number): Action | null {
  let scan: { proposals?: Omit<Action, "id">[] } & Record<string, unknown>;
  try {
    scan = JSON.parse(fs.readFileSync(PROPOSALS_PATH, "utf8"));
  } catch {
    return null;
  }
  const proposals = scan.proposals ?? [];
  const p = proposals[index];
  if (!p) return null;
  const file = readBacklog();
  const base = slug(`${p.host}-${p.title}`);
  let id = base;
  for (let n = 2; file.actions.some((a) => a.id === id); n++) id = `${base}-${n}`;
  const action: Action = {
    id,
    host: p.host,
    title: p.title,
    kind: p.kind || "Proposed by the opportunity scan",
    why: p.why || "",
    how: p.how || "",
    spec: p.spec ?? [],
    impact: Number(p.impact) || 0,
    effort: (["S", "M", "L"].includes(String(p.effort)) ? p.effort : "M") as Effort,
    tag: p.tag || "content",
  };
  file.actions.push(action);
  write(file);
  proposals.splice(index, 1);
  fs.writeFileSync(PROPOSALS_PATH, JSON.stringify({ ...scan, proposals }, null, 1) + "\n");
  return action;
}

export function setWatching(id: string, note: string): boolean {
  const file = readBacklog();
  const a = file.actions.find((x) => x.id === id);
  if (!a) return false;
  const stamp = new Date().toISOString().slice(0, 10);
  a.watching = note.trim() ? `${stamp}: ${note.trim()}` : `${stamp}: shipped — watching the data`;
  write(file);
  return true;
}

export function retire(id: string): boolean {
  const file = readBacklog();
  const before = file.actions.length;
  file.actions = file.actions.filter((x) => x.id !== id);
  if (file.actions.length === before) return false;
  write(file);
  return true;
}
