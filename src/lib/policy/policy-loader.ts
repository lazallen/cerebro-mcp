/**
 * Policy YAML loader with Zod validation.
 * Loads a versioned Policy from a YAML file.
 * Throws a descriptive ConfigurationError on invalid config — never silently defaults.
 */

import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import type { Policy } from './types';
import { logger } from '../../common/logger';

// ---------------------------------------------------------------------------
// Zod schemas for runtime validation
// ---------------------------------------------------------------------------

const LeafOpSchema = z.enum(['eq', 'neq', 'contains', 'matches', 'in', 'domain_in', 'gte', 'lte']);

const LeafPredicateSchema = z.object({
  field: z.string().min(1),
  op: LeafOpSchema,
  value: z.unknown(),
});

// Recursive predicate schema — Zod supports lazy() for self-referential schemas
const PredicateSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(PredicateSchema) }),
    z.object({ any: z.array(PredicateSchema) }),
    z.object({ not: PredicateSchema }),
    LeafPredicateSchema,
  ])
);

const IntentTypeSchema = z.enum([
  'ACTION_REQUIRED',
  'APPROVAL_REQUEST',
  'SCHEDULING',
  'DELEGATABLE',
  'FYI',
  'NEWSLETTER',
  'RECEIPT',
  'SPAM',
  'UNKNOWN',
]);

const UrgencySchema = z.enum(['NOW', 'THIS_WEEK', 'SOMEDAY']);
const RiskSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
const PolicyActionTypeSchema = z.enum([
  'TRIAGE',
  'MOVE',
  'FLAG',
  'LABEL',
  'CREATE_TASK',
  'JOURNAL_NOTE',
  'RESPOND_CALENDAR',
  'ARCHIVE',
]);

const RuleActionSchema = z.object({
  type: PolicyActionTypeSchema,
  name: z.string().optional(),
  folder: z.string().optional(),
  folderId: z.string().optional(),
  question: z.string().optional(),
  flagStatus: z.string().optional(),
  calendarResponse: z.enum(['accepted', 'declined', 'tentativelyAccepted']).optional(),
});

const ClassificationSchema = z.object({
  intent: IntentTypeSchema.optional(),
  urgency: UrgencySchema.optional(),
  risk: RiskSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.array(z.string()).optional(),
});

const PolicyRuleSchema = z.object({
  id: z.string().min(1),
  priority: z.number(),
  when: PredicateSchema,
  setClassification: ClassificationSchema.optional(),
  actions: z.array(RuleActionSchema),
  terminal: z.boolean(),
});

const PolicyDefaultsSchema = z.object({
  approvalThreshold: z.number().min(0).max(1),
  claudeRecommendThreshold: z.number().min(0).max(1),
  unknownIntentRisk: RiskSchema,
  categories: z.record(z.string(), z.string()).optional(),
  folders: z.record(z.string(), z.string()).optional(),
  selfSenderDomains: z.array(z.string()).optional(),
  senderAllowlist: z.array(z.string()).optional(),
  senderBlocklistDomains: z.array(z.string()).optional(),
  conflictResolution: z
    .object({
      triageBlocksMove: z.boolean(),
    })
    .optional(),
});

const PolicySchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  defaults: PolicyDefaultsSchema,
  rules: z.array(PolicyRuleSchema).min(1),
});

// ---------------------------------------------------------------------------
// ConfigurationError
// ---------------------------------------------------------------------------

export class ConfigurationError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

// ---------------------------------------------------------------------------
// PolicyLoader
// ---------------------------------------------------------------------------

/**
 * Load and validate a Policy from a YAML file.
 * Throws ConfigurationError if the file is missing, unparseable, or fails validation.
 */
export async function loadPolicy(policyFilePath: string): Promise<Policy> {
  logger.debug({
    operation: 'policy_load_start',
    path: policyFilePath,
    message: `Loading policy from ${policyFilePath}`,
  });

  // Read file
  let raw: string;
  try {
    raw = await fs.readFile(policyFilePath, 'utf-8');
  } catch (err) {
    throw new ConfigurationError(
      `Policy file not found or unreadable: ${policyFilePath}`,
      policyFilePath,
      err
    );
  }

  // Parse YAML (strips comments; valid YAML superset of JSON)
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new ConfigurationError(
      `Policy YAML parse error in ${policyFilePath}: ${(err as Error).message}`,
      policyFilePath,
      err
    );
  }

  // Validate schema
  const result = PolicySchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  [${i.path.join('.')}] ${i.message}`)
      .join('\n');
    throw new ConfigurationError(
      `Policy validation failed for ${policyFilePath}:\n${issues}`,
      policyFilePath,
      result.error.issues
    );
  }

  const policy = result.data as Policy;

  logger.info({
    operation: 'policy_loaded',
    policyId: policy.id,
    version: policy.version,
    ruleCount: policy.rules.length,
    message: `Policy loaded: ${policy.id}@${policy.version} (${policy.rules.length} rules)`,
  });

  return policy;
}
