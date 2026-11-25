import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(SERVER_DIR, '..');

let cachedDataDir: string | null = null;

function isWritableDir(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const probe = path.join(dir, `.probe-${process.pid}`);
    fs.writeFileSync(probe, 'ok', { mode: 0o600 });
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

export function getDataDir(): string {
  if (cachedDataDir) {
    return cachedDataDir;
  }

  const envDir = process.env.FREE_AI_HUB_DATA_DIR?.trim();
  const candidates = [
    ...(envDir ? [path.resolve(envDir)] : []),
    path.join(PROJECT_ROOT, '.free-ai-hub-data'),
    path.join(os.homedir(), '.free-ai-hub-data'),
    path.join(process.cwd(), '.free-ai-hub-data'),
  ];

  for (const candidate of candidates) {
    if (isWritableDir(candidate)) {
      cachedDataDir = candidate;
      return candidate;
    }
  }

  cachedDataDir = path.join(PROJECT_ROOT, '.free-ai-hub-data');
  return cachedDataDir;
}

export function ensureDataDir(): string {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}
