import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  Gauge,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AgentResponseStyle, AIAgent, AppSettings, TaskCategory } from '../types/ai';
import {
  buildAgentSystemPrompt,
  DEFAULT_AGENT_ID,
  getDefaultBuiltInAgents,
  OPERATIONAL_EFFICIENCY_PRINCIPLE_PROMPT,
  OPERATIONAL_PERIMETER_SECURITY_PROMPT,
  sanitizeAgentsSettings,
} from '../utils/agents';

interface AgentsPageProps {
  settings: AppSettings;
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<void>;
  onUseAgentInChat: (agentId: string) => void;
}

const LANGUAGE_PRESETS = [
  'Italiano',
  'English',
  'Auto (lingua utente)',
  'Español',
  'Français',
  'Deutsch',
];

const RESPONSE_STYLES: Array<{ id: AgentResponseStyle; label: string; hint: string }> = [
  { id: 'conciso', label: 'Conciso', hint: 'Diretto ed essenziale, zero preamboli' },
  { id: 'bilanciato', label: 'Bilanciato', hint: 'Equilibrio tra sintesi e dettagli' },
  { id: 'dettagliato', label: 'Dettagliato', hint: 'Analisi approfondita e opzioni' },
];

const TASK_CATEGORY_OPTIONS: Array<{ id: '' | TaskCategory; label: string }> = [
  { id: '', label: 'Nessuna preferenza (usa scelta chat)' },
  { id: 'coding', label: 'Coding' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'general', label: 'General' },
  { id: 'fast', label: 'Fast' },
  { id: 'vision', label: 'Vision' },
];

const QUICK_RULE_SUGGESTIONS = [
  'Verifica sempre i file reali con aihub-read prima di modificare o proporre comandi.',
  'Non inventare percorsi file, API, pacchetti o output non osservati.',
  'Segnala chiaramente eventuali operazioni a rischio medio/alto prima di eseguirle.',
  'Mantieni le modifiche minime, pulite e coerenti con lo stack del progetto.',
  'In caso di ambiguità, elenca 2 opzioni concrete prima di procedere.',
];

function createEmptyAgentDraft(): AIAgent {
  const now = new Date().toISOString();
  return {
    id: `agent-${crypto.randomUUID().slice(0, 8)}`,
    name: '',
    role: 'Assistente Specializzato',
    description: '',
    isBuiltin: false,
    isDefault: false,
    language: 'Italiano',
    responseStyle: 'bilanciato',
    preferredTaskCategory: undefined,
    modusOperandi:
      '1. Analizza attentamente la richiesta e il contesto disponibile.\n2. Segui un approccio ordinato e verificabile prima di proporre modifiche.\n3. Concludi con passi chiari e controlli pratici.',
    rules: [
      'Rispondi nella lingua configurata con tono professionale e chiaro.',
      'Non fare supposizioni non verificate su file o configurazioni.',
    ],
    outputFormat: '',
    readOnlyMode: false,
    enforceEfficiencyPrinciple: true,
    enforcePerimeterAndCredentials: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function AgentsPage({
  settings,
  onUpdateSettings,
  onUseAgentInChat,
}: AgentsPageProps) {
  const { agents, defaultAgentId } = useMemo(
    () => sanitizeAgentsSettings(settings.agents, settings.defaultAgentId),
    [settings.agents, settings.defaultAgentId],
  );

  const [editingAgent, setEditingAgent] = useState<AIAgent | null>(null);
  const [isNewAgent, setIsNewAgent] = useState(false);
  const [makeDefaultOnSave, setMakeDefaultOnSave] = useState(false);
  const [newRuleText, setNewRuleText] = useState('');
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [showEfficiencyDetails, setShowEfficiencyDetails] = useState(false);
  const [showPerimeterDetails, setShowPerimeterDetails] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmResetBuiltins, setConfirmResetBuiltins] = useState(false);

  const openCreateModal = () => {
    setEditingAgent(createEmptyAgentDraft());
    setIsNewAgent(true);
    setMakeDefaultOnSave(false);
    setNewRuleText('');
    setShowPromptPreview(false);
    setFormError(null);
  };

  const openEditModal = (agent: AIAgent) => {
    setEditingAgent({
      ...agent,
      rules: [...agent.rules],
    });
    setIsNewAgent(false);
    setMakeDefaultOnSave(agent.id === defaultAgentId);
    setNewRuleText('');
    setShowPromptPreview(false);
    setFormError(null);
  };

  const handleDuplicate = (agent: AIAgent) => {
    const now = new Date().toISOString();
    setEditingAgent({
      ...agent,
      id: `agent-${crypto.randomUUID().slice(0, 8)}`,
      name: `${agent.name} (Copia)`,
      isBuiltin: false,
      isDefault: false,
      rules: [...agent.rules],
      createdAt: now,
      updatedAt: now,
    });
    setIsNewAgent(true);
    setMakeDefaultOnSave(false);
    setNewRuleText('');
    setShowPromptPreview(false);
    setFormError(null);
  };

  const handleSaveEditor = async () => {
    if (!editingAgent) return;
    const trimmedName = editingAgent.name.trim();
    if (!trimmedName) {
      setFormError('Inserisci un nome per l’agente.');
      return;
    }
    if (!editingAgent.modusOperandi.trim() && editingAgent.rules.length === 0) {
      setFormError('Inserisci almeno il Modus Operandi o una regola comportamentale.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const now = new Date().toISOString();
      const cleanedAgent: AIAgent = {
        ...editingAgent,
        name: trimmedName,
        role: editingAgent.role.trim() || 'Assistente AI',
        description: editingAgent.description.trim(),
        language: editingAgent.language.trim() || 'Italiano',
        modusOperandi: editingAgent.modusOperandi.trim(),
        rules: editingAgent.rules.map((r) => r.trim()).filter(Boolean),
        outputFormat: editingAgent.outputFormat?.trim() || undefined,
        updatedAt: now,
      };

      const exists = agents.some((a) => a.id === cleanedAgent.id);
      const nextList = exists
        ? agents.map((a) => (a.id === cleanedAgent.id ? cleanedAgent : a))
        : [...agents, cleanedAgent];

      const nextDefaultId = makeDefaultOnSave ? cleanedAgent.id : defaultAgentId;
      const sanitized = sanitizeAgentsSettings(nextList, nextDefaultId);
      await onUpdateSettings({
        agents: sanitized.agents,
        defaultAgentId: sanitized.defaultAgentId,
      });
      setEditingAgent(null);
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (agentId: string) => {
    const sanitized = sanitizeAgentsSettings(agents, agentId);
    await onUpdateSettings({
      agents: sanitized.agents,
      defaultAgentId: sanitized.defaultAgentId,
    });
  };

  const handleDeleteAgent = async (agent: AIAgent) => {
    if (agent.id === DEFAULT_AGENT_ID) return;
    const remaining = agents.filter((a) => a.id !== agent.id);
    const nextDefault = defaultAgentId === agent.id ? DEFAULT_AGENT_ID : defaultAgentId;
    const sanitized = sanitizeAgentsSettings(remaining, nextDefault);
    await onUpdateSettings({
      agents: sanitized.agents,
      defaultAgentId: sanitized.defaultAgentId,
    });
  };

  const handleRestoreBuiltins = async () => {
    const builtins = getDefaultBuiltInAgents();
    const builtinIds = new Set(builtins.map((b) => b.id));
    const customAgents = agents.filter((a) => !builtinIds.has(a.id));
    const merged = [...builtins, ...customAgents];
    const sanitized = sanitizeAgentsSettings(merged, defaultAgentId);
    await onUpdateSettings({
      agents: sanitized.agents,
      defaultAgentId: sanitized.defaultAgentId,
    });
    setConfirmResetBuiltins(false);
  };

  const handleAddRule = (text?: string) => {
    if (!editingAgent) return;
    const candidate = (text ?? newRuleText).trim();
    if (!candidate) return;
    if (!editingAgent.rules.includes(candidate)) {
      setEditingAgent({
        ...editingAgent,
        rules: [...editingAgent.rules, candidate],
      });
    }
    if (!text) setNewRuleText('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-950 dark:text-white flex items-center gap-2.5">
            <Bot className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            Agenti &amp; Modus Operandi
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Definisci istruzioni operative di base (lingua, stile, modus operandi e regole
            comportamentali) da applicare ai modelli in Chat come in VS Code / Cline.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {confirmResetBuiltins ? (
            <div className="inline-flex items-center gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-1.5 text-xs">
              <span className="text-amber-800 dark:text-amber-300 font-medium">
                Ripristinare i {getDefaultBuiltInAgents().length} agenti di sistema?
              </span>
              <button
                type="button"
                onClick={() => void handleRestoreBuiltins()}
                className="rounded bg-amber-600 px-2 py-0.5 font-semibold text-white hover:bg-amber-700"
              >
                Conferma
              </button>
              <button
                type="button"
                onClick={() => setConfirmResetBuiltins(false)}
                className="rounded border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 text-zinc-700 dark:text-zinc-300"
              >
                Annulla
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmResetBuiltins(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Ripristina predefiniti
            </button>
          )}

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nuovo agente
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-blue-200/80 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-950/20 px-4 py-3 text-xs text-blue-900 dark:text-blue-200 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <span>
            Ogni volta che invii un messaggio in <strong>Chat</strong>, l&apos;agente selezionato
            inietta automaticamente lingua, ruolo, modus operandi e regole sopra le istruzioni
            globali e gli strumenti PC/cartella.
          </span>
        </div>
        <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-white/80 dark:bg-zinc-900/80 border border-blue-200 dark:border-blue-800">
          {agents.length} agenti configurati
        </span>
      </div>

      {/* Operational Efficiency Principle Banner */}
      <div className="rounded-xl border border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/20 px-4 py-3 text-xs text-emerald-950 dark:text-emerald-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>
              <strong>Principio di massima efficienza operativa:</strong> massima qualità utile,
              minimo spreco, percorso più efficiente (equilibrio tra accuratezza, velocità,
              operazioni e token/crediti).
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowEfficiencyDetails((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-300 dark:border-emerald-800 bg-white/80 dark:bg-zinc-900/80 px-2.5 py-1 text-[11px] font-medium text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/70 dark:hover:bg-emerald-900/40"
          >
            {showEfficiencyDetails ? (
              <>
                Nascondi dettagli
                <ChevronUp className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                Linee guida incluse
                <ChevronDown className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
        {showEfficiencyDetails && (
          <pre className="mt-3 rounded-lg border border-emerald-200 dark:border-emerald-900/70 bg-white/90 dark:bg-zinc-950/90 p-3 text-[11px] font-mono text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed">
            {OPERATIONAL_EFFICIENCY_PRINCIPLE_PROMPT}
          </pre>
        )}
      </div>

      {/* Operational Perimeter, Filesystem, Installations & Credentials Banner */}
      <div className="rounded-xl border border-amber-200/80 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3 text-xs text-amber-950 dark:text-amber-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              <strong>Perimetro operativo, filesystem, installazioni e credenziali:</strong>{' '}
              nessuna scrittura/file temporaneo fuori dal perimetro autorizzato, stop se il
              percorso non è definito e zero password in chiaro in chat, comandi o script.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowPerimeterDetails((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-md border border-amber-300 dark:border-amber-800 bg-white/80 dark:bg-zinc-900/80 px-2.5 py-1 text-[11px] font-medium text-amber-900 dark:text-amber-300 hover:bg-amber-100/70 dark:hover:bg-amber-900/40"
          >
            {showPerimeterDetails ? (
              <>
                Nascondi dettagli
                <ChevronUp className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                Regole perimetro
                <ChevronDown className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
        {showPerimeterDetails && (
          <pre className="mt-3 rounded-lg border border-amber-200 dark:border-amber-900/70 bg-white/90 dark:bg-zinc-950/90 p-3 text-[11px] font-mono text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed">
            {OPERATIONAL_PERIMETER_SECURITY_PROMPT}
          </pre>
        )}
      </div>

      {/* Agents Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {agents.map((agent) => {
          const isDefault = agent.id === defaultAgentId;
          const isProjectCore = agent.id === DEFAULT_AGENT_ID;
          return (
            <div
              key={agent.id}
              className={`rounded-xl border p-5 flex flex-col justify-between gap-4 transition-colors ${
                isDefault
                  ? 'border-blue-300 dark:border-blue-800 bg-white dark:bg-zinc-900 shadow-xs'
                  : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-base font-bold text-zinc-950 dark:text-white truncate">
                        {agent.name}
                      </h2>
                      {isDefault && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                          <Star className="w-2.5 h-2.5 fill-current" />
                          Predefinito
                        </span>
                      )}
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-medium border ${
                          agent.isBuiltin
                            ? 'border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                            : 'border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                        }`}
                      >
                        {agent.isBuiltin ? 'Sistema' : 'Personalizzato'}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mt-0.5">
                      {agent.role}
                    </p>
                  </div>
                </div>

                {agent.description && (
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    {agent.description}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2 py-0.5 text-zinc-700 dark:text-zinc-300">
                    Lingua: <strong>{agent.language}</strong>
                  </span>
                  <span className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2 py-0.5 text-zinc-700 dark:text-zinc-300 capitalize">
                    Stile: <strong>{agent.responseStyle}</strong>
                  </span>
                  {agent.preferredTaskCategory && (
                    <span className="rounded-md border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 text-emerald-700 dark:text-emerald-300 capitalize">
                      Router: <strong>{agent.preferredTaskCategory}</strong>
                    </span>
                  )}
                  <span className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2 py-0.5 text-zinc-500 dark:text-zinc-400">
                    {agent.rules.length} regole
                  </span>
                  {agent.readOnlyMode && (
                    <span className="rounded-md border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/30 px-2 py-0.5 text-blue-700 dark:text-blue-300 font-medium">
                      Sola lettura
                    </span>
                  )}
                  {agent.enforceEfficiencyPrinciple !== false && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">
                      <Gauge className="w-3 h-3" />
                      Efficienza operativa
                    </span>
                  )}
                  {agent.enforcePerimeterAndCredentials !== false && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 text-amber-800 dark:text-amber-300">
                      <ShieldCheck className="w-3 h-3" />
                      Perimetro &amp; Credenziali
                    </span>
                  )}
                </div>

                {agent.modusOperandi && (
                  <div className="rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                      Modus Operandi
                    </div>
                    <p className="text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-line line-clamp-4 font-mono leading-relaxed">
                      {agent.modusOperandi}
                    </p>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onUseAgentInChat(agent.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-white dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Usa in Chat
                  </button>
                  {!isDefault && (
                    <button
                      type="button"
                      onClick={() => void handleSetDefault(agent.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                      <Star className="w-3.5 h-3.5" />
                      Imposta predefinito
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEditModal(agent)}
                    title="Modifica agente"
                    className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Modifica
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDuplicate(agent)}
                    title="Duplica come nuovo agente personalizzato"
                    className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-1.5 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  {!isProjectCore && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteAgent(agent)}
                      title="Elimina agente"
                      className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-1.5 text-zinc-500 hover:text-red-600 hover:border-red-300 dark:hover:border-red-900 transition-colors"
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

      {/* Create / Edit Agent Modal */}
      {editingAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                <h2 className="font-display text-base font-bold text-zinc-950 dark:text-white">
                  {isNewAgent ? 'Nuovo Agente AI' : `Modifica: ${editingAgent.name}`}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setEditingAgent(null)}
                className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                aria-label="Chiudi editor agente"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {formError && (
                <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
                    Nome agente *
                  </label>
                  <input
                    type="text"
                    value={editingAgent.name}
                    onChange={(e) =>
                      setEditingAgent({ ...editingAgent, name: e.target.value })
                    }
                    placeholder="Es. Architetto Frontend, Revisore Sicurezza..."
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
                    Ruolo operativo
                  </label>
                  <input
                    type="text"
                    value={editingAgent.role}
                    onChange={(e) =>
                      setEditingAgent({ ...editingAgent, role: e.target.value })
                    }
                    placeholder="Es. Senior Full-Stack Developer"
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
                  Descrizione breve (quando usarlo)
                </label>
                <input
                  type="text"
                  value={editingAgent.description}
                  onChange={(e) =>
                    setEditingAgent({ ...editingAgent, description: e.target.value })
                  }
                  placeholder="Spiega in una riga in quale occasione selezionare questo agente"
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              {/* Language & Response Style & Preferred Task */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
                    Lingua delle risposte
                  </label>
                  <input
                    type="text"
                    value={editingAgent.language}
                    onChange={(e) =>
                      setEditingAgent({ ...editingAgent, language: e.target.value })
                    }
                    placeholder="Italiano"
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {LANGUAGE_PRESETS.map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        onClick={() =>
                          setEditingAgent({ ...editingAgent, language: lang })
                        }
                        className={`rounded px-1.5 py-0.5 text-[10px] border transition-colors ${
                          editingAgent.language === lang
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900'
                        }`}
                      >
                        {lang}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
                    Stile di risposta
                  </label>
                  <div className="space-y-1.5">
                    {RESPONSE_STYLES.map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() =>
                          setEditingAgent({ ...editingAgent, responseStyle: st.id })
                        }
                        className={`w-full text-left rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                          editingAgent.responseStyle === st.id
                            ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200'
                            : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300'
                        }`}
                      >
                        <div className="font-semibold">{st.label}</div>
                        <div className="text-[10px] opacity-80">{st.hint}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
                    Categoria Smart Router
                  </label>
                  <select
                    value={editingAgent.preferredTaskCategory ?? ''}
                    onChange={(e) =>
                      setEditingAgent({
                        ...editingAgent,
                        preferredTaskCategory: (e.target.value || undefined) as
                          | TaskCategory
                          | undefined,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-2 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {TASK_CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt.id || 'none'} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    Usata come indicazione automatica quando lo Smart Router è attivo.
                  </p>
                </div>
              </div>

              {/* Modus Operandi */}
              <div>
                <label className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
                  Modus Operandi (flusso di lavoro che il modello deve seguire)
                </label>
                <textarea
                  rows={5}
                  value={editingAgent.modusOperandi}
                  onChange={(e) =>
                    setEditingAgent({ ...editingAgent, modusOperandi: e.target.value })
                  }
                  placeholder="1. Analizza prima i file reali...&#10;2. Spiega l'impatto...&#10;3. Esegui la modifica e verifica..."
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              {/* Behavioral Rules */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  Regole comportamentali ({editingAgent.rules.length})
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newRuleText}
                    onChange={(e) => setNewRuleText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddRule();
                      }
                    }}
                    placeholder="Aggiungi una regola precisa e premi Invio..."
                    className="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddRule()}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  >
                    Aggiungi
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {QUICK_RULE_SUGGESTIONS.map((sugg) => (
                    <button
                      key={sugg}
                      type="button"
                      onClick={() => handleAddRule(sugg)}
                      className="rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-600 dark:text-zinc-400 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    >
                      + {sugg.slice(0, 56)}…
                    </button>
                  ))}
                </div>

                {editingAgent.rules.length > 0 && (
                  <ul className="space-y-1.5">
                    {editingAgent.rules.map((rule, idx) => (
                      <li
                        key={`${idx}-${rule.slice(0, 12)}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 text-xs text-zinc-800 dark:text-zinc-200"
                      >
                        <span className="flex-1">{rule}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setEditingAgent({
                              ...editingAgent,
                              rules: editingAgent.rules.filter((_, i) => i !== idx),
                            })
                          }
                          className="text-zinc-400 hover:text-red-600 p-0.5"
                          aria-label="Rimuovi regola"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Expected Output Format */}
              <div>
                <label className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
                  Formato output atteso (opzionale)
                </label>
                <input
                  type="text"
                  value={editingAgent.outputFormat ?? ''}
                  onChange={(e) =>
                    setEditingAgent({ ...editingAgent, outputFormat: e.target.value })
                  }
                  placeholder="Es. Elenco sintetico modifiche -> Codice completo -> Comandi di verifica"
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-start gap-2 text-xs font-medium text-zinc-800 dark:text-zinc-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(editingAgent.readOnlyMode)}
                    onChange={(e) =>
                      setEditingAgent({
                        ...editingAgent,
                        readOnlyMode: e.target.checked,
                      })
                    }
                    className="mt-0.5 rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-600"
                  />
                  <span>
                    <strong className="text-blue-700 dark:text-blue-400">
                      Modalità sola lettura (consultiva)
                    </strong>{' '}
                    <span className="block text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                      Sospende automaticamente Auto-Approve e consenso di sessione per scritture file e comandi locali su PC (richiede conferma esplicita).
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-2 text-xs font-medium text-zinc-800 dark:text-zinc-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingAgent.enforceEfficiencyPrinciple !== false}
                    onChange={(e) =>
                      setEditingAgent({
                        ...editingAgent,
                        enforceEfficiencyPrinciple: e.target.checked,
                      })
                    }
                    className="mt-0.5 rounded border-zinc-300 dark:border-zinc-700 text-emerald-600 focus:ring-emerald-600"
                  />
                  <span>
                    <strong className="text-emerald-700 dark:text-emerald-400">
                      Applica Principio di massima efficienza operativa
                    </strong>{' '}
                    <span className="block text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                      Ottimizza equilibrio tra qualità, accuratezza, velocità, operazioni e consumo di token/crediti evitando passaggi ridondanti.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-2 text-xs font-medium text-zinc-800 dark:text-zinc-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingAgent.enforcePerimeterAndCredentials !== false}
                    onChange={(e) =>
                      setEditingAgent({
                        ...editingAgent,
                        enforcePerimeterAndCredentials: e.target.checked,
                      })
                    }
                    className="mt-0.5 rounded border-zinc-300 dark:border-zinc-700 text-amber-600 focus:ring-amber-600"
                  />
                  <span>
                    <strong className="text-amber-700 dark:text-amber-400">
                      Applica Perimetro operativo, filesystem, installazioni e credenziali
                    </strong>{' '}
                    <span className="block text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                      Vieta file/artefatti anche temporanei fuori perimetro, impone stop e richiesta se il percorso manca e vieta password in chiaro.
                    </span>
                  </span>
                </label>

                <label className="flex items-center gap-2 text-xs font-medium text-zinc-800 dark:text-zinc-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={makeDefaultOnSave}
                    onChange={(e) => setMakeDefaultOnSave(e.target.checked)}
                    className="rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-600"
                  />
                  <span>Imposta come agente predefinito per le nuove chat</span>
                </label>
              </div>

              {/* Prompt Preview */}
              <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowPromptPreview((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {showPromptPreview
                    ? 'Nascondi anteprima prompt di sistema'
                    : 'Mostra anteprima prompt di sistema generato'}
                </button>
                {showPromptPreview && (
                  <pre className="mt-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-950 text-zinc-100 p-3 text-[11px] font-mono whitespace-pre-wrap max-h-56 overflow-y-auto">
                    {buildAgentSystemPrompt(editingAgent, settings.systemPrompt)}
                  </pre>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
              <button
                type="button"
                onClick={() => setEditingAgent(null)}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3.5 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveEditor()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                {saving ? 'Salvataggio...' : 'Salva agente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
