import type {
  AppSettings,
  BootstrapPayload,
  CatalogApplyResult,
  CatalogUpdateCheckResult,
  ChatAttachment,
  ChatSession,
  ConnectionTestResult,
  CopilotMode,
  CopilotPublicStatus,
  CopilotSessionMode,
  ExportBundle,
  FallbackAttempt,
  GatewayStatus,
  ModelInfo,
  NormalizedAIError,
  PcDiscoverySnapshot,
  PcExecuteResult,
  PcToolCategory,
  PublicProviderConfig,
  SourceBackupManifest,
  TaskCategory,
  TokenUsage,
  UsageRecord,
} from '../types/ai';
import { schedulePwaVaultSync } from './pwaVaultSync';

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const text = await res.text();
  let parsed: unknown = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(text || `Errore HTTP ${res.status}`);
    }
  }
  if (!res.ok) {
    const obj = parsed as { error?: string | NormalizedAIError; message?: string };
    if (obj?.error && typeof obj.error === 'object' && 'message' in obj.error) {
      throw obj.error;
    }
    throw new Error(
      (typeof obj?.error === 'string' && obj.error) ||
        obj?.message ||
        `Errore HTTP ${res.status}`,
    );
  }
  return parsed as T;
}

export async function fetchBootstrap(): Promise<BootstrapPayload> {
  const res = await fetch('/api/bootstrap', { cache: 'no-store' });
  return parseJsonOrThrow<BootstrapPayload>(res);
}

export async function updateSettings(partial: Partial<AppSettings>): Promise<{ settings: AppSettings }> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial),
  });
  const data = await parseJsonOrThrow<{ settings: AppSettings }>(res);
  schedulePwaVaultSync();
  return data;
}

export async function saveProviderConfig(
  providerId: string,
  payload: {
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
  },
): Promise<{
  provider: PublicProviderConfig;
  allModels?: ModelInfo[];
  settings?: AppSettings;
  syncError?: NormalizedAIError;
}> {
  const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonOrThrow<{
    provider: PublicProviderConfig;
    allModels?: ModelInfo[];
    settings?: AppSettings;
    syncError?: NormalizedAIError;
  }>(res);
  schedulePwaVaultSync();
  return data;
}

export async function createCustomProvider(payload: {
  name: string;
  baseUrl: string;
  apiKey?: string;
  keyLabel?: string;
  customHeaders?: Record<string, string>;
  chatEndpoint?: string;
  modelsEndpoint?: string;
  defaultModel?: string;
}): Promise<{
  provider: PublicProviderConfig;
  allModels?: ModelInfo[];
  settings: AppSettings;
  syncError?: NormalizedAIError;
}> {
  const res = await fetch('/api/providers/custom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonOrThrow<{
    provider: PublicProviderConfig;
    allModels?: ModelInfo[];
    settings: AppSettings;
    syncError?: NormalizedAIError;
  }>(res);
  schedulePwaVaultSync();
  return data;
}

export async function deleteCustomProvider(providerId: string): Promise<{
  providers: PublicProviderConfig[];
  models: ModelInfo[];
  settings: AppSettings;
}> {
  const res = await fetch(`/api/providers/custom/${encodeURIComponent(providerId)}`, {
    method: 'DELETE',
  });
  const data = await parseJsonOrThrow<{
    providers: PublicProviderConfig[];
    models: ModelInfo[];
    settings: AppSettings;
  }>(res);
  schedulePwaVaultSync();
  return data;
}

export async function addProviderKey(
  providerId: string,
  payload: { apiKey: string; label?: string; activate?: boolean },
): Promise<{
  provider: PublicProviderConfig;
  allModels?: ModelInfo[];
  settings?: AppSettings;
  syncError?: NormalizedAIError;
}> {
  const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonOrThrow<{
    provider: PublicProviderConfig;
    allModels?: ModelInfo[];
    settings?: AppSettings;
    syncError?: NormalizedAIError;
  }>(res);
  schedulePwaVaultSync();
  return data;
}

export async function activateProviderKey(
  providerId: string,
  keyId: string,
): Promise<{
  provider: PublicProviderConfig;
  allModels?: ModelInfo[];
  settings?: AppSettings;
  syncError?: NormalizedAIError;
}> {
  const res = await fetch(
    `/api/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(keyId)}/activate`,
    { method: 'POST' },
  );
  const data = await parseJsonOrThrow<{
    provider: PublicProviderConfig;
    allModels?: ModelInfo[];
    settings?: AppSettings;
    syncError?: NormalizedAIError;
  }>(res);
  schedulePwaVaultSync();
  return data;
}

export async function updateProviderKey(
  providerId: string,
  keyId: string,
  payload: { label?: string; apiKey?: string },
): Promise<{
  provider: PublicProviderConfig;
  allModels?: ModelInfo[];
  settings?: AppSettings;
  syncError?: NormalizedAIError;
}> {
  const res = await fetch(
    `/api/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(keyId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  const data = await parseJsonOrThrow<{
    provider: PublicProviderConfig;
    allModels?: ModelInfo[];
    settings?: AppSettings;
    syncError?: NormalizedAIError;
  }>(res);
  schedulePwaVaultSync();
  return data;
}

export async function deleteProviderKeyById(
  providerId: string,
  keyId: string,
): Promise<{
  provider: PublicProviderConfig;
  models: ModelInfo[];
  settings: AppSettings;
}> {
  const res = await fetch(
    `/api/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(keyId)}`,
    { method: 'DELETE' },
  );
  const data = await parseJsonOrThrow<{
    provider: PublicProviderConfig;
    models: ModelInfo[];
    settings: AppSettings;
  }>(res);
  schedulePwaVaultSync();
  return data;
}

export async function deleteProviderKey(providerId: string): Promise<{
  provider: PublicProviderConfig;
  models: ModelInfo[];
}> {
  const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/key`, {
    method: 'DELETE',
  });
  const data = await parseJsonOrThrow<{
    provider: PublicProviderConfig;
    models: ModelInfo[];
  }>(res);
  schedulePwaVaultSync();
  return data;
}

export async function revealProviderKeyForCopy(
  providerId: string,
  keyId?: string,
): Promise<{ apiKey: string }> {
  const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/reveal-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(keyId ? { keyId } : {}),
    cache: 'no-store',
  });
  return parseJsonOrThrow(res);
}

export async function testProviderConnection(providerId: string): Promise<{
  provider: PublicProviderConfig;
  testResult: ConnectionTestResult;
}> {
  const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/test`, {
    method: 'POST',
  });
  return parseJsonOrThrow(res);
}

export async function refreshProviderModels(providerId: string): Promise<{
  models: ModelInfo[];
  allModels: ModelInfo[];
  provider: PublicProviderConfig;
  settings?: AppSettings;
}> {
  const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/models/refresh`, {
    method: 'POST',
  });
  const data = await parseJsonOrThrow<{
    models: ModelInfo[];
    allModels: ModelInfo[];
    provider: PublicProviderConfig;
    settings?: AppSettings;
  }>(res);
  schedulePwaVaultSync();
  return data;
}

export async function refreshAllModels(): Promise<{
  providers: PublicProviderConfig[];
  models: ModelInfo[];
  errors: NormalizedAIError[];
}> {
  const res = await fetch('/api/models/refresh-all', { method: 'POST' });
  const data = await parseJsonOrThrow<{
    providers: PublicProviderConfig[];
    models: ModelInfo[];
    errors: NormalizedAIError[];
  }>(res);
  schedulePwaVaultSync();
  return data;
}

export async function checkCatalogUpdates(
  trigger: 'manual' | 'auto' = 'manual',
): Promise<CatalogUpdateCheckResult> {
  const res = await fetch('/api/catalog/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trigger }),
    cache: 'no-store',
  });
  return parseJsonOrThrow(res);
}

export async function applyCatalogUpdates(payload: {
  updateId: string;
  selectedProviderIds?: string[];
  applyModels?: boolean;
  dismissUnselected?: boolean;
}): Promise<CatalogApplyResult> {
  const res = await fetch('/api/catalog/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  const data = await parseJsonOrThrow<CatalogApplyResult>(res);
  schedulePwaVaultSync();
  return data;
}

export async function saveChatSession(session: ChatSession): Promise<void> {
  const res = await fetch('/api/chats', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  });
  await parseJsonOrThrow(res);
  schedulePwaVaultSync(500);
}

export async function deleteChatSession(id: string): Promise<{ chatSessions: ChatSession[] }> {
  const res = await fetch(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const data = await parseJsonOrThrow<{ chatSessions: ChatSession[] }>(res);
  schedulePwaVaultSync();
  return data;
}

export async function clearUsageLogs(): Promise<{ usageLogs: UsageRecord[] }> {
  const res = await fetch('/api/usage', { method: 'DELETE' });
  return parseJsonOrThrow(res);
}

export async function exportConfigBundle(options: {
  includeSecrets: boolean;
  password?: string;
}): Promise<ExportBundle> {
  const res = await fetch('/api/backup/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  return parseJsonOrThrow(res);
}

export async function importConfigBundle(options: {
  bundle: ExportBundle;
  password?: string;
}): Promise<{ providers: PublicProviderConfig[]; settings: AppSettings }> {
  const res = await fetch('/api/backup/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  const data = await parseJsonOrThrow<{ providers: PublicProviderConfig[]; settings: AppSettings }>(
    res,
  );
  schedulePwaVaultSync();
  return data;
}

export async function fetchSourceBackupManifest(): Promise<SourceBackupManifest> {
  const res = await fetch('/api/backup/source-manifest', { cache: 'no-store' });
  return parseJsonOrThrow(res);
}

export async function downloadSourceBackupArchive(fileName: string): Promise<{
  blob: Blob;
  fileCount: number;
}> {
  const res = await fetch(
    `/api/backup/source-archive?filename=${encodeURIComponent(fileName)}`,
    { cache: 'no-store' },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Errore HTTP ${res.status} durante la creazione dello ZIP.`);
  }
  const fileCount = Number(res.headers.get('X-Backup-File-Count') || '0');
  const blob = await res.blob();
  return { blob, fileCount };
}

export async function fetchPcTools(refresh = false): Promise<{ snapshot: PcDiscoverySnapshot }> {
  const query = refresh ? '?refresh=1' : '';
  const res = await fetch(`/api/pc/tools${query}`, { cache: 'no-store' });
  return parseJsonOrThrow(res);
}

export async function addCustomPcTool(payload: {
  name: string;
  executable: string;
  category?: PcToolCategory;
  isGui?: boolean;
  description?: string;
}): Promise<{ settings: AppSettings; snapshot: PcDiscoverySnapshot }> {
  const res = await fetch('/api/pc/custom-tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  return parseJsonOrThrow(res);
}

export async function deleteCustomPcTool(
  id: string,
): Promise<{ settings: AppSettings; snapshot: PcDiscoverySnapshot }> {
  const res = await fetch(`/api/pc/custom-tool/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    cache: 'no-store',
  });
  return parseJsonOrThrow(res);
}

export async function executePcTool(payload: {
  toolId?: string;
  toolQuery?: string;
  command?: string;
  args?: string[];
  script?: string;
  workingDirectory?: string;
  confirmedByUser: boolean;
  autoApproved?: boolean;
  interactiveConsole?: boolean;
  ephemeralSecret?: string;
}): Promise<PcExecuteResult> {
  const res = await fetch('/api/pc/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  return parseJsonOrThrow(res);
}

export async function generateGatewayToken(): Promise<{ gateway: GatewayStatus }> {
  const res = await fetch('/api/gateway/token/generate', {
    method: 'POST',
    cache: 'no-store',
  });
  const data = await parseJsonOrThrow<{ gateway: GatewayStatus }>(res);
  schedulePwaVaultSync();
  return data;
}

export async function revealGatewayToken(): Promise<{ token: string }> {
  const res = await fetch('/api/gateway/token/reveal', {
    method: 'POST',
    cache: 'no-store',
  });
  return parseJsonOrThrow(res);
}

export async function revokeGatewayToken(): Promise<{ gateway: GatewayStatus }> {
  const res = await fetch('/api/gateway/token', {
    method: 'DELETE',
  });
  const data = await parseJsonOrThrow<{ gateway: GatewayStatus }>(res);
  schedulePwaVaultSync();
  return data;
}

export interface StreamChatCallbacks {
  onMeta?: (meta: {
    providerId: string;
    providerName: string;
    modelId: string;
    modelName: string;
    fallbackUsed: boolean;
    fallbackChain: FallbackAttempt[];
  }) => void;
  onFallback?: (info: {
    attempt: FallbackAttempt;
    nextProviderId: string;
    nextProviderName: string;
    nextModelId: string;
  }) => void;
  onDelta?: (delta: string) => void;
  onDone?: (payload: {
    text: string;
    providerId: string;
    providerName: string;
    modelId: string;
    modelName: string;
    fallbackUsed: boolean;
    fallbackChain: FallbackAttempt[];
    latencyMs: number;
    usage?: TokenUsage;
    providers: PublicProviderConfig[];
    usageLogs: UsageRecord[];
  }) => void;
  onError?: (payload: {
    error: NormalizedAIError;
    providers?: PublicProviderConfig[];
    usageLogs?: UsageRecord[];
  }) => void;
}

export async function streamChat(
  params: {
    autoMode: boolean;
    providerId?: string;
    modelId?: string;
    taskCategory: TaskCategory;
    systemPrompt?: string;
    messages: Array<{
      role: 'user' | 'assistant' | 'system';
      content: string;
      attachments?: ChatAttachment[];
    }>;
  },
  callbacks: StreamChatCallbacks,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, stream: true }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    let normalized: NormalizedAIError = {
      code: 'UNKNOWN_ERROR',
      httpStatus: res.status,
      message: text || `Errore HTTP ${res.status}`,
      retryable: false,
      allowFallback: false,
      providerId: params.providerId || 'auto',
    };
    try {
      const parsed = JSON.parse(text) as { error?: NormalizedAIError | string };
      if (parsed.error && typeof parsed.error === 'object') {
        normalized = parsed.error;
      } else if (typeof parsed.error === 'string') {
        normalized.message = parsed.error;
      }
    } catch {
      // Keep raw text message
    }
    callbacks.onError?.({ error: normalized });
    return;
  }

  if (!res.body) {
    callbacks.onError?.({
      error: {
        code: 'UNKNOWN_ERROR',
        message: 'Flusso di risposta vuoto dal server.',
        retryable: false,
        allowFallback: false,
        providerId: params.providerId || 'auto',
      },
    });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let receivedTerminalEvent = false;

  const processBlock = (block: string) => {
    const lines = block.split('\n');
    let eventName = 'message';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (dataLines.length === 0) return;
    const dataStr = dataLines.join('\n');
    try {
      const data = JSON.parse(dataStr);
      if (eventName === 'meta') callbacks.onMeta?.(data);
      else if (eventName === 'fallback') callbacks.onFallback?.(data);
      else if (eventName === 'delta') callbacks.onDelta?.(data.delta ?? '');
      else if (eventName === 'done') {
        receivedTerminalEvent = true;
        callbacks.onDone?.(data);
      } else if (eventName === 'error') {
        receivedTerminalEvent = true;
        callbacks.onError?.(data);
      }
    } catch {
      // Ignore partial or malformed SSE block
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';

    for (const block of blocks) {
      processBlock(block);
    }
  }

  buffer += decoder.decode().replace(/\r\n/g, '\n');
  if (buffer.trim()) {
    for (const block of buffer.split('\n\n')) {
      processBlock(block);
    }
  }

  if (!receivedTerminalEvent && !signal.aborted) {
    callbacks.onError?.({
      error: {
        code: 'NETWORK_ERROR',
        message: 'La connessione allo stream si è chiusa prima di ricevere la risposta completa.',
        retryable: true,
        allowFallback: false,
        providerId: params.providerId || 'auto',
      },
    });
  }
}

export async function fetchCopilotStatus(origin?: string): Promise<{
  copilot: CopilotPublicStatus;
  redirectUris: { m365: string; github: string };
}> {
  const query = origin ? `?origin=${encodeURIComponent(origin)}` : '';
  const res = await fetch(`/api/copilot/status${query}`, { cache: 'no-store' });
  return parseJsonOrThrow(res);
}

export async function updateCopilotConfig(patch: {
  mode?: CopilotMode;
  tenantId?: string;
  m365ClientId?: string;
  enterpriseUrl?: string;
  githubClientId?: string;
  selectedModelId?: string;
}): Promise<{ copilot: CopilotPublicStatus }> {
  const res = await fetch('/api/copilot/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return parseJsonOrThrow(res);
}

export async function disconnectCopilotAccount(
  mode?: CopilotMode,
): Promise<{ copilot: CopilotPublicStatus }> {
  const res = await fetch('/api/copilot/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mode ? { mode } : {}),
  });
  return parseJsonOrThrow(res);
}

export async function loginM365WithCredentials(payload: {
  email: string;
  password: string;
  tenantId?: string;
  clientId?: string;
  origin?: string;
}): Promise<
  | { ok: true; copilot: CopilotPublicStatus }
  | {
      ok: false;
      requiresInteractiveOAuth: true;
      url: string;
      redirectUri: string;
      message: string;
    }
  | {
      ok: false;
      requiresDeviceCode: true;
      deviceCode: string;
      userCode: string;
      verificationUri: string;
      interval: number;
      message: string;
    }
> {
  const res = await fetch('/api/copilot/m365/login-credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  return parseJsonOrThrow(res);
}

export async function startM365CopilotDeviceLogin(payload: {
  tenantId?: string;
  clientId?: string;
  emailHint?: string;
}): Promise<{
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  message?: string;
}> {
  const res = await fetch('/api/copilot/m365/device/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  return parseJsonOrThrow(res);
}

export async function pollM365CopilotDeviceLogin(payload: {
  deviceCode: string;
  tenantId?: string;
  clientId?: string;
  emailHint?: string;
}): Promise<{
  status: 'pending' | 'slow_down' | 'complete';
  interval?: number;
  copilot?: CopilotPublicStatus;
}> {
  const res = await fetch('/api/copilot/m365/device/poll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  return parseJsonOrThrow(res);
}

export async function refreshCopilotLicense(
  mode?: CopilotMode,
): Promise<{ copilot: CopilotPublicStatus }> {
  const res = await fetch('/api/copilot/license/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mode ? { mode } : {}),
    cache: 'no-store',
  });
  return parseJsonOrThrow(res);
}

export async function requestM365CopilotAuthUrl(payload: {
  tenantId?: string;
  clientId?: string;
  origin?: string;
  loginHint?: string;
}): Promise<{ url: string; redirectUri: string }> {
  const res = await fetch('/api/copilot/m365/auth-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function startGitHubCopilotDeviceLogin(payload: {
  enterpriseUrl?: string;
  clientId?: string;
}): Promise<{
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}> {
  const res = await fetch('/api/copilot/github/device/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function pollGitHubCopilotDeviceLogin(payload: {
  deviceCode: string;
  enterpriseUrl?: string;
  clientId?: string;
}): Promise<{
  status: 'pending' | 'slow_down' | 'complete';
  interval?: number;
  copilot?: CopilotPublicStatus;
}> {
  const res = await fetch('/api/copilot/github/device/poll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function requestGitHubCopilotAuthUrl(payload: {
  enterpriseUrl?: string;
  clientId?: string;
  origin?: string;
}): Promise<{ url: string; redirectUri: string }> {
  const res = await fetch('/api/copilot/github/auth-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function refreshGitHubCopilotModels(): Promise<{
  copilot: CopilotPublicStatus;
}> {
  const res = await fetch('/api/copilot/github/models/refresh', {
    method: 'POST',
  });
  return parseJsonOrThrow(res);
}

export async function saveCopilotChatSession(session: ChatSession): Promise<void> {
  const res = await fetch('/api/copilot/chats', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  });
  await parseJsonOrThrow(res);
}

export async function deleteCopilotChatSession(
  id: string,
): Promise<{ sessions: ChatSession[] }> {
  const res = await fetch(`/api/copilot/chats/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return parseJsonOrThrow(res);
}

export async function streamCopilotChat(
  params: {
    mode: CopilotMode;
    sessionMode?: CopilotSessionMode;
    modelId?: string;
    systemPrompt?: string;
    messages: Array<{
      role: 'user' | 'assistant' | 'system';
      content: string;
      attachments?: ChatAttachment[];
    }>;
  },
  callbacks: {
    onDelta?: (delta: string) => void;
    onDone?: (payload: { text: string; modelId: string; latencyMs: number }) => void;
    onError?: (message: string) => void;
  },
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/copilot/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    let msg = text || `Errore HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      msg = parsed.error || parsed.message || msg;
    } catch {
      // keep raw
    }
    callbacks.onError?.(msg);
    return;
  }

  if (!res.body) {
    callbacks.onError?.('Flusso di risposta vuoto da Copilot Pro.');
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let receivedTerminal = false;

  const processBlock = (block: string) => {
    const lines = block.split('\n');
    let eventName = 'message';
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) return;
    try {
      const data = JSON.parse(dataLines.join('\n')) as {
        delta?: string;
        text?: string;
        modelId?: string;
        latencyMs?: number;
        message?: string;
      };
      if (eventName === 'delta') {
        callbacks.onDelta?.(data.delta ?? '');
      } else if (eventName === 'done') {
        receivedTerminal = true;
        callbacks.onDone?.({
          text: data.text ?? '',
          modelId: data.modelId ?? '',
          latencyMs: data.latencyMs ?? 0,
        });
      } else if (eventName === 'error') {
        receivedTerminal = true;
        callbacks.onError?.(data.message || 'Errore Copilot Pro.');
      }
    } catch {
      // ignore partial SSE
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) processBlock(block);
  }
  buffer += decoder.decode().replace(/\r\n/g, '\n');
  if (buffer.trim()) {
    for (const block of buffer.split('\n\n')) processBlock(block);
  }
  if (!receivedTerminal && !signal.aborted) {
    callbacks.onError?.('Stream Copilot Pro interrotto prima del completamento.');
  }
}

