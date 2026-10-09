// Normalization shared by the candidate loader (data side) and the search
// mapper (query side). Both sides go through the same functions, so "ReactJS"
// in a brief and "React.js" in a profile land on the same key.

export const ROLE_FAMILIES = [
  "software",
  "frontend",
  "backend",
  "fullstack",
  "mobile",
  "devops",
  "data_engineering",
  "data_science",
  "ml",
  "security",
  "qa",
  "embedded",
  "design",
  "product",
  "engineering_management",
  "marketing",
  "sales",
  "customer_success",
  "operations",
  "people",
  "finance",
] as const;
export type RoleFamily = (typeof ROLE_FAMILIES)[number];

export const SENIORITY = ["junior", "mid", "senior", "staff_plus"] as const;
export type Seniority = (typeof SENIORITY)[number];

export const EDUCATION_LEVELS = ["associate", "bachelors", "masters", "phd", "other"] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

export const ROLE_LABELS: Record<RoleFamily, string> = {
  software: "Software engineering",
  frontend: "Frontend",
  backend: "Backend",
  fullstack: "Full stack",
  mobile: "Mobile",
  devops: "DevOps / infrastructure",
  data_engineering: "Data engineering",
  data_science: "Data science / analytics",
  ml: "Machine learning / AI",
  security: "Security",
  qa: "QA / test",
  embedded: "Embedded / firmware",
  design: "Design",
  product: "Product management",
  engineering_management: "Engineering management",
  marketing: "Marketing",
  sales: "Sales",
  customer_success: "Customer success / support",
  operations: "Operations",
  people: "People / recruiting",
  finance: "Finance",
};

export const SENIORITY_LABELS: Record<Seniority, string> = {
  junior: "Junior",
  mid: "Mid-level",
  senior: "Senior",
  staff_plus: "Staff, principal or lead",
};

export const EDUCATION_LABELS: Record<EducationLevel, string> = {
  associate: "Associate degree",
  bachelors: "Bachelor's",
  masters: "Master's",
  phd: "PhD",
  other: "Other",
};

/** Lowercase, punctuation to spaces, collapsed. Used for titles, places, schools. */
export function simpleKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Lowercase with everything but letters, digits, + and # removed. Used for skills. */
export function compactKey(s: string): string {
  return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9+#]/g, "");
}

// Skills ----------------------------------------------------------------------

const SKILL_ALIASES: Record<string, string> = {
  reactjs: "react",
  vuejs: "vue",
  angularjs: "angular",
  node: "nodejs",
  golang: "go",
  k8s: "kubernetes",
  postgres: "postgresql",
  psql: "postgresql",
  js: "javascript",
  ecmascript: "javascript",
  es6: "javascript",
  ts: "typescript",
  py: "python",
  ml: "machinelearning",
  amazonwebservices: "aws",
  googlecloud: "gcp",
  googlecloudplatform: "gcp",
  microsoftazure: "azure",
  rails: "rubyonrails",
  ror: "rubyonrails",
  dotnet: "net",
  csharp: "c#",
  cplusplus: "c++",
  cpp: "c++",
  tf: "tensorflow",
  sklearn: "scikitlearn",
  mongo: "mongodb",
  nextjs: "nextjs",
  reactnative: "reactnative",
};

export function skillKey(s: string): string {
  const k = compactKey(s);
  return SKILL_ALIASES[k] ?? k;
}

// Titles, seniority, role families -------------------------------------------------

const SENIOR_PREFIX = /^((senior|sr|junior|jr|staff|principal|lead|intern|associate|entry level)\s+)+/;
const LEVEL_SUFFIX = /\s+(i|ii|iii|iv|v|l\d|\d)$/;

/** "Senior Software Engineer II" -> "software engineer". Keeps "Tech Lead", "Head of X". */
export function titleBase(title: string): string {
  let t = simpleKey(title);
  t = t.replace(SENIOR_PREFIX, "").replace(LEVEL_SUFFIX, "").trim();
  return t || simpleKey(title);
}

export function seniorityFromTitle(title: string | null | undefined): Seniority {
  const t = simpleKey(title ?? "");
  if (/\b(staff|principal|distinguished|fellow|lead|head|director|vp|vice president|chief|cto|architect)\b/.test(t))
    return "staff_plus";
  if (/\b(senior|sr)\b/.test(t)) return "senior";
  if (/\b(intern|internship|junior|jr|entry level|graduate|trainee|apprentice)\b/.test(t)) return "junior";
  return "mid";
}

const ROLE_RULES: Array<[RoleFamily, RegExp]> = [
  ["engineering_management", /\b(engineering manager|manager engineering|head of engineering|director of engineering|vp of engineering|vp engineering|vice president of engineering|cto|chief technology)\b/],
  ["frontend", /\b(front ?end|ui engineer|ui developer|web developer|web engineer)\b/],
  ["backend", /\b(back ?end|api engineer|server engineer)\b/],
  ["fullstack", /\b(full ?stack)\b/],
  ["mobile", /\b(mobile|ios|android|react native|flutter)\b/],
  ["devops", /\b(devops|dev ops|site reliability|sre|platform engineer|infrastructure|cloud engineer|systems engineer|reliability engineer)\b/],
  ["data_engineering", /\b(data engineer|analytics engineer|etl|big data|data platform)\b/],
  ["data_science", /\b(data scientist|data science|data analyst|business intelligence|bi analyst|analytics)\b/],
  ["ml", /\b(machine learning|ml|ai|artificial intelligence|deep learning|nlp|computer vision|llm|mlops)\b/],
  ["security", /\b(security|appsec|infosec|penetration|cyber)\b/],
  ["qa", /\b(qa|quality assurance|quality engineer|test engineer|sdet|test automation)\b/],
  ["embedded", /\b(embedded|firmware)\b/],
  ["design", /\b(designer|ux|user experience|design lead|head of design)\b/],
  ["product", /\b(product manager|product owner|product lead|head of product|vp of product|group product manager)\b/],
  ["marketing", /\b(marketing|marketer|growth|seo|content strategist|brand)\b/],
  ["sales", /\b(sales|account executive|business development|bdr|sdr|account manager)\b/],
  ["customer_success", /\b(customer success|customer support|support specialist|customer experience)\b/],
  ["operations", /\b(operations|ops manager|program manager|project manager|chief of staff)\b/],
  ["people", /\b(recruiter|recruiting|talent|human resources|hr|people partner|people operations)\b/],
  ["finance", /\b(finance|financial analyst|accountant|controller|fp and a)\b/],
  ["software", /\b(software|developer|engineer|programmer|swe|tech lead|technical lead)\b/],
];

export function roleFamiliesFromTitle(title: string | null | undefined): RoleFamily[] {
  const t = simpleKey(title ?? "");
  if (!t) return [];
  const out = new Set<RoleFamily>();
  for (const [family, re] of ROLE_RULES) if (re.test(t)) out.add(family);
  // A specialist engineer is also a software engineer.
  if ([...out].some((f) => ["frontend", "backend", "fullstack", "mobile", "embedded"].includes(f)) && /\b(engineer|developer)\b/.test(t))
    out.add("software");
  return [...out];
}

// Companies ----------------------------------------------------------------------------

export function companyKey(name: string): string {
  return simpleKey(name)
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|sa|ag|technologies|labs)\b/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Locations ----------------------------------------------------------------------------

const US_STATES: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado",
  ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho",
  il: "illinois", in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky", la: "louisiana",
  me: "maine", md: "maryland", ma: "massachusetts", mi: "michigan", mn: "minnesota",
  ms: "mississippi", mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada",
  nh: "new hampshire", nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina",
  nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania",
  ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee", tx: "texas",
  ut: "utah", vt: "vermont", va: "virginia", wa: "washington", wv: "west virginia",
  wi: "wisconsin", wy: "wyoming", dc: "district of columbia",
};
const US_STATE_NAMES = new Set(Object.values(US_STATES));

const PLACE_ALIASES: Record<string, string[]> = {
  usa: ["united states"],
  us: ["united states"],
  "u s": ["united states"],
  "u s a": ["united states"],
  "united states of america": ["united states"],
  america: ["united states"],
  uk: ["united kingdom"],
  "great britain": ["united kingdom"],
  britain: ["united kingdom"],
  nyc: ["new york"],
  "new york city": ["new york"],
  manhattan: ["new york"],
  brooklyn: ["new york"],
  sf: ["san francisco"],
  "san fran": ["san francisco"],
  "bay area": ["san francisco", "oakland", "san jose", "palo alto", "mountain view", "sunnyvale", "berkeley"],
  "sf bay area": ["san francisco", "oakland", "san jose", "palo alto", "mountain view", "sunnyvale", "berkeley"],
  "silicon valley": ["san jose", "palo alto", "mountain view", "sunnyvale", "santa clara", "cupertino"],
  la: ["los angeles"],
  "washington dc": ["washington dc"],
  "washington d c": ["washington dc"],
  "district of columbia": ["washington dc"],
  dc: ["washington dc"],
  remote: ["remote"],
};

/** Canonical terms for one place word, query side or data side. */
export function placeTerms(raw: string): string[] {
  const k = simpleKey(raw);
  if (!k) return [];
  if (PLACE_ALIASES[k]) return PLACE_ALIASES[k];
  if (US_STATES[k]) return [US_STATES[k]];
  return [k];
}

/** The full state name for a US state written as a name or a code, else null. */
export function usStateName(raw: string): string | null {
  const k = simpleKey(raw);
  if (US_STATES[k]) return US_STATES[k];
  return US_STATE_NAMES.has(k) ? k : null;
}

/**
 * Canonical location terms for [city, state, country] (or a single place).
 * Cities and countries are plain terms; US states are "state:<name>", so
 * "New York" the city and New York the state never blur together.
 */
export function locationTerms(parts: string[]): string[] {
  const out = new Set<string>();
  let usState = false;
  if (parts.length === 1) {
    for (const t of placeTerms(parts[0])) out.add(t);
    return [...out];
  }
  parts.forEach((p, i) => {
    const k = simpleKey(p);
    if (!k) return;
    if (i === 0) {
      for (const t of PLACE_ALIASES[k] ?? [k]) out.add(t); // city: aliases only, never read as a state code
      return;
    }
    const state = usStateName(p);
    if (state) {
      out.add(`state:${state}`);
      usState = true;
    } else {
      for (const t of placeTerms(p)) out.add(t); // country
    }
  });
  if (usState) out.add("united states");
  return [...out];
}

// Education ----------------------------------------------------------------------------

export function educationLevel(degree: string | null | undefined): EducationLevel {
  const d = (degree ?? "").toLowerCase();
  if (/ph\.?\s?d|doctor|d\.phil/.test(d)) return "phd";
  if (/master|\bm\.?\s?s\.?c?\b|\bmba\b|\bm\.?\s?eng\b|\bm\.?\s?a\b|\bm\.?\s?tech\b/.test(d)) return "masters";
  if (/bachelor|\bb\.?\s?s\.?c?\b|\bb\.?\s?a\b|\bb\.?\s?tech\b|\bb\.?\s?eng\b|\bb\.?\s?e\b|undergrad/.test(d)) return "bachelors";
  if (/associate/.test(d)) return "associate";
  return "other";
}

// Company traits ---------------------------------------------------------------------------
// Only explicit fields in the data produce a trait; we never guess "startup" from a name.

const STARTUP_WORDS = /\b(startup|start up|seed|pre seed|series [a-e]|early stage|venture backed)\b/;
const ENTERPRISE_WORDS = /\b(enterprise|public company|publicly traded|fortune 500|large enterprise|big tech|corporate)\b/;

export function traitsFromExperience(e: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const key of ["is_startup", "startup"]) {
    if (e[key] === true) out.add("startup");
  }
  for (const key of ["company_type", "company_stage", "stage", "type", "company_category", "category", "funding_stage", "company_kind"]) {
    const v = e[key];
    if (typeof v !== "string") continue;
    const s = simpleKey(v);
    if (STARTUP_WORDS.test(s)) out.add("startup");
    if (ENTERPRISE_WORDS.test(s)) out.add("enterprise");
  }
  const company = e["company"];
  if (company && typeof company === "object") {
    for (const t of traitsFromExperience(company as Record<string, unknown>)) out.add(t);
  }
  return [...out];
}

export const TRAIT_LABELS: Record<string, string> = {
  startup: "Startup",
  enterprise: "Enterprise",
};

// Fuzzy matching ---------------------------------------------------------------------------

function trigrams(s: string): Set<string> {
  const p = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
  return out;
}

/** Trigram similarity in [0, 1], like pg_trgm. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}
