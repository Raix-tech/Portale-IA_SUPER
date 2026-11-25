import crypto from 'node:crypto';
import type {
  CatalogApplyResult,
  CatalogDiscoveredProvider,
  CatalogModelProviderDiff,
  CatalogProviderUpdate,
  CatalogUpdateCheckResult,
  ModelCapability,
  ModelInfo,
  ModelPricingTier,
} from '../src/types/ai.ts';
import { buildAdapterContext, getAdapterForProvider } from './adapters/registry.ts';
import { validateOutboundUrl } from './ssrfGuard.ts';
import {
  getCatalogMeta,
  getPublicProviders,
  loadCatalog,
  loadState,
  saveCatalog,
  saveState,
  type StoredProviderMeta,
} from './store.ts';
import { getProviderSecrets } from './vault.ts';

const MODELS_DEV_CATALOG_URL = 'https://models.dev/api.json';
const REMOTE_TIMEOUT_MS = 12000;
const PROBE_TIMEOUT_MS = 3500;
const PENDING_UPDATE_TTL_MS = 15 * 60 * 1000;

interface RemoteModelsDevModel {
  id?: string;
  name?: string;
  description?: string;
  reasoning?: boolean;
  tool_call?: boolean;
  modalities?: { input?: string[]; output?: string[] };
  limit?: { context?: number; output?: number };
  cost?: { input?: number; output?: number };
}

interface RemoteModelsDevProvider {
  id?: string;
  name?: string;
  api?: string;
  doc?: string;
  npm?: string;
  models?: Record<string, RemoteModelsDevModel>;
}

interface PendingCatalogUpdate {
  createdAt: number;
  checkedAt: string;
  candidateNewProviders: StoredProviderMeta[];
  providerMetaUpdates: Array<{
    id: string;
    name: string;
    patch: Partial<Pick<StoredProviderMeta, 'docsUrl'>>;
    changes: string[];
  }>;
  refreshedModelsByProvider: Map<string, ModelInfo[]>;
  failedProviderIds: Set<string>;
}

const pendingUpdates = new Map<string, PendingCatalogUpdate>();

function cleanupExpiredPendingUpdates(): void {
  const cutoff = Date.now() - PENDING_UPDATE_TTL_MS;
  for (const [id, entry] of pendingUpdates.entries()) {
    if (entry.createdAt < cutoff) {
      pendingUpdates.delete(id);
    }
  }
}

function sanitizeText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

const KNOWN_ALIASES: Record<string, string[]> = {
  gemini: ['google'],
  zai: ['zhipuai'],
  cloudflare: ['cloudflare-workers-ai'],
  siliconflow: ['siliconflow-cn'],
};

const KNOWN_BLOCKED_CANDIDATE_IDS = new Set([
  'google',
  'zhipuai',
  'cloudflare-workers-ai',
  'siliconflow-cn',
]);

function isMetaConfiguredForSync(meta: StoredProviderMeta): boolean {
  const secrets = getProviderSecrets(meta.id);
  const hasKey = Boolean(secrets.apiKey && secrets.apiKey.trim().length > 0);
  const allowAnon = Boolean(meta.supportsAnonymous && meta.anonymousMode);
  if (!hasKey && !allowAnon) return false;
  if (meta.requiresAccountId) {
    return Boolean(meta.accountId && meta.accountId.trim().length > 0);
  }
  return true;
}

function normalizeModelComparable(m: ModelInfo): string {
  return JSON.stringify({
    name: m.name,
    pricingTier: m.pricingTier,
    contextWindow: m.contextWindow ?? null,
    supportsToolCalling: Boolean(m.supportsToolCalling),
    capabilities: [...m.capabilities].sort(),
  });
}

async function fetchModelsDevCatalog(): Promise<Record<string, RemoteModelsDevProvider>> {
  await validateOutboundUrl(MODELS_DEV_CATALOG_URL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Timeout')), REMOTE_TIMEOUT_MS);
  try {
    const res = await fetch(MODELS_DEV_CATALOG_URL, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'Free-AI-Hub/1.0' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} da models.dev`);
    }
    const json = (await res.json()) as Record<string, RemoteModelsDevProvider>;
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      throw new Error('Formato catalogo remoto non valido.');
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function probeOpenAICompatibleReachability(baseUrl: string): Promise<boolean> {
  try {
    const cleanBase = baseUrl.replace(/\/+$/, '');
    const probeUrl = `${cleanBase}/models`;
    await validateOutboundUrl(probeUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Probe timeout')), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(probeUrl, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': 'Free-AI-Hub/1.0' },
        signal: controller.signal,
      });
      // 200 (public list), 401/403 (requires API key), 405/429 mean the API endpoint is live
      if ([200, 401, 403, 405, 429].includes(res.status)) {
        return true;
      }
      return false;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

function buildRemoteModelLookup(
  remote: Record<string, RemoteModelsDevProvider>,
  providerId: string,
): Map<string, { pricingTier: ModelPricingTier; contextWindow?: number; capabilities?: ModelCapability[]; supportsToolCalling?: boolean }> {
  const map = new Map<
    string,
    {
      pricingTier: ModelPricingTier;
      contextWindow?: number;
      capabilities?: ModelCapability[];
      supportsToolCalling?: boolean;
    }
  >();

  const sourceIds = [providerId, ...(KNOWN_ALIASES[providerId] ?? [])];
  for (const srcId of sourceIds) {
    const entry = remote[srcId];
    if (!entry?.models) continue;
    for (const [keyId, m] of Object.entries(entry.models)) {
      const modelId = (m.id || keyId || '').trim();
      if (!modelId) continue;

      let pricingTier: ModelPricingTier = 'unknown';
      if (m.cost && typeof m.cost.input === 'number' && typeof m.cost.output === 'number') {
        pricingTier = m.cost.input === 0 && m.cost.output === 0 ? 'free' : 'paid';
      }

      const caps = new Set<ModelCapability>(['text']);
      if (m.reasoning) caps.add('reasoning');
      if (m.modalities?.input?.some((mod) => mod.includes('image') || mod.includes('video'))) {
        caps.add('multimodal');
      }
      const lower = modelId.toLowerCase();
      if (lower.includes('code') || lower.includes('coder')) {
        caps.add('coding');
      }

      const info = {
        pricingTier,
        contextWindow: typeof m.limit?.context === 'number' ? m.limit.context : undefined,
        capabilities: Array.from(caps),
        supportsToolCalling: typeof m.tool_call === 'boolean' ? m.tool_call : undefined,
      };
      map.set(modelId, info);
      map.set(modelId.toLowerCase(), info);
      const shortId = modelId.split('/').pop();
      if (shortId && !map.has(shortId)) {
        map.set(shortId, info);
      }
    }
  }
  return map;
}

function enrichModelsWithRemoteMetadata(
  providerId: string,
  liveModels: ModelInfo[],
  remoteLookup: ReturnType<typeof buildRemoteModelLookup>,
): ModelInfo[] {
  if (remoteLookup.size === 0) return liveModels;
  return liveModels.map((model) => {
    const remote =
      remoteLookup.get(model.id) ||
      remoteLookup.get(model.id.toLowerCase()) ||
      remoteLookup.get(model.id.split('/').pop() || '');
    if (!remote) return model;

    let pricingTier = model.pricingTier;
    if (pricingTier === 'unknown' && remote.pricingTier !== 'unknown') {
      pricingTier = remote.pricingTier;
    } else if (
      providerId === 'nvidia' ||
      providerId === 'groq' ||
      providerId === 'sambanova' ||
      providerId === 'mistral' ||
      providerId === 'cohere'
    ) {
      // Keep confirmed free_tier for free-tier providers, only upgrade exact free models to 'free'
      if (remote.pricingTier === 'free') {
        pricingTier = 'free';
      }
    }

    const mergedCaps = Array.from(new Set([...model.capabilities, ...(remote.capabilities ?? [])]));
    return {
      ...model,
      pricingTier,
      contextWindow: model.contextWindow ?? remote.contextWindow,
      supportsToolCalling: model.supportsToolCalling ?? remote.supportsToolCalling,
      capabilities: mergedCaps,
    };
  });
}

export async function checkCatalogAndModelsUpdates(
  trigger: 'manual' | 'auto' = 'manual',
): Promise<CatalogUpdateCheckResult> {
  cleanupExpiredPendingUpdates();
  const checkedAt = new Date().toISOString();
  const catalog = loadCatalog();
  const state = loadState();
  const sourceWarnings: string[] = [];

  let remoteCatalog: Record<string, RemoteModelsDevProvider> = {};
  let remoteAvailable = false;
  try {
    remoteCatalog = await fetchModelsDevCatalog();
    remoteAvailable = true;
  } catch (err) {
    sourceWarnings.push(
      `Catalogo pubblico non raggiungibile: ${err instanceof Error ? err.message : 'errore di rete'}`,
    );
  }

  const existingIds = new Set(catalog.providers.map((p) => p.id.toLowerCase()));
  const existingCustomIds = new Set(state.providers.map((p) => p.id.toLowerCase()));
  const dismissedSet = new Set(catalog.dismissedProviderIds.map((id) => id.toLowerCase()));
  const existingHosts = new Set<string>();
  for (const p of [...catalog.providers, ...state.providers]) {
    try {
      existingHosts.add(new URL(p.baseUrl || p.defaultBaseUrl).hostname.toLowerCase());
    } catch {
      // ignore invalid URL
    }
  }

  // 1. Discover new OpenAI-compatible providers with free models from models.dev
  const rawCandidates: Array<{
    id: string;
    name: string;
    api: string;
    host: string;
    doc: string;
    freeModelNames: string[];
    totalModelCount: number;
  }> = [];

  if (remoteAvailable) {
    const seenCandidateHosts = new Set<string>();
    for (const [rawKey, entry] of Object.entries(remoteCatalog)) {
      const id = sanitizeText(entry.id || rawKey, 40).toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(id)) continue;
      if (
        existingIds.has(id) ||
        existingCustomIds.has(id) ||
        dismissedSet.has(id) ||
        KNOWN_BLOCKED_CANDIDATE_IDS.has(id)
      ) {
        continue;
      }
      if (/-cn$|coding-plan|token-plan|cheapllm/i.test(id)) continue;

      const rawApi = sanitizeText(entry.api, 220).replace(/\/+$/, '');
      if (!rawApi.startsWith('https://') || rawApi.includes('{') || rawApi.includes('$')) {
        continue;
      }

      const npm = sanitizeText(entry.npm, 80);
      if (
        npm &&
        !['@ai-sdk/openai-compatible', '@ai-sdk/openai', '@openrouter/ai-sdk-provider'].includes(
          npm,
        )
      ) {
        continue;
      }

      let parsedApi: URL;
      try {
        parsedApi = await validateOutboundUrl(rawApi);
      } catch {
        continue;
      }
      const host = parsedApi.hostname.toLowerCase();
      if (existingHosts.has(host) || seenCandidateHosts.has(host)) {
        continue;
      }

      const modelRows = Object.values(entry.models ?? {});
      const freeModels = modelRows.filter(
        (m) =>
          m.cost &&
          m.cost.input === 0 &&
          m.cost.output === 0 &&
          (!m.modalities?.output || m.modalities.output.includes('text')),
      );
      if (freeModels.length === 0) continue;

      let docsUrl = sanitizeText(entry.doc, 220);
      if (!docsUrl.startsWith('https://')) {
        docsUrl = parsedApi.origin;
      } else {
        try {
          await validateOutboundUrl(docsUrl);
        } catch {
          docsUrl = parsedApi.origin;
        }
      }

      const name = sanitizeText(entry.name || id, 60);
      if (!name) continue;

      seenCandidateHosts.add(host);
      rawCandidates.push({
        id,
        name,
        api: rawApi,
        host,
        doc: docsUrl,
        freeModelNames: freeModels
          .map((m) => sanitizeText(m.name || m.id || '', 60))
          .filter(Boolean)
          .slice(0, 5),
        totalModelCount: modelRows.length,
      });
    }
  }

  // Probe candidate endpoints concurrently (max 25 to stay fast) to ensure only live APIs are proposed
  const probeTargets = rawCandidates.slice(0, 25);
  const probeResults = await Promise.all(
    probeTargets.map(async (cand) => ({
      cand,
      reachable: await probeOpenAICompatibleReachability(cand.api),
    })),
  );

  const newProvidersSummary: CatalogDiscoveredProvider[] = [];
  const candidateNewProviders: StoredProviderMeta[] = [];

  for (const { cand, reachable } of probeResults) {
    if (!reachable) continue;
    newProvidersSummary.push({
      id: cand.id,
      name: cand.name,
      description: `Provider compatibile OpenAI scoperto automaticamente (${cand.freeModelNames.length > 0 ? 'modelli gratuiti disponibili' : 'free tier'}).`,
      docsUrl: cand.doc,
      defaultBaseUrl: cand.api,
      freeModelCount: Math.max(cand.freeModelNames.length, 1),
      totalModelCount: cand.totalModelCount,
      sampleFreeModels: cand.freeModelNames,
    });
    candidateNewProviders.push({
      id: cand.id,
      name: cand.name,
      kind: 'builtin',
      catalogSource: 'auto-sync',
      description: `Provider OpenAI-compatibile sincronizzato automaticamente (${cand.totalModelCount} modelli noti nel catalogo pubblico).`,
      docsUrl: cand.doc,
      keyPlaceholder: 'sk-...',
      enabled: true,
      defaultBaseUrl: cand.api,
      chatEndpoint: '/chat/completions',
      modelsEndpoint: '/models',
      status: 'not_configured',
    });
  }

  // 2. Check configured & enabled providers for live model list diffs (including anonymous mode!)
  const configuredProviders = state.providers.filter(
    (p) => p.enabled && isMetaConfiguredForSync(p),
  );
  const refreshedModelsByProvider = new Map<string, ModelInfo[]>();
  const failedProviderIds = new Set<string>();
  const perProviderModelDiffs: CatalogModelProviderDiff[] = [];
  const sampleAddedNames: string[] = [];
  let totalAddedModels = 0;
  let totalUpdatedModels = 0;
  let totalRemovedModels = 0;

  await Promise.allSettled(
    configuredProviders.map(async (meta) => {
      const adapter = getAdapterForProvider(meta.id);
      const ctx = buildAdapterContext(meta);
      try {
        const liveRaw = await adapter.getModels(ctx);
        const remoteLookup = remoteAvailable
          ? buildRemoteModelLookup(remoteCatalog, meta.id)
          : new Map();
        const enriched = enrichModelsWithRemoteMetadata(meta.id, liveRaw, remoteLookup);

        const prevList = state.models.filter((m) => m.providerId === meta.id);
        const prevMap = new Map(prevList.map((m) => [m.id, m]));
        const nextMap = new Map(enriched.map((m) => [m.id, m]));

        let added = 0;
        let updated = 0;
        let removed = 0;

        for (const nextModel of enriched) {
          const prev = prevMap.get(nextModel.id);
          if (!prev) {
            added += 1;
            if (sampleAddedNames.length < 8) {
              sampleAddedNames.push(`${meta.name}: ${nextModel.name}`);
            }
          } else if (normalizeModelComparable(prev) !== normalizeModelComparable(nextModel)) {
            updated += 1;
          }
        }
        for (const prevModel of prevList) {
          if (!nextMap.has(prevModel.id)) {
            removed += 1;
          }
        }

        if (added > 0 || updated > 0 || removed > 0) {
          refreshedModelsByProvider.set(meta.id, enriched);
          totalAddedModels += added;
          totalUpdatedModels += updated;
          totalRemovedModels += removed;
          perProviderModelDiffs.push({
            providerId: meta.id,
            providerName: meta.name,
            added,
            updated,
            removed,
            total: enriched.length,
          });
        }
      } catch (err) {
        failedProviderIds.add(meta.id);
        sourceWarnings.push(
          `${meta.name}: ${err instanceof Error ? err.message : 'errore verifica modelli'}`,
        );
      }
    }),
  );

  // Record lastCheckedAt in catalog metadata without altering providers/models
  catalog.lastCheckedAt = checkedAt;
  saveCatalog(catalog);

  const providerMetaUpdates: PendingCatalogUpdate['providerMetaUpdates'] = [];
  const updatedProvidersSummary: CatalogProviderUpdate[] = providerMetaUpdates.map((u) => ({
    id: u.id,
    name: u.name,
    changes: u.changes,
  }));

  const hasModelDiffs = totalAddedModels > 0 || totalUpdatedModels > 0 || totalRemovedModels > 0;
  const hasUpdates =
    candidateNewProviders.length > 0 || providerMetaUpdates.length > 0 || hasModelDiffs;

  if (!remoteAvailable && configuredProviders.length === 0) {
    throw new Error(sourceWarnings[0] || 'Impossibile contattare il catalogo remoto.');
  }

  let updateId: string | undefined;
  if (hasUpdates) {
    updateId = crypto.randomUUID();
    pendingUpdates.set(updateId, {
      createdAt: Date.now(),
      checkedAt,
      candidateNewProviders,
      providerMetaUpdates,
      refreshedModelsByProvider,
      failedProviderIds,
    });
  }

  return {
    hasUpdates,
    updateId,
    checkedAt,
    trigger,
    newProviders: newProvidersSummary,
    updatedProviders: updatedProvidersSummary,
    modelsSummary: {
      addedCount: totalAddedModels,
      updatedCount: totalUpdatedModels,
      removedCount: totalRemovedModels,
      perProvider: perProviderModelDiffs,
      sampleAddedNames,
    },
    sourceWarnings,
    catalog: getCatalogMeta(),
  };
}

export function applyCatalogAndModelsUpdate(params: {
  updateId: string;
  selectedProviderIds?: string[];
  applyModels?: boolean;
  dismissUnselected?: boolean;
}): CatalogApplyResult {
  cleanupExpiredPendingUpdates();
  const pending = pendingUpdates.get(params.updateId);
  if (!pending) {
    throw new Error('Proposta di aggiornamento scaduta o già applicata. Esegui una nuova verifica.');
  }

  const catalog = loadCatalog();
  const now = new Date().toISOString();

  const selectedSet = Array.isArray(params.selectedProviderIds)
    ? new Set(params.selectedProviderIds)
    : new Set(pending.candidateNewProviders.map((p) => p.id));

  let appliedProvidersCount = 0;
  const existingCatalogIds = new Set(catalog.providers.map((p) => p.id));
  const dismissedSet = new Set(catalog.dismissedProviderIds);

  for (const cand of pending.candidateNewProviders) {
    if (selectedSet.has(cand.id)) {
      if (!existingCatalogIds.has(cand.id)) {
        catalog.providers.push(cand);
        existingCatalogIds.add(cand.id);
        dismissedSet.delete(cand.id);
        appliedProvidersCount += 1;
      }
    } else if (params.dismissUnselected !== false) {
      dismissedSet.add(cand.id);
    }
  }

  for (const upd of pending.providerMetaUpdates) {
    const target = catalog.providers.find((p) => p.id === upd.id);
    if (target) {
      Object.assign(target, upd.patch);
      appliedProvidersCount += 1;
    }
  }

  catalog.dismissedProviderIds = Array.from(dismissedSet);
  catalog.updatedAt = now;
  catalog.lastCheckedAt = pending.checkedAt;
  saveCatalog(catalog);

  // Reload state so new catalog providers merge cleanly into PersistedState
  const state = loadState();
  let appliedModelsCount = 0;

  if (params.applyModels !== false && pending.refreshedModelsByProvider.size > 0) {
    for (const [providerId, nextModels] of pending.refreshedModelsByProvider.entries()) {
      state.models = [
        ...state.models.filter((m) => m.providerId !== providerId),
        ...nextModels,
      ];
      appliedModelsCount += nextModels.length;

      const meta = state.providers.find((p) => p.id === providerId);
      if (meta) {
        meta.status = 'online';
        meta.lastCheckedAt = now;
        meta.lastError = undefined;
      }
    }
  }

  saveState(state);
  pendingUpdates.delete(params.updateId);

  const parts: string[] = [];
  if (appliedProvidersCount > 0) {
    parts.push(`${appliedProvidersCount} nuovi provider aggiunti`);
  }
  if (params.applyModels !== false && pending.refreshedModelsByProvider.size > 0) {
    parts.push(`${appliedModelsCount} modelli aggiornati`);
  }

  return {
    providers: getPublicProviders(state),
    models: state.models,
    settings: state.settings,
    catalog: getCatalogMeta(),
    appliedProvidersCount,
    appliedModelsCount,
    message:
      parts.length > 0
        ? `Catalogo JSON aggiornato: ${parts.join(' e ')}.`
        : 'Nessuna modifica applicata al catalogo.',
  };
}
