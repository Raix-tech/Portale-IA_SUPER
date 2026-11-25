import { Check, Cpu, ExternalLink, RefreshCw, Server, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CatalogUpdateCheckResult } from '../types/ai';

interface CatalogUpdateModalProps {
  update: CatalogUpdateCheckResult;
  applying: boolean;
  onApply: (options: {
    selectedProviderIds: string[];
    applyModels: boolean;
    dismissUnselected: boolean;
  }) => Promise<void>;
  onDismissForNow: () => void;
}

export function CatalogUpdateModal({
  update,
  applying,
  onApply,
  onDismissForNow,
}: CatalogUpdateModalProps) {
  const [selectedProviders, setSelectedProviders] = useState<string[]>(() =>
    update.newProviders.map((p) => p.id),
  );
  const [applyModels, setApplyModels] = useState(true);
  const [dismissUnselected, setDismissUnselected] = useState(true);

  useEffect(() => {
    setSelectedProviders(update.newProviders.map((p) => p.id));
    setApplyModels(true);
  }, [update]);

  const hasModelDiffs =
    update.modelsSummary.addedCount > 0 ||
    update.modelsSummary.updatedCount > 0 ||
    update.modelsSummary.removedCount > 0;

  const toggleProvider = (id: string) => {
    setSelectedProviders((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const selectAllProviders = () => {
    if (selectedProviders.length === update.newProviders.length) {
      setSelectedProviders([]);
    } else {
      setSelectedProviders(update.newProviders.map((p) => p.id));
    }
  };

  const nothingSelected =
    selectedProviders.length === 0 && (!hasModelDiffs || !applyModels);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-2xl rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold text-zinc-950 dark:text-white">
                Aggiornamenti disponibili per provider e modelli
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {update.trigger === 'auto'
                  ? 'Verifica automatica all’accesso completata.'
                  : 'Verifica manuale completata.'}{' '}
                Scegli se scrivere le novità nel file catalogo locale (
                <span className="font-mono">providers-catalog.json</span>) e aggiornare i modelli.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={applying}
            onClick={onDismissForNow}
            aria-label="Chiudi"
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {update.newProviders.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  <Server className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  Nuovi provider compatibili OpenAI con modelli gratuiti ({update.newProviders.length})
                </div>
                <button
                  type="button"
                  onClick={selectAllProviders}
                  className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {selectedProviders.length === update.newProviders.length
                    ? 'Deseleziona tutti'
                    : 'Seleziona tutti'}
                </button>
              </div>

              <div className="max-h-60 overflow-y-auto divide-y divide-zinc-200 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800">
                {update.newProviders.map((p) => {
                  const checked = selectedProviders.includes(p.id);
                  return (
                    <label
                      key={p.id}
                      className="flex items-start gap-3 p-3 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/60 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleProvider(p.id)}
                        className="mt-0.5 h-4 w-4 accent-blue-600 shrink-0"
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-zinc-950 dark:text-white">
                            {p.name}
                          </span>
                          <span className="rounded bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 tabular-nums">
                            {p.freeModelCount} gratuiti / {p.totalModelCount} totali
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                          <code className="font-mono truncate max-w-[340px]">
                            {p.defaultBaseUrl}
                          </code>
                          <a
                            href={p.docsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            Docs
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </div>
                        {p.sampleFreeModels.length > 0 && (
                          <div className="text-[11px] text-zinc-600 dark:text-zinc-400 truncate">
                            Modelli gratuiti: {p.sampleFreeModels.join(', ')}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>

              {selectedProviders.length < update.newProviders.length && (
                <label className="flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dismissUnselected}
                    onChange={(e) => setDismissUnselected(e.target.checked)}
                    className="h-3.5 w-3.5 accent-blue-600"
                  />
                  Non proporre di nuovo i provider lasciati deselezionati
                </label>
              )}
            </div>
          )}

          {hasModelDiffs && (
            <div className="space-y-2.5">
              <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/50 p-3 cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <Cpu className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-zinc-950 dark:text-white">
                      Aggiornamenti modelli sui provider configurati
                    </div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                      +{update.modelsSummary.addedCount} nuovi · ~{update.modelsSummary.updatedCount}{' '}
                      aggiornati · -{update.modelsSummary.removedCount} rimossi
                    </div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={applyModels}
                  onChange={(e) => setApplyModels(e.target.checked)}
                  className="h-4 w-4 accent-blue-600 shrink-0"
                />
              </label>

              {applyModels && update.modelsSummary.perProvider.length > 0 && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
                  {update.modelsSummary.perProvider.map((item) => (
                    <div
                      key={item.providerId}
                      className="flex items-center justify-between px-3 py-2"
                    >
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {item.providerName}
                      </span>
                      <span className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400 tabular-nums">
                        +{item.added} / ~{item.updated} / -{item.removed} (tot. {item.total})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {update.sourceWarnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 p-3 text-[11px] text-amber-800 dark:text-amber-300 space-y-1">
              <div className="font-semibold">Note di verifica:</div>
              {update.sourceWarnings.slice(0, 4).map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40">
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Le tue API key e configurazioni esistenti restano invariate.
          </span>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={applying}
              onClick={onDismissForNow}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
            >
              Ignora per ora
            </button>
            <button
              type="button"
              disabled={applying || nothingSelected}
              onClick={() =>
                void onApply({
                  selectedProviderIds: selectedProviders,
                  applyModels,
                  dismissUnselected,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {applying ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Salvataggio nel JSON...
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Procedi e aggiorna
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
