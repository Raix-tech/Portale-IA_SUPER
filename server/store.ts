import fs from 'node:fs';
import path from 'node:path';
import type {
  AppSettings,
  CatalogMeta,
  ChatSession,
  ModelInfo,
  NormalizedAIError,
  ProviderStatusType,
  PublicProviderConfig,
  UsageRecord,
} from '../src/types/ai.ts';
import {
  DEFAULT_AGENT_ID,
  getDefaultBuiltInAgents,
  sanitizeAgentsSettings,
} from '../src/utils/agents.ts';
import { getDefaultAutoApproveSettings, sanitizeAutoApproveSettings } from '../src/utils/autoApprove.ts';
import { ensureDataDir, getDataDir } from './dataDir.ts';
import { getDefaultPcAccessSettings, sanitizePcAccessSettings } from './pcToolsService.ts';
import { getProviderSecrets, getPublicProviderKeys, maskApiKey } from './vault.ts';

function getStateFile(): string {
  return path.join(getDataDir(), 'state.json');
}

function getCatalogFile(): string {
  return path.join(getDataDir(), 'providers-catalog.json');
}

export interface StoredProviderMeta {
  id: string;
  name: string;
  kind: 'builtin' | 'custom';
  catalogSource?: 'builtin' | 'auto-sync';
  description: string;
  docsUrl: string;
  keyPlaceholder: string;
  requiresAccountId?: boolean;
  accountId?: string;
  supportsAnonymous?: boolean;
  anonymousMode?: boolean;
  enabled: boolean;
  baseUrl?: string;
  defaultBaseUrl: string;
  chatEndpoint?: string;
  modelsEndpoint?: string;
  defaultModel?: string;
  status: ProviderStatusType;
  lastCheckedAt?: string;
  lastLatencyMs?: number;
  lastError?: NormalizedAIError;
}

export interface PersistedState {
  providers: StoredProviderMeta[];
  settings: AppSettings;
  models: ModelInfo[];
  usageLogs: UsageRecord[];
  chatSessions: ChatSession[];
}

export interface PersistedCatalog {
  schemaVersion: 1;
  updatedAt: string;
  lastCheckedAt?: string;
  dismissedProviderIds: string[];
  providers: StoredProviderMeta[];
}

export const BUILTIN_PROVIDERS: StoredProviderMeta[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'builtin',
    description: 'Router unificato con numerosi modelli gratuiti (:free) senza carta di credito.',
    docsUrl: 'https://openrouter.ai/keys',
    keyPlaceholder: 'sk-or-v1-...',
    enabled: true,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    chatEndpoint: '/chat/completions',
    modelsEndpoint: '/models',
    status: 'not_configured',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'builtin',
    description: 'Google AI Studio con tier gratuito permanente per modelli Gemini Flash e Pro.',
    docsUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza...',
    enabled: true,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    status: 'not_configured',
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'builtin',
    description: 'Inferenza LPU ultra-veloce con piano gratuito per Llama, Qwen, Gemma e Kimi.',
    docsUrl: 'https://console.groq.com/keys',
    keyPlaceholder: 'gsk_...',
    enabled: true,
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    chatEndpoint: '/chat/completions',
    modelsEndpoint: '/models',
    status: 'not_configured',
  },
  {
    id: 'sambanova',
    name: 'SambaNova Cloud',
    kind: 'builtin',
    description: 'Inferenza RDU ad alta velocità con Free Tier permanente senza carta di credito.',
    docsUrl: 'https://cloud.sambanova.ai/apis',
    keyPlaceholder: 'SambaNova API Key',
    enabled: true,
    defaultBaseUrl: 'https://api.sambanova.ai/v1',
    chatEndpoint: '/chat/completions',
    modelsEndpoint: '/models',
    status: 'not_configured',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    kind: 'builtin',
    description: 'Piano gratuito Experiment per Mistral, Codestral e Pixtral senza carta di credito.',
    docsUrl: 'https://console.mistral.ai/api-keys',
    keyPlaceholder: 'mistral-...',
    enabled: true,
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    chatEndpoint: '/chat/completions',
    modelsEndpoint: '/models',
    status: 'not_configured',
  },
  {
    id: 'cohere',
    name: 'Cohere',
    kind: 'builtin',
    description: 'Chiavi Trial gratuite (senza carta) per modelli Command R/A tramite API OpenAI.',
    docsUrl: 'https://dashboard.cohere.com/api-keys',
    keyPlaceholder: 'Cohere Trial Key',
    enabled: true,
    defaultBaseUrl: 'https://api.cohere.ai/compatibility/v1',
    chatEndpoint: '/chat/completions',
    modelsEndpoint: '/models',
    status: 'not_configured',
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    kind: 'builtin',
    description: 'Catalogo gratuito per sviluppatori con oltre 100 modelli open-weight (Llama, Nemotron, DeepSeek).',
    docsUrl: 'https://build.nvidia.com/',
    keyPlaceholder: 'nvapi-...',
    enabled: true,
    defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
    chatEndpoint: '/chat/completions',
    modelsEndpoint: '/models',
    status: 'not_configured',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    kind: 'builtin',
    description: 'Piano gratuito con 10.000 Neurons al giorno senza carta. Richiede API Token e Account ID.',
    docsUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    keyPlaceholder: 'CF API Token',
    requiresAccountId: true,
    enabled: true,
    defaultBaseUrl: 'https://api.cloudflare.com/client/v4',
    status: 'not_configured',
  },
  {
    id: 'kilo',
    name: 'Kilo Gateway',
    kind: 'builtin',
    description: 'Gateway con modelli :free a rotazione e accesso gratuito con API key o modalità anonima.',
    docsUrl: 'https://app.kilo.ai/',
    keyPlaceholder: 'kilo-... (opzionale in modalità anonima)',
    supportsAnonymous: true,
    anonymousMode: false,
    enabled: true,
    defaultBaseUrl: 'https://api.kilo.ai/api/gateway',
    chatEndpoint: '/chat/completions',
    modelsEndpoint: '/models',
    status: 'not_configured',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    kind: 'builtin',
    description: 'Piattaforma cloud con modelli open-weight gratuiti (Qwen, DeepSeek, GLM) senza carta.',
    docsUrl: 'https://cloud.siliconflow.com/account/ak',
    keyPlaceholder: 'sk-...',
    enabled: true,
    defaultBaseUrl: 'https://api.siliconflow.com/v1',
    chatEndpoint: '/chat/completions',
    modelsEndpoint: '/models',
    status: 'not_configured',
  },
  {
    id: 'zai',
    name: 'Z.ai (Zhipu AI)',
    kind: 'builtin',
    description: 'Modelli Flash gratuiti permanenti (glm-4.7-flash, glm-4.5-flash) senza carta di credito.',
    docsUrl: 'https://z.ai/manage-apikey/apikey-list',
    keyPlaceholder: 'Z.ai API Key',
    enabled: true,
    defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
    chatEndpoint: '/chat/completions',
    modelsEndpoint: '/models',
    status: 'not_configured',
  },
  {
    id: 'pollinations',
    name: 'Pollinations AI',
    kind: 'builtin',
    description: 'API OpenAI-compatibile gratuita con chiave da enter.pollinations.ai o accesso anonimo.',
    docsUrl: 'https://enter.pollinations.ai',
    keyPlaceholder: 'sk_... (opzionale in modalità anonima)',
    supportsAnonymous: true,
    anonymousMode: false,
    enabled: true,
    defaultBaseUrl: 'https://gen.pollinations.ai/v1',
    chatEndpoint: '/chat/completions',
    modelsEndpoint: '/models',
    status: 'not_configured',
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  activeProviderId: 'openrouter',
  activeModelId: '',
  smartRouter: {
    enabled: false,
    taskCategory: 'general',
    preferFree: true,
    fallbackEnabled: true,
    providerPriority: [
      'openrouter',
      'groq',
      'sambanova',
      'gemini',
      'kilo',
      'mistral',
      'nvidia',
      'cohere',
      'zai',
      'siliconflow',
      'cloudflare',
      'pollinations',
    ],
  },
  systemPrompt: '',
  agents: getDefaultBuiltInAgents(),
  defaultAgentId: DEFAULT_AGENT_ID,
  autoUpdateCatalogOnLogin: true,
  sourceBackup: {
    autoEnabled: false,
    intervalHours: 24,
    localPath: '',
    fileNamePrefix: 'free-ai-hub-source',
  },
  pcAccess: getDefaultPcAccessSettings(),
  autoApprove: getDefaultAutoApproveSettings(),
};

export function loadCatalog(): PersistedCatalog {
  ensureDataDir();
  const catalogFile = getCatalogFile();
  const now = new Date().toISOString();
  if (!fs.existsSync(catalogFile)) {
    const initial: PersistedCatalog = {
      schemaVersion: 1,
      updatedAt: now,
      dismissedProviderIds: [],
      providers: BUILTIN_PROVIDERS.map((p) => ({ ...p, catalogSource: 'builtin' })),
    };
    saveCatalog(initial);
    return initial;
  }

  try {
    const raw = fs.readFileSync(catalogFile, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedCatalog>;
    const fileProviders = Array.isArray(parsed.providers) ? parsed.providers : [];
    const byId = new Map(fileProviders.map((p) => [p.id, p]));

    // Ensure all core built-in providers remain present while preserving synced catalog additions/updates
    const merged: StoredProviderMeta[] = BUILTIN_PROVIDERS.map((def) => {
      const existing = byId.get(def.id);
      if (!existing) return { ...def, catalogSource: 'builtin' };
      return {
        ...def,
        ...existing,
        kind: 'builtin',
        catalogSource: existing.catalogSource || 'builtin',
      };
    });
    const coreIds = new Set(BUILTIN_PROVIDERS.map((p) => p.id));
    for (const p of fileProviders) {
      if (p && p.id && !coreIds.has(p.id)) {
        merged.push({
          ...p,
          kind: 'builtin',
          catalogSource: p.catalogSource || 'auto-sync',
        });
      }
    }

    return {
      schemaVersion: 1,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : now,
      lastCheckedAt: typeof parsed.lastCheckedAt === 'string' ? parsed.lastCheckedAt : undefined,
      dismissedProviderIds: Array.isArray(parsed.dismissedProviderIds)
        ? parsed.dismissedProviderIds.filter((id): id is string => typeof id === 'string')
        : [],
      providers: merged,
    };
  } catch {
    return {
      schemaVersion: 1,
      updatedAt: now,
      dismissedProviderIds: [],
      providers: BUILTIN_PROVIDERS.map((p) => ({ ...p, catalogSource: 'builtin' })),
    };
  }
}

export function saveCatalog(catalog: PersistedCatalog): void {
  ensureDataDir();
  const catalogFile = getCatalogFile();
  const tmpFile = `${catalogFile}.tmp-${process.pid}`;
  fs.writeFileSync(tmpFile, JSON.stringify(catalog, null, 2), { mode: 0o600 });
  fs.renameSync(tmpFile, catalogFile);
}

export function getCatalogMeta(): CatalogMeta {
  const catalog = loadCatalog();
  return {
    schemaVersion: catalog.schemaVersion,
    updatedAt: catalog.updatedAt,
    lastCheckedAt: catalog.lastCheckedAt,
    catalogProvidersCount: catalog.providers.length,
  };
}

function mergeBuiltIns(
  existing: StoredProviderMeta[],
  catalogProviders: StoredProviderMeta[],
): StoredProviderMeta[] {
  const byId = new Map(existing.map((p) => [p.id, p]));
  const merged: StoredProviderMeta[] = catalogProviders.map((def) => {
    const saved = byId.get(def.id);
    if (!saved) return { ...def };
    return {
      ...def,
      enabled: saved.enabled ?? def.enabled,
      baseUrl: saved.baseUrl,
      accountId: saved.accountId,
      anonymousMode: saved.anonymousMode ?? def.anonymousMode,
      defaultModel: saved.defaultModel,
      status: saved.status ?? 'not_configured',
      lastCheckedAt: saved.lastCheckedAt,
      lastLatencyMs: saved.lastLatencyMs,
      lastError: saved.lastError,
    };
  });
  for (const p of existing) {
    if (p.kind === 'custom') {
      merged.push(p);
    }
  }
  return merged;
}

export function loadState(): PersistedState {
  ensureDataDir();
  const stateFile = getStateFile();
  const catalog = loadCatalog();
  if (!fs.existsSync(stateFile)) {
    const initial: PersistedState = {
      providers: catalog.providers.map((p) => ({ ...p })),
      settings: structuredClone(DEFAULT_SETTINGS),
      models: [],
      usageLogs: [],
      chatSessions: [],
    };
    saveState(initial);
    return initial;
  }

  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const providers = mergeBuiltIns(parsed.providers ?? [], catalog.providers);
    const settings: AppSettings = {
      ...structuredClone(DEFAULT_SETTINGS),
      ...(parsed.settings ?? {}),
      smartRouter: {
        ...structuredClone(DEFAULT_SETTINGS.smartRouter),
        ...(parsed.settings?.smartRouter ?? {}),
      },
      sourceBackup: {
        ...structuredClone(DEFAULT_SETTINGS.sourceBackup!),
        ...(parsed.settings?.sourceBackup ?? {}),
      },
      pcAccess: sanitizePcAccessSettings(parsed.settings?.pcAccess, getDefaultPcAccessSettings()),
      autoApprove: sanitizeAutoApproveSettings(
        parsed.settings?.autoApprove,
        getDefaultAutoApproveSettings(),
      ),
      ...sanitizeAgentsSettings(parsed.settings?.agents, parsed.settings?.defaultAgentId),
    };
    // Ensure priority list only references active providers and includes newly added ones
    const providerIds = new Set(providers.map((p) => p.id));
    settings.smartRouter.providerPriority = settings.smartRouter.providerPriority.filter((id) =>
      providerIds.has(id),
    );
    const prioritySet = new Set(settings.smartRouter.providerPriority);
    for (const p of providers) {
      if (!prioritySet.has(p.id)) {
        settings.smartRouter.providerPriority.push(p.id);
      }
    }
    if (!providerIds.has(settings.activeProviderId)) {
      settings.activeProviderId = providers[0]?.id || 'openrouter';
      settings.activeModelId = '';
    }
    const models = (Array.isArray(parsed.models) ? parsed.models : []).filter((m) =>
      providerIds.has(m.providerId),
    );
    return {
      providers,
      settings,
      models,
      usageLogs: Array.isArray(parsed.usageLogs) ? parsed.usageLogs : [],
      chatSessions: Array.isArray(parsed.chatSessions) ? parsed.chatSessions : [],
    };
  } catch {
    return {
      providers: catalog.providers.map((p) => ({ ...p })),
      settings: structuredClone(DEFAULT_SETTINGS),
      models: [],
      usageLogs: [],
      chatSessions: [],
    };
  }
}

export function saveState(state: PersistedState): void {
  ensureDataDir();
  const stateFile = getStateFile();
  const tmpFile = `${stateFile}.tmp-${process.pid}`;
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmpFile, stateFile);
}

export function toPublicProvider(
  meta: StoredProviderMeta,
  modelCount: number,
): PublicProviderConfig {
  const secrets = getProviderSecrets(meta.id);
  const apiKeys = getPublicProviderKeys(meta.id);
  const hasApiKey = apiKeys.length > 0;
  const usesAnon = Boolean(meta.supportsAnonymous && meta.anonymousMode);
  const configured = meta.requiresAccountId
    ? hasApiKey && Boolean(meta.accountId && meta.accountId.trim().length > 0)
    : hasApiKey || usesAnon;

  let status: ProviderStatusType = meta.status;
  if (!meta.enabled) {
    status = 'disabled';
  } else if (!configured) {
    status = 'not_configured';
  }

  return {
    id: meta.id,
    name: meta.name,
    kind: meta.kind,
    catalogSource: meta.catalogSource,
    description: meta.description,
    docsUrl: meta.docsUrl,
    keyPlaceholder: meta.keyPlaceholder,
    requiresAccountId: meta.requiresAccountId,
    accountId: meta.accountId,
    supportsAnonymous: meta.supportsAnonymous,
    anonymousMode: meta.anonymousMode,
    enabled: meta.enabled,
    configured,
    hasApiKey,
    maskedApiKey: maskApiKey(secrets.apiKey),
    activeKeyId: secrets.activeKeyId,
    activeKeyLabel: secrets.activeKeyLabel,
    apiKeys,
    baseUrl: meta.baseUrl,
    defaultBaseUrl: meta.defaultBaseUrl,
    customHeaderKeys: Object.keys(secrets.customHeaders ?? {}),
    chatEndpoint: meta.chatEndpoint,
    modelsEndpoint: meta.modelsEndpoint,
    defaultModel: meta.defaultModel,
    status,
    lastCheckedAt: meta.lastCheckedAt,
    lastLatencyMs: meta.lastLatencyMs,
    lastError: configured ? meta.lastError : undefined,
    modelCount,
  };
}

export function getPublicProviders(state: PersistedState): PublicProviderConfig[] {
  const counts = new Map<string, number>();
  for (const m of state.models) {
    counts.set(m.providerId, (counts.get(m.providerId) ?? 0) + 1);
  }
  return state.providers.map((p) => toPublicProvider(p, counts.get(p.id) ?? 0));
}
