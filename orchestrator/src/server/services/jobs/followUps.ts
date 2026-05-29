import type {
  ApplicationStage,
  FollowUpRecommendation,
  FollowUpRecommendationsResponse,
} from "@shared/types";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../../db/index";
import { getActiveTenantId } from "../../tenancy/context";

const { jobs, stageEvents } = schema;

const DAY_MS = 24 * 60 * 60 * 1000;
const INTERVIEW_STAGES = new Set<ApplicationStage>([
  "recruiter_screen",
  "assessment",
  "hiring_manager_screen",
  "technical_interview",
  "onsite",
]);

function unixSecondsFromIso(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
}

function daysSince(unixSeconds: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - unixSeconds * 1000) / DAY_MS));
}

export async function getFollowUpRecommendations(
  now = new Date(),
): Promise<FollowUpRecommendationsResponse> {
  const tenantId = getActiveTenantId();
  const nowMs = now.getTime();
  const activeJobs = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      employer: jobs.employer,
      status: jobs.status,
      appliedAt: jobs.appliedAt,
      updatedAt: jobs.updatedAt,
    })
    .from(jobs)
    .where(
      and(eq(jobs.tenantId, tenantId), inArray(jobs.status, ["applied", "in_progress"])),
    )
    .orderBy(desc(jobs.appliedAt));

  const items: FollowUpRecommendation[] = [];

  for (const job of activeJobs) {
    const latestEvent = await db
      .select({
        toStage: stageEvents.toStage,
        occurredAt: stageEvents.occurredAt,
      })
      .from(stageEvents)
      .where(
        and(eq(stageEvents.tenantId, tenantId), eq(stageEvents.applicationId, job.id)),
      )
      .orderBy(desc(stageEvents.occurredAt))
      .limit(1)
      .get();

    const appliedAtSeconds = unixSecondsFromIso(job.appliedAt);
    const updatedAtSeconds = unixSecondsFromIso(job.updatedAt);
    const latestActivityAt = latestEvent?.occurredAt ?? appliedAtSeconds ?? updatedAtSeconds;
    if (!latestActivityAt) continue;

    const latestStage = (latestEvent?.toStage as ApplicationStage | undefined) ?? null;
    const elapsedDays = daysSince(latestActivityAt, nowMs);

    if (job.status === "applied" && elapsedDays >= 7) {
      items.push({
        jobId: job.id,
        title: job.title,
        employer: job.employer,
        status: "applied",
        appliedAt: job.appliedAt,
        latestStage,
        latestActivityAt,
        daysSinceActivity: elapsedDays,
        kind: "application_follow_up",
        priority: elapsedDays >= 14 ? "high" : "medium",
        reason: `Applied ${elapsedDays} days ago with no recorded progress.`,
        suggestedAction: "Send a concise follow-up or mark as no response if this role is no longer worth pursuing.",
        tokenCost: "none",
      });
      continue;
    }

    if (job.status === "in_progress" && latestStage && INTERVIEW_STAGES.has(latestStage) && elapsedDays >= 3) {
      items.push({
        jobId: job.id,
        title: job.title,
        employer: job.employer,
        status: "in_progress",
        appliedAt: job.appliedAt,
        latestStage,
        latestActivityAt,
        daysSinceActivity: elapsedDays,
        kind: "interview_follow_up",
        priority: elapsedDays >= 7 ? "high" : "medium",
        reason: `Last interview-stage activity was ${elapsedDays} days ago.`,
        suggestedAction: "Send a short thank-you/check-in message. Drafting a custom message may use LLM tokens.",
        tokenCost: "none",
      });
      continue;
    }

    if (job.status === "in_progress" && elapsedDays >= 10) {
      items.push({
        jobId: job.id,
        title: job.title,
        employer: job.employer,
        status: "in_progress",
        appliedAt: job.appliedAt,
        latestStage,
        latestActivityAt,
        daysSinceActivity: elapsedDays,
        kind: "stale_in_progress",
        priority: "low",
        reason: `No recorded activity for ${elapsedDays} days.`,
        suggestedAction: "Review the thread, follow up if there is an owner, or close the application as ghosted/no response.",
        tokenCost: "none",
      });
    }
  }

  return {
    generatedAt: now.toISOString(),
    tokenCost: "none",
    items: items.sort((a, b) => {
      const priorityScore = { high: 0, medium: 1, low: 2 } as const;
      return priorityScore[a.priority] - priorityScore[b.priority] || b.daysSinceActivity - a.daysSinceActivity;
    }),
  };
}
