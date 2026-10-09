import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "../env";
import { HttpError } from "../http";
import { RULES, vocabularyBlock, wrapBrief } from "./prompt";
import { FiltersInput, LlmOutput, LooseConstraint, TOOL_INPUT_SCHEMA, Unsupported, type Mode } from "./schema";
import { LLM_TIMEOUT_MS } from "./tuning";
import type { Vocab } from "./vocab";

// One schema-forced call: brief in, loose constraints out. No candidates are sent.
// Two providers share everything except the HTTP call: same rules, same
// vocabulary, same tool schema, same validation afterwards.

export interface Extraction {
  filters: FiltersInput;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; ms: number };
}

interface RawCall {
  toolInput: unknown;
  usage: Omit<Extraction["usage"], "ms">;
}

const TOOL_NAME = "emit_filters";
const TOOL_DESCRIPTION = "Return the structured filters for the brief.";

export async function extractFilters(brief: string, vocab: Vocab): Promise<Extraction> {
  const provider = serverEnv.provider();
  const started = Date.now();
  let raw: RawCall;
  const call = () => (provider === "gemini" ? callGemini(brief, vocab) : callAnthropic(brief, vocab));
  const transient = (e: unknown) => e instanceof Error && /\b(429|503|529)\b/.test(e.message);
  try {
    try {
      raw = await call();
    } catch (first) {
      // One quick retry for rate limits and overloads, only if the first try failed fast.
      // Timeouts are not retried: a second 2.5 s wait would blow the 3 s budget.
      if (!transient(first) || Date.now() - started > 1000) throw first;
      await new Promise((r) => setTimeout(r, 300));
      raw = await call();
    }
  } catch (e) {
    if (e instanceof HttpError) throw e; // e.g. missing API key: keep its own status
    console.error(`LLM call failed (${provider}):`, e instanceof Error ? `${e.name}: ${e.message}` : e);
    throw LLM_FAILED();
  }

  if (process.env.LLM_DEBUG) console.log(`LLM output (${provider}):`, JSON.stringify(raw.toolInput));
  const parsed = LlmOutput.safeParse(raw.toolInput ?? {});
  if (!parsed.success) {
    // Unreadable output must not become "no filters" (that would search everyone).
    console.warn("LLM output did not match the schema:", parsed.error.issues.slice(0, 3));
    throw LLM_FAILED();
  }
  const filters = toFilters(parsed.data.constraints, parsed.data.unsupported);
  const constraints = groundInBrief(brief, filters.constraints);
  const unsupported = [...filters.unsupported];
  // A brief carrying code or instructions is not a description of people. The model
  // handles most of these, but not always the same way, so the answer is fixed here:
  // a required "unsupported" item, which returns nobody and shows as a chip.
  if (looksLikeInjection(brief) && !unsupported.some((u) => u.mode === "required")) {
    console.warn("Brief contains code or instructions: answering with nobody");
    unsupported.unshift({ text: "the brief contains code or instructions", mode: "required" });
  }
  return { filters: { constraints, unsupported }, usage: { ...raw.usage, ms: Date.now() - started } };
}

const LLM_FAILED = () => new HttpError(502, "llm_failed", "We couldn't read that brief just now. Please try again.");

// Checking filters against the brief's own words -------------------------------------------------

const INJECTION = [
  /['"`)]\s*(or|and)\s+['"\d\w]+\s*=\s*['"\d\w]+/i, // ' OR 1=1
  /\b(drop|truncate|alter)\s+table\b/i,
  /\bunion\s+(all\s+)?select\b/i,
  /\b(delete\s+from|insert\s+into|update\s+\w+\s+set)\b/i,
  /['"`);]\s*--/, // quote or paren followed by a SQL comment
  /\b(ignore|disregard|forget)\b.{0,30}\b(instructions|rules|prompt)\b/i,
  /^\s*(system|assistant|developer)\s*:/i,
  /<\/?\s*(brief|system|instructions?|prompt)\b/i,
];
export const looksLikeInjection = (brief: string) => INJECTION.some((re) => re.test(brief));

// Lowercase words separated by single spaces; "/" kept as its own token ("React/Vue" -> "react / vue").
const norm = (s: string) => ` ${s.toLowerCase().replace(/\//g, " / ").replace(/[^a-z0-9+#/]+/g, " ").trim()} `;
const SOFTENERS = /\b(ideally|preferably|preferred|nice to have|bonus|a plus|plus if|would be great|if possible)\b/;
const DEGREE_WORDS = /\b(bachelor|bachelors|master|masters|phd|ph d|doctorate|doctoral|mba|degree|bs|ba|bsc|ms|msc|associate|undergrad|undergraduate|postgrad|postgraduate)\b/;
const STUDY_BEFORE = /\b(stud(y|ied|ying)|major(ed)?( in)?|degree in|background in|graduated in|specializ\w+ in|(phd|ph d|doctorate|masters?|master s|bachelors?|bachelor s|ms|msc|bs|bsc|ba|mba) in)\s*$/;
const SENIORITY_CUES = /\b(junior|jr|entry level|new grads?|mid level|mid career|intermediate|senior|sr|staff|principal|leads?|distinguished)\b/g;
const SENIORITY_OF = (w: string) =>
  /^(junior|jr|entry level|new grads?)$/.test(w) ? "junior"
  : /^(mid level|mid career|intermediate)$/.test(w) ? "mid"
  : /^(senior|sr)$/.test(w) ? "senior"
  : "staff_plus";
const STUDY_ANYWHERE = /\b(stud(y|ied|ying)|major(ed|s)?|degrees? in|background in|graduates? in|grads? in|phd in|masters? in|bachelors? in|ms in|bs in|cs grads?|cs degree)\b/;
const STUDY_AFTER = /^\s*(degree|major|graduate|grads?|background|phd|masters?|bachelors?)\b/;

/** Where the value appears in the brief (word-bounded), or [] when the model reworded it. */
function mentions(briefN: string, value: string): number[] {
  const v = norm(value);
  if (v.trim().length < 2) return [];
  const out: number[] = [];
  for (let i = briefN.indexOf(v); i !== -1; i = briefN.indexOf(v, i + 1)) out.push(i);
  return out;
}

/**
 * The model sometimes adds filters the brief never stated, or misses a softener.
 * These checks use only the recruiter's own words, so they hold for any brief.
 * Each only removes a filter the brief doesn't support, or softens one the brief
 * softened; none ever adds a filter. Exported for tests.
 */
export function groundInBrief(brief: string, constraints: LooseConstraint[]): LooseConstraint[] {
  const b = norm(brief);
  const drop = (c: LooseConstraint, why: string) => {
    console.warn(`Dropped ${c.mode} ${c.field}=${JSON.stringify(c.values ?? [c.min, c.max])}: ${why}`);
    return false;
  };

  // Clauses: split on commas, semicolons, "but" and "and ideally"-style joins.
  const clauses = brief.toLowerCase().split(/[,;]|\bbut\b|\bthough\b/).map(norm);

  // "Go and Kubernetes" sent as one constraint means "Go or Kubernetes" to the search.
  // Several skills in one constraint stay alternatives only when the brief puts "or"
  // (or "/") between them; otherwise each becomes its own constraint.
  const split = constraints.flatMap((c) => {
    if (c.field !== "skill" || (c.values?.length ?? 0) < 2 || c.mode === "excluded") return [c];
    const at = c.values!.map((v) => mentions(b, v)[0]).filter((i): i is number => i !== undefined);
    if (at.length < 2) return [c]; // reworded by the model: can't tell, keep as sent
    const between = b.slice(Math.min(...at), Math.max(...at) + 1);
    if (/\b(or|either)\b|\//.test(between)) return [c];
    // Split only an explicit list ("Go and Kubernetes", "React, TypeScript"). In "iOS engineers
    // who know Swift" the first word describes the job, so it stays as sent.
    const raw = brief.toLowerCase();
    const listed = c.values!.some((v, i) => c.values!.slice(i + 1).some((w) => {
      const a = v.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const z = w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`${a}\\s*(,|&|\\band\\b|\\bplus\\b)\\s*(\\w+\\s+){0,2}?${z}|${z}\\s*(,|&|\\band\\b|\\bplus\\b)\\s*(\\w+\\s+){0,2}?${a}`).test(raw);
    }));
    if (!listed) return [c];
    console.warn(`Split ${c.mode} skill=${JSON.stringify(c.values)}: brief lists them as all needed`);
    return c.values!.map((v) => ({ ...c, values: [v], variants: undefined }));
  });

  let out = split.map((c) => {
    // "..., ideally with AWS": a value inside a softened clause is preferred, not required.
    // Only words after the softener count: in "React engineers ideally in Boston" React stays required.
    if (c.mode === "required" && c.values?.length) {
      const softened = clauses.some((cl) => {
        const at = cl.search(SOFTENERS);
        return at !== -1 && c.values!.some((v) => mentions(cl, v).some((i) => i > at));
      });
      if (softened) return { ...c, mode: "preferred" as const };
    }
    return c;
  });

  // "8+ years" sometimes comes back with an invented max (8 to 10). Keep a max only when
  // the brief has upper-bound wording; a min only when it has lower-bound wording or a bare number.
  out = out.map((c) => {
    if (c.field !== "years") return c;
    const raw = brief.toLowerCase();
    const range = /\d+\s*(-|–|to)\s*\d+/.test(raw) || /\bbetween\b/.test(raw);
    const upper = range || /\b(under|below|less than|fewer than|at most|up to|no more than|maximum|max|or less|or fewer)\b/.test(raw);
    const next = { ...c };
    if (next.max !== undefined && !upper) {
      console.warn(`Dropped years max ${next.max}: brief states no upper bound`);
      delete next.max;
    }
    if (next.min !== undefined && upper && !range && !/\d+\s*\+|\b(at least|over|more than|minimum|min|or more)\b/.test(raw)) {
      console.warn(`Dropped years min ${next.min}: brief states only an upper bound`);
      delete next.min;
    }
    return next;
  });

  // Seniority must come from the brief's words. "2-4 yrs" is not "mid-level"; "tech leads"
  // is staff-level. Bare "graduate(s)" is a school word, so it is not a seniority cue.
  const cues = [...b.matchAll(SENIORITY_CUES)].map((m) => SENIORITY_OF(m[0].trim()));
  const levels = [...new Set(cues)];
  if (!levels.length) {
    out = out.filter((c) => (c.field === "seniority" ? drop(c, "brief states no seniority") : true));
  } else if (levels.length === 1 && !out.some((c) => c.field === "seniority" || c.field === "title") && !SOFTENERS.test(b)) {
    console.warn(`Added seniority ${levels[0]}: brief says so but the model gave none`);
    out = [...out, { field: "seniority", mode: "required", values: [levels[0]] }];
  }

  out = out.filter((c) => {
    // A years constraint with no bounds left would match everyone: drop it.
    if (c.field === "years" && c.min === undefined && c.max === undefined) return drop(c, "no bounds left");
    // A degree level needs a degree in the brief: "graduated from MIT" names no level.
    if (c.field === "education_level" && !DEGREE_WORDS.test(b)) return drop(c, "brief names no degree");

    // A field of study needs study wording next to it: in "machine learning engineers"
    // the words describe a job, not a subject. Values the model reworded are kept.
    if (c.field === "field_of_study" && c.values?.length) {
      const seen = c.values.flatMap((v) => mentions(b, v).map((i) => ({ i, len: norm(v).length })));
      const studied = seen.some(({ i, len }) => STUDY_BEFORE.test(b.slice(Math.max(0, i - 40), i + 1)) || STUDY_AFTER.test(b.slice(i + len - 1)));
      if (seen.length && !studied) return drop(c, "subject appears only as a job description");
      // Reworded by the model ("designers" -> design): keep it only if the brief talks about studying.
      if (!seen.length && !STUDY_ANYWHERE.test(b)) return drop(c, "brief says nothing about a subject studied");
    }
    return true;
  });

  // "engineers not currently at Google": the model sometimes leaves out the job, which turns
  // the search into "anyone not at Google". A bare engineer/developer with no role or title
  // filter is the software role. This uses the brief's own word, so it adds nothing new.
  if (!out.some((c) => c.field === "role" || c.field === "title") && /\b(engineers?|developers?|programmers?|swes?)\b/.test(b)) {
    console.warn("Added role software: brief says engineer/developer but the model gave no role");
    out = [{ field: "role", mode: "required", values: ["software"] }, ...out];
  }

  // The same organization twice ("UC Berkeley" and "Cal"): when another constraint of the
  // same field and mode uses the brief's own words, a name the brief never wrote is a
  // model-added alias, not a second requirement.
  out = out.filter((c, idx) => {
    if ((c.field !== "school" && c.field !== "company") || !c.values?.length) return true;
    const inBrief = (x: LooseConstraint) => x.values?.some((v) => mentions(b, v).length) ?? false;
    if (inBrief(c)) return true;
    const sibling = out.some((x, j) => j !== idx && x.field === c.field && x.mode === c.mode && inBrief(x));
    return sibling ? drop(c, "duplicate of an organization the brief names") : true;
  });
  return out;
}

// Turning model output into filters ----------------------------------------------------------

const MAX_CONSTRAINTS = 12;
const MAX_UNSUPPORTED = 10;
const MAX_VARIANTS = 3;
const MAX_NAMES = 3;

/**
 * Validates each constraint after repairing common near-misses. Fails closed: a
 * required or excluded constraint that still can't be used becomes an unsupported
 * item with the same mode, so the search returns nobody (and the recruiter sees an
 * editable chip) rather than silently searching more broadly. Exported for tests.
 */
export function toFilters(rawConstraints: unknown[], rawUnsupported: unknown[]) {
  const constraints: LooseConstraint[] = [];
  const unsupported: Unsupported[] = [];

  for (const c of rawConstraints) {
    const fixed = repairConstraint(c);
    const r = LooseConstraint.safeParse(fixed);
    if (r.success && hasSomethingToMatch(r.data)) {
      constraints.push(r.data);
      continue;
    }
    const mode = modeOf(fixed);
    const why = r.success ? "nothing to match on" : r.error.issues.slice(0, 2);
    console.warn(`Unusable ${mode} constraint (${mode === "preferred" ? "dropped" : "kept as unsupported"}):`, JSON.stringify(c).slice(0, 300), why);
    if (mode !== "preferred") unsupported.push({ text: describeConstraint(fixed), mode });
  }
  for (const u of rawUnsupported) {
    const r = Unsupported.safeParse(u);
    if (r.success) unsupported.push(r.data);
  }

  // If there are more than fit, keep the ones that narrow the search; dropping a
  // preferred one only changes ranking.
  const order = { required: 0, excluded: 1, preferred: 2 } as const;
  constraints.sort((a, b) => order[a.mode] - order[b.mode]);
  for (const extra of constraints.splice(MAX_CONSTRAINTS)) {
    if (extra.mode !== "preferred") unsupported.push({ text: describeConstraint(extra), mode: extra.mode });
  }
  unsupported.sort((a, b) => order[a.mode] - order[b.mode]);
  return { constraints, unsupported: unsupported.slice(0, MAX_UNSUPPORTED) };
}

const str = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const clip = (s: string) => s.trim().slice(0, 80);
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** A constraint with no values (or a years constraint with no bounds) would match everyone. */
function hasSomethingToMatch(c: LooseConstraint): boolean {
  if (c.field === "open_to_work") return true;
  if (c.field === "years") return c.min !== undefined || c.max !== undefined;
  return (c.values?.length ?? 0) > 0;
}

function modeOf(c: unknown): Mode {
  const m = c && typeof c === "object" ? String((c as Record<string, unknown>).mode ?? "required").toLowerCase() : "required";
  return m === "preferred" || m === "excluded" ? m : "required";
}

function describeConstraint(c: unknown): string {
  const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
  const field = str(o.field) ? o.field : "filter";
  const vals = Array.isArray(o.values) ? o.values.filter(str) : [];
  const range = [o.min !== undefined ? `min ${o.min}` : "", o.max !== undefined ? `max ${o.max}` : ""].filter(Boolean).join(" ");
  return `${field}: ${vals.join(", ") || range || "unreadable"}`.slice(0, 120);
}

/** Fix the shapes models commonly get slightly wrong, without inventing anything. */
function repairConstraint(c: unknown): unknown {
  if (!c || typeof c !== "object" || Array.isArray(c)) return c;
  const o: Record<string, unknown> = { ...(c as Record<string, unknown>) };

  // Empty optional fields (null, "", []) mean "not set"; models often send them that way.
  for (const k of ["scope", "min", "max", "values", "variants"]) {
    const v = o[k];
    if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) delete o[k];
  }
  if (o.mode === null || o.mode === "") delete o.mode;

  if (str(o.field)) o.field = o.field.trim().toLowerCase();
  if (str(o.mode)) o.mode = o.mode.trim().toLowerCase();
  if (str(o.scope)) o.scope = o.scope.trim().toLowerCase();

  // Numbers sent as text: "8", "8+", "5 years".
  for (const k of ["min", "max"] as const) {
    if (typeof o[k] === "string") {
      const n = parseFloat(o[k] as string);
      o[k] = Number.isFinite(n) ? n : undefined;
    }
  }
  // "No limit" sent as a huge number (1.79e308), or a bound that can't be meant: drop it.
  if (o.field === "years") {
    if (typeof o.max === "number" && (!Number.isFinite(o.max) || o.max > 60)) delete o.max;
    if (typeof o.min === "number" && (!Number.isFinite(o.min) || o.min <= 0)) delete o.min;
  }

  // A single value sent as a string; long lists trimmed.
  if (str(o.values)) o.values = [o.values];
  if (Array.isArray(o.values)) o.values = o.values.filter(str).map(clip).slice(0, 10);

  // Variants: keep only well-formed entries about one of the values, a few names each.
  if (Array.isArray(o.variants)) {
    let vs = o.variants
      .filter((v): v is { mention: string; names: unknown[] } => !!v && typeof v === "object" && str((v as any).mention) && Array.isArray((v as any).names))
      .map((v) => ({ mention: clip(v.mention), names: v.names.filter(str).map(clip).slice(0, MAX_NAMES) }));
    // The model sometimes puts the name only in variants. Recover it from the first entry.
    if ((!Array.isArray(o.values) || o.values.length === 0) && vs.length) o.values = [vs[0].mention];
    const valueKeys = new Set((Array.isArray(o.values) ? (o.values as string[]) : []).map(key));
    vs = vs.filter((v) => valueKeys.has(key(v.mention)) && v.names.length > 0);
    // One entry per value; extra entries are the runaway lists (other spellings, subsidiaries).
    const seen = new Set<string>();
    vs = vs.filter((v) => !seen.has(key(v.mention)) && seen.add(key(v.mention)));
    o.variants = vs.length ? vs.slice(0, MAX_VARIANTS) : undefined;
  }
  return o;
}

// Anthropic -----------------------------------------------------------------------------

let anthropic: Anthropic | null = null;

async function callAnthropic(brief: string, vocab: Vocab): Promise<RawCall> {
  const key = serverEnv.anthropicKey();
  if (!key) throw new HttpError(503, "llm_unavailable", "Search is not configured: ANTHROPIC_API_KEY is missing.");
  anthropic ??= new Anthropic({ apiKey: key, maxRetries: 0, timeout: LLM_TIMEOUT_MS });

  const msg = await anthropic.messages.create({
    model: serverEnv.model(),
    max_tokens: 800,
    thinking: { type: "disabled" },
    system: [
      { type: "text", text: RULES },
      { type: "text", text: vocabularyBlock(vocab), cache_control: { type: "ephemeral" } },
    ],
    tools: [{ name: TOOL_NAME, description: TOOL_DESCRIPTION, input_schema: TOOL_INPUT_SCHEMA as unknown as Anthropic.Tool.InputSchema }],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content: wrapBrief(brief) }],
  });

  const tool = msg.content.find((b) => b.type === "tool_use");
  if (!tool || !("input" in tool)) throw new Error(`Anthropic returned no ${TOOL_NAME} call (stop_reason ${msg.stop_reason})`);
  return {
    toolInput: tool.input,
    usage: {
      input: msg.usage.input_tokens,
      output: msg.usage.output_tokens,
      cacheRead: msg.usage.cache_read_input_tokens ?? 0,
      cacheWrite: msg.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

// Google Gemini (REST, no SDK) ------------------------------------------------------------

interface GeminiResponse {
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ functionCall?: { name: string; args?: unknown } }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number };
  error?: { message?: string };
}

async function callGemini(brief: string, vocab: Vocab): Promise<RawCall> {
  const key = serverEnv.geminiKey();
  if (!key) throw new HttpError(503, "llm_unavailable", "Search is not configured: GEMINI_API_KEY is missing.");
  const base = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
  const model = serverEnv.model();

  const signal = AbortSignal.timeout(LLM_TIMEOUT_MS);
  const res = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `${RULES}\n\n${vocabularyBlock(vocab)}` }] },
      contents: [{ role: "user", parts: [{ text: wrapBrief(brief) }] }],
      tools: [{ functionDeclarations: [{ name: TOOL_NAME, description: TOOL_DESCRIPTION, parameters: TOOL_INPUT_SCHEMA }] }],
      // ANY + one allowed function = the model must call emit_filters.
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [TOOL_NAME] } },
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 800,
        // "low": measured as accurate as higher levels at ~1 s. Set GEMINI_THINKING_LEVEL to override
        // (some Flash versions only go down to "low").
        thinkingConfig: { thinkingLevel: process.env.GEMINI_THINKING_LEVEL || "low" },
      },
    }),
  });

  const body = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (signal.aborted) throw signal.reason; // cut off mid-response: a failure, not "no filters"
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${body.error?.message ?? "request failed"}`);

  const candidate = body.candidates?.[0];
  const call = candidate?.content?.parts?.find((p) => p.functionCall?.name === TOOL_NAME)?.functionCall;
  // Forced function calling: no call means a malformed or cut-off answer (e.g. MAX_TOKENS).
  if (!call) throw new Error(`Gemini returned no ${TOOL_NAME} call (finishReason ${candidate?.finishReason ?? "none"})`);
  const u = body.usageMetadata ?? {};
  const cached = u.cachedContentTokenCount ?? 0;
  return {
    toolInput: call.args ?? null,
    usage: { input: (u.promptTokenCount ?? 0) - cached, output: u.candidatesTokenCount ?? 0, cacheRead: cached, cacheWrite: 0 },
  };
}