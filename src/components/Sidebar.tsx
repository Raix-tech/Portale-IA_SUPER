import {
  Activity,
  Archive,
  Bot,
  Briefcase,
  Cpu,
  LayoutDashboard,
  MessageSquare,
  Moon,
  RefreshCw,
  Server,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

export type NavSection =
  | 'dashboard'
  | 'chat'
  | 'agents'
  | 'copilot'
  | 'providers'
  | 'models'
  | 'usage'
  | 'settings';

interface SidebarProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  configuredCount: number;
  totalProviders: number;
  checkingUpdates: boolean;
  onCheckUpdates: () => void;
  onOpenSourceBackup: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'agents', label: 'Agenti', icon: Bot },
  { id: 'copilot', label: 'Copilot Pro', icon: Briefcase },
  { id: 'providers', label: 'Providers', icon: Server },
  { id: 'models', label: 'Models', icon: Cpu },
  { id: 'usage', label: 'Usage', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Sidebar({
  activeSection,
  onSelectSection,
  theme,
  onToggleTheme,
  configuredCount,
  totalProviders,
  checkingUpdates,
  onCheckUpdates,
  onOpenSourceBackup,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const content = (
    <div className="flex h-full flex-col justify-between bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 w-64">
      <div>
        <div className="flex h-14 items-center justify-between px-5 border-b border-zinc-200 dark:border-zinc-800">
          <span className="font-display text-base font-bold tracking-tight text-zinc-950 dark:text-white whitespace-nowrap shrink-0">
            Free AI Hub
          </span>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Chiudi menu"
            className="md:hidden rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="p-3 space-y-1" aria-label="Navigazione principale">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectSection(item.id);
                  onCloseMobile();
                }}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-950 dark:hover:text-zinc-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
        <PWAInstallButton />
        <div className="px-3 py-1.5 text-xs text-zinc-500 dark:text-zinc-400 flex items-center justify-between tabular-nums">
          <span>Provider pronti</span>
          <span className="font-mono font-medium text-zinc-900 dark:text-zinc-200">
            {configuredCount}/{totalProviders}
          </span>
        </div>

        <button
          type="button"
          onClick={() => {
            onCheckUpdates();
            onCloseMobile();
          }}
          disabled={checkingUpdates}
          className="w-full flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
        >
          <span className="flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 text-blue-600 dark:text-blue-400 ${checkingUpdates ? 'animate-spin' : ''}`} />
            {checkingUpdates ? 'Ricerca aggiornamenti...' : 'Cerca aggiornamenti'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            onOpenSourceBackup();
            onCloseMobile();
          }}
          className="w-full flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors whitespace-nowrap shrink-0"
        >
          <span className="flex items-center gap-2">
            <Archive className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            Backup codice locale
          </span>
        </button>

        <button
          type="button"
          onClick={onToggleTheme}
          className="w-full flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors whitespace-nowrap shrink-0"
        >
          <span className="flex items-center gap-2">
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-500" />
            ) : (
              <Moon className="w-4 h-4 text-zinc-600" />
            )}
            {theme === 'dark' ? 'Passa a Light Mode' : 'Passa a Dark Mode'}
          </span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden md:block shrink-0 h-screen sticky top-0">{content}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{content}</div>
        </div>
      )}
    </>
  );
}
