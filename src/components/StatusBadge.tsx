import { AlertTriangle, CheckCircle2, CircleSlash, Clock, XCircle } from 'lucide-react';
import type { ModelPricingTier, ProviderStatusType } from '../types/ai';

export function StatusBadge({ status }: { status: ProviderStatusType }) {
  switch (status) {
    case 'online':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 whitespace-nowrap shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          Online
        </span>
      );
    case 'rate_limited':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300 whitespace-nowrap shrink-0">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          Rate limit
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300 whitespace-nowrap shrink-0">
          <XCircle className="w-3.5 h-3.5 shrink-0" />
          Errore
        </span>
      );
    case 'disabled':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 whitespace-nowrap shrink-0">
          <CircleSlash className="w-3.5 h-3.5 shrink-0" />
          Disabilitato
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 whitespace-nowrap shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 opacity-70" />
          Non configurato
        </span>
      );
  }
}

export function PricingBadge({ tier }: { tier: ModelPricingTier }) {
  switch (tier) {
    case 'free':
      return (
        <span className="inline-flex items-center rounded-md border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 whitespace-nowrap shrink-0">
          Free
        </span>
      );
    case 'free_tier':
      return (
        <span className="inline-flex items-center rounded-md border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300 whitespace-nowrap shrink-0">
          Free Tier
        </span>
      );
    case 'paid':
      return (
        <span className="inline-flex items-center rounded-md border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300 whitespace-nowrap shrink-0">
          Paid
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 whitespace-nowrap shrink-0">
          Unknown
        </span>
      );
  }
}
