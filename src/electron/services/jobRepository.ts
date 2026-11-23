import { randomUUID } from "node:crypto";
import type { JobOwnerType, JobRecord, OperationUpdate } from "../../shared/contracts";
import { readDatabase, updateDatabase } from "./database";

interface CreateJobInput {
  workspaceId: string;
  clipId: string | null;
  jobType: string;
  assetType?: JobOwnerType;
  assetId?: string | null;
}

type JobUpdateListener = (operation: OperationUpdate) => void;
const listeners = new Set<JobUpdateListener>();

export function listJobs(): JobRecord[] {
  return [...readDatabase().jobs].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function subscribeJobUpdates(listener: JobUpdateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function createJob(input: CreateJobInput): JobRecord {
  const job = updateDatabase((store) => {
    const now = new Date().toISOString();
    const assetType = input.assetType ?? inferJobOwnerType(input);
    const assetId = assetType === "workspace" ? null : input.assetId ?? input.clipId;
    const job: JobRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      assetType,
      assetId,
      clipId: input.clipId,
      jobType: input.jobType,
      status: "queued",
      errorMessage: null,
      phase: null,
      percent: null,
      elapsedMs: 0,
      etaMs: null,
      etaBasis: "unavailable",
      message: null,
      cancellable: false,
      createdAt: now,
      updatedAt: now
    };

    store.jobs.push(job);
    return job;
  });
  publishJob(job);
  return job;
}

export function updateJobStatus(
  jobId: string,
  status: JobRecord["status"],
  errorMessage: string | null = null
): void {
  const job = updateDatabase((store) => {
    const job = store.jobs.find((existingJob) => existingJob.id === jobId);
    if (!job) {
      return null;
    }

    if (isTerminalJobStatus(job.status)) {
      return null;
    }

    job.status = status;
    job.errorMessage = errorMessage;
    job.updatedAt = new Date().toISOString();
    return job;
  });
  if (job) {
    publishJob(job);
  }
}

export function updateJobProgress(
  jobId: string,
  update: Partial<Pick<JobRecord, "phase" | "percent" | "elapsedMs" | "etaMs" | "etaBasis" | "message" | "cancellable">>
): void {
  const job = updateDatabase((store) => {
    const job = store.jobs.find((existingJob) => existingJob.id === jobId);
    if (!job) {
      return null;
    }

    if (isTerminalJobStatus(job.status)) {
      return null;
    }

    Object.assign(job, update, { updatedAt: new Date().toISOString() });
    return job;
  });
  if (job) {
    publishJob(job);
  }
}

export function markRunningJobsInterrupted(): void {
  const jobs = updateDatabase((store) => {
    const interrupted: JobRecord[] = [];
    const now = new Date().toISOString();
    for (const job of store.jobs) {
      if (job.status === "queued" || job.status === "running") {
        job.status = "interrupted" as JobRecord["status"];
        job.message = "Creator Workbench closed before this operation completed.";
        job.errorMessage = null;
        job.cancellable = false;
        job.etaMs = null;
        job.etaBasis = "unavailable";
        job.updatedAt = now;
        interrupted.push(job);
      }
    }
    return interrupted;
  });
  jobs.forEach(publishJob);
}

function publishJob(job: JobRecord): void {
  const status = job.status as OperationUpdate["status"];
  const operation: OperationUpdate = {
    id: job.id,
    resourceType: job.jobType,
    resourceId: job.assetId ?? job.clipId,
    operationType: job.jobType,
    status,
    phase: job.phase ?? null,
    percent: job.percent ?? null,
    elapsedMs: job.elapsedMs ?? 0,
    etaMs: job.etaMs ?? null,
    etaBasis: job.etaBasis ?? "unavailable",
    message: job.message ?? null,
    errorMessage: job.errorMessage ?? null,
    cancellable: job.cancellable ?? false,
    updatedAt: job.updatedAt
  };
  listeners.forEach((listener) => listener(operation));
}

function inferJobOwnerType(input: CreateJobInput): JobOwnerType {
  if (input.jobType.includes("long_form")) {
    return "long_form_source";
  }
  return input.clipId ? "clip" : "workspace";
}

function isTerminalJobStatus(status: JobRecord["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "interrupted";
}
