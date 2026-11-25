import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  FilePenLine,
  FileSearch,
  FolderOpen,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { checkWorkspaceFileExists } from '../services/localWorkspace';
import type { AutoApproveSettings } from '../types/ai';
import {
  type ApprovalScope,
  type AutoApproveActionRiskLevel,
  evaluateWorkspaceReadAutoApprove,
  evaluateWorkspaceWriteAutoApprove,
  getDefaultAutoApproveSettings,
  isAutoApproveAllowedWithSession,
} from '../utils/autoApprove';
import type {
  WorkspaceConnectRequest,
  WorkspaceReadRequest,
  WorkspaceWriteRequest,
} from '../utils/workspaceActions';

export interface WorkspaceActionDecision {
  status: 'pending' | 'approved' | 'rejected' | 'error';
  autoApproved?: boolean;
  approvalScope?: ApprovalScope | 'auto';
  message?: string;
}

export interface WorkspaceAuthorizeOptions {
  scope?: ApprovalScope;
  requiredPermissions?: string[];
}

interface WorkspaceActionCardProps {
  action: WorkspaceConnectRequest | WorkspaceReadRequest | WorkspaceWriteRequest;
  workspaceConnected: boolean;
  workspaceNeedsPermission?: boolean;
  workspaceFolderName?: string;
  autoApprove?: AutoApproveSettings;
  agentReadOnly?: boolean;
  isStreaming: boolean;
  requesterModel?: string;
  sessionAllowedPermissions?: Set<string> | string[];
  decision?: WorkspaceActionDecision;
  onAuthorizeConnect?: (action: WorkspaceConnectRequest) => Promise<void>;
  onAuthorizeRead: (
    action: WorkspaceReadRequest,
    options?: WorkspaceAuthorizeOptions,
  ) => Promise<void>;
  onAuthorizeWrite: (
    action: WorkspaceWriteRequest,
    options?: WorkspaceAuthorizeOptions,
  ) => Promise<void>;
  onReject: (actionId: string) => void;
  onAuthorizeFolder: () => Promise<void>;
  onOpenAutoApproveSettings?: () => void;
}

function riskBadgeStyle(level: AutoApproveActionRiskLevel): string {
  if (level === 'elevato') {
    return 'border-red-300 dark:border-red-900/70 bg-red-100 dark:bg-red-950/70 text-red-800 dark:text-red-300';
  }
  if (level === 'medio') {
    return 'border-amber-300 dark:border-amber-800 bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300';
  }
  return 'border-emerald-300 dark:border-emerald-800 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300';
}

function getRelativeDir(workspaceFolderName: string | undefined, filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const idx = normalized.lastIndexOf('/');
  const subDir = idx > 0 ? normalized.slice(0, idx) : '';
  if (workspaceFolderName && subDir) return `${workspaceFolderName}/${subDir}`;
  if (workspaceFolderName) return workspaceFolderName;
  if (subDir) return subDir;
  return 'Cartella locale autorizzata';
}

export function WorkspaceActionCard({
  action,
  workspaceConnected,
  workspaceNeedsPermission,
  workspaceFolderName,
  autoApprove,
  agentReadOnly = false,
  isStreaming,
  requesterModel,
  sessionAllowedPermissions,
  decision,
  onAuthorizeConnect,
  onAuthorizeRead,
  onAuthorizeWrite,
  onReject,
  onAuthorizeFolder,
  onOpenAutoApproveSettings,
}: WorkspaceActionCardProps) {
  const [busyScope, setBusyScope] = useState<ApprovalScope | null>(null);
  const [previewOpen, setPreviewOpen] = useState(action.type === 'write');
  const [existingContent, setExistingContent] = useState<string | null | undefined>(undefined);

  const status = decision?.status ?? 'pending';
  const busy = busyScope !== null;
  const requesterLabel = requesterModel?.trim() || 'Assistente AI';

  useEffect(() => {
    if (action.type !== 'write' || !workspaceConnected) {
      setExistingContent(undefined);
      return;
    }
    let active = true;
    checkWorkspaceFileExists(action.path).then((res) => {
      if (active) setExistingContent(res);
    });
    return () => {
      active = false;
    };
  }, [action, workspaceConnected]);

  const handleApprove = async (
    scope: ApprovalScope = 'once',
    requiredPermissions?: string[],
  ) => {
    setBusyScope(scope);
    try {
      if (action.type === 'connect') {
        if (onAuthorizeConnect) {
          await onAuthorizeConnect(action);
        } else {
          await onAuthorizeFolder();
        }
      } else if (action.type === 'read') {
        await onAuthorizeRead(action, { scope, requiredPermissions });
      } else {
        await onAuthorizeWrite(action, { scope, requiredPermissions });
      }
    } finally {
      setBusyScope(null);
    }
  };

  const renderScopeBadges = (approvedLabel: string) => (
    <div className="flex items-center gap-1.5 shrink-0">
      {status === 'approved' && (decision?.approvalScope === 'auto' || decision?.autoApproved) && (
        <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 dark:bg-blue-950/60 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:text-blue-300">
          <ShieldCheck className="w-3 h-3" />
          Auto-approvato
        </span>
      )}
      {status === 'approved' && decision?.approvalScope === 'session' && (
        <span className="inline-flex items-center gap-1 rounded-md bg-indigo-100 dark:bg-indigo-950/60 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
          <ShieldCheck className="w-3 h-3" />
          Consentito (sessione)
        </span>
      )}
      {status === 'approved' && decision?.approvalScope === 'always' && (
        <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 dark:bg-blue-950/60 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:text-blue-300">
          <ShieldCheck className="w-3 h-3" />
          Consentito sempre
        </span>
      )}
      {status === 'approved' && decision?.approvalScope === 'once' && (
        <span className="inline-flex items-center gap-1 rounded-md bg-zinc-200/80 dark:bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
          Consentito una volta
        </span>
      )}
      {status === 'approved' && (
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
          <Check className="w-3 h-3" />
          {approvedLabel}
        </span>
      )}
      {status === 'rejected' && (
        <span className="inline-flex items-center gap-1 rounded-md bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
          Negato
        </span>
      )}
    </div>
  );

  if (action.type === 'connect') {
    return (
      <div className="my-3 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/20 p-3.5 text-xs space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold text-blue-900 dark:text-blue-200">
            <FolderOpen className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <span>
              {workspaceNeedsPermission && workspaceFolderName
                ? `Riattivazione permesso cartella "${workspaceFolderName}"`
                : 'Autorizzazione cartella locale sul PC'}
            </span>
          </div>
          {status === 'approved' && (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 shrink-0">
              <Check className="w-3 h-3" />
              Cartella collegata
            </span>
          )}
          {status === 'rejected' && (
            <span className="inline-flex items-center gap-1 rounded-md bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:text-zinc-300 shrink-0">
              Negato
            </span>
          )}
        </div>

        {action.reason && (
          <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed">{action.reason}</p>
        )}

        {decision?.message && (
          <div
            className={`text-[11px] font-medium ${
              status === 'error'
                ? 'text-red-600 dark:text-red-400'
                : 'text-emerald-700 dark:text-emerald-300'
            }`}
          >
            {decision.message}
          </div>
        )}

        {(status === 'pending' || status === 'error') && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={busy || isStreaming}
              onClick={() => void handleApprove('once')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              {busy
                ? 'Autorizzazione...'
                : workspaceNeedsPermission && workspaceFolderName
                  ? `Riattiva cartella "${workspaceFolderName}"`
                  : 'Seleziona e autorizza cartella PC'}
            </button>
            <button
              type="button"
              disabled={busy || isStreaming}
              onClick={() => onReject(action.id)}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
            >
              <X className="w-3.5 h-3.5" />
              Nega
            </button>
          </div>
        )}
      </div>
    );
  }

  if (action.type === 'read') {
    const readEval = evaluateWorkspaceReadAutoApprove(
      action.paths,
      autoApprove ?? getDefaultAutoApproveSettings(),
    );
    const effectiveRead = isAutoApproveAllowedWithSession(readEval, sessionAllowedPermissions);
    const requiresManualConfirmation =
      workspaceConnected && (status === 'pending' || status === 'error') && !effectiveRead.allowed;
    const readPermissions =
      readEval.blockedPermissions.length > 0
        ? readEval.blockedPermissions
        : readEval.requiredPermissions;
    const readCommandDisplay = action.paths.map((p) => `READ ${p}`).join('\n');
    const readDirectory =
      action.paths.length === 1
        ? getRelativeDir(workspaceFolderName, action.paths[0])
        : workspaceFolderName || 'Cartella locale autorizzata';

    return (
      <div className="my-3 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/20 p-3.5 text-xs space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold text-blue-900 dark:text-blue-200">
            <FileSearch className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <span>Richiesta autorizzazione lettura file dal PC</span>
          </div>
          {renderScopeBadges('Autorizzato')}
        </div>

        {action.reason && (
          <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed">{action.reason}</p>
        )}

        {!requiresManualConfirmation && (
          <div className="space-y-1">
            {action.paths.map((p) => (
              <div
                key={p}
                className="rounded-md border border-blue-200/80 dark:border-blue-900/50 bg-white/80 dark:bg-zinc-950/70 px-2.5 py-1 font-mono text-[11px] text-zinc-900 dark:text-zinc-100 break-all"
              >
                {p}
              </div>
            ))}
          </div>
        )}

        {decision?.message && (
          <div
            className={`text-[11px] font-medium ${
              status === 'error'
                ? 'text-red-600 dark:text-red-400'
                : 'text-emerald-700 dark:text-emerald-300'
            }`}
          >
            {decision.message}
          </div>
        )}

        {(status === 'pending' || status === 'error') && (
          <div className="pt-1">
            {!workspaceConnected ? (
              <button
                type="button"
                onClick={() => void onAuthorizeFolder()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Autorizza prima la cartella PC
              </button>
            ) : requiresManualConfirmation ? (
              <div
                className={`rounded-xl border p-3.5 space-y-3 ${
                  readEval.riskLevel === 'elevato'
                    ? 'border-red-300 dark:border-red-900/70 bg-red-50/80 dark:bg-red-950/30'
                    : 'border-amber-300 dark:border-amber-900/70 bg-white/90 dark:bg-zinc-950/80'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold text-sm text-zinc-950 dark:text-white">
                    {readEval.riskLevel === 'elevato' ? (
                      <AlertTriangle className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" />
                    ) : (
                      <ShieldAlert className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    )}
                    <span>L&apos;AI vuole eseguire questa operazione</span>
                  </div>
                  {onOpenAutoApproveSettings && (
                    <button
                      type="button"
                      onClick={onOpenAutoApproveSettings}
                      className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                    >
                      Configura Auto-Approve
                    </button>
                  )}
                </div>

                <div className="grid gap-1.5 text-xs">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="font-semibold text-zinc-600 dark:text-zinc-400 min-w-[122px]">
                      Operazione:
                    </span>
                    <span className="font-medium text-zinc-950 dark:text-zinc-100">
                      {readEval.operationLabel}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <span className="block font-semibold text-zinc-600 dark:text-zinc-400">
                      Comando:
                    </span>
                    <pre className="max-h-48 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-100 leading-relaxed whitespace-pre-wrap break-words">
                      {readCommandDisplay}
                    </pre>
                  </div>

                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="font-semibold text-zinc-600 dark:text-zinc-400 min-w-[122px]">
                      AI richiedente:
                    </span>
                    <span className="font-mono text-[11px] text-zinc-900 dark:text-zinc-100">
                      {requesterLabel}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-zinc-600 dark:text-zinc-400 min-w-[122px]">
                      Directory:
                    </span>
                    <span className="font-mono text-[11px] text-zinc-900 dark:text-zinc-100 break-all">
                      {readDirectory}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-zinc-600 dark:text-zinc-400 min-w-[122px]">
                      Livello di rischio:
                    </span>
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${riskBadgeStyle(
                        readEval.riskLevel,
                      )}`}
                    >
                      {readEval.riskLevel}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={busy || isStreaming}
                    onClick={() => onReject(action.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 dark:border-red-900/70 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5" />
                    Nega
                  </button>
                  <button
                    type="button"
                    disabled={busy || isStreaming}
                    onClick={() => void handleApprove('once', readPermissions)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {busyScope === 'once' ? 'Lettura...' : 'Consenti una volta'}
                  </button>
                  <button
                    type="button"
                    disabled={busy || isStreaming}
                    onClick={() => void handleApprove('session', readPermissions)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 dark:border-indigo-800 bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {busyScope === 'session' ? 'Lettura...' : 'Consenti per questa sessione'}
                  </button>
                  <button
                    type="button"
                    disabled={busy || isStreaming}
                    onClick={() => void handleApprove('always', readPermissions)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-900 dark:bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-white dark:text-zinc-950 hover:opacity-90 disabled:opacity-50"
                  >
                    {busyScope === 'always'
                      ? 'Salvataggio...'
                      : 'Consenti sempre per questa operazione'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy || isStreaming}
                  onClick={() => void handleApprove('once', readPermissions)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  {busy ? 'Lettura...' : "Autorizza lettura e invia all'AI"}
                </button>
                <button
                  type="button"
                  disabled={busy || isStreaming}
                  onClick={() => onReject(action.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" />
                  Nega
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Write request card
  const isModify = typeof existingContent === 'string';
  const lineCount = action.content.split(/\r?\n/).length;
  const writeEval =
    existingContent === undefined
      ? null
      : evaluateWorkspaceWriteAutoApprove(
          action.path,
          isModify,
          autoApprove ?? getDefaultAutoApproveSettings(),
        );
  const effectiveWrite = writeEval
    ? isAutoApproveAllowedWithSession(writeEval, sessionAllowedPermissions, {
        agentReadOnly,
        actionType: 'write',
      })
    : null;
  const requiresManualWriteConfirmation =
    workspaceConnected &&
    (status === 'pending' || status === 'error') &&
    writeEval !== null &&
    effectiveWrite !== null &&
    !effectiveWrite.allowed;
  const writePermissions = writeEval
    ? writeEval.blockedPermissions.length > 0
      ? writeEval.blockedPermissions
      : writeEval.requiredPermissions
    : [];
  const writeDirectory = getRelativeDir(workspaceFolderName, action.path);

  return (
    <div className="my-3 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 p-3.5 text-xs space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold text-amber-950 dark:text-amber-200">
          <FilePenLine className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            {existingContent === undefined
              ? 'Proposta scrittura file su PC'
              : isModify
                ? 'Proposta modifica file esistente su PC'
                : 'Proposta creazione nuovo file su PC'}
          </span>
        </div>

        {renderScopeBadges('Scritto su PC')}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200/80 dark:border-amber-900/50 bg-white/80 dark:bg-zinc-950/70 px-2.5 py-1.5">
        <span className="font-mono text-[11px] text-zinc-900 dark:text-zinc-100 break-all">
          {action.path}
        </span>
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400 tabular-nums shrink-0">
          {lineCount} righe · {action.content.length} caratteri
        </span>
      </div>

      {action.reason && (
        <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed">{action.reason}</p>
      )}

      {!requiresManualWriteConfirmation && (
        <div>
          <button
            type="button"
            onClick={() => setPreviewOpen((prev) => !prev)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:underline"
          >
            {previewOpen ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {previewOpen ? 'Nascondi anteprima contenuto' : 'Mostra anteprima contenuto'}
          </button>

          {previewOpen && (
            <pre className="mt-2 max-h-60 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-100 leading-relaxed whitespace-pre-wrap break-words">
              {action.content}
            </pre>
          )}
        </div>
      )}

      {decision?.message && (
        <div
          className={`flex items-center gap-1.5 text-[11px] font-medium ${
            status === 'error'
              ? 'text-red-600 dark:text-red-400'
              : 'text-emerald-700 dark:text-emerald-300'
          }`}
        >
          {status === 'error' && <ShieldAlert className="w-3.5 h-3.5 shrink-0" />}
          <span>{decision.message}</span>
        </div>
      )}

      {(status === 'pending' || status === 'error') && (
        <div className="pt-1">
          {!workspaceConnected ? (
            <button
              type="button"
              onClick={() => void onAuthorizeFolder()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Autorizza prima la cartella PC
            </button>
          ) : requiresManualWriteConfirmation && writeEval ? (
            <div
              className={`rounded-xl border p-3.5 space-y-3 ${
                writeEval.riskLevel === 'elevato'
                  ? 'border-red-300 dark:border-red-900/70 bg-red-50/80 dark:bg-red-950/30'
                  : 'border-amber-300 dark:border-amber-900/70 bg-white/90 dark:bg-zinc-950/80'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-sm text-zinc-950 dark:text-white">
                  {writeEval.riskLevel === 'elevato' ? (
                    <AlertTriangle className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  )}
                  <span>L&apos;AI vuole eseguire questa operazione</span>
                </div>
                {onOpenAutoApproveSettings && (
                  <button
                    type="button"
                    onClick={onOpenAutoApproveSettings}
                    className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:underline whitespace-nowrap"
                  >
                    Configura Auto-Approve
                  </button>
                )}
              </div>

              {agentReadOnly && (
                <div className="rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50/80 dark:bg-blue-950/40 px-3 py-2 text-[11px] text-blue-900 dark:text-blue-200">
                  <strong>Agente in sola lettura:</strong> questo agente è configurato in modalità
                  consultiva. Auto-Approve e consenso di sessione sono disattivati per le scritture
                  su disco.
                </div>
              )}

              <div className="grid gap-1.5 text-xs">
                <div className="flex flex-wrap items-baseline gap-1.5">
                  <span className="font-semibold text-zinc-600 dark:text-zinc-400 min-w-[122px]">
                    Operazione:
                  </span>
                  <span className="font-medium text-zinc-950 dark:text-zinc-100">
                    {writeEval.operationLabel}
                  </span>
                </div>

                <div className="space-y-1">
                  <span className="block font-semibold text-zinc-600 dark:text-zinc-400">
                    Comando:
                  </span>
                  <pre className="max-h-60 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-100 leading-relaxed whitespace-pre-wrap break-words">
                    {`${isModify ? 'WRITE (modifica)' : 'WRITE (nuovo file)'}: ${action.path}\n\n${action.content}`}
                  </pre>
                </div>

                <div className="flex flex-wrap items-baseline gap-1.5">
                  <span className="font-semibold text-zinc-600 dark:text-zinc-400 min-w-[122px]">
                    AI richiedente:
                  </span>
                  <span className="font-mono text-[11px] text-zinc-900 dark:text-zinc-100">
                    {requesterLabel}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-zinc-600 dark:text-zinc-400 min-w-[122px]">
                    Directory:
                  </span>
                  <span className="font-mono text-[11px] text-zinc-900 dark:text-zinc-100 break-all">
                    {writeDirectory}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-zinc-600 dark:text-zinc-400 min-w-[122px]">
                    Livello di rischio:
                  </span>
                  <span
                    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${riskBadgeStyle(
                      writeEval.riskLevel,
                    )}`}
                  >
                    {writeEval.riskLevel}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy || isStreaming}
                  onClick={() => onReject(action.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 dark:border-red-900/70 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" />
                  Nega
                </button>
                <button
                  type="button"
                  disabled={busy || isStreaming}
                  onClick={() => void handleApprove('once', writePermissions)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  {busyScope === 'once' ? 'Scrittura...' : 'Consenti una volta'}
                </button>
                <button
                  type="button"
                  disabled={busy || isStreaming}
                  onClick={() => void handleApprove('session', writePermissions)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 dark:border-indigo-800 bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {busyScope === 'session' ? 'Scrittura...' : 'Consenti per questa sessione'}
                </button>
                <button
                  type="button"
                  disabled={busy || isStreaming}
                  onClick={() => void handleApprove('always', writePermissions)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-900 dark:bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-white dark:text-zinc-950 hover:opacity-90 disabled:opacity-50"
                >
                  {busyScope === 'always'
                    ? 'Salvataggio...'
                    : 'Consenti sempre per questa operazione'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy || isStreaming}
                onClick={() => void handleApprove('once', writePermissions)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                {busy ? 'Scrittura...' : 'Autorizza e scrivi su PC'}
              </button>
              <button
                type="button"
                disabled={busy || isStreaming}
                onClick={() => onReject(action.id)}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" />
                Nega
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
