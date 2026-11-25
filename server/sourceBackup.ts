import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'dev-dist',
  '.git',
  '.aistudio',
  '.free-ai-hub-data',
  '.cache',
  '.turbo',
  'tmp',
]);

const MAX_ARCHIVE_FILES = 2000;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

export interface SourceBackupEntryInfo {
  relativePath: string;
  size: number;
}

export interface SourceBackupManifest {
  fileCount: number;
  totalBytes: number;
  files: SourceBackupEntryInfo[];
}

function isExcludedFile(name: string): boolean {
  if (name === '.env.example') return false;
  if (name === '.env' || name.startsWith('.env.')) return true;
  if (/\.(pem|key|p12|pfx|tsbuildinfo|log)$/i.test(name)) return true;
  if (/\.enc\.json$/i.test(name)) return true;
  if (name === '.DS_Store' || name === 'Thumbs.db') return true;
  return false;
}

function collectProjectFiles(rootDir: string): Array<{
  absPath: string;
  relPath: string;
  size: number;
  mtime: Date;
}> {
  const realRoot = fs.realpathSync(rootDir);
  const results: Array<{
    absPath: string;
    relPath: string;
    size: number;
    mtime: Date;
  }> = [];
  let totalBytes = 0;

  function walk(currentDir: string, relPrefix: string): void {
    if (results.length >= MAX_ARCHIVE_FILES) return;
    const dirents = fs.readdirSync(currentDir, { withFileTypes: true });
    dirents.sort((a, b) => a.name.localeCompare(b.name));

    for (const dirent of dirents) {
      if (results.length >= MAX_ARCHIVE_FILES) break;
      const absCandidate = path.resolve(currentDir, dirent.name);
      if (!absCandidate.startsWith(realRoot + path.sep)) {
        continue;
      }

      let realCandidate: string;
      try {
        realCandidate = fs.realpathSync(absCandidate);
      } catch {
        continue;
      }
      if (!realCandidate.startsWith(realRoot + path.sep)) {
        continue;
      }

      const relPath = relPrefix ? `${relPrefix}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        if (EXCLUDED_DIRS.has(dirent.name)) continue;
        walk(realCandidate, relPath);
      } else if (dirent.isFile()) {
        if (isExcludedFile(dirent.name)) continue;
        const stat = fs.statSync(realCandidate);
        if (totalBytes + stat.size > MAX_TOTAL_BYTES) continue;
        totalBytes += stat.size;
        results.push({
          absPath: realCandidate,
          relPath: relPath.replace(/\\/g, '/'),
          size: stat.size,
          mtime: stat.mtime,
        });
      }
    }
  }

  walk(realRoot, '');
  return results;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
}

export function getSourceBackupManifest(rootDir = process.cwd()): SourceBackupManifest {
  const collected = collectProjectFiles(rootDir);
  return {
    fileCount: collected.length,
    totalBytes: collected.reduce((acc, item) => acc + item.size, 0),
    files: collected.map((item) => ({
      relativePath: item.relPath,
      size: item.size,
    })),
  };
}

export function sanitizeBackupArchiveFileName(input?: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const raw = (input || '').trim();
  const baseOnly = raw.split(/[\\/]/).pop() || '';
  let cleaned = baseOnly.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-');
  cleaned = cleaned.replace(/^\.+/, '').slice(0, 96);
  if (!cleaned) {
    cleaned = `free-ai-hub-source-${today}.zip`;
  }
  if (!cleaned.toLowerCase().endsWith('.zip')) {
    cleaned = `${cleaned}.zip`;
  }
  return cleaned;
}

export function buildSourceBackupZip(rootDir = process.cwd()): {
  zipBuffer: Buffer;
  fileCount: number;
  uncompressedBytes: number;
} {
  const files = collectProjectFiles(rootDir);
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;
  let uncompressedBytes = 0;

  for (const file of files) {
    const raw = fs.readFileSync(file.absPath);
    uncompressedBytes += raw.length;
    const compressed = zlib.deflateRawSync(raw, { level: 6 });
    const checksum = crc32(raw);
    const nameBuf = Buffer.from(file.relPath, 'utf8');
    const { dosTime, dosDate } = toDosDateTime(file.mtime);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    localChunks.push(localHeader, nameBuf, compressed);
    centralChunks.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return {
    zipBuffer: Buffer.concat([...localChunks, centralDirectory, eocd]),
    fileCount: files.length,
    uncompressedBytes,
  };
}
