import type { AiProfileTask } from "../../shared/contracts";
import { captureWorkflowOutcome, unwrapWorkflowOutcome, type WorkflowOutcome } from "../../shared/workflowOutcome";
import { generateLocalAiJson, generateLocalAiVisionJson } from "./localAiRuntimeService";

type TextInput = Parameters<typeof generateLocalAiJson>[0];
type VisionInput = Parameters<typeof generateLocalAiVisionJson>[0];
interface RequestContext {
  task: AiProfileTask;
  profileId?: string | null;
}
export type AiTextRequest = TextInput & RequestContext;
export type AiVisionRequest = VisionInput & RequestContext;
export type AiRequest =
  | { kind: "text"; input: AiTextRequest }
  | { kind: "vision"; input: AiVisionRequest };
export interface AiResponse {
  model: string;
  responseText: string;
  runtimeNotice: string | null;
  finishReason: string | null;
}

/** One execution boundary; the runtime retains model selection and exclusive scheduling. */
export async function executeAiRequest(request: AiRequest): Promise<WorkflowOutcome<AiResponse>> {
  return captureWorkflowOutcome(async () => {
    if (request.kind === "text") {
      const { task: _task, profileId: _profileId, ...runtimeInput } = request.input;
      return generateLocalAiJson(runtimeInput);
    }
    const { task: _task, profileId: _profileId, ...runtimeInput } = request.input;
    const response = await generateLocalAiVisionJson(runtimeInput);
    return { ...response, finishReason: null };
  }, request.input.signal);
}

/** Feature adapters retain existing parsing/fallback policy while receiving typed errors. */
export async function generateAiText(input: AiTextRequest): Promise<AiResponse> {
  return unwrapWorkflowOutcome(await executeAiRequest({ kind: "text", input }));
}
export async function generateAiVision(input: AiVisionRequest): Promise<AiResponse> {
  return unwrapWorkflowOutcome(await executeAiRequest({ kind: "vision", input }));
}
