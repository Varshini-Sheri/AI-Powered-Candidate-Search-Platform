import "server-only";
import { z } from "zod";

export const FIELDS = [
  "role",
  "title",
  "seniority",
  "years",
  "skill",
  "location",
  "company",
  "company_trait",
  "education_level",
  "school",
  "field_of_study",
  "open_to_work",
] as const;
export type Field = (typeof FIELDS)[number];

export const MODES = ["required", "preferred", "excluded"] as const;
export type Mode = (typeof MODES)[number];

const text = z.string().trim().min(1).max(80);

/** One constraint as the model or the UI sends it: values may be free text. */
export const LooseConstraint = z.object({
  field: z.enum(FIELDS),
  mode: z.enum(MODES).default("required"),
  scope: z.enum(["current", "any"]).optional(),
  values: z.array(text).max(10).optional(),
  min: z.number().min(0).max(60).optional(),
  max: z.number().min(0).max(60).optional(),
  /** Model-suggested other names for one value (company, school, field). Used only as a fallback. */
  variants: z.array(z.object({ mention: text, names: z.array(text).max(4) })).max(10).optional(),
});
export type LooseConstraint = z.infer<typeof LooseConstraint>;

export const Unsupported = z.object({
  text: z.string().trim().min(1).max(120),
  mode: z.enum(MODES).default("required"),
});
export type Unsupported = z.infer<typeof Unsupported>;

/** What the model returns. Parsed leniently: one bad constraint does not sink the rest. */
export const LlmOutput = z.object({
  constraints: z.array(z.unknown()).max(20).default([]),
  unsupported: z.array(z.unknown()).max(20).default([]),
});

/** What the UI sends to refine a search or save one. */
export const FiltersInput = z.object({
  constraints: z.array(LooseConstraint).max(15).default([]),
  unsupported: z.array(Unsupported).max(15).default([]),
});
export type FiltersInput = z.infer<typeof FiltersInput>;

/** A constraint after mapping: values are keys that exist in the data. */
export interface Constraint {
  id: string;
  field: Field;
  mode: Mode;
  scope?: "current" | "any";
  values: string[];
  labels: string[];
  min?: number;
  max?: number;
}

export interface Filters {
  constraints: Constraint[];
  unsupported: Unsupported[];
}

/** JSON schema the model must fill (forced tool use). */
export const TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    constraints: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field: { type: "string", enum: [...FIELDS] },
          mode: { type: "string", enum: [...MODES] },
          scope: { type: "string", enum: ["current", "any"] },
          values: {
            type: "array",
            maxItems: 10,
            items: { type: "string" },
            description: "The value(s) as written in the brief. Required for every field except years and open_to_work.",
          },
          min: { type: "number" },
          max: { type: "number" },
          variants: {
            type: "array",
            maxItems: 3,
            description:
              "Optional, company/school/field_of_study only. At most one entry per value, only when that value is an abbreviation, nickname or former name. Usually empty.",
            items: {
              type: "object",
              properties: {
                mention: { type: "string", description: "Exactly one of this constraint's values." },
                names: {
                  type: "array",
                  maxItems: 3,
                  items: { type: "string" },
                  description: "Other names for the SAME organization. Never subsidiaries, products or other organizations.",
                },
              },
              required: ["mention", "names"],
            },
          },
        },
        required: ["field", "mode"],
      },
    },
    unsupported: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          mode: { type: "string", enum: [...MODES] },
        },
        required: ["text", "mode"],
      },
    },
  },
  required: ["constraints", "unsupported"],
} as const;