import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PublicProviderKeyInfo } from '../src/types/ai.ts';
import { ensureDataDir, getDataDir, PROJECT_ROOT } from './dataDir.ts';

function getVaultFile(): string {
  return path.join(getDataDir(), 'vault.enc.json');
}

function getVaultKeyFile(): string {
  return path.join(getDataDir(), 'vault.key');
}

export interface StoredApiKeyEntry {
  id: string;
  label: string;
  apiKey: string;
  createdAt: string;
}

export interface ProviderSecretEntry {
  apiKey?: string;
  apiKeys?: StoredApiKeyEntry[];
  activeKeyId?: string;
  customHeaders?: Record<string, string>;
}

export interface ResolvedProviderSecrets {
  apiKey?: string;
  activeKeyId?: string;
  activeKeyLabel?: string;
  apiKeys: StoredApiKeyEntry[];
  customHeaders?: Record<string, string>;
}

interface EncryptedBlob {
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

type SecretMap = Record<string, ProviderSecretEntry>;

function getOrCreatePersistedKey(): string {
  ensureDataDir();
  const keyFile = getVaultKeyFile();
  if (fs.existsSync(keyFile)) {
    try {
      const existing = fs.readFileSync(keyFile, 'utf8').trim();
      if (existing.length >= 16) {
        return existing;
      }
    } catch {
      // regenerate below
    }
  }
  const generated = crypto.randomBytes(32).toString('base64');
  const tmpFile = `${keyFile}.tmp-${process.pid}`;
  fs.writeFileSync(tmpFile, `${generated}\n`, { mode: 0o600 });
  fs.renameSync(tmpFile, keyFile);
  return generated;
}

function getMasterSeed(): string {
  if (process.env.VAULT_SECRET && process.env.VAULT_SECRET.trim().length > 0) {
    return process.env.VAULT_SECRET.trim();
  }
  return getOrCreatePersistedKey();
}

function getCandidateDecryptSeeds(primarySeed: string): string[] {
  const candidates = [primarySeed];
  const keyFile = getVaultKeyFile();
  if (fs.existsSync(keyFile)) {
    try {
      const persisted = fs.readFileSync(keyFile, 'utf8').trim();
      if (persisted && !candidates.includes(persisted)) {
        candidates.push(persisted);
      }
    } catch {
      // ignore
    }
  }
  const legacyCwd = `free-ai-hub::${os.hostname()}::${process.cwd()}::vault-v1`;
  const legacyRoot = `free-ai-hub::${os.hostname()}::${PROJECT_ROOT}::vault-v1`;
  for (const legacy of [legacyCwd, legacyRoot]) {
    if (!candidates.includes(legacy)) {
      candidates.push(legacy);
    }
  }
  return candidates;
}

function encryptWithPassphrase(plaintext: string, passphrase: string): EncryptedBlob {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

function decryptWithPassphrase(blob: EncryptedBlob, passphrase: string): string {
  const salt = Buffer.from(blob.salt, 'base64');
  const iv = Buffer.from(blob.iv, 'base64');
  const tag = Buffer.from(blob.tag, 'base64');
  const ciphertext = Buffer.from(blob.ciphertext, 'base64');
  const key = crypto.scryptSync(passphrase, salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

function loadVaultMap(): SecretMap {
  ensureDataDir();
  const vaultFile = getVaultFile();
  if (!fs.existsSync(vaultFile)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(vaultFile, 'utf8');
    const blob = JSON.parse(raw) as EncryptedBlob;
    const primarySeed = getMasterSeed();
    const candidates = getCandidateDecryptSeeds(primarySeed);

    for (let i = 0; i < candidates.length; i += 1) {
      try {
        const json = decryptWithPassphrase(blob, candidates[i]);
        const parsed = JSON.parse(json) as SecretMap;
        const map = parsed && typeof parsed === 'object' ? parsed : {};
        // Auto-migrate legacy hostname/cwd-encrypted vaults to stable vault.key
        if (i > 0 && Object.keys(map).length > 0) {
          saveVaultMap(map);
        }
        return map;
      } catch {
        // Try next candidate seed
      }
    }
    return {};
  } catch {
    return {};
  }
}

function saveVaultMap(map: SecretMap): void {
  ensureDataDir();
  const vaultFile = getVaultFile();
  const blob = encryptWithPassphrase(JSON.stringify(map), getMasterSeed());
  const tmpFile = `${vaultFile}.tmp-${process.pid}`;
  fs.writeFileSync(tmpFile, JSON.stringify(blob, null, 2), { mode: 0o600 });
  fs.renameSync(tmpFile, vaultFile);
}

export function maskApiKey(key?: string): string | undefined {
  if (!key || key.trim().length === 0) return undefined;
  const trimmed = key.trim();
  if (trimmed.length <= 8) {
    return '••••••••';
  }
  if (trimmed.length <= 12) {
    return `${trimmed.slice(0, 2)}••••••${trimmed.slice(-2)}`;
  }
  const prefixMatch = trimmed.match(/^[a-zA-Z0-9_-]{2,8}-/);
  const prefix = prefixMatch ? prefixMatch[0] : trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••••••••••${suffix}`;
}

function normalizeEntry(entry?: ProviderSecretEntry): {
  apiKeys: StoredApiKeyEntry[];
  activeKeyId?: string;
  customHeaders?: Record<string, string>;
} {
  if (!entry) {
    return { apiKeys: [] };
  }
  let keys: StoredApiKeyEntry[] = [];
  if (Array.isArray(entry.apiKeys) && entry.apiKeys.length > 0) {
    keys = entry.apiKeys
      .filter((k) => k && typeof k.apiKey === 'string' && k.apiKey.trim().length > 0)
      .map((k, idx) => ({
        id: k.id || `key-${idx + 1}`,
        label: (k.label || `Chiave ${idx + 1}`).trim(),
        apiKey: k.apiKey.trim(),
        createdAt: k.createdAt || new Date().toISOString(),
      }));
  } else if (entry.apiKey && entry.apiKey.trim().length > 0) {
    keys = [
      {
        id: 'key-default',
        label: 'Chiave 1',
        apiKey: entry.apiKey.trim(),
        createdAt: new Date().toISOString(),
      },
    ];
  }

  let activeKeyId = entry.activeKeyId;
  if (keys.length > 0 && !keys.some((k) => k.id === activeKeyId)) {
    activeKeyId = keys[0].id;
  } else if (keys.length === 0) {
    activeKeyId = undefined;
  }

  return {
    apiKeys: keys,
    activeKeyId,
    customHeaders: entry.customHeaders,
  };
}

export function getProviderSecrets(providerId: string): ResolvedProviderSecrets {
  const map = loadVaultMap();
  const normalized = normalizeEntry(map[providerId]);
  const active =
    normalized.apiKeys.find((k) => k.id === normalized.activeKeyId) ?? normalized.apiKeys[0];
  return {
    apiKey: active?.apiKey,
    activeKeyId: active?.id,
    activeKeyLabel: active?.label,
    apiKeys: normalized.apiKeys,
    customHeaders: normalized.customHeaders,
  };
}

export function getPublicProviderKeys(providerId: string): PublicProviderKeyInfo[] {
  const secrets = getProviderSecrets(providerId);
  return secrets.apiKeys.map((k) => ({
    id: k.id,
    label: k.label,
    maskedApiKey: maskApiKey(k.apiKey) || '••••••••',
    createdAt: k.createdAt,
    active: k.id === secrets.activeKeyId,
  }));
}

export function revealProviderKeyById(providerId: string, keyId?: string): string | undefined {
  const secrets = getProviderSecrets(providerId);
  if (secrets.apiKeys.length === 0) return undefined;
  if (keyId) {
    return secrets.apiKeys.find((k) => k.id === keyId)?.apiKey;
  }
  return secrets.apiKey;
}

export function getAllProviderSecrets(): SecretMap {
  return loadVaultMap();
}

export function addProviderApiKey(
  providerId: string,
  apiKey: string,
  label?: string,
  activate = true,
): StoredApiKeyEntry {
  const trimmed = apiKey.trim();
  const map = loadVaultMap();
  const norm = normalizeEntry(map[providerId]);

  const existingSame = norm.apiKeys.find((k) => k.apiKey === trimmed);
  if (existingSame) {
    if (label && label.trim()) {
      existingSame.label = label.trim().slice(0, 48);
    }
    const nextActiveId = activate ? existingSame.id : norm.activeKeyId || existingSame.id;
    map[providerId] = {
      apiKeys: norm.apiKeys,
      activeKeyId: nextActiveId,
      ...(norm.customHeaders ? { customHeaders: norm.customHeaders } : {}),
    };
    saveVaultMap(map);
    return existingSame;
  }

  const nextNumber = norm.apiKeys.length + 1;
  const cleanLabel =
    label && label.trim().length > 0 ? label.trim().slice(0, 48) : `Chiave ${nextNumber}`;
  const entry: StoredApiKeyEntry = {
    id: `key-${crypto.randomUUID().slice(0, 8)}`,
    label: cleanLabel,
    apiKey: trimmed,
    createdAt: new Date().toISOString(),
  };

  const updatedKeys = [...norm.apiKeys, entry];
  const nextActiveId = activate || !norm.activeKeyId ? entry.id : norm.activeKeyId;

  map[providerId] = {
    apiKeys: updatedKeys,
    activeKeyId: nextActiveId,
    ...(norm.customHeaders ? { customHeaders: norm.customHeaders } : {}),
  };
  saveVaultMap(map);
  return entry;
}

export function activateProviderApiKey(providerId: string, keyId: string): StoredApiKeyEntry | null {
  const map = loadVaultMap();
  const norm = normalizeEntry(map[providerId]);
  const target = norm.apiKeys.find((k) => k.id === keyId);
  if (!target) return null;

  map[providerId] = {
    apiKeys: norm.apiKeys,
    activeKeyId: target.id,
    ...(norm.customHeaders ? { customHeaders: norm.customHeaders } : {}),
  };
  saveVaultMap(map);
  return target;
}

export function updateProviderApiKey(
  providerId: string,
  keyId: string,
  patch: { label?: string; apiKey?: string },
): StoredApiKeyEntry | null {
  const map = loadVaultMap();
  const norm = normalizeEntry(map[providerId]);
  const target = norm.apiKeys.find((k) => k.id === keyId);
  if (!target) return null;

  if (patch.label !== undefined && patch.label.trim().length > 0) {
    target.label = patch.label.trim().slice(0, 48);
  }
  if (patch.apiKey !== undefined && patch.apiKey.trim().length > 0) {
    target.apiKey = patch.apiKey.trim();
  }

  map[providerId] = {
    apiKeys: norm.apiKeys,
    activeKeyId: norm.activeKeyId,
    ...(norm.customHeaders ? { customHeaders: norm.customHeaders } : {}),
  };
  saveVaultMap(map);
  return target;
}

export function deleteProviderApiKeyById(
  providerId: string,
  keyId: string,
): { removed: boolean; remainingCount: number } {
  const map = loadVaultMap();
  const norm = normalizeEntry(map[providerId]);
  const filtered = norm.apiKeys.filter((k) => k.id !== keyId);
  if (filtered.length === norm.apiKeys.length) {
    return { removed: false, remainingCount: norm.apiKeys.length };
  }

  if (filtered.length === 0) {
    if (norm.customHeaders && Object.keys(norm.customHeaders).length > 0) {
      map[providerId] = { customHeaders: norm.customHeaders };
    } else {
      delete map[providerId];
    }
  } else {
    const nextActiveId =
      norm.activeKeyId === keyId || !filtered.some((k) => k.id === norm.activeKeyId)
        ? filtered[0].id
        : norm.activeKeyId;
    map[providerId] = {
      apiKeys: filtered,
      activeKeyId: nextActiveId,
      ...(norm.customHeaders ? { customHeaders: norm.customHeaders } : {}),
    };
  }
  saveVaultMap(map);
  return { removed: true, remainingCount: filtered.length };
}

export function setProviderApiKey(providerId: string, apiKey: string, label?: string): void {
  if (providerId === GATEWAY_KEY_ENTRY) {
    const map = loadVaultMap();
    const current = map[providerId] ?? {};
    map[providerId] = {
      ...current,
      apiKey: apiKey.trim(),
    };
    saveVaultMap(map);
    return;
  }
  addProviderApiKey(providerId, apiKey, label, true);
}

export function restoreProviderSecretEntry(
  providerId: string,
  entry: ProviderSecretEntry,
): void {
  const map = loadVaultMap();
  if (providerId.startsWith('__') && typeof entry?.apiKey === 'string' && entry.apiKey.trim()) {
    map[providerId] = { apiKey: entry.apiKey.trim() };
    saveVaultMap(map);
    return;
  }
  const norm = normalizeEntry(entry);
  if (norm.apiKeys.length === 0 && !norm.customHeaders) return;
  map[providerId] = {
    ...(norm.apiKeys.length > 0 ? { apiKeys: norm.apiKeys, activeKeyId: norm.activeKeyId } : {}),
    ...(norm.customHeaders ? { customHeaders: norm.customHeaders } : {}),
  };
  saveVaultMap(map);
}

export function setProviderCustomHeaders(
  providerId: string,
  headers: Record<string, string>,
): void {
  const map = loadVaultMap();
  const norm = normalizeEntry(map[providerId]);
  map[providerId] = {
    ...(norm.apiKeys.length > 0 ? { apiKeys: norm.apiKeys, activeKeyId: norm.activeKeyId } : {}),
    customHeaders: headers,
  };
  saveVaultMap(map);
}

export function deleteProviderApiKey(providerId: string): void {
  const map = loadVaultMap();
  if (map[providerId]) {
    const { customHeaders } = map[providerId];
    if (customHeaders && Object.keys(customHeaders).length > 0) {
      map[providerId] = { customHeaders };
    } else {
      delete map[providerId];
    }
    saveVaultMap(map);
  }
}

export function deleteProviderAllSecrets(providerId: string): void {
  const map = loadVaultMap();
  if (map[providerId]) {
    delete map[providerId];
    saveVaultMap(map);
  }
}

export function encryptBackupPayload(payload: unknown, password: string): EncryptedBlob {
  if (!password || password.length < 6) {
    throw new Error('La password di cifratura deve contenere almeno 6 caratteri.');
  }
  return encryptWithPassphrase(JSON.stringify(payload), password);
}

export function decryptBackupPayload(blob: EncryptedBlob, password: string): unknown {
  if (!password) {
    throw new Error('Inserisci la password per decifrare il backup.');
  }
  try {
    const json = decryptWithPassphrase(blob, password);
    return JSON.parse(json);
  } catch {
    throw new Error('Password errata o file di backup cifrato danneggiato.');
  }
}

const GATEWAY_KEY_ENTRY = '__hub_gateway__';

export function getGatewayTokenStatus(): { hasToken: boolean; maskedToken?: string } {
  const map = loadVaultMap();
  const token = map[GATEWAY_KEY_ENTRY]?.apiKey;
  if (!token) return { hasToken: false };
  return {
    hasToken: true,
    maskedToken: maskApiKey(token),
  };
}

export function generateGatewayToken(): { hasToken: boolean; maskedToken?: string } {
  const token = `faih-${crypto.randomBytes(24).toString('hex')}`;
  setProviderApiKey(GATEWAY_KEY_ENTRY, token);
  return {
    hasToken: true,
    maskedToken: maskApiKey(token),
  };
}

export function revealGatewayToken(): string | undefined {
  const map = loadVaultMap();
  return map[GATEWAY_KEY_ENTRY]?.apiKey;
}

export function revokeGatewayToken(): void {
  deleteProviderAllSecrets(GATEWAY_KEY_ENTRY);
}

export function verifyGatewayToken(candidate?: string): boolean {
  if (!candidate || !candidate.trim()) return false;
  const stored = revealGatewayToken();
  if (!stored) return false;
  const a = Buffer.from(candidate.trim(), 'utf8');
  const b = Buffer.from(stored, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const COPILOT_M365_ENTRY = '__copilot_m365__';
const COPILOT_GITHUB_ENTRY = '__copilot_github__';

export interface CopilotStoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  sessionToken?: string;
  sessionExpiresAt?: string;
  apiEndpoint?: string;
}

export function getCopilotTokens(mode: 'm365' | 'github'): CopilotStoredTokens | null {
  const key = mode === 'm365' ? COPILOT_M365_ENTRY : COPILOT_GITHUB_ENTRY;
  const map = loadVaultMap();
  const raw = map[key]?.apiKey;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CopilotStoredTokens;
    if (parsed && typeof parsed.accessToken === 'string' && parsed.accessToken.length > 0) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveCopilotTokens(
  mode: 'm365' | 'github',
  tokens: CopilotStoredTokens,
): void {
  const key = mode === 'm365' ? COPILOT_M365_ENTRY : COPILOT_GITHUB_ENTRY;
  const map = loadVaultMap();
  map[key] = {
    apiKey: JSON.stringify(tokens),
  };
  saveVaultMap(map);
}

export function clearCopilotTokens(mode: 'm365' | 'github'): void {
  const key = mode === 'm365' ? COPILOT_M365_ENTRY : COPILOT_GITHUB_ENTRY;
  deleteProviderAllSecrets(key);
}
