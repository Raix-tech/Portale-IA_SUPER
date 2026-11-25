import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AutoApproveSettings,
  PcAccessMode,
  PcAccessSettings,
  PcCustomToolDefinition,
  PcDiscoveredTool,
  PcDiscoverySnapshot,
  PcExecuteResult,
  PcToolCategory,
  PcToolCustomGroup,
} from '../src/types/ai.ts';
import {
  detectInteractiveAuthCommand,
  evaluatePcAutoApprove,
  getDefaultAutoApproveSettings,
} from '../src/utils/autoApprove.ts';

const SCRIPT_TMP_DIR = path.join(os.tmpdir(), 'free-ai-hub-pc-scripts');
const MAX_OUTPUT_BYTES = 512 * 1024;
const EXEC_TIMEOUT_MS = 30_000;
const INTERACTIVE_EXEC_TIMEOUT_MS = 120_000;
const PATH_SCAN_LIMIT = 240;
const DESKTOP_SCAN_LIMIT = 140;

interface BuiltinToolSpec {
  id: string;
  name: string;
  category: PcToolCategory;
  customGroup: PcToolCustomGroup;
  executables: Record<'win32' | 'darwin' | 'linux', string[]>;
  knownPaths?: Record<'win32' | 'darwin' | 'linux', string[]>;
  versionArgs?: string[];
  isGui?: boolean;
  supportsScripts?: boolean;
  description: string;
}

const BUILTIN_TOOLS: BuiltinToolSpec[] = [
  {
    id: 'powershell',
    name: 'PowerShell',
    category: 'terminal',
    customGroup: 'powershell',
    executables: {
      win32: ['pwsh.exe', 'powershell.exe'],
      darwin: ['pwsh'],
      linux: ['pwsh'],
    },
    knownPaths: {
      win32: [
        'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ],
      darwin: ['/usr/local/bin/pwsh', '/opt/homebrew/bin/pwsh'],
      linux: ['/usr/bin/pwsh', '/snap/bin/pwsh'],
    },
    versionArgs: ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'],
    supportsScripts: true,
    description: 'Shell e motore di scripting PowerShell (.ps1, cmdlet e automazione sistema).',
  },
  {
    id: 'cmd',
    name: 'Prompt dei comandi / CMD',
    category: 'terminal',
    customGroup: 'powershell',
    executables: {
      win32: ['cmd.exe'],
      darwin: [],
      linux: [],
    },
    knownPaths: {
      win32: ['C:\\Windows\\System32\\cmd.exe'],
      darwin: [],
      linux: [],
    },
    supportsScripts: true,
    description: 'Interprete comandi Windows (CMD) ed esecuzione script Batch (.bat / .cmd).',
  },
  {
    id: 'windows-terminal',
    name: 'Windows Terminal',
    category: 'terminal',
    customGroup: 'powershell',
    executables: {
      win32: ['wt.exe'],
      darwin: [],
      linux: [],
    },
    knownPaths: {
      win32: ['%LOCALAPPDATA%\\Microsoft\\WindowsApps\\wt.exe'],
      darwin: [],
      linux: [],
    },
    isGui: true,
    description: 'Terminale moderno Windows multi-scheda (PowerShell, CMD, WSL).',
  },
  {
    id: 'bash',
    name: 'Bash / Shell POSIX',
    category: 'terminal',
    customGroup: 'other',
    executables: {
      win32: ['bash.exe'],
      darwin: ['bash', 'zsh'],
      linux: ['bash', 'sh'],
    },
    knownPaths: {
      win32: ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Windows\\System32\\bash.exe'],
      darwin: ['/bin/bash', '/bin/zsh', '/opt/homebrew/bin/bash'],
      linux: ['/bin/bash', '/usr/bin/bash', '/bin/sh'],
    },
    versionArgs: ['--version'],
    supportsScripts: true,
    description: 'Interprete shell Bash / POSIX per comandi e script .sh.',
  },
  {
    id: 'python',
    name: 'Python',
    category: 'python',
    customGroup: 'python',
    executables: {
      win32: ['python.exe', 'py.exe', 'python3.exe'],
      darwin: ['python3', 'python'],
      linux: ['python3', 'python'],
    },
    knownPaths: {
      win32: [
        '%LOCALAPPDATA%\\Programs\\Python\\Python313\\python.exe',
        '%LOCALAPPDATA%\\Programs\\Python\\Python312\\python.exe',
        '%LOCALAPPDATA%\\Programs\\Python\\Python311\\python.exe',
        'C:\\Python312\\python.exe',
      ],
      darwin: ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3'],
      linux: ['/usr/bin/python3', '/usr/local/bin/python3'],
    },
    versionArgs: ['--version'],
    supportsScripts: true,
    description: 'Interprete Python per script, automazione dati, analisi e utility.',
  },
  {
    id: 'node',
    name: 'Node.js',
    category: 'node',
    customGroup: 'other',
    executables: {
      win32: ['node.exe'],
      darwin: ['node'],
      linux: ['node'],
    },
    knownPaths: {
      win32: ['C:\\Program Files\\nodejs\\node.exe'],
      darwin: ['/opt/homebrew/bin/node', '/usr/local/bin/node'],
      linux: ['/usr/bin/node', '/usr/local/bin/node'],
    },
    versionArgs: ['--version'],
    supportsScripts: true,
    description: 'Runtime JavaScript Node.js per eseguire script JS/TS e automazioni.',
  },
  {
    id: 'npm',
    name: 'npm',
    category: 'node',
    customGroup: 'other',
    executables: {
      win32: ['npm.cmd', 'npm'],
      darwin: ['npm'],
      linux: ['npm'],
    },
    knownPaths: {
      win32: ['C:\\Program Files\\nodejs\\npm.cmd'],
      darwin: ['/opt/homebrew/bin/npm', '/usr/local/bin/npm'],
      linux: ['/usr/bin/npm', '/usr/local/bin/npm'],
    },
    versionArgs: ['--version'],
    description: 'Package manager Node.js per gestire pacchetti e script di progetto.',
  },
  {
    id: 'npx',
    name: 'npx',
    category: 'node',
    customGroup: 'other',
    executables: {
      win32: ['npx.cmd', 'npx'],
      darwin: ['npx'],
      linux: ['npx'],
    },
    knownPaths: {
      win32: ['C:\\Program Files\\nodejs\\npx.cmd'],
      darwin: ['/opt/homebrew/bin/npx', '/usr/local/bin/npx'],
      linux: ['/usr/bin/npx', '/usr/local/bin/npx'],
    },
    versionArgs: ['--version'],
    description: 'Runner CLI per pacchetti e strumenti Node.js.',
  },
  {
    id: 'git',
    name: 'Git',
    category: 'git',
    customGroup: 'git',
    executables: {
      win32: ['git.exe'],
      darwin: ['git'],
      linux: ['git'],
    },
    knownPaths: {
      win32: ['C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files\\Git\\bin\\git.exe'],
      darwin: ['/opt/homebrew/bin/git', '/usr/bin/git'],
      linux: ['/usr/bin/git', '/usr/local/bin/git'],
    },
    versionArgs: ['--version'],
    description: 'Sistema di controllo versione Git (status, diff, log, commit, branch).',
  },
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    category: 'ide',
    customGroup: 'vscode',
    executables: {
      win32: ['code.cmd', 'Code.exe', 'code'],
      darwin: ['code'],
      linux: ['code'],
    },
    knownPaths: {
      win32: [
        '%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\bin\\code.cmd',
        '%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe',
        'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd',
        'C:\\Program Files\\Microsoft VS Code\\Code.exe',
      ],
      darwin: [
        '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
        '/usr/local/bin/code',
      ],
      linux: ['/usr/bin/code', '/snap/bin/code'],
    },
    versionArgs: ['--version'],
    isGui: true,
    description: 'Editor Visual Studio Code (apertura file/progetti e gestione estensioni).',
  },
  {
    id: 'ms-word',
    name: 'Microsoft Word',
    category: 'office',
    customGroup: 'office',
    executables: {
      win32: ['winword.exe'],
      darwin: ['Microsoft Word'],
      linux: [],
    },
    knownPaths: {
      win32: [
        'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE',
        'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\WINWORD.EXE',
        'C:\\Program Files\\Microsoft Office\\Office16\\WINWORD.EXE',
      ],
      darwin: ['/Applications/Microsoft Word.app/Contents/MacOS/Microsoft Word'],
      linux: [],
    },
    isGui: true,
    description: 'Microsoft Word per apertura e gestione documenti .docx / .doc.',
  },
  {
    id: 'ms-excel',
    name: 'Microsoft Excel',
    category: 'office',
    customGroup: 'office',
    executables: {
      win32: ['excel.exe'],
      darwin: ['Microsoft Excel'],
      linux: [],
    },
    knownPaths: {
      win32: [
        'C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE',
        'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\EXCEL.EXE',
        'C:\\Program Files\\Microsoft Office\\Office16\\EXCEL.EXE',
      ],
      darwin: ['/Applications/Microsoft Excel.app/Contents/MacOS/Microsoft Excel'],
      linux: [],
    },
    isGui: true,
    description: 'Microsoft Excel per cartelle di lavoro .xlsx / .csv.',
  },
  {
    id: 'ms-powerpoint',
    name: 'Microsoft PowerPoint',
    category: 'office',
    customGroup: 'office',
    executables: {
      win32: ['powerpnt.exe'],
      darwin: ['Microsoft PowerPoint'],
      linux: [],
    },
    knownPaths: {
      win32: [
        'C:\\Program Files\\Microsoft Office\\root\\Office16\\POWERPNT.EXE',
        'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\POWERPNT.EXE',
        'C:\\Program Files\\Microsoft Office\\Office16\\POWERPNT.EXE',
      ],
      darwin: ['/Applications/Microsoft PowerPoint.app/Contents/MacOS/Microsoft PowerPoint'],
      linux: [],
    },
    isGui: true,
    description: 'Microsoft PowerPoint per presentazioni .pptx.',
  },
  {
    id: 'ms-outlook',
    name: 'Microsoft Outlook',
    category: 'office',
    customGroup: 'office',
    executables: {
      win32: ['outlook.exe', 'olk.exe'],
      darwin: ['Microsoft Outlook'],
      linux: [],
    },
    knownPaths: {
      win32: [
        'C:\\Program Files\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE',
        'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE',
        '%LOCALAPPDATA%\\Microsoft\\WindowsApps\\olk.exe',
      ],
      darwin: ['/Applications/Microsoft Outlook.app/Contents/MacOS/Microsoft Outlook'],
      linux: [],
    },
    isGui: true,
    description: 'Client email e calendario Microsoft Outlook.',
  },
  {
    id: 'ms-access',
    name: 'Microsoft Access',
    category: 'office',
    customGroup: 'office',
    executables: {
      win32: ['msaccess.exe'],
      darwin: [],
      linux: [],
    },
    knownPaths: {
      win32: [
        'C:\\Program Files\\Microsoft Office\\root\\Office16\\MSACCESS.EXE',
        'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\MSACCESS.EXE',
      ],
      darwin: [],
      linux: [],
    },
    isGui: true,
    description: 'Database desktop Microsoft Access (.accdb / .mdb).',
  },
  {
    id: 'ms-edge',
    name: 'Microsoft Edge',
    category: 'browser',
    customGroup: 'browser',
    executables: {
      win32: ['msedge.exe'],
      darwin: ['Microsoft Edge'],
      linux: ['microsoft-edge', 'microsoft-edge-stable'],
    },
    knownPaths: {
      win32: [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      ],
      darwin: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
      linux: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'],
    },
    isGui: true,
    description: 'Browser web Microsoft Edge per aprire URL locali o pagine web.',
  },
  {
    id: 'chrome',
    name: 'Google Chrome',
    category: 'browser',
    customGroup: 'browser',
    executables: {
      win32: ['chrome.exe'],
      darwin: ['Google Chrome'],
      linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'],
    },
    knownPaths: {
      win32: [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        '%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe',
      ],
      darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
      linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
    },
    isGui: true,
    description: 'Browser web Google Chrome / Chromium.',
  },
  {
    id: 'firefox',
    name: 'Mozilla Firefox',
    category: 'browser',
    customGroup: 'browser',
    executables: {
      win32: ['firefox.exe'],
      darwin: ['firefox'],
      linux: ['firefox'],
    },
    knownPaths: {
      win32: [
        'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
        'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
      ],
      darwin: ['/Applications/Firefox.app/Contents/MacOS/firefox'],
      linux: ['/usr/bin/firefox', '/snap/bin/firefox'],
    },
    isGui: true,
    description: 'Browser web Mozilla Firefox.',
  },
];

const PRIORITY_PATH_TOOLS = new Set([
  'curl',
  'wget',
  'tar',
  'zip',
  'unzip',
  '7z',
  'docker',
  'docker-compose',
  'kubectl',
  'terraform',
  'gh',
  'pip',
  'pip3',
  'poetry',
  'uv',
  'conda',
  'pnpm',
  'yarn',
  'bun',
  'deno',
  'tsx',
  'tsc',
  'go',
  'cargo',
  'rustc',
  'java',
  'javac',
  'mvn',
  'gradle',
  'dotnet',
  'ruby',
  'php',
  'perl',
  'sqlite3',
  'psql',
  'mysql',
  'ffmpeg',
  'imagemagick',
  'magick',
  'pandoc',
  'rg',
  'fd',
  'jq',
  'make',
  'cmake',
  'gcc',
  'g++',
  'clang',
  'ssh',
  'scp',
  'rsync',
  'winget',
  'choco',
  'scoop',
  'brew',
  'apt',
  'systemctl',
  'wsl',
  'notepad',
  'explorer',
  'libreoffice',
  'soffice',
]);

let cachedSnapshot: PcDiscoverySnapshot | null = null;
let cachedCustomHash = '';

export function getDefaultPcAccessSettings(): PcAccessSettings {
  return {
    mode: 'none',
    allowAllInstalled: false,
    allowedGroups: {
      powershell: false,
      python: false,
      office: false,
      browser: false,
      git: false,
      vscode: false,
      other: false,
    },
    disabledToolIds: [],
    enabledToolIds: [],
    customTools: [],
  };
}

export function sanitizePcAccessSettings(
  raw: Partial<PcAccessSettings> | undefined,
  fallback: PcAccessSettings = getDefaultPcAccessSettings(),
): PcAccessSettings {
  const mode: PcAccessMode =
    raw?.mode === 'none' ||
    raw?.mode === 'limited' ||
    raw?.mode === 'custom' ||
    raw?.mode === 'full'
      ? raw.mode
      : fallback.mode;

  const rawGroups = (raw?.allowedGroups ?? {}) as Partial<Record<PcToolCustomGroup, unknown>>;
  const allowedGroups: Record<PcToolCustomGroup, boolean> = {
    powershell:
      typeof rawGroups.powershell === 'boolean'
        ? rawGroups.powershell
        : fallback.allowedGroups.powershell,
    python:
      typeof rawGroups.python === 'boolean' ? rawGroups.python : fallback.allowedGroups.python,
    office:
      typeof rawGroups.office === 'boolean' ? rawGroups.office : fallback.allowedGroups.office,
    browser:
      typeof rawGroups.browser === 'boolean' ? rawGroups.browser : fallback.allowedGroups.browser,
    git: typeof rawGroups.git === 'boolean' ? rawGroups.git : fallback.allowedGroups.git,
    vscode:
      typeof rawGroups.vscode === 'boolean' ? rawGroups.vscode : fallback.allowedGroups.vscode,
    other: typeof rawGroups.other === 'boolean' ? rawGroups.other : fallback.allowedGroups.other,
  };

  const cleanIds = (arr: unknown, prev: string[]): string[] => {
    if (!Array.isArray(arr)) return prev;
    return Array.from(
      new Set(
        arr
          .filter((id): id is string => typeof id === 'string')
          .map((id) => id.trim())
          .filter((id) => id.length > 0 && id.length <= 160),
      ),
    );
  };

  const validCategory = (cat: unknown): PcToolCategory => {
    const allowed: PcToolCategory[] = [
      'terminal',
      'python',
      'node',
      'git',
      'ide',
      'office',
      'browser',
      'cli',
      'desktop',
      'custom',
    ];
    return typeof cat === 'string' && allowed.includes(cat as PcToolCategory)
      ? (cat as PcToolCategory)
      : 'custom';
  };

  const customTools: PcCustomToolDefinition[] = Array.isArray(raw?.customTools)
    ? raw.customTools
        .filter((item): item is PcCustomToolDefinition => Boolean(item && typeof item === 'object'))
        .map((item) => ({
          id:
            typeof item.id === 'string' && item.id.trim()
              ? item.id.trim().slice(0, 80)
              : `custom-${crypto.randomUUID().slice(0, 8)}`,
          name: typeof item.name === 'string' ? item.name.trim().slice(0, 80) : '',
          executable:
            typeof item.executable === 'string' ? item.executable.trim().slice(0, 300) : '',
          category: validCategory(item.category),
          isGui: Boolean(item.isGui),
          description:
            typeof item.description === 'string'
              ? item.description.trim().slice(0, 220)
              : undefined,
        }))
        .filter((item) => item.name.length > 0 && item.executable.length > 0)
    : fallback.customTools;

  return {
    mode,
    allowAllInstalled:
      typeof raw?.allowAllInstalled === 'boolean'
        ? raw.allowAllInstalled
        : fallback.allowAllInstalled,
    allowedGroups,
    disabledToolIds: cleanIds(raw?.disabledToolIds, fallback.disabledToolIds),
    enabledToolIds: cleanIds(raw?.enabledToolIds, fallback.enabledToolIds),
    customTools,
  };
}

function getCurrentPlatform(): 'win32' | 'darwin' | 'linux' {
  if (process.platform === 'win32') return 'win32';
  if (process.platform === 'darwin') return 'darwin';
  return 'linux';
}

function expandEnvVars(p: string): string {
  return p.replace(/%([^%]+)%/g, (_, key: string) => process.env[key] || `%${key}%`);
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (process.platform === 'win32') {
      const ext = path.extname(filePath).toLowerCase();
      return ext === '.exe' || ext === '.cmd' || ext === '.bat' || ext === '.com' || ext === '.ps1';
    }
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveExecutableInPath(cmdName: string): string | undefined {
  if (!cmdName) return undefined;
  if (path.isAbsolute(cmdName)) {
    return isExecutableFile(cmdName) ? cmdName : undefined;
  }
  const pathEnv = process.env.PATH || '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
      : [''];

  for (const dir of dirs) {
    const cleanDir = dir.replace(/^"|"$/g, '');
    const candidateDirect = path.join(cleanDir, cmdName);
    if (isExecutableFile(candidateDirect)) return candidateDirect;
    if (process.platform === 'win32' && !path.extname(cmdName)) {
      for (const ext of exts) {
        const withExt = path.join(cleanDir, `${cmdName}${ext.toLowerCase()}`);
        if (isExecutableFile(withExt)) return withExt;
        const withUpper = path.join(cleanDir, `${cmdName}${ext.toUpperCase()}`);
        if (isExecutableFile(withUpper)) return withUpper;
      }
    }
  }
  return undefined;
}

function probeVersionSafe(executablePath: string, args?: string[]): string | undefined {
  if (!args || args.length === 0) return undefined;
  try {
    const out = execFileSync(executablePath, args, {
      encoding: 'utf8',
      timeout: 1500,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const firstLine = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean);
    return firstLine ? firstLine.slice(0, 80) : undefined;
  } catch {
    return undefined;
  }
}

function slugifyId(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 48) || 'tool'
  );
}

function discoverPathExecutables(knownExecutables: Set<string>): PcDiscoveredTool[] {
  const pathEnv = process.env.PATH || '';
  const dirs = Array.from(
    new Set(pathEnv.split(path.delimiter).map((d) => d.trim().replace(/^"|"$/g, '')).filter(Boolean)),
  );

  const prioritized: PcDiscoveredTool[] = [];
  const regular: PcDiscoveredTool[] = [];
  const seenNames = new Set<string>();

  for (const dir of dirs) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      const fileName = entry.name;
      const lower = fileName.toLowerCase();
      if (process.platform === 'win32') {
        const ext = path.extname(lower);
        if (ext !== '.exe' && ext !== '.cmd' && ext !== '.bat') continue;
      }
      const baseName =
        process.platform === 'win32' ? fileName.replace(/\.(exe|cmd|bat)$/i, '') : fileName;
      const baseLower = baseName.toLowerCase();
      if (
        !baseLower ||
        baseLower.startsWith('.') ||
        baseLower.startsWith('[') ||
        knownExecutables.has(lower) ||
        knownExecutables.has(baseLower) ||
        seenNames.has(baseLower)
      ) {
        continue;
      }

      const fullPath = path.join(dir, fileName);
      if (!isExecutableFile(fullPath)) continue;
      seenNames.add(baseLower);

      const isPriority = PRIORITY_PATH_TOOLS.has(baseLower);
      const item: PcDiscoveredTool = {
        id: `path:${slugifyId(baseLower)}`,
        name: baseName,
        category: 'cli',
        customGroup: 'other',
        executable: fileName,
        path: fullPath,
        source: 'path',
        available: true,
        supportsScripts: false,
        description: `Utility CLI nel PATH di sistema (${fullPath})`,
      };

      if (isPriority) {
        prioritized.push(item);
      } else if (regular.length < PATH_SCAN_LIMIT) {
        regular.push(item);
      }
    }
  }

  return [...prioritized, ...regular].slice(0, PATH_SCAN_LIMIT);
}

function discoverDesktopApps(knownExecutables: Set<string>): PcDiscoveredTool[] {
  const platform = getCurrentPlatform();
  const discovered: PcDiscoveredTool[] = [];
  const seenIds = new Set<string>();

  if (platform === 'linux') {
    const appDirs = [
      '/usr/share/applications',
      '/usr/local/share/applications',
      path.join(os.homedir(), '.local/share/applications'),
    ];
    for (const dir of appDirs) {
      let files: string[];
      try {
        files = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith('.desktop')) continue;
        if (discovered.length >= DESKTOP_SCAN_LIMIT) break;
        try {
          const content = fs.readFileSync(path.join(dir, f), 'utf8');
          if (/^NoDisplay=true$/m.test(content) || /^Hidden=true$/m.test(content)) continue;
          const nameMatch = content.match(/^Name=(.+)$/m);
          const execMatch = content.match(/^Exec=(.+)$/m);
          const terminalMatch = content.match(/^Terminal=(true|false)$/m);
          if (!nameMatch || !execMatch) continue;
          const appName = nameMatch[1].trim();
          const rawExec = execMatch[1].trim().replace(/%[fFuUdDnNickvm]/g, '').trim();
          const firstToken = rawExec.match(/^"([^"]+)"|^(\S+)/);
          const exeName = firstToken ? firstToken[1] || firstToken[2] : '';
          if (!exeName) continue;
          const baseExe = path.basename(exeName).toLowerCase();
          if (knownExecutables.has(baseExe)) continue;
          const resolved = resolveExecutableInPath(exeName);
          if (!resolved) continue;
          const id = `desktop:${slugifyId(appName)}`;
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          discovered.push({
            id,
            name: appName,
            category: 'desktop',
            customGroup: 'other',
            executable: path.basename(resolved),
            path: resolved,
            source: 'desktop',
            available: true,
            isGui: terminalMatch?.[1] !== 'true',
            description: `Applicazione desktop installata (${resolved})`,
          });
        } catch {
          // ignore malformed desktop entry
        }
      }
    }
    return discovered;
  }

  if (platform === 'darwin') {
    const appDirs = ['/Applications', path.join(os.homedir(), 'Applications')];
    for (const dir of appDirs) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.name.endsWith('.app')) continue;
        if (discovered.length >= DESKTOP_SCAN_LIMIT) break;
        const appName = entry.name.replace(/\.app$/i, '');
        if (knownExecutables.has(appName.toLowerCase())) continue;
        const macOsDir = path.join(dir, entry.name, 'Contents', 'MacOS');
        try {
          const bins = fs.readdirSync(macOsDir);
          const mainBin = bins.find((b) => isExecutableFile(path.join(macOsDir, b)));
          if (!mainBin) continue;
          const fullPath = path.join(macOsDir, mainBin);
          const id = `desktop:${slugifyId(appName)}`;
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          discovered.push({
            id,
            name: appName,
            category: 'desktop',
            customGroup: 'other',
            executable: mainBin,
            path: fullPath,
            source: 'desktop',
            available: true,
            isGui: true,
            description: `Applicazione macOS (${fullPath})`,
          });
        } catch {
          // ignore inaccessible bundle
        }
      }
    }
    return discovered;
  }

  // Windows Program Files & LocalAppData\Programs scan
  const roots = [
    process.env.ProgramFiles || 'C:\\Program Files',
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : '',
  ].filter(Boolean);

  const ignoredExeRegex = /(unins|setup|update|updater|helper|crash|report|elevate|install)/i;
  for (const root of roots) {
    let folders: fs.Dirent[];
    try {
      folders = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const folder of folders) {
      if (!folder.isDirectory()) continue;
      if (discovered.length >= DESKTOP_SCAN_LIMIT) break;
      const folderPath = path.join(root, folder.name);
      let children: fs.Dirent[];
      try {
        children = fs.readdirSync(folderPath, { withFileTypes: true });
      } catch {
        continue;
      }
      const exes = children
        .filter(
          (c) =>
            c.isFile() &&
            c.name.toLowerCase().endsWith('.exe') &&
            !ignoredExeRegex.test(c.name),
        )
        .map((c) => c.name);
      if (exes.length === 0) continue;
      const folderNorm = folder.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const primary =
        exes.find((e) => e.toLowerCase().replace(/\.exe$/, '').replace(/[^a-z0-9]/g, '') === folderNorm) ||
        exes[0];
      if (!primary) continue;
      if (knownExecutables.has(primary.toLowerCase())) continue;
      const fullPath = path.join(folderPath, primary);
      const id = `desktop:${slugifyId(folder.name)}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      discovered.push({
        id,
        name: folder.name,
        category: 'desktop',
        customGroup: 'other',
        executable: primary,
        path: fullPath,
        source: 'desktop',
        available: true,
        isGui: true,
        description: `Applicazione Windows installata (${fullPath})`,
      });
    }
  }

  return discovered;
}

function buildCustomToolsList(customDefs: PcCustomToolDefinition[]): PcDiscoveredTool[] {
  return customDefs.map((def) => {
    const expanded = expandEnvVars(def.executable.trim());
    const resolved = path.isAbsolute(expanded)
      ? isExecutableFile(expanded)
        ? expanded
        : undefined
      : resolveExecutableInPath(expanded);

    return {
      id: def.id,
      name: def.name,
      category: def.category,
      customGroup: 'other',
      executable: def.executable,
      path: resolved,
      source: 'custom',
      available: Boolean(resolved),
      isGui: Boolean(def.isGui),
      supportsScripts: def.category === 'terminal' || def.category === 'python' || def.category === 'node',
      description:
        def.description ||
        (resolved
          ? `Applicazione personalizzata (${resolved})`
          : `Applicazione personalizzata non trovata (${def.executable})`),
    };
  });
}

export function discoverPcTools(
  pcAccess: PcAccessSettings,
  forceRefresh = false,
): PcDiscoverySnapshot {
  const customHash = JSON.stringify(pcAccess.customTools);
  if (!forceRefresh && cachedSnapshot && cachedCustomHash === customHash) {
    return cachedSnapshot;
  }

  const platform = getCurrentPlatform();
  const knownExecutableSet = new Set<string>();
  const builtinResults: PcDiscoveredTool[] = [];

  for (const spec of BUILTIN_TOOLS) {
    const candidates = spec.executables[platform] || [];
    const knownPaths = (spec.knownPaths?.[platform] || []).map(expandEnvVars);
    for (const exe of candidates) {
      knownExecutableSet.add(exe.toLowerCase());
      knownExecutableSet.add(exe.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase());
    }

    let resolvedPath: string | undefined;
    let resolvedExe = candidates[0] || spec.id;

    for (const candidate of candidates) {
      const hit = resolveExecutableInPath(candidate);
      if (hit) {
        resolvedPath = hit;
        resolvedExe = path.basename(hit);
        break;
      }
    }
    if (!resolvedPath) {
      for (const kp of knownPaths) {
        if (isExecutableFile(kp)) {
          resolvedPath = kp;
          resolvedExe = path.basename(kp);
          break;
        }
      }
    }

    if (resolvedPath) {
      knownExecutableSet.add(path.basename(resolvedPath).toLowerCase());
    }

    const version =
      resolvedPath && !spec.isGui ? probeVersionSafe(resolvedPath, spec.versionArgs) : undefined;

    builtinResults.push({
      id: spec.id,
      name: spec.name,
      category: spec.category,
      customGroup: spec.customGroup,
      executable: resolvedExe,
      path: resolvedPath,
      source: 'builtin',
      available: Boolean(resolvedPath),
      version,
      isGui: Boolean(spec.isGui),
      supportsScripts: Boolean(spec.supportsScripts),
      description: spec.description,
    });
  }

  const pathTools = discoverPathExecutables(knownExecutableSet);
  for (const t of pathTools) {
    knownExecutableSet.add(t.executable.toLowerCase());
  }
  const desktopTools = discoverDesktopApps(knownExecutableSet);
  const customTools = buildCustomToolsList(pcAccess.customTools);

  const tools = [...builtinResults, ...customTools, ...desktopTools, ...pathTools];
  const snapshot: PcDiscoverySnapshot = {
    platform: process.platform,
    hostname: os.hostname(),
    scannedAt: new Date().toISOString(),
    tools,
    availableCount: tools.filter((t) => t.available).length,
    pathCount: pathTools.length,
    desktopCount: desktopTools.length,
  };

  cachedSnapshot = snapshot;
  cachedCustomHash = customHash;
  return snapshot;
}

const LIMITED_SAFE_TOOL_IDS = new Set([
  'git',
  'vscode',
  'windows-terminal',
  'ms-word',
  'ms-excel',
  'ms-powerpoint',
  'ms-outlook',
  'ms-access',
  'ms-edge',
  'chrome',
  'firefox',
]);

export function isPcToolAuthorized(
  tool: PcDiscoveredTool,
  pcAccess: PcAccessSettings,
): boolean {
  if (!tool.available) return false;
  if (pcAccess.mode === 'none') return false;
  if (pcAccess.mode === 'full') return true;

  if (pcAccess.disabledToolIds.includes(tool.id)) return false;

  if (pcAccess.mode === 'limited') {
    if (pcAccess.enabledToolIds.includes(tool.id)) return true;
    return (
      LIMITED_SAFE_TOOL_IDS.has(tool.id) ||
      tool.category === 'browser' ||
      tool.category === 'ide'
    );
  }

  // Custom mode
  if (pcAccess.enabledToolIds.includes(tool.id)) return true;
  if (pcAccess.allowAllInstalled) return true;
  return Boolean(pcAccess.allowedGroups[tool.customGroup]);
}

function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escapeNext = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escapeNext) {
      current += ch;
      escapeNext = false;
      continue;
    }
    if (ch === '\\' && quote !== "'") {
      escapeNext = true;
      continue;
    }
    if ((ch === '"' || ch === "'") && (!quote || quote === ch)) {
      quote = quote === ch ? null : ch;
      continue;
    }
    if (!quote && /\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

function resolveToolForExecution(
  snapshot: PcDiscoverySnapshot,
  pcAccess: PcAccessSettings,
  toolId?: string,
  toolQuery?: string,
): PcDiscoveredTool | null {
  if (toolId) {
    const exact = snapshot.tools.find((t) => t.id === toolId);
    if (exact) return exact;
  }

  const query = (toolQuery || toolId || '').trim().toLowerCase();
  if (query) {
    const byName = snapshot.tools.find(
      (t) =>
        t.id.toLowerCase() === query ||
        t.name.toLowerCase() === query ||
        t.executable.toLowerCase() === query ||
        t.executable.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase() === query,
    );
    if (byName) return byName;

    // Extensible fallback: if Full or Allow All Installed, resolve arbitrary PATH executable dynamically
    if (pcAccess.mode === 'full' || (pcAccess.mode === 'custom' && pcAccess.allowAllInstalled)) {
      const safeName = query.replace(/[^a-z0-9._+-]/gi, '');
      if (safeName && safeName === query) {
        const hit = resolveExecutableInPath(safeName);
        if (hit) {
          return {
            id: `path:${slugifyId(safeName)}`,
            name: safeName,
            category: 'cli',
            customGroup: 'other',
            executable: path.basename(hit),
            path: hit,
            source: 'path',
            available: true,
            description: `Utility CLI nel PATH di sistema (${hit})`,
          };
        }
      }
    }
  }

  return null;
}

function getScriptExtension(toolId: string): string {
  switch (toolId) {
    case 'powershell':
      return '.ps1';
    case 'cmd':
      return '.bat';
    case 'python':
      return '.py';
    case 'node':
      return '.mjs';
    case 'bash':
      return '.sh';
    default:
      return '.txt';
  }
}

export async function executeAuthorizedPcTool(
  params: {
    toolId?: string;
    toolQuery?: string;
    command?: string;
    args?: string[];
    script?: string;
    workingDirectory?: string;
    confirmedByUser: boolean;
    autoApproved?: boolean;
    interactiveConsole?: boolean;
    ephemeralSecret?: string;
  },
  pcAccess: PcAccessSettings,
  autoApprove?: AutoApproveSettings,
): Promise<PcExecuteResult> {
  if (!params.confirmedByUser && !params.autoApproved) {
    throw Object.assign(
      new Error('Esecuzione bloccata: è obbligatoria la conferma esplicita dell’utente.'),
      { statusCode: 403 },
    );
  }

  if (pcAccess.mode === 'none') {
    throw Object.assign(
      new Error(
        'Accesso al PC disabilitato ("Nessun accesso"). Abilita i permessi in Impostazioni → Accesso al PC.',
      ),
      { statusCode: 403 },
    );
  }

  const snapshot = discoverPcTools(pcAccess, false);
  const tool = resolveToolForExecution(snapshot, pcAccess, params.toolId, params.toolQuery);
  if (!tool) {
    throw Object.assign(
      new Error(
        `Strumento "${params.toolId || params.toolQuery || 'sconosciuto'}" non trovato tra i programmi rilevati sul PC.`,
      ),
      { statusCode: 404 },
    );
  }

  if (!tool.available || !tool.path) {
    throw Object.assign(
      new Error(`Lo strumento "${tool.name}" non risulta installato su questa postazione.`),
      { statusCode: 400 },
    );
  }

  if (!isPcToolAuthorized(tool, pcAccess)) {
    throw Object.assign(
      new Error(
        `Permesso negato per "${tool.name}" con il profilo attuale (${pcAccess.mode}). Aggiorna le autorizzazioni in Impostazioni → Accesso al PC.`,
      ),
      { statusCode: 403 },
    );
  }

  if (!params.confirmedByUser && params.autoApproved) {
    const evalRes = evaluatePcAutoApprove(
      params,
      tool,
      autoApprove ?? getDefaultAutoApproveSettings(),
    );
    if (!evalRes.allowed) {
      const reason = evalRes.hasPlaintextCredentials
        ? 'rilevate possibili credenziali in chiaro'
        : evalRes.requiresInteractiveTerminal
          ? 'richiede input interattivo o credenziali'
          : evalRes.missingWorkingDirectoryForMutation
            ? 'directory di lavoro (CWD) mancante per operazione di modifica/script'
            : evalRes.blockedLabels.join(', ');
      throw Object.assign(
        new Error(`Auto-Approve non autorizzato per questa operazione (${reason}). Conferma manualmente.`),
        { statusCode: 403 },
      );
    }
  }

  let cwd = os.homedir();
  if (params.workingDirectory && params.workingDirectory.trim()) {
    const resolvedCwd = path.resolve(params.workingDirectory.trim());
    let isDir = false;
    try {
      isDir = fs.statSync(resolvedCwd).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) {
      throw Object.assign(
        new Error(`La cartella di lavoro "${resolvedCwd}" non esiste o non è accessibile.`),
        { statusCode: 400 },
      );
    }
    cwd = resolvedCwd;
  }

  const executablePath = tool.path;
  let spawnArgs: string[] = [];
  let tempScriptPath: string | null = null;
  let stdinScriptPayload: string | null = null;

  const trimmedScript = typeof params.script === 'string' ? params.script.trim() : '';
  const trimmedCommand = typeof params.command === 'string' ? params.command.trim() : '';
  const explicitArgs = Array.isArray(params.args)
    ? params.args.filter((a): a is string => typeof a === 'string')
    : [];

  const combinedTextForCheck = [trimmedCommand, explicitArgs.join(' '), trimmedScript]
    .filter(Boolean)
    .join('\n');
  const isInteractiveAuth = detectInteractiveAuthCommand(combinedTextForCheck);

  if (trimmedScript) {
    if (!tool.supportsScripts) {
      throw Object.assign(
        new Error(`Lo strumento "${tool.name}" non supporta l'esecuzione diretta di script.`),
        { statusCode: 400 },
      );
    }

    // In-memory script execution (no temp files outside perimeter)
    if (tool.id === 'powershell') {
      const encoded = Buffer.from(params.script!, 'utf16le').toString('base64');
      spawnArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded];
    } else if (tool.id === 'python' || tool.id === 'node') {
      spawnArgs = ['-'];
      stdinScriptPayload = params.script!;
    } else if (tool.id === 'bash') {
      spawnArgs = ['-s'];
      stdinScriptPayload = params.script!;
    } else {
      // Fallback only for tools that cannot execute from stdin/encoded command (e.g. cmd batch)
      fs.mkdirSync(SCRIPT_TMP_DIR, { recursive: true, mode: 0o700 });
      const ext = getScriptExtension(tool.id);
      tempScriptPath = path.join(SCRIPT_TMP_DIR, `aihub-${crypto.randomUUID().slice(0, 10)}${ext}`);
      fs.writeFileSync(tempScriptPath, params.script!, { encoding: 'utf8', mode: 0o600 });

      if (tool.id === 'cmd') {
        spawnArgs = ['/d', '/c', tempScriptPath];
      } else {
        spawnArgs = [tempScriptPath];
      }
    }
  } else if (explicitArgs.length > 0) {
    spawnArgs = explicitArgs;
  } else if (trimmedCommand) {
    if (tool.id === 'powershell') {
      spawnArgs = isInteractiveAuth
        ? ['-NoProfile', '-Command', trimmedCommand]
        : ['-NoProfile', '-NonInteractive', '-Command', trimmedCommand];
    } else if (tool.id === 'cmd') {
      spawnArgs = ['/d', '/s', '/c', trimmedCommand];
    } else if (tool.id === 'bash') {
      spawnArgs = ['-lc', trimmedCommand];
    } else {
      const tokens = tokenizeArgs(trimmedCommand);
      const exeBase = tool.executable.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
      if (
        tokens.length > 0 &&
        (tokens[0].toLowerCase() === tool.executable.toLowerCase() ||
          tokens[0].toLowerCase() === exeBase)
      ) {
        tokens.shift();
      }
      spawnArgs = tokens;
    }
  }

  const commandDisplay = trimmedScript
    ? `${tool.executable} <script in-memory ${getScriptExtension(tool.id)}>`
    : `${tool.executable}${spawnArgs.length > 0 ? ` ${spawnArgs.join(' ')}` : ''}`;

  const startedAt = Date.now();

  // Optional visible Windows interactive console for credential/login prompts
  if (
    params.interactiveConsole &&
    isInteractiveAuth &&
    !params.ephemeralSecret &&
    process.platform === 'win32' &&
    !tool.isGui
  ) {
    try {
      const wtTool = snapshot.tools.find(
        (t) => t.id === 'windows-terminal' && t.available && Boolean(t.path),
      );
      if (wtTool?.path) {
        const child = spawn(wtTool.path, ['-d', cwd, executablePath, ...spawnArgs], {
          cwd,
          detached: true,
          stdio: 'ignore',
          shell: false,
          windowsHide: false,
        });
        child.unref();
      } else {
        const cmdExe =
          snapshot.tools.find((t) => t.id === 'cmd' && t.available && Boolean(t.path))?.path ||
          'cmd.exe';
        const child = spawn(cmdExe, ['/d', '/c', 'start', '""', executablePath, ...spawnArgs], {
          cwd,
          detached: true,
          stdio: 'ignore',
          shell: false,
          windowsHide: false,
        });
        child.unref();
      }
      return {
        ok: true,
        toolId: tool.id,
        toolName: tool.name,
        commandDisplay,
        exitCode: 0,
        stdout: `Console interattiva Windows avviata per "${tool.name}" (${commandDisplay}). Completa l'autenticazione o l'input nella finestra aperta sul PC.`,
        stderr: '',
        launchedGui: true,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      return {
        ok: false,
        toolId: tool.id,
        toolName: tool.name,
        commandDisplay,
        exitCode: null,
        stdout: '',
        stderr:
          err instanceof Error
            ? err.message
            : 'Impossibile aprire la console interattiva Windows.',
        durationMs: Date.now() - startedAt,
        error:
          err instanceof Error
            ? err.message
            : 'Impossibile aprire la console interattiva Windows.',
      };
    }
  }

  // GUI applications (Word, Excel, Chrome, Edge, VS Code without CLI flags) launch detached
  const wantsCliInspection =
    tool.id === 'vscode' &&
    spawnArgs.some((a) => a === '--version' || a === '--list-extensions' || a === '-v');

  if (tool.isGui && !wantsCliInspection) {
    try {
      const child = spawn(executablePath, spawnArgs, {
        cwd,
        detached: true,
        stdio: 'ignore',
        shell: false,
      });
      child.unref();
      return {
        ok: true,
        toolId: tool.id,
        toolName: tool.name,
        commandDisplay,
        exitCode: 0,
        stdout: `Applicazione "${tool.name}" avviata sul PC (${commandDisplay}).`,
        stderr: '',
        launchedGui: true,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      return {
        ok: false,
        toolId: tool.id,
        toolName: tool.name,
        commandDisplay,
        exitCode: null,
        stdout: '',
        stderr: err instanceof Error ? err.message : 'Impossibile avviare applicazione.',
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : 'Impossibile avviare applicazione.',
      };
    } finally {
      if (tempScriptPath) {
        try {
          fs.unlinkSync(tempScriptPath);
        } catch {
          // ignore cleanup failure
        }
      }
    }
  }

  const effectiveTimeoutMs = isInteractiveAuth ? INTERACTIVE_EXEC_TIMEOUT_MS : EXEC_TIMEOUT_MS;

  return await new Promise<PcExecuteResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let settled = false;

    const cleanup = () => {
      if (tempScriptPath) {
        try {
          fs.unlinkSync(tempScriptPath);
        } catch {
          // ignore cleanup failure
        }
      }
    };

    const child = spawn(executablePath, spawnArgs, {
      cwd,
      shell: false,
      windowsHide: !isInteractiveAuth,
    });

    if (child.stdin) {
      if (stdinScriptPayload !== null) {
        child.stdin.write(stdinScriptPayload);
        child.stdin.end();
      } else if (typeof params.ephemeralSecret === 'string' && params.ephemeralSecret.length > 0) {
        child.stdin.write(`${params.ephemeralSecret}\n`);
        child.stdin.end();
      } else if (isInteractiveAuth) {
        child.stdin.end();
      }
    }

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      cleanup();
      resolve({
        ok: false,
        toolId: tool.id,
        toolName: tool.name,
        commandDisplay,
        exitCode: null,
        stdout,
        stderr: `${stderr}\nTimeout: esecuzione interrotta dopo ${effectiveTimeoutMs / 1000} secondi.`.trim(),
        durationMs: Date.now() - startedAt,
        error: `Timeout dopo ${effectiveTimeoutMs / 1000} secondi.`,
      });
    }, effectiveTimeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += chunk.toString('utf8');
        if (stdout.length >= MAX_OUTPUT_BYTES) {
          stdout = `${stdout.slice(0, MAX_OUTPUT_BYTES)}\n... [output troncato a 512 KB]`;
          truncated = true;
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
        stderr += chunk.toString('utf8');
        if (stderr.length >= MAX_OUTPUT_BYTES) {
          stderr = `${stderr.slice(0, MAX_OUTPUT_BYTES)}\n... [stderr troncato a 512 KB]`;
          truncated = true;
        }
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup();
      resolve({
        ok: false,
        toolId: tool.id,
        toolName: tool.name,
        commandDisplay,
        exitCode: null,
        stdout,
        stderr: stderr || err.message,
        durationMs: Date.now() - startedAt,
        error: err.message,
      });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup();
      const ok = code === 0;
      resolve({
        ok,
        toolId: tool.id,
        toolName: tool.name,
        commandDisplay,
        exitCode: code,
        stdout: truncated ? stdout : stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        durationMs: Date.now() - startedAt,
        error: ok ? undefined : stderr.trim() || `Processo terminato con codice ${code}.`,
      });
    });
  });
}
