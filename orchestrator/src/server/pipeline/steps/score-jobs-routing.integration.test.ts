import { createJob } from "@shared/testing/factories";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scoreJobsStep } from "./score-jobs";

const llmConstructors: Array<{
  provider: string | null;
  baseUrl: string | null;
  apiKey: string | null;
}> = [];
const llmCalls: Array<{ model: string; jobId?: string }> = [];

vi.mock("@infra/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@server/repositories/jobs", () => ({
  getUnscoredDiscoveredJobs: vi.fn(),
  updateJob: vi.fn(),
}));

vi.mock("@server/repositories/settings", () => ({
  getAllSettings: vi.fn(),
  getSetting: vi.fn(),
}));

vi.mock("@server/services/settings", () => ({
  getEffectiveSettings: vi.fn(),
}));

vi.mock("@server/services/envSettings", () => ({
  getOriginalEnvValue: vi.fn((key: string) => {
    if (key === "LLM_PROVIDER") return "codex";
    if (key === "MODEL") return "gpt-5.5";
    return null;
  }),
}));

vi.mock("@server/services/llm/service", () => ({
  LlmService: class {
    constructor(config: {
      provider: string | null;
      baseUrl: string | null;
      apiKey: string | null;
    }) {
      llmConstructors.push(config);
    }

    async callJson(options: { model: string; jobId?: string }) {
      llmCalls.push({ model: options.model, jobId: options.jobId });
      return {
        success: true,
        data: { score: 77, reason: "Mocked fit" },
      };
    }
  },
}));

vi.mock("@server/services/job-brief", () => ({
  generateJobBrief: vi.fn(),
}));

vi.mock("@server/services/visa-sponsors/index", () => ({
  searchSponsors: vi.fn(),
  calculateSponsorMatchSummary: vi.fn(),
}));

vi.mock("../progress", () => ({
  updateProgress: vi.fn(),
  progressHelpers: {
    scoringJob: vi.fn(),
    scoringComplete: vi.fn(),
  },
}));

describe("scoreJobsStep LLM routing integration", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    llmConstructors.length = 0;
    llmCalls.length = 0;

    const jobsRepo = await import("@server/repositories/jobs");
    const settingsRepo = await import("@server/repositories/settings");
    const settings = await import("@server/services/settings");
    const jobBrief = await import("@server/services/job-brief");
    const visaSponsors = await import("@server/services/visa-sponsors/index");

    vi.mocked(jobsRepo.updateJob).mockResolvedValue(null);
    vi.mocked(settingsRepo.getSetting).mockResolvedValue(null);
    vi.mocked(settingsRepo.getAllSettings).mockResolvedValue({
      llmPurposeApiKeys: JSON.stringify({ scoringLowTier: "cheap-key" }),
    });
    vi.mocked(settings.getEffectiveSettings).mockResolvedValue({
      model: { value: "gpt-5.5", default: "gpt-5.5", override: null },
      modelScorer: { value: "deepseek-v4-flash", override: null },
      modelTailoring: { value: "gpt-5.5", override: null },
      modelProjectSelection: { value: "gpt-5.5", override: null },
      llmProvider: { value: "codex", default: "codex", override: null },
      llmBaseUrl: { value: null, default: null, override: null },
      llmPurposeOverrides: {
        value: {
          scoringLowTier: {
            provider: "openai_compatible",
            baseUrl: "https://opencode.ai/zen/go/v1/chat/completions",
            model: "deepseek-v4-flash",
          },
        },
        default: {},
        override: null,
      },
      scoringInstructions: { value: "", default: "", override: null },
      penalizeMissingSalary: { value: false, default: false, override: null },
      missingSalaryPenalty: { value: 10, default: 10, override: null },
    } as any);
    vi.mocked(jobBrief.generateJobBrief).mockResolvedValue(null);
    vi.mocked(visaSponsors.searchSponsors).mockResolvedValue([]);
    vi.mocked(visaSponsors.calculateSponsorMatchSummary).mockReturnValue({
      sponsorMatchScore: 0,
      sponsorMatchNames: null,
    });
  });

  it("routes jobs through scorer, model selection, and configured LLM runtime", async () => {
    const jobsRepo = await import("@server/repositories/jobs");

    vi.mocked(jobsRepo.getUnscoredDiscoveredJobs).mockResolvedValue([
      createJob({
        id: "job-ai",
        title: "AI Engineer",
        employer: "Acme AI",
        jobDescription: "Build AI systems",
        suitabilityScore: null,
        suitabilityReason: null,
      }),
      createJob({
        id: "job-ios",
        title: "iOS Developer",
        employer: "Mobile Co",
        jobDescription: "Build iOS apps",
        suitabilityScore: null,
        suitabilityReason: null,
      }),
    ]);

    await scoreJobsStep({ profile: { target: "AI/ML engineering" } });

    expect(llmConstructors).toEqual(
      expect.arrayContaining([
        {
          provider: "codex",
          baseUrl: null,
          apiKey: null,
        },
        {
          provider: "openai_compatible",
          baseUrl: "https://opencode.ai/zen/go/v1/chat/completions",
          apiKey: "cheap-key",
        },
      ]),
    );
    expect(llmCalls).toEqual(
      expect.arrayContaining([
        { model: "gpt-5.5", jobId: "job-ai" },
        { model: "deepseek-v4-flash", jobId: "job-ios" },
      ]),
    );
    expect(jobsRepo.updateJob).toHaveBeenCalledWith(
      "job-ai",
      expect.objectContaining({ suitabilityScore: 77 }),
    );
    expect(jobsRepo.updateJob).toHaveBeenCalledWith(
      "job-ios",
      expect.objectContaining({ suitabilityScore: 77 }),
    );
  });
});
