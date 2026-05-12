import type { LlmProvider, LlmScope } from './auth/llm-keys.js';

export interface RecordCloudLlmUsageInput {
  workspaceId: string;
  provider: LlmProvider;
  scope: LlmScope;
  keySource: 'tenant' | 'shared';
  units?: number;
}

export type RecordCloudLlmUsage = (input: RecordCloudLlmUsageInput) => Promise<unknown>;

let recorder: RecordCloudLlmUsage = async () => ({ status: 'ignored', reason: 'community' });

export function registerCloudLlmUsageRecorder(next: RecordCloudLlmUsage): void {
  recorder = next;
}

export function recordCloudLlmUsage(input: RecordCloudLlmUsageInput): Promise<unknown> {
  return recorder(input);
}
