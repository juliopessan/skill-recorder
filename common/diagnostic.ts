import { z } from "zod";

import { Confidence } from "./analysis";

/** Where a number or answer came from. Only "measured" and "confirmed" are trusted for reports. */
export const Source = z.enum(["measured", "ai-suggested", "confirmed"]);
export type Source = z.infer<typeof Source>;

export const SourcedNumberSchema = z.object({
  value: z.number(),
  source: Source,
});
export type SourcedNumber = z.infer<typeof SourcedNumberSchema>;

export const RoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Fully-loaded cost per hour, in the engagement currency. */
  hourlyCost: z.number(),
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
  suggestedSquad: z.object({ roles: z.array(z.string()), weeks: z.number() }),
  hidden: z.boolean().default(false),
  order: z.number().default(0),
});
export type Opportunity = z.infer<typeof OpportunitySchema>;

/** What the opportunities agent submits; the engine adds hidden/order. */
export const OpportunitiesSubmissionSchema = z.object({
  opportunities: z.array(OpportunitySchema.omit({ hidden: true, order: true })),
});
export type OpportunitiesSubmission = z.infer<typeof OpportunitiesSubmissionSchema>;

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
});
export type Engagement = z.infer<typeof EngagementSchema>;
