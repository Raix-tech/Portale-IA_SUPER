import { GoogleGenAI } from '@google/genai';
import type {
  ConnectionTestResult,
  ModelCapability,
  ModelInfo,
  NormalizedAIError,
  TokenUsage,
} from '../../src/types/ai.ts';
import { normalizeProviderError } from './errorNormalizer.ts';
import type {
  AdapterContext,
  NormalizedChatRequest,
  NormalizedChatResponse,
  ProviderAdapter,
  ProviderStatusResult,
  StreamDelta,
} from './types.ts';

function inferGeminiCapabilities(modelId: string, description = ''): ModelCapability[] {
  const caps = new Set<ModelCapability>(['text', 'multimodal']);
  const lower = `${modelId} ${description}`.toLowerCase();
  if (lower.includes('pro') || lower.includes('neon') || lower.includes('carbon') || lower.includes('code')) {
    caps.add('coding');
  }
  if (
    lower.includes('pro') ||
    lower.includes('thinking') ||
    lower.includes('neon') ||
    lower.includes('carbon') ||
    lower.includes('2.5') ||
    lower.includes('3.') ||
    lower.includes('4-')
  ) {
    caps.add('reasoning');
  }
  return Array.from(caps);
}

function getHttpStatusFromError(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { status?: number; statusCode?: number; code?: number };
  if (typeof e.status === 'number') return e.status;
  if (typeof e.statusCode === 'number') return e.statusCode;
  if (typeof e.code === 'number' && e.code >= 100 && e.code < 600) return e.code;
  return undefined;
}

export class GeminiAdapter implements ProviderAdapter {
  readonly id = 'gemini';

  private createClient(apiKey?: string): GoogleGenAI {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('MISSING_API_KEY');
    }
    return new GoogleGenAI({
      apiKey: apiKey.trim(),
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  normalizeError(
    error: unknown,
    httpStatus?: number,
    responseBody?: string,
  ): NormalizedAIError {
    return normalizeProviderError(
      'gemini',
      'Google Gemini',
      error,
      httpStatus ?? getHttpStatusFromError(error),
      responseBody,
    );
  }

  async testConnection(ctx: AdapterContext): Promise<ConnectionTestResult> {
    const start = Date.now();
    if (!ctx.apiKey || ctx.apiKey.trim().length === 0) {
      return {
        ok: false,
        status: 'not_configured',
        latencyMs: Date.now() - start,
        message: 'API key Google Gemini mancante.',
      };
    }

    try {
      const base = (ctx.meta.baseUrl?.trim() || ctx.meta.defaultBaseUrl).replace(/\/+$/, '');
      const res = await fetch(`${base}/models?pageSize=20`, {
        method: 'GET',
        headers: {
          'x-goog-api-key': ctx.apiKey.trim(),
        },
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const body = await res.text();
        const err = this.normalizeError(new Error(`HTTP ${res.status}`), res.status, body);
        return {
          ok: false,
          status: res.status === 429 ? 'rate_limited' : 'error',
          latencyMs,
          message: err.message,
          error: err,
        };
      }
      const json = (await res.json()) as { models?: unknown[] };
      return {
        ok: true,
        status: 'online',
        latencyMs,
        message: `Connessione a Google Gemini verificata (${latencyMs} ms).`,
        modelCount: Array.isArray(json.models) ? json.models.length : undefined,
      };
    } catch (error) {
      const latencyMs = Date.now() - start;
      const err = this.normalizeError(error);
      return {
        ok: false,
        status: err.code === 'HTTP_429' || err.code === 'QUOTA_EXHAUSTED' ? 'rate_limited' : 'error',
        latencyMs,
        message: err.message,
        error: err,
      };
    }
  }

  async getModels(ctx: AdapterContext): Promise<ModelInfo[]> {
    if (!ctx.apiKey || ctx.apiKey.trim().length === 0) {
      throw new Error('MISSING_API_KEY');
    }
    const base = (ctx.meta.baseUrl?.trim() || ctx.meta.defaultBaseUrl).replace(/\/+$/, '');
    const res = await fetch(`${base}/models?pageSize=100`, {
      method: 'GET',
      headers: {
        'x-goog-api-key': ctx.apiKey.trim(),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw this.normalizeError(new Error(`HTTP ${res.status}`), res.status, body);
    }
    const json = (await res.json()) as {
      models?: Array<{
        name: string;
        displayName?: string;
        description?: string;
        inputTokenLimit?: number;
        outputTokenLimit?: number;
        supportedGenerationMethods?: string[];
      }>;
    };

    const rawModels = Array.isArray(json.models) ? json.models : [];
    return rawModels
      .filter((m) => {
        if (!m.supportedGenerationMethods?.includes('generateContent')) return false;
        const lower = m.name.toLowerCase();
        return (
          !lower.includes('embedding') &&
          !lower.includes('imagen') &&
          !lower.includes('veo') &&
          !lower.includes('-tts') &&
          !lower.includes('native-audio') &&
          !lower.includes('aqa')
        );
      })
      .map((m) => {
        const cleanId = m.name.replace(/^models\//, '');
        return {
          id: cleanId,
          name: m.displayName || cleanId,
          providerId: 'gemini',
          providerName: 'Google Gemini',
          contextWindow: m.inputTokenLimit,
          pricingTier: 'unknown',
          supportsStreaming: true,
          supportsToolCalling: true,
          capabilities: inferGeminiCapabilities(cleanId, m.description),
          description: m.description,
        };
      });
  }

  private buildContents(req: NormalizedChatRequest) {
    return req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> =
          [];
        if (m.attachments && m.attachments.length > 0 && m.role === 'user') {
          for (const att of m.attachments) {
            parts.push({
              inlineData: {
                mimeType: att.mimeType,
                data: att.dataBase64,
              },
            });
          }
        }
        if (m.content) {
          parts.push({ text: m.content });
        }
        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts,
        };
      });
  }

  async sendMessage(
    ctx: AdapterContext,
    req: NormalizedChatRequest,
  ): Promise<NormalizedChatResponse> {
    const start = Date.now();
    const ai = this.createClient(ctx.apiKey);
    try {
      const response = await ai.models.generateContent({
        model: req.modelId,
        contents: this.buildContents(req),
        config: {
          ...(req.systemPrompt ? { systemInstruction: req.systemPrompt } : {}),
        },
      });

      const blockReason = response.promptFeedback?.blockReason;
      const finishReason = response.candidates?.[0]?.finishReason;
      if (blockReason || finishReason === 'SAFETY') {
        throw this.normalizeError(new Error(`SAFETY: ${blockReason || finishReason}`));
      }

      const usageMeta = response.usageMetadata;
      const usage: TokenUsage | undefined = usageMeta
        ? {
            inputTokens: usageMeta.promptTokenCount,
            outputTokens: usageMeta.candidatesTokenCount,
            totalTokens: usageMeta.totalTokenCount,
          }
        : undefined;

      return {
        text: response.text ?? '',
        modelId: req.modelId,
        usage,
        latencyMs: Date.now() - start,
        finishReason,
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'providerId' in error) {
        throw error;
      }
      throw this.normalizeError(error);
    }
  }

  async streamMessage(
    ctx: AdapterContext,
    req: NormalizedChatRequest,
    onChunk: (chunk: StreamDelta) => void,
    signal?: AbortSignal,
  ): Promise<NormalizedChatResponse> {
    const start = Date.now();
    const ai = this.createClient(ctx.apiKey);
    try {
      const stream = await ai.models.generateContentStream({
        model: req.modelId,
        contents: this.buildContents(req),
        config: {
          ...(req.systemPrompt ? { systemInstruction: req.systemPrompt } : {}),
        },
      });

      let fullText = '';
      let usage: TokenUsage | undefined;
      let finishReason: string | undefined;

      for await (const chunk of stream) {
        if (signal?.aborted || req.signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        const blockReason = chunk.promptFeedback?.blockReason;
        const candidateFinish = chunk.candidates?.[0]?.finishReason;
        if (blockReason || candidateFinish === 'SAFETY') {
          throw this.normalizeError(new Error(`SAFETY: ${blockReason || candidateFinish}`));
        }
        if (candidateFinish) finishReason = candidateFinish;

        if (chunk.usageMetadata) {
          usage = {
            inputTokens: chunk.usageMetadata.promptTokenCount,
            outputTokens: chunk.usageMetadata.candidatesTokenCount,
            totalTokens: chunk.usageMetadata.totalTokenCount,
          };
        }

        const delta = chunk.text ?? '';
        if (delta) {
          fullText += delta;
          onChunk({ delta, usage });
        }
      }

      return {
        text: fullText,
        modelId: req.modelId,
        usage,
        latencyMs: Date.now() - start,
        finishReason,
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'providerId' in error) {
        throw error;
      }
      throw this.normalizeError(error);
    }
  }

  async getProviderStatus(ctx: AdapterContext): Promise<ProviderStatusResult> {
    if (!ctx.meta.enabled) return { status: 'disabled' };
    if (!ctx.apiKey) return { status: 'not_configured' };
    const test = await this.testConnection(ctx);
    return {
      status: test.status,
      latencyMs: test.latencyMs,
      lastError: test.error,
    };
  }
}
