import type { Job, JobLivenessCheckResponse, JobLivenessStatus, UpdateJobInput } from "@shared/types";

const EXPIRED_PATTERNS = [
  /job (is )?(no longer|not) available/i,
  /position (has been )?(filled|closed)/i,
  /posting (has )?(expired|closed)/i,
  /this job has expired/i,
  /this role is closed/i,
  /applications are closed/i,
  /no longer accepting applications/i,
  /vacancy (is )?closed/i,
  /404\s+not found/i,
];

const LIVE_PATTERNS = [
  /apply now/i,
  /submit application/i,
  /apply for this job/i,
  /apply for this position/i,
  /application form/i,
];

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectSignals(text: string, patterns: RegExp[]): string[] {
  return patterns
    .filter((pattern) => pattern.test(text))
    .map((pattern) => pattern.source.replace(/\\s\+/g, " "));
}

function classify(httpStatus: number | null, text: string): {
  status: JobLivenessStatus;
  reason: string;
  signals: string[];
} {
  if (httpStatus && [404, 410].includes(httpStatus)) {
    return {
      status: "expired",
      reason: `Posting returned HTTP ${httpStatus}.`,
      signals: [`HTTP ${httpStatus}`],
    };
  }

  const expiredSignals = collectSignals(text, EXPIRED_PATTERNS);
  if (expiredSignals.length > 0) {
    return {
      status: "expired",
      reason: "Posting contains closed/expired language.",
      signals: expiredSignals,
    };
  }

  const liveSignals = collectSignals(text, LIVE_PATTERNS);
  if (httpStatus && httpStatus >= 200 && httpStatus < 400 && liveSignals.length > 0) {
    return {
      status: "live",
      reason: "Posting loaded and contains apply-language.",
      signals: liveSignals,
    };
  }

  if (httpStatus && httpStatus >= 200 && httpStatus < 400) {
    return {
      status: "unknown",
      reason: "Posting loaded, but no strong live or expired signal was found.",
      signals: [],
    };
  }

  return {
    status: "unknown",
    reason: httpStatus ? `Posting returned HTTP ${httpStatus}.` : "Posting could not be checked.",
    signals: httpStatus ? [`HTTP ${httpStatus}`] : [],
  };
}

export async function checkJobLiveness(
  job: Job,
  options?: { markExpired?: boolean; updateJob?: (id: string, update: UpdateJobInput) => Promise<Job | null> },
): Promise<JobLivenessCheckResponse> {
  const checkedAt = new Date().toISOString();
  const checkedUrl = job.applicationLink || job.jobUrl || null;

  if (!checkedUrl) {
    return {
      jobId: job.id,
      checkedUrl,
      status: "unknown",
      httpStatus: null,
      reason: "No application or job URL is available.",
      signals: [],
      checkedAt,
      tokenCost: "none",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let httpStatus: number | null = null;

  try {
    const response = await fetch(checkedUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 JobOps liveness checker; token-free availability check",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      },
    });
    httpStatus = response.status;
    const raw = await response.text();
    const text = stripHtml(raw).slice(0, 200_000);
    const result = classify(httpStatus, text);
    const updatedJob =
      result.status === "expired" && options?.markExpired && job.status !== "expired"
        ? await options.updateJob?.(job.id, { status: "expired" })
        : null;

    return {
      jobId: job.id,
      checkedUrl,
      httpStatus,
      checkedAt,
      tokenCost: "none",
      ...result,
      ...(updatedJob ? { job: updatedJob } : {}),
    };
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError"
      ? "Liveness check timed out."
      : "Liveness check failed before a reliable signal was found.";
    return {
      jobId: job.id,
      checkedUrl,
      status: "unknown",
      httpStatus,
      reason,
      signals: [],
      checkedAt,
      tokenCost: "none",
    };
  } finally {
    clearTimeout(timeout);
  }
}
