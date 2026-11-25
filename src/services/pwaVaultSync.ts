import type {
  AppSettings,
  ChatSession,
  GatewayStatus,
  ModelInfo,
  PublicProviderConfig,
} from '../types/ai';

export interface PwaSecretEntry {
  apiKey?: string;
  apiKeys?: Array<{
    id: string;
    label: string;
    apiKey: string;
    createdAt: string;
  }>;
  activeKeyId?: string;
  customHeaders?: Record<string, string>;
}

export interface PwaProviderSnapshot {
  id: string;
  name: string;
  kind: 'builtin' | 'custom';
  catalogSource?: 'builtin' | 'auto-sync';
  description: string;
  docsUrl: string;
  keyPlaceholder: string;
  requiresAccountId?: boolean;
  accountId?: string;
  supportsAnonymous?: boolean;
  anonymousMode?: boolean;
  enabled: boolean;
  baseUrl?: string;
  defaultBaseUrl: string;
  chatEndpoint?: string;
  modelsEndpoint?: string;
  defaultModel?: string;
  status?: PublicProviderConfig['status'];
  lastCheckedAt?: string;
  lastLatencyMs?: number;
}

export interface PwaVaultSnapshotPayload {
  version: number;
  savedAt: string;
  settings: AppSettings;
  providers: PwaProviderSnapshot[];
  secrets: Record<string, PwaSecretEntry>;
  models?: ModelInfo[];
  chatSessions?: ChatSession[];
}

export interface PwaRestoreResponse {
  restored: boolean;
  providers: PublicProviderConfig[];
  settings: AppSettings;
  models: ModelInfo[];
  chatSessions: ChatSession[];
  gateway: GatewayStatus;
}

const DB_NAME = 'free-ai-hub-pwa-vault';
const DB_VERSION = 1;
const KEY_STORE = 'keys';
const SNAPSHOT_STORE = 'snapshots';
const DEVICE_KEY_ID = 'device-aes-key';
const SNAPSHOT_ID = 'latest';
const FALLBACK_STORAGE_KEY = 'free-ai-hub::pwa-vault-fallback';

interface StoredEncryptedSnapshot {
  encrypted: true;
  iv: number[];
  ciphertext: number[];
  savedAt: string;
}

interface StoredPlainSnapshot {
  encrypted: false;
  payload: PwaVaultSnapshotPayload;
  savedAt: string;
}

type StoredSnapshotRecord = StoredEncryptedSnapshot | StoredPlainSnapshot;

let persistRequested = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncInFlight: Promise<void> | null = null;

function requestPersistentStorageOnce(): void {
  if (persistRequested || typeof navigator === 'undefined') return;
  persistRequested = true;
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      void navigator.storage.persist().catch(() => {});
    }
  } catch {
    // ignore
  }
}

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB non disponibile'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE);
      }
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Errore apertura IndexedDB'));
  });
}

function idbGet<T>(db: IDBDatabase, storeName: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error ?? new Error('Errore lettura IndexedDB'));
  });
}

function idbPut(db: IDBDatabase, storeName: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('Errore scrittura IndexedDB'));
  });
}

async function getOrCreateDeviceKey(db: IDBDatabase): Promise<CryptoKey | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return null;
  }
  const existing = await idbGet<CryptoKey>(db, KEY_STORE, DEVICE_KEY_ID);
  if (existing) {
    return existing;
  }
  const generated = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  await idbPut(db, KEY_STORE, DEVICE_KEY_ID, generated);
  return generated;
}

export async function savePwaVaultSnapshot(payload: PwaVaultSnapshotPayload): Promise<void> {
  requestPersistentStorageOnce();
  try {
    const db = await openVaultDb();
    try {
      const key = await getOrCreateDeviceKey(db);
      if (key && typeof crypto !== 'undefined' && crypto.subtle) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(JSON.stringify(payload));
        const encryptedBuf = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          key,
          encoded,
        );
        const record: StoredEncryptedSnapshot = {
          encrypted: true,
          iv: Array.from(iv),
          ciphertext: Array.from(new Uint8Array(encryptedBuf)),
          savedAt: payload.savedAt,
        };
        await idbPut(db, SNAPSHOT_STORE, SNAPSHOT_ID, record);
        return;
      }

      const plainRecord: StoredPlainSnapshot = {
        encrypted: false,
        payload,
        savedAt: payload.savedAt,
      };
      await idbPut(db, SNAPSHOT_STORE, SNAPSHOT_ID, plainRecord);
      return;
    } finally {
      db.close();
    }
  } catch {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(payload));
      }
    } catch {
      // ignore quota/private mode errors
    }
  }
}

export async function loadPwaVaultSnapshot(): Promise<PwaVaultSnapshotPayload | null> {
  requestPersistentStorageOnce();
  try {
    const db = await openVaultDb();
    try {
      const record = await idbGet<StoredSnapshotRecord>(db, SNAPSHOT_STORE, SNAPSHOT_ID);
      if (record) {
        if (!record.encrypted) {
          return record.payload;
        }
        const key = await idbGet<CryptoKey>(db, KEY_STORE, DEVICE_KEY_ID);
        if (key && typeof crypto !== 'undefined' && crypto.subtle) {
          const iv = new Uint8Array(record.iv);
          const ciphertext = new Uint8Array(record.ciphertext);
          const decryptedBuf = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            ciphertext,
          );
          const json = new TextDecoder().decode(decryptedBuf);
          return JSON.parse(json) as PwaVaultSnapshotPayload;
        }
      }
    } finally {
      db.close();
    }
  } catch {
    // Fall through to localStorage fallback check
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(FALLBACK_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw) as PwaVaultSnapshotPayload;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function hasSavedConfigInSnapshot(snapshot: PwaVaultSnapshotPayload | null): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const secrets = snapshot.secrets ?? {};
  const hasSecrets = Object.values(secrets).some((entry) => {
    if (!entry) return false;
    if (typeof entry.apiKey === 'string' && entry.apiKey.trim().length > 0) return true;
    if (Array.isArray(entry.apiKeys) && entry.apiKeys.some((k) => Boolean(k?.apiKey?.trim()))) {
      return true;
    }
    return Boolean(entry.customHeaders && Object.keys(entry.customHeaders).length > 0);
  });
  if (hasSecrets) return true;

  const providers = Array.isArray(snapshot.providers) ? snapshot.providers : [];
  return providers.some((p) => p.kind === 'custom' || Boolean(p.anonymousMode));
}

export async function syncServerToPwaVault(): Promise<void> {
  if (syncInFlight) {
    return syncInFlight;
  }
  syncInFlight = (async () => {
    try {
      const res = await fetch('/api/pwa-sync/snapshot', { cache: 'no-store' });
      if (!res.ok) return;
      const snapshot = (await res.json()) as PwaVaultSnapshotPayload;
      if (snapshot && typeof snapshot === 'object') {
        await savePwaVaultSnapshot(snapshot);
      }
    } catch {
      // ignore transient network failures
    } finally {
      syncInFlight = null;
    }
  })();
  return syncInFlight;
}

export function schedulePwaVaultSync(delayMs = 200): void {
  if (typeof window === 'undefined') return;
  if (syncTimer) {
    clearTimeout(syncTimer);
  }
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void syncServerToPwaVault();
  }, delayMs);
}

export async function restorePwaSnapshotToServer(
  snapshot: PwaVaultSnapshotPayload,
): Promise<PwaRestoreResponse> {
  const res = await fetch('/api/pwa-sync/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ snapshot }),
  });
  if (!res.ok) {
    throw new Error(`Ripristino snapshot PWA fallito (HTTP ${res.status})`);
  }
  return (await res.json()) as PwaRestoreResponse;
}
