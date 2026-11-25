import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  FolderOpen,
  Lock,
  Play,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  AutoApproveSettings,
  PcAccessSettings,
  PcDiscoverySnapshot,
  PcExecuteResult,
} from '../types/ai';
import {
  type ApprovalScope,
  type AutoApproveActionRiskLevel,
  evaluatePcAutoApprove,
  getDefaultAutoApproveSettings,
  isAutoApproveAllowedWithSession,
  isHighRiskPermissionKey,
} from '../utils/autoApprove';
import {
  isPcToolAuthorizedClient,
  type PcExecRequest,
} from '../utils/pcActions';

export interface PcActionDecision {
  status: 'pending' | 'approved' | 'rejected' | 'error';
  autoApproved?: boolean;
  approvalScope?: ApprovalScope | 'auto';
  message?: string;
  result?: PcExecuteResult;
}

export interface PcAuthorizeOptions {
  workingDirectoryOverride?: string;
  scope?: ApprovalScope;
  requiredPermissions?: string[];
  interactiveConsole?: boolean;
  ephemeralSecret?: string;
}

interface PcActionCardProps {
  action: PcExecRequest;
  pcAccess: PcAccessSettings;
  autoApprove?: AutoApproveSettings;
  agentReadOnly?: boolean;
  discovery: PcDiscoverySnapshot | null;
  isStreaming: boolean;
  requesterModel?: string;
  sessionAllowedPermissions?: Set<string> | string[];
  decision?: PcActionDecision;
  onAuthorizeExec: (action: PcExecRequest, options?: PcAuthorizeOptions) => Promise<void>;
  onReject: (actionId: string) => void;
  onOpenPcAccessSettings: () => void;
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

export function PcActionCard({
  action,
  pcAccess,
  autoApprove,
  agentReadOnly = false,
  discovery,
  isStreaming,
  requesterModel,
  sessionAllowedPermissions,
  decision,
  onAuthorizeExec,
  onReject,
  onOpenPcAccessSettings,
  onOpenAutoApproveSettings,
}: PcActionCardProps) {
  const [busyScope, setBusyScope] = useState<ApprovalScope | null>(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [cwdInput, setCwdInput] = useState(action.workingDirectory || '');
  const [interactiveConsole, setInteractiveConsole] = useState(true);
  const [ephemeralSecret, setEphemeralSecret] = useState('');

  const status = decision?.status ?? 'pending';
  const busy = busyScope !== null;

  const matchedTool = useMemo(() => {
    if (!discovery) return null;
    const ref = (action.toolId || action.toolQuery || '').trim().toLowerCase();
    if (!ref) return null;
    return (
      discovery.tools.find(
        (t) =>
          t.id.toLowerCase() === ref ||
          t.name.toLowerCase() === ref ||
          t.executable.toLowerCase() === ref ||
          t.executable.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase() === ref,
      ) ?? null
    );
  }, [discovery, action.toolId, action.toolQuery]);

  const isModeDisabled = pcAccess.mode === 'none';
  const isDynamicFullAllowed =
    !matchedTool &&
    (pcAccess.mode === 'full' || (pcAccess.mode === 'custom' && pcAccess.allowAllInstalled));
  const isToolAllowed = matchedTool
    ? isPcToolAuthorizedClient(matchedTool, pcAccess)
    : isDynamicFullAllowed;

  const toolLabel = matchedTool?.name || action.toolId || action.toolQuery || 'Strumento PC';
  const isGui = Boolean(matchedTool?.isGui);

  const resolvedCwd = cwdInput.trim() || action.workingDirectory;

  const autoApproveEval = useMemo(
    () =>
      evaluatePcAutoApprove(
        {
          toolId: action.toolId,
          toolQuery: action.toolQuery,
          command: action.command,
          script: action.script,
          workingDirectory: resolvedCwd,
        },
        matchedTool,
        autoApprove ?? getDefaultAutoApproveSettings(),
      ),
    [
      action.toolId,
      action.toolQuery,
      action.command,
      action.script,
      resolvedCwd,
      matchedTool,
      autoApprove,
    ],
  );

  const effectiveAutoApprove = useMemo(
    () =>
      isAutoApproveAllowedWithSession(autoApproveEval, sessionAllowedPermissions, {
        agentReadOnly,
        actionType: 'pc-exec',
      }),
    [autoApproveEval, sessionAllowedPermissions, agentReadOnly],
  );

  const hasHighRiskRequired = autoApproveEval.requiredPermissions.some(isHighRiskPermissionKey);
  const requiresManualConfirmation =
    (status === 'pending' || status === 'error') &&
    !isModeDisabled &&
    isToolAllowed &&
    !effectiveAutoApprove.allowed;

  const actualCommandDisplay = useMemo(() => {
    const parts: string[] = [];
    if (action.command?.trim()) parts.push(action.command.trim());
    if (action.script?.trim()) parts.push(action.script.trim());
    if (parts.length > 0) return parts.join('\n\n');
    if (matchedTool?.executable) return matchedTool.executable;
    return toolLabel;
  }, [action.command, action.script, matchedTool?.executable, toolLabel]);

  const effectiveDirectory =
    cwdInput.trim() || action.workingDirectory || 'Non specificata (richiesto percorso autorizzato)';
  const requesterLabel = requesterModel?.trim() || 'Assistente AI';

  const permissionsToGrant =
    autoApproveEval.blockedPermissions.length > 0
      ? autoApproveEval.blockedPermissions
      : autoApproveEval.requiredPermissions;

  const handleRun = async (scope: ApprovalScope = 'once') => {
    const secretToSend = ephemeralSecret.length > 0 ? ephemeralSecret : undefined;
    if (secretToSend) {
      setEphemeralSecret('');
    }
    setBusyScope(scope);
    try {
      await onAuthorizeExec(action, {
        workingDirectoryOverride: cwdInput.trim() || undefined,
        scope,
        requiredPermissions: permissionsToGrant,
        interactiveConsole:
          autoApproveEval.requiresInteractiveTerminal && !secretToSend
            ? interactiveConsole
            : undefined,
        ephemeralSecret: secretToSend,
      });
    } finally {
      setBusyScope(null);
    }
  };

  return (
    <div className="my-3 rounded-xl border border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/60 dark:bg-indigo-950/25 p-3.5 text-xs space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold text-indigo-950 dark:text-indigo-200">
          <Terminal className="w-4 h-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
          <span>
            {isGui
              ? `Richiesta avvio applicazione: ${toolLabel}`
              : `Richiesta esecuzione su PC: ${toolLabel}`}
          </span>
        </div>

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
              {decision?.result?.launchedGui ? 'Avviato' : 'Eseguito'}
            </span>
          )}
          {status === 'rejected' && (
            <span className="inline-flex items-center gap-1 rounded-md bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
              Negato
            </span>
          )}
        </div>
      </div>

      {action.reason && (
        <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed">{action.reason}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-400">
        <span className="rounded bg-white/80 dark:bg-zinc-950/80 border border-indigo-200/70 dark:border-indigo-900/50 px-2 py-0.5 font-mono text-zinc-900 dark:text-zinc-100">
          Tool: {matchedTool?.executable || action.toolId || action.toolQuery}
        </span>
        {matchedTool?.path && (
          <span className="font-mono truncate max-w-[340px]" title={matchedTool.path}>
            {matchedTool.path}
          </span>
        )}
        {matchedTool && !matchedTool.available && (
          <span className="text-red-600 dark:text-red-400 font-medium">
            Non installato su questo PC
          </span>
        )}
      </div>

      {/* When manual confirmation is NOT active (e.g. approved / rejected / disabled), keep collapsible command preview */}
      {!requiresManualConfirmation && (action.command || action.script) && (
        <div>
          <button
            type="button"
            onClick={() => setPreviewOpen((p) => !p)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:underline"
          >
            {previewOpen ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {previewOpen ? 'Nascondi comando / script' : 'Mostra comando / script'}
          </button>
          {previewOpen && (
            <pre className="mt-1.5 max-h-56 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-100 leading-relaxed whitespace-pre-wrap break-words">
              {actualCommandDisplay}
            </pre>
          )}
        </div>
      )}

      {decision?.message && (
        <div
          className={`flex items-start gap-1.5 text-[11px] font-medium ${
            status === 'error'
              ? 'text-red-600 dark:text-red-400'
              : 'text-emerald-700 dark:text-emerald-300'
          }`}
        >
          {status === 'error' && <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
          <span>{decision.message}</span>
        </div>
      )}

      {decision?.result && (decision.result.stdout || decision.result.stderr) && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">
            <span>
              Exit code: {decision.result.exitCode ?? '—'} · {decision.result.durationMs} ms
            </span>
          </div>
          {decision.result.stdout && (
            <pre className="max-h-52 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-950 p-2.5 font-mono text-[11px] text-emerald-300 whitespace-pre-wrap break-words">
              {decision.result.stdout}
            </pre>
          )}
          {decision.result.stderr && (
            <pre className="max-h-40 overflow-auto rounded-lg border border-red-900/60 bg-zinc-950 p-2.5 font-mono text-[11px] text-red-400 whitespace-pre-wrap break-words">
              {decision.result.stderr}
            </pre>
          )}
        </div>
      )}

      {(status === 'pending' || status === 'error') && (
        <div className="space-y-2.5 pt-1">
          {isModeDisabled || !isToolAllowed ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-full text-[11px] text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {isModeDisabled
                    ? 'Accesso alle risorse locali disattivato ("Nessun accesso").'
                    : matchedTool && !matchedTool.available
                      ? `Strumento "${matchedTool.name}" non rilevato come installato sul PC.`
                      : `Lo strumento "${toolLabel}" non è abilitato nel profilo attuale (${pcAccess.mode}).`}
                </span>
              </div>
              <button
                type="button"
                onClick={onOpenPcAccessSettings}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                <Settings2 className="w-3.5 h-3.5" />
                Impostazioni → Accesso al PC
              </button>
              <button
                type="button"
                disabled={busy || isStreaming}
                onClick={() => onReject(action.id)}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <X className="w-3.5 h-3.5" />
                Nega
              </button>
            </div>
          ) : requiresManualConfirmation ? (
            <div
              className={`rounded-xl border p-3.5 space-y-3 ${
                autoApproveEval.riskLevel === 'elevato'
                  ? 'border-red-300 dark:border-red-900/70 bg-red-50/80 dark:bg-red-950/30'
                  : 'border-amber-300 dark:border-amber-900/70 bg-white/90 dark:bg-zinc-950/80'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-sm text-zinc-950 dark:text-white">
                  {autoApproveEval.isAdminRequired ? (
                    <Lock className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" />
                  ) : autoApproveEval.riskLevel === 'elevato' ? (
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
                    className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
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
                    {autoApproveEval.operationLabel}
                  </span>
                </div>

                <div className="space-y-1">
                  <span className="block font-semibold text-zinc-600 dark:text-zinc-400">
                    Comando:
                  </span>
                  <pre className="max-h-56 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-100 leading-relaxed whitespace-pre-wrap break-words">
                    {actualCommandDisplay}
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
                    {effectiveDirectory}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-zinc-600 dark:text-zinc-400 min-w-[122px]">
                    Livello di rischio:
                  </span>
                  <span
                    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${riskBadgeStyle(
                      autoApproveEval.riskLevel,
                    )}`}
                  >
                    {autoApproveEval.riskLevel}
                  </span>
                  {autoApproveEval.isAdminRequired && (
                    <span className="text-[11px] font-medium text-red-700 dark:text-red-300">
                      (Privilegi amministrativi richiesti)
                    </span>
                  )}
                </div>
              </div>

              {agentReadOnly && (
                <div className="rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50/80 dark:bg-blue-950/40 px-3 py-2 text-[11px] text-blue-900 dark:text-blue-200">
                  <strong>Agente in sola lettura:</strong> l&apos;agente attivo è consultivo;
                  Auto-Approve e consenso di sessione sono disattivati per i comandi locali.
                </div>
              )}

              {autoApproveEval.missingWorkingDirectoryForMutation && (
                <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50/90 dark:bg-amber-950/40 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-200 flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                  <span>
                    <strong>Perimetro operativo richiesto:</strong> questo comando o script può
                    modificare file o installare componenti ma non indica una{' '}
                    <code className="font-mono">Directory (CWD)</code>. Inserisci qui sotto la
                    cartella autorizzata in cui eseguirlo prima di confermare.
                  </span>
                </div>
              )}

              {autoApproveEval.hasPlaintextCredentials && (
                <div className="rounded-lg border border-red-300 dark:border-red-900 bg-red-100/90 dark:bg-red-950/60 px-3 py-2 text-[11px] text-red-900 dark:text-red-200 flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
                  <span>
                    <strong>Attenzione credenziali in chiaro:</strong> nel comando o script sembra
                    presente una password o segreto esplicito. Per sicurezza le password vanno
                    inserite solo in modo interattivo e mascherato (es.{' '}
                    <code className="font-mono">Get-Credential</code> /{' '}
                    <code className="font-mono">Read-Host -AsSecureString</code>), mai in chiaro
                    nei comandi.
                  </span>
                </div>
              )}

              {autoApproveEval.requiresInteractiveTerminal && (
                <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/80 dark:bg-indigo-950/40 p-3 space-y-2 text-[11px] text-indigo-950 dark:text-indigo-200">
                  <div className="font-semibold flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span>Autenticazione / input interattivo rilevato</span>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={interactiveConsole && ephemeralSecret.length === 0}
                      disabled={ephemeralSecret.length > 0}
                      onChange={(e) => setInteractiveConsole(e.target.checked)}
                      className="rounded border-zinc-300 dark:border-zinc-700 text-indigo-600"
                    />
                    <span>
                      Apri console interattiva visibile su Windows (consigliato per{' '}
                      <code className="font-mono">Get-Credential</code>,{' '}
                      <code className="font-mono">az login</code>, ecc.)
                    </span>
                  </label>
                  <div className="space-y-1">
                    <span className="block text-[10px] text-indigo-800/90 dark:text-indigo-300/90">
                      Oppure inserisci password/segreto effimero su stdin (solo in RAM, mai salvato
                      in chat, log o file):
                    </span>
                    <input
                      type="password"
                      value={ephemeralSecret}
                      onChange={(e) => setEphemeralSecret(e.target.value)}
                      autoComplete="off"
                      placeholder="Lascia vuoto se usi la console visibile..."
                      className="w-full rounded-md border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-zinc-950 px-2.5 py-1 text-[11px] font-mono text-zinc-900 dark:text-zinc-100"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-0.5">
                <FolderOpen className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <input
                  type="text"
                  value={cwdInput}
                  onChange={(e) => setCwdInput(e.target.value)}
                  placeholder="Specifica directory autorizzata di esecuzione (consigliato)"
                  className="flex-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1 text-[11px] font-mono text-zinc-800 dark:text-zinc-200"
                />
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
                  onClick={() => void handleRun('once')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  {busyScope === 'once' ? 'Esecuzione...' : 'Consenti una volta'}
                </button>
                <button
                  type="button"
                  disabled={busy || isStreaming}
                  onClick={() => void handleRun('session')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 dark:border-indigo-800 bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {busyScope === 'session' ? 'Esecuzione...' : 'Consenti per questa sessione'}
                </button>
                <button
                  type="button"
                  disabled={busy || isStreaming}
                  onClick={() => void handleRun('always')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-900 dark:bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-white dark:text-zinc-950 hover:opacity-90 disabled:opacity-50"
                >
                  {busyScope === 'always'
                    ? 'Salvataggio...'
                    : 'Consenti sempre per questa operazione'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {hasHighRiskRequired && (
                <div className="w-full flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/20 px-2.5 py-1.5 text-[11px] text-red-800 dark:text-red-200">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-600 dark:text-red-400" />
                  <span>Operazione classificata a livello di rischio elevato.</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <FolderOpen className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <input
                  type="text"
                  value={cwdInput}
                  onChange={(e) => setCwdInput(e.target.value)}
                  placeholder="Cartella di lavoro (opzionale, default Home utente)"
                  className="flex-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1 text-[11px] font-mono text-zinc-800 dark:text-zinc-200"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy || isStreaming}
                  onClick={() => void handleRun('once')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  {busy
                    ? 'Esecuzione in corso...'
                    : isGui
                      ? 'Autorizza e avvia app'
                      : 'Autorizza ed esegui su PC'}
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}
