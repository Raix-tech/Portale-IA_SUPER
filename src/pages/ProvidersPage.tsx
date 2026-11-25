import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Settings2,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { ProviderIcon } from '../components/ProviderIcon';
import { StatusBadge } from '../components/StatusBadge';
import type {
  CatalogMeta,
  ConnectionTestResult,
  PublicProviderConfig,
  PublicProviderKeyInfo,
} from '../types/ai';

interface ProvidersPageProps {
  providers: PublicProviderConfig[];
  autoUpdateOnLogin: boolean;
  catalogMeta: CatalogMeta | null;
  checkingUpdates: boolean;
  onToggleAutoUpdate: (enabled: boolean) => void;
  onCheckUpdates: () => void;
  onSaveConfig: (
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
  ) => Promise<void>;
  onCreateCustom: (payload: {
    name: string;
    baseUrl: string;
    apiKey?: string;
    keyLabel?: string;
    customHeaders?: Record<string, string>;
    chatEndpoint?: string;
    modelsEndpoint?: string;
    defaultModel?: string;
  }) => Promise<void>;
  onDeleteCustom: (providerId: string) => Promise<void>;
  onDeleteKey: (providerId: string) => Promise<void>;
  onAddKey: (
    providerId: string,
    payload: { apiKey: string; label?: string; activate?: boolean },
  ) => Promise<void>;
  onActivateKey: (providerId: string, keyId: string) => Promise<void>;
  onUpdateKey: (
    providerId: string,
    keyId: string,
    payload: { label?: string; apiKey?: string },
  ) => Promise<void>;
  onDeleteKeyById: (providerId: string, keyId: string) => Promise<void>;
  onCopyKey: (providerId: string, keyId?: string) => Promise<void>;
  onTestConnection: (providerId: string) => Promise<ConnectionTestResult>;
  onRefreshModels: (providerId: string) => Promise<void>;
}

interface HeaderPair {
  key: string;
  value: string;
}

export function ProvidersPage({
  providers,
  autoUpdateOnLogin,
  catalogMeta,
  checkingUpdates,
  onToggleAutoUpdate,
  onCheckUpdates,
  onSaveConfig,
  onCreateCustom,
  onDeleteCustom,
  onAddKey,
  onActivateKey,
  onUpdateKey,
  onDeleteKeyById,
  onCopyKey,
  onTestConnection,
  onRefreshModels,
}: ProvidersPageProps) {
  const [configuringProvider, setConfiguringProvider] = useState<PublicProviderConfig | null>(null);
  const [addKeyForProvider, setAddKeyForProvider] = useState<PublicProviderConfig | null>(null);
  const [editingKeyTarget, setEditingKeyTarget] = useState<{
    provider: PublicProviderConfig;
    key: PublicProviderKeyInfo;
  } | null>(null);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [confirmDeleteKeyTarget, setConfirmDeleteKeyTarget] = useState<{
    provider: PublicProviderConfig;
    key: PublicProviderKeyInfo;
  } | null>(null);
  const [confirmDeleteCustomFor, setConfirmDeleteCustomFor] =
    useState<PublicProviderConfig | null>(null);

  const [testingId, setTestingId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [activatingKeyId, setActivatingKeyId] = useState<string | null>(null);
  const [copiedKeyToken, setCopiedKeyToken] = useState<string | null>(null);
  const [testMessages, setTestMessages] = useState<Record<string, ConnectionTestResult>>({});

  // Add Key modal state
  const [newKeyValue, setNewKeyValue] = useState('');
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newKeyActivate, setNewKeyActivate] = useState(true);
  const [newKeySaving, setNewKeySaving] = useState(false);
  const [newKeyError, setNewKeyError] = useState<string | null>(null);

  // Edit Key modal state
  const [editKeyLabel, setEditKeyLabel] = useState('');
  const [editKeyValue, setEditKeyValue] = useState('');
  const [editKeySaving, setEditKeySaving] = useState(false);
  const [editKeyError, setEditKeyError] = useState<string | null>(null);

  // Configure modal form state
  const [cfgApiKey, setCfgApiKey] = useState('');
  const [cfgKeyLabel, setCfgKeyLabel] = useState('');
  const [cfgAccountId, setCfgAccountId] = useState('');
  const [cfgAnonymousMode, setCfgAnonymousMode] = useState(false);
  const [cfgBaseUrl, setCfgBaseUrl] = useState('');
  const [cfgChatEndpoint, setCfgChatEndpoint] = useState('');
  const [cfgModelsEndpoint, setCfgModelsEndpoint] = useState('');
  const [cfgDefaultModel, setCfgDefaultModel] = useState('');
  const [cfgHeaders, setCfgHeaders] = useState<HeaderPair[]>([]);
  const [cfgSaving, setCfgSaving] = useState(false);
  const [cfgError, setCfgError] = useState<string | null>(null);

  // Custom provider form state
  const [custName, setCustName] = useState('');
  const [custBaseUrl, setCustBaseUrl] = useState('');
  const [custApiKey, setCustApiKey] = useState('');
  const [custChatEndpoint, setCustChatEndpoint] = useState('/chat/completions');
  const [custModelsEndpoint, setCustModelsEndpoint] = useState('/models');
  const [custDefaultModel, setCustDefaultModel] = useState('');
  const [custHeaders, setCustHeaders] = useState<HeaderPair[]>([]);
  const [custSaving, setCustSaving] = useState(false);
  const [custError, setCustError] = useState<string | null>(null);

  const openConfigure = (provider: PublicProviderConfig) => {
    setConfiguringProvider(provider);
    setCfgApiKey('');
    setCfgKeyLabel('');
    setCfgAccountId(provider.accountId || '');
    setCfgAnonymousMode(Boolean(provider.anonymousMode));
    setCfgBaseUrl(provider.baseUrl || '');
    setCfgChatEndpoint(provider.chatEndpoint || '/chat/completions');
    setCfgModelsEndpoint(provider.modelsEndpoint || '/models');
    setCfgDefaultModel(provider.defaultModel || '');
    setCfgHeaders([]);
    setCfgError(null);
  };

  const openAddKey = (provider: PublicProviderConfig) => {
    setAddKeyForProvider(provider);
    setNewKeyValue('');
    setNewKeyLabel(`Chiave ${provider.apiKeys.length + 1}`);
    setNewKeyActivate(true);
    setNewKeyError(null);
  };

  const openEditKey = (provider: PublicProviderConfig, key: PublicProviderKeyInfo) => {
    setEditingKeyTarget({ provider, key });
    setEditKeyLabel(key.label);
    setEditKeyValue('');
    setEditKeyError(null);
  };

  const handleAddKeySubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!addKeyForProvider) return;
    if (!newKeyValue.trim()) {
      setNewKeyError('Inserisci una API key valida.');
      return;
    }
    setNewKeySaving(true);
    setNewKeyError(null);
    try {
      await onAddKey(addKeyForProvider.id, {
        apiKey: newKeyValue.trim(),
        label: newKeyLabel.trim() || undefined,
        activate: newKeyActivate,
      });
      setAddKeyForProvider(null);
    } catch (err) {
      setNewKeyError(err instanceof Error ? err.message : 'Errore salvataggio API key.');
    } finally {
      setNewKeySaving(false);
    }
  };

  const handleEditKeySubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingKeyTarget) return;
    setEditKeySaving(true);
    setEditKeyError(null);
    try {
      await onUpdateKey(editingKeyTarget.provider.id, editingKeyTarget.key.id, {
        label: editKeyLabel.trim() || undefined,
        apiKey: editKeyValue.trim() || undefined,
      });
      setEditingKeyTarget(null);
    } catch (err) {
      setEditKeyError(err instanceof Error ? err.message : 'Errore aggiornamento chiave.');
    } finally {
      setEditKeySaving(false);
    }
  };

  const handleSaveConfigure = async (e: FormEvent) => {
    e.preventDefault();
    if (!configuringProvider) return;
    setCfgSaving(true);
    setCfgError(null);

    try {
      const headersRecord: Record<string, string> = {};
      for (const pair of cfgHeaders) {
        if (pair.key.trim() && pair.value.trim()) {
          headersRecord[pair.key.trim()] = pair.value.trim();
        }
      }

      await onSaveConfig(configuringProvider.id, {
        ...(cfgApiKey.trim() ? { apiKey: cfgApiKey.trim() } : {}),
        ...(cfgApiKey.trim() && cfgKeyLabel.trim() ? { keyLabel: cfgKeyLabel.trim() } : {}),
        ...(configuringProvider.requiresAccountId ? { accountId: cfgAccountId.trim() } : {}),
        ...(configuringProvider.supportsAnonymous ? { anonymousMode: cfgAnonymousMode } : {}),
        baseUrl: cfgBaseUrl.trim(),
        ...(configuringProvider.kind === 'custom'
          ? {
              chatEndpoint: cfgChatEndpoint.trim() || '/chat/completions',
              modelsEndpoint: cfgModelsEndpoint.trim() || '/models',
              defaultModel: cfgDefaultModel.trim(),
            }
          : {}),
        ...(Object.keys(headersRecord).length > 0 ? { customHeaders: headersRecord } : {}),
      });
      setConfiguringProvider(null);
    } catch (err) {
      setCfgError(err instanceof Error ? err.message : 'Impossibile salvare la configurazione.');
    } finally {
      setCfgSaving(false);
    }
  };

  const handleCreateCustomSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setCustSaving(true);
    setCustError(null);
    try {
      const headersRecord: Record<string, string> = {};
      for (const pair of custHeaders) {
        if (pair.key.trim() && pair.value.trim()) {
          headersRecord[pair.key.trim()] = pair.value.trim();
        }
      }
      await onCreateCustom({
        name: custName.trim(),
        baseUrl: custBaseUrl.trim(),
        apiKey: custApiKey.trim() || undefined,
        customHeaders: Object.keys(headersRecord).length > 0 ? headersRecord : undefined,
        chatEndpoint: custChatEndpoint.trim() || '/chat/completions',
        modelsEndpoint: custModelsEndpoint.trim() || '/models',
        defaultModel: custDefaultModel.trim() || undefined,
      });
      setShowCustomModal(false);
      setCustName('');
      setCustBaseUrl('');
      setCustApiKey('');
      setCustChatEndpoint('/chat/completions');
      setCustModelsEndpoint('/models');
      setCustDefaultModel('');
      setCustHeaders([]);
    } catch (err) {
      setCustError(err instanceof Error ? err.message : 'Errore creazione custom provider.');
    } finally {
      setCustSaving(false);
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const result = await onTestConnection(id);
      setTestMessages((prev) => ({ ...prev, [id]: result }));
    } finally {
      setTestingId(null);
    }
  };

  const handleRefresh = async (id: string) => {
    setRefreshingId(id);
    try {
      await onRefreshModels(id);
    } finally {
      setRefreshingId(null);
    }
  };

  const handleCopy = async (providerId: string, keyId: string) => {
    await onCopyKey(providerId, keyId);
    const token = `${providerId}:${keyId}`;
    setCopiedKeyToken(token);
    setTimeout(() => setCopiedKeyToken((curr) => (curr === token ? null : curr)), 1800);
  };

  const handleActivate = async (providerId: string, keyId: string) => {
    setActivatingKeyId(keyId);
    try {
      await onActivateKey(providerId, keyId);
    } finally {
      setActivatingKeyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-950 dark:text-white">
            Providers
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Configura le API key dei servizi AI o aggiungi endpoint compatibili OpenAI personalizzati.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onCheckUpdates}
            disabled={checkingUpdates}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checkingUpdates ? 'animate-spin' : ''}`} />
            {checkingUpdates ? 'Ricerca aggiornamenti...' : 'Aggiorna catalogo'}
          </button>

          <button
            type="button"
            onClick={() => {
              setCustError(null);
              setShowCustomModal(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Aggiungi Custom Provider
          </button>
        </div>
      </div>

      {/* Catalog auto-update & JSON status bar */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <label className="flex items-center gap-2.5 cursor-pointer text-xs text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={autoUpdateOnLogin}
            onChange={(e) => onToggleAutoUpdate(e.target.checked)}
            className="h-4 w-4 accent-blue-600 shrink-0"
          />
          <span>
            <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
              Auto-aggiorna provider e modelli all&apos;accesso
            </strong>{' '}
            <span className="text-zinc-500 dark:text-zinc-400">
              (chiede sempre conferma prima di aggiornare <span className="font-mono">providers-catalog.json</span>)
            </span>
          </span>
        </label>

        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center gap-3 tabular-nums shrink-0">
          <span>
            Catalogo JSON: <strong className="text-zinc-700 dark:text-zinc-300">{catalogMeta?.catalogProvidersCount ?? providers.filter((p) => p.kind === 'builtin').length}</strong> provider
          </span>
          {catalogMeta?.lastCheckedAt && (
            <span>
              Ultimo controllo:{' '}
              <strong className="text-zinc-700 dark:text-zinc-300">
                {new Date(catalogMeta.lastCheckedAt).toLocaleString('it-IT')}
              </strong>
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {providers.map((p) => {
          const testRes = testMessages[p.id];
          return (
            <div
              key={p.id}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-800 dark:text-zinc-200 shrink-0">
                      <ProviderIcon providerId={p.id} className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-white truncate">
                          {p.name}
                        </h2>
                        {p.kind === 'custom' && (
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            · Custom
                          </span>
                        )}
                        {p.catalogSource === 'auto-sync' && (
                          <span className="text-xs text-blue-600 dark:text-blue-400">
                            · Sync
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 mt-0.5">
                        {p.description}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={p.status} />
                </div>

                {/* Metadata & Multi-Key List */}
                <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/70 space-y-2 text-xs">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-zinc-500 dark:text-zinc-400">
                        API Keys ({p.apiKeys.length})
                      </span>
                      <div className="flex items-center gap-1.5">
                        {/^https?:\/\//i.test(p.docsUrl) && (
                          <a
                            href={p.docsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Apri la pagina di ${p.name} per creare la chiave API`}
                            className="inline-flex items-center gap-1 rounded border border-blue-200 dark:border-blue-800/70 bg-blue-50/70 dark:bg-blue-950/30 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/60 transition-colors whitespace-nowrap"
                          >
                            Crea API Key
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => openAddKey(p)}
                          className="inline-flex items-center gap-1 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/70 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap"
                        >
                          <Plus className="w-3 h-3" />
                          Aggiungi chiave
                        </button>
                      </div>
                    </div>

                    {p.apiKeys.length > 0 ? (
                      <div className="space-y-1">
                        {p.apiKeys.map((k) => {
                          const copyToken = `${p.id}:${k.id}`;
                          const isCopied = copiedKeyToken === copyToken;
                          const isActivating = activatingKeyId === k.id;
                          return (
                            <div
                              key={k.id}
                              className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 ${
                                k.active
                                  ? 'border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/20'
                                  : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className={`h-2 w-2 rounded-full shrink-0 ${
                                    k.active ? 'bg-blue-600 dark:bg-blue-400' : 'bg-zinc-300 dark:bg-zinc-700'
                                  }`}
                                  aria-hidden="true"
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                      {k.label}
                                    </span>
                                    {k.active && (
                                      <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                                        Attiva
                                      </span>
                                    )}
                                  </div>
                                  <div className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                                    {k.maskedApiKey}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {!k.active && (
                                  <button
                                    type="button"
                                    disabled={isActivating}
                                    onClick={() => void handleActivate(p.id, k.id)}
                                    className="rounded border border-blue-200 dark:border-blue-800 bg-white dark:bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 disabled:opacity-50"
                                  >
                                    {isActivating ? 'Cambio...' : 'Usa questa'}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openEditKey(p, k)}
                                  title="Modifica etichetta o chiave"
                                  className="inline-flex items-center rounded border border-zinc-200 dark:border-zinc-800 p-1 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleCopy(p.id, k.id)}
                                  title="Copia API key negli appunti"
                                  className="inline-flex items-center gap-1 rounded border border-zinc-200 dark:border-zinc-800 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap"
                                >
                                  {isCopied ? (
                                    <Check className="w-3 h-3 text-emerald-500" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                  {isCopied ? 'Copiata' : 'Copia'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteKeyTarget({ provider: p, key: k })}
                                  title="Elimina API key"
                                  className="inline-flex items-center rounded border border-red-200 dark:border-red-900/50 p-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : p.supportsAnonymous && p.anonymousMode ? (
                      <div className="text-emerald-600 dark:text-emerald-400 font-medium">
                        Accesso anonimo gratuito attivo
                      </div>
                    ) : (
                      <div className="text-zinc-400 dark:text-zinc-500">Nessuna chiave configurata</div>
                    )}
                  </div>

                  {p.requiresAccountId && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-zinc-500 dark:text-zinc-400">Account ID</span>
                      <span className="font-mono text-zinc-700 dark:text-zinc-300 truncate">
                        {p.accountId || 'Mancante'}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500 dark:text-zinc-400">Endpoint API</span>
                    <span className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400 truncate max-w-[260px]">
                      {p.baseUrl || p.defaultBaseUrl}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500 dark:text-zinc-400">Modelli rilevati</span>
                    <span className="font-mono tabular-nums text-zinc-800 dark:text-zinc-200">
                      {p.modelCount}
                    </span>
                  </div>
                </div>

                {testRes && (
                  <div
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      testRes.ok
                        ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
                        : 'border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 text-red-800 dark:text-red-300'
                    }`}
                  >
                    {testRes.message}
                  </div>
                )}

                {!testRes && p.lastError && (
                  <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 px-3 py-2 text-xs text-red-800 dark:text-red-300">
                    {p.lastError.message}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-zinc-100 dark:border-zinc-800/70">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openConfigure(p)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/70 px-3 py-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap"
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                    Configure
                  </button>

                  <button
                    type="button"
                    onClick={() => handleTest(p.id)}
                    disabled={!p.configured || !p.enabled || testingId === p.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 transition-colors whitespace-nowrap"
                  >
                    <Wifi className="w-3.5 h-3.5" />
                    {testingId === p.id ? 'Test...' : 'Test Connection'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRefresh(p.id)}
                    disabled={!p.configured || !p.enabled || refreshingId === p.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 transition-colors whitespace-nowrap"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${refreshingId === p.id ? 'animate-spin' : ''}`}
                    />
                    Modelli
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSaveConfig(p.id, { enabled: !p.enabled })}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      p.enabled
                        ? 'border-emerald-200 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                        : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <Power className="w-3.5 h-3.5" />
                    {p.enabled ? 'Abilitato' : 'Disabilitato'}
                  </button>

                  {p.kind === 'custom' && (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteCustomFor(p)}
                      className="rounded-lg border border-red-200 dark:border-red-900/60 p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                      title="Elimina Custom Provider"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Configure Modal */}
      {configuringProvider && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <ProviderIcon providerId={configuringProvider.id} className="w-5 h-5" />
                <h3 className="font-display text-lg font-bold text-zinc-950 dark:text-white">
                  Configura {configuringProvider.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setConfiguringProvider(null)}
                className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveConfigure} className="mt-4 space-y-4">
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      {configuringProvider.hasApiKey
                        ? 'Aggiungi una nuova API Key (opzionale)'
                        : 'API Key'}
                    </label>
                    {configuringProvider.kind === 'builtin' && (
                      <a
                        href={configuringProvider.docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Ottieni chiave
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  <div className="mt-1.5 relative">
                    <KeyRound className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
                    <input
                      type="password"
                      value={cfgApiKey}
                      onChange={(e) => setCfgApiKey(e.target.value)}
                      placeholder={configuringProvider.keyPlaceholder}
                      autoComplete="off"
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 pl-9 pr-3 py-2 text-sm font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>

                {cfgApiKey.trim().length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      Etichetta chiave (opzionale)
                    </label>
                    <input
                      type="text"
                      value={cfgKeyLabel}
                      onChange={(e) => setCfgKeyLabel(e.target.value)}
                      placeholder={`es. Chiave ${configuringProvider.apiKeys.length + 1} / Account Personale`}
                      className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                )}

                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  La chiave viene cifrata sul server, attivata subito e aggiunta all&apos;elenco senza sovrascrivere le altre già salvate.
                </p>
              </div>

              {configuringProvider.supportsAnonymous && (
                <label className="flex items-start gap-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cfgAnonymousMode}
                    onChange={(e) => setCfgAnonymousMode(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-blue-600"
                  />
                  <div>
                    <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      Usa accesso gratuito anonimo {configuringProvider.name} (senza API key)
                    </div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                      Permette di interrogare i modelli gratuiti di {configuringProvider.name} senza
                      API key (soggetto a rate limit IP). Puoi comunque inserire una tua API key sopra.
                    </div>
                  </div>
                </label>
              )}

              {configuringProvider.requiresAccountId && (
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Cloudflare Account ID
                  </label>
                  <input
                    type="text"
                    value={cfgAccountId}
                    onChange={(e) => setCfgAccountId(e.target.value)}
                    placeholder="es. 023e105f4ecef8ad9ca31a8372d0c353"
                    className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Base URL personalizzato (opzionale)
                </label>
                <input
                  type="url"
                  value={cfgBaseUrl}
                  onChange={(e) => setCfgBaseUrl(e.target.value)}
                  placeholder={configuringProvider.defaultBaseUrl}
                  className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              {configuringProvider.kind === 'custom' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        Chat Endpoint
                      </label>
                      <input
                        type="text"
                        value={cfgChatEndpoint}
                        onChange={(e) => setCfgChatEndpoint(e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        Models Endpoint
                      </label>
                      <input
                        type="text"
                        value={cfgModelsEndpoint}
                        onChange={(e) => setCfgModelsEndpoint(e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      Modello predefinito
                    </label>
                    <input
                      type="text"
                      value={cfgDefaultModel}
                      onChange={(e) => setCfgDefaultModel(e.target.value)}
                      placeholder="es. gpt-4o-mini o llama-3.3-70b"
                      className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm font-mono"
                    />
                  </div>
                </>
              )}

              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Header personalizzati (opzionale)
                  </label>
                  <button
                    type="button"
                    onClick={() => setCfgHeaders((prev) => [...prev, { key: '', value: '' }])}
                    className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    + Aggiungi header
                  </button>
                </div>
                {configuringProvider.customHeaderKeys.length > 0 && cfgHeaders.length === 0 && (
                  <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">
                    Header attivi: {configuringProvider.customHeaderKeys.join(', ')}
                  </p>
                )}
                <div className="mt-2 space-y-2">
                  {cfgHeaders.map((pair, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={pair.key}
                        onChange={(e) =>
                          setCfgHeaders((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, key: e.target.value } : item)),
                          )
                        }
                        placeholder="X-Header-Name"
                        className="w-1/2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1.5 text-xs font-mono"
                      />
                      <input
                        type="text"
                        value={pair.value}
                        onChange={(e) =>
                          setCfgHeaders((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, value: e.target.value } : item)),
                          )
                        }
                        placeholder="Valore"
                        className="w-1/2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1.5 text-xs font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setCfgHeaders((prev) => prev.filter((_, i) => i !== idx))}
                        className="p-1.5 text-zinc-400 hover:text-red-500"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {cfgError && (
                <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                  {cfgError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setConfiguringProvider(null)}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-4 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={cfgSaving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {cfgSaving ? 'Salvataggio...' : 'Salva configurazione'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Custom Provider Modal */}
      {showCustomModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-200 dark:border-zinc-800">
              <h3 className="font-display text-lg font-bold text-zinc-950 dark:text-white">
                Nuovo Custom Provider (OpenAI-compatible)
              </h3>
              <button
                type="button"
                onClick={() => setShowCustomModal(false)}
                className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCustomSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Nome Provider *
                </label>
                <input
                  type="text"
                  required
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  placeholder="es. Together AI, Fireworks, DeepInfra"
                  className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Base URL *
                </label>
                <input
                  type="url"
                  required
                  value={custBaseUrl}
                  onChange={(e) => setCustBaseUrl(e.target.value)}
                  placeholder="https://api.together.xyz/v1"
                  className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  API Key
                </label>
                <input
                  type="password"
                  value={custApiKey}
                  onChange={(e) => setCustApiKey(e.target.value)}
                  placeholder="sk-..."
                  autoComplete="off"
                  className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Endpoint Chat
                  </label>
                  <input
                    type="text"
                    value={custChatEndpoint}
                    onChange={(e) => setCustChatEndpoint(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Endpoint Modelli
                  </label>
                  <input
                    type="text"
                    value={custModelsEndpoint}
                    onChange={(e) => setCustModelsEndpoint(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Modello predefinito (opzionale)
                </label>
                <input
                  type="text"
                  value={custDefaultModel}
                  onChange={(e) => setCustDefaultModel(e.target.value)}
                  placeholder="es. meta-llama/Llama-3.3-70B-Instruct-Turbo"
                  className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm font-mono"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Header personalizzati
                  </label>
                  <button
                    type="button"
                    onClick={() => setCustHeaders((prev) => [...prev, { key: '', value: '' }])}
                    className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    + Aggiungi header
                  </button>
                </div>
                <div className="mt-2 space-y-2">
                  {custHeaders.map((pair, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={pair.key}
                        onChange={(e) =>
                          setCustHeaders((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, key: e.target.value } : item)),
                          )
                        }
                        placeholder="X-Header-Name"
                        className="w-1/2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1.5 text-xs font-mono"
                      />
                      <input
                        type="text"
                        value={pair.value}
                        onChange={(e) =>
                          setCustHeaders((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, value: e.target.value } : item)),
                          )
                        }
                        placeholder="Valore"
                        className="w-1/2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1.5 text-xs font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setCustHeaders((prev) => prev.filter((_, i) => i !== idx))}
                        className="p-1.5 text-zinc-400 hover:text-red-500"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {custError && (
                <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                  {custError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowCustomModal(false)}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-4 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={custSaving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {custSaving ? 'Creazione...' : 'Crea Custom Provider'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Key Modal */}
      {addKeyForProvider && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <ProviderIcon providerId={addKeyForProvider.id} className="w-4 h-4" />
                <h3 className="font-display text-base font-bold text-zinc-950 dark:text-white">
                  Aggiungi API Key · {addKeyForProvider.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setAddKeyForProvider(null)}
                className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddKeySubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Nome / Etichetta
                </label>
                <input
                  type="text"
                  value={newKeyLabel}
                  onChange={(e) => setNewKeyLabel(e.target.value)}
                  placeholder="es. Account Secondario, Chiave Lavoro"
                  className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    API Key *
                  </label>
                  {/^https?:\/\//i.test(addKeyForProvider.docsUrl) && (
                    <a
                      href={addKeyForProvider.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Crea API Key
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <input
                  type="password"
                  required
                  value={newKeyValue}
                  onChange={(e) => setNewKeyValue(e.target.value)}
                  placeholder={addKeyForProvider.keyPlaceholder}
                  autoComplete="off"
                  className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm font-mono text-zinc-900 dark:text-zinc-100"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newKeyActivate}
                  onChange={(e) => setNewKeyActivate(e.target.checked)}
                  className="h-4 w-4 accent-blue-600"
                />
                Attiva subito questa chiave per {addKeyForProvider.name}
              </label>

              {newKeyError && (
                <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                  {newKeyError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setAddKeyForProvider(null)}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3.5 py-1.5 text-xs font-medium"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={newKeySaving}
                  className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {newKeySaving ? 'Salvataggio...' : 'Salva chiave'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Key Modal */}
      {editingKeyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
              <h3 className="font-display text-base font-bold text-zinc-950 dark:text-white">
                Modifica chiave · {editingKeyTarget.provider.name}
              </h3>
              <button
                type="button"
                onClick={() => setEditingKeyTarget(null)}
                className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditKeySubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Etichetta chiave
                </label>
                <input
                  type="text"
                  required
                  value={editKeyLabel}
                  onChange={(e) => setEditKeyLabel(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Nuova API Key (lascia vuoto per mantenere {editingKeyTarget.key.maskedApiKey})
                </label>
                <input
                  type="password"
                  value={editKeyValue}
                  onChange={(e) => setEditKeyValue(e.target.value)}
                  placeholder={editingKeyTarget.key.maskedApiKey}
                  autoComplete="off"
                  className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm font-mono text-zinc-900 dark:text-zinc-100"
                />
              </div>

              {editKeyError && (
                <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                  {editKeyError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setEditingKeyTarget(null)}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3.5 py-1.5 text-xs font-medium"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={editKeySaving}
                  className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {editKeySaving ? 'Aggiornamento...' : 'Salva modifiche'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Delete Key */}
      {confirmDeleteKeyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 shadow-xl">
            <h3 className="font-display text-base font-bold text-zinc-950 dark:text-white">
              Eliminare questa API key?
            </h3>
            <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
              Stai per rimuovere{' '}
              <strong className="text-zinc-900 dark:text-zinc-100">
                {confirmDeleteKeyTarget.key.label}
              </strong>{' '}
              (<span className="font-mono">{confirmDeleteKeyTarget.key.maskedApiKey}</span>) da{' '}
              <strong className="text-zinc-900 dark:text-zinc-100">
                {confirmDeleteKeyTarget.provider.name}
              </strong>
              . L&apos;operazione non è reversibile.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteKeyTarget(null)}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3.5 py-1.5 text-xs font-medium"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onDeleteKeyById(
                    confirmDeleteKeyTarget.provider.id,
                    confirmDeleteKeyTarget.key.id,
                  );
                  setConfirmDeleteKeyTarget(null);
                }}
                className="rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
              >
                Conferma eliminazione
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Delete Custom Provider */}
      {confirmDeleteCustomFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 shadow-xl">
            <h3 className="font-display text-base font-bold text-zinc-950 dark:text-white">
              Eliminare il Custom Provider?
            </h3>
            <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
              Verranno rimossi il provider{' '}
              <strong className="text-zinc-900 dark:text-zinc-100">
                {confirmDeleteCustomFor.name}
              </strong>
              , i relativi segreti e i modelli in cache.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteCustomFor(null)}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3.5 py-1.5 text-xs font-medium"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onDeleteCustom(confirmDeleteCustomFor.id);
                  setConfirmDeleteCustomFor(null);
                }}
                className="rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
              >
                Elimina provider
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
