import { Archive, Check, FolderOpen, HardDriveDownload, RefreshCw, X } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import {
  buildDefaultBackupFileName,
  clearSavedBackupDirectory,
  getSavedBackupDirectoryInfo,
  isEmbeddedIframe,
  normalizeZipFileName,
  pickBackupDirectory,
  supportsBackupDirectoryPicker,
  supportsSaveFilePicker,
} from '../services/sourceBackupClient';
import type { SourceBackupManifest, SourceBackupSettings } from '../types/ai';

interface SourceBackupModalProps {
  trigger: 'manual' | 'auto';
  settings: SourceBackupSettings;
  manifest: SourceBackupManifest | null;
  loadingManifest: boolean;
  saving: boolean;
  onConfirm: (options: {
    localPath: string;
    fileName: string;
    saveAsDefaults: boolean;
  }) => Promise<void>;
  onCancel: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function SourceBackupModal({
  trigger,
  settings,
  manifest,
  loadingManifest,
  saving,
  onConfirm,
  onCancel,
}: SourceBackupModalProps) {
  const [localPath, setLocalPath] = useState(settings.localPath || '');
  const [fileName, setFileName] = useState(() =>
    buildDefaultBackupFileName(settings.fileNamePrefix),
  );
  const [saveAsDefaults, setSaveAsDefaults] = useState(true);
  const [dirInfo, setDirInfo] = useState<{ connected: boolean; folderName?: string }>({
    connected: false,
  });
  const [dirError, setDirError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setLocalPath(settings.localPath || '');
    setFileName(buildDefaultBackupFileName(settings.fileNamePrefix));
    void getSavedBackupDirectoryInfo().then(setDirInfo);
  }, [settings]);

  const inIframe = isEmbeddedIframe();
  const canPickDirectory = supportsBackupDirectoryPicker() && !inIframe;
  const canPickSaveFile = supportsSaveFilePicker() && !inIframe;

  const handlePickFolder = async () => {
    setDirError(null);
    try {
      const picked = await pickBackupDirectory();
      setDirInfo({ connected: true, folderName: picked.folderName });
      if (!localPath.trim()) {
        setLocalPath(picked.folderName);
      }
    } catch (err) {
      setDirError(err instanceof Error ? err.message : 'Impossibile selezionare la cartella.');
    }
  };

  const handleClearFolder = async () => {
    await clearSavedBackupDirectory();
    setDirInfo({ connected: false });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    const trimmedName = fileName.trim();
    if (!trimmedName) {
      setValidationError('Inserisci il nome del file di backup.');
      return;
    }
    if (!localPath.trim() && !dirInfo.connected && !canPickSaveFile) {
      setValidationError(
        'Inserisci il percorso locale desiderato (es. C:\\Backup\\FreeAIHub o ~/Backups).',
      );
      return;
    }
    await onConfirm({
      localPath: localPath.trim(),
      fileName: normalizeZipFileName(trimmedName),
      saveAsDefaults,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-xl rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
              <Archive className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold text-zinc-950 dark:text-white">
                {trigger === 'auto'
                  ? 'Backup automatico del portale pronto: vuoi procedere?'
                  : 'Conferma backup locale del codice sorgente'}
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {trigger === 'auto'
                  ? 'È scaduto l’intervallo configurato per il backup automatico. Verifica percorso e nome file prima di salvare.'
                  : 'Scegli se procedere e indica dove salvare l’archivio ZIP con l’intero codice del portale.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            aria-label="Chiudi"
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Archive summary */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/50 p-3.5 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                Contenuto archivio sorgente (.zip)
              </span>
              {loadingManifest ? (
                <span className="text-zinc-500 dark:text-zinc-400">Calcolo file...</span>
              ) : manifest ? (
                <span className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300 tabular-nums">
                  {manifest.fileCount} file · {formatBytes(manifest.totalBytes)} non compressi
                </span>
              ) : null}
            </div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Include tutto il codice (`src/`, `server/`, `public/`, `package.json`, configurazioni).
              Esclude automaticamente `node_modules`, `dist`, `.env` e i segreti del vault.
            </p>
          </div>

          {/* Local path input + optional browser directory handle */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="backup-local-path"
                className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200"
              >
                Percorso locale di destinazione
              </label>
              {canPickDirectory && (
                <button
                  type="button"
                  onClick={() => void handlePickFolder()}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Scegli cartella dal PC
                </button>
              )}
            </div>

            <input
              id="backup-local-path"
              type="text"
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              placeholder="es. C:\Backup\Free-AI-Hub oppure /Users/nome/Backups"
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />

            {dirInfo.connected && (
              <div className="flex items-center justify-between rounded-md border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/20 px-3 py-1.5 text-[11px] text-emerald-800 dark:text-emerald-300">
                <span>
                  Cartella locale collegata per salvataggio diretto: <strong>{dirInfo.folderName}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => void handleClearFolder()}
                  className="underline hover:no-underline ml-2"
                >
                  Scollega
                </button>
              </div>
            )}

            {dirError && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400">{dirError}</p>
            )}

            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {dirInfo.connected
                ? 'Il file verrà salvato direttamente nella cartella collegata con il nome indicato sotto.'
                : canPickSaveFile
                  ? 'Alla conferma si aprirà anche la finestra di sistema "Salva con nome" per confermare la cartella sul tuo dispositivo.'
                  : 'Per sicurezza del browser, il file verrà scaricato con il nome esatto indicato sotto (se vuoi scegliere la cartella ad ogni salvataggio attiva "Chiedi dove salvare ogni file" nelle impostazioni del browser o apri il portale in una scheda dedicata).'}
            </p>
          </div>

          {/* File name */}
          <div className="space-y-1.5">
            <label
              htmlFor="backup-file-name"
              className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200"
            >
              Nome del file di backup (.zip)
            </label>
            <input
              id="backup-file-name"
              type="text"
              required
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="free-ai-hub-source-2026-11-24.zip"
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">
              Destinazione indicata:{' '}
              {localPath.trim()
                ? `${localPath.trim().replace(/[\\/]+$/, '')}/${normalizeZipFileName(fileName)}`
                : normalizeZipFileName(fileName)}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={saveAsDefaults}
              onChange={(e) => setSaveAsDefaults(e.target.checked)}
              className="h-4 w-4 accent-blue-600"
            />
            Salva questo percorso e prefisso nome come predefiniti per i prossimi backup
          </label>

          {validationError && (
            <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {validationError}
            </div>
          )}

          {/* Footer */}
          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-3 border-t border-zinc-200 dark:border-zinc-800">
            <button
              type="button"
              disabled={saving}
              onClick={onCancel}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
            >
              {trigger === 'auto' ? 'Rimanda' : 'Annulla'}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Creazione ZIP in corso...
                </>
              ) : (
                <>
                  {dirInfo.connected ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <HardDriveDownload className="w-3.5 h-3.5" />
                  )}
                  Procedi con il backup
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
