import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import type {
  AppSettings,
  ChatSession,
  ExportBundle,
  NormalizedAIError,
  TaskCategory,
} from './src/types/ai.ts';
import { buildAdapterContext, getAdapterForProvider } from './server/adapters/registry.ts';
import { PROJECT_ROOT } from './server/dataDir.ts';
import {
  buildGitHubAuthUrl,
  buildM365AuthUrl,
  completeGitHubOAuthCallback,
  completeM365OAuthCallback,
  disconnectCopilotAccount,
  getPublicCopilotStatus,
  isCoworkLicensed,
  loadCopilotState,
  loginM365WithCredentials,
  pollGitHubDeviceLogin,
  pollM365DeviceLogin,
  refreshCopilotLicenseStatus,
  refreshGitHubCopilotModels,
  resolveAppBaseUrl,
  saveCopilotState,
  startGitHubDeviceLogin,
  startM365DeviceLogin,
  streamCopilotChat,
  updateCopilotConfig,
} from './server/copilotService.ts';
import {
  applyCatalogAndModelsUpdate,
  checkCatalogAndModelsUpdates,
} from './server/catalogUpdater.ts';
import { sanitizeAgentsSettings } from './src/utils/agents.ts';
import {
  getDefaultAutoApproveSettings,
  sanitizeAutoApproveSettings,
} from './src/utils/autoApprove.ts';
import {
  discoverPcTools,
  executeAuthorizedPcTool,
  getDefaultPcAccessSettings,
  sanitizePcAccessSettings,
} from './server/pcToolsService.ts';
import { executeRoutedChat } from './server/router.ts';
import {
  buildSourceBackupZip,
  getSourceBackupManifest,
  sanitizeBackupArchiveFileName,
} from './server/sourceBackup.ts';
import { validateOutboundUrl } from './server/ssrfGuard.ts';
import {
  BUILTIN_PROVIDERS,
  DEFAULT_SETTINGS,
  getCatalogMeta,
  getPublicProviders,
  loadState,
  saveState,
  toPublicProvider,
  type PersistedState,
  type StoredProviderMeta,
} from './server/store.ts';
import {
  activateProviderApiKey,
  addProviderApiKey,
  decryptBackupPayload,
  deleteProviderAllSecrets,
  deleteProviderApiKey,
  deleteProviderApiKeyById,
  encryptBackupPayload,
  generateGatewayToken,
  getAllProviderSecrets,
  getGatewayTokenStatus,
  getProviderSecrets,
  restoreProviderSecretEntry,
  revealGatewayToken,
  revealProviderKeyById,
  revokeGatewayToken,
  setProviderCustomHeaders,
  updateProviderApiKey,
  verifyGatewayToken,
  type ProviderSecretEntry,
} from './server/vault.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function isMetaConfigured(meta: StoredProviderMeta): boolean {
  const secrets = getProviderSecrets(meta.id);
  const hasKey = Boolean(secrets.apiKey && secrets.apiKey.trim().length > 0);
  const allowAnon = Boolean(meta.supportsAnonymous && meta.anonymousMode);
  if (!hasKey && !allowAnon) return false;
  if (meta.requiresAccountId) {
    return Boolean(meta.accountId && meta.accountId.trim().length > 0);
  }
  return true;
}

function pickPreferredModelId(
  meta: StoredProviderMeta,
  providerModels: Array<{ id: string; pricingTier: string }>,
): string {
  if (meta.defaultModel && providerModels.some((m) => m.id === meta.defaultModel)) {
    return meta.defaultModel;
  }
  const free = providerModels.find((m) => m.pricingTier === 'free' || m.pricingTier === 'free_tier');
  return free?.id || providerModels[0]?.id || meta.defaultModel || '';
}

function ensureActiveSelection(state: PersistedState, preferredProviderMeta: StoredProviderMeta): void {
  const currentActiveMeta = state.providers.find((p) => p.id === state.settings.activeProviderId);
  const currentActiveValid = Boolean(
    currentActiveMeta && currentActiveMeta.enabled && isMetaConfigured(currentActiveMeta),
  );
  const providerModels = state.models.filter((m) => m.providerId === preferredProviderMeta.id);

  if (!currentActiveValid && preferredProviderMeta.enabled && isMetaConfigured(preferredProviderMeta)) {
    state.settings.activeProviderId = preferredProviderMeta.id;
    state.settings.activeModelId = pickPreferredModelId(preferredProviderMeta, providerModels);
    return;
  }

  if (state.settings.activeProviderId === preferredProviderMeta.id) {
    const hasCurrentModel =
      Boolean(state.settings.activeModelId) &&
      providerModels.some((m) => m.id === state.settings.activeModelId);
    if (!hasCurrentModel && providerModels.length > 0) {
      state.settings.activeModelId = pickPreferredModelId(preferredProviderMeta, providerModels);
    }
  }
}

async function syncProviderModelsAfterConfig(
  state: PersistedState,
  meta: StoredProviderMeta,
): Promise<NormalizedAIError | undefined> {
  if (!meta.enabled || !isMetaConfigured(meta)) {
    return undefined;
  }
  const adapter = getAdapterForProvider(meta.id);
  const ctx = buildAdapterContext(meta);
  const start = Date.now();
  try {
    const models = await adapter.getModels(ctx);
    state.models = [
      ...state.models.filter((m) => m.providerId !== meta.id),
      ...models,
    ];
    meta.status = 'online';
    meta.lastCheckedAt = new Date().toISOString();
    meta.lastLatencyMs = Date.now() - start;
    meta.lastError = undefined;
    ensureActiveSelection(state, meta);
    return undefined;
  } catch (err) {
    const normalized: NormalizedAIError =
      err && typeof err === 'object' && 'code' in err && 'providerId' in err
        ? (err as NormalizedAIError)
        : adapter.normalizeError(err);
    meta.status =
      normalized.code === 'MISSING_API_KEY'
        ? 'not_configured'
        : normalized.code === 'HTTP_429' || normalized.code === 'QUOTA_EXHAUSTED'
          ? 'rate_limited'
          : 'error';
    meta.lastCheckedAt = new Date().toISOString();
    meta.lastLatencyMs = Date.now() - start;
    meta.lastError = normalized;
    return normalized;
  }
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/bootstrap', (_req, res) => {
    const state = loadState();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      providers: getPublicProviders(state),
      settings: state.settings,
      models: state.models,
      usageLogs: state.usageLogs,
      chatSessions: state.chatSessions,
      gateway: getGatewayTokenStatus(),
      catalog: getCatalogMeta(),
    });
  });

  app.put('/api/settings', (req, res) => {
    const state = loadState();
    const body = req.body as Partial<AppSettings>;
    if (body.theme === 'light' || body.theme === 'dark') {
      state.settings.theme = body.theme;
    }
    if (typeof body.activeProviderId === 'string') {
      state.settings.activeProviderId = body.activeProviderId;
    }
    if (typeof body.activeModelId === 'string') {
      state.settings.activeModelId = body.activeModelId;
    }
    if (typeof body.systemPrompt === 'string') {
      state.settings.systemPrompt = body.systemPrompt;
    }
    if (typeof body.autoUpdateCatalogOnLogin === 'boolean') {
      state.settings.autoUpdateCatalogOnLogin = body.autoUpdateCatalogOnLogin;
    }
    if (body.smartRouter && typeof body.smartRouter === 'object') {
      state.settings.smartRouter = {
        ...state.settings.smartRouter,
        ...body.smartRouter,
      };
    }
    if (body.sourceBackup && typeof body.sourceBackup === 'object') {
      const current = state.settings.sourceBackup ?? {
        autoEnabled: false,
        intervalHours: 24,
        localPath: '',
        fileNamePrefix: 'free-ai-hub-source',
      };
      state.settings.sourceBackup = {
        autoEnabled:
          typeof body.sourceBackup.autoEnabled === 'boolean'
            ? body.sourceBackup.autoEnabled
            : current.autoEnabled,
        intervalHours:
          typeof body.sourceBackup.intervalHours === 'number' &&
          Number.isFinite(body.sourceBackup.intervalHours) &&
          body.sourceBackup.intervalHours >= 0
            ? Math.min(8760, body.sourceBackup.intervalHours)
            : current.intervalHours,
        localPath:
          typeof body.sourceBackup.localPath === 'string'
            ? body.sourceBackup.localPath.slice(0, 260)
            : current.localPath,
        fileNamePrefix:
          typeof body.sourceBackup.fileNamePrefix === 'string'
            ? body.sourceBackup.fileNamePrefix.slice(0, 80)
            : current.fileNamePrefix,
        lastBackupAt:
          typeof body.sourceBackup.lastBackupAt === 'string'
            ? body.sourceBackup.lastBackupAt
            : current.lastBackupAt,
        lastBackupFileName:
          typeof body.sourceBackup.lastBackupFileName === 'string'
            ? body.sourceBackup.lastBackupFileName.slice(0, 120)
            : current.lastBackupFileName,
      };
    }
    if (body.pcAccess && typeof body.pcAccess === 'object') {
      state.settings.pcAccess = sanitizePcAccessSettings(
        body.pcAccess,
        state.settings.pcAccess ?? getDefaultPcAccessSettings(),
      );
    }
    if (body.autoApprove && typeof body.autoApprove === 'object') {
      state.settings.autoApprove = sanitizeAutoApproveSettings(
        body.autoApprove,
        state.settings.autoApprove ?? getDefaultAutoApproveSettings(),
      );
    }
    if (body.agents !== undefined || typeof body.defaultAgentId === 'string') {
      const sanitizedAgents = sanitizeAgentsSettings(
        Array.isArray(body.agents) ? body.agents : state.settings.agents,
        typeof body.defaultAgentId === 'string'
          ? body.defaultAgentId
          : state.settings.defaultAgentId,
      );
      state.settings.agents = sanitizedAgents.agents;
      state.settings.defaultAgentId = sanitizedAgents.defaultAgentId;
    }
    saveState(state);
    res.json({ settings: state.settings });
  });

  app.post('/api/catalog/check', async (req, res) => {
    try {
      const body = (req.body ?? {}) as { trigger?: 'manual' | 'auto' };
      const trigger = body.trigger === 'auto' ? 'auto' : 'manual';
      const result = await checkCatalogAndModelsUpdates(trigger);
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (err) {
      res.status(502).json({
        error:
          err instanceof Error
            ? err.message
            : 'Impossibile verificare gli aggiornamenti di provider e modelli.',
      });
    }
  });

  app.post('/api/catalog/apply', (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        updateId?: string;
        selectedProviderIds?: string[];
        applyModels?: boolean;
        dismissUnselected?: boolean;
      };
      if (!body.updateId || typeof body.updateId !== 'string') {
        res.status(400).json({ error: 'ID aggiornamento mancante.' });
        return;
      }
      const result = applyCatalogAndModelsUpdate({
        updateId: body.updateId,
        selectedProviderIds: Array.isArray(body.selectedProviderIds)
          ? body.selectedProviderIds.filter((id): id is string => typeof id === 'string')
          : undefined,
        applyModels: body.applyModels,
        dismissUnselected: body.dismissUnselected,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error:
          err instanceof Error ? err.message : 'Errore durante applicazione aggiornamenti.',
      });
    }
  });

  app.post('/api/providers/custom', async (req, res) => {
    try {
      const body = req.body as {
        name?: string;
        baseUrl?: string;
        apiKey?: string;
        keyLabel?: string;
        customHeaders?: Record<string, string>;
        chatEndpoint?: string;
        modelsEndpoint?: string;
        defaultModel?: string;
      };

      const name = body.name?.trim();
      const baseUrl = body.baseUrl?.trim();
      if (!name || !baseUrl) {
        res.status(400).json({ error: 'Nome e Base URL sono obbligatori.' });
        return;
      }

      await validateOutboundUrl(baseUrl);

      const state = loadState();
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 24);
      const id = `custom-${slug || 'provider'}-${crypto.randomUUID().slice(0, 6)}`;

      const meta: StoredProviderMeta = {
        id,
        name,
        kind: 'custom',
        description: `Provider personalizzato compatibile OpenAI (${new URL(baseUrl).hostname})`,
        docsUrl: baseUrl,
        keyPlaceholder: 'sk-...',
        enabled: true,
        baseUrl,
        defaultBaseUrl: baseUrl,
        chatEndpoint: body.chatEndpoint?.trim() || '/chat/completions',
        modelsEndpoint: body.modelsEndpoint?.trim() || '/models',
        defaultModel: body.defaultModel?.trim() || undefined,
        status: 'not_configured',
      };

      if (body.apiKey && body.apiKey.trim().length > 0) {
        addProviderApiKey(id, body.apiKey.trim(), body.keyLabel, true);
      }
      if (body.customHeaders && typeof body.customHeaders === 'object') {
        const cleanHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(body.customHeaders)) {
          if (k.trim() && typeof v === 'string' && v.trim()) {
            cleanHeaders[k.trim()] = v.trim();
          }
        }
        if (Object.keys(cleanHeaders).length > 0) {
          setProviderCustomHeaders(id, cleanHeaders);
        }
      }

      state.providers.push(meta);
      state.settings.smartRouter.providerPriority.push(id);
      const syncError = await syncProviderModelsAfterConfig(state, meta);
      saveState(state);

      const count = state.models.filter((m) => m.providerId === meta.id).length;
      res.status(201).json({
        provider: toPublicProvider(meta, count),
        allModels: state.models,
        settings: state.settings,
        ...(syncError ? { syncError } : {}),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Errore creazione custom provider.',
      });
    }
  });

  app.delete('/api/providers/custom/:id', (req, res) => {
    const state = loadState();
    const target = state.providers.find((p) => p.id === req.params.id && p.kind === 'custom');
    if (!target) {
      res.status(404).json({ error: 'Custom provider non trovato.' });
      return;
    }
    deleteProviderAllSecrets(target.id);
    state.providers = state.providers.filter((p) => p.id !== target.id);
    state.models = state.models.filter((m) => m.providerId !== target.id);
    state.settings.smartRouter.providerPriority = state.settings.smartRouter.providerPriority.filter(
      (id) => id !== target.id,
    );
    if (state.settings.activeProviderId === target.id) {
      state.settings.activeProviderId = state.providers[0]?.id || 'openrouter';
      state.settings.activeModelId = '';
    }
    saveState(state);
    res.json({
      providers: getPublicProviders(state),
      models: state.models,
      settings: state.settings,
    });
  });

  app.post('/api/providers/:id/config', async (req, res) => {
    try {
      const state = loadState();
      const meta = state.providers.find((p) => p.id === req.params.id);
      if (!meta) {
        res.status(404).json({ error: 'Provider non trovato.' });
        return;
      }

      const body = req.body as {
        name?: string;
        apiKey?: string;
        keyLabel?: string;
        accountId?: string;
        anonymousMode?: boolean;
        baseUrl?: string;
        enabled?: boolean;
        customHeaders?: Record<string, string>;
        chatEndpoint?: string;
        modelsEndpoint?: string;
        defaultModel?: string;
      };

      if (body.baseUrl !== undefined) {
        const trimmedUrl = body.baseUrl.trim();
        if (trimmedUrl.length > 0) {
          await validateOutboundUrl(trimmedUrl);
          meta.baseUrl = trimmedUrl;
        } else {
          meta.baseUrl = undefined;
        }
      }

      if (typeof body.name === 'string' && body.name.trim() && meta.kind === 'custom') {
        meta.name = body.name.trim();
      }
      if (typeof body.enabled === 'boolean') {
        meta.enabled = body.enabled;
      }
      if (typeof body.anonymousMode === 'boolean' && meta.supportsAnonymous) {
        meta.anonymousMode = body.anonymousMode;
      }
      if (body.accountId !== undefined) {
        meta.accountId = body.accountId.trim() || undefined;
      }
      if (body.chatEndpoint !== undefined) {
        meta.chatEndpoint = body.chatEndpoint.trim() || '/chat/completions';
      }
      if (body.modelsEndpoint !== undefined) {
        meta.modelsEndpoint = body.modelsEndpoint.trim() || '/models';
      }
      if (body.defaultModel !== undefined) {
        meta.defaultModel = body.defaultModel.trim() || undefined;
      }

      if (typeof body.apiKey === 'string' && body.apiKey.trim().length > 0) {
        addProviderApiKey(meta.id, body.apiKey.trim(), body.keyLabel, true);
        // Key changed; require fresh verification rather than claiming online
        meta.status = 'not_configured';
        meta.lastError = undefined;
      }

      if (body.customHeaders && typeof body.customHeaders === 'object') {
        const cleanHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(body.customHeaders)) {
          if (k.trim() && typeof v === 'string' && v.trim()) {
            cleanHeaders[k.trim()] = v.trim();
          }
        }
        setProviderCustomHeaders(meta.id, cleanHeaders);
      }

      const shouldSync =
        (typeof body.apiKey === 'string' && body.apiKey.trim().length > 0) ||
        (typeof body.anonymousMode === 'boolean' && body.anonymousMode) ||
        (body.accountId !== undefined && body.accountId.trim().length > 0) ||
        (body.enabled === true &&
          isMetaConfigured(meta) &&
          !state.models.some((m) => m.providerId === meta.id));

      let syncError: NormalizedAIError | undefined;
      if (shouldSync) {
        syncError = await syncProviderModelsAfterConfig(state, meta);
      } else {
        ensureActiveSelection(state, meta);
      }

      saveState(state);
      const count = state.models.filter((m) => m.providerId === meta.id).length;
      res.json({
        provider: toPublicProvider(meta, count),
        allModels: state.models,
        settings: state.settings,
        ...(syncError ? { syncError } : {}),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Errore salvataggio configurazione.',
      });
    }
  });

  app.post('/api/providers/:id/keys', async (req, res) => {
    const state = loadState();
    const meta = state.providers.find((p) => p.id === req.params.id);
    if (!meta) {
      res.status(404).json({ error: 'Provider non trovato.' });
      return;
    }
    const body = req.body as { apiKey?: string; label?: string; activate?: boolean };
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!apiKey) {
      res.status(400).json({ error: 'Inserisci una API key valida.' });
      return;
    }
    const activate = body.activate !== false;
    addProviderApiKey(meta.id, apiKey, body.label, activate);

    let syncError: NormalizedAIError | undefined;
    if (activate && meta.enabled && isMetaConfigured(meta)) {
      meta.status = 'not_configured';
      meta.lastError = undefined;
      syncError = await syncProviderModelsAfterConfig(state, meta);
    }

    saveState(state);
    const count = state.models.filter((m) => m.providerId === meta.id).length;
    res.status(201).json({
      provider: toPublicProvider(meta, count),
      allModels: state.models,
      settings: state.settings,
      ...(syncError ? { syncError } : {}),
    });
  });

  app.post('/api/providers/:id/keys/:keyId/activate', async (req, res) => {
    const state = loadState();
    const meta = state.providers.find((p) => p.id === req.params.id);
    if (!meta) {
      res.status(404).json({ error: 'Provider non trovato.' });
      return;
    }
    const activated = activateProviderApiKey(meta.id, req.params.keyId);
    if (!activated) {
      res.status(404).json({ error: 'Chiave API non trovata.' });
      return;
    }

    let syncError: NormalizedAIError | undefined;
    const hasModels = state.models.some((m) => m.providerId === meta.id);
    if (meta.enabled && isMetaConfigured(meta)) {
      if (!hasModels) {
        syncError = await syncProviderModelsAfterConfig(state, meta);
      } else {
        const adapter = getAdapterForProvider(meta.id);
        const test = await adapter.testConnection(buildAdapterContext(meta));
        meta.status = test.status;
        meta.lastCheckedAt = new Date().toISOString();
        meta.lastLatencyMs = test.latencyMs;
        meta.lastError = test.error;
        syncError = test.error;
      }
    }

    saveState(state);
    const count = state.models.filter((m) => m.providerId === meta.id).length;
    res.json({
      provider: toPublicProvider(meta, count),
      allModels: state.models,
      settings: state.settings,
      ...(syncError ? { syncError } : {}),
    });
  });

  app.patch('/api/providers/:id/keys/:keyId', async (req, res) => {
    const state = loadState();
    const meta = state.providers.find((p) => p.id === req.params.id);
    if (!meta) {
      res.status(404).json({ error: 'Provider non trovato.' });
      return;
    }
    const body = req.body as { label?: string; apiKey?: string };
    const updated = updateProviderApiKey(meta.id, req.params.keyId, {
      label: typeof body.label === 'string' ? body.label : undefined,
      apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: 'Chiave API non trovata.' });
      return;
    }

    let syncError: NormalizedAIError | undefined;
    const secrets = getProviderSecrets(meta.id);
    if (body.apiKey && body.apiKey.trim() && secrets.activeKeyId === updated.id && meta.enabled && isMetaConfigured(meta)) {
      syncError = await syncProviderModelsAfterConfig(state, meta);
    }

    saveState(state);
    const count = state.models.filter((m) => m.providerId === meta.id).length;
    res.json({
      provider: toPublicProvider(meta, count),
      allModels: state.models,
      settings: state.settings,
      ...(syncError ? { syncError } : {}),
    });
  });

  app.delete('/api/providers/:id/keys/:keyId', async (req, res) => {
    const state = loadState();
    const meta = state.providers.find((p) => p.id === req.params.id);
    if (!meta) {
      res.status(404).json({ error: 'Provider non trovato.' });
      return;
    }
    const result = deleteProviderApiKeyById(meta.id, req.params.keyId);
    if (!result.removed) {
      res.status(404).json({ error: 'Chiave API non trovata.' });
      return;
    }

    if (result.remainingCount === 0 && !(meta.supportsAnonymous && meta.anonymousMode)) {
      meta.status = 'not_configured';
      meta.lastError = undefined;
      meta.lastCheckedAt = undefined;
      meta.lastLatencyMs = undefined;
      state.models = state.models.filter((m) => m.providerId !== meta.id);
    } else if (meta.enabled && isMetaConfigured(meta)) {
      const adapter = getAdapterForProvider(meta.id);
      const test = await adapter.testConnection(buildAdapterContext(meta));
      meta.status = test.status;
      meta.lastCheckedAt = new Date().toISOString();
      meta.lastLatencyMs = test.latencyMs;
      meta.lastError = test.error;
    }

    saveState(state);
    const count = state.models.filter((m) => m.providerId === meta.id).length;
    res.json({
      provider: toPublicProvider(meta, count),
      models: state.models,
      settings: state.settings,
    });
  });

  app.delete('/api/providers/:id/key', (req, res) => {
    const state = loadState();
    const meta = state.providers.find((p) => p.id === req.params.id);
    if (!meta) {
      res.status(404).json({ error: 'Provider non trovato.' });
      return;
    }
    deleteProviderApiKey(meta.id);
    meta.status = 'not_configured';
    meta.lastError = undefined;
    meta.lastCheckedAt = undefined;
    meta.lastLatencyMs = undefined;
    state.models = state.models.filter((m) => m.providerId !== meta.id);
    saveState(state);

    res.json({
      provider: toPublicProvider(meta, 0),
      models: state.models,
    });
  });

  app.post('/api/providers/:id/reveal-key', (req, res) => {
    const state = loadState();
    const meta = state.providers.find((p) => p.id === req.params.id);
    if (!meta) {
      res.status(404).json({ error: 'Provider non trovato.' });
      return;
    }
    const body = (req.body ?? {}) as { keyId?: string };
    const apiKey = revealProviderKeyById(meta.id, typeof body.keyId === 'string' ? body.keyId : undefined);
    if (!apiKey) {
      res.status(404).json({ error: 'Nessuna API key salvata per questo provider.' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ apiKey });
  });

  app.post('/api/providers/:id/test', async (req, res) => {
    const state = loadState();
    const meta = state.providers.find((p) => p.id === req.params.id);
    if (!meta) {
      res.status(404).json({ error: 'Provider non trovato.' });
      return;
    }

    const adapter = getAdapterForProvider(meta.id);
    const ctx = buildAdapterContext(meta);
    const result = await adapter.testConnection(ctx);

    meta.status = result.status;
    meta.lastCheckedAt = new Date().toISOString();
    meta.lastLatencyMs = result.latencyMs;
    meta.lastError = result.error;
    saveState(state);

    const count = state.models.filter((m) => m.providerId === meta.id).length;
    res.json({
      provider: toPublicProvider(meta, count),
      testResult: result,
    });
  });

  app.post('/api/providers/:id/models/refresh', async (req, res) => {
    const state = loadState();
    const meta = state.providers.find((p) => p.id === req.params.id);
    if (!meta) {
      res.status(404).json({ error: 'Provider non trovato.' });
      return;
    }

    const adapter = getAdapterForProvider(meta.id);
    const ctx = buildAdapterContext(meta);
    const start = Date.now();

    try {
      const models = await adapter.getModels(ctx);
      state.models = [
        ...state.models.filter((m) => m.providerId !== meta.id),
        ...models,
      ];
      meta.status = 'online';
      meta.lastCheckedAt = new Date().toISOString();
      meta.lastLatencyMs = Date.now() - start;
      meta.lastError = undefined;
      ensureActiveSelection(state, meta);
      saveState(state);

      res.json({
        models,
        allModels: state.models,
        provider: toPublicProvider(meta, models.length),
        settings: state.settings,
      });
    } catch (err) {
      const normalized: NormalizedAIError =
        err && typeof err === 'object' && 'code' in err && 'providerId' in err
          ? (err as NormalizedAIError)
          : adapter.normalizeError(err);

      meta.status =
        normalized.code === 'MISSING_API_KEY'
          ? 'not_configured'
          : normalized.code === 'HTTP_429' || normalized.code === 'QUOTA_EXHAUSTED'
            ? 'rate_limited'
            : 'error';
      meta.lastCheckedAt = new Date().toISOString();
      meta.lastLatencyMs = Date.now() - start;
      meta.lastError = normalized;
      saveState(state);

      const count = state.models.filter((m) => m.providerId === meta.id).length;
      res.status(normalized.httpStatus || 500).json({
        error: normalized,
        provider: toPublicProvider(meta, count),
      });
    }
  });

  app.post('/api/models/refresh-all', async (_req, res) => {
    const state = loadState();
    const configured = state.providers.filter((p) => p.enabled && isMetaConfigured(p));

    const errors: NormalizedAIError[] = [];
    await Promise.allSettled(
      configured.map(async (meta) => {
        const adapter = getAdapterForProvider(meta.id);
        const ctx = buildAdapterContext(meta);
        const start = Date.now();
        try {
          const models = await adapter.getModels(ctx);
          state.models = [
            ...state.models.filter((m) => m.providerId !== meta.id),
            ...models,
          ];
          meta.status = 'online';
          meta.lastCheckedAt = new Date().toISOString();
          meta.lastLatencyMs = Date.now() - start;
          meta.lastError = undefined;
        } catch (err) {
          const normalized =
            err && typeof err === 'object' && 'code' in err && 'providerId' in err
              ? (err as NormalizedAIError)
              : adapter.normalizeError(err);
          meta.status =
            normalized.code === 'HTTP_429' || normalized.code === 'QUOTA_EXHAUSTED'
              ? 'rate_limited'
              : 'error';
          meta.lastCheckedAt = new Date().toISOString();
          meta.lastError = normalized;
          errors.push(normalized);
        }
      }),
    );

    saveState(state);
    res.json({
      providers: getPublicProviders(state),
      models: state.models,
      errors,
    });
  });

  app.post('/api/chat', async (req, res) => {
    const state = loadState();
    const body = req.body as {
      autoMode?: boolean;
      providerId?: string;
      modelId?: string;
      taskCategory?: TaskCategory;
      systemPrompt?: string;
      messages?: Array<{
        role: 'user' | 'assistant' | 'system';
        content: string;
        attachments?: Array<{ mimeType: string; dataBase64: string; name?: string }>;
      }>;
      stream?: boolean;
    };

    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) {
      res.status(400).json({ error: 'Inserisci almeno un messaggio.' });
      return;
    }

    const useStream = body.stream !== false;
    const autoMode = Boolean(body.autoMode);
    const taskCategory: TaskCategory =
      body.taskCategory || state.settings.smartRouter.taskCategory || 'general';
    const systemPrompt =
      body.systemPrompt !== undefined ? body.systemPrompt : state.settings.systemPrompt;

    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort(new Error('Client disconnected'));
      }
    });

    if (useStream) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const sendEvent = (event: string, data: unknown) => {
        if (!res.writableEnded) {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        }
      };

      try {
        const result = await executeRoutedChat(state, {
          autoMode,
          requestedProviderId: body.providerId,
          requestedModelId: body.modelId,
          taskCategory,
          request: {
            messages,
            systemPrompt,
          },
          stream: true,
          signal: abortController.signal,
          onMeta: (meta) => sendEvent('meta', meta),
          onFallback: (attempt, nextCandidate) =>
            sendEvent('fallback', {
              attempt,
              nextProviderId: nextCandidate.provider.id,
              nextProviderName: nextCandidate.provider.name,
              nextModelId: nextCandidate.modelId,
            }),
          onDelta: (chunk) => {
            if (chunk.delta) {
              sendEvent('delta', { delta: chunk.delta });
            }
          },
        });

        sendEvent('done', {
          text: result.response.text,
          providerId: result.providerId,
          providerName: result.providerName,
          modelId: result.modelId,
          modelName: result.modelName,
          fallbackUsed: result.fallbackUsed,
          fallbackChain: result.fallbackChain,
          latencyMs: result.response.latencyMs,
          usage: result.response.usage,
          providers: getPublicProviders(state),
          usageLogs: state.usageLogs,
        });
        res.end();
      } catch (err) {
        if (abortController.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          res.end();
          return;
        }
        const normalized: NormalizedAIError =
          err && typeof err === 'object' && 'code' in err && 'providerId' in err
            ? (err as NormalizedAIError)
            : {
                code: 'UNKNOWN_ERROR',
                message: err instanceof Error ? err.message : 'Errore imprevisto.',
                retryable: false,
                allowFallback: false,
                providerId: body.providerId || 'unknown',
              };
        sendEvent('error', {
          error: normalized,
          providers: getPublicProviders(state),
          usageLogs: state.usageLogs,
        });
        res.end();
      }
      return;
    }

    try {
      const result = await executeRoutedChat(state, {
        autoMode,
        requestedProviderId: body.providerId,
        requestedModelId: body.modelId,
        taskCategory,
        request: {
          messages,
          systemPrompt,
        },
        stream: false,
        signal: abortController.signal,
      });

      res.json({
        text: result.response.text,
        providerId: result.providerId,
        providerName: result.providerName,
        modelId: result.modelId,
        modelName: result.modelName,
        fallbackUsed: result.fallbackUsed,
        fallbackChain: result.fallbackChain,
        latencyMs: result.response.latencyMs,
        usage: result.response.usage,
        providers: getPublicProviders(state),
        usageLogs: state.usageLogs,
      });
    } catch (err) {
      const normalized: NormalizedAIError =
        err && typeof err === 'object' && 'code' in err && 'providerId' in err
          ? (err as NormalizedAIError)
          : {
              code: 'UNKNOWN_ERROR',
              message: err instanceof Error ? err.message : 'Errore imprevisto.',
              retryable: false,
              allowFallback: false,
              providerId: body.providerId || 'unknown',
            };
      res.status(normalized.httpStatus || 500).json({ error: normalized });
    }
  });

  app.put('/api/chats', (req, res) => {
    const state = loadState();
    const session = req.body as ChatSession;
    if (!session || !session.id) {
      res.status(400).json({ error: 'Sessione chat non valida.' });
      return;
    }
    const idx = state.chatSessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
      state.chatSessions[idx] = session;
    } else {
      state.chatSessions.unshift(session);
    }
    if (state.chatSessions.length > 50) {
      state.chatSessions = state.chatSessions.slice(0, 50);
    }
    saveState(state);
    res.json({ ok: true });
  });

  app.delete('/api/chats/:id', (req, res) => {
    const state = loadState();
    state.chatSessions = state.chatSessions.filter((s) => s.id !== req.params.id);
    saveState(state);
    res.json({ chatSessions: state.chatSessions });
  });

  app.get('/api/usage', (_req, res) => {
    const state = loadState();
    res.json({ usageLogs: state.usageLogs });
  });

  app.delete('/api/usage', (_req, res) => {
    const state = loadState();
    state.usageLogs = [];
    saveState(state);
    res.json({ usageLogs: [] });
  });

  app.post('/api/backup/export', (req, res) => {
    try {
      const state = loadState();
      const body = req.body as { includeSecrets?: boolean; password?: string };

      const plainData = {
        settings: state.settings,
        providers: state.providers.map((p) => ({
          id: p.id,
          name: p.name,
          kind: p.kind,
          description: p.description,
          docsUrl: p.docsUrl,
          keyPlaceholder: p.keyPlaceholder,
          requiresAccountId: p.requiresAccountId,
          accountId: p.accountId,
          enabled: p.enabled,
          baseUrl: p.baseUrl,
          defaultBaseUrl: p.defaultBaseUrl,
          chatEndpoint: p.chatEndpoint,
          modelsEndpoint: p.modelsEndpoint,
          defaultModel: p.defaultModel,
        })),
      };

      if (body.includeSecrets) {
        if (!body.password || body.password.length < 6) {
          res.status(400).json({
            error: 'Per includere le API key è obbligatoria una password di almeno 6 caratteri.',
          });
          return;
        }
        const secrets = getAllProviderSecrets();
        const encryptedPayload = encryptBackupPayload(
          {
            ...plainData,
            secrets,
          },
          body.password,
        );
        const bundle: ExportBundle = {
          format: 'free-ai-hub-backup',
          version: 1,
          encrypted: true,
          exportedAt: new Date().toISOString(),
          encryptedPayload,
        };
        res.setHeader('Cache-Control', 'no-store');
        res.json(bundle);
        return;
      }

      const bundle: ExportBundle = {
        format: 'free-ai-hub-backup',
        version: 1,
        encrypted: false,
        exportedAt: new Date().toISOString(),
        data: plainData,
      };
      res.json(bundle);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Errore esportazione configurazione.',
      });
    }
  });

  app.post('/api/backup/import', async (req, res) => {
    try {
      const body = req.body as { bundle?: ExportBundle; password?: string };
      const bundle = body.bundle;
      if (!bundle || bundle.format !== 'free-ai-hub-backup') {
        res.status(400).json({ error: 'Formato file di configurazione non riconosciuto.' });
        return;
      }

      let importedData: NonNullable<ExportBundle['data']> & {
        secrets?: Record<string, { apiKey?: string; customHeaders?: Record<string, string> }>;
      };

      if (bundle.encrypted) {
        if (!bundle.encryptedPayload) {
          res.status(400).json({ error: 'Payload cifrato mancante.' });
          return;
        }
        importedData = decryptBackupPayload(
          bundle.encryptedPayload,
          body.password || '',
        ) as typeof importedData;
      } else if (bundle.data) {
        importedData = bundle.data;
      } else {
        res.status(400).json({ error: 'Dati di configurazione mancanti nel file.' });
        return;
      }

      const state = loadState();
      const currentById = new Map(state.providers.map((p) => [p.id, p]));
      const builtInIds = new Set(BUILTIN_PROVIDERS.map((b) => b.id));

      if (Array.isArray(importedData.providers)) {
        for (const p of importedData.providers) {
          if (p.baseUrl) {
            await validateOutboundUrl(p.baseUrl);
          }
          const existing = currentById.get(p.id);
          if (existing) {
            existing.enabled = p.enabled;
            existing.baseUrl = p.baseUrl;
            existing.accountId = p.accountId;
            existing.chatEndpoint = p.chatEndpoint;
            existing.modelsEndpoint = p.modelsEndpoint;
            existing.defaultModel = p.defaultModel;
          } else if (p.kind === 'custom' || !builtInIds.has(p.id)) {
            state.providers.push({
              id: p.id,
              name: p.name,
              kind: 'custom',
              description: p.description,
              docsUrl: p.docsUrl,
              keyPlaceholder: p.keyPlaceholder || 'sk-...',
              requiresAccountId: p.requiresAccountId,
              accountId: p.accountId,
              enabled: p.enabled,
              baseUrl: p.baseUrl,
              defaultBaseUrl: p.defaultBaseUrl,
              chatEndpoint: p.chatEndpoint || '/chat/completions',
              modelsEndpoint: p.modelsEndpoint || '/models',
              defaultModel: p.defaultModel,
              status: 'not_configured',
            });
          }
        }
      }

      if (importedData.settings) {
        state.settings = {
          ...structuredClone(DEFAULT_SETTINGS),
          ...importedData.settings,
          smartRouter: {
            ...structuredClone(DEFAULT_SETTINGS.smartRouter),
            ...(importedData.settings.smartRouter ?? {}),
          },
          autoApprove: sanitizeAutoApproveSettings(
            importedData.settings.autoApprove,
            getDefaultAutoApproveSettings(),
          ),
          ...sanitizeAgentsSettings(
            importedData.settings.agents,
            importedData.settings.defaultAgentId,
          ),
        };
      }

      if (importedData.secrets && typeof importedData.secrets === 'object') {
        for (const [providerId, sec] of Object.entries(importedData.secrets)) {
          restoreProviderSecretEntry(providerId, sec as ProviderSecretEntry);
        }
      }

      saveState(state);
      res.json({
        providers: getPublicProviders(state),
        settings: state.settings,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Errore importazione backup.',
      });
    }
  });

  app.get('/api/pwa-sync/snapshot', (_req, res) => {
    try {
      const state = loadState();
      const secrets = getAllProviderSecrets();
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        version: 1,
        savedAt: new Date().toISOString(),
        settings: state.settings,
        providers: state.providers.map((p) => ({
          id: p.id,
          name: p.name,
          kind: p.kind,
          catalogSource: p.catalogSource,
          description: p.description,
          docsUrl: p.docsUrl,
          keyPlaceholder: p.keyPlaceholder,
          requiresAccountId: p.requiresAccountId,
          accountId: p.accountId,
          supportsAnonymous: p.supportsAnonymous,
          anonymousMode: p.anonymousMode,
          enabled: p.enabled,
          baseUrl: p.baseUrl,
          defaultBaseUrl: p.defaultBaseUrl,
          chatEndpoint: p.chatEndpoint,
          modelsEndpoint: p.modelsEndpoint,
          defaultModel: p.defaultModel,
          status: p.status,
          lastCheckedAt: p.lastCheckedAt,
          lastLatencyMs: p.lastLatencyMs,
        })),
        secrets,
        models: state.models,
        chatSessions: state.chatSessions,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Errore esportazione snapshot PWA.',
      });
    }
  });

  app.post('/api/pwa-sync/restore', async (req, res) => {
    try {
      const body = req.body as {
        snapshot?: {
          version?: number;
          settings?: AppSettings;
          providers?: StoredProviderMeta[];
          secrets?: Record<string, ProviderSecretEntry>;
          models?: PersistedState['models'];
          chatSessions?: ChatSession[];
        };
      };
      const snapshot = body?.snapshot;
      if (!snapshot || typeof snapshot !== 'object') {
        res.status(400).json({ error: 'Snapshot PWA non valido.' });
        return;
      }

      const state = loadState();
      const currentById = new Map(state.providers.map((p) => [p.id, p]));
      const builtInIds = new Set(BUILTIN_PROVIDERS.map((b) => b.id));

      if (Array.isArray(snapshot.providers)) {
        for (const p of snapshot.providers) {
          if (!p || typeof p.id !== 'string') continue;
          if (p.baseUrl) {
            await validateOutboundUrl(p.baseUrl);
          }
          const existing = currentById.get(p.id);
          if (existing) {
            existing.enabled = typeof p.enabled === 'boolean' ? p.enabled : existing.enabled;
            existing.baseUrl = p.baseUrl;
            existing.accountId = p.accountId;
            existing.anonymousMode =
              typeof p.anonymousMode === 'boolean' ? p.anonymousMode : existing.anonymousMode;
            existing.chatEndpoint = p.chatEndpoint ?? existing.chatEndpoint;
            existing.modelsEndpoint = p.modelsEndpoint ?? existing.modelsEndpoint;
            existing.defaultModel = p.defaultModel ?? existing.defaultModel;
            if (p.status) existing.status = p.status;
          } else if (p.kind === 'custom' || !builtInIds.has(p.id)) {
            state.providers.push({
              id: p.id,
              name: p.name || p.id,
              kind: 'custom',
              description: p.description || '',
              docsUrl: p.docsUrl || '',
              keyPlaceholder: p.keyPlaceholder || 'sk-...',
              requiresAccountId: p.requiresAccountId,
              accountId: p.accountId,
              supportsAnonymous: p.supportsAnonymous,
              anonymousMode: p.anonymousMode,
              enabled: typeof p.enabled === 'boolean' ? p.enabled : true,
              baseUrl: p.baseUrl,
              defaultBaseUrl: p.defaultBaseUrl || p.baseUrl || '',
              chatEndpoint: p.chatEndpoint || '/chat/completions',
              modelsEndpoint: p.modelsEndpoint || '/models',
              defaultModel: p.defaultModel,
              status: p.status || 'not_configured',
            });
          }
        }
      }

      if (snapshot.settings && typeof snapshot.settings === 'object') {
        state.settings = {
          ...structuredClone(DEFAULT_SETTINGS),
          ...snapshot.settings,
          smartRouter: {
            ...structuredClone(DEFAULT_SETTINGS.smartRouter),
            ...(snapshot.settings.smartRouter ?? {}),
          },
          sourceBackup: {
            ...structuredClone(DEFAULT_SETTINGS.sourceBackup!),
            ...(snapshot.settings.sourceBackup ?? {}),
          },
          pcAccess: sanitizePcAccessSettings(
            snapshot.settings.pcAccess,
            getDefaultPcAccessSettings(),
          ),
          autoApprove: sanitizeAutoApproveSettings(
            snapshot.settings.autoApprove,
            getDefaultAutoApproveSettings(),
          ),
          ...sanitizeAgentsSettings(
            snapshot.settings.agents,
            snapshot.settings.defaultAgentId,
          ),
        };
      }

      if (snapshot.secrets && typeof snapshot.secrets === 'object') {
        for (const [providerId, sec] of Object.entries(snapshot.secrets)) {
          if (sec && typeof sec === 'object') {
            restoreProviderSecretEntry(providerId, sec);
          }
        }
      }

      if (state.models.length === 0 && Array.isArray(snapshot.models) && snapshot.models.length > 0) {
        const providerIds = new Set(state.providers.map((p) => p.id));
        state.models = snapshot.models.filter((m) => m && providerIds.has(m.providerId));
      }

      if (Array.isArray(snapshot.chatSessions) && snapshot.chatSessions.length > 0) {
        const existingSessionIds = new Set(state.chatSessions.map((s) => s.id));
        for (const s of snapshot.chatSessions) {
          if (s && s.id && !existingSessionIds.has(s.id)) {
            state.chatSessions.push(s);
          }
        }
      }

      saveState(state);
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        restored: true,
        providers: getPublicProviders(state),
        settings: state.settings,
        models: state.models,
        chatSessions: state.chatSessions,
        gateway: getGatewayTokenStatus(),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Errore ripristino snapshot PWA.',
      });
    }
  });

  app.get('/api/backup/source-manifest', (_req, res) => {
    try {
      const manifest = getSourceBackupManifest();
      res.setHeader('Cache-Control', 'no-store');
      res.json(manifest);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Errore scansione file progetto.',
      });
    }
  });

  app.get('/api/backup/source-archive', (req, res) => {
    try {
      const requestedName =
        typeof req.query.filename === 'string' ? req.query.filename : undefined;
      const safeName = sanitizeBackupArchiveFileName(requestedName);
      const { zipBuffer, fileCount, uncompressedBytes } = buildSourceBackupZip();
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      res.setHeader('X-Backup-File-Count', String(fileCount));
      res.setHeader('X-Backup-Uncompressed-Bytes', String(uncompressedBytes));
      res.send(zipBuffer);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Errore creazione archivio sorgente.',
      });
    }
  });

  // Local PC Tools Discovery, Extensible Registration & User-Authorized Execution
  app.get('/api/pc/tools', (req, res) => {
    try {
      const state = loadState();
      const pcAccess = state.settings.pcAccess ?? getDefaultPcAccessSettings();
      const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const snapshot = discoverPcTools(pcAccess, refresh);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ snapshot });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Errore durante il rilevamento delle applicazioni locali.',
      });
    }
  });

  app.post('/api/pc/custom-tool', (req, res) => {
    try {
      const state = loadState();
      const current = state.settings.pcAccess ?? getDefaultPcAccessSettings();
      const body = (req.body ?? {}) as {
        name?: string;
        executable?: string;
        category?: string;
        isGui?: boolean;
        description?: string;
      };
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const executable = typeof body.executable === 'string' ? body.executable.trim() : '';
      if (!name || !executable) {
        res.status(400).json({ error: 'Nome e comando/percorso eseguibile sono obbligatori.' });
        return;
      }

      const id = `custom-${name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 24) || 'app'}-${crypto.randomUUID().slice(0, 6)}`;

      const nextPcAccess = sanitizePcAccessSettings(
        {
          ...current,
          customTools: [
            ...current.customTools,
            {
              id,
              name,
              executable,
              category: (body.category as 'custom') || 'custom',
              isGui: Boolean(body.isGui),
              description: typeof body.description === 'string' ? body.description : undefined,
            },
          ],
          enabledToolIds: Array.from(new Set([...current.enabledToolIds, id])),
        },
        current,
      );

      state.settings.pcAccess = nextPcAccess;
      saveState(state);
      const snapshot = discoverPcTools(nextPcAccess, true);
      res.status(201).json({ settings: state.settings, snapshot });
    } catch (err) {
      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : 'Errore registrazione applicazione personalizzata.',
      });
    }
  });

  app.delete('/api/pc/custom-tool/:id', (req, res) => {
    const state = loadState();
    const current = state.settings.pcAccess ?? getDefaultPcAccessSettings();
    const targetId = req.params.id;
    const exists = current.customTools.some((t) => t.id === targetId);
    if (!exists) {
      res.status(404).json({ error: 'Applicazione personalizzata non trovata.' });
      return;
    }

    const nextPcAccess = sanitizePcAccessSettings(
      {
        ...current,
        customTools: current.customTools.filter((t) => t.id !== targetId),
        enabledToolIds: current.enabledToolIds.filter((id) => id !== targetId),
        disabledToolIds: current.disabledToolIds.filter((id) => id !== targetId),
      },
      current,
    );

    state.settings.pcAccess = nextPcAccess;
    saveState(state);
    const snapshot = discoverPcTools(nextPcAccess, true);
    res.json({ settings: state.settings, snapshot });
  });

  app.post('/api/pc/execute', async (req, res) => {
    try {
      const state = loadState();
      const pcAccess = state.settings.pcAccess ?? getDefaultPcAccessSettings();
      const autoApprove = state.settings.autoApprove ?? getDefaultAutoApproveSettings();
      const body = (req.body ?? {}) as {
        toolId?: string;
        toolQuery?: string;
        command?: string;
        args?: string[];
        script?: string;
        workingDirectory?: string;
        confirmedByUser?: boolean;
        autoApproved?: boolean;
        interactiveConsole?: boolean;
        ephemeralSecret?: string;
      };

      const result = await executeAuthorizedPcTool(
        {
          toolId: typeof body.toolId === 'string' ? body.toolId : undefined,
          toolQuery: typeof body.toolQuery === 'string' ? body.toolQuery : undefined,
          command: typeof body.command === 'string' ? body.command : undefined,
          args: Array.isArray(body.args) ? body.args : undefined,
          script: typeof body.script === 'string' ? body.script : undefined,
          workingDirectory:
            typeof body.workingDirectory === 'string' ? body.workingDirectory : undefined,
          confirmedByUser: body.confirmedByUser === true,
          autoApproved: body.autoApproved === true,
          interactiveConsole: body.interactiveConsole === true,
          ephemeralSecret:
            typeof body.ephemeralSecret === 'string' && body.ephemeralSecret.length > 0
              ? body.ephemeralSecret
              : undefined,
        },
        pcAccess,
        autoApprove,
      );

      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (err) {
      const statusCode =
        err && typeof err === 'object' && 'statusCode' in err
          ? Number((err as { statusCode: number }).statusCode) || 400
          : 400;
      res.status(statusCode).json({
        error: err instanceof Error ? err.message : 'Errore esecuzione comando sul PC.',
      });
    }
  });

  // Hub Gateway Token Management (for Kilo Code & Cline in VS Code)
  app.post('/api/gateway/token/generate', (_req, res) => {
    const gateway = generateGatewayToken();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ gateway });
  });

  app.post('/api/gateway/token/reveal', (_req, res) => {
    const token = revealGatewayToken();
    if (!token) {
      res.status(404).json({ error: 'Nessun token Gateway generato.' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ token });
  });

  app.delete('/api/gateway/token', (_req, res) => {
    revokeGatewayToken();
    res.json({ gateway: getGatewayTokenStatus() });
  });

  // OpenAI-compatible Gateway Endpoints (/v1/models & /v1/chat/completions)
  const authenticateGateway = (req: express.Request, res: express.Response): boolean => {
    const authHeader = req.headers.authorization;
    const xApiKey = req.headers['x-api-key'];
    let token = '';
    if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (typeof xApiKey === 'string') {
      token = xApiKey.trim();
    }
    if (!verifyGatewayToken(token)) {
      res.status(401).json({
        error: {
          message: 'Invalid or missing Free AI Hub Gateway token.',
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      });
      return false;
    }
    return true;
  };

  app.get('/v1/models', (req, res) => {
    if (!authenticateGateway(req, res)) return;
    const state = loadState();
    const publicProviders = getPublicProviders(state);
    const activeIds = new Set(
      publicProviders.filter((p) => p.configured && p.enabled).map((p) => p.id),
    );
    const nowSec = Math.floor(Date.now() / 1000);

    const data = [
      { id: 'auto', object: 'model', created: nowSec, owned_by: 'free-ai-hub' },
      { id: 'auto:coding', object: 'model', created: nowSec, owned_by: 'free-ai-hub' },
      { id: 'auto:reasoning', object: 'model', created: nowSec, owned_by: 'free-ai-hub' },
      { id: 'auto:fast', object: 'model', created: nowSec, owned_by: 'free-ai-hub' },
      { id: 'auto:vision', object: 'model', created: nowSec, owned_by: 'free-ai-hub' },
      ...state.models
        .filter((m) => activeIds.has(m.providerId))
        .map((m) => ({
          id: `${m.providerId}/${m.id}`,
          object: 'model',
          created: nowSec,
          owned_by: m.providerId,
        })),
    ];

    res.json({ object: 'list', data });
  });

  app.post('/v1/chat/completions', async (req, res) => {
    if (!authenticateGateway(req, res)) return;

    const state = loadState();
    const body = req.body as {
      model?: string;
      stream?: boolean;
      temperature?: number;
      max_tokens?: number;
      messages?: Array<{
        role: 'system' | 'developer' | 'user' | 'assistant';
        content:
          | string
          | Array<{
              type?: string;
              text?: string;
              image_url?: { url?: string };
            }>;
      }>;
    };

    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    if (rawMessages.length === 0) {
      res.status(400).json({
        error: {
          message: 'messages array is required',
          type: 'invalid_request_error',
        },
      });
      return;
    }

    const systemParts: string[] = [];
    const normalizedMessages: Array<{
      role: 'user' | 'assistant' | 'system';
      content: string;
      attachments?: Array<{ mimeType: string; dataBase64: string }>;
    }> = [];

    for (const m of rawMessages) {
      let text = '';
      const attachments: Array<{ mimeType: string; dataBase64: string }> = [];

      if (typeof m.content === 'string') {
        text = m.content;
      } else if (Array.isArray(m.content)) {
        for (const part of m.content) {
          if (part.type === 'text' && typeof part.text === 'string') {
            text += (text ? '\n' : '') + part.text;
          } else if (part.type === 'image_url' && part.image_url?.url) {
            const match = part.image_url.url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
            if (match) {
              attachments.push({ mimeType: match[1], dataBase64: match[2] });
            }
          }
        }
      }

      if (m.role === 'system' || m.role === 'developer') {
        if (text) systemParts.push(text);
      } else {
        normalizedMessages.push({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: text,
          attachments: attachments.length > 0 ? attachments : undefined,
        });
      }
    }

    const requestedModel = (body.model || 'auto').trim();
    let autoMode = false;
    let taskCategory: TaskCategory = 'coding';
    let providerId = state.settings.activeProviderId;
    let modelId = requestedModel;

    if (requestedModel === 'auto' || requestedModel.startsWith('auto:')) {
      autoMode = true;
      const cat = requestedModel.split(':')[1] as TaskCategory | undefined;
      if (
        cat === 'general' ||
        cat === 'coding' ||
        cat === 'reasoning' ||
        cat === 'fast' ||
        cat === 'vision'
      ) {
        taskCategory = cat;
      }
      modelId = '';
    } else {
      const slashIdx = requestedModel.indexOf('/');
      const potentialProvider = slashIdx > 0 ? requestedModel.slice(0, slashIdx) : '';
      const knownProvider = state.providers.find((p) => p.id === potentialProvider);
      if (knownProvider) {
        providerId = knownProvider.id;
        modelId = requestedModel.slice(slashIdx + 1);
      } else {
        const matchedModel = state.models.find((m) => m.id === requestedModel);
        if (matchedModel) {
          providerId = matchedModel.providerId;
          modelId = matchedModel.id;
        }
      }
    }

    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort(new Error('Client disconnected'));
      }
    });

    const completionId = `chatcmpl-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);
    const useStream = Boolean(body.stream);

    if (useStream) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      let currentModelLabel = requestedModel;

      try {
        const result = await executeRoutedChat(state, {
          autoMode,
          requestedProviderId: providerId,
          requestedModelId: modelId,
          taskCategory,
          request: {
            messages: normalizedMessages,
            systemPrompt: systemParts.join('\n\n') || state.settings.systemPrompt,
            temperature: body.temperature,
            maxTokens: body.max_tokens,
          },
          stream: true,
          signal: abortController.signal,
          onMeta: (meta) => {
            currentModelLabel = `${meta.providerId}/${meta.modelId}`;
          },
          onDelta: (chunk) => {
            if (!chunk.delta || res.writableEnded) return;
            const frame = {
              id: completionId,
              object: 'chat.completion.chunk',
              created,
              model: currentModelLabel,
              choices: [
                {
                  index: 0,
                  delta: { content: chunk.delta },
                  finish_reason: null,
                },
              ],
            };
            res.write(`data: ${JSON.stringify(frame)}\n\n`);
          },
        });

        if (!res.writableEnded) {
          const finalFrame = {
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model: `${result.providerId}/${result.modelId}`,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: 'stop',
              },
            ],
            ...(result.response.usage
              ? {
                  usage: {
                    prompt_tokens: result.response.usage.inputTokens ?? 0,
                    completion_tokens: result.response.usage.outputTokens ?? 0,
                    total_tokens: result.response.usage.totalTokens ?? 0,
                  },
                }
              : {}),
          };
          res.write(`data: ${JSON.stringify(finalFrame)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        }
      } catch (err) {
        if (abortController.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          res.end();
          return;
        }
        const normalized = err as NormalizedAIError;
        if (!res.writableEnded) {
          res.write(
            `data: ${JSON.stringify({
              error: {
                message: normalized.message || 'Gateway error',
                code: normalized.code || 'gateway_error',
              },
            })}\n\n`,
          );
          res.write('data: [DONE]\n\n');
          res.end();
        }
      }
      return;
    }

    try {
      const result = await executeRoutedChat(state, {
        autoMode,
        requestedProviderId: providerId,
        requestedModelId: modelId,
        taskCategory,
        request: {
          messages: normalizedMessages,
          systemPrompt: systemParts.join('\n\n') || state.settings.systemPrompt,
          temperature: body.temperature,
          maxTokens: body.max_tokens,
        },
        stream: false,
        signal: abortController.signal,
      });

      res.json({
        id: completionId,
        object: 'chat.completion',
        created,
        model: `${result.providerId}/${result.modelId}`,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: result.response.text,
            },
            finish_reason: result.response.finishReason || 'stop',
          },
        ],
        usage: {
          prompt_tokens: result.response.usage?.inputTokens ?? 0,
          completion_tokens: result.response.usage?.outputTokens ?? 0,
          total_tokens: result.response.usage?.totalTokens ?? 0,
        },
      });
    } catch (err) {
      const normalized = err as NormalizedAIError;
      res.status(normalized.httpStatus || 500).json({
        error: {
          message: normalized.message || 'Gateway error',
          type: 'api_error',
          code: normalized.code,
        },
      });
    }
  });

  // Dedicated Corporate Copilot Pro Routes (M365 Entra ID + GitHub Enterprise/Pro)
  const renderCopilotPopupHtml = (payload: {
    type: 'COPILOT_AUTH_SUCCESS' | 'COPILOT_AUTH_ERROR';
    mode: 'm365' | 'github';
    message: string;
  }): string => {
    const safeJson = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    return `<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8" />
    <title>Copilot Pro Auth</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #09090b; color: #f4f4f5; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 24px; text-align: center; }
      .box { max-width: 420px; border: 1px solid #27272a; border-radius: 12px; padding: 20px; background: #18181b; }
      p { color: #a1a1aa; font-size: 14px; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="box">
      <h2 id="title">Autenticazione</h2>
      <p id="msg"></p>
    </div>
    <script>
      (function() {
        var data = ${safeJson};
        document.getElementById('title').textContent = data.type === 'COPILOT_AUTH_SUCCESS' ? 'Accesso aziendale completato' : 'Errore autenticazione';
        document.getElementById('msg').textContent = data.message;
        if (window.opener) {
          window.opener.postMessage(data, '*');
          if (data.type === 'COPILOT_AUTH_SUCCESS') {
            setTimeout(function() { window.close(); }, 600);
          }
        }
      })();
    </script>
  </body>
</html>`;
  };

  app.get('/api/copilot/status', (req, res) => {
    const clientOrigin = typeof req.query.origin === 'string' ? req.query.origin : undefined;
    const baseUrl = resolveAppBaseUrl(clientOrigin);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      copilot: getPublicCopilotStatus(),
      redirectUris: {
        m365: `${baseUrl}/api/copilot/m365/callback`,
        github: `${baseUrl}/api/copilot/github/callback`,
      },
    });
  });

  app.put('/api/copilot/config', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        mode?: 'm365' | 'github';
        tenantId?: string;
        m365ClientId?: string;
        enterpriseUrl?: string;
        githubClientId?: string;
        selectedModelId?: string;
      };
      const copilot = await updateCopilotConfig(body);
      res.json({ copilot });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Errore salvataggio configurazione Copilot.',
      });
    }
  });

  app.post('/api/copilot/disconnect', (req, res) => {
    const body = (req.body ?? {}) as { mode?: 'm365' | 'github' };
    const copilot = disconnectCopilotAccount(body.mode);
    res.json({ copilot });
  });

  app.post('/api/copilot/m365/login-credentials', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        email?: string;
        password?: string;
        tenantId?: string;
        clientId?: string;
        origin?: string;
      };
      const result = await loginM365WithCredentials({
        email: typeof body.email === 'string' ? body.email : '',
        password: typeof body.password === 'string' ? body.password : '',
        tenantId: typeof body.tenantId === 'string' ? body.tenantId : undefined,
        clientId: typeof body.clientId === 'string' ? body.clientId : undefined,
        clientOrigin: typeof body.origin === 'string' ? body.origin : undefined,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (err) {
      res.status(401).json({
        error:
          err instanceof Error
            ? err.message
            : 'Credenziali aziendali non valide o accesso rifiutato.',
      });
    }
  });

  app.post('/api/copilot/m365/device/start', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        tenantId?: string;
        clientId?: string;
        emailHint?: string;
      };
      const data = await startM365DeviceLogin(body);
      res.setHeader('Cache-Control', 'no-store');
      res.json(data);
    } catch (err) {
      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : 'Errore avvio login Microsoft Device Code.',
      });
    }
  });

  app.post('/api/copilot/m365/device/poll', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        deviceCode?: string;
        tenantId?: string;
        clientId?: string;
        emailHint?: string;
      };
      const data = await pollM365DeviceLogin({
        deviceCode: typeof body.deviceCode === 'string' ? body.deviceCode : '',
        tenantId: typeof body.tenantId === 'string' ? body.tenantId : undefined,
        clientId: typeof body.clientId === 'string' ? body.clientId : undefined,
        emailHint: typeof body.emailHint === 'string' ? body.emailHint : undefined,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json(data);
    } catch (err) {
      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : 'Errore verifica autorizzazione Microsoft.',
      });
    }
  });

  app.post('/api/copilot/license/refresh', async (req, res) => {
    try {
      const body = (req.body ?? {}) as { mode?: 'm365' | 'github' };
      const copilot = await refreshCopilotLicenseStatus(body.mode);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ copilot });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Impossibile verificare la licenza Copilot.',
      });
    }
  });

  app.post('/api/copilot/m365/auth-url', (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        tenantId?: string;
        clientId?: string;
        origin?: string;
        loginHint?: string;
      };
      const result = buildM365AuthUrl({
        tenantId: body.tenantId,
        clientId: body.clientId,
        clientOrigin: body.origin,
        loginHint: body.loginHint,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Impossibile generare URL login Microsoft.',
      });
    }
  });

  const handleM365Callback = async (req: express.Request, res: express.Response) => {
    try {
      const info = await completeM365OAuthCallback({
        code: typeof req.query.code === 'string' ? req.query.code : undefined,
        state: typeof req.query.state === 'string' ? req.query.state : undefined,
        error: typeof req.query.error === 'string' ? req.query.error : undefined,
        errorDescription:
          typeof req.query.error_description === 'string'
            ? req.query.error_description
            : undefined,
      });
      const who = info.accountEmail || info.accountName || 'Account aziendale';
      res.send(
        renderCopilotPopupHtml({
          type: 'COPILOT_AUTH_SUCCESS',
          mode: 'm365',
          message: `Connesso come ${who}. Questa finestra si chiuderà automaticamente.`,
        }),
      );
    } catch (err) {
      res.status(400).send(
        renderCopilotPopupHtml({
          type: 'COPILOT_AUTH_ERROR',
          mode: 'm365',
          message: err instanceof Error ? err.message : 'Accesso Microsoft non riuscito.',
        }),
      );
    }
  };
  app.get(['/api/copilot/m365/callback', '/api/copilot/m365/callback/'], handleM365Callback);

  app.post('/api/copilot/github/device/start', async (req, res) => {
    try {
      const body = (req.body ?? {}) as { enterpriseUrl?: string; clientId?: string };
      const data = await startGitHubDeviceLogin(body);
      res.json(data);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Errore avvio login GitHub Device Flow.',
      });
    }
  });

  app.post('/api/copilot/github/device/poll', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        deviceCode?: string;
        enterpriseUrl?: string;
        clientId?: string;
      };
      const data = await pollGitHubDeviceLogin({
        deviceCode: body.deviceCode || '',
        enterpriseUrl: body.enterpriseUrl,
        clientId: body.clientId,
      });
      res.json(data);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Errore verifica autorizzazione GitHub.',
      });
    }
  });

  app.post('/api/copilot/github/auth-url', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        enterpriseUrl?: string;
        clientId?: string;
        origin?: string;
      };
      const result = await buildGitHubAuthUrl({
        enterpriseUrl: body.enterpriseUrl,
        clientId: body.clientId,
        clientOrigin: body.origin,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Impossibile generare URL login GitHub.',
      });
    }
  });

  const handleGitHubCallback = async (req: express.Request, res: express.Response) => {
    try {
      await completeGitHubOAuthCallback({
        code: typeof req.query.code === 'string' ? req.query.code : undefined,
        state: typeof req.query.state === 'string' ? req.query.state : undefined,
        error: typeof req.query.error === 'string' ? req.query.error : undefined,
        errorDescription:
          typeof req.query.error_description === 'string'
            ? req.query.error_description
            : undefined,
      });
      res.send(
        renderCopilotPopupHtml({
          type: 'COPILOT_AUTH_SUCCESS',
          mode: 'github',
          message: 'Account GitHub Copilot aziendale collegato. Questa finestra si chiuderà.',
        }),
      );
    } catch (err) {
      res.status(400).send(
        renderCopilotPopupHtml({
          type: 'COPILOT_AUTH_ERROR',
          mode: 'github',
          message: err instanceof Error ? err.message : 'Accesso GitHub non riuscito.',
        }),
      );
    }
  };
  app.get(['/api/copilot/github/callback', '/api/copilot/github/callback/'], handleGitHubCallback);

  app.post('/api/copilot/github/models/refresh', async (_req, res) => {
    try {
      const copilot = await refreshGitHubCopilotModels();
      res.json({ copilot });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Impossibile aggiornare i modelli Copilot.',
      });
    }
  });

  app.put('/api/copilot/chats', (req, res) => {
    const session = req.body as ChatSession;
    if (!session || !session.id) {
      res.status(400).json({ error: 'Sessione Copilot non valida.' });
      return;
    }
    const copilotState = loadCopilotState();
    const idx = copilotState.sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
      copilotState.sessions[idx] = session;
    } else {
      copilotState.sessions.unshift(session);
    }
    if (copilotState.sessions.length > 50) {
      copilotState.sessions = copilotState.sessions.slice(0, 50);
    }
    saveCopilotState(copilotState);
    res.json({ ok: true });
  });

  app.delete('/api/copilot/chats/:id', (req, res) => {
    const copilotState = loadCopilotState();
    copilotState.sessions = copilotState.sessions.filter((s) => s.id !== req.params.id);
    saveCopilotState(copilotState);
    res.json({ sessions: copilotState.sessions });
  });

  app.post('/api/copilot/chat', async (req, res) => {
    const body = (req.body ?? {}) as {
      mode?: 'm365' | 'github';
      sessionMode?: 'chat' | 'cowork';
      modelId?: string;
      systemPrompt?: string;
      messages?: Array<{
        role: 'user' | 'assistant' | 'system';
        content: string;
        attachments?: Array<{ mimeType: string; dataBase64: string; name?: string }>;
      }>;
    };

    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) {
      res.status(400).json({ error: 'Inserisci almeno un messaggio.' });
      return;
    }

    const sessionMode = body.sessionMode === 'cowork' ? 'cowork' : 'chat';
    if (sessionMode === 'cowork' && !isCoworkLicensed(body.mode)) {
      res.status(403).json({
        error: 'La modalità Cowork non è prevista nella licenza dell’utenza attualmente connessa.',
      });
      return;
    }

    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort(new Error('Client disconnected'));
      }
    });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (event: string, data: unknown) => {
      if (!res.writableEnded) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    try {
      const result = await streamCopilotChat({
        mode: body.mode,
        sessionMode,
        modelId: body.modelId,
        systemPrompt: body.systemPrompt,
        messages,
        signal: abortController.signal,
        onDelta: (delta) => sendEvent('delta', { delta }),
      });
      sendEvent('done', result);
      res.end();
    } catch (err) {
      if (abortController.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        res.end();
        return;
      }
      sendEvent('error', {
        message: err instanceof Error ? err.message : 'Errore imprevisto Copilot Pro.',
      });
      res.end();
    }
  });

  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(PROJECT_ROOT, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Free AI Hub server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Free AI Hub server:', err instanceof Error ? err.message : err);
  process.exit(1);
});
