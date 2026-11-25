import {
  AlertCircle,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  FileText,
  FolderCheck,
  FolderKey,
  FolderOpen,
  ImagePlus,
  KeyRound,
  Laptop,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Shuffle,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  PcActionCard,
  type PcActionDecision,
  type PcAuthorizeOptions,
} from '../components/PcActionCard';
import { ProviderIcon } from '../components/ProviderIcon';
import {
  WorkspaceActionCard,
  type WorkspaceActionDecision,
  type WorkspaceAuthorizeOptions,
} from '../components/WorkspaceActionCard';
import { executePcTool, streamChat } from '../services/apiClient';
import {
  authorizeWorkspaceFolder,
  buildWorkspaceSystemPrompt,
  checkWorkspaceFileExists,
  disconnectWorkspaceFolder,
  isRunningInIframe,
  readWorkspaceFile,
  reauthorizeSavedWorkspace,
  refreshWorkspaceIndex,
  restoreWorkspaceSnapshot,
  supportsDirectoryPicker,
  writeWorkspaceFile,
  type WorkspaceSnapshot,
} from '../services/localWorkspace';
import type {
  AIAgent,
  AppSettings,
  ChatAttachment,
  ChatMessage,
  ChatSession,
  FallbackAttempt,
  ModelInfo,
  NormalizedAIError,
  PcDiscoverySnapshot,
  PublicProviderConfig,
  TaskCategory,
  UsageRecord,
} from '../types/ai';
import {
  buildAgentSystemPrompt,
  resolveActiveAgent,
  sanitizeAgentsSettings,
} from '../utils/agents';
import {
  type ApprovalScope,
  AUTO_APPROVE_PROFILES,
  countEnabledAutoApprovePermissions,
  countTotalAutoApprovePermissions,
  enablePermissionsInAutoApprove,
  evaluatePcAutoApprove,
  evaluateWorkspaceReadAutoApprove,
  evaluateWorkspaceWriteAutoApprove,
  getDefaultAutoApproveSettings,
  isAutoApproveAllowedWithSession,
} from '../utils/autoApprove';
import { MarkdownContent } from '../utils/markdown';
import {
  buildPcToolsSystemPrompt,
  getDefaultPcAccessClient,
  isPcToolAuthorizedClient,
  parseAllChatActions,
  type PcExecRequest,
} from '../utils/pcActions';
import {
  type WorkspaceConnectRequest,
  type WorkspaceReadRequest,
  type WorkspaceWriteRequest,
} from '../utils/workspaceActions';
import type { NavSection } from '../components/Sidebar';

interface ChatPageProps {
  providers: PublicProviderConfig[];
  models: ModelInfo[];
  settings: AppSettings;
  sessions: ChatSession[];
  pcDiscovery: PcDiscoverySnapshot | null;
  requestedAgentId?: string | null;
  onConsumeRequestedAgent?: () => void;
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<void>;
  onUpdateSessionLocal: (session: ChatSession) => void;
  onSaveSession: (session: ChatSession) => Promise<void>;
  onDeleteSession: (sessionId: string) => Promise<void>;
  onRefreshProviderModels: (providerId: string) => Promise<ModelInfo[]>;
  onActivateProviderKey: (providerId: string, keyId: string) => Promise<void>;
  onSyncAfterChat: (providers?: PublicProviderConfig[], usageLogs?: UsageRecord[]) => void;
  onNavigate: (section: NavSection) => void;
  onOpenPcAccessSettings: () => void;
  onOpenAutoApproveSettings?: () => void;
}

const TASK_CATEGORIES: Array<{ id: TaskCategory; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'coding', label: 'Coding' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'fast', label: 'Fast' },
  { id: 'vision', label: 'Vision' },
];

function pricingTierSortScore(tier: ModelInfo['pricingTier']): number {
  if (tier === 'free') return 0;
  if (tier === 'free_tier') return 1;
  if (tier === 'unknown') return 2;
  return 3;
}

function isFreeTierModel(tier?: ModelInfo['pricingTier']): boolean {
  return tier === 'free' || tier === 'free_tier';
}

export function ChatPage({
  providers,
  models,
  settings,
  sessions,
  pcDiscovery,
  requestedAgentId,
  onConsumeRequestedAgent,
  onUpdateSettings,
  onUpdateSessionLocal,
  onSaveSession,
  onDeleteSession,
  onRefreshProviderModels,
  onActivateProviderKey,
  onSyncAfterChat,
  onNavigate,
  onOpenPcAccessSettings,
  onOpenAutoApproveSettings,
}: ChatPageProps) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    sessions[0]?.id ?? null,
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [quickSwitchOpen, setQuickSwitchOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [refreshingProviderId, setRefreshingProviderId] = useState<string | null>(null);
  const [switchingKey, setSwitchingKey] = useState(false);

  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
  const [liveFallbackChain, setLiveFallbackChain] = useState<FallbackAttempt[]>([]);

  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>({
    status: 'disconnected',
    files: [],
    truncated: false,
  });
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [pcFileMenuOpen, setPcFileMenuOpen] = useState(false);
  const [pcFileSearch, setPcFileSearch] = useState('');
  const [actionDecisions, setActionDecisions] = useState<Record<string, WorkspaceActionDecision>>(
    {},
  );
  const [pcDecisions, setPcDecisions] = useState<Record<string, PcActionDecision>>({});
  const [sessionAllowedPermissions, setSessionAllowedPermissions] = useState<Set<string>>(
    () => new Set(),
  );

  const abortRef = useRef<AbortController | null>(null);
  const latestStreamingSessionRef = useRef<ChatSession | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoProcessedMessageIdsRef = useRef<Set<string>>(new Set());
  const autoFollowUpDepthRef = useRef(0);
  const pendingAutoEvalRef = useRef<{
    sessionId: string;
    messageId: string;
    content: string;
  } | null>(null);
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  const configuredProviders = useMemo(
    () => providers.filter((p) => p.configured && p.enabled),
    [providers],
  );

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  const { agents, defaultAgentId } = useMemo(
    () => sanitizeAgentsSettings(settings.agents, settings.defaultAgentId),
    [settings.agents, settings.defaultAgentId],
  );
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    () => activeSession?.activeAgentId || defaultAgentId,
  );
  const activeAgent = useMemo(
    () => resolveActiveAgent(agents, selectedAgentId, defaultAgentId),
    [agents, selectedAgentId, defaultAgentId],
  );
  const effectiveTaskCategory =
    activeSession?.activeTaskCategory ??
    activeAgent.preferredTaskCategory ??
    settings.smartRouter.taskCategory;

  const activeProvider = providers.find((p) => p.id === settings.activeProviderId);
  const modelsForActiveProvider = useMemo(
    () =>
      models
        .filter((m) => m.providerId === settings.activeProviderId)
        .sort(
          (a, b) =>
            pricingTierSortScore(a.pricingTier) - pricingTierSortScore(b.pricingTier) ||
            a.id.localeCompare(b.id),
        ),
    [models, settings.activeProviderId],
  );

  const filteredComposerModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return modelsForActiveProvider;
    return modelsForActiveProvider.filter(
      (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
    );
  }, [modelsForActiveProvider, modelSearch]);

  const effectiveModelId = useMemo(() => {
    if (
      settings.activeModelId &&
      modelsForActiveProvider.some((m) => m.id === settings.activeModelId)
    ) {
      return settings.activeModelId;
    }
    if (modelsForActiveProvider.length > 0) {
      return (
        modelsForActiveProvider.find(
          (m) => m.pricingTier === 'free' || m.pricingTier === 'free_tier',
        )?.id || modelsForActiveProvider[0].id
      );
    }
    return activeProvider?.defaultModel || settings.activeModelId || '';
  }, [settings.activeModelId, modelsForActiveProvider, activeProvider]);

  const activeModelObj = modelsForActiveProvider.find((m) => m.id === effectiveModelId);

  const filteredWorkspaceFiles = useMemo(() => {
    const q = pcFileSearch.trim().toLowerCase();
    if (!q) return workspace.files;
    return workspace.files.filter((f) => f.path.toLowerCase().includes(q));
  }, [workspace.files, pcFileSearch]);

  const pcAccess = settings.pcAccess ?? getDefaultPcAccessClient();
  const autoApprove = settings.autoApprove ?? getDefaultAutoApproveSettings();
  const autoApproveProfileLabel =
    AUTO_APPROVE_PROFILES.find((p) => p.id === (autoApprove.profile ?? 'custom'))?.name ??
    'Personalizzato';
  const authorizedPcToolsCount = useMemo(
    () => (pcDiscovery?.tools ?? []).filter((t) => isPcToolAuthorizedClient(t, pcAccess)).length,
    [pcDiscovery?.tools, pcAccess],
  );
  const enabledAutoApproveCount = useMemo(
    () => countEnabledAutoApprovePermissions(autoApprove),
    [autoApprove],
  );
  const totalAutoApproveCount = useMemo(() => countTotalAutoApprovePermissions(), []);

  useEffect(() => {
    void restoreWorkspaceSnapshot().then(setWorkspace);
  }, []);

  useEffect(() => {
    if (!activeSessionId && sessions.length > 0) {
      setActiveSessionId(sessions[0].id);
    }
  }, [sessions, activeSessionId]);

  useEffect(() => {
    if (requestedAgentId) {
      setSelectedAgentId(requestedAgentId);
      const targetAgent = agents.find((a) => a.id === requestedAgentId);
      if (activeSession) {
        void onSaveSession({
          ...activeSession,
          activeAgentId: requestedAgentId,
          activeTaskCategory:
            targetAgent?.preferredTaskCategory ?? activeSession.activeTaskCategory,
          updatedAt: new Date().toISOString(),
        });
      }
      onConsumeRequestedAgent?.();
    }
  }, [
    requestedAgentId,
    agents,
    activeSession,
    onSaveSession,
    onConsumeRequestedAgent,
  ]);

  useEffect(() => {
    if (requestedAgentId) return;
    if (activeSession) {
      setSelectedAgentId(activeSession.activeAgentId || defaultAgentId);
    } else {
      setSelectedAgentId(defaultAgentId);
    }
  }, [activeSession?.id, activeSession?.activeAgentId, defaultAgentId, requestedAgentId]);

  useEffect(() => {
    if (!modelMenuOpen && !quickSwitchOpen && !pcFileMenuOpen && !agentMenuOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setModelMenuOpen(false);
        setQuickSwitchOpen(false);
        setPcFileMenuOpen(false);
        setAgentMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modelMenuOpen, quickSwitchOpen, pcFileMenuOpen, agentMenuOpen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages.length, isStreaming]);

  const handleSelectAgent = (agent: AIAgent) => {
    setSelectedAgentId(agent.id);
    setAgentMenuOpen(false);
    if (activeSession) {
      void onSaveSession({
        ...activeSession,
        activeAgentId: agent.id,
        activeTaskCategory: agent.preferredTaskCategory ?? activeSession.activeTaskCategory,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const handleNewChat = () => {
    autoFollowUpDepthRef.current = 0;
    pendingAutoEvalRef.current = null;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const newSession: ChatSession = {
      id,
      title: 'Nuova conversazione',
      createdAt: now,
      updatedAt: now,
      messages: [],
      activeAgentId: activeAgent.id,
      activeTaskCategory: activeAgent.preferredTaskCategory ?? settings.smartRouter.taskCategory,
    };
    void onSaveSession(newSession);
    setActiveSessionId(id);
  };

  const handleQuickSelectProviderModel = async (providerId: string, modelId: string) => {
    await onUpdateSettings({
      activeProviderId: providerId,
      activeModelId: modelId,
      smartRouter: {
        ...settings.smartRouter,
        enabled: false,
      },
    });
    setQuickSwitchOpen(false);
  };

  const handleQuickSelectAuto = async (taskCategory?: TaskCategory) => {
    const nextCategory = taskCategory ?? effectiveTaskCategory;
    if (activeSession && taskCategory) {
      await onSaveSession({
        ...activeSession,
        activeTaskCategory: taskCategory,
        updatedAt: new Date().toISOString(),
      });
    }
    await onUpdateSettings({
      smartRouter: {
        ...settings.smartRouter,
        enabled: true,
        taskCategory: nextCategory,
      },
    });
    setQuickSwitchOpen(false);
  };

  const handleSwitchKey = async (providerId: string, keyId: string) => {
    setSwitchingKey(true);
    try {
      await onActivateProviderKey(providerId, keyId);
    } finally {
      setSwitchingKey(false);
    }
  };

  const handleRefreshModelsForProvider = async (providerId: string) => {
    setRefreshingProviderId(providerId);
    try {
      const loaded = await onRefreshProviderModels(providerId);
      if (loaded.length > 0 && settings.activeProviderId === providerId) {
        const currentValid = loaded.some((m) => m.id === settings.activeModelId);
        if (!currentValid) {
          const picked =
            loaded.find((m) => m.pricingTier === 'free' || m.pricingTier === 'free_tier')?.id ||
            loaded[0].id;
          await onUpdateSettings({ activeModelId: picked });
        }
      }
    } finally {
      setRefreshingProviderId(null);
    }
  };

  const handleProviderChange = async (providerId: string) => {
    setModelMenuOpen(false);
    setModelSearch('');
    let providerModels = models.filter((m) => m.providerId === providerId);
    const providerMeta = providers.find((p) => p.id === providerId);
    let nextModel =
      providerModels.find((m) => m.pricingTier === 'free' || m.pricingTier === 'free_tier')?.id ||
      providerModels[0]?.id ||
      providerMeta?.defaultModel ||
      '';
    await onUpdateSettings({
      activeProviderId: providerId,
      activeModelId: nextModel,
      smartRouter: { ...settings.smartRouter, enabled: false },
    });

    if (providerModels.length === 0 && providerMeta?.configured && providerMeta?.enabled) {
      setRefreshingProviderId(providerId);
      try {
        providerModels = await onRefreshProviderModels(providerId);
        if (providerModels.length > 0) {
          nextModel =
            providerModels.find((m) => m.pricingTier === 'free' || m.pricingTier === 'free_tier')
              ?.id || providerModels[0].id;
          await onUpdateSettings({ activeProviderId: providerId, activeModelId: nextModel });
        }
      } finally {
        setRefreshingProviderId(null);
      }
    }
  };

  const handleAttachImage = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const base64 = result.split(',')[1];
        if (base64) {
          setAttachments((prev) => [
            ...prev.slice(0, 2),
            { mimeType: file.type, dataBase64: base64, name: file.name },
          ]);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleStop = () => {
    pendingAutoEvalRef.current = null;
    autoFollowUpDepthRef.current = 0;
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setStreamingStatus(null);
    if (latestStreamingSessionRef.current) {
      void onSaveSession(latestStreamingSessionRef.current);
      latestStreamingSessionRef.current = null;
    }
  };

  const handleAuthorizeFolder = async () => {
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    try {
      if (!supportsDirectoryPicker()) {
        throw new Error(
          isRunningInIframe()
            ? "Accesso alle cartelle non disponibile nell'anteprima iframe. Apri l'app come PWA installata o in una scheda autonoma su Chrome/Edge."
            : 'Questo browser non supporta la selezione cartelle locali (usa Chrome o Edge su PC).',
        );
      }
      const next = await authorizeWorkspaceFolder();
      setWorkspace(next);
    } catch (err) {
      setWorkspaceError(
        err instanceof Error ? err.message : 'Impossibile autorizzare la cartella locale.',
      );
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const handleReauthorizeFolder = async () => {
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    try {
      const next = await reauthorizeSavedWorkspace();
      setWorkspace(next);
    } catch (err) {
      setWorkspaceError(
        err instanceof Error ? err.message : 'Impossibile riattivare i permessi della cartella.',
      );
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const handleDisconnectFolder = async () => {
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    setPcFileMenuOpen(false);
    try {
      const next = await disconnectWorkspaceFolder();
      setWorkspace(next);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const handleRefreshWorkspace = async () => {
    setWorkspaceBusy(true);
    try {
      const next = await refreshWorkspaceIndex();
      setWorkspace(next);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const handleInsertPcFile = async (relativePath: string) => {
    setWorkspaceError(null);
    try {
      const file = await readWorkspaceFile(relativePath);
      const snippet = `File autorizzato \`${file.path}\`:\n\`\`\`\n${file.content}\n\`\`\``;
      setPrompt((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${snippet}\n` : `${snippet}\n`));
      setPcFileMenuOpen(false);
    } catch (err) {
      setWorkspaceError(
        err instanceof Error ? err.message : `Impossibile leggere il file "${relativePath}".`,
      );
    }
  };

  const sendChatPrompt = async (
    rawPrompt: string,
    explicitAttachments: ChatAttachment[],
    clearComposer: boolean,
    overrideWorkspace?: WorkspaceSnapshot,
  ) => {
    const trimmed = rawPrompt.trim();
    if ((!trimmed && explicitAttachments.length === 0) || isStreaming) return;

    const now = new Date().toISOString();
    let currentSession: ChatSession = activeSession
      ? {
          ...activeSession,
          activeAgentId: activeAgent.id,
          activeTaskCategory: effectiveTaskCategory,
          messages: [...activeSession.messages],
        }
      : {
          id: crypto.randomUUID(),
          title: trimmed.slice(0, 48) || 'Nuova conversazione',
          createdAt: now,
          updatedAt: now,
          messages: [],
          activeAgentId: activeAgent.id,
          activeTaskCategory: effectiveTaskCategory,
        };

    if (currentSession.messages.length === 0 && trimmed) {
      currentSession.title = trimmed.slice(0, 48);
    }

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: now,
      attachments: explicitAttachments.length > 0 ? [...explicitAttachments] : undefined,
    };

    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: now,
      agentId: activeAgent.id,
      agentName: activeAgent.name,
    };

    currentSession.messages = [...currentSession.messages, userMsg, assistantMsg];
    currentSession.updatedAt = now;
    setActiveSessionId(currentSession.id);
    await onSaveSession(currentSession);

    if (clearComposer) {
      setPrompt('');
      setAttachments([]);
    }
    setIsStreaming(true);
    setLiveFallbackChain([]);
    setStreamingStatus(
      settings.smartRouter.enabled
        ? `Smart Router (${effectiveTaskCategory}) in selezione...`
        : `Connessione a ${activeProvider?.name || settings.activeProviderId}...`,
    );

    const controller = new AbortController();
    abortRef.current = controller;

    const historyForApi = currentSession.messages
      .filter((m) => m.id !== assistantId && !m.error)
      .map((m) => ({
        role: m.role,
        content: m.content,
        attachments: m.attachments,
      }));

    let accumulatedContent = '';
    let latestSession = currentSession;
    latestStreamingSessionRef.current = latestSession;

    const patchAssistant = (patch: Partial<ChatMessage>, persist = false) => {
      latestSession = {
        ...latestSession,
        updatedAt: new Date().toISOString(),
        messages: latestSession.messages.map((m) =>
          m.id === assistantId ? { ...m, ...patch } : m,
        ),
      };
      latestStreamingSessionRef.current = latestSession;
      if (persist) {
        void onSaveSession(latestSession);
      } else {
        onUpdateSessionLocal(latestSession);
      }
    };

    const composedSystemPrompt = buildAgentSystemPrompt(activeAgent, settings.systemPrompt);
    const agentReadOnly = Boolean(activeAgent.readOnlyMode);

    try {
      await streamChat(
        {
          autoMode: settings.smartRouter.enabled,
          providerId: settings.activeProviderId,
          modelId: effectiveModelId,
          taskCategory: effectiveTaskCategory,
          systemPrompt: [
            buildWorkspaceSystemPrompt(
              composedSystemPrompt,
              overrideWorkspace ?? workspace,
            ),
            buildPcToolsSystemPrompt(
              settings.pcAccess,
              pcDiscovery,
              autoApprove,
              agentReadOnly,
            ),
          ].join('\n\n'),
          messages: historyForApi,
        },
        {
          onMeta: (meta) => {
            setStreamingStatus(`Streaming da ${meta.providerName} · ${meta.modelId}`);
            patchAssistant({
              providerId: meta.providerId,
              providerName: meta.providerName,
              modelId: meta.modelId,
              modelName: meta.modelName,
              fallbackUsed: meta.fallbackUsed,
              fallbackChain: meta.fallbackChain,
            });
          },
          onFallback: (info) => {
            setLiveFallbackChain((prev) => [...prev, info.attempt]);
            setStreamingStatus(
              `Fallback da ${info.attempt.providerName} (${info.attempt.errorCode}) → ${info.nextProviderName}`,
            );
          },
          onDelta: (delta) => {
            accumulatedContent += delta;
            patchAssistant({ content: accumulatedContent });
          },
          onDone: (payload) => {
            const finalText = payload.text || accumulatedContent;
            patchAssistant(
              {
                content: finalText,
                providerId: payload.providerId,
                providerName: payload.providerName,
                modelId: payload.modelId,
                modelName: payload.modelName,
                fallbackUsed: payload.fallbackUsed,
                fallbackChain: payload.fallbackChain,
                latencyMs: payload.latencyMs,
                usage: payload.usage,
              },
              true,
            );
            onSyncAfterChat(payload.providers, payload.usageLogs);
            if (!controller.signal.aborted && finalText.trim()) {
              pendingAutoEvalRef.current = {
                sessionId: currentSession.id,
                messageId: assistantId,
                content: finalText,
              };
            }
          },
          onError: (payload) => {
            pendingAutoEvalRef.current = null;
            const err: NormalizedAIError = payload.error;
            patchAssistant(
              {
                content: accumulatedContent,
                providerId: err.providerId,
                error: err,
              },
              true,
            );
            if (payload.providers || payload.usageLogs) {
              onSyncAfterChat(payload.providers, payload.usageLogs);
            }
          },
        },
        controller.signal,
      );
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        pendingAutoEvalRef.current = null;
        patchAssistant(
          {
            content: accumulatedContent,
            error: {
              code: 'NETWORK_ERROR',
              message:
                err instanceof Error
                  ? err.message
                  : 'Connessione interrotta durante la generazione.',
              retryable: true,
              allowFallback: false,
              providerId: settings.activeProviderId,
            },
          },
          true,
        );
      }
    } finally {
      abortRef.current = null;
      latestStreamingSessionRef.current = null;
      setIsStreaming(false);
      setStreamingStatus(null);
    }
  };

  const sendChatPromptRef = useRef(sendChatPrompt);
  sendChatPromptRef.current = sendChatPrompt;

  useEffect(() => {
    if (isStreaming || !pendingAutoEvalRef.current) return;
    const pending = pendingAutoEvalRef.current;
    pendingAutoEvalRef.current = null;

    if (autoProcessedMessageIdsRef.current.has(pending.messageId)) return;
    if (pending.sessionId !== activeSessionIdRef.current) return;
    autoProcessedMessageIdsRef.current.add(pending.messageId);

    const segments = parseAllChatActions(pending.messageId, pending.content).filter(
      (s) => s.type === 'read' || s.type === 'write' || s.type === 'pc-exec',
    );
    if (segments.length === 0) return;

    void (async () => {
      const followUpSections: string[] = [];
      const agentReadOnly = Boolean(activeAgent.readOnlyMode);

      for (const segment of segments) {
        if (activeSessionIdRef.current !== pending.sessionId) return;

        if (segment.type === 'write') {
          if (workspace.status !== 'connected' || agentReadOnly) continue;
          const existing = await checkWorkspaceFileExists(segment.path);
          const evalRes = evaluateWorkspaceWriteAutoApprove(
            segment.path,
            typeof existing === 'string',
            autoApprove,
          );
          const effective = isAutoApproveAllowedWithSession(
            evalRes,
            sessionAllowedPermissions,
            { agentReadOnly, actionType: 'write' },
          );
          if (!effective.allowed) continue;

          try {
            const res = await writeWorkspaceFile(segment.path, segment.content);
            setWorkspace(res.snapshot);
            setActionDecisions((prev) => ({
              ...prev,
              [segment.id]: {
                status: 'approved',
                autoApproved: !effective.viaSession,
                approvalScope: effective.viaSession ? 'session' : 'auto',
                message: effective.viaSession
                  ? `Consentito per questa sessione e salvato su PC (${res.path}, ${res.bytesWritten} byte).`
                  : `Auto-approvato e salvato su PC (${res.path}, ${res.bytesWritten} byte).`,
              },
            }));
          } catch (err) {
            setActionDecisions((prev) => ({
              ...prev,
              [segment.id]: {
                status: 'error',
                message:
                  err instanceof Error ? err.message : 'Errore durante la scrittura su disco.',
              },
            }));
          }
        } else if (segment.type === 'read') {
          if (workspace.status !== 'connected') continue;
          const evalRes = evaluateWorkspaceReadAutoApprove(segment.paths, autoApprove);
          const effective = isAutoApproveAllowedWithSession(evalRes, sessionAllowedPermissions);
          if (!effective.allowed) continue;

          const readSections: string[] = [];
          const failedMessages: string[] = [];
          const readPaths: string[] = [];

          for (const reqPath of segment.paths) {
            try {
              const res = await readWorkspaceFile(reqPath);
              readPaths.push(res.path);
              const fence = res.content.includes('```') ? '````' : '```';
              readSections.push(
                `File: \`${res.path}\` (${res.size} byte)\n${fence}\n${res.content}\n${fence}`,
              );
            } catch (err) {
              failedMessages.push(
                `${reqPath}: ${err instanceof Error ? err.message : 'errore di lettura'}`,
              );
            }
          }

          if (readSections.length === 0) {
            setActionDecisions((prev) => ({
              ...prev,
              [segment.id]: {
                status: 'error',
                message:
                  failedMessages.join(' · ') || 'Impossibile leggere i file richiesti.',
              },
            }));
            continue;
          }

          setActionDecisions((prev) => ({
            ...prev,
            [segment.id]: {
              status: 'approved',
              autoApproved: !effective.viaSession,
              approvalScope: effective.viaSession ? 'session' : 'auto',
              message:
                failedMessages.length > 0
                  ? `${effective.viaSession ? 'Sessione' : 'Auto-approvato'}: letti ${readPaths.length} file (${failedMessages.length} non leggibili).`
                  : `${effective.viaSession ? 'Consentita per questa sessione' : 'Auto-approvata'} lettura di ${readPaths.join(', ')} e inviata all'AI.`,
            },
          }));

          const errorNote =
            failedMessages.length > 0
              ? `\n\nFile non leggibili:\n${failedMessages.map((m) => `- ${m}`).join('\n')}`
              : '';
          followUpSections.push(
            `Ho eseguito automaticamente (${effective.viaSession ? 'Consenti per questa sessione' : 'Auto-Approve'}) la lettura dei seguenti file dal mio PC (${workspace.folderName || 'cartella locale'}):\n\n${readSections.join('\n\n')}${errorNote}`,
          );
        } else if (segment.type === 'pc-exec') {
          if (agentReadOnly) continue;
          const ref = (segment.toolId || segment.toolQuery || '').trim().toLowerCase();
          const matchedTool =
            ref && pcDiscovery
              ? pcDiscovery.tools.find(
                  (t) =>
                    t.id.toLowerCase() === ref ||
                    t.name.toLowerCase() === ref ||
                    t.executable.toLowerCase() === ref ||
                    t.executable.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase() === ref,
                ) ?? null
              : null;

          const isModeDisabled = pcAccess.mode === 'none';
          const isDynamicFullAllowed =
            !matchedTool &&
            (pcAccess.mode === 'full' ||
              (pcAccess.mode === 'custom' && pcAccess.allowAllInstalled));
          const isToolAllowed =
            !isModeDisabled &&
            (matchedTool
              ? isPcToolAuthorizedClient(matchedTool, pcAccess)
              : isDynamicFullAllowed);
          if (!isToolAllowed) continue;

          const evalRes = evaluatePcAutoApprove(
            {
              toolId: segment.toolId,
              toolQuery: segment.toolQuery,
              command: segment.command,
              script: segment.script,
              workingDirectory: segment.workingDirectory,
            },
            matchedTool,
            autoApprove,
          );
          const effective = isAutoApproveAllowedWithSession(
            evalRes,
            sessionAllowedPermissions,
            { agentReadOnly, actionType: 'pc-exec' },
          );
          if (!effective.allowed) continue;

          try {
            const result = await executePcTool({
              toolId: segment.toolId,
              toolQuery: segment.toolQuery,
              command: segment.command,
              script: segment.script,
              workingDirectory: segment.workingDirectory,
              confirmedByUser: effective.viaSession,
              autoApproved: !effective.viaSession,
            });

            setPcDecisions((prev) => ({
              ...prev,
              [segment.id]: {
                status: result.ok ? 'approved' : 'error',
                autoApproved: !effective.viaSession,
                approvalScope: effective.viaSession ? 'session' : 'auto',
                message: result.launchedGui
                  ? `${result.toolName} avviato ${effective.viaSession ? '(sessione)' : 'automaticamente'} sul PC.`
                  : result.ok
                    ? `${effective.viaSession ? 'Eseguito (sessione)' : 'Eseguito automaticamente'} (exit code ${result.exitCode ?? 0}, ${result.durationMs} ms).`
                    : result.error || `Terminato con exit code ${result.exitCode ?? '?'}.`,
                result,
              },
            }));

            const execParts = [
              `Ho eseguito (${effective.viaSession ? 'Consentito per questa sessione' : 'Auto-Approve'}) sul PC: \`${result.commandDisplay}\` (strumento: ${result.toolName})`,
              `Esito: ${result.ok ? 'Completato' : 'Errore'} (exit code: ${result.exitCode ?? 'n/d'}, durata: ${result.durationMs} ms)`,
            ];
            if (result.stdout) {
              execParts.push(`STDOUT:\n\`\`\`\n${result.stdout}\n\`\`\``);
            }
            if (result.stderr) {
              execParts.push(`STDERR:\n\`\`\`\n${result.stderr}\n\`\`\``);
            }
            followUpSections.push(execParts.join('\n\n'));
          } catch (err) {
            setPcDecisions((prev) => ({
              ...prev,
              [segment.id]: {
                status: 'error',
                message:
                  err instanceof Error ? err.message : 'Esecuzione automatica negata o fallita.',
              },
            }));
          }
        }
      }

      if (
        followUpSections.length > 0 &&
        autoFollowUpDepthRef.current < 8 &&
        activeSessionIdRef.current === pending.sessionId
      ) {
        autoFollowUpDepthRef.current += 1;
        await sendChatPromptRef.current(
          `${followUpSections.join('\n\n')}\n\nAnalizza gli esiti reali e procedi con la risposta.`,
          [],
          false,
        );
      }
    })();
  }, [
    isStreaming,
    workspace,
    autoApprove,
    pcAccess,
    pcDiscovery,
    sessionAllowedPermissions,
    activeAgent.readOnlyMode,
  ]);

  const grantConsentScope = async (scope?: ApprovalScope, requiredPermissions?: string[]) => {
    if (!requiredPermissions || requiredPermissions.length === 0) return;
    if (scope === 'session') {
      setSessionAllowedPermissions((prev) => {
        const next = new Set(prev);
        for (const perm of requiredPermissions) {
          next.add(perm);
        }
        return next;
      });
    } else if (scope === 'always') {
      const updated = enablePermissionsInAutoApprove(autoApprove, requiredPermissions);
      await onUpdateSettings({ autoApprove: updated });
    }
  };

  const handleSend = async () => {
    autoFollowUpDepthRef.current = 0;
    await sendChatPrompt(prompt, attachments, true);
  };

  const handleAuthorizeRead = async (
    action: WorkspaceReadRequest,
    options?: WorkspaceAuthorizeOptions,
  ) => {
    const scope = options?.scope ?? 'once';
    await grantConsentScope(scope, options?.requiredPermissions);

    const readSections: string[] = [];
    const failedMessages: string[] = [];
    const readPaths: string[] = [];

    for (const reqPath of action.paths) {
      try {
        const res = await readWorkspaceFile(reqPath);
        readPaths.push(res.path);
        const fence = res.content.includes('```') ? '````' : '```';
        readSections.push(`File: \`${res.path}\` (${res.size} byte)\n${fence}\n${res.content}\n${fence}`);
      } catch (err) {
        failedMessages.push(
          `${reqPath}: ${err instanceof Error ? err.message : 'errore di lettura'}`,
        );
      }
    }

    if (readSections.length === 0) {
      setActionDecisions((prev) => ({
        ...prev,
        [action.id]: {
          status: 'error',
          message: failedMessages.join(' · ') || 'Impossibile leggere i file richiesti.',
        },
      }));
      return;
    }

    const summaryNote =
      failedMessages.length > 0
        ? `Letti ${readPaths.length} file (${failedMessages.length} non trovati/non leggibili).`
        : `Autorizzata lettura di ${readPaths.join(', ')} e inviato il contenuto all'AI.`;

    setActionDecisions((prev) => ({
      ...prev,
      [action.id]: {
        status: 'approved',
        approvalScope: scope,
        message: summaryNote,
      },
    }));

    const errorNote =
      failedMessages.length > 0
        ? `\n\nFile non leggibili:\n${failedMessages.map((m) => `- ${m}`).join('\n')}`
        : '';

    const followUpPrompt = `Ho autorizzato la lettura dei seguenti file dal mio PC (${workspace.folderName || 'cartella locale'}):\n\n${readSections.join('\n\n')}${errorNote}\n\nProcedi con la risposta o proponi le eventuali modifiche con \`aihub-write\`.`;
    await sendChatPrompt(followUpPrompt, [], false);
  };

  const handleAuthorizeWrite = async (
    action: WorkspaceWriteRequest,
    options?: WorkspaceAuthorizeOptions,
  ) => {
    const scope = options?.scope ?? 'once';
    try {
      await grantConsentScope(scope, options?.requiredPermissions);
      const res = await writeWorkspaceFile(action.path, action.content);
      setWorkspace(res.snapshot);
      setActionDecisions((prev) => ({
        ...prev,
        [action.id]: {
          status: 'approved',
          approvalScope: scope,
          message: `Salvato su PC (${res.path}, ${res.bytesWritten} byte).`,
        },
      }));
    } catch (err) {
      setActionDecisions((prev) => ({
        ...prev,
        [action.id]: {
          status: 'error',
          message: err instanceof Error ? err.message : 'Errore durante la scrittura su disco.',
        },
      }));
    }
  };

  const handleAuthorizeConnect = async (action: WorkspaceConnectRequest) => {
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    try {
      if (!supportsDirectoryPicker()) {
        throw new Error(
          isRunningInIframe()
            ? "Accesso alle cartelle bloccato nell'anteprima iframe. Apri l'app in una nuova scheda o come PWA installata su Chrome/Edge."
            : 'Questo browser non supporta la selezione cartelle locali (usa Chrome o Edge su PC).',
        );
      }
      const next =
        workspace.status === 'needs_permission'
          ? await reauthorizeSavedWorkspace()
          : await authorizeWorkspaceFolder();
      setWorkspace(next);
      setActionDecisions((prev) => ({
        ...prev,
        [action.id]: {
          status: 'approved',
          message: `Cartella "${next.folderName}" collegata (${next.files.length} file indicizzati).`,
        },
      }));
      await sendChatPrompt(
        `Ho autorizzato la cartella "${next.folderName}" sul mio PC. Procedi pure con la mia richiesta precedente (usando aihub-read / aihub-write se necessario).`,
        [],
        false,
        next,
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Impossibile autorizzare la cartella locale.';
      setWorkspaceError(msg);
      setActionDecisions((prev) => ({
        ...prev,
        [action.id]: {
          status: 'error',
          message: msg,
        },
      }));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const handleRejectAction = (actionId: string) => {
    setActionDecisions((prev) => ({
      ...prev,
      [actionId]: {
        status: 'rejected',
      },
    }));
  };

  const handleAuthorizePcExec = async (action: PcExecRequest, options?: PcAuthorizeOptions) => {
    const scope = options?.scope ?? 'once';
    try {
      await grantConsentScope(scope, options?.requiredPermissions);
      const result = await executePcTool({
        toolId: action.toolId,
        toolQuery: action.toolQuery,
        command: action.command,
        script: action.script,
        workingDirectory: options?.workingDirectoryOverride ?? action.workingDirectory,
        confirmedByUser: true,
        interactiveConsole: options?.interactiveConsole,
        ephemeralSecret: options?.ephemeralSecret,
      });

      setPcDecisions((prev) => ({
        ...prev,
        [action.id]: {
          status: result.ok ? 'approved' : 'error',
          approvalScope: scope,
          message: result.launchedGui
            ? `${result.toolName} avviato sul PC.`
            : result.ok
              ? `Comando completato (exit code ${result.exitCode ?? 0}, ${result.durationMs} ms).`
              : result.error || `Terminato con exit code ${result.exitCode ?? '?'}.`,
          result,
        },
      }));

      const sections = [
        `Ho autorizzato ed eseguito sul mio PC: \`${result.commandDisplay}\` (strumento: ${result.toolName})`,
        `Esito: ${result.ok ? 'Completato' : 'Errore'} (exit code: ${result.exitCode ?? 'n/d'}, durata: ${result.durationMs} ms)`,
      ];
      if (result.stdout) {
        sections.push(`STDOUT:\n\`\`\`\n${result.stdout}\n\`\`\``);
      }
      if (result.stderr) {
        sections.push(`STDERR:\n\`\`\`\n${result.stderr}\n\`\`\``);
      }
      sections.push("Analizza l'esito reale e procedi con la risposta.");
      await sendChatPrompt(sections.join('\n\n'), [], false);
    } catch (err) {
      setPcDecisions((prev) => ({
        ...prev,
        [action.id]: {
          status: 'error',
          message: err instanceof Error ? err.message : 'Esecuzione sul PC negata o fallita.',
        },
      }));
    }
  };

  const handleRejectPcAction = (actionId: string) => {
    setPcDecisions((prev) => ({
      ...prev,
      [actionId]: {
        status: 'rejected',
      },
    }));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="flex h-[calc(100vh-5.5rem)] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
      {/* Left Chat History Sidebar */}
      {sidebarOpen && (
        <div className="w-64 shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 flex flex-col">
          <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleNewChat}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3 py-2 text-xs font-semibold text-white dark:text-zinc-950 hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              Nuova chat
            </button>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              title="Nascondi storico chat"
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2 text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {sessions.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
                Nessuna chat salvata.
              </p>
            ) : (
              sessions.map((s) => {
                const isSelected = s.id === activeSession?.id;
                return (
                  <div
                    key={s.id}
                    className={`group flex items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-950 dark:text-white font-medium'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
                    }`}
                    onClick={() => setActiveSessionId(s.id)}
                  >
                    <span className="truncate flex-1 pr-2">{s.title}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDeleteSession(s.id);
                        if (activeSessionId === s.id) {
                          setActiveSessionId(null);
                        }
                      }}
                      title="Elimina conversazione"
                      className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-red-500 transition-opacity"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Quick Switch Bar */}
        <div className="relative flex items-center justify-between gap-3 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
          <div className="flex items-center gap-2 min-w-0">
            {!sidebarOpen && (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                title="Mostra storico chat"
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 shrink-0"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}

            {/* Quick Switch Trigger (1st click) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setQuickSwitchOpen((prev) => !prev)}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors max-w-full"
              >
                {settings.smartRouter.enabled ? (
                  <>
                    <Shuffle className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap">
                      AUTO · Smart Router
                    </span>
                    <span className="text-zinc-400">·</span>
                    <span className="capitalize truncate">{effectiveTaskCategory}</span>
                  </>
                ) : (
                  <>
                    <ProviderIcon
                      providerId={settings.activeProviderId}
                      className="w-3.5 h-3.5 shrink-0"
                    />
                    <span className="font-semibold whitespace-nowrap">
                      {activeProvider?.name || settings.activeProviderId}
                    </span>
                    <span className="text-zinc-400">/</span>
                    <span className="font-mono truncate max-w-[200px] sm:max-w-[280px]">
                      {activeModelObj?.name || effectiveModelId || 'Seleziona modello'}
                    </span>
                    {activeProvider && activeProvider.apiKeys.length > 1 && activeProvider.activeKeyLabel && (
                      <span className="hidden md:inline text-[11px] text-zinc-500 dark:text-zinc-400 truncate max-w-[110px]">
                        · {activeProvider.activeKeyLabel}
                      </span>
                    )}
                  </>
                )}
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              </button>

              {/* Quick Switch Popover (2nd click switches directly!) */}
              {quickSwitchOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setQuickSwitchOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="absolute left-0 mt-2 z-40 w-[340px] sm:w-[420px] max-h-[70vh] overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3 shadow-2xl">
                    <div className="pb-2 mb-2 border-b border-zinc-100 dark:border-zinc-800">
                      <div className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 mb-1.5">
                        Modalità AUTO / Smart Router
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {TASK_CATEGORIES.map((cat) => {
                          const isCurrent =
                            settings.smartRouter.enabled && effectiveTaskCategory === cat.id;
                          return (
                            <button
                              key={cat.id}
                              type="button"
                              onClick={() => handleQuickSelectAuto(cat.id)}
                              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                                isCurrent
                                  ? 'bg-blue-600 text-white'
                                  : 'border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900'
                              }`}
                            >
                              AUTO · {cat.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-3">
                      {configuredProviders.length === 0 ? (
                        <div className="py-4 text-center text-xs text-zinc-500">
                          Nessun provider configurato.{' '}
                          <button
                            type="button"
                            onClick={() => {
                              setQuickSwitchOpen(false);
                              onNavigate('providers');
                            }}
                            className="text-blue-600 dark:text-blue-400 underline"
                          >
                            Configura ora
                          </button>
                        </div>
                      ) : (
                        configuredProviders.map((p) => {
                          const pModels = models
                            .filter((m) => m.providerId === p.id)
                            .sort(
                              (a, b) =>
                                pricingTierSortScore(a.pricingTier) -
                                  pricingTierSortScore(b.pricingTier) || a.id.localeCompare(b.id),
                            )
                            .slice(0, 12);
                          return (
                            <div key={p.id}>
                              <div className="flex items-center justify-between px-1 py-1 text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                                <span className="inline-flex items-center gap-1.5">
                                  <ProviderIcon providerId={p.id} className="w-3.5 h-3.5" />
                                  {p.name}
                                </span>
                                <span className="text-[11px] font-normal text-zinc-400">
                                  {p.modelCount} modelli
                                </span>
                              </div>
                              {p.apiKeys.length > 1 && (
                                <div className="mb-1.5 px-1 flex flex-wrap items-center gap-1">
                                  {p.apiKeys.map((k) => (
                                    <button
                                      key={k.id}
                                      type="button"
                                      disabled={switchingKey}
                                      onClick={() => void handleSwitchKey(p.id, k.id)}
                                      className={`rounded px-2 py-0.5 text-[10px] font-medium border transition-colors ${
                                        k.active
                                          ? 'border-blue-500 bg-blue-600 text-white'
                                          : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900'
                                      }`}
                                    >
                                      {k.label}
                                    </button>
                                  ))}
                                </div>
                              )}
                              <div className="space-y-0.5">
                                {pModels.length > 0 ? (
                                  pModels.map((m) => {
                                    const active =
                                      !settings.smartRouter.enabled &&
                                      settings.activeProviderId === p.id &&
                                      settings.activeModelId === m.id;
                                    const isFree = isFreeTierModel(m.pricingTier);
                                    const isPaid = m.pricingTier === 'paid';
                                    return (
                                      <button
                                        key={m.id}
                                        type="button"
                                        onClick={() => handleQuickSelectProviderModel(p.id, m.id)}
                                        className={`w-full flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                                          active
                                            ? 'bg-blue-50 dark:bg-blue-950/40 font-semibold'
                                            : 'hover:bg-zinc-100 dark:hover:bg-zinc-900'
                                        }`}
                                      >
                                        <span
                                          className={`truncate pr-2 font-mono text-[11px] ${
                                            isFree
                                              ? 'text-emerald-700 dark:text-emerald-400'
                                              : isPaid
                                                ? 'text-red-600 dark:text-red-400'
                                                : 'text-zinc-700 dark:text-zinc-300'
                                          }`}
                                        >
                                          {m.id}
                                        </span>
                                        {isFree && (
                                          <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                                            {m.pricingTier === 'free' ? 'Free' : 'Free Tier'}
                                          </span>
                                        )}
                                        {isPaid && (
                                          <span className="text-[10px] font-semibold text-red-600 dark:text-red-400 shrink-0">
                                            A pagamento
                                          </span>
                                        )}
                                      </button>
                                    );
                                  })
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => void handleRefreshModelsForProvider(p.id)}
                                    disabled={refreshingProviderId === p.id}
                                    className="w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-blue-600 dark:text-blue-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-50"
                                  >
                                    <RefreshCw
                                      className={`w-3 h-3 ${refreshingProviderId === p.id ? 'animate-spin' : ''}`}
                                    />
                                    {refreshingProviderId === p.id
                                      ? `Caricamento modelli ${p.name}...`
                                      : `Carica modelli da ${p.name}`}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {workspace.status === 'connected' ? (
              <div className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50 dark:bg-emerald-950/40 pl-2.5 pr-1 py-1 text-xs text-emerald-800 dark:text-emerald-300">
                <FolderCheck className="w-3.5 h-3.5 shrink-0" />
                <span className="font-medium truncate max-w-[140px]">
                  PC: {workspace.folderName}
                </span>
                <span className="hidden md:inline text-[11px] opacity-80 tabular-nums">
                  ({workspace.files.length} file)
                </span>
                <button
                  type="button"
                  disabled={workspaceBusy}
                  onClick={() => void handleDisconnectFolder()}
                  title="Scollega cartella PC"
                  className="ml-1 rounded p-0.5 hover:bg-emerald-200/70 dark:hover:bg-emerald-900/60"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : workspace.status === 'needs_permission' ? (
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  disabled={workspaceBusy}
                  onClick={() => void handleReauthorizeFolder()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 text-xs font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  <FolderKey className="w-3.5 h-3.5 shrink-0" />
                  <span>Riattiva PC: {workspace.folderName}</span>
                </button>
                <button
                  type="button"
                  disabled={workspaceBusy}
                  onClick={() => void handleDisconnectFolder()}
                  title="Rimuovi cartella salvata"
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={workspaceBusy}
                onClick={() => void handleAuthorizeFolder()}
                title="Autorizza una cartella locale sul PC per lettura e modifica su richiesta"
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap disabled:opacity-50"
              >
                <FolderOpen className="w-3.5 h-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                <span className="hidden sm:inline">Autorizza cartella PC</span>
                <span className="sm:hidden">File PC</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenPcAccessSettings}
              title="Configura permessi esecuzione app e comandi sul PC"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                pcAccess.mode === 'none'
                  ? 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  : 'border-indigo-200 dark:border-indigo-900/70 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40'
              }`}
            >
              <Laptop className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">
                {pcAccess.mode === 'none'
                  ? 'App PC: Nessun accesso'
                  : pcAccess.mode === 'full'
                    ? `App PC: Completo (${authorizedPcToolsCount})`
                    : pcAccess.mode === 'custom'
                      ? `App PC: Personalizzato (${authorizedPcToolsCount})`
                      : `App PC: Limitato (${authorizedPcToolsCount})`}
              </span>
              <span className="sm:hidden">
                {pcAccess.mode === 'none' ? 'PC Off' : `PC (${authorizedPcToolsCount})`}
              </span>
            </button>

            {onOpenAutoApproveSettings && (
              <button
                type="button"
                onClick={onOpenAutoApproveSettings}
                title="Configura profilo e regole Auto-Approve per operazioni automatiche senza conferma"
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  autoApprove.profile === 'full'
                    ? 'border-red-300 dark:border-red-900/70 bg-red-50/80 dark:bg-red-950/30 text-red-800 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40'
                    : 'border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline tabular-nums">
                  Auto-Approve: {autoApproveProfileLabel} ({enabledAutoApproveCount}/{totalAutoApproveCount})
                </span>
                <span className="sm:hidden tabular-nums">
                  {autoApproveProfileLabel} ({enabledAutoApproveCount})
                </span>
              </button>
            )}

            {sessionAllowedPermissions.size > 0 && (
              <button
                type="button"
                onClick={() => setSessionAllowedPermissions(new Set())}
                title="Permessi temporanei concessi per questa sessione — clicca per revocare"
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/80 dark:bg-indigo-950/30 px-2 py-1 text-[11px] font-medium text-indigo-800 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 whitespace-nowrap"
              >
                <span>Sessione: {sessionAllowedPermissions.size}</span>
                <X className="w-3 h-3" />
              </button>
            )}

            <div className="hidden lg:flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 shrink-0 pl-1">
              <span>Fallback:</span>
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                {settings.smartRouter.fallbackEnabled ? 'Attivo' : 'Disattivo'}
              </span>
            </div>
          </div>
        </div>

        {workspaceError && (
          <div className="flex items-start justify-between gap-2 px-4 py-2 border-b border-red-200 dark:border-red-900/60 bg-red-50/90 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
            <div className="flex flex-wrap items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{workspaceError}</span>
              {isRunningInIframe() && typeof window !== 'undefined' && (
                <a
                  href={window.location.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-red-700 whitespace-nowrap"
                >
                  Apri in nuova scheda
                  <ArrowRight className="w-3 h-3" />
                </a>
              )}
            </div>
            <button
              type="button"
              onClick={() => setWorkspaceError(null)}
              className="rounded p-0.5 hover:bg-red-200/60 dark:hover:bg-red-900/50 shrink-0"
              aria-label="Chiudi avviso cartella"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Messages Stream */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6">
          {!activeSession || activeSession.messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto">
              <h2 className="font-display text-xl font-bold text-zinc-950 dark:text-white">
                Chat Universale Multi-Provider
              </h2>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Invia prompt da un&apos;unica interfaccia. Cambia provider e modello istantaneamente
                con Quick Switch oppure attiva{' '}
                <strong className="text-zinc-900 dark:text-zinc-100">AUTO / Smart Router</strong>{' '}
                con fallback automatico.
              </p>
              <div className="mt-4 w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-3.5 text-left">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Bot className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                      Agente attivo: {activeAgent.name}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('agents')}
                    className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                  >
                    Configura agenti
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                  {activeAgent.role} · Lingua: <strong>{activeAgent.language}</strong> · Stile:{' '}
                  <span className="capitalize font-medium">{activeAgent.responseStyle}</span>
                </p>
              </div>
              {configuredProviders.length === 0 && (
                <button
                  type="button"
                  onClick={() => onNavigate('providers')}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  Configura il primo Provider
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            activeSession.messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-3xl rounded-xl px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                      : 'w-full border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/50 text-zinc-900 dark:text-zinc-100'
                  }`}
                >
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {msg.attachments.map((att, idx) => (
                        <img
                          key={idx}
                          src={`data:${att.mimeType};base64,${att.dataBase64}`}
                          alt={att.name || 'Allegato immagine'}
                          className="h-24 w-auto rounded-lg object-cover border border-white/20"
                        />
                      ))}
                    </div>
                  )}

                  {msg.role === 'user' ? (
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                  ) : (
                    <div>
                      {msg.fallbackUsed && msg.fallbackChain && msg.fallbackChain.length > 0 && (
                        <div className="mb-3 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                          Fallback automatico attivato:{' '}
                          {msg.fallbackChain
                            .map((f) => `${f.providerName} (${f.errorCode})`)
                            .join(' → ')}{' '}
                          → <strong>{msg.providerName}</strong>
                        </div>
                      )}

                      {msg.content ? (
                        <div className="space-y-1">
                          {parseAllChatActions(msg.id, msg.content).map((segment, segIdx) => {
                            const baseModel =
                              msg.providerName && msg.modelId
                                ? `${msg.providerName} · ${msg.modelId}`
                                : msg.modelId ||
                                  msg.providerName ||
                                  (activeProvider?.name && effectiveModelId
                                    ? `${activeProvider.name} · ${effectiveModelId}`
                                    : effectiveModelId || 'Assistente AI');
                            const requesterModel = msg.agentName
                              ? `Agente "${msg.agentName}" · ${baseModel}`
                              : baseModel;
                            const msgAgent = msg.agentId
                              ? agents.find((a) => a.id === msg.agentId)
                              : activeAgent;
                            const msgAgentReadOnly = Boolean(
                              msgAgent?.readOnlyMode ?? activeAgent.readOnlyMode,
                            );
                            return segment.type === 'markdown' ? (
                              <MarkdownContent key={`${msg.id}:md:${segIdx}`} content={segment.content} />
                            ) : segment.type === 'pc-exec' ? (
                              <PcActionCard
                                key={segment.id}
                                action={segment}
                                pcAccess={pcAccess}
                                autoApprove={autoApprove}
                                agentReadOnly={msgAgentReadOnly}
                                discovery={pcDiscovery}
                                isStreaming={isStreaming}
                                requesterModel={requesterModel}
                                sessionAllowedPermissions={sessionAllowedPermissions}
                                decision={pcDecisions[segment.id]}
                                onAuthorizeExec={handleAuthorizePcExec}
                                onReject={handleRejectPcAction}
                                onOpenPcAccessSettings={onOpenPcAccessSettings}
                                onOpenAutoApproveSettings={onOpenAutoApproveSettings}
                              />
                            ) : (
                              <WorkspaceActionCard
                                key={segment.id}
                                action={segment}
                                workspaceConnected={workspace.status === 'connected'}
                                workspaceNeedsPermission={workspace.status === 'needs_permission'}
                                workspaceFolderName={workspace.folderName}
                                autoApprove={autoApprove}
                                agentReadOnly={msgAgentReadOnly}
                                isStreaming={isStreaming}
                                requesterModel={requesterModel}
                                sessionAllowedPermissions={sessionAllowedPermissions}
                                decision={actionDecisions[segment.id]}
                                onAuthorizeConnect={handleAuthorizeConnect}
                                onAuthorizeRead={handleAuthorizeRead}
                                onAuthorizeWrite={handleAuthorizeWrite}
                                onReject={handleRejectAction}
                                onAuthorizeFolder={handleAuthorizeFolder}
                                onOpenAutoApproveSettings={onOpenAutoApproveSettings}
                              />
                            );
                          })}
                        </div>
                      ) : !msg.error && isStreaming ? (
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {streamingStatus || 'Generazione risposta...'}
                        </span>
                      ) : null}

                      {msg.error && (
                        <div className="mt-2 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-3 text-xs text-red-800 dark:text-red-300 space-y-2">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                            <div>
                              <div className="font-semibold">
                                Errore ({msg.error.code}): {msg.error.message}
                              </div>
                              {msg.error.detail && (
                                <div className="mt-1 font-mono text-[11px] opacity-80 break-all">
                                  {msg.error.detail}
                                </div>
                              )}
                            </div>
                          </div>
                          {(msg.error.code === 'MISSING_API_KEY' ||
                            msg.error.code === 'INVALID_API_KEY' ||
                            msg.error.code === 'HTTP_401') && (
                            <button
                              type="button"
                              onClick={() => onNavigate('providers')}
                              className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-700"
                            >
                              Vai a Providers
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )}

                      {msg.providerName && (
                        <div className="mt-3 pt-2 border-t border-zinc-200/80 dark:border-zinc-800/80 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                          {msg.agentName && (
                            <>
                              <span className="inline-flex items-center gap-1 font-medium text-blue-600 dark:text-blue-400">
                                <Bot className="w-3 h-3" />
                                {msg.agentName}
                              </span>
                              <span aria-hidden="true">·</span>
                            </>
                          )}
                          <span className="inline-flex items-center gap-1 font-medium text-zinc-700 dark:text-zinc-300">
                            <ProviderIcon
                              providerId={msg.providerId || ''}
                              className="w-3 h-3"
                            />
                            Risposta generata da {msg.providerName}
                          </span>
                          {msg.modelId && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono">{msg.modelId}</span>
                            </>
                          )}
                          {msg.latencyMs !== undefined && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono">{msg.latencyMs} ms</span>
                            </>
                          )}
                          {msg.usage &&
                            (msg.usage.inputTokens !== undefined ||
                              msg.usage.outputTokens !== undefined) && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono">
                                  {msg.usage.inputTokens ?? '?'} in / {msg.usage.outputTokens ?? '?'}{' '}
                                  out
                                </span>
                              </>
                            )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {isStreaming && liveFallbackChain.length > 0 && (
            <div className="text-xs text-amber-600 dark:text-amber-400">
              {streamingStatus}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Composer + Inline Provider/Model Selector */}
        <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3 sm:p-4 space-y-2.5">
          {/* Inline selectors */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Agent / Modus Operandi Selector */}
            <div className="relative">
              <button
                type="button"
                aria-label="Selettore Agente"
                aria-expanded={agentMenuOpen}
                onClick={() => setAgentMenuOpen((prev) => !prev)}
                title={`Agente attivo: ${activeAgent.name} (${activeAgent.language} · ${activeAgent.responseStyle})`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 dark:border-blue-900/70 bg-blue-50/70 dark:bg-blue-950/30 px-2.5 py-1 text-xs font-medium text-blue-800 dark:text-blue-200 hover:bg-blue-100/80 dark:hover:bg-blue-900/40 transition-colors max-w-[230px]"
              >
                <Bot className="w-3.5 h-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                <span className="truncate font-semibold">{activeAgent.name}</span>
                <span className="hidden sm:inline text-[10px] px-1 rounded bg-white/80 dark:bg-zinc-900/80 text-blue-700 dark:text-blue-300">
                  {activeAgent.language}
                </span>
                <ChevronDown className="w-3.5 h-3.5 opacity-70 shrink-0" />
              </button>

              {agentMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setAgentMenuOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="absolute bottom-full left-0 mb-1.5 z-40 w-[320px] sm:w-[390px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60">
                      <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                        Seleziona Agente / Modus Operandi
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setAgentMenuOpen(false);
                          onNavigate('agents');
                        }}
                        className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Gestisci / Crea →
                      </button>
                    </div>
                    <div className="max-h-80 overflow-y-auto p-1.5 space-y-1">
                      {agents.map((agent) => {
                        const selected = agent.id === activeAgent.id;
                        const isDef = agent.id === defaultAgentId;
                        return (
                          <button
                            key={agent.id}
                            type="button"
                            onClick={() => handleSelectAgent(agent)}
                            className={`w-full text-left rounded-lg px-2.5 py-2 transition-colors ${
                              selected
                                ? 'bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800'
                                : 'hover:bg-zinc-100 dark:hover:bg-zinc-900 border border-transparent'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                                {agent.name}
                              </span>
                              <div className="flex items-center gap-1 shrink-0">
                                {isDef && (
                                  <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                                    Default
                                  </span>
                                )}
                                <span className="rounded border border-zinc-200 dark:border-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-600 dark:text-zinc-400">
                                  {agent.language}
                                </span>
                                {selected && (
                                  <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                                )}
                              </div>
                            </div>
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                              {agent.role} · Stile {agent.responseStyle}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() =>
                void onUpdateSettings({
                  smartRouter: {
                    ...settings.smartRouter,
                    enabled: !settings.smartRouter.enabled,
                  },
                })
              }
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                settings.smartRouter.enabled
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <Shuffle className="w-3.5 h-3.5" />
              AUTO
            </button>

            {settings.smartRouter.enabled ? (
              <select
                value={effectiveTaskCategory}
                onChange={(e) => {
                  const nextCat = e.target.value as TaskCategory;
                  if (activeSession) {
                    void onSaveSession({
                      ...activeSession,
                      activeTaskCategory: nextCat,
                      updatedAt: new Date().toISOString(),
                    });
                  } else {
                    void onUpdateSettings({
                      smartRouter: {
                        ...settings.smartRouter,
                        taskCategory: nextCat,
                      },
                    });
                  }
                }}
                aria-label="Categoria task Smart Router"
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-800 dark:text-zinc-200"
              >
                {TASK_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    Task: {c.label}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <select
                  value={settings.activeProviderId}
                  onChange={(e) => void handleProviderChange(e.target.value)}
                  aria-label="Selettore Provider"
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-800 dark:text-zinc-200 max-w-[180px]"
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {!p.configured ? ' (non config.)' : ''}
                    </option>
                  ))}
                </select>

                <div className="relative flex-1 min-w-[170px] max-w-[300px]">
                  <button
                    type="button"
                    aria-label="Selettore Model"
                    aria-expanded={modelMenuOpen}
                    onClick={() => {
                      setModelMenuOpen((prev) => !prev);
                      setModelSearch('');
                    }}
                    className="w-full inline-flex items-center justify-between gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1 text-xs font-mono hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors"
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      {activeModelObj && (
                        <span
                          className={`h-2 w-2 rounded-full shrink-0 ${
                            isFreeTierModel(activeModelObj.pricingTier)
                              ? 'bg-emerald-500'
                              : activeModelObj.pricingTier === 'paid'
                                ? 'bg-red-500'
                                : 'bg-zinc-400'
                          }`}
                          aria-hidden="true"
                        />
                      )}
                      <span
                        className={`truncate ${
                          activeModelObj && isFreeTierModel(activeModelObj.pricingTier)
                            ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                            : activeModelObj?.pricingTier === 'paid'
                              ? 'text-red-600 dark:text-red-400 font-medium'
                              : 'text-zinc-800 dark:text-zinc-200'
                        }`}
                      >
                        {effectiveModelId ||
                          activeProvider?.defaultModel ||
                          'Nessun modello — clicca Aggiorna'}
                      </span>
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  </button>

                  {modelMenuOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-30"
                        onClick={() => setModelMenuOpen(false)}
                        aria-hidden="true"
                      />
                      <div className="absolute bottom-full left-0 mb-1.5 z-40 w-[300px] sm:w-[390px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl overflow-hidden">
                        {modelsForActiveProvider.length > 8 && (
                          <div className="p-2 border-b border-zinc-100 dark:border-zinc-800">
                            <div className="relative">
                              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-2" />
                              <input
                                type="text"
                                autoFocus
                                value={modelSearch}
                                onChange={(e) => setModelSearch(e.target.value)}
                                placeholder="Cerca modello..."
                                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 pl-8 pr-2.5 py-1 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                              />
                            </div>
                          </div>
                        )}

                        <div className="max-h-72 overflow-y-auto p-1.5 space-y-0.5">
                          {modelsForActiveProvider.length === 0 ? (
                            <div className="px-2.5 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                              {activeProvider?.defaultModel ||
                                'Nessun modello caricato. Clicca Aggiorna.'}
                            </div>
                          ) : filteredComposerModels.length === 0 ? (
                            <div className="px-2.5 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                              Nessun modello corrispondente.
                            </div>
                          ) : (
                            filteredComposerModels.map((m) => {
                              const isSelected = m.id === effectiveModelId;
                              const isFree = isFreeTierModel(m.pricingTier);
                              const isPaid = m.pricingTier === 'paid';
                              return (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => {
                                    void onUpdateSettings({ activeModelId: m.id });
                                    setModelMenuOpen(false);
                                  }}
                                  className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                                    isSelected
                                      ? isFree
                                        ? 'bg-emerald-50 dark:bg-emerald-950/40'
                                        : isPaid
                                          ? 'bg-red-50 dark:bg-red-950/40'
                                          : 'bg-blue-50 dark:bg-blue-950/40'
                                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-900'
                                  }`}
                                >
                                  <span className="flex items-center gap-1.5 min-w-0">
                                    <span
                                      className={`h-2 w-2 rounded-full shrink-0 ${
                                        isFree
                                          ? 'bg-emerald-500'
                                          : isPaid
                                            ? 'bg-red-500'
                                            : 'bg-zinc-400'
                                      }`}
                                      aria-hidden="true"
                                    />
                                    <span
                                      className={`truncate font-mono text-[11px] ${
                                        isFree
                                          ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                                          : isPaid
                                            ? 'text-red-600 dark:text-red-400 font-medium'
                                            : 'text-zinc-700 dark:text-zinc-300'
                                      }`}
                                    >
                                      {m.id}
                                    </span>
                                  </span>
                                  <span className="flex items-center gap-1.5 shrink-0">
                                    {isFree && (
                                      <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                        {m.pricingTier === 'free' ? 'Free' : 'Free Tier'}
                                      </span>
                                    )}
                                    {isPaid && (
                                      <span className="text-[10px] font-semibold text-red-600 dark:text-red-400">
                                        A pagamento
                                      </span>
                                    )}
                                    {isSelected && (
                                      <Check className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-300" />
                                    )}
                                  </span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {activeProvider && activeProvider.apiKeys.length > 1 ? (
                  <div className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2 py-1 max-w-[220px]">
                    <KeyRound className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400 shrink-0" />
                    <select
                      value={activeProvider.activeKeyId || ''}
                      disabled={switchingKey}
                      onChange={(e) => void handleSwitchKey(activeProvider.id, e.target.value)}
                      aria-label="Selettore API Key"
                      className="bg-transparent text-xs font-medium text-zinc-800 dark:text-zinc-200 focus:outline-none truncate disabled:opacity-50"
                    >
                      {activeProvider.apiKeys.map((k) => (
                        <option
                          key={k.id}
                          value={k.id}
                          className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
                        >
                          {k.label} ({k.maskedApiKey})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : activeProvider && activeProvider.apiKeys.length === 1 ? (
                  <button
                    type="button"
                    onClick={() => onNavigate('providers')}
                    title="Chiave API attiva per questa chat. Clicca per aggiungerne altre in Providers."
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors max-w-[180px]"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="truncate">{activeProvider.apiKeys[0].label}</span>
                  </button>
                ) : null}

                {activeProvider?.configured && activeProvider?.enabled && (
                  <button
                    type="button"
                    onClick={() => void handleRefreshModelsForProvider(activeProvider.id)}
                    disabled={refreshingProviderId === activeProvider.id}
                    title={`Aggiorna lista modelli da ${activeProvider.name}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 whitespace-nowrap"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${refreshingProviderId === activeProvider.id ? 'animate-spin' : ''}`}
                    />
                    Aggiorna
                  </button>
                )}
              </>
            )}

            {workspace.status === 'connected' && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setPcFileMenuOpen((prev) => !prev);
                    setPcFileSearch('');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/80 dark:bg-emerald-950/30 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 whitespace-nowrap"
                >
                  <FileText className="w-3.5 h-3.5" />
                  Inserisci file PC
                </button>

                {pcFileMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setPcFileMenuOpen(false)}
                      aria-hidden="true"
                    />
                    <div className="absolute bottom-full left-0 mb-1.5 z-40 w-[300px] sm:w-[360px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl overflow-hidden">
                      <div className="p-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-1.5">
                        <div className="relative flex-1">
                          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-2" />
                          <input
                            type="text"
                            autoFocus
                            value={pcFileSearch}
                            onChange={(e) => setPcFileSearch(e.target.value)}
                            placeholder={`Cerca in ${workspace.folderName}...`}
                            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 pl-8 pr-2.5 py-1 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>
                        <button
                          type="button"
                          disabled={workspaceBusy}
                          onClick={() => void handleRefreshWorkspace()}
                          title="Aggiorna elenco file della cartella"
                          className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${workspaceBusy ? 'animate-spin' : ''}`}
                          />
                        </button>
                      </div>

                      <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
                        {workspace.files.length === 0 ? (
                          <div className="px-2.5 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                            Cartella vuota.
                          </div>
                        ) : filteredWorkspaceFiles.length === 0 ? (
                          <div className="px-2.5 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                            Nessun file corrispondente.
                          </div>
                        ) : (
                          filteredWorkspaceFiles.map((f) => (
                            <button
                              key={f.path}
                              type="button"
                              onClick={() => void handleInsertPcFile(f.path)}
                              className="w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                            >
                              <span className="truncate font-mono text-[11px] text-zinc-800 dark:text-zinc-200">
                                {f.path}
                              </span>
                              <span className="text-[10px] text-zinc-400 tabular-nums shrink-0">
                                {f.size < 1024 ? `${f.size} B` : `${Math.round(f.size / 1024)} KB`}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((att, idx) => (
                <div
                  key={idx}
                  className="relative inline-flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-1.5"
                >
                  <img
                    src={`data:${att.mimeType};base64,${att.dataBase64}`}
                    alt={att.name || 'Immagine'}
                    className="h-10 w-10 rounded object-cover"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="rounded-full bg-zinc-900/80 p-0.5 text-white hover:bg-red-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Prompt input + Send/Stop */}
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleAttachImage(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Allega immagine (per modelli Vision/Multimodali)"
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2.5 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 shrink-0"
            >
              <ImagePlus className="w-4 h-4" />
            </button>

            <textarea
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Scrivi un prompt... (Invio per inviare, Shift+Invio per andare a capo)"
              className="flex-1 resize-none rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3.5 py-2 text-sm text-zinc-950 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />

            {isStreaming ? (
              <button
                type="button"
                onClick={handleStop}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-red-700 transition-colors whitespace-nowrap shrink-0"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!prompt.trim() && attachments.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
