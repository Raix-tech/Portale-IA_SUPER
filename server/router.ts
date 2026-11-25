import crypto from 'node:crypto';
import type {
  FallbackAttempt,
  ModelInfo,
  NormalizedAIError,
  TaskCategory,
  UsageRecord,
} from '../src/types/ai.ts';
import { type PersistedState, type StoredProviderMeta, saveState } from './store.ts';
import { buildAdapterContext, getAdapterForProvider } from './adapters/registry.ts';
import type { NormalizedChatRequest, NormalizedChatResponse, StreamDelta } from './adapters/types.ts';

export interface RouteCandidate {
  provider: StoredProviderMeta;
  modelId: string;
  modelName: string;
}

export interface RoutedChatResult {
  response: NormalizedChatResponse;
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  fallbackUsed: boolean;
  fallbackChain: FallbackAttempt[];
}

function isProviderConfigured(meta: StoredProviderMeta): boolean {
  const ctx = buildAdapterContext(meta);
  const hasKey = Boolean(ctx.apiKey && ctx.apiKey.trim().length > 0);
  const allowAnon = Boolean(meta.supportsAnonymous && meta.anonymousMode);
  if (!hasKey && !allowAnon) return false;
  if (meta.requiresAccountId) {
    return Boolean(meta.accountId && meta.accountId.trim().length > 0);
  }
  return true;
}

function scoreModelForTask(
  model: ModelInfo,
  task: TaskCategory,
  preferFree: boolean,
  hasAttachments: boolean,
): number {
  let score = 0;

  // Pricing preference
  if (preferFree) {
    if (model.pricingTier === 'free') score += 500;
    else if (model.pricingTier === 'free_tier') score += 400;
    else if (model.pricingTier === 'unknown') score += 200;
    else if (model.pricingTier === 'paid') score -= 300;
  }

  // Vision / attachments requirement
  if (hasAttachments || task === 'vision') {
    if (model.capabilities.includes('multimodal')) score += 300;
    else score -= 400;
  }

  if (task === 'coding') {
    if (model.capabilities.includes('coding')) score += 220;
    const lower = model.id.toLowerCase();
    if (lower.includes('coder') || lower.includes('codestral') || lower.includes('deepseek')) {
      score += 80;
    }
  } else if (task === 'reasoning') {
    if (model.capabilities.includes('reasoning')) score += 220;
    const lower = model.id.toLowerCase();
    if (lower.includes('r1') || lower.includes('thinking') || lower.includes('pro') || lower.includes('neon') || lower.includes('carbon')) {
      score += 60;
    }
  } else if (task === 'fast') {
    const lower = model.id.toLowerCase();
    if (
      lower.includes('flash') ||
      lower.includes('mini') ||
      lower.includes('lite') ||
      lower.includes('8b') ||
      lower.includes('instant') ||
      lower.includes('hydrogen')
    ) {
      score += 180;
    }
    if (model.providerId === 'groq' || model.providerId === 'sambanova') {
      score += 120;
    }
  } else {
    // General balanced score
    if (model.capabilities.includes('text')) score += 50;
    if (model.contextWindow && model.contextWindow >= 32000) score += 30;
  }

  return score;
}

function pickBestModelForProvider(
  provider: StoredProviderMeta,
  models: ModelInfo[],
  task: TaskCategory,
  preferFree: boolean,
  hasAttachments: boolean,
): ModelInfo | undefined {
  const providerModels = models.filter((m) => m.providerId === provider.id);
  if (providerModels.length === 0) {
    if (provider.defaultModel) {
      return {
        id: provider.defaultModel,
        name: provider.defaultModel,
        providerId: provider.id,
        providerName: provider.name,
        pricingTier: 'unknown',
        supportsStreaming: true,
        capabilities: ['text'],
      };
    }
    return undefined;
  }

  const ranked = [...providerModels].sort(
    (a, b) =>
      scoreModelForTask(b, task, preferFree, hasAttachments) -
      scoreModelForTask(a, task, preferFree, hasAttachments),
  );
  return ranked[0];
}

export async function resolveRouteCandidates(
  state: PersistedState,
  options: {
    autoMode: boolean;
    requestedProviderId?: string;
    requestedModelId?: string;
    taskCategory: TaskCategory;
    hasAttachments: boolean;
  },
): Promise<RouteCandidate[]> {
  const { smartRouter } = state.settings;
  const enabledConfigured = state.providers.filter(
    (p) => p.enabled && isProviderConfigured(p),
  );

  if (!options.autoMode && options.requestedProviderId) {
    const primary = state.providers.find((p) => p.id === options.requestedProviderId);
    if (!primary) {
      return [];
    }
    const primaryModels = state.models.filter((m) => m.providerId === primary.id);
    const chosenModel =
      options.requestedModelId ||
      primary.defaultModel ||
      primaryModels[0]?.id ||
      '';
    const chosenModelObj = primaryModels.find((m) => m.id === chosenModel);

    const candidates: RouteCandidate[] = [
      {
        provider: primary,
        modelId: chosenModel,
        modelName: chosenModelObj?.name || chosenModel,
      },
    ];

    if (smartRouter.fallbackEnabled) {
      const priorityIndex = new Map(
        smartRouter.providerPriority.map((id, idx) => [id, idx]),
      );
      const others = enabledConfigured
        .filter((p) => p.id !== primary.id && p.status !== 'error')
        .sort(
          (a, b) =>
            (priorityIndex.get(a.id) ?? 999) - (priorityIndex.get(b.id) ?? 999),
        );

      for (const p of others) {
        let pModels = state.models.filter((m) => m.providerId === p.id);
        if (pModels.length === 0) {
          try {
            const adapter = getAdapterForProvider(p.id);
            const fetched = await adapter.getModels(buildAdapterContext(p));
            if (fetched.length > 0) {
              state.models = [
                ...state.models.filter((m) => m.providerId !== p.id),
                ...fetched,
              ];
              pModels = fetched;
              saveState(state);
            }
          } catch {
            // Skip unreachable fallback during model discovery
          }
        }
        const best = pickBestModelForProvider(
          p,
          pModels,
          options.taskCategory,
          smartRouter.preferFree,
          options.hasAttachments,
        );
        if (best) {
          candidates.push({
            provider: p,
            modelId: best.id,
            modelName: best.name,
          });
        }
      }
    }

    return candidates;
  }

  // AUTO / Smart Router mode
  const priorityIndex = new Map(
    smartRouter.providerPriority.map((id, idx) => [id, idx]),
  );

  // Order providers: online first (unless rate_limited/error), then by user priority,
  // and boost fast providers when task === 'fast'
  const sortedProviders = [...enabledConfigured].sort((a, b) => {
    const statusWeight = (s: StoredProviderMeta['status']) => {
      if (s === 'online') return 0;
      if (s === 'not_configured') return 1;
      if (s === 'rate_limited') return 2;
      if (s === 'error') return 3;
      return 4;
    };
    const sw = statusWeight(a.status) - statusWeight(b.status);
    if (sw !== 0) return sw;

    if (options.taskCategory === 'fast') {
      const fastOrder = (id: string) =>
        id === 'groq' || id === 'sambanova' ? -1 : 0;
      const fw = fastOrder(a.id) - fastOrder(b.id);
      if (fw !== 0) return fw;
    }

    return (priorityIndex.get(a.id) ?? 999) - (priorityIndex.get(b.id) ?? 999);
  });

  const candidates: RouteCandidate[] = [];
  for (const p of sortedProviders) {
    let pModels = state.models.filter((m) => m.providerId === p.id);
    if (pModels.length === 0) {
      try {
        const adapter = getAdapterForProvider(p.id);
        const fetched = await adapter.getModels(buildAdapterContext(p));
        if (fetched.length > 0) {
          state.models = [
            ...state.models.filter((m) => m.providerId !== p.id),
            ...fetched,
          ];
          pModels = fetched;
          saveState(state);
        }
      } catch {
        // Provider might be temporarily unreachable; let execution or next provider handle
      }
    }
    const best = pickBestModelForProvider(
      p,
      pModels,
      options.taskCategory,
      smartRouter.preferFree,
      options.hasAttachments,
    );
    if (best) {
      candidates.push({
        provider: p,
        modelId: best.id,
        modelName: best.name,
      });
    }
  }

  return candidates;
}

function recordUsage(
  state: PersistedState,
  entry: Omit<UsageRecord, 'id' | 'timestamp'>,
): void {
  const record: UsageRecord = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  };
  state.usageLogs.unshift(record);
  if (state.usageLogs.length > 500) {
    state.usageLogs = state.usageLogs.slice(0, 500);
  }
}

export async function executeRoutedChat(
  state: PersistedState,
  params: {
    autoMode: boolean;
    requestedProviderId?: string;
    requestedModelId?: string;
    taskCategory: TaskCategory;
    request: Omit<NormalizedChatRequest, 'modelId'>;
    stream: boolean;
    onMeta?: (meta: {
      providerId: string;
      providerName: string;
      modelId: string;
      modelName: string;
      fallbackUsed: boolean;
      fallbackChain: FallbackAttempt[];
    }) => void;
    onDelta?: (chunk: StreamDelta) => void;
    onFallback?: (attempt: FallbackAttempt, nextCandidate: RouteCandidate) => void;
    signal?: AbortSignal;
  },
): Promise<RoutedChatResult> {
  const hasAttachments = params.request.messages.some(
    (m) => m.attachments && m.attachments.length > 0,
  );

  const candidates = await resolveRouteCandidates(state, {
    autoMode: params.autoMode,
    requestedProviderId: params.requestedProviderId,
    requestedModelId: params.requestedModelId,
    taskCategory: params.taskCategory,
    hasAttachments,
  });

  if (candidates.length === 0) {
    const err: NormalizedAIError = {
      code: 'MISSING_API_KEY',
      message: params.autoMode
        ? 'Nessun provider configurato e abilitato disponibile per AUTO / Smart Router. Configura almeno una API key nella pagina Providers.'
        : 'Provider non configurato o nessun modello selezionato. Verifica la configurazione nella pagina Providers.',
      retryable: false,
      allowFallback: false,
      providerId: params.requestedProviderId || 'auto',
    };
    throw err;
  }

  const fallbackChain: FallbackAttempt[] = [];
  let lastError: NormalizedAIError | undefined;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (params.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const adapter = getAdapterForProvider(candidate.provider.id);
    const ctx = buildAdapterContext(candidate.provider);

    if (!candidate.provider.enabled) {
      const disabledErr: NormalizedAIError = {
        code: 'HTTP_403',
        message: `Il provider ${candidate.provider.name} è attualmente disabilitato.`,
        retryable: false,
        allowFallback: params.autoMode,
        providerId: candidate.provider.id,
      };
      if (!params.autoMode) throw disabledErr;
      lastError = disabledErr;
      continue;
    }

    const allowAnon = Boolean(candidate.provider.supportsAnonymous && candidate.provider.anonymousMode);
    if (!ctx.apiKey && !allowAnon) {
      const missingErr: NormalizedAIError = {
        code: 'MISSING_API_KEY',
        message: `API key mancante per ${candidate.provider.name}. Configurala nella pagina Providers.`,
        retryable: false,
        allowFallback: false,
        providerId: candidate.provider.id,
      };
      if (!params.autoMode) throw missingErr;
      lastError = missingErr;
      continue;
    }

    if (!candidate.modelId) {
      const noModelErr: NormalizedAIError = {
        code: 'MODEL_UNAVAILABLE',
        message: `Nessun modello disponibile o selezionato per ${candidate.provider.name}. Aggiorna la lista modelli.`,
        retryable: false,
        allowFallback: true,
        providerId: candidate.provider.id,
      };
      lastError = noModelErr;
      if (!state.settings.smartRouter.fallbackEnabled || i === candidates.length - 1) {
        throw noModelErr;
      }
      continue;
    }

    const attemptStart = Date.now();
    let emittedAnyDelta = false;

    try {
      params.onMeta?.({
        providerId: candidate.provider.id,
        providerName: candidate.provider.name,
        modelId: candidate.modelId,
        modelName: candidate.modelName,
        fallbackUsed: fallbackChain.length > 0,
        fallbackChain: [...fallbackChain],
      });

      const fullReq: NormalizedChatRequest = {
        ...params.request,
        modelId: candidate.modelId,
        signal: params.signal,
      };

      const response = params.stream
        ? await adapter.streamMessage(
            ctx,
            fullReq,
            (chunk) => {
              if (chunk.delta) emittedAnyDelta = true;
              params.onDelta?.(chunk);
            },
            params.signal,
          )
        : await adapter.sendMessage(ctx, fullReq);

      // Update provider status to online on real successful completion
      candidate.provider.status = 'online';
      candidate.provider.lastCheckedAt = new Date().toISOString();
      candidate.provider.lastLatencyMs = response.latencyMs;
      candidate.provider.lastError = undefined;

      recordUsage(state, {
        providerId: candidate.provider.id,
        providerName: candidate.provider.name,
        modelId: response.modelId || candidate.modelId,
        success: true,
        latencyMs: response.latencyMs,
        inputTokens: response.usage?.inputTokens,
        outputTokens: response.usage?.outputTokens,
        fallbackFrom: fallbackChain[0]?.providerId,
        taskCategory: params.taskCategory,
      });
      saveState(state);

      return {
        response,
        providerId: candidate.provider.id,
        providerName: candidate.provider.name,
        modelId: response.modelId || candidate.modelId,
        modelName: candidate.modelName,
        fallbackUsed: fallbackChain.length > 0,
        fallbackChain,
      };
    } catch (err) {
      if (params.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        throw err;
      }

      const normalized: NormalizedAIError =
        err && typeof err === 'object' && 'code' in err && 'providerId' in err
          ? (err as NormalizedAIError)
          : adapter.normalizeError(err);

      const attemptLatency = Date.now() - attemptStart;

      // Update provider status accurately from real error
      if (normalized.code === 'HTTP_429' || normalized.code === 'QUOTA_EXHAUSTED') {
        candidate.provider.status = 'rate_limited';
      } else if (normalized.code !== 'SAFETY_REFUSAL' && normalized.code !== 'BAD_REQUEST') {
        candidate.provider.status = 'error';
      }
      candidate.provider.lastCheckedAt = new Date().toISOString();
      candidate.provider.lastError = normalized;

      recordUsage(state, {
        providerId: candidate.provider.id,
        providerName: candidate.provider.name,
        modelId: candidate.modelId,
        success: false,
        latencyMs: attemptLatency,
        errorCode: normalized.code,
        fallbackFrom: fallbackChain[0]?.providerId,
        taskCategory: params.taskCategory,
      });
      saveState(state);

      lastError = normalized;

      const canFallback =
        !emittedAnyDelta &&
        normalized.allowFallback &&
        (params.autoMode || state.settings.smartRouter.fallbackEnabled) &&
        i < candidates.length - 1;

      if (!canFallback) {
        throw normalized;
      }

      const attempt: FallbackAttempt = {
        providerId: candidate.provider.id,
        providerName: candidate.provider.name,
        modelId: candidate.modelId,
        errorCode: normalized.code,
        message: normalized.message,
      };
      fallbackChain.push(attempt);
      params.onFallback?.(attempt, candidates[i + 1]);
    }
  }

  throw (
    lastError ?? {
      code: 'UNKNOWN_ERROR',
      message: 'Tutti i provider disponibili hanno restituito un errore.',
      retryable: false,
      allowFallback: false,
      providerId: params.requestedProviderId || 'auto',
    }
  );
}
