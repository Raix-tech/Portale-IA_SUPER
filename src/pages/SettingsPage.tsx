import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  Code2,
  Copy,
  Download,
  FolderOpen,
  KeyRound,
  Laptop,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AutoApproveSection } from '../components/AutoApproveSection';
import { ProviderIcon } from '../components/ProviderIcon';
import {
  clearSavedBackupDirectory,
  getSavedBackupDirectoryInfo,
  isEmbeddedIframe,
  pickBackupDirectory,
  supportsBackupDirectoryPicker,
} from '../services/sourceBackupClient';
import type {
  AppSettings,
  CatalogMeta,
  ExportBundle,
  GatewayStatus,
  PcAccessMode,
  PcAccessSettings,
  PcDiscoverySnapshot,
  PcToolCategory,
  PcToolCustomGroup,
  PublicProviderConfig,
  SourceBackupSettings,
  TaskCategory,
} from '../types/ai';
import { getDefaultAutoApproveSettings } from '../utils/autoApprove';
import {
  getDefaultPcAccessClient,
  isPcToolAuthorizedClient,
} from '../utils/pcActions';

export type SettingsTab = 'all' | 'pc' | 'auto-approve' | 'general' | 'integrations';

interface SettingsPageProps {
  settings: AppSettings;
  providers: PublicProviderConfig[];
  gateway: GatewayStatus;
  catalogMeta: CatalogMeta | null;
  checkingUpdates: boolean;
  pcDiscovery: PcDiscoverySnapshot | null;
  scanningPcTools: boolean;
  initialTab?: SettingsTab;
  onRefreshPcTools: () => Promise<void>;
  onAddCustomPcTool: (payload: {
    name: string;
    executable: string;
    category: PcToolCategory;
    isGui: boolean;
    description?: string;
  }) => Promise<void>;
  onDeleteCustomPcTool: (id: string) => Promise<void>;
  onCheckUpdates: () => void;
  onOpenSourceBackup: () => void;
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<void>;
  onExportBundle: (options: { includeSecrets: boolean; password?: string }) => Promise<ExportBundle>;
  onImportBundle: (options: { bundle: ExportBundle; password?: string }) => Promise<void>;
  onGenerateGatewayToken: () => Promise<void>;
  onCopyGatewayToken: () => Promise<void>;
  onRevokeGatewayToken: () => Promise<void>;
}

const TASKS: Array<{ id: TaskCategory; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'coding', label: 'Coding' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'fast', label: 'Fast' },
  { id: 'vision', label: 'Vision' },
];

const PC_ACCESS_MODES: Array<{
  id: PcAccessMode;
  title: string;
  description: string;
}> = [
  {
    id: 'none',
    title: 'Nessun accesso',
    description:
      'Le AI non possono avviare programmi né eseguire comandi o script sulla postazione locale.',
  },
  {
    id: 'limited',
    title: 'Accesso limitato',
    description:
      'Consente solo applicazioni sicure (Browser, Git, VS Code, Office, Windows Terminal), bloccando shell e interpreti di script salvo eccezioni.',
  },
  {
    id: 'custom',
    title: 'Accesso personalizzato',
    description:
      'Scegli categoria per categoria o abilita/disabilita individualmente ogni programma rilevato sul PC.',
  },
  {
    id: 'full',
    title: 'Accesso completo',
    description:
      'Consente alle AI (sempre previa conferma esplicita per ogni operazione) tutti i programmi, shell, interpreti e CLI installati sul computer.',
  },
];

const PC_CUSTOM_GROUPS: Array<{
  id: PcToolCustomGroup;
  label: string;
  hint: string;
}> = [
  { id: 'powershell', label: 'PowerShell', hint: 'PowerShell, CMD / Batch, Windows Terminal' },
  { id: 'python', label: 'Python', hint: 'Interprete Python e script .py' },
  { id: 'office', label: 'Microsoft Office', hint: 'Word, Excel, PowerPoint, Outlook, Access' },
  { id: 'browser', label: 'Browser', hint: 'Microsoft Edge, Google Chrome, Mozilla Firefox' },
  { id: 'git', label: 'Git', hint: 'Controllo versione Git da CLI' },
  { id: 'vscode', label: 'Visual Studio Code', hint: 'Editor VS Code e comandi code' },
  { id: 'other', label: 'Altre applicazioni', hint: 'Node.js, npm/npx, Bash, CLI nel PATH e app desktop' },
];

export function SettingsPage({
  settings,
  providers,
  gateway,
  catalogMeta,
  checkingUpdates,
  pcDiscovery,
  scanningPcTools,
  initialTab = 'all',
  onRefreshPcTools,
  onAddCustomPcTool,
  onDeleteCustomPcTool,
  onCheckUpdates,
  onOpenSourceBackup,
  onUpdateSettings,
  onExportBundle,
  onImportBundle,
  onGenerateGatewayToken,
  onCopyGatewayToken,
  onRevokeGatewayToken,
}: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [pcSearch, setPcSearch] = useState('');
  const [pcSourceFilter, setPcSourceFilter] = useState<'all' | 'builtin' | 'path' | 'desktop' | 'custom'>('all');
  const [pcOnlyAvailable, setPcOnlyAvailable] = useState(false);
  const [customAppName, setCustomAppName] = useState('');
  const [customAppExe, setCustomAppExe] = useState('');
  const [customAppCategory, setCustomAppCategory] = useState<PcToolCategory>('cli');
  const [customAppIsGui, setCustomAppIsGui] = useState(false);
  const [addingCustomApp, setAddingCustomApp] = useState(false);
  const [customAppError, setCustomAppError] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const [pendingImportBundle, setPendingImportBundle] = useState<ExportBundle | null>(null);
  const [importPassword, setImportPassword] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const sourceBackupCfg: SourceBackupSettings = settings.sourceBackup ?? {
    autoEnabled: false,
    intervalHours: 24,
    localPath: '',
    fileNamePrefix: 'free-ai-hub-source',
  };
  const [backupLocalPath, setBackupLocalPath] = useState(sourceBackupCfg.localPath);
  const [backupPrefix, setBackupPrefix] = useState(sourceBackupCfg.fileNamePrefix);
  const [backupDirInfo, setBackupDirInfo] = useState<{ connected: boolean; folderName?: string }>({
    connected: false,
  });
  const [backupDirMsg, setBackupDirMsg] = useState<string | null>(null);

  useEffect(() => {
    setBackupLocalPath(sourceBackupCfg.localPath);
    setBackupPrefix(sourceBackupCfg.fileNamePrefix);
  }, [sourceBackupCfg.localPath, sourceBackupCfg.fileNamePrefix]);

  useEffect(() => {
    void getSavedBackupDirectoryInfo().then(setBackupDirInfo);
  }, []);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const pcAccess: PcAccessSettings = settings.pcAccess ?? getDefaultPcAccessClient();

  const updatePcAccess = async (patch: Partial<PcAccessSettings>) => {
    const next: PcAccessSettings = {
      ...pcAccess,
      ...patch,
      allowedGroups: patch.allowedGroups ?? pcAccess.allowedGroups,
      disabledToolIds: patch.disabledToolIds ?? pcAccess.disabledToolIds,
      enabledToolIds: patch.enabledToolIds ?? pcAccess.enabledToolIds,
      customTools: patch.customTools ?? pcAccess.customTools,
    };
    await onUpdateSettings({ pcAccess: next });
  };

  const handleTogglePcTool = async (toolId: string, currentlyAllowed: boolean) => {
    const enabledSet = new Set(pcAccess.enabledToolIds);
    const disabledSet = new Set(pcAccess.disabledToolIds);
    if (currentlyAllowed) {
      enabledSet.delete(toolId);
      disabledSet.add(toolId);
    } else {
      disabledSet.delete(toolId);
      enabledSet.add(toolId);
    }
    await updatePcAccess({
      enabledToolIds: Array.from(enabledSet),
      disabledToolIds: Array.from(disabledSet),
    });
  };

  const handleAddCustomToolSubmit = async () => {
    setCustomAppError(null);
    if (!customAppName.trim() || !customAppExe.trim()) {
      setCustomAppError('Inserisci sia il nome che il comando o percorso eseguibile.');
      return;
    }
    setAddingCustomApp(true);
    try {
      await onAddCustomPcTool({
        name: customAppName.trim(),
        executable: customAppExe.trim(),
        category: customAppCategory,
        isGui: customAppIsGui,
      });
      setCustomAppName('');
      setCustomAppExe('');
      setCustomAppIsGui(false);
    } catch (err) {
      setCustomAppError(
        err instanceof Error ? err.message : 'Impossibile registrare applicazione personalizzata.',
      );
    } finally {
      setAddingCustomApp(false);
    }
  };

  const filteredPcTools = useMemo(() => {
    const all = pcDiscovery?.tools ?? [];
    const q = pcSearch.trim().toLowerCase();
    return all.filter((tool) => {
      if (pcOnlyAvailable && !tool.available) return false;
      if (pcSourceFilter !== 'all' && tool.source !== pcSourceFilter) return false;
      if (!q) return true;
      return (
        tool.name.toLowerCase().includes(q) ||
        tool.executable.toLowerCase().includes(q) ||
        tool.id.toLowerCase().includes(q) ||
        (tool.path && tool.path.toLowerCase().includes(q)) ||
        (tool.description && tool.description.toLowerCase().includes(q))
      );
    });
  }, [pcDiscovery?.tools, pcSearch, pcSourceFilter, pcOnlyAvailable]);

  const authorizedPcToolsCount = useMemo(
    () => (pcDiscovery?.tools ?? []).filter((t) => isPcToolAuthorizedClient(t, pcAccess)).length,
    [pcDiscovery?.tools, pcAccess],
  );

  const providerMap = new Map(providers.map((p) => [p.id, p]));
  const orderedProviders = settings.smartRouter.providerPriority
    .map((id) => providerMap.get(id))
    .filter((p): p is PublicProviderConfig => Boolean(p));

  const movePriority = async (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= orderedProviders.length) return;
    const copy = orderedProviders.map((p) => p.id);
    const [item] = copy.splice(index, 1);
    copy.splice(nextIndex, 0, item);
    await onUpdateSettings({
      smartRouter: {
        ...settings.smartRouter,
        providerPriority: copy,
      },
    });
  };

  const handleExport = async () => {
    setExportError(null);
    setExportStatus(null);
    try {
      const bundle = await onExportBundle({
        includeSecrets,
        password: includeSecrets ? exportPassword : undefined,
      });
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = includeSecrets
        ? `free-ai-hub-backup-encrypted-${new Date().toISOString().slice(0, 10)}.json`
        : `free-ai-hub-config-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportPassword('');
      setExportStatus(
        includeSecrets
          ? 'Backup cifrato con segreti scaricato.'
          : 'Configurazione esportata senza API key.',
      );
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Errore durante esportazione.');
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    setImportStatus(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as ExportBundle;
      if (bundle.format !== 'free-ai-hub-backup') {
        throw new Error('Il file selezionato non è un backup valido di Free AI Hub.');
      }
      if (bundle.encrypted) {
        setPendingImportBundle(bundle);
      } else {
        await onImportBundle({ bundle });
        setImportStatus('Configurazione importata con successo.');
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'File non valido.');
    } finally {
      e.target.value = '';
    }
  };

  const handleEncryptedImportConfirm = async () => {
    if (!pendingImportBundle) return;
    setImportError(null);
    try {
      await onImportBundle({ bundle: pendingImportBundle, password: importPassword });
      setPendingImportBundle(null);
      setImportPassword('');
      setImportStatus('Backup cifrato importato e ripristinato.');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Decifratura fallita.');
    }
  };

  const showPc = activeTab === 'all' || activeTab === 'pc';
  const showAutoApprove = activeTab === 'all' || activeTab === 'auto-approve';
  const showGeneral = activeTab === 'all' || activeTab === 'general';
  const showIntegrations = activeTab === 'all' || activeTab === 'integrations';

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-950 dark:text-white">
            Impostazioni
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Gestisci accesso al PC locale, Auto-Approve, Smart Router AUTO, fallback automatico, aspetto e backup.
          </p>
        </div>

        <div className="inline-flex flex-wrap rounded-lg border border-zinc-200 dark:border-zinc-800 p-1 bg-zinc-100 dark:bg-zinc-900">
          {(
            [
              { id: 'all', label: 'Tutte' },
              { id: 'pc', label: 'Accesso al PC' },
              { id: 'auto-approve', label: 'Auto-Approve' },
              { id: 'general', label: 'Router & Generale' },
              { id: 'integrations', label: 'VS Code & Backup' },
            ] as Array<{ id: SettingsTab; label: string }>
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Accesso al PC: Consenti accesso alle risorse locali */}
      {showPc && (
        <section
          id="pc-access-settings"
          className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-6 space-y-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center shrink-0">
                <Laptop className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-white">
                    Accesso al PC · Consenti accesso alle risorse locali
                  </h2>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                      pcAccess.mode === 'none'
                        ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                        : pcAccess.mode === 'full'
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                          : 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                    }`}
                  >
                    {pcAccess.mode === 'none'
                      ? 'Nessun accesso'
                      : `${authorizedPcToolsCount} strumenti autorizzati`}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Trasforma Free AI Hub in un ambiente operativo reale: le AI possono proporre l&apos;uso di
                  shell, interpreti, suite Office, browser, IDE e CLI rilevati sul computer, sempre previa tua conferma per ogni operazione.
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={scanningPcTools}
              onClick={() => void onRefreshPcTools()}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/80 px-3.5 py-2 text-xs font-semibold text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${scanningPcTools ? 'animate-spin' : ''}`} />
              {scanningPcTools ? 'Scansione PC...' : 'Rileva strumenti ora'}
            </button>
          </div>

          {/* 4 Modalità di accesso */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PC_ACCESS_MODES.map((m) => {
              const selected = pcAccess.mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => void updatePcAccess({ mode: m.id })}
                  className={`text-left rounded-xl border p-4 transition-colors ${
                    selected
                      ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30 ring-1 ring-indigo-500/40'
                      : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950/40 hover:bg-zinc-100/70 dark:hover:bg-zinc-900'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-zinc-950 dark:text-white">
                      {m.title}
                    </span>
                    <span
                      className={`h-4 w-4 rounded-full border flex items-center justify-center ${
                        selected
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : 'border-zinc-300 dark:border-zinc-700'
                      }`}
                    >
                      {selected && <Check className="w-2.5 h-2.5" />}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    {m.description}
                  </p>
                </button>
              );
            })}
          </div>

          {pcAccess.mode === 'full' && (
            <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/25 p-3.5 text-xs text-emerald-900 dark:text-emerald-200">
              <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
              <div>
                <strong>Accesso completo attivo:</strong> la piattaforma può utilizzare tutti gli
                applicativi, interpreti di script (PowerShell, Python, Batch, JS, Bash), programmi desktop
                e utility nel PATH rilevati su questa postazione. Ogni singolo comando o avvio in chat
                continuerà a richiedere la tua conferma esplicita.
              </div>
            </div>
          )}

          {/* Accesso personalizzato: checklist categorie richieste */}
          {pcAccess.mode === 'custom' && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 p-4 space-y-3">
              <div>
                <div className="text-xs font-semibold text-zinc-950 dark:text-white">
                  Applicazioni consentite all&apos;AI
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Abilita o disabilita intere categorie oppure personalizza ogni singolo programma nella lista sottostante.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {PC_CUSTOM_GROUPS.map((grp) => {
                  const checked = Boolean(pcAccess.allowedGroups[grp.id]);
                  return (
                    <label
                      key={grp.id}
                      className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-3 cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700"
                    >
                      <div>
                        <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                          {grp.label}
                        </div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          {grp.hint}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          void updatePcAccess({
                            allowedGroups: {
                              ...pcAccess.allowedGroups,
                              [grp.id]: e.target.checked,
                            },
                          })
                        }
                        className="mt-0.5 h-4 w-4 accent-indigo-600 shrink-0"
                      />
                    </label>
                  );
                })}

                <label className="flex items-start justify-between gap-3 rounded-lg border border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/50 dark:bg-indigo-950/20 p-3 cursor-pointer">
                  <div>
                    <div className="text-xs font-semibold text-indigo-950 dark:text-indigo-200">
                      Tutte le applicazioni installate
                    </div>
                    <div className="text-[11px] text-indigo-800/80 dark:text-indigo-300/80">
                      Consenti automaticamente tutte le app desktop e utility CLI rilevate (salvo quelle disabilitate singolarmente)
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={pcAccess.allowAllInstalled}
                    onChange={(e) =>
                      void updatePcAccess({ allowAllInstalled: e.target.checked })
                    }
                    className="mt-0.5 h-4 w-4 accent-indigo-600 shrink-0"
                  />
                </label>
              </div>
            </div>
          )}

          {/* Riepilogo rilevamento automatico + filtri + lista individuale estensibile */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                Strumenti e programmi rilevati sulla postazione
              </div>
              {pcDiscovery && (
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                  <span>
                    OS: <strong className="font-mono text-zinc-700 dark:text-zinc-300">{pcDiscovery.platform}</strong>
                  </span>
                  <span>
                    Disponibili: <strong className="text-zinc-700 dark:text-zinc-300">{pcDiscovery.availableCount}</strong>
                  </span>
                  <span>
                    Nel PATH: <strong className="text-zinc-700 dark:text-zinc-300">{pcDiscovery.pathCount}</strong>
                  </span>
                  <span>
                    App Desktop: <strong className="text-zinc-700 dark:text-zinc-300">{pcDiscovery.desktopCount}</strong>
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={pcSearch}
                  onChange={(e) => setPcSearch(e.target.value)}
                  placeholder="Cerca programma, eseguibile o percorso (es. python, excel, git, curl...)"
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 pl-8 pr-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100"
                />
              </div>

              <select
                value={pcSourceFilter}
                onChange={(e) =>
                  setPcSourceFilter(
                    e.target.value as 'all' | 'builtin' | 'path' | 'desktop' | 'custom',
                  )
                }
                aria-label="Filtra per origine programma"
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1.5 text-xs"
              >
                <option value="all">Tutte le origini</option>
                <option value="builtin">Principali (Office, IDE, Shell...)</option>
                <option value="path">Utility nel PATH</option>
                <option value="desktop">Programmi desktop installati</option>
                <option value="custom">Aggiunti manualmente</option>
              </select>

              <label className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={pcOnlyAvailable}
                  onChange={(e) => setPcOnlyAvailable(e.target.checked)}
                  className="h-3.5 w-3.5 accent-indigo-600"
                />
                <span>Solo installati</span>
              </label>
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-zinc-200 dark:divide-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-800">
              {filteredPcTools.length === 0 ? (
                <div className="p-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
                  Nessun programma corrispondente ai filtri selezionati.
                </div>
              ) : (
                filteredPcTools.map((tool) => {
                  const allowed = isPcToolAuthorizedClient(tool, pcAccess);
                  const canToggleIndividually =
                    tool.available && (pcAccess.mode === 'custom' || pcAccess.mode === 'limited');
                  return (
                    <div
                      key={tool.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3.5 py-2.5 bg-zinc-50/40 dark:bg-zinc-950/30 text-xs"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {tool.name}
                          </span>
                          <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                            {tool.executable}
                          </span>
                          {tool.version && (
                            <span className="rounded bg-zinc-200/70 dark:bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-700 dark:text-zinc-300">
                              {tool.version}
                            </span>
                          )}
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              tool.available
                                ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                                : 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                            }`}
                          >
                            {tool.available ? 'Disponibile' : 'Non installato'}
                          </span>
                          <span className="text-[10px] text-zinc-400 uppercase">
                            {tool.source}
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                          {tool.path ? <span className="font-mono">{tool.path}</span> : tool.description}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {tool.source === 'custom' && (
                          <button
                            type="button"
                            onClick={() => void onDeleteCustomPcTool(tool.id)}
                            title="Rimuovi applicazione personalizzata"
                            className="rounded border border-red-200 dark:border-red-900/60 p-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {canToggleIndividually ? (
                          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={allowed}
                              onChange={() => void handleTogglePcTool(tool.id, allowed)}
                              className="h-4 w-4 accent-indigo-600"
                            />
                            <span
                              className={`text-[11px] font-medium ${
                                allowed
                                  ? 'text-emerald-700 dark:text-emerald-300'
                                  : 'text-zinc-500 dark:text-zinc-400'
                              }`}
                            >
                              {allowed ? 'Consentito' : 'Bloccato'}
                            </span>
                          </label>
                        ) : (
                          <span
                            className={`text-[11px] font-medium ${
                              allowed
                                ? 'text-emerald-700 dark:text-emerald-300'
                                : 'text-zinc-400 dark:text-zinc-500'
                            }`}
                          >
                            {!tool.available
                              ? 'Assente'
                              : pcAccess.mode === 'full'
                                ? 'Consentito (Completo)'
                                : 'Bloccato (Nessun accesso)'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Sistema estensibile: registra qualsiasi altra applicazione/CLI */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/30 p-4 space-y-3">
            <div>
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                Aggiungi altro programma o strumento CLI (sistema estensibile)
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                Se un software non è in PATH o si trova in una cartella personalizzata, registralo qui
                con il nome eseguibile o il percorso completo.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
              <input
                type="text"
                value={customAppName}
                onChange={(e) => setCustomAppName(e.target.value)}
                placeholder="Nome (es. LibreOffice, FFmpeg, 7-Zip)"
                className="sm:col-span-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-1.5 text-xs"
              />
              <input
                type="text"
                value={customAppExe}
                onChange={(e) => setCustomAppExe(e.target.value)}
                placeholder="Comando o percorso .exe (es. ffmpeg o C:\App\tool.exe)"
                className="sm:col-span-5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-1.5 text-xs font-mono"
              />
              <select
                value={customAppCategory}
                onChange={(e) => setCustomAppCategory(e.target.value as PcToolCategory)}
                aria-label="Categoria applicazione personalizzata"
                className="sm:col-span-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs"
              >
                <option value="cli">Utility CLI</option>
                <option value="desktop">App Desktop</option>
                <option value="terminal">Shell / Interprete</option>
                <option value="office">Office / Documenti</option>
                <option value="browser">Browser</option>
                <option value="ide">Editor / IDE</option>
                <option value="custom">Altro</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={customAppIsGui}
                  onChange={(e) => setCustomAppIsGui(e.target.checked)}
                  className="h-3.5 w-3.5 accent-indigo-600"
                />
                <span>Applicazione con interfaccia grafica (avvio desktop)</span>
              </label>

              <button
                type="button"
                disabled={addingCustomApp}
                onClick={() => void handleAddCustomToolSubmit()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                {addingCustomApp ? 'Verifica e aggiunta...' : 'Aggiungi applicazione'}
              </button>
            </div>

            {customAppError && (
              <p className="text-xs text-red-600 dark:text-red-400">{customAppError}</p>
            )}
          </div>
        </section>
      )}

      {/* Auto-Approve: Operazioni automatiche senza conferma */}
      {showAutoApprove && (
        <AutoApproveSection
          autoApprove={settings.autoApprove ?? getDefaultAutoApproveSettings()}
          pcAccessMode={pcAccess.mode}
          onUpdateAutoApprove={async (next) => {
            await onUpdateSettings({ autoApprove: next });
          }}
          onSwitchToPcTab={() => setActiveTab('pc')}
        />
      )}

      {/* AUTO / Smart Router & Fallback */}
      {showGeneral && (
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-6 space-y-5">
        <div>
          <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-white">
            AUTO / Smart Router &amp; Fallback
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Personalizza l&apos;ordine di priorità dei provider e il comportamento in caso di rate limit, timeout o quota esaurita.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 p-3.5 cursor-pointer">
            <div>
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                Modalità AUTO attiva
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Seleziona automaticamente il miglior provider/modello
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.smartRouter.enabled}
              onChange={(e) =>
                void onUpdateSettings({
                  smartRouter: { ...settings.smartRouter, enabled: e.target.checked },
                })
              }
              className="h-4 w-4 accent-blue-600"
            />
          </label>

          <label className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 p-3.5 cursor-pointer">
            <div>
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                Fallback automatico
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Passa al provider successivo su 429, 5xx o timeout
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.smartRouter.fallbackEnabled}
              onChange={(e) =>
                void onUpdateSettings({
                  smartRouter: {
                    ...settings.smartRouter,
                    fallbackEnabled: e.target.checked,
                  },
                })
              }
              className="h-4 w-4 accent-blue-600"
            />
          </label>

          <label className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 p-3.5 cursor-pointer">
            <div>
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                Dai priorità ai modelli gratuiti
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Preferisci Free e Free Tier rispetto a Paid
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.smartRouter.preferFree}
              onChange={(e) =>
                void onUpdateSettings({
                  smartRouter: { ...settings.smartRouter, preferFree: e.target.checked },
                })
              }
              className="h-4 w-4 accent-blue-600"
            />
          </label>

          <div className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 p-3.5">
            <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Task predefinito AUTO
            </span>
            <select
              value={settings.smartRouter.taskCategory}
              onChange={(e) =>
                void onUpdateSettings({
                  smartRouter: {
                    ...settings.smartRouter,
                    taskCategory: e.target.value as TaskCategory,
                  },
                })
              }
              className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1 text-xs font-medium"
            >
              {TASKS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 mb-2">
            Ordine di priorità provider (usato da AUTO e Fallback)
          </div>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            {orderedProviders.map((p, idx) => (
              <div
                key={p.id}
                className="flex items-center justify-between px-3.5 py-2 bg-zinc-50/50 dark:bg-zinc-950/40 text-xs"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono tabular-nums text-zinc-400 w-5">{idx + 1}.</span>
                  <ProviderIcon providerId={p.id} className="w-3.5 h-3.5" />
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{p.name}</span>
                  {!p.configured && (
                    <span className="text-[11px] text-zinc-400">(non configurato)</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => void movePriority(idx, -1)}
                    aria-label={`Sposta su ${p.name}`}
                    className="rounded border border-zinc-200 dark:border-zinc-800 p-1 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === orderedProviders.length - 1}
                    onClick={() => void movePriority(idx, 1)}
                    aria-label={`Sposta giù ${p.name}`}
                    className="rounded border border-zinc-200 dark:border-zinc-800 p-1 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      )}

      {/* System Prompt & Theme */}
      {showGeneral && (
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-6 space-y-4">
        <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-white">
          Preferenze generali
        </h2>

        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Istruzioni extra globali (opzionali)
          </label>
          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            Lingua, stile, efficienza operativa e regole di perimetro sono già gestiti
            dall&apos;agente attivo in Chat. Usa questo campo solo per eventuali aggiunte comuni
            a tutti gli agenti.
          </p>
          <textarea
            rows={3}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Lascia vuoto per applicare solo le istruzioni dell'agente selezionato..."
            className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => void onUpdateSettings({ systemPrompt })}
              className="rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3.5 py-1.5 text-xs font-semibold text-white dark:text-zinc-950 hover:opacity-90"
            >
              Salva istruzioni extra
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-zinc-200 dark:border-zinc-800">
          <div>
            <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Tema interfaccia
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Scegli tra Light Mode e Dark Mode
            </div>
          </div>
          <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 p-1 bg-zinc-100 dark:bg-zinc-950">
            <button
              type="button"
              onClick={() => void onUpdateSettings({ theme: 'light' })}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                settings.theme === 'light'
                  ? 'bg-white text-zinc-950 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              Light Mode
            </button>
            <button
              type="button"
              onClick={() => void onUpdateSettings({ theme: 'dark' })}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                settings.theme === 'dark'
                  ? 'bg-zinc-800 text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              Dark Mode
            </button>
          </div>
        </div>

        <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                Aggiornamenti catalogo provider e modelli
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Verifica nuovi provider e modelli su <span className="font-mono">providers-catalog.json</span> e chiedi sempre conferma prima di aggiornare.
              </div>
            </div>
            <button
              type="button"
              onClick={onCheckUpdates}
              disabled={checkingUpdates}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/70 px-3.5 py-2 text-xs font-semibold text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checkingUpdates ? 'animate-spin' : ''}`} />
              {checkingUpdates ? 'Ricerca in corso...' : 'Controlla aggiornamenti ora'}
            </button>
          </div>

          <label className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 p-3.5 cursor-pointer">
            <div>
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                Controlla e proponi aggiornamenti ad ogni accesso
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                All&apos;avvio verifica se esistono aggiornamenti e mostra il riepilogo per decidere se procedere.
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.autoUpdateCatalogOnLogin !== false}
              onChange={(e) =>
                void onUpdateSettings({ autoUpdateCatalogOnLogin: e.target.checked })
              }
              className="h-4 w-4 accent-blue-600 shrink-0"
            />
          </label>

          {catalogMeta && (
            <div className="flex flex-wrap items-center gap-4 text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
              <span>
                Provider nel catalogo JSON:{' '}
                <strong className="text-zinc-700 dark:text-zinc-300">
                  {catalogMeta.catalogProvidersCount}
                </strong>
              </span>
              {catalogMeta.lastCheckedAt && (
                <span>
                  Ultimo controllo:{' '}
                  <strong className="text-zinc-700 dark:text-zinc-300">
                    {new Date(catalogMeta.lastCheckedAt).toLocaleString('it-IT')}
                  </strong>
                </span>
              )}
              <span>
                Catalogo aggiornato il:{' '}
                <strong className="text-zinc-700 dark:text-zinc-300">
                  {new Date(catalogMeta.updatedAt).toLocaleString('it-IT')}
                </strong>
              </span>
            </div>
          )}
        </div>
      </section>
      )}

      {/* VS Code Integration: Kilo Code & Cline */}
      {showIntegrations && (
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center shrink-0">
            <Code2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-white">
              Integrazione VS Code (Kilo Code &amp; Cline)
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Collega le estensioni <strong>Kilo Code</strong> e <strong>Cline</strong> di Visual Studio Code
              direttamente a Free AI Hub tramite il gateway compatibile OpenAI integrato, sfruttando
              Smart Router <span className="font-mono">auto</span> e fallback automatico.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-2">
            <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              1. Endpoint Base URL (OpenAI Compatible)
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 text-xs font-mono text-zinc-800 dark:text-zinc-200">
                {typeof window !== 'undefined' ? `${window.location.origin}/v1` : '/v1'}
              </code>
              <button
                type="button"
                onClick={async () => {
                  const val = `${window.location.origin}/v1`;
                  await navigator.clipboard.writeText(val);
                  setCopiedField('baseUrl');
                  setTimeout(() => setCopiedField(null), 1600);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {copiedField === 'baseUrl' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                Copia
              </button>
            </div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Modelli consigliati in VS Code:{' '}
              <span className="font-mono text-zinc-700 dark:text-zinc-300">auto:coding</span>,{' '}
              <span className="font-mono text-zinc-700 dark:text-zinc-300">auto</span>,{' '}
              <span className="font-mono text-zinc-700 dark:text-zinc-300">auto:fast</span> oppure{' '}
              <span className="font-mono text-zinc-700 dark:text-zinc-300">&lt;provider&gt;/&lt;modelId&gt;</span>.
            </p>
          </div>

          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5" />
                2. Gateway API Key (per VS Code)
              </div>
            </div>

            {gateway.hasToken ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs rounded-md bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 text-zinc-800 dark:text-zinc-200">
                  {gateway.maskedToken}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await onCopyGatewayToken();
                    setCopiedField('token');
                    setTimeout(() => setCopiedField(null), 1600);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {copiedField === 'token' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  Copia Token
                </button>
                <button
                  type="button"
                  onClick={() => void onRevokeGatewayToken()}
                  title="Revoca token Gateway"
                  className="inline-flex items-center gap-1 rounded-md border border-red-200 dark:border-red-900/60 px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Revoca
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={generatingToken}
                onClick={async () => {
                  setGeneratingToken(true);
                  try {
                    await onGenerateGatewayToken();
                  } finally {
                    setGeneratingToken(false);
                  }
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <KeyRound className="w-3.5 h-3.5" />
                {generatingToken ? 'Generazione...' : 'Genera Gateway Token'}
              </button>
            )}
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Usa questo token come API Key nelle impostazioni OpenAI Compatible di Kilo Code e Cline.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-zinc-600 dark:text-zinc-400">
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 p-3.5 space-y-1">
            <div className="font-semibold text-zinc-900 dark:text-zinc-100">
              Setup rapido su Cline (VS Code)
            </div>
            <p>1. Apri impostazioni Cline → API Provider: <strong>OpenAI Compatible</strong>.</p>
            <p>2. Incolla il Base URL (<span className="font-mono">.../v1</span>) e il Gateway Token.</p>
            <p>3. Imposta Model ID su <span className="font-mono">auto:coding</span> o scegli un modello dalla lista.</p>
          </div>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 p-3.5 space-y-1">
            <div className="font-semibold text-zinc-900 dark:text-zinc-100">
              Setup rapido su Kilo Code (VS Code)
            </div>
            <p>1. Apri impostazioni Kilo Code → API Provider: <strong>OpenAI Compatible</strong>.</p>
            <p>2. Incolla il Base URL (<span className="font-mono">.../v1</span>) e il Gateway Token.</p>
            <p>3. Imposta Model ID su <span className="font-mono">auto:coding</span> (o usa Kilo Gateway tra i Providers).</p>
          </div>
        </div>
      </section>
      )}

      {/* Import / Export */}
      {showIntegrations && (
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-6 space-y-5">
        <div>
          <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-white">
            Import / Export Configurazione
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Per impostazione predefinita l&apos;esportazione esclude tutte le API key. Se desideri
            includere i segreti, il file viene cifrato con AES-256-GCM protetto da password.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
            <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Esporta configurazione
            </div>
            <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={includeSecrets}
                onChange={(e) => setIncludeSecrets(e.target.checked)}
                className="h-4 w-4 accent-blue-600"
              />
              Includi API key (backup cifrato protetto da password)
            </label>

            {includeSecrets && (
              <div>
                <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                  Password di cifratura (minimo 6 caratteri)
                </label>
                <div className="mt-1 relative">
                  <Lock className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-2.5" />
                  <input
                    type="password"
                    value={exportPassword}
                    onChange={(e) => setExportPassword(e.target.value)}
                    placeholder="Inserisci password sicura"
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 pl-8 pr-3 py-1.5 text-xs"
                  />
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={includeSecrets && exportPassword.length < 6}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              Esporta JSON
            </button>

            {exportStatus && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">{exportStatus}</p>
            )}
            {exportError && (
              <p className="text-xs text-red-600 dark:text-red-400">{exportError}</p>
            )}
          </div>

          <div className="space-y-3 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
            <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Importa configurazione
            </div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Carica un file esportato da Free AI Hub (standard o cifrato).
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={(e) => void handleFileChange(e)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3.5 py-2 text-xs font-semibold text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-700"
            >
              <Upload className="w-3.5 h-3.5" />
              Seleziona file JSON
            </button>

            {pendingImportBundle && (
              <div className="space-y-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
                  Backup cifrato rilevato: inserisci la password
                </div>
                <input
                  type="password"
                  value={importPassword}
                  onChange={(e) => setImportPassword(e.target.value)}
                  placeholder="Password backup"
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-1.5 text-xs"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleEncryptedImportConfirm()}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    Decifra e importa
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingImportBundle(null);
                      setImportPassword('');
                    }}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-xs"
                  >
                    Annulla
                  </button>
                </div>
              </div>
            )}

            {importStatus && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">{importStatus}</p>
            )}
            {importError && (
              <p className="text-xs text-red-600 dark:text-red-400">{importError}</p>
            )}
          </div>
        </div>
      </section>
      )}

      {/* Source Code Local Backup */}
      {showIntegrations && (
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center shrink-0">
              <Archive className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-white">
                Backup Locale dell&apos;Intero Codice del Portale
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Scarica un archivio ZIP completo con tutti i sorgenti (<span className="font-mono">src/</span>,{' '}
                <span className="font-mono">server/</span>, <span className="font-mono">public/</span>, configurazioni),
                chiedendo sempre conferma di percorso e nome file prima di salvare.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenSourceBackup}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
          >
            <Archive className="w-3.5 h-3.5" />
            Esegui backup codice ora
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 p-3.5 cursor-pointer">
            <div>
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                Abilita backup automatico del codice
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Quando scade l&apos;intervallo chiede conferma, percorso e nome file prima di procedere.
              </div>
            </div>
            <input
              type="checkbox"
              checked={sourceBackupCfg.autoEnabled}
              onChange={(e) =>
                void onUpdateSettings({
                  sourceBackup: {
                    ...sourceBackupCfg,
                    autoEnabled: e.target.checked,
                  },
                })
              }
              className="h-4 w-4 accent-blue-600 shrink-0"
            />
          </label>

          <div className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 p-3.5 gap-3">
            <div>
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                Frequenza backup automatico
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Intervallo dopo il quale proporre il backup
              </div>
            </div>
            <select
              value={String(sourceBackupCfg.intervalHours)}
              onChange={(e) =>
                void onUpdateSettings({
                  sourceBackup: {
                    ...sourceBackupCfg,
                    intervalHours: Number(e.target.value),
                  },
                })
              }
              className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1.5 text-xs font-medium"
            >
              <option value="0">Ad ogni accesso</option>
              <option value="24">Ogni 24 ore</option>
              <option value="168">Ogni 7 giorni</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Percorso locale predefinito
              </label>
              {supportsBackupDirectoryPicker() && !isEmbeddedIframe() && (
                <button
                  type="button"
                  onClick={async () => {
                    setBackupDirMsg(null);
                    try {
                      const res = await pickBackupDirectory();
                      setBackupDirInfo({ connected: true, folderName: res.folderName });
                      const nextPath = backupLocalPath.trim() || res.folderName;
                      setBackupLocalPath(nextPath);
                      await onUpdateSettings({
                        sourceBackup: {
                          ...sourceBackupCfg,
                          localPath: nextPath,
                        },
                      });
                    } catch (err) {
                      setBackupDirMsg(
                        err instanceof Error ? err.message : 'Selezione cartella annullata.',
                      );
                    }
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <FolderOpen className="w-3 h-3" />
                  Collega cartella PC
                </button>
              )}
            </div>
            <input
              type="text"
              value={backupLocalPath}
              onChange={(e) => setBackupLocalPath(e.target.value)}
              placeholder="es. C:\Backup\Free-AI-Hub o ~/Backups"
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-900 dark:text-zinc-100"
            />
            {backupDirInfo.connected && (
              <div className="flex items-center justify-between text-[11px] text-emerald-600 dark:text-emerald-400">
                <span>Cartella collegata: {backupDirInfo.folderName}</span>
                <button
                  type="button"
                  onClick={async () => {
                    await clearSavedBackupDirectory();
                    setBackupDirInfo({ connected: false });
                  }}
                  className="underline"
                >
                  Scollega
                </button>
              </div>
            )}
            {backupDirMsg && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">{backupDirMsg}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Prefisso nome file predefinito
            </label>
            <input
              type="text"
              value={backupPrefix}
              onChange={(e) => setBackupPrefix(e.target.value)}
              placeholder="free-ai-hub-source"
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-900 dark:text-zinc-100"
            />
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Alla creazione viene proposta la data corrente (es. <span className="font-mono">{backupPrefix || 'free-ai-hub-source'}-YYYY-MM-DD.zip</span>).
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-zinc-200 dark:border-zinc-800">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {sourceBackupCfg.lastBackupAt ? (
              <span>
                Ultimo backup:{' '}
                <strong className="text-zinc-700 dark:text-zinc-300">
                  {new Date(sourceBackupCfg.lastBackupAt).toLocaleString('it-IT')}
                </strong>
                {sourceBackupCfg.lastBackupFileName ? ` (${sourceBackupCfg.lastBackupFileName})` : ''}
              </span>
            ) : (
              <span>Nessun backup sorgente ancora eseguito.</span>
            )}
          </div>

          <button
            type="button"
            onClick={() =>
              void onUpdateSettings({
                sourceBackup: {
                  ...sourceBackupCfg,
                  localPath: backupLocalPath.trim(),
                  fileNamePrefix: backupPrefix.trim() || 'free-ai-hub-source',
                },
              })
            }
            className="rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3.5 py-1.5 text-xs font-semibold text-white dark:text-zinc-950 hover:opacity-90"
          >
            Salva percorso e nome predefiniti
          </button>
        </div>
      </section>
      )}
    </div>
  );
}
