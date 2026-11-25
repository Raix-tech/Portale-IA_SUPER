import { MessageSquare, RefreshCw, Search, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ProviderIcon } from '../components/ProviderIcon';
import { PricingBadge } from '../components/StatusBadge';
import type { ModelCapability, ModelInfo, PublicProviderConfig } from '../types/ai';

interface ModelsPageProps {
  models: ModelInfo[];
  providers: PublicProviderConfig[];
  checkingUpdates: boolean;
  onCheckUpdates: () => void;
  onRefreshAll: () => Promise<void>;
  onUseInChat: (providerId: string, modelId: string) => void;
}

const CAP_FILTERS: Array<{ id: 'all' | ModelCapability; label: string }> = [
  { id: 'all', label: 'Tutti' },
  { id: 'text', label: 'Testo' },
  { id: 'coding', label: 'Coding' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'multimodal', label: 'Multimodale' },
];

export function ModelsPage({
  models,
  providers,
  checkingUpdates,
  onCheckUpdates,
  onRefreshAll,
  onUseInChat,
}: ModelsPageProps) {
  const [search, setSearch] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [capFilter, setCapFilter] = useState<'all' | ModelCapability>('all');
  const [refreshing, setRefreshing] = useState(false);

  const configuredCount = providers.filter((p) => p.configured && p.enabled).length;

  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    return models
      .filter((m) => {
        if (freeOnly && m.pricingTier !== 'free' && m.pricingTier !== 'free_tier') {
          return false;
        }
        if (providerFilter !== 'all' && m.providerId !== providerFilter) {
          return false;
        }
        if (capFilter !== 'all' && !m.capabilities.includes(capFilter)) {
          return false;
        }
        if (
          q &&
          !m.name.toLowerCase().includes(q) &&
          !m.id.toLowerCase().includes(q) &&
          !m.providerName.toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const tierScore = (t: ModelInfo['pricingTier']) =>
          t === 'free' ? 0 : t === 'free_tier' ? 1 : t === 'unknown' ? 2 : 3;
        const diff = tierScore(a.pricingTier) - tierScore(b.pricingTier);
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name);
      });
  }, [models, search, freeOnly, providerFilter, capFilter]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefreshAll();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-950 dark:text-white">
            Models
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Modelli recuperati direttamente dalle API dei provider configurati. Se il costo non è
            dichiarato dall&apos;API viene indicato &quot;Unknown&quot;.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onCheckUpdates}
            disabled={checkingUpdates}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checkingUpdates ? 'animate-spin' : ''}`} />
            {checkingUpdates ? 'Ricerca...' : 'Cerca aggiornamenti catalogo'}
          </button>

          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing || configuredCount === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Aggiornamento...' : 'Aggiorna da API'}
          </button>
        </div>
      </div>

      {/* Filters toolbar */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-4 flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative min-w-[220px] flex-1 max-w-sm">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca nome o model ID..."
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 pl-9 pr-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            aria-label="Filtra per provider"
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">Tutti i provider</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.modelCount})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setFreeOnly((prev) => !prev)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              freeOnly
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            Solo modelli gratuiti
          </button>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 overflow-x-auto">
          {CAP_FILTERS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCapFilter(c.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                capFilter === c.id
                  ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      {filteredModels.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-10 text-center">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            {models.length === 0
              ? 'Nessun modello ancora caricato.'
              : 'Nessun modello corrisponde ai filtri selezionati.'}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {models.length === 0
              ? 'Configura almeno un provider e clicca "Aggiorna da API" per scaricare la lista reale dei modelli.'
              : 'Prova a rimuovere qualche filtro di ricerca.'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  <th className="py-2.5 px-5">Modello &amp; ID</th>
                  <th className="py-2.5 px-4">Provider</th>
                  <th className="py-2.5 px-4">Piano</th>
                  <th className="py-2.5 px-4 text-right">Context</th>
                  <th className="py-2.5 px-4">Capacità &amp; Supporto</th>
                  <th className="py-2.5 px-5 text-right">Azione</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/80 text-sm">
                {filteredModels.map((m) => {
                  const isFreeHighlighted =
                    m.pricingTier === 'free' || m.pricingTier === 'free_tier';
                  return (
                    <tr
                      key={`${m.providerId}::${m.id}`}
                      className={`transition-colors hover:bg-zinc-50/90 dark:hover:bg-zinc-800/40 ${
                        isFreeHighlighted ? 'bg-emerald-50/30 dark:bg-emerald-950/10' : ''
                      }`}
                    >
                      <td className="py-3 px-5 max-w-md">
                        <div className="font-medium text-zinc-950 dark:text-white truncate">
                          {m.name}
                        </div>
                        <div className="font-mono text-xs text-zinc-500 dark:text-zinc-400 truncate">
                          {m.id}
                        </div>
                        {m.knownLimits && (
                          <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                            {m.knownLimits}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="inline-flex items-center gap-2 text-xs font-medium text-zinc-800 dark:text-zinc-200 whitespace-nowrap">
                          <ProviderIcon providerId={m.providerId} className="w-3.5 h-3.5" />
                          {m.providerName}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <PricingBadge tier={m.pricingTier} />
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-zinc-700 dark:text-zinc-300">
                        {m.contextWindow ? `${m.contextWindow.toLocaleString('it-IT')}` : '—'}
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span>{m.capabilities.join(' · ')}</span>
                          <span aria-hidden="true">·</span>
                          <span>{m.supportsStreaming ? 'Streaming' : 'No stream'}</span>
                          {m.supportsToolCalling && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-1 text-zinc-700 dark:text-zinc-300">
                                <Wrench className="w-3 h-3" />
                                Tools
                              </span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-5 text-right">
                        <button
                          type="button"
                          onClick={() => onUseInChat(m.providerId, m.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          Usa in Chat
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
