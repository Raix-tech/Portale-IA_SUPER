interface BackupFileHandleLike {
  createWritable: () => Promise<{
    write: (data: Blob | BufferSource | string) => Promise<void>;
    close: () => Promise<void>;
  }>;
}

interface BackupDirectoryHandleLike {
  name: string;
  getFileHandle: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<BackupFileHandleLike>;
  queryPermission?: (descriptor?: {
    mode?: 'read' | 'readwrite';
  }) => Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?: (descriptor?: {
    mode?: 'read' | 'readwrite';
  }) => Promise<'granted' | 'denied' | 'prompt'>;
}

const DB_NAME = 'free-ai-hub-backup';
const STORE_NAME = 'handles';
const DIR_KEY = 'backup-dir';

export function supportsSaveFilePicker(): boolean {
  return (
    typeof window !== 'undefined' &&
    'showSaveFilePicker' in window &&
    typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function'
  );
}

export function supportsBackupDirectoryPicker(): boolean {
  return (
    typeof window !== 'undefined' &&
    'showDirectoryPicker' in window &&
    typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
  );
}

export function isEmbeddedIframe(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
}

function openBackupDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Errore IndexedDB backup'));
  });
}

async function saveDirHandle(handle: BackupDirectoryHandleLike): Promise<void> {
  try {
    const db = await openBackupDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(handle, DIR_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Errore salvataggio cartella'));
    });
    db.close();
  } catch {
    // non-fatal
  }
}

async function loadDirHandle(): Promise<BackupDirectoryHandleLike | null> {
  try {
    const db = await openBackupDb();
    const res = await new Promise<BackupDirectoryHandleLike | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(DIR_KEY);
      req.onsuccess = () => resolve((req.result as BackupDirectoryHandleLike) || null);
      req.onerror = () => reject(req.error ?? new Error('Errore lettura cartella'));
    });
    db.close();
    return res;
  } catch {
    return null;
  }
}

export async function clearSavedBackupDirectory(): Promise<void> {
  try {
    const db = await openBackupDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(DIR_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Errore rimozione cartella'));
    });
    db.close();
  } catch {
    // ignore
  }
}

export async function getSavedBackupDirectoryInfo(): Promise<{
  connected: boolean;
  folderName?: string;
}> {
  if (!supportsBackupDirectoryPicker()) {
    return { connected: false };
  }
  const handle = await loadDirHandle();
  if (!handle) {
    return { connected: false };
  }
  return { connected: true, folderName: handle.name };
}

export async function pickBackupDirectory(): Promise<{ folderName: string }> {
  if (!supportsBackupDirectoryPicker()) {
    throw new Error(
      'Il selettore cartella diretto non è disponibile in questo browser.',
    );
  }
  const picker = (
    window as unknown as {
      showDirectoryPicker: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<BackupDirectoryHandleLike>;
    }
  ).showDirectoryPicker;

  try {
    const handle = await picker({ mode: 'readwrite' });
    if (handle.requestPermission) {
      const perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        throw new Error('Permesso di scrittura sulla cartella rifiutato.');
      }
    }
    await saveDirHandle(handle);
    return { folderName: handle.name };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Selezione cartella annullata.');
    }
    if (err instanceof DOMException && err.name === 'SecurityError') {
      throw new Error(
        'La finestra incorporata (iframe) blocca l’accesso diretto alle cartelle. Apri il portale in una scheda dedicata oppure usa il salvataggio file standard.',
      );
    }
    throw err;
  }
}

export function normalizeZipFileName(rawName: string): string {
  const base = rawName.trim().split(/[\\/]/).pop() || '';
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^\.+/, '');
  const finalName = safe || `free-ai-hub-source-${new Date().toISOString().slice(0, 10)}.zip`;
  return finalName.toLowerCase().endsWith('.zip') ? finalName : `${finalName}.zip`;
}

export function buildDefaultBackupFileName(prefix?: string): string {
  const cleanPrefix =
    (prefix || 'free-ai-hub-source')
      .trim()
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/\.zip$/i, '') || 'free-ai-hub-source';
  const today = new Date().toISOString().slice(0, 10);
  return `${cleanPrefix}-${today}.zip`;
}

export type BackupSaveMethod = 'directory_handle' | 'save_picker' | 'browser_download';

export async function saveZipLocally(params: {
  blob: Blob;
  fileName: string;
  preferSavePicker?: boolean;
}): Promise<{
  savedFileName: string;
  method: BackupSaveMethod;
  folderName?: string;
}> {
  const cleanName = normalizeZipFileName(params.fileName);

  // 1. Try authorized local directory handle if available and granted
  if (supportsBackupDirectoryPicker() && !params.preferSavePicker) {
    const dirHandle = await loadDirHandle();
    if (dirHandle) {
      try {
        let perm = dirHandle.queryPermission
          ? await dirHandle.queryPermission({ mode: 'readwrite' })
          : 'granted';
        if (perm === 'prompt' && dirHandle.requestPermission) {
          perm = await dirHandle.requestPermission({ mode: 'readwrite' });
        }
        if (perm === 'granted') {
          const fileHandle = await dirHandle.getFileHandle(cleanName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(params.blob);
          await writable.close();
          return {
            savedFileName: cleanName,
            method: 'directory_handle',
            folderName: dirHandle.name,
          };
        }
      } catch {
        // Fall through to Save Picker or browser download
      }
    }
  }

  // 2. Try native Save File Picker ("Salva con nome...") when supported outside iframe
  if (supportsSaveFilePicker() && !isEmbeddedIframe()) {
    try {
      const savePicker = (
        window as unknown as {
          showSaveFilePicker: (opts: {
            suggestedName?: string;
            types?: Array<{
              description: string;
              accept: Record<string, string[]>;
            }>;
          }) => Promise<BackupFileHandleLike & { name?: string }>;
        }
      ).showSaveFilePicker;
      const handle = await savePicker({
        suggestedName: cleanName,
        types: [
          {
            description: 'Archivio ZIP codice sorgente',
            accept: { 'application/zip': ['.zip'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(params.blob);
      await writable.close();
      return {
        savedFileName: handle.name || cleanName,
        method: 'save_picker',
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('Salvataggio annullato dall’utente.');
      }
      // Fall through to browser download on SecurityError / unsupported environments
    }
  }

  // 3. Standard browser download with chosen filename
  const url = URL.createObjectURL(params.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = cleanName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  return {
    savedFileName: cleanName,
    method: 'browser_download',
  };
}
