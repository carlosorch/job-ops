import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "@infra/logger";
import * as jobDocumentsRepo from "@server/repositories/job-documents";
import * as jobsRepo from "@server/repositories/jobs";
import {
  createConfiguredLlmService,
  resolveLlmModel,
} from "@server/services/modelSelection";
import { getProfile } from "@server/services/profile";
import { storeJobDocument } from "@server/services/job-document-storage";
import type { JobDocument, ResumeProfile } from "@shared/types";

const COVER_LETTER_SCHEMA = {
  name: "cover_letter",
  schema: {
    type: "object",
    properties: {
      letter: {
        type: "string",
        description: "A concise, human-sounding cover letter ready for review.",
      },
    },
    required: ["letter"],
    additionalProperties: false,
  },
} as const;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function compactProfile(profile: ResumeProfile): Record<string, unknown> {
  return {
    basics: {
      name: profile.basics?.name,
      label: profile.basics?.label ?? profile.basics?.headline,
      summary: profile.basics?.summary,
      location: profile.basics?.location,
    },
    skills: profile.sections?.skills,
    projects: profile.sections?.projects?.items?.map((project) => ({
      name: project.name,
      description: project.description,
      keywords: project.keywords,
    })),
    experience: profile.sections?.experience?.items?.map((item) => ({
      company: item.company,
      position: item.position,
      summary: item.summary,
    })),
    education: profile.sections?.education?.items?.map((item) => ({
      institution: item.institution ?? item.school,
      area: item.area,
      studyType: item.studyType,
    })),
  };
}

function buildPrompt(args: {
  jobTitle: string;
  employer: string;
  jobDescription: string;
  profile: ResumeProfile;
}): string {
  return `Write a job-specific cover letter for human review.

TARGET ROLE:
Title: ${args.jobTitle}
Company: ${args.employer}

JOB DESCRIPTION:
${args.jobDescription.slice(0, 7000)}

CANDIDATE PROFILE JSON:
${JSON.stringify(compactProfile(args.profile), null, 2)}

NON-NEGOTIABLE FACT RULES:
- Use only the candidate facts in the profile. Do not invent employers, dates, degrees, certifications, skills, metrics, or projects.
- If a useful detail is missing, leave it out rather than guessing.
- Keep it compatible with a junior/graduate software/AI profile unless the profile clearly says otherwise.

COVER LETTER REQUIREMENTS:
- One page worth of text, about 220 to 320 words.
- Professional but natural. No exaggerated enthusiasm.
- Mention the target company only where it feels natural, not in every paragraph.
- Start directly. Do not use "I am writing to express my interest".
- End with a simple, polite closing.
- Do not include placeholders like [Hiring Manager] unless no better salutation is possible; use "Dear Hiring Team," by default.

HUMANIZATION / WIKIPEDIA-STYLE ANTI-AI-SIGNAL RULES:
- Avoid promotional tone, over-symbolism, and grand claims.
- Avoid vague attribution and generic filler.
- Avoid formulaic three-part lists and repetitive parallel structures.
- Avoid em dashes.
- Avoid common AI words and transitions such as "delve", "leverage", "robust", "seamless", "landscape", "moreover", "furthermore", "in today's world", and "testament".
- Prefer concrete phrasing, active voice, varied sentence length, and modest confidence.
- Revise once before returning so it reads like a real person wrote it.

Return JSON only.`;
}

function neutralFileName(candidateName: string | undefined): string {
  const base = (candidateName || "Carlos Ortega Chirito")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "");
  return `${base || "Cover_Letter"}_Cover_Letter.pdf`;
}

function escapeTypstText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/([\\#*$@_[\]{}<>`])/g, "\\$1");
}

function contactLine(profile: ResumeProfile): string {
  const basics = profile.basics;
  const parts = [basics?.email, basics?.phone, basics?.location, basics?.url]
    .map((part) => text(part))
    .filter(Boolean);
  return parts.join(" · ");
}

function buildCoverLetterTypst(args: {
  candidateName: string;
  contact: string;
  jobTitle: string;
  employer: string;
  letter: string;
}): string {
  const paragraphs = args.letter
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => escapeTypstText(paragraph).replace(/\n+/g, " "));

  const body = paragraphs.map((paragraph) => paragraph).join("\n\n");
  const today = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return `#set document(title: "${escapeTypstText(args.candidateName)} Cover Letter", author: "${escapeTypstText(args.candidateName)}")
#set page(paper: "a4", margin: (x: 21mm, y: 18mm))
#set text(font: "New Computer Modern", size: 10.6pt, fill: rgb("222222"))
#set par(justify: true, leading: 0.62em, spacing: 0.9em)

#let accent = rgb("2f5d7c")

#align(center)[
  #text(size: 18pt, weight: "bold", fill: accent)[${escapeTypstText(args.candidateName)}]
  #v(2mm)
  #text(size: 8.8pt, fill: rgb("555555"))[${escapeTypstText(args.contact)}]
]

#v(5mm)
#line(length: 100%, stroke: 0.45pt + accent)
#v(7mm)

#grid(columns: (1fr, auto), gutter: 12mm)[
  #block[
    #text(weight: "semibold")[Application for ${escapeTypstText(args.jobTitle)}]
    #linebreak()
    #text(fill: rgb("555555"))[${escapeTypstText(args.employer)}]
  ]
][
  #text(fill: rgb("555555"))[${escapeTypstText(today)}]
]

#v(6mm)

${body}
`;
}

async function runTypst(inputPath: string, outputPath: string): Promise<void> {
  const binary = process.env.TYPST_BIN?.trim() || "typst";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ["compile", inputPath, outputPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`Typst failed with exit code ${code}: ${stderr.trim()}`),
        );
    });
  });
}

async function renderCoverLetterPdf(args: {
  jobId: string;
  profile: ResumeProfile;
  jobTitle: string;
  employer: string;
  letter: string;
}): Promise<Buffer> {
  const tempDir = await mkdtemp(join(tmpdir(), "job-ops-cover-letter-"));
  const typPath = join(tempDir, "cover-letter.typ");
  const pdfPath = join(tempDir, "cover-letter.pdf");
  try {
    await writeFile(
      typPath,
      buildCoverLetterTypst({
        candidateName:
          text(args.profile.basics?.name) || "Carlos Ortega Chirito",
        contact: contactLine(args.profile),
        jobTitle: args.jobTitle || "the role",
        employer: args.employer || "the company",
        letter: args.letter,
      }),
      "utf8",
    );
    await runTypst(typPath, pdfPath);
    return await readFile(pdfPath);
  } catch (error) {
    logger.error("Cover letter PDF rendering failed", {
      jobId: args.jobId,
      error,
    });
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function generateCoverLetterDocument(
  jobId: string,
): Promise<
  { success: true; document: JobDocument } | { success: false; error: string }
> {
  try {
    const job = await jobsRepo.getJobById(jobId);
    if (!job) return { success: false, error: "Job not found" };

    const [profile, model] = await Promise.all([
      getProfile(),
      resolveLlmModel("tailoring"),
    ]);
    const llm = await createConfiguredLlmService("tailoring");
    const result = await llm.callJson<{ letter: string }>({
      model,
      messages: [
        {
          role: "user",
          content: buildPrompt({
            jobTitle: text(job.title),
            employer: text(job.employer),
            jobDescription: text(job.jobDescription),
            profile,
          }),
        },
      ],
      jsonSchema: COVER_LETTER_SCHEMA,
    });

    if (!result.success) {
      const context = `provider=${llm.getProvider()} baseUrl=${llm.getBaseUrl()}`;
      return { success: false, error: `${result.error} (${context})` };
    }

    const letter = text(result.data.letter);
    if (!letter)
      return {
        success: false,
        error: "Cover letter generation returned empty content",
      };

    const fileName = neutralFileName(profile.basics?.name);
    const pdfBytes = await renderCoverLetterPdf({
      jobId,
      profile,
      jobTitle: text(job.title),
      employer: text(job.employer),
      letter,
    });
    const stored = await storeJobDocument({
      jobId,
      fileName,
      mediaType: "application/pdf",
      dataBase64: pdfBytes.toString("base64"),
    });

    const document = await jobDocumentsRepo.createJobDocument({
      jobId,
      fileName: stored.fileName,
      mediaType: stored.mediaType,
      byteSize: stored.byteSize,
      storagePath: stored.storagePath,
    });

    logger.info("Cover letter document generated", {
      jobId,
      documentId: document.id,
      fileName: document.fileName,
    });

    return { success: true, document };
  } catch (error) {
    logger.error("Cover letter generation failed", { jobId, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
