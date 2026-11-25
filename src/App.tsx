import { Menu } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CatalogUpdateModal } from './components/CatalogUpdateModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { Sidebar, type NavSection } from './components/Sidebar';
import { SourceBackupModal } from './components/SourceBackupModal';
import { AgentsPage } from './pages/AgentsPage';
import { ChatPage } from './pages/ChatPage';
import { CopilotProPage } from './pages/CopilotProPage';
import { DashboardPage } from './pages/DashboardPage';
import { ModelsPage } from './pages/ModelsPage';
import { ProvidersPage } from './pages/ProvidersPage';
import { SettingsPage, type SettingsTab } from './pages/SettingsPage';
import { UsagePage } from './pages/UsagePage';
import {
  activateProviderKey,
  addCustomPcTool,
  addProviderKey,
  applyCatalogUpdates,
  checkCatalogUpdates,
  clearUsageLogs,
  createCustomProvider,
  deleteChatSession,
  deleteCustomPcTool,
  deleteCustomProvider,
  deleteProviderKey,
  deleteProviderKeyById,
  downloadSourceBackupArchive,
  exportConfigBundle,
  fetchBootstrap,
  fetchPcTools,
  fetchSourceBackupManifest,
  generateGatewayToken,
  importConfigBundle,
  refreshAllModels,
  refreshProviderModels,
  revealGatewayToken,
  revealProviderKeyForCopy,
  revokeGatewayToken,
  saveChatSession,
  saveProviderConfig,
  testProviderConnection,
  updateProviderKey,
  updateSettings,
} from './services/apiClient';
import {
  hasSavedConfigInSnapshot,
  loadPwaVaultSnapshot,
  restorePwaSnapshotToServer,
  syncServerToPwaVault,
} from './services/pwaVaultSync';
import { saveZipLocally } from './services/sourceBackupClient';
import type {
  AppSettings,
  CatalogMeta,
  CatalogUpdateCheckResult,
  ChatSession,
  GatewayStatus,
  ModelInfo,
  PcDiscoverySnapshot,
  PcToolCategory,
  PublicProviderConfig,
  SourceBackupManifest,
  SourceBackupSettings,
  UsageRecord,
} from './types/ai';
import {
  DEFAULT_AGENT_ID,
  getDefaultBuiltInAgents,
  sanitizeAgentsSettings,
} from './utils/agents';
import {
  getDefaultAutoApproveSettings,
  sanitizeAutoApproveSettings,
} from './utils/autoApprove';
import { getDefaultPcAccessClient } from './utils/pcActions';

export default function App() {
  const [section, setSection] = useState<NavSection>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: 'info' | 'error'; message: string } | null>(null);

  const [providers, setProviders] = useState<PublicProviderConfig[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [usageLogs, setUsageLogs] = useState<UsageRecord[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [gateway, setGateway] = useState<GatewayStatus>({ hasToken: false });
  const [catalogMeta, setCatalogMeta] = useState<CatalogMeta | null>(null);
  const [pendingCatalogUpdate, setPendingCatalogUpdate] =
    useState<CatalogUpdateCheckResult | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [applyingUpdates, setApplyingUpdates] = useState(false);
  const autoCheckTriggeredRef = useRef(false);
  const [sourceBackupPrompt, setSourceBackupPrompt] = useState<{
    trigger: 'manual' | 'auto';
  } | null>(null);
  const [sourceManifest, setSourceManifest] = useState<SourceBackupManifest | null>(null);
  const [loadingSourceManifest, setLoadingSourceManifest] = useState(false);
  const [savingSourceBackup, setSavingSourceBackup] = useState(false);
  const autoBackupPromptedRef = useRef(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('all');
  const [pendingChatAgentId, setPendingChatAgentId] = useState<string | null>(null);
  const [pcDiscovery, setPcDiscovery] = useState<PcDiscoverySnapshot | null>(null);
  const [scanningPcTools, setScanningPcTools] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({
    theme: 'dark',
    activeProviderId: 'openrouter',
    activeModelId: '',
    smartRouter: {
      enabled: false,
      taskCategory: 'general',
      preferFree: true,
      fallbackEnabled: true,
      providerPriority: [],
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
    pcAccess: getDefaultPcAccessClient(),
    autoApprove: getDefaultAutoApproveSettings(),
  });

  const showToast = useCallback((type: 'info' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 4500);
  }, []);

  const handleCheckCatalogUpdates = useCallback(
    async (trigger: 'manual' | 'auto' = 'manual') => {
      if (checkingUpdates) return;
      setCheckingUpdates(true);
      try {
        const res = await checkCatalogUpdates(trigger);
        setCatalogMeta(res.catalog);
        if (res.hasUpdates) {
          setPendingCatalogUpdate(res);
          showToast(
            'info',
            trigger === 'auto'
              ? 'Trovati aggiornamenti all’accesso: scegli se procedere.'
              : 'Trovati aggiornamenti per provider o modelli: scegli se procedere.',
          );
        } else {
          showToast(
            'info',
            trigger === 'auto'
              ? 'Controllo automatico: nessun aggiornamento trovato, provider e modelli sono già aggiornati.'
              : 'Nessun aggiornamento trovato: provider e modelli sono già aggiornati.',
          );
        }
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Errore durante la ricerca aggiornamenti del catalogo.';
        showToast('error', msg);
      } finally {
        setCheckingUpdates(false);
      }
    },
    [checkingUpdates, showToast],
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', settings.theme === 'dark' ? '#09090b' : '#fafafa');
    }
  }, [settings.theme]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        let data = await fetchBootstrap();
        if (!active) return;

        const serverHasSavedConfig =
          data.providers.some(
            (p) => p.hasApiKey || Boolean(p.anonymousMode) || p.kind === 'custom',
          ) || data.gateway.hasToken;

        if (!serverHasSavedConfig) {
          const localSnap = await loadPwaVaultSnapshot();
          if (active && hasSavedConfigInSnapshot(localSnap) && localSnap) {
            try {
              const restored = await restorePwaSnapshotToServer(localSnap);
              if (active && restored.restored) {
                data = {
                  ...data,
                  providers: restored.providers,
                  settings: restored.settings,
                  models: restored.models,
                  chatSessions: restored.chatSessions,
                  gateway: restored.gateway,
                };
                showToast(
                  'info',
                  'Chiavi API e configurazione ripristinate automaticamente dalla memoria PWA.',
                );
              }
            } catch {
              // Ignore restore error and continue with server bootstrap
            }
          }
        } else {
          void syncServerToPwaVault();
        }

        if (!active) return;
        setProviders(data.providers);
        setSettings(data.settings);
        setModels(data.models);
        setUsageLogs(data.usageLogs);
        setChatSessions(data.chatSessions);
        setGateway(data.gateway);
        if (data.catalog) {
          setCatalogMeta(data.catalog);
        }
        void fetchPcTools(false)
          .then((res) => {
            if (active) setPcDiscovery(res.snapshot);
          })
          .catch(() => {});
        const sb = data.settings.sourceBackup;
        if (sb?.autoEnabled && !autoBackupPromptedRef.current) {
          const intervalMs = Math.max(0, sb.intervalHours) * 3600_000;
          const lastTs = sb.lastBackupAt ? Date.parse(sb.lastBackupAt) : 0;
          const isDue = intervalMs === 0 || !lastTs || Date.now() - lastTs >= intervalMs;
          if (isDue) {
            autoBackupPromptedRef.current = true;
            setSourceBackupPrompt({ trigger: 'auto' });
            setLoadingSourceManifest(true);
            void fetchSourceBackupManifest()
              .then((m) => {
                if (active) setSourceManifest(m);
              })
              .catch(() => {})
              .finally(() => {
                if (active) setLoadingSourceManifest(false);
              });
          }
        }
        if (
          !autoCheckTriggeredRef.current &&
          data.settings.autoUpdateCatalogOnLogin !== false
        ) {
          autoCheckTriggeredRef.current = true;
          void checkCatalogUpdates('auto')
            .then((res) => {
              if (!active) return;
              setCatalogMeta(res.catalog);
              if (res.hasUpdates) {
                setPendingCatalogUpdate(res);
                showToast(
                  'info',
                  'Trovati aggiornamenti all’accesso: scegli se procedere.',
                );
              } else {
                showToast(
                  'info',
                  'Controllo automatico: nessun aggiornamento trovato, provider e modelli sono già aggiornati.',
                );
              }
            })
            .catch(() => {
              // Silent fallback on automatic startup check if offline
            });
        }
      } catch (err) {
        if (active) {
          showToast(
            'error',
            err instanceof Error ? err.message : 'Errore caricamento configurazione.',
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [showToast]);

  const openSourceBackupModal = useCallback((trigger: 'manual' | 'auto' = 'manual') => {
    setSourceBackupPrompt({ trigger });
    setLoadingSourceManifest(true);
    void fetchSourceBackupManifest()
      .then((manifest) => setSourceManifest(manifest))
      .catch(() => {})
      .finally(() => setLoadingSourceManifest(false));
  }, []);

  // Periodic check for automatic backup when portal stays open across intervals
  useEffect(() => {
    const sb = settings.sourceBackup;
    if (!sb?.autoEnabled || sb.intervalHours <= 0) return;
    const timer = setInterval(() => {
      if (sourceBackupPrompt || autoBackupPromptedRef.current) return;
      const lastTs = sb.lastBackupAt ? Date.parse(sb.lastBackupAt) : 0;
      const intervalMs = sb.intervalHours * 3600_000;
      if (!lastTs || Date.now() - lastTs >= intervalMs) {
        autoBackupPromptedRef.current = true;
        openSourceBackupModal('auto');
      }
    }, 15 * 60 * 1000);
    return () => clearInterval(timer);
  }, [settings.sourceBackup, sourceBackupPrompt, openSourceBackupModal]);

  const handleUpdateSettings = async (partial: Partial<AppSettings>) => {
    const sanitizedAgents =
      partial.agents !== undefined || partial.defaultAgentId !== undefined
        ? sanitizeAgentsSettings(
            partial.agents ?? settings.agents,
            partial.defaultAgentId ?? settings.defaultAgentId,
          )
        : null;
    const optimistic: AppSettings = {
      ...settings,
      ...partial,
      smartRouter: partial.smartRouter
        ? { ...settings.smartRouter, ...partial.smartRouter }
        : settings.smartRouter,
      ...(sanitizedAgents
        ? {
            agents: sanitizedAgents.agents,
            defaultAgentId: sanitizedAgents.defaultAgentId,
          }
        : {}),
      pcAccess: partial.pcAccess
        ? { ...getDefaultPcAccessClient(), ...settings.pcAccess, ...partial.pcAccess }
        : settings.pcAccess,
      autoApprove: partial.autoApprove
        ? sanitizeAutoApproveSettings(
            partial.autoApprove,
            settings.autoApprove ?? getDefaultAutoApproveSettings(),
          )
        : settings.autoApprove,
    };
    setSettings(optimistic);
    try {
      const res = await updateSettings(partial);
      setSettings(res.settings);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Errore salvataggio impostazioni.');
    }
  };

  const handleRefreshPcTools = async () => {
    setScanningPcTools(true);
    try {
      const res = await fetchPcTools(true);
      setPcDiscovery(res.snapshot);
      showToast(
        'info',
        `Scansione PC completata: ${res.snapshot.availableCount} strumenti disponibili.`,
      );
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Errore scansione strumenti PC.',
      );
    } finally {
      setScanningPcTools(false);
    }
  };

  const handleAddCustomPcTool = async (payload: {
    name: string;
    executable: string;
    category: PcToolCategory;
    isGui: boolean;
    description?: string;
  }) => {
    const res = await addCustomPcTool(payload);
    setSettings(res.settings);
    setPcDiscovery(res.snapshot);
    showToast('info', `Applicazione "${payload.name}" aggiunta alle risorse PC.`);
  };

  const handleDeleteCustomPcTool = async (id: string) => {
    const res = await deleteCustomPcTool(id);
    setSettings(res.settings);
    setPcDiscovery(res.snapshot);
    showToast('info', 'Applicazione personalizzata rimossa.');
  };

  const handleSaveProviderConfig = async (
    providerId: string,
    payload: Parameters<typeof saveProviderConfig>[1],
  ) => {
    const res = await saveProviderConfig(providerId, payload);
    setProviders((prev) => prev.map((p) => (p.id === providerId ? res.provider : p)));
    if (res.allModels) {
      setModels(res.allModels);
    }
    if (res.settings) {
      setSettings(res.settings);
    }
    if (res.syncError) {
      showToast(
        'error',
        `${res.provider.name} salvato, ma verifica modelli fallita: ${res.syncError.message}`,
      );
    } else if (res.provider.configured && res.provider.enabled && res.provider.modelCount > 0) {
      showToast(
        'info',
        `${res.provider.name} configurato (${res.provider.modelCount} modelli pronti).`,
      );
    } else {
      showToast('info', `Configurazione di ${res.provider.name} salvata.`);
    }
  };

  const handleCreateCustom = async (payload: Parameters<typeof createCustomProvider>[0]) => {
    const res = await createCustomProvider(payload);
    setProviders((prev) => [...prev, res.provider]);
    if (res.allModels) {
      setModels(res.allModels);
    }
    setSettings(res.settings);
    if (res.syncError) {
      showToast(
        'error',
        `Custom provider "${res.provider.name}" creato, ma caricamento modelli fallito: ${res.syncError.message}`,
      );
    } else {
      showToast('info', `Custom provider "${res.provider.name}" aggiunto.`);
    }
  };

  const handleDeleteCustom = async (providerId: string) => {
    const res = await deleteCustomProvider(providerId);
    setProviders(res.providers);
    setModels(res.models);
    setSettings(res.settings);
    showToast('info', 'Custom provider eliminato.');
  };

  const handleDeleteKey = async (providerId: string) => {
    const res = await deleteProviderKey(providerId);
    setProviders((prev) => prev.map((p) => (p.id === providerId ? res.provider : p)));
    setModels(res.models);
    showToast('info', `API key rimossa per ${res.provider.name}.`);
  };

  const handleAddProviderKey = async (
    providerId: string,
    payload: { apiKey: string; label?: string; activate?: boolean },
  ) => {
    const res = await addProviderKey(providerId, payload);
    setProviders((prev) => prev.map((p) => (p.id === providerId ? res.provider : p)));
    if (res.allModels) setModels(res.allModels);
    if (res.settings) setSettings(res.settings);
    if (res.syncError) {
      showToast('error', `Chiave aggiunta, ma verifica fallita: ${res.syncError.message}`);
    } else {
      showToast('info', `Nuova API key aggiunta per ${res.provider.name}.`);
    }
  };

  const handleActivateProviderKey = async (providerId: string, keyId: string) => {
    const res = await activateProviderKey(providerId, keyId);
    setProviders((prev) => prev.map((p) => (p.id === providerId ? res.provider : p)));
    if (res.allModels) setModels(res.allModels);
    if (res.settings) setSettings(res.settings);
    const activeLabel = res.provider.activeKeyLabel || 'Chiave selezionata';
    if (res.syncError) {
      showToast(
        'error',
        `Chiave "${activeLabel}" attivata per ${res.provider.name}, ma verifica fallita: ${res.syncError.message}`,
      );
    } else {
      showToast('info', `Chiave attiva per ${res.provider.name}: ${activeLabel}.`);
    }
  };

  const handleUpdateProviderKey = async (
    providerId: string,
    keyId: string,
    payload: { label?: string; apiKey?: string },
  ) => {
    const res = await updateProviderKey(providerId, keyId, payload);
    setProviders((prev) => prev.map((p) => (p.id === providerId ? res.provider : p)));
    if (res.allModels) setModels(res.allModels);
    if (res.settings) setSettings(res.settings);
    if (res.syncError) {
      showToast('error', `Chiave aggiornata, ma verifica fallita: ${res.syncError.message}`);
    } else {
      showToast('info', `Chiave di ${res.provider.name} aggiornata.`);
    }
  };

  const handleDeleteProviderKeyById = async (providerId: string, keyId: string) => {
    const res = await deleteProviderKeyById(providerId, keyId);
    setProviders((prev) => prev.map((p) => (p.id === providerId ? res.provider : p)));
    setModels(res.models);
    if (res.settings) setSettings(res.settings);
    showToast('info', `Chiave rimossa da ${res.provider.name}.`);
  };

  const handleCopyKey = async (providerId: string, keyId?: string) => {
    try {
      const { apiKey } = await revealProviderKeyForCopy(providerId, keyId);
      await navigator.clipboard.writeText(apiKey);
      showToast('info', 'API key copiata negli appunti.');
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Impossibile copiare la API key.',
      );
    }
  };

  const handleTestConnection = async (providerId: string) => {
    const res = await testProviderConnection(providerId);
    setProviders((prev) => prev.map((p) => (p.id === providerId ? res.provider : p)));
    return res.testResult;
  };

  const handleRefreshProviderModels = async (providerId: string): Promise<ModelInfo[]> => {
    try {
      const res = await refreshProviderModels(providerId);
      setProviders((prev) => prev.map((p) => (p.id === providerId ? res.provider : p)));
      setModels(res.allModels);
      if (res.settings) {
        setSettings(res.settings);
      }
      showToast(
        'info',
        `${res.models.length} modelli caricati da ${res.provider.name}.`,
      );
      return res.models;
    } catch (err) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : 'Errore caricamento modelli.';
      showToast('error', msg);
      return [];
    }
  };

  const handleRefreshAllModels = async () => {
    const res = await refreshAllModels();
    setProviders(res.providers);
    setModels(res.models);
    if (res.errors.length > 0) {
      showToast('error', `${res.errors.length} provider hanno restituito un errore.`);
    } else {
      showToast('info', `Lista modelli aggiornata (${res.models.length} modelli totali).`);
    }
  };

  const handleApplyCatalogUpdates = async (options: {
    selectedProviderIds: string[];
    applyModels: boolean;
    dismissUnselected: boolean;
  }) => {
    if (!pendingCatalogUpdate?.updateId) return;
    setApplyingUpdates(true);
    try {
      const res = await applyCatalogUpdates({
        updateId: pendingCatalogUpdate.updateId,
        selectedProviderIds: options.selectedProviderIds,
        applyModels: options.applyModels,
        dismissUnselected: options.dismissUnselected,
      });
      setProviders(res.providers);
      setModels(res.models);
      setSettings(res.settings);
      setCatalogMeta(res.catalog);
      setPendingCatalogUpdate(null);
      showToast('info', res.message);
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Errore applicazione aggiornamenti.',
      );
    } finally {
      setApplyingUpdates(false);
    }
  };

  const handleUseInChat = (providerId: string, modelId: string) => {
    void handleUpdateSettings({
      activeProviderId: providerId,
      activeModelId: modelId,
      smartRouter: { ...settings.smartRouter, enabled: false },
    });
    setSection('chat');
  };

  const handleUseAgentInChat = (agentId: string) => {
    setPendingChatAgentId(agentId);
    setSection('chat');
  };

  const handleUpdateSessionLocal = useCallback((session: ChatSession) => {
    setChatSessions((prev) => {
      const exists = prev.some((s) => s.id === session.id);
      if (exists) {
        return prev.map((s) => (s.id === session.id ? session : s));
      }
      return [session, ...prev];
    });
  }, []);

  const handleSaveSession = async (session: ChatSession) => {
    handleUpdateSessionLocal(session);
    await saveChatSession(session);
  };

  const handleDeleteSession = async (id: string) => {
    const res = await deleteChatSession(id);
    setChatSessions(res.chatSessions);
  };

  const handleClearUsage = async () => {
    const res = await clearUsageLogs();
    setUsageLogs(res.usageLogs);
    showToast('info', 'Statistiche di utilizzo azzerate.');
  };

  const handleImportBundle = async (options: Parameters<typeof importConfigBundle>[0]) => {
    const res = await importConfigBundle(options);
    setProviders(res.providers);
    setSettings(res.settings);
    showToast('info', 'Configurazione ripristinata.');
  };

  const handleGenerateGatewayToken = async () => {
    const res = await generateGatewayToken();
    setGateway(res.gateway);
    showToast('info', 'Token Gateway generato per VS Code (Kilo Code / Cline).');
  };

  const handleCopyGatewayToken = async () => {
    try {
      const { token } = await revealGatewayToken();
      await navigator.clipboard.writeText(token);
      showToast('info', 'Gateway Token copiato negli appunti.');
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Impossibile copiare il Gateway Token.',
      );
    }
  };

  const handleRevokeGatewayToken = async () => {
    const res = await revokeGatewayToken();
    setGateway(res.gateway);
    showToast('info', 'Token Gateway revocato.');
  };

  const handleConfirmSourceBackup = async (options: {
    localPath: string;
    fileName: string;
    saveAsDefaults: boolean;
  }) => {
    setSavingSourceBackup(true);
    try {
      const { blob, fileCount } = await downloadSourceBackupArchive(options.fileName);
      const saved = await saveZipLocally({
        blob,
        fileName: options.fileName,
      });

      const currentSb: SourceBackupSettings = settings.sourceBackup ?? {
        autoEnabled: false,
        intervalHours: 24,
        localPath: '',
        fileNamePrefix: 'free-ai-hub-source',
      };
      const derivedPrefix =
        options.fileName
          .replace(/\.zip$/i, '')
          .replace(/-\d{4}-\d{2}-\d{2}$/, '') || currentSb.fileNamePrefix;

      await handleUpdateSettings({
        sourceBackup: {
          ...currentSb,
          ...(options.saveAsDefaults
            ? {
                localPath: options.localPath,
                fileNamePrefix: derivedPrefix,
              }
            : {}),
          lastBackupAt: new Date().toISOString(),
          lastBackupFileName: saved.savedFileName,
        },
      });

      setSourceBackupPrompt(null);
      if (saved.method === 'directory_handle') {
        showToast(
          'info',
          `Backup salvato (${fileCount} file) nella cartella "${saved.folderName}" come ${saved.savedFileName}.`,
        );
      } else if (saved.method === 'save_picker') {
        showToast(
          'info',
          `Backup salvato (${fileCount} file) come ${saved.savedFileName}.`,
        );
      } else {
        showToast(
          'info',
          `Backup ZIP pronto (${fileCount} file): scaricato come ${saved.savedFileName}.`,
        );
      }
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Errore durante il salvataggio del backup.',
      );
    } finally {
      setSavingSourceBackup(false);
    }
  };

  const configuredCount = providers.filter((p) => p.configured && p.enabled).length;

  return (
    <div className="min-h-screen flex bg-zinc-50 dark:bg-zinc-950 text-zinc-950 dark:text-zinc-50">
      <Sidebar
        activeSection={section}
        onSelectSection={(next) => {
          if (next === 'settings') setSettingsTab('all');
          setSection(next);
        }}
        theme={settings.theme}
        onToggleTheme={() =>
          void handleUpdateSettings({
            theme: settings.theme === 'dark' ? 'light' : 'dark',
          })
        }
        configuredCount={configuredCount}
        totalProviders={providers.length}
        checkingUpdates={checkingUpdates}
        onCheckUpdates={() => void handleCheckCatalogUpdates('manual')}
        onOpenSourceBackup={() => openSourceBackupModal('manual')}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Header */}
        <header className="md:hidden flex h-14 items-center justify-between px-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 sticky top-0 z-30">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Apri menu"
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2 text-zinc-700 dark:text-zinc-300"
          >
            <Menu className="w-4 h-4" />
          </button>
          <span className="font-display text-sm font-bold tracking-tight">Free AI Hub</span>
          <div className="flex items-center gap-2">
            <PWAInstallButton compact />
            <span className="font-mono text-xs text-zinc-500 tabular-nums">
              {configuredCount}/{providers.length}
            </span>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1400px] w-full mx-auto">
          {loading ? (
            <div className="space-y-4 animate-pulse">
              <div className="h-8 w-48 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-24 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
                  />
                ))}
              </div>
            </div>
          ) : (
            <>
              {section === 'dashboard' && (
                <DashboardPage
                  providers={providers}
                  models={models}
                  settings={settings}
                  onNavigate={setSection}
                  onTestProvider={async (id) => {
                    await handleTestConnection(id);
                  }}
                  onRefreshAllModels={handleRefreshAllModels}
                />
              )}
              {section === 'chat' && (
                <ChatPage
                  providers={providers}
                  models={models}
                  settings={settings}
                  sessions={chatSessions}
                  pcDiscovery={pcDiscovery}
                  requestedAgentId={pendingChatAgentId}
                  onConsumeRequestedAgent={() => setPendingChatAgentId(null)}
                  onUpdateSettings={handleUpdateSettings}
                  onUpdateSessionLocal={handleUpdateSessionLocal}
                  onSaveSession={handleSaveSession}
                  onDeleteSession={handleDeleteSession}
                  onRefreshProviderModels={handleRefreshProviderModels}
                  onActivateProviderKey={handleActivateProviderKey}
                  onSyncAfterChat={(nextProviders, nextLogs) => {
                    if (nextProviders) setProviders(nextProviders);
                    if (nextLogs) setUsageLogs(nextLogs);
                  }}
                  onNavigate={setSection}
                  onOpenPcAccessSettings={() => {
                    setSettingsTab('pc');
                    setSection('settings');
                  }}
                  onOpenAutoApproveSettings={() => {
                    setSettingsTab('auto-approve');
                    setSection('settings');
                  }}
                />
              )}
              {section === 'agents' && (
                <AgentsPage
                  settings={settings}
                  onUpdateSettings={handleUpdateSettings}
                  onUseAgentInChat={handleUseAgentInChat}
                />
              )}
              {section === 'copilot' && (
                <CopilotProPage settings={settings} onToast={showToast} />
              )}
              {section === 'providers' && (
                <ProvidersPage
                  providers={providers}
                  autoUpdateOnLogin={settings.autoUpdateCatalogOnLogin !== false}
                  catalogMeta={catalogMeta}
                  checkingUpdates={checkingUpdates}
                  onToggleAutoUpdate={(enabled) =>
                    void handleUpdateSettings({ autoUpdateCatalogOnLogin: enabled })
                  }
                  onCheckUpdates={() => void handleCheckCatalogUpdates('manual')}
                  onSaveConfig={handleSaveProviderConfig}
                  onCreateCustom={handleCreateCustom}
                  onDeleteCustom={handleDeleteCustom}
                  onDeleteKey={handleDeleteKey}
                  onAddKey={handleAddProviderKey}
                  onActivateKey={handleActivateProviderKey}
                  onUpdateKey={handleUpdateProviderKey}
                  onDeleteKeyById={handleDeleteProviderKeyById}
                  onCopyKey={handleCopyKey}
                  onTestConnection={handleTestConnection}
                  onRefreshModels={async (id) => {
                    await handleRefreshProviderModels(id);
                  }}
                />
              )}
              {section === 'models' && (
                <ModelsPage
                  models={models}
                  providers={providers}
                  checkingUpdates={checkingUpdates}
                  onCheckUpdates={() => void handleCheckCatalogUpdates('manual')}
                  onRefreshAll={handleRefreshAllModels}
                  onUseInChat={handleUseInChat}
                />
              )}
              {section === 'usage' && (
                <UsagePage usageLogs={usageLogs} onClearUsage={handleClearUsage} />
              )}
              {section === 'settings' && (
                <SettingsPage
                  settings={settings}
                  providers={providers}
                  gateway={gateway}
                  catalogMeta={catalogMeta}
                  checkingUpdates={checkingUpdates}
                  pcDiscovery={pcDiscovery}
                  scanningPcTools={scanningPcTools}
                  initialTab={settingsTab}
                  onRefreshPcTools={handleRefreshPcTools}
                  onAddCustomPcTool={handleAddCustomPcTool}
                  onDeleteCustomPcTool={handleDeleteCustomPcTool}
                  onCheckUpdates={() => void handleCheckCatalogUpdates('manual')}
                  onOpenSourceBackup={() => openSourceBackupModal('manual')}
                  onUpdateSettings={handleUpdateSettings}
                  onExportBundle={exportConfigBundle}
                  onImportBundle={handleImportBundle}
                  onGenerateGatewayToken={handleGenerateGatewayToken}
                  onCopyGatewayToken={handleCopyGatewayToken}
                  onRevokeGatewayToken={handleRevokeGatewayToken}
                />
              )}
            </>
          )}
        </main>
      </div>

      <OfflineIndicator />

      {pendingCatalogUpdate && (
        <CatalogUpdateModal
          update={pendingCatalogUpdate}
          applying={applyingUpdates}
          onApply={handleApplyCatalogUpdates}
          onDismissForNow={() => {
            setPendingCatalogUpdate(null);
            showToast(
              'info',
              'Aggiornamenti ignorati per ora. Nessuna modifica scritta nel catalogo.',
            );
          }}
        />
      )}

      {!pendingCatalogUpdate && sourceBackupPrompt && (
        <SourceBackupModal
          trigger={sourceBackupPrompt.trigger}
          settings={
            settings.sourceBackup ?? {
              autoEnabled: false,
              intervalHours: 24,
              localPath: '',
              fileNamePrefix: 'free-ai-hub-source',
            }
          }
          manifest={sourceManifest}
          loadingManifest={loadingSourceManifest}
          saving={savingSourceBackup}
          onConfirm={handleConfirmSourceBackup}
          onCancel={() => {
            const wasAuto = sourceBackupPrompt.trigger === 'auto';
            setSourceBackupPrompt(null);
            if (wasAuto) {
              showToast('info', 'Backup automatico rimandato.');
            }
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-50 rounded-lg border px-4 py-2.5 text-xs font-medium shadow-lg ${
            toast.type === 'error'
              ? 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200'
              : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
