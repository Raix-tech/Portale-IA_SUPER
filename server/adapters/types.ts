import type {
  ChatAttachment,
  ConnectionTestResult,
  ModelInfo,
  NormalizedAIError,
  ProviderStatusType,
  TokenUsage,
} from '../../src/types/ai.ts';
import type { StoredProviderMeta } from '../store.ts';

export interface AdapterContext {
  meta: StoredProviderMeta;
  apiKey?: string;
  customHeaders?: Record<string, string>;
}

export interface NormalizedMessageInput {
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: ChatAttachment[];
}

export interface NormalizedChatRequest {
  modelId: string;
  messages: NormalizedMessageInput[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface NormalizedChatResponse {
  text: string;
  modelId: string;
  usage?: TokenUsage;
  latencyMs: number;
  finishReason?: string;
}

export interface StreamDelta {
  delta: string;
  usage?: TokenUsage;
}

export interface ProviderStatusResult {
  status: ProviderStatusType;
  latencyMs?: number;
  lastError?: NormalizedAIError;
}

export interface ProviderAdapter {
  readonly id: string;
  testConnection(ctx: AdapterContext): Promise<ConnectionTestResult>;
  getModels(ctx: AdapterContext): Promise<ModelInfo[]>;
  sendMessage(
    ctx: AdapterContext,
    req: NormalizedChatRequest,
  ): Promise<NormalizedChatResponse>;
  streamMessage(
    ctx: AdapterContext,
    req: NormalizedChatRequest,
    onChunk: (chunk: StreamDelta) => void,
    signal?: AbortSignal,
  ): Promise<NormalizedChatResponse>;
  getProviderStatus(ctx: AdapterContext): Promise<ProviderStatusResult>;
  normalizeError(
    error: unknown,
    httpStatus?: number,
    responseBody?: string,
  ): NormalizedAIError;
}
