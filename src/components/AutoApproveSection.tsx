import {
  AlertTriangle,
  AppWindow,
  Check,
  Clipboard,
  Cpu,
  FolderOpen,
  GitBranch,
  Globe,
  Lock,
  Network,
  Package,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Terminal,
  Zap,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  AutoApproveCategoryId,
  AutoApproveProfileId,
  AutoApproveSettings,
  PcAccessMode,
} from '../types/ai';
import {
  AUTO_APPROVE_CATEGORIES,
  AUTO_APPROVE_HIGH_RISK_GROUPS,
  AUTO_APPROVE_PROFILES,
  buildAutoApproveProfileSettings,
  countEnabledAutoApprovePermissions,
  countHighRiskAutoApprovePermissions,
  countTotalAutoApprovePermissions,
  disableAllHighRiskPermissions,
  getAutoApprovePermissionValue,
  getDefaultAutoApproveSettings,
  getEnabledHighRiskItems,
} from '../utils/autoApprove';

interface AutoApproveSectionProps {
  autoApprove: AutoApproveSettings;
  pcAccessMode: PcAccessMode;
  onUpdateAutoApprove: (next: AutoApproveSettings) => Promise<void>;
  onSwitchToPcTab?: () => void;
}

const CATEGORY_ICONS: Record<AutoApproveCategoryId, typeof FolderOpen> = {
  filesAndFolders: FolderOpen,
  terminalAndCommands: Terminal,
  applications: AppWindow,
  webAndBrowser: Globe,
  softwareAndPackages: Package,
  processesAndSystem: Cpu,
  clipboardAndDesktop: Clipboard,
  gitAndDev: GitBranch,
  network: Network,
};

const PROFILE_ICONS: Record<AutoApproveProfileId, typeof ShieldCheck> = {
  safe: ShieldCheck,
  dev: Terminal,
  automation: Zap,
  full: ShieldAlert,
  custom: Sliders,
};

export function AutoApproveSection({
  autoApprove,
  pcAccessMode,
  onUpdateAutoApprove,
  onSwitchToPcTab,
}: AutoApproveSectionProps) {
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<'all' | 'enabled' | 'manual' | 'high-risk'>('all');

  const activeProfile: AutoApproveProfileId = autoApprove.profile ?? 'custom';
  const enabledCount = useMemo(
    () => countEnabledAutoApprovePermissions(autoApprove),
    [autoApprove],
  );
  const totalCount = useMemo(() => countTotalAutoApprovePermissions(), []);
  const totalHighRisk = useMemo(() => countHighRiskAutoApprovePermissions(), []);
  const enabledHighRisk = useMemo(() => getEnabledHighRiskItems(autoApprove), [autoApprove]);

  const handleSelectProfile = async (profileId: AutoApproveProfileId) => {
    const next = buildAutoApproveProfileSettings(profileId, autoApprove);
    await onUpdateAutoApprove(next);
  };

  const handleToggleItem = async (
    categoryId: AutoApproveCategoryId,
    key: string,
    checked: boolean,
  ) => {
    const currentCat = (autoApprove as unknown as Record<string, Record<string, boolean>>)[
      categoryId
    ];
    const next = {
      ...autoApprove,
      profile: 'custom' as AutoApproveProfileId,
      [categoryId]: {
        ...currentCat,
        [key]: checked,
      },
    } as AutoApproveSettings;
    await onUpdateAutoApprove(next);
  };

  const handleToggleCategoryBulk = async (
    categoryId: AutoApproveCategoryId,
    value: boolean,
  ) => {
    const meta = AUTO_APPROVE_CATEGORIES.find((c) => c.id === categoryId);
    if (!meta) return;
    const currentCat = {
      ...(autoApprove as unknown as Record<string, Record<string, boolean>>)[categoryId],
    };
    for (const item of meta.items) {
      // Administrative privilege execution must always be managed separately from normal operations
      if (item.isAdminPrivilege) continue;
      currentCat[item.key] = value;
    }
    const next = {
      ...autoApprove,
      profile: 'custom' as AutoApproveProfileId,
      [categoryId]: currentCat,
    } as AutoApproveSettings;
    await onUpdateAutoApprove(next);
  };

  const handleResetDefaults = async () => {
    await onUpdateAutoApprove(getDefaultAutoApproveSettings());
  };

  const handleDisableHighRisk = async () => {
    await onUpdateAutoApprove(disableAllHighRiskPermissions(autoApprove));
  };

  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    return AUTO_APPROVE_CATEGORIES.map((cat) => {
      const catMatches =
        !q ||
        cat.title.toLowerCase().includes(q) ||
        cat.description.toLowerCase().includes(q);
      const visibleItems = cat.items.filter((item) => {
        const val = getAutoApprovePermissionValue(autoApprove, cat.id, item.key);
        if (stateFilter === 'enabled' && !val) return false;
        if (stateFilter === 'manual' && val) return false;
        if (stateFilter === 'high-risk' && item.riskLevel !== 'high') return false;
        if (!q || catMatches) return true;
        return (
          item.label.toLowerCase().includes(q) ||
          (item.riskReason?.toLowerCase().includes(q) ?? false)
        );
      });
      return {
        ...cat,
        visibleItems,
      };
    }).filter((cat) => cat.visibleItems.length > 0);
  }, [autoApprove, search, stateFilter]);

  return (
    <section
      id="auto-approve-settings"
      className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-6 space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-white">
                Auto-Approve · Operazioni automatiche senza conferma
              </h2>
              <span className="rounded-md bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 tabular-nums">
                {enabledCount} / {totalCount} attive
              </span>
              {enabledHighRisk.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-red-100 dark:bg-red-950/60 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-300 tabular-nums">
                  <AlertTriangle className="w-3 h-3" />
                  {enabledHighRisk.length} alto rischio
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Scegli un profilo rapido oppure personalizza in autonomia ogni singola autorizzazione.
              Tutte le autorizzazioni sono indipendenti tra loro.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleResetDefaults()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/80 px-3 py-2 text-xs font-semibold text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Ripristina predefiniti
        </button>
      </div>

      {/* Quick Profiles */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-800 dark:text-zinc-200">
              Profili rapidi Auto-Approve
            </h3>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
              Seleziona un profilo preconfigurato o passa a Personalizzato per modificare manualmente i singoli permessi.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {AUTO_APPROVE_PROFILES.map((profile) => {
            const selected = activeProfile === profile.id;
            const ProfileIcon = PROFILE_ICONS[profile.id];

            const selectedClasses =
              profile.riskTone === 'critical'
                ? 'border-red-500 bg-red-50/70 dark:bg-red-950/30 ring-1 ring-red-500/40'
                : profile.riskTone === 'elevated'
                  ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-950/25 ring-1 ring-amber-500/40'
                  : profile.riskTone === 'safe'
                    ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/25 ring-1 ring-emerald-500/40'
                    : 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30 ring-1 ring-indigo-500/40';

            const riskBadgeClasses =
              profile.riskTone === 'critical'
                ? 'bg-red-100 dark:bg-red-950/70 text-red-700 dark:text-red-300'
                : profile.riskTone === 'elevated'
                  ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300'
                  : profile.riskTone === 'safe'
                    ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300'
                    : 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300';

            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => void handleSelectProfile(profile.id)}
                className={`text-left rounded-xl border p-3.5 transition-colors flex flex-col justify-between gap-2 ${
                  selected
                    ? selectedClasses
                    : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950/40 hover:bg-zinc-100/70 dark:hover:bg-zinc-900'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-950 dark:text-white">
                      <ProfileIcon className="w-3.5 h-3.5 shrink-0 text-zinc-700 dark:text-zinc-300" />
                      {profile.name}
                    </span>
                    <span
                      className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${
                        selected
                          ? profile.riskTone === 'critical'
                            ? 'border-red-600 bg-red-600 text-white'
                            : 'border-indigo-600 bg-indigo-600 text-white'
                          : 'border-zinc-300 dark:border-zinc-700'
                      }`}
                    >
                      {selected && <Check className="w-2.5 h-2.5" />}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    {profile.description}
                  </p>
                </div>

                <div className="pt-1">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${riskBadgeClasses}`}>
                    {profile.riskTag}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* High-Risk Notice & Safeguard */}
      <div
        className={`rounded-xl border p-4 space-y-3 ${
          enabledHighRisk.length > 0
            ? 'border-red-300 dark:border-red-900/70 bg-red-50/80 dark:bg-red-950/25'
            : 'border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/20'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle
              className={`w-4 h-4 shrink-0 mt-0.5 ${
                enabledHighRisk.length > 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            />
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`text-xs font-bold ${
                    enabledHighRisk.length > 0
                      ? 'text-red-900 dark:text-red-200'
                      : 'text-amber-950 dark:text-amber-200'
                  }`}
                >
                  Operazioni a livello di rischio superiore
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                    enabledHighRisk.length > 0
                      ? 'bg-red-200/80 dark:bg-red-900/60 text-red-900 dark:text-red-200'
                      : 'bg-amber-200/70 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200'
                  }`}
                >
                  {enabledHighRisk.length} / {totalHighRisk} attive
                </span>
              </div>
              <p
                className={`text-[11px] leading-relaxed ${
                  enabledHighRisk.length > 0
                    ? 'text-red-800 dark:text-red-300'
                    : 'text-amber-900/90 dark:text-amber-200/90'
                }`}
              >
                {enabledHighRisk.length > 0
                  ? `Attenzione: hai ${enabledHighRisk.length} autorizzazioni ad alto rischio attive in Auto-Approve (${enabledHighRisk
                      .slice(0, 5)
                      .map((i) => i.label)
                      .join(', ')}${enabledHighRisk.length > 5 ? ` e altre ${enabledHighRisk.length - 5}` : ''}).`
                  : 'Le seguenti categorie comportano un livello di rischio superiore e richiedono normalmente conferma manuale:'}
              </p>
            </div>
          </div>

          {enabledHighRisk.length > 0 && (
            <button
              type="button"
              onClick={() => void handleDisableHighRisk()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-red-700 dark:text-red-300 hover:bg-red-100/70 dark:hover:bg-red-900/40 whitespace-nowrap shrink-0"
            >
              Disattiva azioni ad alto rischio
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {AUTO_APPROVE_HIGH_RISK_GROUPS.map((grp) => (
            <div
              key={grp.title}
              className="rounded-lg border border-black/10 dark:border-white/10 bg-white/75 dark:bg-zinc-900/70 px-3 py-2"
            >
              <div className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">
                {grp.title}
              </div>
              <div className="text-[10px] text-zinc-600 dark:text-zinc-400">
                {grp.examples}
              </div>
            </div>
          ))}
        </div>
      </div>

      {pcAccessMode === 'none' && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/25 p-3.5 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <span>
              <strong>Nota:</strong> &quot;Accesso al PC&quot; è attualmente impostato su{' '}
              <strong>Nessun accesso</strong>. Puoi comunque configurare qui le regole di
              Auto-Approve; per eseguire programmi o comandi locali abilita anche i relativi
              strumenti nella scheda <em>Accesso al PC</em>.
            </span>
          </div>
          {onSwitchToPcTab && (
            <button
              type="button"
              onClick={onSwitchToPcTab}
              className="rounded-md border border-amber-300 dark:border-amber-800 bg-white dark:bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100/70 dark:hover:bg-amber-900/40 whitespace-nowrap shrink-0"
            >
              Apri Accesso al PC
            </button>
          )}
        </div>
      )}

      {/* Search & Filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca permesso, rischio o categoria (es. PowerShell, PDF, Git, rete, account...)"
            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 pl-8 pr-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100"
          />
        </div>

        <div className="inline-flex flex-wrap rounded-lg border border-zinc-200 dark:border-zinc-800 p-0.5 bg-zinc-100 dark:bg-zinc-950">
          {(
            [
              { id: 'all', label: 'Tutte' },
              { id: 'enabled', label: 'Auto-Approve attivo' },
              { id: 'manual', label: 'Conferma manuale' },
              { id: 'high-risk', label: 'Rischio elevato' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStateFilter(f.id)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                stateFilter === f.id
                  ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* 9 Independent Categories */}
      {filteredCategories.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
          Nessun permesso corrispondente ai filtri selezionati.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredCategories.map((cat) => {
            const Icon = CATEGORY_ICONS[cat.id];
            const normalItems = cat.visibleItems.filter((i) => !i.isAdminPrivilege);
            const adminItems = cat.visibleItems.filter((i) => i.isAdminPrivilege);
            const activeInCat = cat.items.filter((i) =>
              getAutoApprovePermissionValue(autoApprove, cat.id, i.key),
            ).length;

            return (
              <div
                key={cat.id}
                className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 p-4 space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1.5">
                      <Icon className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xs font-bold tracking-wide text-zinc-950 dark:text-white">
                          {cat.title}
                        </h3>
                        <span className="rounded bg-zinc-200/70 dark:bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-700 dark:text-zinc-300 tabular-nums">
                          {activeInCat}/{cat.items.length}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                        {cat.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleToggleCategoryBulk(cat.id, true)}
                      className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap"
                    >
                      {cat.id === 'terminalAndCommands' ? 'Attiva normali' : 'Attiva tutte'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggleCategoryBulk(cat.id, false)}
                      className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap"
                    >
                      {cat.id === 'terminalAndCommands' ? 'Disattiva normali' : 'Disattiva tutte'}
                    </button>
                  </div>
                </div>

                {normalItems.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {normalItems.map((item) => {
                      const checked = getAutoApprovePermissionValue(
                        autoApprove,
                        cat.id,
                        item.key,
                      );
                      const isHighRisk = item.riskLevel === 'high';
                      return (
                        <label
                          key={item.key}
                          className={`flex items-center justify-between gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                            isHighRisk && checked
                              ? 'border-red-300 dark:border-red-900/70 bg-red-50/70 dark:bg-red-950/30'
                              : isHighRisk
                                ? 'border-amber-200/80 dark:border-amber-900/50 bg-amber-50/30 dark:bg-amber-950/15'
                                : checked
                                  ? 'border-emerald-200/90 dark:border-emerald-900/60 bg-white dark:bg-zinc-900/80'
                                  : 'border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/40'
                          } hover:border-zinc-300 dark:hover:border-zinc-700`}
                        >
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 leading-snug">
                              {item.label}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                              {isHighRisk && (
                                <span className="inline-flex items-center gap-0.5 rounded bg-red-100 dark:bg-red-950/70 px-1.5 py-0.5 font-semibold text-red-700 dark:text-red-300">
                                  <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                                  Rischio elevato{item.riskReason ? ` · ${item.riskReason}` : ''}
                                </span>
                              )}
                              <span
                                className={
                                  isHighRisk && checked
                                    ? 'text-red-700 dark:text-red-300 font-medium'
                                    : 'text-zinc-500 dark:text-zinc-400'
                                }
                              >
                                {checked
                                  ? 'Auto-approvato'
                                  : item.sensitive && !isHighRisk
                                    ? 'Conferma manuale (sensibile)'
                                    : 'Conferma manuale'}
                              </span>
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              void handleToggleItem(cat.id, item.key, e.target.checked)
                            }
                            className={`h-4 w-4 shrink-0 ${
                              isHighRisk ? 'accent-red-600' : 'accent-emerald-600'
                            }`}
                          />
                        </label>
                      );
                    })}
                  </div>
                )}

                {/* Dedicated separate control for administrative privileges */}
                {adminItems.length > 0 && (
                  <div className="pt-1">
                    <div className="rounded-lg border border-amber-300/80 dark:border-amber-900/70 bg-amber-50/70 dark:bg-amber-950/25 p-3 space-y-2.5">
                      <div className="flex items-start gap-2 text-[11px] text-amber-900 dark:text-amber-200">
                        <Lock className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                        <span>
                          <strong>Gestione separata privilegi amministrativi:</strong>{' '}
                          {cat.adminNote}
                        </span>
                      </div>

                      {adminItems.map((item) => {
                        const checked = getAutoApprovePermissionValue(
                          autoApprove,
                          cat.id,
                          item.key,
                        );
                        return (
                          <label
                            key={item.key}
                            className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 cursor-pointer ${
                              checked
                                ? 'border-red-300 dark:border-red-900/70 bg-red-50/80 dark:bg-red-950/40'
                                : 'border-amber-200 dark:border-amber-900/60 bg-white dark:bg-zinc-900/90'
                            }`}
                          >
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-semibold text-zinc-950 dark:text-white">
                                  {item.label}
                                </span>
                                <span className="inline-flex items-center gap-1 rounded bg-red-100 dark:bg-red-950/70 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300">
                                  <AlertTriangle className="w-2.5 h-2.5" />
                                  Rischio elevato · Privilegi amministrativi
                                </span>
                                <span className="rounded bg-amber-100 dark:bg-amber-950/70 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                                  Gestione separata
                                </span>
                              </div>
                              <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                                {checked
                                  ? 'Attenzione: i comandi con elevazione amministrativa possono essere eseguiti automaticamente.'
                                  : 'Consigliato: richiede sempre conferma manuale separata anche se gli altri strumenti terminale sono attivi.'}
                              </div>
                            </div>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                void handleToggleItem(cat.id, item.key, e.target.checked)
                              }
                              className="h-4 w-4 accent-red-600 shrink-0"
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
