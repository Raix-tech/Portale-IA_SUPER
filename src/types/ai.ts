export type BuiltInProviderId =
  | 'openrouter'
  | 'gemini'
  | 'groq'
  | 'sambanova'
  | 'mistral'
  | 'cohere'
  | 'nvidia'
  | 'cloudflare'
  | 'kilo'
  | 'siliconflow'
  | 'zai'
  | 'pollinations';

export type ProviderId = BuiltInProviderId | (string & {});

export type ProviderStatusType =
  | 'online'
  | 'rate_limited'
  | 'error'
  | 'not_configured'
  | 'disabled';

export type ModelPricingTier = 'free' | 'free_tier' | 'paid' | 'unknown';

export type ModelCapability = 'text' | 'coding' | 'reasoning' | 'multimodal';

export type TaskCategory = 'general' | 'coding' | 'reasoning' | 'fast' | 'vision';

export type AIErrorCode =
  | 'MISSING_API_KEY'
  | 'INVALID_API_KEY'
  | 'HTTP_401'
  | 'HTTP_403'
  | 'HTTP_404'
  | 'HTTP_429'
  | 'QUOTA_EXHAUSTED'
  | 'HTTP_5XX'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'MODEL_UNAVAILABLE'
  | 'SAFETY_REFUSAL'
  | 'BAD_REQUEST'
  | 'UNKNOWN_ERROR';

export interface NormalizedAIError {
  code: AIErrorCode;
  httpStatus?: number;
  message: string;
  detail?: string;
  retryable: boolean;
  allowFallback: boolean;
  providerId: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  contextWindow?: number;
  pricingTier: ModelPricingTier;
  knownLimits?: string;
  supportsStreaming: boolean;
  supportsToolCalling?: boolean;
  capabilities: ModelCapability[];
  description?: string;
}

export interface PublicProviderKeyInfo {
  id: string;
  label: string;
  maskedApiKey: string;
  createdAt: string;
  active: boolean;
}

export interface PublicProviderConfig {
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
  configured: boolean;
  hasApiKey: boolean;
  maskedApiKey?: string;
  activeKeyId?: string;
  activeKeyLabel?: string;
  apiKeys: PublicProviderKeyInfo[];
  baseUrl?: string;
  defaultBaseUrl: string;
  customHeaderKeys: string[];
  chatEndpoint?: string;
  modelsEndpoint?: string;
  defaultModel?: string;
  status: ProviderStatusType;
  lastCheckedAt?: string;
  lastLatencyMs?: number;
  lastError?: NormalizedAIError;
  modelCount: number;
}

export interface FallbackAttempt {
  providerId: string;
  providerName: string;
  modelId: string;
  errorCode: AIErrorCode;
  message: string;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ChatAttachment {
  mimeType: string;
  dataBase64: string;
  name?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  attachments?: ChatAttachment[];
  providerId?: string;
  providerName?: string;
  modelId?: string;
  modelName?: string;
  fallbackUsed?: boolean;
  fallbackChain?: FallbackAttempt[];
  latencyMs?: number;
  usage?: TokenUsage;
  error?: NormalizedAIError;
  agentId?: string;
  agentName?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  copilotKind?: CopilotSessionMode;
  activeAgentId?: string;
  activeTaskCategory?: TaskCategory;
}

export interface SmartRouterConfig {
  enabled: boolean;
  taskCategory: TaskCategory;
  preferFree: boolean;
  fallbackEnabled: boolean;
  providerPriority: string[];
}

export interface SourceBackupSettings {
  autoEnabled: boolean;
  intervalHours: number;
  localPath: string;
  fileNamePrefix: string;
  lastBackupAt?: string;
  lastBackupFileName?: string;
}

export interface SourceBackupManifest {
  fileCount: number;
  totalBytes: number;
  files: Array<{ relativePath: string; size: number }>;
}

export type PcAccessMode = 'none' | 'limited' | 'custom' | 'full';

export type PcToolCategory =
  | 'terminal'
  | 'python'
  | 'node'
  | 'git'
  | 'ide'
  | 'office'
  | 'browser'
  | 'cli'
  | 'desktop'
  | 'custom';

export type PcToolCustomGroup =
  | 'powershell'
  | 'python'
  | 'office'
  | 'browser'
  | 'git'
  | 'vscode'
  | 'other';

export interface PcDiscoveredTool {
  id: string;
  name: string;
  category: PcToolCategory;
  customGroup: PcToolCustomGroup;
  executable: string;
  path?: string;
  source: 'builtin' | 'path' | 'desktop' | 'custom';
  available: boolean;
  version?: string;
  isGui?: boolean;
  supportsScripts?: boolean;
  description?: string;
}

export interface PcCustomToolDefinition {
  id: string;
  name: string;
  executable: string;
  category: PcToolCategory;
  isGui?: boolean;
  description?: string;
}

export interface PcAccessSettings {
  mode: PcAccessMode;
  allowAllInstalled: boolean;
  allowedGroups: Record<PcToolCustomGroup, boolean>;
  disabledToolIds: string[];
  enabledToolIds: string[];
  customTools: PcCustomToolDefinition[];
}

export interface PcDiscoverySnapshot {
  platform: string;
  hostname: string;
  scannedAt: string;
  tools: PcDiscoveredTool[];
  availableCount: number;
  pathCount: number;
  desktopCount: number;
}

export interface PcExecuteResult {
  ok: boolean;
  toolId: string;
  toolName: string;
  commandDisplay: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  launchedGui?: boolean;
  durationMs: number;
  error?: string;
}

export type AutoApproveProfileId =
  | 'safe'
  | 'dev'
  | 'automation'
  | 'full'
  | 'custom';

export type AutoApproveCategoryId =
  | 'filesAndFolders'
  | 'terminalAndCommands'
  | 'applications'
  | 'webAndBrowser'
  | 'softwareAndPackages'
  | 'processesAndSystem'
  | 'clipboardAndDesktop'
  | 'gitAndDev'
  | 'network';

export interface AutoApproveSettings {
  profile?: AutoApproveProfileId;
  filesAndFolders: {
    filesRead: boolean;
    filesCreate: boolean;
    filesModify: boolean;
    filesRename: boolean;
    filesMove: boolean;
    filesDelete: boolean;
    foldersCreate: boolean;
    foldersRead: boolean;
    foldersModify: boolean;
    foldersDelete: boolean;
    filesAndFoldersCopy: boolean;
    filesSearch: boolean;
    filesViewImages: boolean;
    filesReadPdf: boolean;
    filesOfficeDocs: boolean;
  };
  terminalAndCommands: {
    execPowerShell: boolean;
    execCmd: boolean;
    execWindowsTerminal: boolean;
    execPythonScript: boolean;
    execBatchScript: boolean;
    execPowerShellScript: boolean;
    execOtherCli: boolean;
    execGit: boolean;
    execNpmNpx: boolean;
    execAsAdmin: boolean;
  };
  applications: {
    appsLaunch: boolean;
    appsInteract: boolean;
    appsClose: boolean;
    appsOpenAssociatedFiles: boolean;
    appsUseOffice: boolean;
    appsWordFiles: boolean;
    appsExcelFiles: boolean;
    appsPowerPointFiles: boolean;
  };
  webAndBrowser: {
    webOpenBrowser: boolean;
    webOpenUrl: boolean;
    webSearchInternet: boolean;
    webReadPages: boolean;
    webDownloadFiles: boolean;
    webUploadFiles: boolean;
    webFillForms: boolean;
    webSubmitForms: boolean;
    webAutoLogin: boolean;
    webAuthenticatedAccounts: boolean;
  };
  softwareAndPackages: {
    pkgSearch: boolean;
    pkgDownloadInstaller: boolean;
    pkgInstallApps: boolean;
    pkgUninstallApps: boolean;
    pkgPipInstall: boolean;
    pkgNpmInstall: boolean;
    pkgProjectDeps: boolean;
    pkgModifyPathEnv: boolean;
    pkgModifySystemConfig: boolean;
  };
  processesAndSystem: {
    sysViewProcesses: boolean;
    sysStartProcesses: boolean;
    sysKillProcesses: boolean;
    sysReadHardwareSoftware: boolean;
    sysReadNonSensitiveEnv: boolean;
    sysModifyEnv: boolean;
    sysModifyRegistry: boolean;
    sysManageServices: boolean;
    sysModifyNetworkConfig: boolean;
    sysRebootShutdown: boolean;
  };
  clipboardAndDesktop: {
    desktopReadClipboard: boolean;
    desktopWriteClipboard: boolean;
    desktopMouseKeyboard: boolean;
    desktopGuiAutomation: boolean;
    desktopScreenshot: boolean;
    desktopReadScreen: boolean;
  };
  gitAndDev: {
    gitReadRepo: boolean;
    gitModifyRepo: boolean;
    gitCreateCommit: boolean;
    gitPushRemote: boolean;
    gitModifyRemoteBranch: boolean;
    gitDeleteBranch: boolean;
    devRunBuild: boolean;
    devRunTests: boolean;
    devInstallProjectDeps: boolean;
  };
  network: {
    netHttpRequests: boolean;
    netInternetAccess: boolean;
    netLocalNetworkAccess: boolean;
    netLanDevices: boolean;
    netStartLocalServers: boolean;
    netOpenPorts: boolean;
  };
}

export type AgentResponseStyle = 'conciso' | 'bilanciato' | 'dettagliato';

export interface AIAgent {
  id: string;
  name: string;
  role: string;
  description: string;
  isBuiltin?: boolean;
  isDefault?: boolean;
  language: string;
  responseStyle: AgentResponseStyle;
  preferredTaskCategory?: TaskCategory;
  modusOperandi: string;
  rules: string[];
  outputFormat?: string;
  readOnlyMode?: boolean;
  enforceEfficiencyPrinciple?: boolean;
  enforcePerimeterAndCredentials?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  theme: 'light' | 'dark';
  activeProviderId: string;
  activeModelId: string;
  smartRouter: SmartRouterConfig;
  systemPrompt: string;
  agents?: AIAgent[];
  defaultAgentId?: string;
  autoUpdateCatalogOnLogin?: boolean;
  sourceBackup?: SourceBackupSettings;
  pcAccess?: PcAccessSettings;
  autoApprove?: AutoApproveSettings;
}

export interface UsageRecord {
  id: string;
  timestamp: string;
  providerId: string;
  providerName: string;
  modelId: string;
  success: boolean;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  errorCode?: AIErrorCode;
  fallbackFrom?: string;
  taskCategory?: TaskCategory;
}

export interface GatewayStatus {
  hasToken: boolean;
  maskedToken?: string;
}

export interface CatalogMeta {
  schemaVersion: number;
  updatedAt: string;
  lastCheckedAt?: string;
  catalogProvidersCount: number;
}

export interface CatalogDiscoveredProvider {
  id: string;
  name: string;
  description: string;
  docsUrl: string;
  defaultBaseUrl: string;
  freeModelCount: number;
  totalModelCount: number;
  sampleFreeModels: string[];
}

export interface CatalogProviderUpdate {
  id: string;
  name: string;
  changes: string[];
}

export interface CatalogModelProviderDiff {
  providerId: string;
  providerName: string;
  added: number;
  updated: number;
  removed: number;
  total: number;
}

export interface CatalogUpdateCheckResult {
  hasUpdates: boolean;
  updateId?: string;
  checkedAt: string;
  trigger: 'manual' | 'auto';
  newProviders: CatalogDiscoveredProvider[];
  updatedProviders: CatalogProviderUpdate[];
  modelsSummary: {
    addedCount: number;
    updatedCount: number;
    removedCount: number;
    perProvider: CatalogModelProviderDiff[];
    sampleAddedNames: string[];
  };
  sourceWarnings: string[];
  catalog: CatalogMeta;
}

export interface CatalogApplyResult {
  providers: PublicProviderConfig[];
  models: ModelInfo[];
  settings: AppSettings;
  catalog: CatalogMeta;
  appliedProvidersCount: number;
  appliedModelsCount: number;
  message: string;
}

export interface BootstrapPayload {
  providers: PublicProviderConfig[];
  settings: AppSettings;
  models: ModelInfo[];
  usageLogs: UsageRecord[];
  chatSessions: ChatSession[];
  gateway: GatewayStatus;
  catalog?: CatalogMeta;
}

export interface ConnectionTestResult {
  ok: boolean;
  status: ProviderStatusType;
  latencyMs: number;
  message: string;
  error?: NormalizedAIError;
  modelCount?: number;
}

export interface ExportBundle {
  format: 'free-ai-hub-backup';
  version: 1;
  encrypted: boolean;
  exportedAt: string;
  data?: {
    settings: AppSettings;
    providers: Array<{
      id: string;
      name: string;
      kind: 'builtin' | 'custom';
      description: string;
      docsUrl: string;
      keyPlaceholder: string;
      requiresAccountId?: boolean;
      accountId?: string;
      enabled: boolean;
      baseUrl?: string;
      defaultBaseUrl: string;
      chatEndpoint?: string;
      modelsEndpoint?: string;
      defaultModel?: string;
    }>;
  };
  encryptedPayload?: {
    salt: string;
    iv: string;
    tag: string;
    ciphertext: string;
  };
}

export type CopilotMode = 'm365' | 'github';

export type CopilotSessionMode = 'chat' | 'cowork';

export interface CopilotLicenseStatus {
  checked: boolean;
  checkedAt?: string;
  copilotChatEnabled: boolean;
  coworkEnabled: boolean;
  licenseTierLabel: string;
  coworkReason: string;
  detectedPlans: string[];
}

export interface CopilotModelInfo {
  id: string;
  name: string;
  vendor?: string;
  capabilities?: string[];
  pricingTier?: ModelPricingTier;
}

export interface CopilotPublicStatus {
  mode: CopilotMode;
  m365: {
    connected: boolean;
    tenantId: string;
    clientId: string;
    hasEnvClientId: boolean;
    hasEnvClientSecret: boolean;
    accountName?: string;
    accountEmail?: string;
    expiresAt?: string;
    license?: CopilotLicenseStatus;
  };
  github: {
    connected: boolean;
    enterpriseUrl: string;
    clientId: string;
    hasEnvClientId: boolean;
    hasEnvClientSecret: boolean;
    accountLogin?: string;
    accountName?: string;
    selectedModelId: string;
    models: CopilotModelInfo[];
    license?: CopilotLicenseStatus;
  };
  sessions: ChatSession[];
}

