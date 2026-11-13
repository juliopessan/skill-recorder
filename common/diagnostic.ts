import { z } from "zod";

import { Confidence } from "./analysis";
import { MAX_SQUAD_SIZE } from "./diagnostic-config";

/** Where a number or answer came from. Only "measured" and "confirmed" are trusted for reports. */
export const Source = z.enum(["measured", "ai-suggested", "confirmed"]);
export type Source = z.infer<typeof Source>;

export const SourcedNumberSchema = z.object({
  value: z.number().finite().nonnegative(),
  source: Source,
});
export type SourcedNumber = z.infer<typeof SourcedNumberSchema>;

export const RoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Fully-loaded cost per hour, in the engagement currency. */
  hourlyCost: z.number().finite().nonnegative(),
});
export type Role = z.infer<typeof RoleSchema>;

export const QuestionnaireAxis = z.enum(["inventory", "structure", "quality", "access", "governance"]);
export type QuestionnaireAxis = z.infer<typeof QuestionnaireAxis>;

export const QuestionnaireAnswerSchema = z.object({
  answer: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  source: Source,
  evidence: z.array(z.string()).default([]),
});
export type QuestionnaireAnswer = z.infer<typeof QuestionnaireAnswerSchema>;

export const DataQuestionnaireSchema = z.partialRecord(QuestionnaireAxis, QuestionnaireAnswerSchema);
export type DataQuestionnaire = z.infer<typeof DataQuestionnaireSchema>;

export const ProcessMapStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  medianDurationMs: z.number().nullable(),
  apps: z.array(z.string()).default([]),
  dataArtifacts: z.array(z.string()).default([]),
  dataStructure: z.enum(["structured", "semi", "unstructured"]),
  manualTransfer: z.boolean(),
  rework: z.boolean(),
  owner: z.string().optional(),
  sourceStepRefs: z.array(z.object({ sessionId: z.string(), stepId: z.string() })).default([]),
});
export type ProcessMapStep = z.infer<typeof ProcessMapStepSchema>;

export const ProcessMapSchema = z.object({
  version: z.literal(1),
  processId: z.string(),
  revision: z.number().int(),
  createdAt: z.number(),
  steps: z.array(ProcessMapStepSchema),
  variants: z.array(z.object({ stepId: z.string(), description: z.string() })).default([]),
  confidence: Confidence,
});
export type ProcessMap = z.infer<typeof ProcessMapSchema>;

/** What the process-mapping agent submits; the engine adds version/processId/revision/createdAt. */
export const ProcessMapSubmissionSchema = ProcessMapSchema.omit({
  version: true,
  processId: true,
  revision: true,
  createdAt: true,
});
export type ProcessMapSubmission = z.infer<typeof ProcessMapSubmissionSchema>;

export const ProcessSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner: z.string().optional(),
  sessionIds: z.array(z.string()).default([]),
  roleId: z.string().optional(),
  volumePerMonth: SourcedNumberSchema.optional(),
  peopleCount: SourcedNumberSchema.optional(),
  stale: z.boolean().default(false),
});
export type Process = z.infer<typeof ProcessSchema>;

export const OpportunitySchema = z.object({
  id: z.string(),
  title: z.string(),
  processId: z.string(),
  stepIds: z.array(z.string()),
  wave: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  prerequisites: z.array(z.string()).default([]),
  estimatedSavingsPct: SourcedNumberSchema.refine((n) => n.value >= 0 && n.value <= 1, {
    message: "estimatedSavingsPct.value must be within [0, 1]",
    path: ["value"],
  }),
  effort: z.enum(["S", "M", "L"]),
  risk: z.enum(["low", "medium", "high"]),
  rationale: z.string(),
  suggestedSquad: z.object({ roles: z.array(z.string()).max(MAX_SQUAD_SIZE), weeks: z.number() }),
  hidden: z.boolean().default(false),
  order: z.number().default(0),
});
export type Opportunity = z.infer<typeof OpportunitySchema>;

/** Enablement item: training, AI workshop, literacy or mentoring. Never carries money. */
export const EnablementSchema = z.object({
  id: z.string(),
  title: z.string(),
  format: z.enum(["treinamento", "workshop", "letramento", "mentoria"]),
  audience: z.string(),
  gap: z.enum(["processos", "dados", "ia"]),
  rationale: z.string(),
  durationDays: z.number().gt(0).max(20),
  hidden: z.boolean().default(false),
  order: z.number().default(0),
});
export type Enablement = z.infer<typeof EnablementSchema>;

/** A new front inside the client for the next consulting cycle. Never carries money. */
export const ExpansionSchema = z.object({
  id: z.string(),
  area: z.string(),
  rationale: z.string(),
  evidence: z.array(z.string()).min(1),
  relatedApps: z.array(z.string()).default([]),
  hidden: z.boolean().default(false),
  order: z.number().default(0),
});
export type Expansion = z.infer<typeof ExpansionSchema>;

export const InitiativesSchema = z.object({
  enablement: z.array(EnablementSchema).default([]),
  expansion: z.array(ExpansionSchema).default([]),
});
export type Initiatives = z.infer<typeof InitiativesSchema>;

export const EnablementSubmissionSchema = EnablementSchema.omit({ hidden: true, order: true });
export type EnablementSubmission = z.infer<typeof EnablementSubmissionSchema>;
export const ExpansionSubmissionSchema = ExpansionSchema.omit({ hidden: true, order: true });
export type ExpansionSubmission = z.infer<typeof ExpansionSubmissionSchema>;

/** What the opportunities agent submits; the engine adds hidden/order. */
export const OpportunitiesSubmissionSchema = z.object({
  opportunities: z.array(OpportunitySchema.omit({ hidden: true, order: true })),
  enablement: z.array(EnablementSubmissionSchema).default([]),
  expansion: z.array(ExpansionSubmissionSchema).default([]),
});
export type OpportunitiesSubmission = z.infer<typeof OpportunitiesSubmissionSchema>;

/** What one squad role costs per week. Entered by the consultant, never invented by the app or the model. */
export const SquadRateSchema = z.object({
  role: z.string().refine((s) => s.trim().length > 0, { message: "role must not be blank" }),
  weeklyRate: z.number().finite().nonnegative(),
});
export type SquadRate = z.infer<typeof SquadRateSchema>;

export const EngagementSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  clientName: z.string(),
  createdAt: z.number(),
  currency: z.string().default("BRL"),
  roles: z.array(RoleSchema),
  dataQuestionnaire: DataQuestionnaireSchema,
  processes: z.array(ProcessSchema),
  thesisText: z.string(),
  /** Weekly rate per squad role (matched case-insensitively, trimmed). Old files load as []. */
  squadRates: z.array(SquadRateSchema).default([]),
  /** Optional price of one enablement day; when set, enablement enters the program investment. */
  enablementDayRate: z.number().finite().nonnegative().optional(),
});
export type Engagement = z.infer<typeof EngagementSchema>;
