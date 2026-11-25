import {
  AlertCircle,
  ArrowRight,
  Briefcase,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  FolderCheck,
  FolderKey,
  FolderOpen,
  ImagePlus,
  Layers,
  Lock,
  LogOut,
  MessageSquare,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  WorkspaceActionCard,
  type WorkspaceActionDecision,
} from '../components/WorkspaceActionCard';
import {
  deleteCopilotChatSession,
  disconnectCopilotAccount,
  fetchCopilotStatus,
  loginM365WithCredentials,
  pollGitHubCopilotDeviceLogin,
  pollM365CopilotDeviceLogin,
  refreshCopilotLicense,
  refreshGitHubCopilotModels,
  requestGitHubCopilotAuthUrl,
  requestM365CopilotAuthUrl,
  saveCopilotChatSession,
  startGitHubCopilotDeviceLogin,
  startM365CopilotDeviceLogin,
  streamCopilotChat,
  updateCopilotConfig,
} from '../services/apiClient';
import {
  authorizeWorkspaceFolder,
  buildWorkspaceSystemPrompt,
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
import { buildAgentSystemPrompt, resolveActiveAgent } from '../utils/agents';
import type {
  AppSettings,
  ChatAttachment,
  ChatMessage,
  ChatSession,
  CopilotMode,
  CopilotPublicStatus,
  CopilotSessionMode,
} from '../types/ai';
import { MarkdownContent } from '../utils/markdown';
import {
  parseWorkspaceActions,
  type WorkspaceConnectRequest,
  type WorkspaceReadRequest,
  type WorkspaceWriteRequest,
} from '../utils/workspaceActions';

interface CopilotProPageProps {
  settings: AppSettings;
  onToast: (type: 'info' | 'error', message: string) => void;
}

export function CopilotProPage({ settings, onToast }: CopilotProPageProps) {
  const [copilot, setCopilot] = useState<CopilotPublicStatus | null>(null);
  const [redirectUris, setRedirectUris] = useState<{ m365: string; github: string }>({
    m365: '',
    github: '',
  });
  const [loading, setLoading] = useState(true);
  const [configOpen, setConfigOpen] = useState(true);

  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [tenantIdInput, setTenantIdInput] = useState('organizations');
  const [m365ClientIdInput, setM365ClientIdInput] = useState('');
  const [enterpriseUrlInput, setEnterpriseUrlInput] = useState('https://github.com');
  const [githubClientIdInput, setGithubClientIdInput] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [licenseRefreshing, setLicenseRefreshing] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [manualAuthLink, setManualAuthLink] = useState<string | null>(null);
  const [copiedUri, setCopiedUri] = useState<string | null>(null);
  const [sessionMode, setSessionMode] = useState<CopilotSessionMode>('chat');

  const [deviceFlow, setDeviceFlow] = useState<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    intervalSec: number;
  } | null>(null);
  const [m365DeviceFlow, setM365DeviceFlow] = useState<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    intervalSec: number;
    emailHint?: string;
    notice?: string;
  } | null>(null);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);

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

  const abortRef = useRef<AbortController | null>(null);
  const latestStreamingSessionRef = useRef<ChatSession | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const devicePollTimerRef = useRef<number | null>(null);
  const m365DevicePollTimerRef = useRef<number | null>(null);

  const applyCopilotStatus = useCallback((data: {
    copilot: CopilotPublicStatus;
    redirectUris?: { m365: string; github: string };
  }) => {
    setCopilot(data.copilot);
    if (data.redirectUris) {
      setRedirectUris(data.redirectUris);
    }
    setTenantIdInput(data.copilot.m365.tenantId || 'organizations');
    setM365ClientIdInput(data.copilot.m365.clientId || '');
    setEnterpriseUrlInput(data.copilot.github.enterpriseUrl || 'https://github.com');
    setGithubClientIdInput(data.copilot.github.clientId || '');
    if (data.copilot.m365.accountEmail) {
      setEmailInput((prev) => prev || data.copilot.m365.accountEmail || '');
    }
    setSessions(data.copilot.sessions || []);
    setActiveSessionId((prev) => prev ?? data.copilot.sessions?.[0]?.id ?? null);

    const activeConnected =
      data.copilot.mode === 'm365'
        ? data.copilot.m365.connected
        : data.copilot.github.connected;
    if (activeConnected) {
      setConfigOpen(false);
    }

    const activeLicense =
      data.copilot.mode === 'm365' ? data.copilot.m365.license : data.copilot.github.license;
    if (!activeLicense?.coworkEnabled) {
      setSessionMode('chat');
    }
  }, []);

  const reloadStatus = useCallback(async () => {
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : undefined;
      const data = await fetchCopilotStatus(origin);
      applyCopilotStatus(data);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Impossibile caricare lo stato Copilot Pro.',
      );
    } finally {
      setLoading(false);
    }
  }, [applyCopilotStatus]);

  useEffect(() => {
    void reloadStatus();
    void restoreWorkspaceSnapshot().then(setWorkspace);
  }, [reloadStatus]);

  // Listen for OAuth popup completion
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const origin = event.origin || '';
      if (
        !origin.endsWith('.run.app') &&
        !origin.includes('localhost') &&
        !origin.includes('127.0.0.1') &&
        origin !== window.location.origin
      ) {
        return;
      }
      const data = event.data as {
        type?: string;
        message?: string;
      } | null;
      if (!data?.type) return;
      if (data.type === 'COPILOT_AUTH_SUCCESS') {
        setAuthBusy(false);
        setAuthError(null);
        setManualAuthLink(null);
        onToast('info', data.message || 'Account aziendale Copilot connesso.');
        void reloadStatus();
      } else if (data.type === 'COPILOT_AUTH_ERROR') {
        setAuthBusy(false);
        setAuthError(data.message || 'Autenticazione Copilot non riuscita.');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onToast, reloadStatus]);

  // Poll M365 Device Code Flow if active
  useEffect(() => {
    if (!m365DeviceFlow) return;
    let cancelled = false;

    const schedulePoll = (delaySec: number) => {
      m365DevicePollTimerRef.current = window.setTimeout(async () => {
        if (cancelled) return;
        try {
          const res = await pollM365CopilotDeviceLogin({
            deviceCode: m365DeviceFlow.deviceCode,
            tenantId: tenantIdInput,
            clientId: m365ClientIdInput,
            emailHint: m365DeviceFlow.emailHint,
          });
          if (cancelled) return;
          if (res.status === 'complete' && res.copilot) {
            setM365DeviceFlow(null);
            setAuthBusy(false);
            setAuthError(null);
            applyCopilotStatus({ copilot: res.copilot });
            onToast('info', 'Account aziendale Microsoft Copilot connesso.');
          } else if (res.status === 'slow_down') {
            schedulePoll(Math.max(delaySec + 5, res.interval ?? delaySec + 5));
          } else {
            schedulePoll(delaySec);
          }
        } catch (err) {
          if (cancelled) return;
          setM365DeviceFlow(null);
          setAuthBusy(false);
          setAuthError(
            err instanceof Error ? err.message : 'Verifica Microsoft scaduta o rifiutata.',
          );
        }
      }, delaySec * 1000);
    };

    schedulePoll(m365DeviceFlow.intervalSec);
    return () => {
      cancelled = true;
      if (m365DevicePollTimerRef.current !== null) {
        window.clearTimeout(m365DevicePollTimerRef.current);
        m365DevicePollTimerRef.current = null;
      }
    };
  }, [m365DeviceFlow, tenantIdInput, m365ClientIdInput, applyCopilotStatus, onToast]);

  // Poll GitHub Device Flow if active
  useEffect(() => {
    if (!deviceFlow) return;
    let cancelled = false;

    const schedulePoll = (delaySec: number) => {
      devicePollTimerRef.current = window.setTimeout(async () => {
        if (cancelled) return;
        try {
          const res = await pollGitHubCopilotDeviceLogin({
            deviceCode: deviceFlow.deviceCode,
            enterpriseUrl: enterpriseUrlInput,
            clientId: githubClientIdInput,
          });
          if (cancelled) return;
          if (res.status === 'complete' && res.copilot) {
            setDeviceFlow(null);
            setAuthBusy(false);
            setAuthError(null);
            applyCopilotStatus({ copilot: res.copilot });
            onToast('info', 'Account GitHub Copilot aziendale connesso.');
          } else if (res.status === 'slow_down') {
            schedulePoll(Math.max(delaySec + 5, res.interval ?? delaySec + 5));
          } else {
            schedulePoll(delaySec);
          }
        } catch (err) {
          if (cancelled) return;
          setDeviceFlow(null);
          setAuthBusy(false);
          setAuthError(
            err instanceof Error ? err.message : 'Autorizzazione GitHub scaduta o rifiutata.',
          );
        }
      }, delaySec * 1000);
    };

    schedulePoll(deviceFlow.intervalSec);
    return () => {
      cancelled = true;
      if (devicePollTimerRef.current !== null) {
        window.clearTimeout(devicePollTimerRef.current);
        devicePollTimerRef.current = null;
      }
    };
  }, [deviceFlow, enterpriseUrlInput, githubClientIdInput, applyCopilotStatus, onToast]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, activeSessionId, isStreaming]);

  useEffect(() => {
    if (!pcFileMenuOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setPcFileMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pcFileMenuOpen]);

  const activeMode: CopilotMode = copilot?.mode ?? 'm365';
  const isCurrentConnected = Boolean(
    copilot && (activeMode === 'm365' ? copilot.m365.connected : copilot.github.connected),
  );
  const currentLicense =
    activeMode === 'm365' ? copilot?.m365.license : copilot?.github.license;
  const coworkAllowed = Boolean(isCurrentConnected && currentLicense?.coworkEnabled);
  const effectiveSessionMode: CopilotSessionMode =
    sessionMode === 'cowork' && coworkAllowed ? 'cowork' : 'chat';

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );
  const filteredWorkspaceFiles = useMemo(() => {
    const q = pcFileSearch.trim().toLowerCase();
    if (!q) return workspace.files;
    return workspace.files.filter((f) => f.path.toLowerCase().includes(q));
  }, [workspace.files, pcFileSearch]);

  const handleCopyText = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedUri(label);
    setTimeout(() => setCopiedUri((curr) => (curr === label ? null : curr)), 1800);
  };

  const handleSwitchMode = async (mode: CopilotMode) => {
    setAuthError(null);
    setManualAuthLink(null);
    setDeviceFlow(null);
    setM365DeviceFlow(null);
    try {
      const res = await updateCopilotConfig({ mode });
      applyCopilotStatus(res);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Errore cambio modalità Copilot.');
    }
  };

  const handleCredentialLoginM365 = async (e: FormEvent) => {
    e.preventDefault();
    const submittedEmail = emailInput.trim();
    const submittedPassword = passwordInput;
    if (!submittedEmail || !submittedPassword) {
      setAuthError('Inserisci email aziendale e password.');
      return;
    }
    setPasswordInput('');
    setAuthBusy(true);
    setAuthError(null);
    setManualAuthLink(null);
    setM365DeviceFlow(null);

    try {
      const res = await loginM365WithCredentials({
        email: submittedEmail,
        password: submittedPassword,
        tenantId: tenantIdInput,
        clientId: m365ClientIdInput,
        origin: window.location.origin,
      });

      if (res.ok) {
        applyCopilotStatus({ copilot: res.copilot });
        setAuthBusy(false);
        onToast('info', 'Account aziendale Microsoft Copilot connesso.');
      } else if ('requiresDeviceCode' in res && res.requiresDeviceCode) {
        setM365DeviceFlow({
          deviceCode: res.deviceCode,
          userCode: res.userCode,
          verificationUri: res.verificationUri,
          intervalSec: res.interval,
          emailHint: submittedEmail,
          notice: res.message,
        });
        setAuthBusy(false);
      } else if ('requiresInteractiveOAuth' in res && res.requiresInteractiveOAuth) {
        setManualAuthLink(res.url);
        const popup = window.open(res.url, 'copilot_m365_oauth', 'width=560,height=720');
        if (!popup) {
          setAuthError(res.message);
          setAuthBusy(false);
        } else {
          setAuthError(res.message);
        }
      }
    } catch (err) {
      setAuthBusy(false);
      setAuthError(err instanceof Error ? err.message : 'Errore accesso Microsoft 365.');
    }
  };

  const handleConnectM365 = async () => {
    setAuthBusy(true);
    setAuthError(null);
    setManualAuthLink(null);
    setM365DeviceFlow(null);
    const hasCustomApp = Boolean(m365ClientIdInput.trim() || copilot?.m365.hasEnvClientId);

    try {
      if (hasCustomApp) {
        const { url } = await requestM365CopilotAuthUrl({
          tenantId: tenantIdInput,
          clientId: m365ClientIdInput,
          origin: window.location.origin,
          loginHint: emailInput.trim() || undefined,
        });
        const popup = window.open(url, 'copilot_m365_oauth', 'width=560,height=720');
        if (!popup) {
          setManualAuthLink(url);
          setAuthError(
            'Il browser ha bloccato il popup di accesso Microsoft. Clicca sul link qui sotto per aprire la pagina di login aziendale.',
          );
          setAuthBusy(false);
        }
        return;
      }

      const flow = await startM365CopilotDeviceLogin({
        tenantId: tenantIdInput,
        emailHint: emailInput.trim() || undefined,
      });
      setM365DeviceFlow({
        deviceCode: flow.deviceCode,
        userCode: flow.userCode,
        verificationUri: flow.verificationUri,
        intervalSec: flow.interval,
        emailHint: emailInput.trim() || undefined,
        notice:
          'Apri la pagina di accesso Microsoft, inserisci questo codice e accedi con la tua email e password aziendali (supporta MFA e SSO).',
      });
      setAuthBusy(false);
    } catch (err) {
      setAuthBusy(false);
      setAuthError(err instanceof Error ? err.message : 'Errore avvio login Microsoft 365.');
    }
  };

  const handleRefreshLicense = async () => {
    setLicenseRefreshing(true);
    try {
      const res = await refreshCopilotLicense(activeMode);
      applyCopilotStatus(res);
      onToast(
        'info',
        res.copilot.mode === 'm365'
          ? `Licenza verificata: ${res.copilot.m365.license?.licenseTierLabel || 'OK'}`
          : `Licenza verificata: ${res.copilot.github.license?.licenseTierLabel || 'OK'}`,
      );
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Impossibile verificare la licenza Copilot.',
      );
    } finally {
      setLicenseRefreshing(false);
    }
  };

  const handleStartGitHubDevice = async () => {
    setAuthBusy(true);
    setAuthError(null);
    setManualAuthLink(null);
    try {
      const flow = await startGitHubCopilotDeviceLogin({
        enterpriseUrl: enterpriseUrlInput,
        clientId: githubClientIdInput,
      });
      setDeviceFlow({
        deviceCode: flow.deviceCode,
        userCode: flow.userCode,
        verificationUri: flow.verificationUri,
        intervalSec: flow.interval,
      });
      setAuthBusy(false);
    } catch (err) {
      setAuthBusy(false);
      const msg = err instanceof Error ? err.message : 'Errore avvio login GitHub Copilot.';
      if (/GITHUB_COPILOT_CLIENT_ID|Client ID/i.test(msg)) {
        setAdvancedOpen(true);
      }
      setAuthError(msg);
    }
  };

  const handleConnectGitHubPopup = async () => {
    setAuthBusy(true);
    setAuthError(null);
    setManualAuthLink(null);
    try {
      const { url } = await requestGitHubCopilotAuthUrl({
        enterpriseUrl: enterpriseUrlInput,
        clientId: githubClientIdInput,
        origin: window.location.origin,
      });
      const popup = window.open(url, 'copilot_github_oauth', 'width=560,height=720');
      if (!popup) {
        setManualAuthLink(url);
        setAuthError(
          'Il browser ha bloccato il popup GitHub. Usa il link qui sotto oppure il login con Device Code.',
        );
        setAuthBusy(false);
      }
    } catch (err) {
      setAuthBusy(false);
      setAuthError(err instanceof Error ? err.message : 'Errore avvio OAuth GitHub.');
    }
  };

  const handleDisconnectAccount = async () => {
    setAuthBusy(true);
    setAuthError(null);
    setDeviceFlow(null);
    setM365DeviceFlow(null);
    try {
      const res = await disconnectCopilotAccount(activeMode);
      applyCopilotStatus(res);
      setConfigOpen(true);
      onToast('info', 'Account aziendale Copilot disconnesso.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleRefreshCopilotModels = async () => {
    setRefreshingModels(true);
    try {
      const res = await refreshGitHubCopilotModels();
      applyCopilotStatus(res);
      onToast('info', `${res.copilot.github.models.length} modelli Copilot aggiornati.`);
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Impossibile aggiornare i modelli Copilot.',
      );
    } finally {
      setRefreshingModels(false);
    }
  };

  // Local PC folder handlers
  const handleAuthorizeFolder = async () => {
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

  const persistSession = async (session: ChatSession) => {
    setSessions((prev) => {
      const exists = prev.some((s) => s.id === session.id);
      return exists ? prev.map((s) => (s.id === session.id ? session : s)) : [session, ...prev];
    });
    await saveCopilotChatSession(session);
  };

  const updateSessionLocal = (session: ChatSession) => {
    setSessions((prev) => {
      const exists = prev.some((s) => s.id === session.id);
      return exists ? prev.map((s) => (s.id === session.id ? session : s)) : [session, ...prev];
    });
  };

  const handleNewChat = (explicitMode?: CopilotSessionMode) => {
    const chosenKind =
      explicitMode === 'cowork' && coworkAllowed
        ? 'cowork'
        : explicitMode === 'chat'
          ? 'chat'
          : effectiveSessionMode;
    if (explicitMode) {
      setSessionMode(chosenKind);
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const newSession: ChatSession = {
      id,
      title: chosenKind === 'cowork' ? 'Nuovo workspace Cowork' : 'Nuova chat Copilot Pro',
      createdAt: now,
      updatedAt: now,
      messages: [],
      copilotKind: chosenKind,
    };
    void persistSession(newSession);
    setActiveSessionId(id);
  };

  const handleDeleteChat = async (id: string) => {
    const res = await deleteCopilotChatSession(id);
    setSessions(res.sessions);
    if (activeSessionId === id) {
      setActiveSessionId(res.sessions[0]?.id ?? null);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    if (latestStreamingSessionRef.current) {
      void persistSession(latestStreamingSessionRef.current);
      latestStreamingSessionRef.current = null;
    }
  };

  const sendCopilotPrompt = async (
    rawPrompt: string,
    explicitAttachments: ChatAttachment[],
    clearComposer: boolean,
    overrideWorkspace?: WorkspaceSnapshot,
  ) => {
    const trimmed = rawPrompt.trim();
    if ((!trimmed && explicitAttachments.length === 0) || isStreaming) return;
    if (!isCurrentConnected) {
      setConfigOpen(true);
      onToast('error', 'Connetti prima il tuo account aziendale Copilot Pro.');
      return;
    }

    const activeKind = effectiveSessionMode;
    const now = new Date().toISOString();
    const currentSession: ChatSession = activeSession
      ? {
          ...activeSession,
          copilotKind: activeKind,
          messages: [...activeSession.messages],
        }
      : {
          id: crypto.randomUUID(),
          title:
            trimmed.slice(0, 48) ||
            (activeKind === 'cowork' ? 'Workspace Cowork' : 'Chat Copilot Pro'),
          createdAt: now,
          updatedAt: now,
          messages: [],
          copilotKind: activeKind,
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
    };

    currentSession.messages = [...currentSession.messages, userMsg, assistantMsg];
    currentSession.updatedAt = now;
    setActiveSessionId(currentSession.id);
    await persistSession(currentSession);

    if (clearComposer) {
      setPrompt('');
      setAttachments([]);
    }
    setIsStreaming(true);

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
        void persistSession(latestSession);
      } else {
        updateSessionLocal(latestSession);
      }
    };

    const copilotAgent = resolveActiveAgent(
      settings.agents,
      undefined,
      settings.defaultAgentId,
    );
    const composedSystemPrompt = buildAgentSystemPrompt(copilotAgent, settings.systemPrompt);

    try {
      await streamCopilotChat(
        {
          mode: activeMode,
          sessionMode: effectiveSessionMode,
          modelId: activeMode === 'github' ? copilot?.github.selectedModelId : undefined,
          systemPrompt: buildWorkspaceSystemPrompt(
            composedSystemPrompt,
            overrideWorkspace ?? workspace,
          ),
          messages: historyForApi,
        },
        {
          onDelta: (delta) => {
            accumulatedContent += delta;
            patchAssistant({ content: accumulatedContent });
          },
          onDone: (payload) => {
            patchAssistant(
              {
                content: payload.text || accumulatedContent,
                providerId: `copilot-${activeMode}-${effectiveSessionMode}`,
                providerName:
                  effectiveSessionMode === 'cowork'
                    ? activeMode === 'm365'
                      ? 'Microsoft 365 Copilot Cowork'
                      : 'GitHub Copilot Cowork'
                    : activeMode === 'm365'
                      ? 'Microsoft 365 Copilot'
                      : 'GitHub Copilot Pro',
                modelId: payload.modelId,
                latencyMs: payload.latencyMs,
              },
              true,
            );
          },
          onError: (message) => {
            patchAssistant(
              {
                content: accumulatedContent,
                error: {
                  code: 'UNKNOWN_ERROR',
                  message,
                  retryable: true,
                  allowFallback: false,
                  providerId: `copilot-${activeMode}`,
                },
              },
              true,
            );
          },
        },
        controller.signal,
      );
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        patchAssistant(
          {
            content: accumulatedContent,
            error: {
              code: 'NETWORK_ERROR',
              message:
                err instanceof Error ? err.message : 'Connessione interrotta con Copilot Pro.',
              retryable: true,
              allowFallback: false,
              providerId: `copilot-${activeMode}`,
            },
          },
          true,
        );
      }
    } finally {
      abortRef.current = null;
      latestStreamingSessionRef.current = null;
      setIsStreaming(false);
    }
  };

  const handleSend = async () => {
    await sendCopilotPrompt(prompt, attachments, true);
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
      await sendCopilotPrompt(
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
        [action.id]: { status: 'error', message: msg },
      }));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const handleAuthorizeRead = async (action: WorkspaceReadRequest) => {
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

    setActionDecisions((prev) => ({
      ...prev,
      [action.id]: {
        status: 'approved',
        message: `Autorizzata lettura di ${readPaths.join(', ')} e inviato il contenuto a Copilot Pro.`,
      },
    }));

    const errorNote =
      failedMessages.length > 0
        ? `\n\nFile non leggibili:\n${failedMessages.map((m) => `- ${m}`).join('\n')}`
        : '';

    await sendCopilotPrompt(
      `Ho autorizzato la lettura dei seguenti file dal mio PC (${workspace.folderName || 'cartella locale'}):\n\n${readSections.join('\n\n')}${errorNote}\n\nProcedi con la risposta o proponi modifiche con \`aihub-write\`.`,
      [],
      false,
    );
  };

  const handleAuthorizeWrite = async (action: WorkspaceWriteRequest) => {
    try {
      const res = await writeWorkspaceFile(action.path, action.content);
      setWorkspace(res.snapshot);
      setActionDecisions((prev) => ({
        ...prev,
        [action.id]: {
          status: 'approved',
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

  const handleRejectAction = (actionId: string) => {
    setActionDecisions((prev) => ({
      ...prev,
      [actionId]: { status: 'rejected' },
    }));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  if (loading) {
    return (
      <div className="h-[calc(100vh-5.5rem)] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 animate-pulse" />
    );
  }

  return (
    <div className="flex h-[calc(100vh-5.5rem)] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
      {/* Left Copilot Chat History */}
      {sidebarOpen && (
        <div className="w-64 shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 flex flex-col">
          <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => handleNewChat()}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3 py-2 text-xs font-semibold text-white dark:text-zinc-950 hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              {effectiveSessionMode === 'cowork' ? 'Nuovo Cowork' : 'Nuova chat Copilot'}
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
                Nessuna chat Copilot salvata.
              </p>
            ) : (
              sessions.map((s) => {
                const isSelected = s.id === activeSession?.id;
                return (
                  <div
                    key={s.id}
                    onClick={() => {
                      setActiveSessionId(s.id);
                      if (s.copilotKind === 'cowork' && coworkAllowed) {
                        setSessionMode('cowork');
                      } else if (s.copilotKind === 'chat') {
                        setSessionMode('chat');
                      }
                    }}
                    className={`group flex items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-950 dark:text-white font-medium'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 pr-2">
                      {s.copilotKind === 'cowork' && (
                        <span className="shrink-0 rounded bg-indigo-100 dark:bg-indigo-950/70 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">
                          Cowork
                        </span>
                      )}
                      <span className="truncate">{s.title}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteChat(s.id);
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

      {/* Main Copilot Workspace */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
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

            <div className="flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
              <span className="font-display text-sm font-bold text-zinc-950 dark:text-white whitespace-nowrap">
                Copilot Pro Aziendale
              </span>
            </div>

            {isCurrentConnected ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 truncate max-w-[210px]">
                <ShieldCheck className="w-3 h-3 shrink-0" />
                {activeMode === 'm365'
                  ? copilot?.m365.accountEmail || copilot?.m365.accountName || 'M365 Connesso'
                  : copilot?.github.accountLogin || copilot?.github.accountName || 'GitHub Connesso'}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                Non connesso
              </span>
            )}

            {/* Chat / Cowork Mode Switcher (Cowork unlocked only if license supports it) */}
            <div
              className="inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-0.5"
              role="group"
              aria-label="Modalità Copilot"
            >
              <button
                type="button"
                onClick={() => setSessionMode('chat')}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  effectiveSessionMode === 'chat'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-xs'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <MessageSquare className="w-3 h-3" />
                Chat
              </button>
              <button
                type="button"
                disabled={!coworkAllowed}
                onClick={() => {
                  if (coworkAllowed) {
                    setSessionMode('cowork');
                  }
                }}
                title={
                  !isCurrentConnected
                    ? 'Accedi con il tuo account aziendale per verificare se la licenza include Cowork.'
                    : coworkAllowed
                      ? 'Modalità Cowork abilitata dalla tua licenza aziendale'
                      : currentLicense?.coworkReason ||
                        'La licenza dell’utenza connessa non prevede Cowork.'
                }
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  effectiveSessionMode === 'cowork'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : coworkAllowed
                      ? 'text-zinc-700 dark:text-zinc-300 hover:text-indigo-600 dark:hover:text-indigo-400'
                      : 'text-zinc-400 dark:text-zinc-600 cursor-not-allowed'
                }`}
              >
                {coworkAllowed ? (
                  <Layers className="w-3 h-3" />
                ) : (
                  <Lock className="w-3 h-3" />
                )}
                Cowork
              </button>
            </div>

            <button
              type="button"
              onClick={() => setConfigOpen((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap"
            >
              Account aziendale
              {configOpen ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {/* Local PC Folder Controls (same workflow as Chat) */}
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
                <span>Autorizza cartella PC</span>
              </button>
            )}
          </div>
        </div>

        {/* Corporate Account Setup & Login Drawer */}
        {configOpen && (
          <div className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/50 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-1">
                <button
                  type="button"
                  onClick={() => void handleSwitchMode('m365')}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    activeMode === 'm365'
                      ? 'bg-blue-600 text-white'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white'
                  }`}
                >
                  Microsoft 365 Copilot
                </button>
                <button
                  type="button"
                  onClick={() => void handleSwitchMode('github')}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    activeMode === 'github'
                      ? 'bg-blue-600 text-white'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white'
                  }`}
                >
                  GitHub Copilot Aziendale
                </button>
              </div>

              {isCurrentConnected && (
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={() => void handleDisconnectAccount()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-50"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Disconnetti account aziendale
                </button>
              )}
            </div>

            {/* License & Entitlement Status Card when connected */}
            {isCurrentConnected && (
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3.5 space-y-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                      Licenza rilevata: {currentLicense?.licenseTierLabel || 'Account verificato'}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      <Check className="w-3 h-3" />
                      Chat attiva
                    </span>
                    {coworkAllowed ? (
                      <span className="inline-flex items-center gap-1 rounded bg-indigo-100 dark:bg-indigo-950/60 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:text-indigo-300">
                        <Layers className="w-3 h-3" />
                        Cowork abilitato
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                        <Lock className="w-3 h-3" />
                        Cowork non incluso nella licenza
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={licenseRefreshing}
                    onClick={() => void handleRefreshLicense()}
                    className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${licenseRefreshing ? 'animate-spin' : ''}`} />
                    Verifica licenza
                  </button>
                </div>
                {currentLicense?.coworkReason && (
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                    {currentLicense.coworkReason}
                  </p>
                )}
              </div>
            )}

            {activeMode === 'm365' ? (
              <div className="space-y-3 text-xs">
                <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  Inserisci <strong>email aziendale</strong> e <strong>password</strong> per
                  connettere Microsoft 365 Copilot senza alcuna configurazione tecnica. Se
                  l&apos;organizzazione richiede verifica MFA o SSO, apparirà automaticamente la
                  procedura di conferma Microsoft.
                </p>

                <form onSubmit={(e) => void handleCredentialLoginM365(e)} className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                        Email aziendale
                      </label>
                      <input
                        type="email"
                        required
                        autoComplete="username"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        placeholder="nome.cognome@azienda.it"
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                        Password aziendale
                      </label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          autoComplete="current-password"
                          value={passwordInput}
                          onChange={(e) => setPasswordInput(e.target.value)}
                          placeholder="••••••••••••"
                          className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 pl-3 pr-9 py-2 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((prev) => !prev)}
                          aria-label={showPassword ? 'Nascondi password' : 'Mostra password'}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                        >
                          {showPassword ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="submit"
                      disabled={authBusy}
                      className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      {authBusy ? 'Verifica credenziali...' : 'Accedi con email e password'}
                    </button>

                    <button
                      type="button"
                      disabled={authBusy}
                      onClick={() => void handleConnectM365()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-50"
                    >
                      Accesso Microsoft (SSO / MFA)
                    </button>

                    <button
                      type="button"
                      onClick={() => setAdvancedOpen((prev) => !prev)}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                    >
                      <Settings2 className="w-3.5 h-3.5" />
                      Configurazione tecnica (opzionale)
                      {advancedOpen ? (
                        <ChevronUp className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </form>

                {m365DeviceFlow && (
                  <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/30 p-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-blue-900 dark:text-blue-200">
                        {m365DeviceFlow.notice ||
                          'Inserisci questo codice sulla pagina Microsoft per completare la verifica MFA / SSO:'}
                      </div>
                      <button
                        type="button"
                        onClick={() => setM365DeviceFlow(null)}
                        aria-label="Annulla verifica Microsoft"
                        className="rounded p-0.5 text-zinc-500 hover:bg-blue-100 dark:hover:bg-blue-900/50 shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="rounded-lg border border-blue-300 dark:border-blue-800 bg-white dark:bg-zinc-950 px-3.5 py-1.5 font-mono text-base font-bold tracking-widest text-zinc-950 dark:text-white">
                        {m365DeviceFlow.userCode}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleCopyText('m365-code', m365DeviceFlow.userCode)}
                        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        {copiedUri === 'm365-code' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        {copiedUri === 'm365-code' ? 'Codice copiato' : 'Copia codice'}
                      </button>
                      <a
                        href={m365DeviceFlow.verificationUri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                      >
                        Apri verifica Microsoft
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                    <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                      In attesa di conferma dal tuo account Microsoft... questa schermata si
                      aggiornerà automaticamente appena completi il login.
                    </p>
                  </div>
                )}

                {advancedOpen && (
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 p-3 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                          Tenant ID aziendale (o <code className="font-mono">organizations</code>)
                        </label>
                        <input
                          type="text"
                          value={tenantIdInput}
                          onChange={(e) => setTenantIdInput(e.target.value)}
                          placeholder="organizations oppure contoso.onmicrosoft.com"
                          className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-900 dark:text-zinc-100"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                          Client ID App Azure Entra ID
                        </label>
                        <input
                          type="text"
                          value={m365ClientIdInput}
                          onChange={(e) => setM365ClientIdInput(e.target.value)}
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                          className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-900 dark:text-zinc-100"
                        />
                      </div>
                    </div>

                    {redirectUris.m365 && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2">
                        <div className="min-w-0">
                          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mr-2">
                            Redirect URI Azure Entra ID:
                          </span>
                          <code className="font-mono text-[11px] text-zinc-900 dark:text-zinc-100 break-all">
                            {redirectUris.m365}
                          </code>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleCopyText('m365', redirectUris.m365)}
                          className="inline-flex items-center gap-1 rounded border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 shrink-0"
                        >
                          {copiedUri === 'm365' ? (
                            <Check className="w-3 h-3 text-emerald-500" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          {copiedUri === 'm365' ? 'Copiato' : 'Copia URI'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  Collega il tuo account aziendale <strong>GitHub Copilot Pro / Business / Enterprise</strong>{' '}
                  accedendo con le tue credenziali sul portale GitHub / Enterprise SSO della tua
                  azienda.
                </p>

                {deviceFlow && (
                  <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/30 p-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-blue-900 dark:text-blue-200">
                        Inserisci questo codice sulla pagina aziendale GitHub per completare il login:
                      </div>
                      <button
                        type="button"
                        onClick={() => setDeviceFlow(null)}
                        aria-label="Annulla verifica GitHub"
                        className="rounded p-0.5 text-zinc-500 hover:bg-blue-100 dark:hover:bg-blue-900/50 shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="rounded-lg border border-blue-300 dark:border-blue-800 bg-white dark:bg-zinc-950 px-3.5 py-1.5 font-mono text-base font-bold tracking-widest text-zinc-950 dark:text-white">
                        {deviceFlow.userCode}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleCopyText('code', deviceFlow.userCode)}
                        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        {copiedUri === 'code' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        {copiedUri === 'code' ? 'Codice copiato' : 'Copia codice'}
                      </button>
                      <a
                        href={deviceFlow.verificationUri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                      >
                        Apri login GitHub Aziendale
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                    <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                      In attesa di conferma dal tuo account... questa schermata si aggiornerà da
                      sola appena completi l&apos;accesso.
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={authBusy}
                    onClick={() => void handleStartGitHubDevice()}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    Accedi con account GitHub aziendale
                  </button>

                  {copilot?.github.hasEnvClientSecret && (
                    <button
                      type="button"
                      disabled={authBusy}
                      onClick={() => void handleConnectGitHubPopup()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-50"
                    >
                      Accedi via Popup OAuth
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setAdvancedOpen((prev) => !prev)}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                    Configurazione tecnica (opzionale)
                    {advancedOpen ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                  </button>
                </div>

                {advancedOpen && (
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 p-3 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                          Dominio GitHub / Enterprise Server
                        </label>
                        <input
                          type="text"
                          value={enterpriseUrlInput}
                          onChange={(e) => setEnterpriseUrlInput(e.target.value)}
                          placeholder="https://github.com oppure https://azienda.ghe.com"
                          className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-900 dark:text-zinc-100"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                          Client ID GitHub OAuth App (Device Flow)
                        </label>
                        <input
                          type="text"
                          value={githubClientIdInput}
                          onChange={(e) => setGithubClientIdInput(e.target.value)}
                          placeholder="Ov23li..."
                          className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-900 dark:text-zinc-100"
                        />
                      </div>
                    </div>

                    {copilot?.github.hasEnvClientSecret && redirectUris.github && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2">
                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          Callback URL GitHub OAuth:{' '}
                          <code className="font-mono">{redirectUris.github}</code>
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleCopyText('gh-uri', redirectUris.github)}
                          className="inline-flex items-center gap-1 rounded border border-zinc-200 dark:border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-700 dark:text-zinc-300"
                        >
                          {copiedUri === 'gh-uri' ? 'Copiato' : 'Copia'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {authError && (
              <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-3 text-xs text-red-700 dark:text-red-300 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{authError}</span>
                </div>
                {manualAuthLink && (
                  <a
                    href={manualAuthLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    Apri pagina login aziendale
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            )}
          </div>
        )}

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
                {effectiveSessionMode === 'cowork'
                  ? 'Workspace Copilot Cowork'
                  : 'Workspace Dedicato Copilot Pro'}
              </h2>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                {effectiveSessionMode === 'cowork'
                  ? 'Modalità Cowork attiva per la tua licenza: pianifica attività multi-step, coordina analisi su più file della cartella PC autorizzata e genera deliverable aziendali completi.'
                  : 'Accedi con le tue credenziali aziendali e autorizza una cartella locale sul PC per leggere o modificare file su richiesta.'}
              </p>
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
                      {msg.content ? (
                        <div className="space-y-1">
                          {parseWorkspaceActions(msg.id, msg.content).map((segment, segIdx) =>
                            segment.type === 'markdown' ? (
                              <MarkdownContent key={`${msg.id}:md:${segIdx}`} content={segment.content} />
                            ) : (
                              <WorkspaceActionCard
                                key={segment.id}
                                action={segment}
                                workspaceConnected={workspace.status === 'connected'}
                                workspaceNeedsPermission={workspace.status === 'needs_permission'}
                                workspaceFolderName={workspace.folderName}
                                isStreaming={isStreaming}
                                decision={actionDecisions[segment.id]}
                                onAuthorizeConnect={handleAuthorizeConnect}
                                onAuthorizeRead={handleAuthorizeRead}
                                onAuthorizeWrite={handleAuthorizeWrite}
                                onReject={handleRejectAction}
                                onAuthorizeFolder={handleAuthorizeFolder}
                              />
                            ),
                          )}
                        </div>
                      ) : !msg.error && isStreaming ? (
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          Copilot Pro sta elaborando...
                        </span>
                      ) : null}

                      {msg.error && (
                        <div className="mt-2 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-3 text-xs text-red-800 dark:text-red-300 flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>{msg.error.message}</span>
                        </div>
                      )}

                      {msg.providerName && (
                        <div className="mt-3 pt-2 border-t border-zinc-200/80 dark:border-zinc-800/80 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">
                            {msg.providerName}
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
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Bottom Composer */}
        <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3 sm:p-4 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {activeMode === 'github' && copilot?.github.connected && (
              <>
                <select
                  value={copilot.github.selectedModelId}
                  onChange={(e) => {
                    const nextModel = e.target.value;
                    void updateCopilotConfig({ selectedModelId: nextModel }).then((res) =>
                      applyCopilotStatus(res),
                    );
                  }}
                  aria-label="Modello GitHub Copilot"
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1 text-xs font-mono text-zinc-900 dark:text-zinc-100 max-w-[260px]"
                >
                  {(copilot.github.models.length > 0
                    ? copilot.github.models
                    : [{ id: copilot.github.selectedModelId, name: copilot.github.selectedModelId }]
                  ).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.id})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={refreshingModels}
                  onClick={() => void handleRefreshCopilotModels()}
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${refreshingModels ? 'animate-spin' : ''}`} />
                  Aggiorna modelli
                </button>
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

          <div className="flex items-end gap-2">
            {activeMode === 'github' && (
              <>
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
                  title="Allega immagine (per modelli Vision Copilot)"
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2.5 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 shrink-0"
                >
                  <ImagePlus className="w-4 h-4" />
                </button>
              </>
            )}

            <textarea
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isCurrentConnected
                  ? effectiveSessionMode === 'cowork'
                    ? 'Assegna un compito multi-step a Copilot Cowork... (Invio per inviare, Shift+Invio a capo)'
                    : 'Scrivi a Copilot Pro... (Invio per inviare, Shift+Invio per andare a capo)'
                  : 'Accedi prima con il tuo account aziendale qui sopra...'
              }
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
                disabled={(!prompt.trim() && attachments.length === 0) || !isCurrentConnected}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                Invia
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
