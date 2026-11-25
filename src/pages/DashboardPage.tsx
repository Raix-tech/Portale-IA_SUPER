import { ArrowRight, RefreshCw, Settings2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { AppSettings, ModelInfo, PublicProviderConfig } from '../types/ai';
import type { NavSection } from '../components/Sidebar';
import { ProviderIcon } from '../components/ProviderIcon';
import { StatusBadge } from '../components/StatusBadge';

interface DashboardPageProps {
  providers: PublicProviderConfig[];
  models: ModelInfo[];
  settings: AppSettings;
  onNavigate: (section: NavSection) => void;
  onTestProvider: (providerId: string) => Promise<void>;
  onRefreshAllModels: () => Promise<void>;
}

export function DashboardPage({
  providers,
  models,
  settings,
  onNavigate,
  onTestProvider,
  onRefreshAllModels,
}: DashboardPageProps) {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);

  const configuredProviders = providers.filter((p) => p.configured && p.enabled);
  const freeModelsCount = models.filter(
    (m) => m.pricingTier === 'free' || m.pricingTier === 'free_tier',
  ).length;
  const activeProvider = providers.find((p) => p.id === settings.activeProviderId);

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      await onTestProvider(id);
    } finally {
      setTestingId(null);
    }
  };

  const handleTestAllConfigured = async () => {
    setRefreshingAll(true);
    try {
      for (const p of configuredProviders) {
        await onTestProvider(p.id);
      }
      await onRefreshAllModels();
    } finally {
      setRefreshingAll(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-950 dark:text-white">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Panoramica dei provider configurati, modelli rilevati e stato reale dei servizi.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {configuredProviders.length > 0 && (
            <button
              type="button"
              onClick={handleTestAllConfigured}
              disabled={refreshingAll}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshingAll ? 'animate-spin' : ''}`} />
              Verifica tutti
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('chat')}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
          >
            Apri Chat
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 4-column KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Providers configurati
          </div>
          <div className="mt-2 flex items-baseline gap-2 tabular-nums">
            <span className="font-display text-3xl font-bold text-zinc-950 dark:text-white">
              {configuredProviders.length}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
              su {providers.length} disponibili
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Models disponibili
          </div>
          <div className="mt-2 flex items-baseline gap-2 tabular-nums">
            <span className="font-display text-3xl font-bold text-zinc-950 dark:text-white">
              {models.length}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">rilevati via API</span>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Free models
          </div>
          <div className="mt-2 flex items-baseline gap-2 tabular-nums">
            <span className="font-display text-3xl font-bold text-emerald-600 dark:text-emerald-400">
              {freeModelsCount}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              confermati Free / Free Tier
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Provider attivo
          </div>
          <div className="mt-2">
            {settings.smartRouter.enabled ? (
              <div>
                <div className="font-display text-lg font-bold text-blue-600 dark:text-blue-400 truncate">
                  AUTO · Smart Router
                </div>
                <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  Task: {settings.smartRouter.taskCategory}
                </div>
              </div>
            ) : (
              <div>
                <div className="font-display text-lg font-bold text-zinc-950 dark:text-white truncate">
                  {activeProvider?.name || 'Nessuno'}
                </div>
                <div className="mt-0.5 font-mono text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  {settings.activeModelId || 'Nessun modello selezionato'}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {configuredProviders.length === 0 && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-semibold text-zinc-950 dark:text-white">
                Configura la prima API key per iniziare
              </h2>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 max-w-2xl">
                Nessun provider è ancora configurato. Le chiavi vengono cifrate sul server e mai esposte
                in chiaro nell&apos;interfaccia. Aggiungi una chiave per OpenRouter, Groq, Gemini, Cerebras o
                un provider personalizzato.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('providers')}
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 py-2 text-xs font-semibold text-white dark:text-zinc-950 hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
          >
            <Settings2 className="w-3.5 h-3.5" />
            Configura Providers
          </button>
        </div>
      )}

      {/* Service Status Table */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-white">
              Stato servizi
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Lo stato Online viene mostrato solo dopo una verifica reale tramite API.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('providers')}
            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
          >
            Gestisci tutti
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                <th className="py-2.5 px-5">Provider</th>
                <th className="py-2.5 px-4">Stato</th>
                <th className="py-2.5 px-4">API Key</th>
                <th className="py-2.5 px-4 text-right">Modelli</th>
                <th className="py-2.5 px-4 text-right">Latenza</th>
                <th className="py-2.5 px-5 text-right">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/80 text-sm">
              {providers.map((p) => (
                <tr
                  key={p.id}
                  className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30 transition-colors"
                >
                  <td className="py-2.5 px-5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-700 dark:text-zinc-300 shrink-0">
                        <ProviderIcon providerId={p.id} className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {p.name}
                        </div>
                        {p.lastError && (
                          <div className="text-xs text-red-600 dark:text-red-400 truncate max-w-xs">
                            {p.lastError.message}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 px-4">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="py-2.5 px-4 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                    {p.hasApiKey ? (
                      <span>
                        {p.maskedApiKey}
                        {p.apiKeys.length > 1 && (
                          <span className="ml-1.5 text-[11px] font-sans text-zinc-500 dark:text-zinc-400">
                            ({p.activeKeyLabel} · +{p.apiKeys.length - 1})
                          </span>
                        )}
                      </span>
                    ) : (
                      'Non impostata'
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-zinc-700 dark:text-zinc-300">
                    {p.modelCount}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                    {p.lastLatencyMs !== undefined ? `${p.lastLatencyMs} ms` : '—'}
                  </td>
                  <td className="py-2.5 px-5 text-right">
                    <div className="inline-flex items-center gap-2">
                      {p.configured && p.enabled ? (
                        <button
                          type="button"
                          onClick={() => handleTest(p.id)}
                          disabled={testingId === p.id}
                          className="rounded-md border border-zinc-200 dark:border-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors whitespace-nowrap"
                        >
                          {testingId === p.id ? 'Verifica...' : 'Test'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onNavigate('providers')}
                          className="rounded-md border border-zinc-200 dark:border-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap"
                        >
                          Configura
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
