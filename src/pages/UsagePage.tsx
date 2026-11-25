import { Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ProviderIcon } from '../components/ProviderIcon';
import type { UsageRecord } from '../types/ai';

interface UsagePageProps {
  usageLogs: UsageRecord[];
  onClearUsage: () => Promise<void>;
}

export function UsagePage({ usageLogs, onClearUsage }: UsagePageProps) {
  const [confirmClear, setConfirmClear] = useState(false);

  const summary = useMemo(() => {
    const total = usageLogs.length;
    const successes = usageLogs.filter((l) => l.success).length;
    const avgLatency =
      total > 0
        ? Math.round(usageLogs.reduce((acc, l) => acc + l.latencyMs, 0) / total)
        : 0;
    const inputTokens = usageLogs.reduce((acc, l) => acc + (l.inputTokens ?? 0), 0);
    const outputTokens = usageLogs.reduce((acc, l) => acc + (l.outputTokens ?? 0), 0);

    const byProvider = new Map<
      string,
      {
        providerId: string;
        providerName: string;
        requests: number;
        successes: number;
        failures: number;
        totalLatency: number;
        inputTokens: number;
        outputTokens: number;
      }
    >();

    for (const log of usageLogs) {
      const curr = byProvider.get(log.providerId) ?? {
        providerId: log.providerId,
        providerName: log.providerName,
        requests: 0,
        successes: 0,
        failures: 0,
        totalLatency: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      curr.requests += 1;
      if (log.success) curr.successes += 1;
      else curr.failures += 1;
      curr.totalLatency += log.latencyMs;
      curr.inputTokens += log.inputTokens ?? 0;
      curr.outputTokens += log.outputTokens ?? 0;
      byProvider.set(log.providerId, curr);
    }

    return {
      total,
      successRate: total > 0 ? Math.round((successes / total) * 100) : 0,
      avgLatency,
      inputTokens,
      outputTokens,
      providersBreakdown: Array.from(byProvider.values()).sort(
        (a, b) => b.requests - a.requests,
      ),
    };
  }, [usageLogs]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-950 dark:text-white">
            Usage
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Statistiche locali delle richieste inviate (nessuna API key viene mai registrata nei log).
          </p>
        </div>

        {usageLogs.length > 0 && (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-900/60 px-3.5 py-2 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 whitespace-nowrap shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Cancella statistiche
          </button>
        )}
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Richieste totali
          </div>
          <div className="mt-2 font-display text-3xl font-bold tabular-nums text-zinc-950 dark:text-white">
            {summary.total}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Tasso di successo
          </div>
          <div className="mt-2 font-display text-3xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {summary.successRate}%
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Latenza media
          </div>
          <div className="mt-2 font-display text-3xl font-bold tabular-nums text-zinc-950 dark:text-white">
            {summary.avgLatency} <span className="text-sm font-normal text-zinc-500">ms</span>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Token Input / Output
          </div>
          <div className="mt-2 font-mono text-lg font-bold tabular-nums text-zinc-950 dark:text-white">
            {summary.inputTokens.toLocaleString('it-IT')} /{' '}
            {summary.outputTokens.toLocaleString('it-IT')}
          </div>
        </div>
      </div>

      {usageLogs.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-10 text-center">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Nessun dato di utilizzo registrato.
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Invia il primo messaggio nella sezione Chat per visualizzare latenza, token e successi per provider.
          </p>
        </div>
      ) : (
        <>
          {/* Breakdown by Provider */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 text-sm font-semibold text-zinc-950 dark:text-white">
              Riepilogo per Provider
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    <th className="py-2.5 px-5">Provider</th>
                    <th className="py-2.5 px-4 text-right">Richieste</th>
                    <th className="py-2.5 px-4 text-right">Successi</th>
                    <th className="py-2.5 px-4 text-right">Errori</th>
                    <th className="py-2.5 px-4 text-right">Latenza media</th>
                    <th className="py-2.5 px-5 text-right">Token In / Out</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/80 text-xs">
                  {summary.providersBreakdown.map((row) => (
                    <tr key={row.providerId}>
                      <td className="py-2.5 px-5 font-medium text-zinc-900 dark:text-zinc-100">
                        <span className="inline-flex items-center gap-2">
                          <ProviderIcon providerId={row.providerId} className="w-3.5 h-3.5" />
                          {row.providerName}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        {row.requests}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                        {row.successes}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-red-600 dark:text-red-400">
                        {row.failures}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                        {Math.round(row.totalLatency / row.requests)} ms
                      </td>
                      <td className="py-2.5 px-5 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                        {row.inputTokens.toLocaleString('it-IT')} /{' '}
                        {row.outputTokens.toLocaleString('it-IT')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Logs */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 text-sm font-semibold text-zinc-950 dark:text-white">
              Ultime richieste
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    <th className="py-2.5 px-5">Data / Ora</th>
                    <th className="py-2.5 px-4">Provider</th>
                    <th className="py-2.5 px-4">Modello</th>
                    <th className="py-2.5 px-4">Esito</th>
                    <th className="py-2.5 px-4 text-right">Latenza</th>
                    <th className="py-2.5 px-5 text-right">Token</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/80 text-xs">
                  {usageLogs.slice(0, 50).map((log) => (
                    <tr key={log.id}>
                      <td className="py-2.5 px-5 font-mono tabular-nums text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString('it-IT')}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-zinc-800 dark:text-zinc-200 whitespace-nowrap">
                        {log.providerName}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-zinc-600 dark:text-zinc-400 max-w-xs truncate">
                        {log.modelId}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        {log.success ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            Successo
                          </span>
                        ) : (
                          <span className="text-red-600 dark:text-red-400 font-medium">
                            {log.errorCode || 'Errore'}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                        {log.latencyMs} ms
                      </td>
                      <td className="py-2.5 px-5 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                        {log.inputTokens !== undefined || log.outputTokens !== undefined
                          ? `${log.inputTokens ?? '?'} / ${log.outputTokens ?? '?'}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {confirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 shadow-xl">
            <h3 className="font-display text-base font-bold text-zinc-950 dark:text-white">
              Azzerare le statistiche locali?
            </h3>
            <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
              Tutti i record di utilizzo verranno rimossi definitivamente.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3.5 py-1.5 text-xs font-medium"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onClearUsage();
                  setConfirmClear(false);
                }}
                className="rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
              >
                Cancella tutto
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
