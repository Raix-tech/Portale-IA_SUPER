import type {
  ConnectionTestResult,
  ModelCapability,
  ModelInfo,
  ModelPricingTier,
  NormalizedAIError,
  TokenUsage,
} from '../../src/types/ai.ts';
import { validateOutboundUrl } from '../ssrfGuard.ts';
import { normalizeProviderError } from './errorNormalizer.ts';
import type {
  AdapterContext,
  NormalizedChatRequest,
  NormalizedChatResponse,
  ProviderAdapter,
  ProviderStatusResult,
  StreamDelta,
} from './types.ts';

const DEFAULT_TIMEOUT_MS = 45000;
const TEST_TIMEOUT_MS = 12000;

function joinUrl(baseUrl: string, endpoint: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${cleanBase}${cleanEndpoint}`;
}

function inferCapabilitiesFromText(
  id: string,
  name: string,
  description = '',
  modalities?: string[],
): ModelCapability[] {
  const caps = new Set<ModelCapability>(['text']);
  const text = `${id} ${name} ${description}`.toLowerCase();

  if (
    text.includes('code') ||
    text.includes('coder') ||
    text.includes('codestral') ||
    text.includes('starcoder') ||
    text.includes('deepseek-coder')
  ) {
    caps.add('coding');
  }
  if (
    text.includes('reason') ||
    text.includes('thinking') ||
    text.includes('r1') ||
    text.includes('qwq') ||
    text.includes('o1') ||
    text.includes('o3') ||
    text.includes('o4')
  ) {
    caps.add('reasoning');
  }
  if (
    (modalities && modalities.some((m) => m.includes('image') || m.includes('vision'))) ||
    text.includes('vision') ||
    text.includes('pixtral') ||
    text.includes('vl') ||
    text.includes('-v-') ||
    text.includes('multimodal')
  ) {
    caps.add('multimodal');
  }
  return Array.from(caps);
}

function parseUsage(rawUsage: unknown): TokenUsage | undefined {
  if (!rawUsage || typeof rawUsage !== 'object') return undefined;
  const u = rawUsage as {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
  const inputTokens = u.prompt_tokens ?? u.input_tokens;
  const outputTokens = u.completion_tokens ?? u.output_tokens;
  const totalTokens =
    u.total_tokens ??
    (typeof inputTokens === 'number' && typeof outputTokens === 'number'
      ? inputTokens + outputTokens
      : undefined);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return { inputTokens, outputTokens, totalTokens };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  await validateOutboundUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Request timeout')), timeoutMs);

  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      throw new DOMException('Aborted', 'AbortError');
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly id: string;

  constructor(id: string) {
    this.id = id;
  }

  private getBaseUrl(ctx: AdapterContext): string {
    if (ctx.meta.id === 'cloudflare') {
      const accountId = ctx.meta.accountId?.trim();
      if (!accountId) {
        throw new Error('Account ID Cloudflare mancante.');
      }
      const base = (ctx.meta.baseUrl?.trim() || ctx.meta.defaultBaseUrl).replace(/\/+$/, '');
      return `${base}/accounts/${encodeURIComponent(accountId)}/ai/v1`;
    }
    return (ctx.meta.baseUrl?.trim() || ctx.meta.defaultBaseUrl).replace(/\/+$/, '');
  }

  private getHeaders(ctx: AdapterContext): Record<string, string> {
    const hasKey = Boolean(ctx.apiKey && ctx.apiKey.trim().length > 0);
    const allowAnon = Boolean(ctx.meta.supportsAnonymous && ctx.meta.anonymousMode);

    if (!hasKey && !allowAnon) {
      throw new Error('MISSING_API_KEY');
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (hasKey && ctx.apiKey) {
      headers.Authorization = `Bearer ${ctx.apiKey.trim()}`;
    }

    if (ctx.meta.id === 'openrouter' || ctx.meta.id === 'kilo' || ctx.meta.id === 'pollinations') {
      headers['X-Title'] = 'Free AI Hub';
    }

    if (ctx.customHeaders) {
      for (const [k, v] of Object.entries(ctx.customHeaders)) {
        if (k.trim() && v !== undefined) {
          headers[k.trim()] = v;
        }
      }
    }
    return headers;
  }

  normalizeError(
    error: unknown,
    httpStatus?: number,
    responseBody?: string,
  ): NormalizedAIError {
    return normalizeProviderError(this.id, this.id, error, httpStatus, responseBody);
  }

  private normalizeWithCtx(
    ctx: AdapterContext,
    error: unknown,
    httpStatus?: number,
    responseBody?: string,
  ): NormalizedAIError {
    return normalizeProviderError(ctx.meta.id, ctx.meta.name, error, httpStatus, responseBody);
  }

  async testConnection(ctx: AdapterContext): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const headers = this.getHeaders(ctx);
      let testUrl: string;

      if (ctx.meta.id === 'openrouter' && !ctx.meta.baseUrl) {
        testUrl = 'https://openrouter.ai/api/v1/auth/key';
      } else if (ctx.meta.id === 'cloudflare') {
        const accountId = ctx.meta.accountId?.trim();
        if (!accountId) {
          return {
            ok: false,
            status: 'not_configured',
            latencyMs: Date.now() - start,
            message: 'Account ID Cloudflare mancante.',
          };
        }
        const rootBase = (ctx.meta.baseUrl?.trim() || ctx.meta.defaultBaseUrl).replace(/\/+$/, '');
        testUrl = `${rootBase}/accounts/${encodeURIComponent(accountId)}/ai/models/search?per_page=1`;
      } else {
        const base = this.getBaseUrl(ctx);
        const modelsEndpoint = ctx.meta.modelsEndpoint || '/models';
        testUrl = joinUrl(base, modelsEndpoint);
      }

      const res = await fetchWithTimeout(
        testUrl,
        { method: 'GET', headers },
        TEST_TIMEOUT_MS,
      );
      const latencyMs = Date.now() - start;

      if (!res.ok) {
        const body = await res.text();
        const err = this.normalizeWithCtx(ctx, new Error(`HTTP ${res.status}`), res.status, body);
        return {
          ok: false,
          status: res.status === 429 ? 'rate_limited' : 'error',
          latencyMs,
          message: err.message,
          error: err,
        };
      }

      // Parse model count if returned by /models
      let modelCount: number | undefined;
      try {
        const json = (await res.json()) as { data?: unknown[]; result?: unknown[] };
        if (Array.isArray(json.data)) modelCount = json.data.length;
        else if (Array.isArray(json.result)) modelCount = json.result.length;
      } catch {
        // Not critical
      }

      return {
        ok: true,
        status: 'online',
        latencyMs,
        message: `Connessione a ${ctx.meta.name} verificata (${latencyMs} ms).`,
        modelCount,
      };
    } catch (error) {
      const latencyMs = Date.now() - start;
      const err = this.normalizeWithCtx(ctx, error);
      return {
        ok: false,
        status:
          err.code === 'MISSING_API_KEY'
            ? 'not_configured'
            : err.code === 'HTTP_429' || err.code === 'QUOTA_EXHAUSTED'
              ? 'rate_limited'
              : 'error',
        latencyMs,
        message: err.message,
        error: err,
      };
    }
  }

  async getModels(ctx: AdapterContext): Promise<ModelInfo[]> {
    const headers = this.getHeaders(ctx);

    if (ctx.meta.id === 'cloudflare') {
      const accountId = ctx.meta.accountId?.trim();
      if (!accountId) {
        throw new Error('Account ID Cloudflare mancante.');
      }
      const rootBase = (ctx.meta.baseUrl?.trim() || ctx.meta.defaultBaseUrl).replace(/\/+$/, '');
      const url = `${rootBase}/accounts/${encodeURIComponent(accountId)}/ai/models/search?per_page=100&task=Text+Generation`;
      const res = await fetchWithTimeout(url, { method: 'GET', headers }, TEST_TIMEOUT_MS);
      if (!res.ok) {
        const body = await res.text();
        throw this.normalizeWithCtx(ctx, new Error(`HTTP ${res.status}`), res.status, body);
      }
      const json = (await res.json()) as {
        result?: Array<{
          id?: string;
          name?: string;
          description?: string;
          task?: { name?: string };
          properties?: Array<{ property_id?: string; value?: string | number }>;
        }>;
      };
      const rows = Array.isArray(json.result) ? json.result : [];
      return rows
        .filter((r) => Boolean(r.name))
        .map((r) => {
          const modelId = r.name ?? r.id ?? '';
          const ctxProp = r.properties?.find((p) => p.property_id === 'context_window');
          const contextWindow = ctxProp?.value ? Number(ctxProp.value) : undefined;
          return {
            id: modelId,
            name: modelId.split('/').pop() || modelId,
            providerId: ctx.meta.id,
            providerName: ctx.meta.name,
            contextWindow: Number.isFinite(contextWindow) ? contextWindow : undefined,
            pricingTier: 'unknown' as ModelPricingTier,
            supportsStreaming: true,
            capabilities: inferCapabilitiesFromText(modelId, modelId, r.description),
            description: r.description,
          };
        });
    }

    const base = this.getBaseUrl(ctx);
    const modelsUrl = joinUrl(base, ctx.meta.modelsEndpoint || '/models');
    const res = await fetchWithTimeout(modelsUrl, { method: 'GET', headers }, TEST_TIMEOUT_MS);

    if (!res.ok) {
      const body = await res.text();
      if (ctx.meta.kind === 'custom' && res.status === 404 && ctx.meta.defaultModel) {
        return [
          {
            id: ctx.meta.defaultModel,
            name: ctx.meta.defaultModel,
            providerId: ctx.meta.id,
            providerName: ctx.meta.name,
            pricingTier: 'unknown',
            supportsStreaming: true,
            capabilities: inferCapabilitiesFromText(ctx.meta.defaultModel, ctx.meta.defaultModel),
          },
        ];
      }
      throw this.normalizeWithCtx(ctx, new Error(`HTTP ${res.status}`), res.status, body);
    }

    const json = (await res.json()) as {
      data?: Array<Record<string, unknown>>;
    };
    const rawList = Array.isArray(json.data) ? json.data : Array.isArray(json) ? (json as unknown as Array<Record<string, unknown>>) : [];

    const models: ModelInfo[] = [];
    for (const item of rawList) {
      const id = typeof item.id === 'string' ? item.id : '';
      if (!id) continue;
      // Skip non-chat audio/whisper/tts/embedding/guard/image/video models
      const lowerId = id.toLowerCase();
      if (
        lowerId.includes('whisper') ||
        lowerId.includes('embed') ||
        lowerId.includes('moderation') ||
        lowerId.includes('tts') ||
        lowerId.includes('orpheus') ||
        lowerId.includes('prompt-guard') ||
        lowerId.includes('llama-guard') ||
        lowerId.includes('safeguard') ||
        lowerId.includes('dall-e') ||
        lowerId.includes('transcribe') ||
        lowerId.includes('rerank') ||
        lowerId.includes('sora') ||
        lowerId.includes('cogview') ||
        lowerId.includes('cogvideo')
      ) {
        continue;
      }
      if (
        Array.isArray(item.output_modalities) &&
        !item.output_modalities.includes('text')
      ) {
        continue;
      }
      if (ctx.meta.id === 'mistral') {
        const caps = item.capabilities as { completion_chat?: boolean } | undefined;
        if (caps && caps.completion_chat === false) continue;
      }

      const name = typeof item.name === 'string' && item.name ? item.name : id;
      const description = typeof item.description === 'string' ? item.description : undefined;

      let contextWindow: number | undefined;
      if (typeof item.context_length === 'number') contextWindow = item.context_length;
      else if (typeof item.context_window === 'number') contextWindow = item.context_window;
      else if (typeof item.max_context_length === 'number') contextWindow = item.max_context_length;

      let pricingTier: ModelPricingTier = 'unknown';
      let knownLimits: string | undefined;
      if (
        (ctx.meta.id === 'openrouter' || ctx.meta.id === 'kilo') &&
        item.pricing &&
        typeof item.pricing === 'object'
      ) {
        const pricing = item.pricing as { prompt?: string | number; completion?: string | number };
        const p = Number(pricing.prompt);
        const c = Number(pricing.completion);
        if (
          pricing.prompt !== undefined &&
          pricing.completion !== undefined &&
          !Number.isNaN(p) &&
          !Number.isNaN(c) &&
          p === 0 &&
          c === 0
        ) {
          pricingTier = 'free';
        } else if (!Number.isNaN(p) && !Number.isNaN(c) && (p > 0 || c > 0)) {
          pricingTier = 'paid';
        }
      } else if (ctx.meta.id === 'pollinations') {
        pricingTier = item.paid_only === true ? 'paid' : 'free_tier';
      } else if (ctx.meta.id === 'zai') {
        if (lowerId.includes('flash')) pricingTier = 'free';
      } else if (
        ctx.meta.id === 'groq' ||
        ctx.meta.id === 'sambanova' ||
        ctx.meta.id === 'mistral' ||
        ctx.meta.id === 'cohere' ||
        ctx.meta.id === 'nvidia'
      ) {
        pricingTier = 'free_tier';
      }
      if (pricingTier === 'unknown' && lowerId.endsWith(':free')) {
        pricingTier = 'free';
      }

      const arch = item.architecture as
        | { input_modalities?: string[]; modality?: string }
        | undefined;
      const modalities = arch?.input_modalities ?? (arch?.modality ? [arch.modality] : undefined);

      const supportedParams = Array.isArray(item.supported_parameters)
        ? (item.supported_parameters as string[])
        : undefined;
      const mistralCaps = item.capabilities as
        | { function_calling?: boolean; vision?: boolean }
        | undefined;

      const supportsToolCalling =
        supportedParams !== undefined
          ? supportedParams.includes('tools')
          : mistralCaps?.function_calling;

      const caps = inferCapabilitiesFromText(id, name, description, modalities);
      if (mistralCaps?.vision && !caps.includes('multimodal')) {
        caps.push('multimodal');
      }

      models.push({
        id,
        name,
        providerId: ctx.meta.id,
        providerName: ctx.meta.name,
        contextWindow,
        pricingTier,
        knownLimits,
        supportsStreaming: true,
        supportsToolCalling,
        capabilities: caps,
        description,
      });
    }

    if (models.length === 0 && ctx.meta.defaultModel) {
      models.push({
        id: ctx.meta.defaultModel,
        name: ctx.meta.defaultModel,
        providerId: ctx.meta.id,
        providerName: ctx.meta.name,
        pricingTier: 'unknown',
        supportsStreaming: true,
        capabilities: inferCapabilitiesFromText(ctx.meta.defaultModel, ctx.meta.defaultModel),
      });
    }

    return models;
  }

  private buildMessagesPayload(req: NormalizedChatRequest): Array<Record<string, unknown>> {
    const messages: Array<Record<string, unknown>> = [];
    if (req.systemPrompt && req.systemPrompt.trim().length > 0) {
      messages.push({ role: 'system', content: req.systemPrompt.trim() });
    }
    for (const msg of req.messages) {
      if (msg.role === 'system') continue;
      if (msg.attachments && msg.attachments.length > 0 && msg.role === 'user') {
        const parts: Array<Record<string, unknown>> = [];
        if (msg.content) {
          parts.push({ type: 'text', text: msg.content });
        }
        for (const att of msg.attachments) {
          if (att.mimeType.startsWith('image/')) {
            parts.push({
              type: 'image_url',
              image_url: {
                url: `data:${att.mimeType};base64,${att.dataBase64}`,
              },
            });
          }
        }
        messages.push({ role: msg.role, content: parts });
      } else {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    return messages;
  }

  async sendMessage(
    ctx: AdapterContext,
    req: NormalizedChatRequest,
  ): Promise<NormalizedChatResponse> {
    const start = Date.now();
    const headers = this.getHeaders(ctx);
    const base = this.getBaseUrl(ctx);
    const endpoint = ctx.meta.chatEndpoint || '/chat/completions';
    const url = joinUrl(base, endpoint);

    const bodyPayload: Record<string, unknown> = {
      model: req.modelId,
      messages: this.buildMessagesPayload(req),
      stream: false,
    };
    if (req.temperature !== undefined) bodyPayload.temperature = req.temperature;
    if (req.maxTokens !== undefined) bodyPayload.max_tokens = req.maxTokens;

    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload),
      },
      DEFAULT_TIMEOUT_MS,
      req.signal,
    );

    if (!res.ok) {
      const errBody = await res.text();
      throw this.normalizeWithCtx(ctx, new Error(`HTTP ${res.status}`), res.status, errBody);
    }

    const json = (await res.json()) as {
      model?: string;
      choices?: Array<{
        message?: { content?: string | Array<{ text?: string }> };
        finish_reason?: string;
      }>;
      usage?: unknown;
    };

    const choice = json.choices?.[0];
    let text = '';
    if (typeof choice?.message?.content === 'string') {
      text = choice.message.content;
    } else if (Array.isArray(choice?.message?.content)) {
      text = choice.message.content.map((p) => p.text ?? '').join('');
    }

    return {
      text,
      modelId: json.model || req.modelId,
      usage: parseUsage(json.usage),
      latencyMs: Date.now() - start,
      finishReason: choice?.finish_reason,
    };
  }

  async streamMessage(
    ctx: AdapterContext,
    req: NormalizedChatRequest,
    onChunk: (chunk: StreamDelta) => void,
    signal?: AbortSignal,
  ): Promise<NormalizedChatResponse> {
    const start = Date.now();
    const headers = this.getHeaders(ctx);
    const base = this.getBaseUrl(ctx);
    const endpoint = ctx.meta.chatEndpoint || '/chat/completions';
    const url = joinUrl(base, endpoint);

    const bodyPayload: Record<string, unknown> = {
      model: req.modelId,
      messages: this.buildMessagesPayload(req),
      stream: true,
    };
    if (
      ctx.meta.id === 'openrouter' ||
      ctx.meta.id === 'groq' ||
      ctx.meta.id === 'sambanova' ||
      ctx.meta.id === 'nvidia' ||
      ctx.meta.id === 'siliconflow' ||
      ctx.meta.id === 'zai'
    ) {
      bodyPayload.stream_options = { include_usage: true };
    }
    if (req.temperature !== undefined) bodyPayload.temperature = req.temperature;
    if (req.maxTokens !== undefined) bodyPayload.max_tokens = req.maxTokens;

    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload),
      },
      DEFAULT_TIMEOUT_MS,
      signal ?? req.signal,
    );

    if (!res.ok) {
      const errBody = await res.text();
      throw this.normalizeWithCtx(ctx, new Error(`HTTP ${res.status}`), res.status, errBody);
    }

    if (!res.body) {
      throw this.normalizeWithCtx(ctx, new Error('Empty stream response'));
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      const json = (await res.json()) as {
        model?: string;
        error?: { message?: string; code?: number };
        choices?: Array<{
          message?: { content?: string | Array<{ text?: string }> };
          finish_reason?: string;
        }>;
        usage?: unknown;
      };
      if (json.error) {
        throw this.normalizeWithCtx(
          ctx,
          new Error(json.error.message || 'Provider JSON error'),
          typeof json.error.code === 'number' ? json.error.code : undefined,
        );
      }
      const choice = json.choices?.[0];
      let text = '';
      if (typeof choice?.message?.content === 'string') {
        text = choice.message.content;
      } else if (Array.isArray(choice?.message?.content)) {
        text = choice.message.content.map((p) => p.text ?? '').join('');
      }
      const usage = parseUsage(json.usage);
      if (text) {
        onChunk({ delta: text, usage });
      }
      return {
        text,
        modelId: json.model || req.modelId,
        usage,
        latencyMs: Date.now() - start,
        finishReason: choice?.finish_reason,
      };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let finalUsage: TokenUsage | undefined;
    let finalModel = req.modelId;
    let finishReason: string | undefined;

    const processLine = (rawLine: string) => {
      const line = rawLine.trim();
      if (!line || !line.startsWith('data:')) return;
      const dataStr = line.slice(5).trim();
      if (dataStr === '[DONE]') return;

      try {
        const parsed = JSON.parse(dataStr) as {
          model?: string;
          error?: { message?: string; code?: number };
          choices?: Array<{
            delta?: { content?: string; reasoning_content?: string };
            finish_reason?: string;
          }>;
          usage?: unknown;
        };
        if (parsed.error) {
          throw this.normalizeWithCtx(
            ctx,
            new Error(parsed.error.message || 'Stream error'),
            typeof parsed.error.code === 'number' ? parsed.error.code : undefined,
          );
        }
        if (parsed.model) finalModel = parsed.model;
        const usage = parseUsage(parsed.usage);
        if (usage) finalUsage = usage;

        const choice = parsed.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const delta = choice?.delta?.content ?? '';
        if (delta) {
          fullText += delta;
          onChunk({ delta, usage });
        } else if (usage) {
          onChunk({ delta: '', usage });
        }
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && 'providerId' in err) {
          throw err;
        }
        // Ignore malformed keepalive SSE chunk
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        processLine(rawLine);
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      for (const rawLine of buffer.split('\n')) {
        processLine(rawLine);
      }
    }

    return {
      text: fullText,
      modelId: finalModel,
      usage: finalUsage,
      latencyMs: Date.now() - start,
      finishReason,
    };
  }

  async getProviderStatus(ctx: AdapterContext): Promise<ProviderStatusResult> {
    if (!ctx.meta.enabled) {
      return { status: 'disabled' };
    }
    const allowAnon = Boolean(ctx.meta.supportsAnonymous && ctx.meta.anonymousMode);
    if (!ctx.apiKey && !allowAnon) {
      return { status: 'not_configured' };
    }
    const test = await this.testConnection(ctx);
    return {
      status: test.status,
      latencyMs: test.latencyMs,
      lastError: test.error,
    };
  }
}
