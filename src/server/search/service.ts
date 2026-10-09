import "server-only";
import type { Recruiter } from "../auth";
import { serverEnv } from "../env";
import { fromDb, HttpError } from "../http";
import { extractFilters, type Extraction } from "./llm";
import type { Filters, FiltersInput } from "./schema";
import { RANK_WEIGHTS } from "./tuning";
import { loadVocab, mapFilters } from "./vocab";

export interface SearchCard {
  id: string;
  name: string;
  headline: string | null;
  avatar_url: string | null;
  location: string | null;
  years_experience: number | null;
  current_title: string | null;
  current_company: string | null;
  current_company_logo: string | null;
  open_to_work?: boolean | null;
  skills: string[];
}

export interface SearchResponse {
  search_id: string;
  filters: Filters;
  total: number;
  results: SearchCard[];
  searches_remaining: number | null;
  plan: "free" | "paid";
  /** Why the result is empty, when it is: unsupported, no_required, too_broad. */
  reason: string | null;
  /** Whether this search used up quota (refinements that only narrow do not). */
  counted: boolean;
  meta?: { provider: string; model: string; llm_ms: number; input_tokens: number; output_tokens: number; cache_read_tokens: number };
}

interface RpcResult { search_id: string; total: number; reason: string | null; counted: boolean; results: SearchCard[] }

async function planInfo(rec: Recruiter): Promise<{ plan: "free" | "paid"; searches_remaining: number | null }> {
  const { data, error } = await rec.db.rpc("plan_info");
  if (error) throw fromDb(error);
  return data;
}

/** Reserve, extract, map, run. Any failure after the reservation releases it. */
async function reserveAndRun(rec: Recruiter, brief: string, getFilters: () => Promise<{ filters: Filters; ext?: Extraction }>): Promise<SearchResponse> {
  const { data: searchId, error } = await rec.db.rpc("begin_search", { p_brief: brief });
  if (error) throw fromDb(error);

  try {
    const { filters, ext } = await getFilters();
    const run = await rec.db.rpc("run_search", { p_search_id: searchId, p_filters: filters, p_weights: RANK_WEIGHTS });
    if (run.error) throw fromDb(run.error);
    const r = run.data as RpcResult;
    const plan = await planInfo(rec);
    return {
      search_id: r.search_id,
      filters,
      total: r.total,
      results: r.results,
      searches_remaining: plan.searches_remaining,
      plan: plan.plan,
      reason: r.reason,
      counted: r.counted,
      ...(ext ? { meta: { provider: serverEnv.provider(), model: serverEnv.model(), llm_ms: ext.usage.ms, input_tokens: ext.usage.input, output_tokens: ext.usage.output, cache_read_tokens: ext.usage.cacheRead } } : {}),
    };
  } catch (e) {
    await rec.db.rpc("cancel_search", { p_search_id: searchId });
    throw e;
  }
}

/** POST /api/search: a new brief through the LLM. */
export function newSearch(rec: Recruiter, brief: string): Promise<SearchResponse> {
  return reserveAndRun(rec, brief, async () => {
    const vocab = await loadVocab(rec.db);
    const ext = await extractFilters(brief, vocab);
    return { filters: mapFilters(ext.filters, vocab), ext };
  });
}

/** Re-run a saved search with its saved filters (a new search, so it reserves quota). */
export function runWithFilters(rec: Recruiter, brief: string, input: FiltersInput): Promise<SearchResponse> {
  return reserveAndRun(rec, brief, async () => ({ filters: mapFilters(input, await loadVocab(rec.db)) }));
}

/** Correct a search without the LLM. Free when it only narrows the parent's results. */
export async function refineSearch(rec: Recruiter, parentId: string, input: FiltersInput): Promise<SearchResponse> {
  const filters = mapFilters(input, await loadVocab(rec.db));
  const { data, error } = await rec.db.rpc("refine_search", { p_parent_id: parentId, p_filters: filters, p_weights: RANK_WEIGHTS });
  if (error) throw fromDb(error);
  const r = data as RpcResult;
  const plan = await planInfo(rec);
  return { search_id: r.search_id, filters, total: r.total, results: r.results, searches_remaining: plan.searches_remaining, plan: plan.plan, reason: r.reason, counted: r.counted };
}

export async function searchPage(rec: Recruiter, searchId: string, page: number) {
  const { data, error } = await rec.db.rpc("search_page", { p_search_id: searchId, p_page: page });
  if (error) throw fromDb(error);
  if (!data) throw new HttpError(404, "not_found", "Search not found.");
  return data as { search_id: string; parent_id: string | null; brief: string; filters: Filters; total: number; page: number; page_size: number; results: SearchCard[] };
}
