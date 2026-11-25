import type {
  AutoApproveSettings,
  PcAccessSettings,
  PcDiscoveredTool,
  PcDiscoverySnapshot,
} from '../types/ai';
import { buildAutoApprovePromptSummary } from './autoApprove';
import {
  parseWorkspaceActions,
  type WorkspaceActionSegment,
} from './workspaceActions';

export interface PcExecRequest {
  type: 'pc-exec';
  id: string;
  toolId?: string;
  toolQuery?: string;
  command?: string;
  script?: string;
  workingDirectory?: string;
  reason?: string;
}

export type CombinedChatSegment = WorkspaceActionSegment | PcExecRequest;

export function getDefaultPcAccessClient(): PcAccessSettings {
  return {
    mode: 'none',
    allowAllInstalled: false,
    allowedGroups: {
      powershell: false,
      python: false,
      office: false,
      browser: false,
      git: false,
      vscode: false,
      other: false,
    },
    disabledToolIds: [],
    enabledToolIds: [],
    customTools: [],
  };
}

const LIMITED_SAFE_TOOL_IDS = new Set([
  'git',
  'vscode',
  'windows-terminal',
  'ms-word',
  'ms-excel',
  'ms-powerpoint',
  'ms-outlook',
  'ms-access',
  'ms-edge',
  'chrome',
  'firefox',
]);

export function isPcToolAuthorizedClient(
  tool: PcDiscoveredTool,
  pcAccess?: PcAccessSettings,
): boolean {
  if (!tool.available || !pcAccess || pcAccess.mode === 'none') return false;
  if (pcAccess.mode === 'full') return true;
  if (pcAccess.disabledToolIds.includes(tool.id)) return false;

  if (pcAccess.mode === 'limited') {
    if (pcAccess.enabledToolIds.includes(tool.id)) return true;
    return (
      LIMITED_SAFE_TOOL_IDS.has(tool.id) ||
      tool.category === 'browser' ||
      tool.category === 'ide'
    );
  }

  if (pcAccess.enabledToolIds.includes(tool.id)) return true;
  if (pcAccess.allowAllInstalled) return true;
  return Boolean(pcAccess.allowedGroups[tool.customGroup]);
}

function parsePcExecBlock(raw: string, id: string): PcExecRequest | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        toolId?: string;
        tool?: string;
        executable?: string;
        command?: string;
        script?: string;
        workingDirectory?: string;
        cwd?: string;
        reason?: string;
      };
      const toolRef = parsed.toolId || parsed.tool || parsed.executable;
      if (toolRef && (parsed.command || parsed.script || parsed.toolId || parsed.tool)) {
        return {
          type: 'pc-exec',
          id,
          toolId: typeof parsed.toolId === 'string' ? parsed.toolId.trim() : undefined,
          toolQuery:
            typeof toolRef === 'string' ? toolRef.trim() : undefined,
          command: typeof parsed.command === 'string' ? parsed.command.trim() : undefined,
          script: typeof parsed.script === 'string' ? parsed.script : undefined,
          workingDirectory:
            typeof (parsed.workingDirectory || parsed.cwd) === 'string'
              ? (parsed.workingDirectory || parsed.cwd)!.trim()
              : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason.trim() : undefined,
        };
      }
    } catch {
      // Fall through to line parser
    }
  }

  let headerPart = raw;
  let script: string | undefined;
  const scriptMarker = raw.match(/\r?\n---SCRIPT---\r?\n/);
  if (scriptMarker && scriptMarker.index !== undefined) {
    headerPart = raw.slice(0, scriptMarker.index);
    script = raw.slice(scriptMarker.index + scriptMarker[0].length);
  }

  let toolRef = '';
  let command = '';
  let workingDirectory = '';
  let reason = '';

  for (const line of headerPart.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    const toolMatch = l.match(/^(?:TOOL|APP|PROGRAM)\s*:\s*(.+)$/i);
    if (toolMatch) {
      toolRef = toolMatch[1].trim().replace(/^["'`]|["'`]$/g, '');
      continue;
    }
    const cmdMatch = l.match(/^(?:COMMAND|CMD|ARGS)\s*:\s*(.+)$/i);
    if (cmdMatch) {
      command = cmdMatch[1].trim();
      continue;
    }
    const cwdMatch = l.match(/^(?:CWD|WORKDIR|DIR)\s*:\s*(.+)$/i);
    if (cwdMatch) {
      workingDirectory = cwdMatch[1].trim().replace(/^["'`]|["'`]$/g, '');
      continue;
    }
    const reasonMatch = l.match(/^REASON\s*:\s*(.+)$/i);
    if (reasonMatch) {
      reason = reasonMatch[1].trim();
    }
  }

  if (!toolRef && !command) return null;
  return {
    type: 'pc-exec',
    id,
    toolId: toolRef || undefined,
    toolQuery: toolRef || undefined,
    command: command || undefined,
    script: script && script.trim() ? script : undefined,
    workingDirectory: workingDirectory || undefined,
    reason: reason || undefined,
  };
}

export function parseAllChatActions(
  messageId: string,
  markdownText: string,
): CombinedChatSegment[] {
  if (!markdownText.includes('aihub-pc-exec')) {
    return parseWorkspaceActions(messageId, markdownText);
  }

  const regex =
    /(`{3,4})aihub-pc-exec[ \t]*\r?\n([\s\S]*?)\r?\n\1(?=[ \t]*(?:\r?\n|$))/g;
  const result: CombinedChatSegment[] = [];
  let lastIndex = 0;
  let pcIdx = 0;
  let match: RegExpExecArray | null;

  const pushMarkdownWithWorkspace = (chunk: string, chunkIdx: number) => {
    if (!chunk.trim()) return;
    const subSegments = parseWorkspaceActions(`${messageId}:ws${chunkIdx}`, chunk);
    result.push(...subSegments);
  };

  let chunkIdx = 0;
  while ((match = regex.exec(markdownText)) !== null) {
    const [fullMatch, , body] = match;
    if (match.index > lastIndex) {
      pushMarkdownWithWorkspace(markdownText.slice(lastIndex, match.index), chunkIdx++);
    }
    const parsed = parsePcExecBlock(body, `${messageId}:pc:${pcIdx++}`);
    if (parsed) {
      result.push(parsed);
    } else {
      result.push({ type: 'markdown', content: fullMatch });
    }
    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < markdownText.length) {
    pushMarkdownWithWorkspace(markdownText.slice(lastIndex), chunkIdx++);
  }

  return result.length > 0 ? result : [{ type: 'markdown', content: markdownText }];
}

export function buildPcToolsSystemPrompt(
  pcAccess?: PcAccessSettings,
  discovery?: PcDiscoverySnapshot | null,
  autoApprove?: AutoApproveSettings,
  agentReadOnly = false,
): string {
  const cfg = pcAccess ?? getDefaultPcAccessClient();
  if (cfg.mode === 'none') {
    return [
      '[ACCESSO AL PC LOCALE DISATTIVATO]',
      'L’utente ha impostato "Nessun accesso" alle applicazioni locali in Impostazioni → Accesso al PC.',
      'Non proporre blocchi aihub-pc-exec. Se l’utente chiede di eseguire programmi, comandi o script sul proprio computer, informalo che deve prima abilitare i permessi in Impostazioni → Accesso al PC.',
    ].join('\n');
  }

  const tools = discovery?.tools ?? [];
  const authorized = tools.filter((t) => isPcToolAuthorizedClient(t, cfg));
  const builtinAuth = authorized.filter((t) => t.source === 'builtin' || t.source === 'custom');
  const otherAuth = authorized.filter((t) => t.source === 'path' || t.source === 'desktop');

  const modeLabel =
    cfg.mode === 'full'
      ? 'Accesso completo'
      : cfg.mode === 'custom'
        ? 'Accesso personalizzato'
        : 'Accesso limitato';

  const toolLines = [
    ...builtinAuth.map(
      (t) =>
        `- ${t.id} (${t.name}${t.version ? ` · ${t.version}` : ''}) [${t.isGui ? 'App GUI' : 'CLI'}${t.supportsScripts ? ', supporta script' : ''}]`,
    ),
    ...otherAuth.slice(0, 60).map(
      (t) => `- ${t.id} (${t.name} · ${t.executable}) [${t.isGui ? 'App Desktop' : 'CLI PATH'}]`,
    ),
  ];

  return [
    `[ACCESSO ALLE RISORSE LOCALI DEL PC — MODALITÀ: ${modeLabel.toUpperCase()}]`,
    `Sistema rilevato: ${discovery?.platform || 'locale'} (host: ${discovery?.hostname || 'pc'}).`,
    `Strumenti e applicazioni autorizzati dall’utente (${authorized.length} totali disponibili):`,
    toolLines.length > 0
      ? toolLines.join('\n')
      : '- Nessuno strumento disponibile/abilitato nella configurazione corrente.',
    otherAuth.length > 60
      ? `... e altre ${otherAuth.length - 60} utility CLI / applicazioni desktop rilevate.`
      : '',
    '',
    buildAutoApprovePromptSummary(autoApprove, agentReadOnly),
    '',
    'Regole operative OBBLIGATORIE per usare programmi, shell o script sul PC:',
    '1. NON fingere mai di aver eseguito qualcosa prima che la card sia approvata (manualmente o tramite Auto-Approve).',
    agentReadOnly
      ? '1b. L’agente attivo è in MODALITÀ SOLA LETTURA: limita le proposte a letture/ispezioni non distruttive; qualsiasi comando locale o scrittura richiederà conferma esplicita.'
      : '',
    '2. Quando l’utente chiede un’operazione reale sul computer (eseguire un comando PowerShell/CMD/Python/Node/Git, avviare Word/Excel/PowerPoint/Outlook/Access/Browser/VS Code o un tool CLI), proponi un blocco esatto `aihub-pc-exec`:',
    '```aihub-pc-exec',
    'TOOL: <id strumento es. powershell, python, git, vscode, ms-excel, chrome, o nome eseguibile>',
    'COMMAND: <argomenti o comando a riga singola (opzionale per app GUI)>',
    'CWD: <percorso cartella autorizzata (obbligatorio se il comando crea/modifica/installa file o esegue script)>',
    'REASON: <spiegazione breve in italiano per l’utente>',
    '```',
    '3. Per script multi-riga (PowerShell, Python, Batch, Node.js, Bash) usa `---SCRIPT---`:',
    '```aihub-pc-exec',
    'TOOL: python',
    'CWD: <percorso cartella autorizzata>',
    'REASON: Esegui script Python locale',
    '---SCRIPT---',
    'print("ciao")',
    '```',
    '4. Dopo l’esecuzione (automatica via Auto-Approve o manuale) riceverai stdout, stderr e exit code nel messaggio successivo: analizza l’output reale prima di proseguire.',
  ]
    .filter(Boolean)
    .join('\n');
}
