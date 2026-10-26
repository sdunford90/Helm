import type { Queue } from "bullmq";
import { queues, type QueueName } from "../lib/queue.js";

// ---------------------------------------------------------------------------
// Repeatable job schedulers
//
// All recurring jobs are registered here, in one place, with BullMQ's
// queue.upsertJobScheduler() (idempotent across restarts and across multiple
// worker instances: one scheduler id == one schedule).
//
// SAFETY (Phase 0): only jobs that cannot move money, change contracts or
// lock tenants may be registered by default. Every other scheduler is behind
// an explicit env flag that defaults to OFF. When a flag is off we also
// REMOVE any previously registered scheduler with that id, so a schedule
// left in Redis by an older deploy cannot keep firing.
// ---------------------------------------------------------------------------

export interface SchedulerDefinition {
  /** Stable scheduler id (BullMQ job scheduler key). */
  id: string;
  queue: QueueName;
  /** Job name the worker switches on. */
  jobName: string;
  /** Cron pattern (server timezone is UTC in containers). */
  pattern: string;
  data: Record<string, unknown>;
  /**
   * Env flag that must be "true" for this scheduler to be registered, or
   * null for jobs that are always safe to schedule.
   */
  enabledByEnv: string | null;
  description: string;
}

export const SCHEDULERS: SchedulerDefinition[] = [
  // ── UNSAFE until fixed: keep OFF ───────────────────────────────────────────
  {
    // Recurring invoice generation + auto-charge. OFF until the billing
    // rewrite lands: billingCycle is ignored (annual contracts would be
    // invoiced monthly at the full rate), there is no nextBillingDate, and
    // tenant timezone is ignored. See audit 02 F-BIL-0..7.
    id: "billing-recurring-invoices",
    queue: "billing",
    jobName: "recurring-billing",
    pattern: "0 7 * * *",
    data: {},
    enabledByEnv: "ENABLE_RECURRING_BILLING_SCHEDULER",
    description: "Generate recurring invoices (and auto-charge opted-in tenants)",
  },
  {
    // Auto-renew batch creation. Safe-ish after the F-REN-1 fix (DRAFT
    // batches only, opted-in contracts only), but the renewal workflow
    // (RW-01/RW-03) has no UI to review and approve batches yet. OFF.
    id: "renewals-auto-renew-check",
    queue: "renewals",
    jobName: "auto-renew-fanout",
    pattern: "0 5 * * *",
    data: { type: "auto-renew-fanout" },
    enabledByEnv: "ENABLE_AUTO_RENEW_SCHEDULER",
    description: "Create DRAFT auto-renew batches for contracts expiring within 30 days",
  },
  {
    // SaaS dunning / tenant lock. There is no SaaS billing model yet; the job
    // itself is also a no-op unless TENANT_LIFECYCLE_ENFORCEMENT_ENABLED=true.
    // See jobs/tenant-lifecycle.ts and audit 02 F-LC-1.
    id: "billing-tenant-lifecycle",
    queue: "billing",
    jobName: "tenant-lifecycle",
    pattern: "0 6 * * *",
    data: {},
    enabledByEnv: "ENABLE_TENANT_LIFECYCLE_SCHEDULER",
    description: "SaaS grace-period reminders and tenant lock",
  },
  {
    // Rental demand-based price suggestions. The rentals module is disabled
    // and being rebuilt (Phase 3); suggestions use a pricing model that does
    // not match the API's. OFF.
    id: "automation-algorithmic-pricing",
    queue: "automation",
    jobName: "algorithmic-pricing",
    pattern: "0 0 * * 0",
    data: {},
    enabledByEnv: "ENABLE_ALGORITHMIC_PRICING_SCHEDULER",
    description: "Weekly rental price suggestions",
  },
  // ── Safe jobs (enabledByEnv: null) go here. None exist yet. ───────────────
];

export function isSchedulerEnabled(
  def: SchedulerDefinition,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return def.enabledByEnv === null || env[def.enabledByEnv] === "true";
}

export interface RegisterResult {
  registered: string[];
  removed: string[];
}

/**
 * Register every enabled scheduler and remove every disabled one.
 * Call once at worker startup.
 */
export async function registerSchedulers(
  opts: {
    env?: NodeJS.ProcessEnv;
    queueRegistry?: Record<QueueName, Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">>;
    definitions?: SchedulerDefinition[];
  } = {},
): Promise<RegisterResult> {
  const env = opts.env ?? process.env;
  const registry = opts.queueRegistry ?? queues;
  const defs = opts.definitions ?? SCHEDULERS;
  const result: RegisterResult = { registered: [], removed: [] };

  for (const def of defs) {
    const queue = registry[def.queue];
    if (isSchedulerEnabled(def, env)) {
      await queue.upsertJobScheduler(
        def.id,
        { pattern: def.pattern },
        {
          name: def.jobName,
          data: def.data,
          opts: { removeOnComplete: 50, removeOnFail: 100 },
        },
      );
      result.registered.push(def.id);
      console.log(`[schedulers] Registered ${def.id} (${def.pattern}): ${def.description}`);
    } else {
      await queue.removeJobScheduler(def.id);
      result.removed.push(def.id);
      console.log(
        `[schedulers] ${def.id} disabled (set ${def.enabledByEnv}=true to enable): ${def.description}`,
      );
    }
  }

  return result;
}
