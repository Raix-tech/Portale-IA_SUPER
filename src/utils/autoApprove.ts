import type {
  AutoApproveCategoryId,
  AutoApproveProfileId,
  AutoApproveSettings,
  PcDiscoveredTool,
} from '../types/ai.ts';

export interface AutoApproveItemMeta<K extends string = string> {
  key: K;
  label: string;
  defaultValue: boolean;
  isAdminPrivilege?: boolean;
  sensitive?: boolean;
  riskLevel?: 'standard' | 'high';
  riskReason?: string;
}

export interface AutoApproveCategoryMeta {
  id: AutoApproveCategoryId;
  title: string;
  description: string;
  items: AutoApproveItemMeta[];
  adminNote?: string;
}

export interface AutoApproveProfileMeta {
  id: AutoApproveProfileId;
  name: string;
  description: string;
  riskTag: string;
  riskTone: 'safe' | 'balanced' | 'elevated' | 'critical' | 'custom';
}

export const AUTO_APPROVE_PROFILES: AutoApproveProfileMeta[] = [
  {
    id: 'safe',
    name: 'Sicuro',
    description: 'Consente principalmente lettura, ricerca e visualizzazione.',
    riskTag: 'Rischio minimo',
    riskTone: 'safe',
  },
  {
    id: 'dev',
    name: 'Sviluppo',
    description:
      'Consente lettura/scrittura dei progetti, terminale, Python, PowerShell, Git, installazione delle dipendenze, build e test.',
    riskTag: 'Rischio controllato',
    riskTone: 'balanced',
  },
  {
    id: 'automation',
    name: 'Automazione',
    description:
      'Consente anche il controllo delle applicazioni desktop e delle automazioni locali.',
    riskTag: 'Rischio medio',
    riskTone: 'elevated',
  },
  {
    id: 'full',
    name: 'Completo',
    description: 'Abilita tutte le autorizzazioni consentite dalla piattaforma.',
    riskTag: 'Rischio elevato',
    riskTone: 'critical',
  },
  {
    id: 'custom',
    name: 'Personalizzato',
    description: "Permette all'utente di selezionare manualmente ogni singolo permesso.",
    riskTag: 'Scelta granulare',
    riskTone: 'custom',
  },
];

export const AUTO_APPROVE_HIGH_RISK_GROUPS: Array<{
  title: string;
  examples: string;
}> = [
  {
    title: 'Eliminazione di file',
    examples: 'Eliminare file, cartelle o branch Git',
  },
  {
    title: 'Modifica del sistema',
    examples: 'Registro di Windows, servizi, PATH, rete, porte, riavvio/spegnimento',
  },
  {
    title: 'Privilegi amministrativi',
    examples: 'Eseguire comandi con elevazione amministrativa',
  },
  {
    title: 'Upload di dati',
    examples: 'Caricare file, inviare moduli Web, push su repository remoti',
  },
  {
    title: 'Gestione account',
    examples: 'Login automatico e interazione con account autenticati',
  },
  {
    title: 'Installazione / disinstallazione software',
    examples: 'Installare o rimuovere applicazioni di sistema',
  },
];

export const AUTO_APPROVE_CATEGORIES: AutoApproveCategoryMeta[] = [
  {
    id: 'filesAndFolders',
    title: 'FILE E CARTELLE',
    description:
      'Controlla le operazioni automatiche su file locali, cartelle, immagini, PDF e documenti Office.',
    items: [
      { key: 'filesRead', label: 'Leggere file', defaultValue: true },
      { key: 'filesCreate', label: 'Creare file', defaultValue: true },
      { key: 'filesModify', label: 'Modificare file', defaultValue: true },
      { key: 'filesRename', label: 'Rinominare file', defaultValue: true },
      { key: 'filesMove', label: 'Spostare file', defaultValue: true },
      {
        key: 'filesDelete',
        label: 'Eliminare file',
        defaultValue: false,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Eliminazione di file',
      },
      { key: 'foldersCreate', label: 'Creare cartelle', defaultValue: true },
      { key: 'foldersRead', label: 'Leggere il contenuto delle cartelle', defaultValue: true },
      { key: 'foldersModify', label: 'Modificare cartelle', defaultValue: true },
      {
        key: 'foldersDelete',
        label: 'Eliminare cartelle',
        defaultValue: false,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Eliminazione di file',
      },
      { key: 'filesAndFoldersCopy', label: 'Copiare file e cartelle', defaultValue: true },
      { key: 'filesSearch', label: 'Cercare file sul PC', defaultValue: true },
      { key: 'filesViewImages', label: 'Visualizzare immagini', defaultValue: true },
      { key: 'filesReadPdf', label: 'Leggere documenti PDF', defaultValue: true },
      { key: 'filesOfficeDocs', label: 'Leggere e modificare documenti Office', defaultValue: true },
    ],
  },
  {
    id: 'terminalAndCommands',
    title: 'TERMINALE E COMANDI',
    description:
      'Autorizzazioni indipendenti per shell, interpreti di script, Git, npm/npx e strumenti CLI.',
    adminNote:
      "L'esecuzione con privilegi amministrativi è gestita separatamente dalle normali operazioni.",
    items: [
      { key: 'execPowerShell', label: 'Eseguire PowerShell', defaultValue: true },
      { key: 'execCmd', label: 'Eseguire CMD', defaultValue: true },
      { key: 'execWindowsTerminal', label: 'Eseguire Windows Terminal', defaultValue: true },
      { key: 'execPythonScript', label: 'Eseguire script Python', defaultValue: true },
      { key: 'execBatchScript', label: 'Eseguire script Batch', defaultValue: true },
      { key: 'execPowerShellScript', label: 'Eseguire script PowerShell', defaultValue: true },
      { key: 'execOtherCli', label: 'Eseguire altri strumenti CLI', defaultValue: true },
      { key: 'execGit', label: 'Eseguire Git', defaultValue: true },
      { key: 'execNpmNpx', label: 'Eseguire npm / npx', defaultValue: true },
      {
        key: 'execAsAdmin',
        label: 'Eseguire comandi come amministratore',
        defaultValue: false,
        isAdminPrivilege: true,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Privilegi amministrativi',
      },
    ],
  },
  {
    id: 'applications',
    title: 'APPLICAZIONI',
    description:
      'Gestisci avvio, chiusura e automazione di applicazioni autorizzate e suite Microsoft Office.',
    items: [
      { key: 'appsLaunch', label: 'Avviare applicazioni', defaultValue: true },
      { key: 'appsInteract', label: 'Interagire con applicazioni autorizzate', defaultValue: true },
      { key: 'appsClose', label: 'Chiudere applicazioni', defaultValue: true },
      {
        key: 'appsOpenAssociatedFiles',
        label: 'Aprire file con le applicazioni associate',
        defaultValue: true,
      },
      { key: 'appsUseOffice', label: 'Utilizzare Microsoft Office', defaultValue: true },
      { key: 'appsWordFiles', label: 'Creare e modificare file Word', defaultValue: true },
      { key: 'appsExcelFiles', label: 'Creare e modificare file Excel', defaultValue: true },
      {
        key: 'appsPowerPointFiles',
        label: 'Creare e modificare presentazioni PowerPoint',
        defaultValue: true,
      },
    ],
  },
  {
    id: 'webAndBrowser',
    title: 'WEB E BROWSER',
    description:
      'Autorizza apertura del browser, navigazione e download separandoli da upload, moduli e account autenticati.',
    items: [
      { key: 'webOpenBrowser', label: 'Aprire il browser', defaultValue: true },
      { key: 'webOpenUrl', label: 'Aprire URL', defaultValue: true },
      { key: 'webSearchInternet', label: 'Effettuare ricerche Internet', defaultValue: true },
      { key: 'webReadPages', label: 'Consultare pagine Web', defaultValue: true },
      { key: 'webDownloadFiles', label: 'Scaricare file', defaultValue: true },
      {
        key: 'webUploadFiles',
        label: 'Caricare file su Internet',
        defaultValue: false,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Upload di dati',
      },
      {
        key: 'webFillForms',
        label: 'Compilare moduli Web',
        defaultValue: false,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Upload di dati',
      },
      {
        key: 'webSubmitForms',
        label: 'Confermare/inviare moduli Web',
        defaultValue: false,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Upload di dati',
      },
      {
        key: 'webAutoLogin',
        label: 'Effettuare login automaticamente',
        defaultValue: false,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Gestione account',
      },
      {
        key: 'webAuthenticatedAccounts',
        label: 'Interagire con account autenticati',
        defaultValue: false,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Gestione account',
      },
    ],
  },
  {
    id: 'softwareAndPackages',
    title: 'SOFTWARE E PACCHETTI',
    description:
      'Distingui la ricerca pacchetti e le dipendenze di progetto (pip/npm) dalle installazioni o modifiche di sistema.',
    items: [
      { key: 'pkgSearch', label: 'Cercare software e pacchetti', defaultValue: true },
      { key: 'pkgDownloadInstaller', label: 'Scaricare installer', defaultValue: true },
      {
        key: 'pkgInstallApps',
        label: 'Installare applicazioni',
        defaultValue: false,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Installazione software',
      },
      {
        key: 'pkgUninstallApps',
        label: 'Disinstallare applicazioni',
        defaultValue: false,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Disinstallazione software',
      },
      { key: 'pkgPipInstall', label: 'Installare pacchetti Python tramite pip', defaultValue: true },
      { key: 'pkgNpmInstall', label: 'Installare pacchetti npm', defaultValue: true },
      {
        key: 'pkgProjectDeps',
        label: 'Installare dipendenze necessarie ai progetti',
        defaultValue: true,
      },
      {
        key: 'pkgModifyPathEnv',
        label: "Modificare PATH o variabili d'ambiente",
        defaultValue: false,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Modifica del sistema',
      },
      {
        key: 'pkgModifySystemConfig',
        label: 'Modificare configurazioni di sistema',
        defaultValue: false,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Modifica del sistema',
      },
    ],
  },
  {
    id: 'processesAndSystem',
    title: 'PROCESSI E SISTEMA',
    description:
      'Autorizzazioni su processi, informazioni hardware/software, variabili di ambiente, Registro e servizi Windows.',
    items: [
      { key: 'sysViewProcesses', label: 'Visualizzare i processi', defaultValue: true },
      { key: 'sysStartProcesses', label: 'Avviare processi', defaultValue: true },
      {
        key: 'sysKillProcesses',
        label: 'Terminare processi',
        defaultValue: false,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Modifica del sistema',
      },
      {
        key: 'sysReadHardwareSoftware',
        label: 'Leggere informazioni hardware/software del PC',
        defaultValue: true,
      },
      {
        key: 'sysReadNonSensitiveEnv',
        label: "Leggere variabili d'ambiente non sensibili",
        defaultValue: true,
      },
      {
        key: 'sysModifyEnv',
        label: "Modificare variabili d'ambiente",
        defaultValue: false,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Modifica del sistema',
      },
      {
        key: 'sysModifyRegistry',
        label: 'Modificare il Registro di Windows',
        defaultValue: false,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Modifica del sistema',
      },
      {
        key: 'sysManageServices',
        label: 'Avviare o arrestare servizi Windows',
        defaultValue: false,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Modifica del sistema',
      },
      {
        key: 'sysModifyNetworkConfig',
        label: 'Modificare configurazioni di rete',
        defaultValue: false,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Modifica del sistema',
      },
      {
        key: 'sysRebootShutdown',
        label: 'Riavviare o spegnere il computer',
        defaultValue: false,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Modifica del sistema',
      },
    ],
  },
  {
    id: 'clipboardAndDesktop',
    title: 'CLIPBOARD E INTERAZIONE DESKTOP',
    description:
      'Gestisci accesso agli appunti, controllo mouse/tastiera, automazione finestre GUI e lettura schermo.',
    items: [
      { key: 'desktopReadClipboard', label: 'Leggere gli appunti', defaultValue: true },
      { key: 'desktopWriteClipboard', label: 'Scrivere negli appunti', defaultValue: true },
      {
        key: 'desktopMouseKeyboard',
        label: 'Controllare mouse e tastiera',
        defaultValue: false,
        sensitive: true,
      },
      {
        key: 'desktopGuiAutomation',
        label: 'Interagire automaticamente con finestre e GUI',
        defaultValue: false,
        sensitive: true,
      },
      {
        key: 'desktopScreenshot',
        label: 'Acquisire screenshot',
        defaultValue: false,
        sensitive: true,
      },
      {
        key: 'desktopReadScreen',
        label: 'Leggere il contenuto dello schermo',
        defaultValue: false,
        sensitive: true,
      },
    ],
  },
  {
    id: 'gitAndDev',
    title: 'GIT E SVILUPPO',
    description:
      'Separa operazioni Git locali (lettura, modifica, commit, build, test) dalle operazioni remote o distruttive.',
    items: [
      { key: 'gitReadRepo', label: 'Leggere repository Git', defaultValue: true },
      { key: 'gitModifyRepo', label: 'Modificare repository', defaultValue: true },
      { key: 'gitCreateCommit', label: 'Creare commit', defaultValue: true },
      {
        key: 'gitPushRemote',
        label: 'Push verso repository remoti',
        defaultValue: false,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Upload di dati',
      },
      {
        key: 'gitModifyRemoteBranch',
        label: 'Creare o modificare branch remoti',
        defaultValue: false,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Upload di dati',
      },
      {
        key: 'gitDeleteBranch',
        label: 'Eliminare branch',
        defaultValue: false,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Eliminazione di file',
      },
      { key: 'devRunBuild', label: 'Eseguire build', defaultValue: true },
      { key: 'devRunTests', label: 'Eseguire test', defaultValue: true },
      {
        key: 'devInstallProjectDeps',
        label: 'Installare dipendenze del progetto',
        defaultValue: true,
      },
    ],
  },
  {
    id: 'network',
    title: 'RETE',
    description:
      'Controlla traffico HTTP/HTTPS, accesso Internet, rete locale/LAN, server locali e apertura porte.',
    items: [
      { key: 'netHttpRequests', label: 'Effettuare richieste HTTP/HTTPS', defaultValue: true },
      { key: 'netInternetAccess', label: 'Accedere a Internet', defaultValue: true },
      {
        key: 'netLocalNetworkAccess',
        label: 'Accedere alla rete locale',
        defaultValue: false,
        sensitive: true,
      },
      {
        key: 'netLanDevices',
        label: 'Comunicare con dispositivi della LAN',
        defaultValue: false,
        sensitive: true,
      },
      {
        key: 'netStartLocalServers',
        label: 'Avviare server locali',
        defaultValue: false,
        sensitive: true,
      },
      {
        key: 'netOpenPorts',
        label: 'Aprire porte di rete',
        defaultValue: false,
        sensitive: true,
        riskLevel: 'high',
        riskReason: 'Modifica del sistema',
      },
    ],
  },
];

export function getDefaultAutoApproveSettings(): AutoApproveSettings {
  return {
    profile: 'custom',
    filesAndFolders: {
      filesRead: true,
      filesCreate: true,
      filesModify: true,
      filesRename: true,
      filesMove: true,
      filesDelete: false,
      foldersCreate: true,
      foldersRead: true,
      foldersModify: true,
      foldersDelete: false,
      filesAndFoldersCopy: true,
      filesSearch: true,
      filesViewImages: true,
      filesReadPdf: true,
      filesOfficeDocs: true,
    },
    terminalAndCommands: {
      execPowerShell: true,
      execCmd: true,
      execWindowsTerminal: true,
      execPythonScript: true,
      execBatchScript: true,
      execPowerShellScript: true,
      execOtherCli: true,
      execGit: true,
      execNpmNpx: true,
      execAsAdmin: false,
    },
    applications: {
      appsLaunch: true,
      appsInteract: true,
      appsClose: true,
      appsOpenAssociatedFiles: true,
      appsUseOffice: true,
      appsWordFiles: true,
      appsExcelFiles: true,
      appsPowerPointFiles: true,
    },
    webAndBrowser: {
      webOpenBrowser: true,
      webOpenUrl: true,
      webSearchInternet: true,
      webReadPages: true,
      webDownloadFiles: true,
      webUploadFiles: false,
      webFillForms: false,
      webSubmitForms: false,
      webAutoLogin: false,
      webAuthenticatedAccounts: false,
    },
    softwareAndPackages: {
      pkgSearch: true,
      pkgDownloadInstaller: true,
      pkgInstallApps: false,
      pkgUninstallApps: false,
      pkgPipInstall: true,
      pkgNpmInstall: true,
      pkgProjectDeps: true,
      pkgModifyPathEnv: false,
      pkgModifySystemConfig: false,
    },
    processesAndSystem: {
      sysViewProcesses: true,
      sysStartProcesses: true,
      sysKillProcesses: false,
      sysReadHardwareSoftware: true,
      sysReadNonSensitiveEnv: true,
      sysModifyEnv: false,
      sysModifyRegistry: false,
      sysManageServices: false,
      sysModifyNetworkConfig: false,
      sysRebootShutdown: false,
    },
    clipboardAndDesktop: {
      desktopReadClipboard: true,
      desktopWriteClipboard: true,
      desktopMouseKeyboard: false,
      desktopGuiAutomation: false,
      desktopScreenshot: false,
      desktopReadScreen: false,
    },
    gitAndDev: {
      gitReadRepo: true,
      gitModifyRepo: true,
      gitCreateCommit: true,
      gitPushRemote: false,
      gitModifyRemoteBranch: false,
      gitDeleteBranch: false,
      devRunBuild: true,
      devRunTests: true,
      devInstallProjectDeps: true,
    },
    network: {
      netHttpRequests: true,
      netInternetAccess: true,
      netLocalNetworkAccess: false,
      netLanDevices: false,
      netStartLocalServers: false,
      netOpenPorts: false,
    },
  };
}

const VALID_PROFILE_IDS = new Set<AutoApproveProfileId>([
  'safe',
  'dev',
  'automation',
  'full',
  'custom',
]);

export function buildAutoApproveProfileSettings(
  profileId: AutoApproveProfileId,
  current?: AutoApproveSettings,
): AutoApproveSettings {
  if (profileId === 'custom') {
    return {
      ...sanitizeAutoApproveSettings(current),
      profile: 'custom',
    };
  }

  if (profileId === 'full') {
    const next = structuredClone(getDefaultAutoApproveSettings());
    next.profile = 'full';
    const nextObj = next as unknown as Record<string, Record<string, boolean>>;
    for (const cat of AUTO_APPROVE_CATEGORIES) {
      for (const item of cat.items) {
        nextObj[cat.id][item.key] = true;
      }
    }
    return next;
  }

  if (profileId === 'safe') {
    return {
      profile: 'safe',
      filesAndFolders: {
        filesRead: true,
        filesCreate: false,
        filesModify: false,
        filesRename: false,
        filesMove: false,
        filesDelete: false,
        foldersCreate: false,
        foldersRead: true,
        foldersModify: false,
        foldersDelete: false,
        filesAndFoldersCopy: false,
        filesSearch: true,
        filesViewImages: true,
        filesReadPdf: true,
        filesOfficeDocs: false,
      },
      terminalAndCommands: {
        execPowerShell: false,
        execCmd: false,
        execWindowsTerminal: false,
        execPythonScript: false,
        execBatchScript: false,
        execPowerShellScript: false,
        execOtherCli: false,
        execGit: false,
        execNpmNpx: false,
        execAsAdmin: false,
      },
      applications: {
        appsLaunch: false,
        appsInteract: false,
        appsClose: false,
        appsOpenAssociatedFiles: false,
        appsUseOffice: false,
        appsWordFiles: false,
        appsExcelFiles: false,
        appsPowerPointFiles: false,
      },
      webAndBrowser: {
        webOpenBrowser: false,
        webOpenUrl: false,
        webSearchInternet: true,
        webReadPages: true,
        webDownloadFiles: false,
        webUploadFiles: false,
        webFillForms: false,
        webSubmitForms: false,
        webAutoLogin: false,
        webAuthenticatedAccounts: false,
      },
      softwareAndPackages: {
        pkgSearch: true,
        pkgDownloadInstaller: false,
        pkgInstallApps: false,
        pkgUninstallApps: false,
        pkgPipInstall: false,
        pkgNpmInstall: false,
        pkgProjectDeps: false,
        pkgModifyPathEnv: false,
        pkgModifySystemConfig: false,
      },
      processesAndSystem: {
        sysViewProcesses: true,
        sysStartProcesses: false,
        sysKillProcesses: false,
        sysReadHardwareSoftware: true,
        sysReadNonSensitiveEnv: true,
        sysModifyEnv: false,
        sysModifyRegistry: false,
        sysManageServices: false,
        sysModifyNetworkConfig: false,
        sysRebootShutdown: false,
      },
      clipboardAndDesktop: {
        desktopReadClipboard: true,
        desktopWriteClipboard: false,
        desktopMouseKeyboard: false,
        desktopGuiAutomation: false,
        desktopScreenshot: false,
        desktopReadScreen: false,
      },
      gitAndDev: {
        gitReadRepo: true,
        gitModifyRepo: false,
        gitCreateCommit: false,
        gitPushRemote: false,
        gitModifyRemoteBranch: false,
        gitDeleteBranch: false,
        devRunBuild: false,
        devRunTests: false,
        devInstallProjectDeps: false,
      },
      network: {
        netHttpRequests: true,
        netInternetAccess: true,
        netLocalNetworkAccess: false,
        netLanDevices: false,
        netStartLocalServers: false,
        netOpenPorts: false,
      },
    };
  }

  if (profileId === 'dev') {
    return {
      profile: 'dev',
      filesAndFolders: {
        filesRead: true,
        filesCreate: true,
        filesModify: true,
        filesRename: true,
        filesMove: true,
        filesDelete: false,
        foldersCreate: true,
        foldersRead: true,
        foldersModify: true,
        foldersDelete: false,
        filesAndFoldersCopy: true,
        filesSearch: true,
        filesViewImages: true,
        filesReadPdf: true,
        filesOfficeDocs: false,
      },
      terminalAndCommands: {
        execPowerShell: true,
        execCmd: true,
        execWindowsTerminal: true,
        execPythonScript: true,
        execBatchScript: true,
        execPowerShellScript: true,
        execOtherCli: true,
        execGit: true,
        execNpmNpx: true,
        execAsAdmin: false,
      },
      applications: {
        appsLaunch: false,
        appsInteract: false,
        appsClose: false,
        appsOpenAssociatedFiles: false,
        appsUseOffice: false,
        appsWordFiles: false,
        appsExcelFiles: false,
        appsPowerPointFiles: false,
      },
      webAndBrowser: {
        webOpenBrowser: false,
        webOpenUrl: true,
        webSearchInternet: true,
        webReadPages: true,
        webDownloadFiles: true,
        webUploadFiles: false,
        webFillForms: false,
        webSubmitForms: false,
        webAutoLogin: false,
        webAuthenticatedAccounts: false,
      },
      softwareAndPackages: {
        pkgSearch: true,
        pkgDownloadInstaller: true,
        pkgInstallApps: false,
        pkgUninstallApps: false,
        pkgPipInstall: true,
        pkgNpmInstall: true,
        pkgProjectDeps: true,
        pkgModifyPathEnv: false,
        pkgModifySystemConfig: false,
      },
      processesAndSystem: {
        sysViewProcesses: true,
        sysStartProcesses: true,
        sysKillProcesses: false,
        sysReadHardwareSoftware: true,
        sysReadNonSensitiveEnv: true,
        sysModifyEnv: false,
        sysModifyRegistry: false,
        sysManageServices: false,
        sysModifyNetworkConfig: false,
        sysRebootShutdown: false,
      },
      clipboardAndDesktop: {
        desktopReadClipboard: true,
        desktopWriteClipboard: true,
        desktopMouseKeyboard: false,
        desktopGuiAutomation: false,
        desktopScreenshot: false,
        desktopReadScreen: false,
      },
      gitAndDev: {
        gitReadRepo: true,
        gitModifyRepo: true,
        gitCreateCommit: true,
        gitPushRemote: false,
        gitModifyRemoteBranch: false,
        gitDeleteBranch: false,
        devRunBuild: true,
        devRunTests: true,
        devInstallProjectDeps: true,
      },
      network: {
        netHttpRequests: true,
        netInternetAccess: true,
        netLocalNetworkAccess: false,
        netLanDevices: false,
        netStartLocalServers: true,
        netOpenPorts: false,
      },
    };
  }

  // 'automation': builds on Sviluppo + desktop apps, Office, browser & local desktop/GUI automation
  return {
    profile: 'automation',
    filesAndFolders: {
      filesRead: true,
      filesCreate: true,
      filesModify: true,
      filesRename: true,
      filesMove: true,
      filesDelete: false,
      foldersCreate: true,
      foldersRead: true,
      foldersModify: true,
      foldersDelete: false,
      filesAndFoldersCopy: true,
      filesSearch: true,
      filesViewImages: true,
      filesReadPdf: true,
      filesOfficeDocs: true,
    },
    terminalAndCommands: {
      execPowerShell: true,
      execCmd: true,
      execWindowsTerminal: true,
      execPythonScript: true,
      execBatchScript: true,
      execPowerShellScript: true,
      execOtherCli: true,
      execGit: true,
      execNpmNpx: true,
      execAsAdmin: false,
    },
    applications: {
      appsLaunch: true,
      appsInteract: true,
      appsClose: true,
      appsOpenAssociatedFiles: true,
      appsUseOffice: true,
      appsWordFiles: true,
      appsExcelFiles: true,
      appsPowerPointFiles: true,
    },
    webAndBrowser: {
      webOpenBrowser: true,
      webOpenUrl: true,
      webSearchInternet: true,
      webReadPages: true,
      webDownloadFiles: true,
      webUploadFiles: false,
      webFillForms: false,
      webSubmitForms: false,
      webAutoLogin: false,
      webAuthenticatedAccounts: false,
    },
    softwareAndPackages: {
      pkgSearch: true,
      pkgDownloadInstaller: true,
      pkgInstallApps: false,
      pkgUninstallApps: false,
      pkgPipInstall: true,
      pkgNpmInstall: true,
      pkgProjectDeps: true,
      pkgModifyPathEnv: false,
      pkgModifySystemConfig: false,
    },
    processesAndSystem: {
      sysViewProcesses: true,
      sysStartProcesses: true,
      sysKillProcesses: false,
      sysReadHardwareSoftware: true,
      sysReadNonSensitiveEnv: true,
      sysModifyEnv: false,
      sysModifyRegistry: false,
      sysManageServices: false,
      sysModifyNetworkConfig: false,
      sysRebootShutdown: false,
    },
    clipboardAndDesktop: {
      desktopReadClipboard: true,
      desktopWriteClipboard: true,
      desktopMouseKeyboard: true,
      desktopGuiAutomation: true,
      desktopScreenshot: true,
      desktopReadScreen: true,
    },
    gitAndDev: {
      gitReadRepo: true,
      gitModifyRepo: true,
      gitCreateCommit: true,
      gitPushRemote: false,
      gitModifyRemoteBranch: false,
      gitDeleteBranch: false,
      devRunBuild: true,
      devRunTests: true,
      devInstallProjectDeps: true,
    },
    network: {
      netHttpRequests: true,
      netInternetAccess: true,
      netLocalNetworkAccess: true,
      netLanDevices: false,
      netStartLocalServers: true,
      netOpenPorts: false,
    },
  };
}

export function sanitizeAutoApproveSettings(
  raw: Partial<AutoApproveSettings> | undefined,
  fallback: AutoApproveSettings = getDefaultAutoApproveSettings(),
): AutoApproveSettings {
  const defaults = getDefaultAutoApproveSettings();
  const next = structuredClone(defaults) as unknown as Record<string, Record<string, boolean>>;
  const fbObj = fallback as unknown as Record<string, Record<string, boolean>>;
  const rawObj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  for (const cat of AUTO_APPROVE_CATEGORIES) {
    const rawCat =
      rawObj[cat.id] && typeof rawObj[cat.id] === 'object'
        ? (rawObj[cat.id] as Record<string, unknown>)
        : {};
    const fbCat = fbObj[cat.id] ?? {};
    for (const item of cat.items) {
      if (typeof rawCat[item.key] === 'boolean') {
        next[cat.id][item.key] = rawCat[item.key] as boolean;
      } else if (typeof fbCat[item.key] === 'boolean') {
        next[cat.id][item.key] = fbCat[item.key];
      } else {
        next[cat.id][item.key] = item.defaultValue;
      }
    }
  }

  const rawProfile = rawObj.profile;
  const resolvedProfile: AutoApproveProfileId =
    typeof rawProfile === 'string' && VALID_PROFILE_IDS.has(rawProfile as AutoApproveProfileId)
      ? (rawProfile as AutoApproveProfileId)
      : fallback.profile && VALID_PROFILE_IDS.has(fallback.profile)
        ? fallback.profile
        : 'custom';

  const result = next as unknown as AutoApproveSettings;
  result.profile = resolvedProfile;
  return result;
}

export function getAutoApprovePermissionValue(
  settings: AutoApproveSettings | undefined,
  categoryId: AutoApproveCategoryId,
  key: string,
): boolean {
  const cfg = settings ?? getDefaultAutoApproveSettings();
  const cat = (cfg as unknown as Record<string, Record<string, boolean>>)[categoryId];
  return Boolean(cat?.[key]);
}

export function countTotalAutoApprovePermissions(): number {
  return AUTO_APPROVE_CATEGORIES.reduce((acc, cat) => acc + cat.items.length, 0);
}

export function countEnabledAutoApprovePermissions(settings?: AutoApproveSettings): number {
  const cfg = settings ?? getDefaultAutoApproveSettings();
  let count = 0;
  for (const cat of AUTO_APPROVE_CATEGORIES) {
    for (const item of cat.items) {
      if (getAutoApprovePermissionValue(cfg, cat.id, item.key)) {
        count += 1;
      }
    }
  }
  return count;
}

export function countHighRiskAutoApprovePermissions(): number {
  return AUTO_APPROVE_CATEGORIES.reduce(
    (acc, cat) => acc + cat.items.filter((i) => i.riskLevel === 'high').length,
    0,
  );
}

export function getEnabledHighRiskItems(
  settings?: AutoApproveSettings,
): Array<{ pathKey: string; label: string; riskReason?: string }> {
  const cfg = settings ?? getDefaultAutoApproveSettings();
  const list: Array<{ pathKey: string; label: string; riskReason?: string }> = [];
  for (const cat of AUTO_APPROVE_CATEGORIES) {
    for (const item of cat.items) {
      if (item.riskLevel === 'high' && getAutoApprovePermissionValue(cfg, cat.id, item.key)) {
        list.push({
          pathKey: `${cat.id}.${item.key}`,
          label: item.label,
          riskReason: item.riskReason,
        });
      }
    }
  }
  return list;
}

export function disableAllHighRiskPermissions(
  settings?: AutoApproveSettings,
): AutoApproveSettings {
  const current = sanitizeAutoApproveSettings(settings);
  const next = structuredClone(current) as unknown as Record<string, Record<string, boolean>>;
  for (const cat of AUTO_APPROVE_CATEGORIES) {
    for (const item of cat.items) {
      if (item.riskLevel === 'high') {
        next[cat.id][item.key] = false;
      }
    }
  }
  const result = next as unknown as AutoApproveSettings;
  result.profile = 'custom';
  return result;
}

const ITEM_LABEL_MAP = new Map<string, string>();
const ITEM_META_MAP = new Map<string, AutoApproveItemMeta>();
for (const cat of AUTO_APPROVE_CATEGORIES) {
  for (const item of cat.items) {
    const k = `${cat.id}.${item.key}`;
    ITEM_LABEL_MAP.set(k, item.label);
    ITEM_META_MAP.set(k, item);
  }
}

export type ApprovalScope = 'once' | 'session' | 'always';
export type AutoApproveActionRiskLevel = 'basso' | 'medio' | 'elevato';

const LOW_RISK_PERMISSION_KEYS = new Set<string>([
  'filesAndFolders.filesRead',
  'filesAndFolders.foldersRead',
  'filesAndFolders.filesSearch',
  'filesAndFolders.filesViewImages',
  'filesAndFolders.filesReadPdf',
  'webAndBrowser.webSearchInternet',
  'webAndBrowser.webReadPages',
  'softwareAndPackages.pkgSearch',
  'processesAndSystem.sysViewProcesses',
  'processesAndSystem.sysReadHardwareSoftware',
  'processesAndSystem.sysReadNonSensitiveEnv',
  'clipboardAndDesktop.desktopReadClipboard',
  'gitAndDev.gitReadRepo',
  'network.netHttpRequests',
  'network.netInternetAccess',
]);

function formatOperationLabel(labels: string[]): string {
  if (labels.length === 0) return 'eseguire operazione locale';
  return labels
    .map((lbl) => (lbl.length > 0 ? lbl[0].toLowerCase() + lbl.slice(1) : lbl))
    .join(', ');
}

export function enablePermissionsInAutoApprove(
  settings: AutoApproveSettings | undefined,
  permissionKeys: string[],
): AutoApproveSettings {
  const current = sanitizeAutoApproveSettings(settings);
  const next = structuredClone(current) as unknown as Record<string, Record<string, boolean>>;
  for (const perm of permissionKeys) {
    const [catId, key] = perm.split('.');
    if (catId && key && next[catId] && typeof next[catId][key] === 'boolean') {
      next[catId][key] = true;
    }
  }
  const result = next as unknown as AutoApproveSettings;
  result.profile = 'custom';
  return result;
}

export function getPermissionLabel(pathKey: string): string {
  return ITEM_LABEL_MAP.get(pathKey) ?? pathKey;
}

export function isHighRiskPermissionKey(pathKey: string): boolean {
  return ITEM_META_MAP.get(pathKey)?.riskLevel === 'high';
}

export interface AutoApproveEvalResult {
  allowed: boolean;
  isAdminRequired: boolean;
  hasPlaintextCredentials?: boolean;
  requiresInteractiveTerminal?: boolean;
  missingWorkingDirectoryForMutation?: boolean;
  requiredPermissions: string[];
  blockedPermissions: string[];
  blockedLabels: string[];
  riskLevel: AutoApproveActionRiskLevel;
  operationLabel: string;
}

export function isAutoApproveAllowedWithSession(
  evalRes: AutoApproveEvalResult,
  sessionAllowedPermissions?: Set<string> | string[],
  options?: {
    agentReadOnly?: boolean;
    actionType?: 'read' | 'write' | 'pc-exec';
  },
): { allowed: boolean; viaSession: boolean } {
  if (options?.agentReadOnly && options.actionType && options.actionType !== 'read') {
    return { allowed: false, viaSession: false };
  }
  if (
    evalRes.hasPlaintextCredentials ||
    evalRes.requiresInteractiveTerminal ||
    evalRes.missingWorkingDirectoryForMutation
  ) {
    return { allowed: false, viaSession: false };
  }
  if (evalRes.allowed) {
    return { allowed: true, viaSession: false };
  }
  if (!sessionAllowedPermissions || evalRes.blockedPermissions.length === 0) {
    return { allowed: false, viaSession: false };
  }
  const set =
    sessionAllowedPermissions instanceof Set
      ? sessionAllowedPermissions
      : new Set(sessionAllowedPermissions);
  const allCoveredBySession = evalRes.blockedPermissions.every((p) => set.has(p));
  return {
    allowed: allCoveredBySession,
    viaSession: allCoveredBySession,
  };
}

function finalizeEval(
  cfg: AutoApproveSettings,
  reqs: Set<string>,
  isAdminRequired = false,
): AutoApproveEvalResult {
  const requiredPermissions = Array.from(reqs);
  const blockedPermissions = requiredPermissions.filter((perm) => {
    const [catId, key] = perm.split('.') as [AutoApproveCategoryId, string];
    return !getAutoApprovePermissionValue(cfg, catId, key);
  });
  const blockedLabels = blockedPermissions.map(getPermissionLabel);

  const hasHighRisk =
    isAdminRequired || requiredPermissions.some((perm) => isHighRiskPermissionKey(perm));
  const isAllLowRisk =
    requiredPermissions.length > 0 &&
    requiredPermissions.every((perm) => LOW_RISK_PERMISSION_KEYS.has(perm));

  const riskLevel: AutoApproveActionRiskLevel = hasHighRisk
    ? 'elevato'
    : isAllLowRisk
      ? 'basso'
      : 'medio';

  const operationLabel = formatOperationLabel(
    blockedLabels.length > 0 ? blockedLabels : requiredPermissions.map(getPermissionLabel),
  );

  return {
    allowed: blockedPermissions.length === 0,
    isAdminRequired,
    requiredPermissions,
    blockedPermissions,
    blockedLabels,
    riskLevel,
    operationLabel,
  };
}

export function evaluateWorkspaceReadAutoApprove(
  paths: string[],
  settings?: AutoApproveSettings,
): AutoApproveEvalResult {
  const cfg = settings ?? getDefaultAutoApproveSettings();
  const reqs = new Set<string>(['filesAndFolders.filesRead']);

  for (const p of paths) {
    const lower = p.trim().toLowerCase();
    if (/\.(png|jpe?g|gif|webp|bmp|svg|ico|tiff?)$/.test(lower)) {
      reqs.add('filesAndFolders.filesViewImages');
    } else if (/\.pdf$/.test(lower)) {
      reqs.add('filesAndFolders.filesReadPdf');
    } else if (/\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf)$/.test(lower)) {
      reqs.add('filesAndFolders.filesOfficeDocs');
    }
  }

  return finalizeEval(cfg, reqs, false);
}

export function evaluateWorkspaceWriteAutoApprove(
  targetPath: string,
  fileAlreadyExists: boolean,
  settings?: AutoApproveSettings,
): AutoApproveEvalResult {
  const cfg = settings ?? getDefaultAutoApproveSettings();
  const reqs = new Set<string>([
    fileAlreadyExists ? 'filesAndFolders.filesModify' : 'filesAndFolders.filesCreate',
  ]);
  const lower = targetPath.trim().toLowerCase();
  if (targetPath.includes('/') || targetPath.includes('\\')) {
    if (!fileAlreadyExists) {
      reqs.add('filesAndFolders.foldersCreate');
    }
  }
  if (/\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf)$/.test(lower)) {
    reqs.add('filesAndFolders.filesOfficeDocs');
    if (/\.(docx?)$/.test(lower)) reqs.add('applications.appsWordFiles');
    if (/\.(xlsx?)$/.test(lower)) reqs.add('applications.appsExcelFiles');
    if (/\.(pptx?)$/.test(lower)) reqs.add('applications.appsPowerPointFiles');
  }

  return finalizeEval(cfg, reqs, false);
}

export function detectAdminPrivilegesCommand(text: string): boolean {
  if (!text) return false;
  return (
    /\b(sudo|doas|pkexec|gsudo|runas)\b/i.test(text) ||
    /-verb\s+runas\b/i.test(text) ||
    /\bstart-process\b[^\n]*-verb\s+runas\b/i.test(text) ||
    /\b(bcdedit|diskpart|sfc\s+\/scannow|dism\s+\/online)\b/i.test(text) ||
    /\bnet\s+(user|localgroup|accounts|session)\b/i.test(text) ||
    /\bset-executionpolicy\b[^\n]*localmachine\b/i.test(text) ||
    /\b(takeown|icacls)\b[^\n]*(c:\\windows|system32|program files)/i.test(text)
  );
}

export function detectPlaintextCredentialsCommand(text: string): boolean {
  if (!text) return false;
  return (
    /\bconvertto-securestring\b[^\n]*-asplaintext\b/i.test(text) ||
    /(?:^|\s)--?(?:password|passwd|pwd|secret|token)\s*(?:=|\s)\s*['"][^'"$\s]{2,}['"]/i.test(
      text,
    ) ||
    /(?:^|\s)--?(?:password|passwd|pwd)\s+(?!\$)[^\s'"-][^\s]{1,}/i.test(text) ||
    /\bnet\s+use\b[^\n]*\/user:\S+\s+(?!\*)[^\s/$][^\s]*/i.test(text) ||
    /\b(?:password|passwd)\s*=\s*['"][^'"]{2,}['"]/i.test(text)
  );
}

export function detectInteractiveAuthCommand(text: string): boolean {
  if (!text) return false;
  return (
    /\b(get-credential|read-host)\b/i.test(text) ||
    /-assecurestring\b/i.test(text) ||
    /\bconvertfrom-securestring\b/i.test(text) ||
    /\bcmdkey\b/i.test(text) ||
    /\b(az|docker|npm)\s+login\b/i.test(text) ||
    /\bgh\s+auth\s+login\b/i.test(text) ||
    /\bgit\s+credential\b/i.test(text) ||
    /\bnet\s+use\b[^\n]*\*/i.test(text) ||
    /\benter-pssession\b/i.test(text)
  );
}

export function detectFilesystemMutationOrScriptCommand(
  combinedText: string,
  hasScript: boolean,
): boolean {
  if (hasScript) return true;
  if (!combinedText.trim()) return false;
  return (
    /\b(rm|unlink|del|erase|remove-item|rmdir|rd|mkdir|md|new-item|set-content|add-content|out-file|tee-object|touch|mv|move|move-item|ren|rename|rename-item|cp|copy|xcopy|robocopy|copy-item)\b/i.test(
      combinedText,
    ) ||
    /(?:^|[^>])>{1,2}(?!=)/.test(combinedText) ||
    /\bfs\.(writeFile|appendFile|mkdir|rm|unlink|rename|copyFile)(?:Sync)?\b/i.test(
      combinedText,
    ) ||
    /\bgit\s+(add|rm|mv|reset|checkout|switch|merge|rebase|cherry-pick|stash|pull|init|clone|commit)\b/i.test(
      combinedText,
    ) ||
    /\b(pip3?|npm|pnpm|yarn|winget|choco|scoop|brew|apt|apt-get|dnf|yum|msiexec)\s+(install|i|ci|add|uninstall|remove|upgrade|update)\b/i.test(
      combinedText,
    ) ||
    /\b(curl|wget|invoke-webrequest|invoke-restmethod)\b[^\n]*\s(-o|-O|--output|-OutFile)\b/i.test(
      combinedText,
    )
  );
}

export function evaluatePcAutoApprove(
  params: {
    toolId?: string;
    toolQuery?: string;
    command?: string;
    args?: string[];
    script?: string;
    workingDirectory?: string;
  },
  matchedTool: Pick<PcDiscoveredTool, 'id' | 'category' | 'executable' | 'isGui'> | null,
  settings?: AutoApproveSettings,
): AutoApproveEvalResult {
  const cfg = settings ?? getDefaultAutoApproveSettings();
  const reqs = new Set<string>();

  const toolId = (matchedTool?.id || params.toolId || params.toolQuery || '').toLowerCase();
  const exe = (matchedTool?.executable || params.toolQuery || params.toolId || '').toLowerCase();
  const combinedText = [
    params.command ?? '',
    Array.isArray(params.args) ? params.args.join(' ') : '',
    params.script ?? '',
  ]
    .filter(Boolean)
    .join('\n');

  // 1. Separate administrative privilege enforcement
  const isAdminRequired = detectAdminPrivilegesCommand(combinedText);
  if (isAdminRequired) {
    reqs.add('terminalAndCommands.execAsAdmin');
  }

  // 2. Base tool / application permissions
  if (toolId === 'powershell' || exe.includes('pwsh') || exe.includes('powershell')) {
    reqs.add(
      params.script?.trim()
        ? 'terminalAndCommands.execPowerShellScript'
        : 'terminalAndCommands.execPowerShell',
    );
  } else if (toolId === 'cmd' || exe === 'cmd.exe' || exe === 'cmd') {
    reqs.add(
      params.script?.trim()
        ? 'terminalAndCommands.execBatchScript'
        : 'terminalAndCommands.execCmd',
    );
  } else if (toolId === 'windows-terminal' || exe === 'wt.exe' || exe === 'wt') {
    reqs.add('terminalAndCommands.execWindowsTerminal');
    reqs.add('applications.appsLaunch');
  } else if (toolId === 'python' || exe.startsWith('python') || exe === 'py.exe') {
    reqs.add('terminalAndCommands.execPythonScript');
  } else if (toolId === 'git' || exe === 'git' || exe === 'git.exe') {
    reqs.add('terminalAndCommands.execGit');
  } else if (toolId === 'npm' || toolId === 'npx' || exe.startsWith('npm') || exe.startsWith('npx')) {
    reqs.add('terminalAndCommands.execNpmNpx');
  } else if (toolId === 'ms-word' || exe.includes('winword')) {
    reqs.add('applications.appsLaunch');
    reqs.add('applications.appsUseOffice');
    reqs.add('applications.appsWordFiles');
    reqs.add('filesAndFolders.filesOfficeDocs');
  } else if (toolId === 'ms-excel' || exe.includes('excel')) {
    reqs.add('applications.appsLaunch');
    reqs.add('applications.appsUseOffice');
    reqs.add('applications.appsExcelFiles');
    reqs.add('filesAndFolders.filesOfficeDocs');
  } else if (toolId === 'ms-powerpoint' || exe.includes('powerpnt')) {
    reqs.add('applications.appsLaunch');
    reqs.add('applications.appsUseOffice');
    reqs.add('applications.appsPowerPointFiles');
    reqs.add('filesAndFolders.filesOfficeDocs');
  } else if (toolId === 'ms-outlook' || toolId === 'ms-access' || matchedTool?.category === 'office') {
    reqs.add('applications.appsLaunch');
    reqs.add('applications.appsUseOffice');
  } else if (
    toolId === 'chrome' ||
    toolId === 'ms-edge' ||
    toolId === 'firefox' ||
    matchedTool?.category === 'browser'
  ) {
    reqs.add('applications.appsLaunch');
    reqs.add('webAndBrowser.webOpenBrowser');
    if (/https?:\/\//i.test(combinedText)) {
      reqs.add('webAndBrowser.webOpenUrl');
    }
  } else if (matchedTool?.isGui || matchedTool?.category === 'desktop' || matchedTool?.category === 'ide') {
    reqs.add('applications.appsLaunch');
    if (combinedText.trim()) {
      reqs.add('applications.appsInteract');
    }
  } else {
    reqs.add('terminalAndCommands.execOtherCli');
  }

  // 3. Operation-level inspections inside command / script
  if (combinedText.trim()) {
    // Embedded tool invocations inside shell scripts
    if (/\bgit\s+/i.test(combinedText)) {
      reqs.add('terminalAndCommands.execGit');
    }
    if (/\b(npm|npx)\s+/i.test(combinedText)) {
      reqs.add('terminalAndCommands.execNpmNpx');
    }
    if (/\b(python|python3|py)\s+/i.test(combinedText)) {
      reqs.add('terminalAndCommands.execPythonScript');
    }

    // File & Folder operations
    if (
      /\b(rm|unlink|del|erase|remove-item)\b/i.test(combinedText) ||
      /\bfs\.(unlink|rm)(Sync)?\b/i.test(combinedText)
    ) {
      if (/\b(rmdir|rd)\b|-recurse|-r\b/i.test(combinedText)) {
        reqs.add('filesAndFolders.foldersDelete');
      } else {
        reqs.add('filesAndFolders.filesDelete');
      }
    }
    if (/\b(rmdir|rd)\b/i.test(combinedText)) {
      reqs.add('filesAndFolders.foldersDelete');
    }
    if (/\b(mkdir|md|new-item)\b/i.test(combinedText)) {
      reqs.add('filesAndFolders.foldersCreate');
    }
    if (/\b(mv|move|move-item)\b/i.test(combinedText)) {
      reqs.add('filesAndFolders.filesMove');
    }
    if (/\b(ren|rename|rename-item)\b/i.test(combinedText)) {
      reqs.add('filesAndFolders.filesRename');
    }
    if (/\b(cp|copy|xcopy|robocopy|copy-item)\b/i.test(combinedText)) {
      reqs.add('filesAndFolders.filesAndFoldersCopy');
    }

    // Git & Dev operations
    if (toolId === 'git' || /\bgit\s+/i.test(combinedText)) {
      if (/\bgit\s+push\b/i.test(combinedText)) {
        if (/--delete|\s:\S+/i.test(combinedText)) {
          reqs.add('gitAndDev.gitDeleteBranch');
        } else {
          reqs.add('gitAndDev.gitPushRemote');
        }
      }
      if (/\bgit\s+branch\s+(-d|-D|--delete)\b/i.test(combinedText)) {
        reqs.add('gitAndDev.gitDeleteBranch');
      }
      if (/\bgit\s+(push\s+-u|push\s+--set-upstream|remote\s+)/i.test(combinedText)) {
        reqs.add('gitAndDev.gitModifyRemoteBranch');
      }
      if (/\bgit\s+commit\b/i.test(combinedText)) {
        reqs.add('gitAndDev.gitCreateCommit');
      }
      if (/\bgit\s+(add|rm|mv|reset|checkout|switch|merge|rebase|cherry-pick|stash|pull|init|clone)\b/i.test(combinedText)) {
        reqs.add('gitAndDev.gitModifyRepo');
      }
      if (/\bgit\s+(status|log|diff|show|branch|tag|rev-parse|ls-files)\b/i.test(combinedText)) {
        reqs.add('gitAndDev.gitReadRepo');
      }
    }

    // Package managers & project deps
    if (/\bpip3?\s+install\b/i.test(combinedText)) {
      reqs.add('softwareAndPackages.pkgPipInstall');
      reqs.add('softwareAndPackages.pkgProjectDeps');
      reqs.add('gitAndDev.devInstallProjectDeps');
    }
    if (/\b(npm|pnpm|yarn)\s+(install|i|ci|add)\b/i.test(combinedText)) {
      reqs.add('softwareAndPackages.pkgNpmInstall');
      reqs.add('softwareAndPackages.pkgProjectDeps');
      reqs.add('gitAndDev.devInstallProjectDeps');
    }
    if (/\b(npm\s+run\s+build|pnpm\s+build|yarn\s+build|vite\s+build|tsc\b|cargo\s+build|go\s+build|dotnet\s+build)\b/i.test(combinedText)) {
      reqs.add('gitAndDev.devRunBuild');
    }
    if (/\b(npm\s+test|npm\s+run\s+test|pytest|vitest|jest|playwright|cargo\s+test|go\s+test|dotnet\s+test)\b/i.test(combinedText)) {
      reqs.add('gitAndDev.devRunTests');
    }
    if (/\b(winget|choco|scoop|brew|apt|apt-get|dnf|yum|msiexec)\s+(install|upgrade)\b/i.test(combinedText)) {
      reqs.add('softwareAndPackages.pkgInstallApps');
    }
    if (/\b(winget|choco|scoop|brew|apt|apt-get|dnf|yum|msiexec)\s+(uninstall|remove|purge)\b/i.test(combinedText)) {
      reqs.add('softwareAndPackages.pkgUninstallApps');
    }

    // Processes & System
    if (/\b(taskkill|kill|killall|pkill|stop-process)\b/i.test(combinedText)) {
      reqs.add('processesAndSystem.sysKillProcesses');
    }
    if (/\b(tasklist|get-process|ps\b|top\b|htop)\b/i.test(combinedText)) {
      reqs.add('processesAndSystem.sysViewProcesses');
    }
    if (/\b(start-process|start\s+)\b/i.test(combinedText) && !isAdminRequired) {
      reqs.add('processesAndSystem.sysStartProcesses');
    }
    if (/\b(systeminfo|get-computerinfo|uname|lscpu|wmic|msinfo32)\b/i.test(combinedText)) {
      reqs.add('processesAndSystem.sysReadHardwareSoftware');
    }
    if (/\b(reg\s+(add|delete|import|restore)|set-itemproperty[^\n]*(hklm|hkcu)|new-itemproperty[^\n]*(hklm|hkcu)|remove-itemproperty[^\n]*(hklm|hkcu))\b/i.test(combinedText)) {
      reqs.add('processesAndSystem.sysModifyRegistry');
    }
    if (/\b(start-service|stop-service|restart-service|set-service|sc\s+(start|stop|config|create|delete)|net\s+(start|stop)|systemctl\s+(start|stop|restart|enable|disable))\b/i.test(combinedText)) {
      reqs.add('processesAndSystem.sysManageServices');
    }
    if (/\b(setx|\[environment\]::setenvironmentvariable|export\s+path=)\b/i.test(combinedText)) {
      reqs.add('softwareAndPackages.pkgModifyPathEnv');
      reqs.add('processesAndSystem.sysModifyEnv');
    }
    if (/\b(shutdown|restart-computer|stop-computer|reboot|poweroff|halt)\b/i.test(combinedText)) {
      reqs.add('processesAndSystem.sysRebootShutdown');
    }
    if (/\b(netsh\s+interface|ipconfig\s+\/(release|renew)|set-netipaddress|nmcli|ifconfig\s+\S+\s+(up|down))\b/i.test(combinedText)) {
      reqs.add('processesAndSystem.sysModifyNetworkConfig');
    }

    // Applications closing / associated file open
    if (/\b(closemainwindow|taskkill[^\n]*\.(exe))\b/i.test(combinedText)) {
      reqs.add('applications.appsClose');
    }
    if (/\b(invoke-item|xdg-open|\bopen\s+)\b/i.test(combinedText)) {
      reqs.add('applications.appsOpenAssociatedFiles');
    }

    // Clipboard & Desktop
    if (/\b(get-clipboard|pbpaste|xclip\s+-o|xsel\s+-o)\b/i.test(combinedText)) {
      reqs.add('clipboardAndDesktop.desktopReadClipboard');
    }
    if (/\b(set-clipboard|pbcopy|\bclip\b|xclip\s+-i|xsel\s+-i)\b/i.test(combinedText)) {
      reqs.add('clipboardAndDesktop.desktopWriteClipboard');
    }
    if (/\b(pyautogui|pynput|xdotool|sendkeys|mouse_event|keybd_event)\b/i.test(combinedText)) {
      reqs.add('clipboardAndDesktop.desktopMouseKeyboard');
      reqs.add('clipboardAndDesktop.desktopGuiAutomation');
    }
    if (/\b(screenshot|screencapture|scrot|mss|imagegrab|copyfromscreen)\b/i.test(combinedText)) {
      reqs.add('clipboardAndDesktop.desktopScreenshot');
      reqs.add('clipboardAndDesktop.desktopReadScreen');
    }

    // Network & Web
    if (/\b(curl|wget|invoke-webrequest|invoke-restmethod|fetch\(|requests\.(get|post)|httpie)\b/i.test(combinedText) || /https?:\/\//i.test(combinedText)) {
      reqs.add('network.netHttpRequests');
      if (/\b(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|localhost|127\.0\.0\.1|\.local\b)/i.test(combinedText)) {
        reqs.add('network.netLocalNetworkAccess');
      } else {
        reqs.add('network.netInternetAccess');
      }
      if (/\s(-o|-O|--output|-OutFile)\b/i.test(combinedText)) {
        reqs.add('webAndBrowser.webDownloadFiles');
      }
      if (/\s(-F|--form|-T|--upload-file)\b/i.test(combinedText)) {
        reqs.add('webAndBrowser.webUploadFiles');
      }
    }
    if (/\b(new-netfirewallrule|netsh\s+advfirewall|ufw\s+allow|iptables\s+-A|firewall-cmd)\b/i.test(combinedText)) {
      reqs.add('network.netOpenPorts');
    }
    if (/\b(npm\s+run\s+dev|npm\s+start|vite\b(?!\s+build)|next\s+dev|python\s+-m\s+http\.server|uvicorn|flask\s+run|npx\s+serve)\b/i.test(combinedText)) {
      reqs.add('network.netStartLocalServers');
    }
  }

  const hasPlaintextCredentials = detectPlaintextCredentialsCommand(combinedText);
  const requiresInteractiveTerminal = detectInteractiveAuthCommand(combinedText);
  const missingWorkingDirectoryForMutation =
    !params.workingDirectory?.trim() &&
    detectFilesystemMutationOrScriptCommand(combinedText, Boolean(params.script?.trim()));

  const finalized = finalizeEval(cfg, reqs, isAdminRequired);
  if (
    hasPlaintextCredentials ||
    requiresInteractiveTerminal ||
    missingWorkingDirectoryForMutation
  ) {
    return {
      ...finalized,
      allowed: false,
      hasPlaintextCredentials: hasPlaintextCredentials || undefined,
      requiresInteractiveTerminal: requiresInteractiveTerminal || undefined,
      missingWorkingDirectoryForMutation: missingWorkingDirectoryForMutation || undefined,
      riskLevel: hasPlaintextCredentials ? 'elevato' : finalized.riskLevel,
    };
  }
  return finalized;
}

export function buildAutoApprovePromptSummary(
  settings?: AutoApproveSettings,
  agentReadOnly = false,
): string {
  const cfg = settings ?? getDefaultAutoApproveSettings();
  const profileId = cfg.profile ?? 'custom';
  const profileName =
    AUTO_APPROVE_PROFILES.find((p) => p.id === profileId)?.name ?? 'Personalizzato';
  const enabledCount = countEnabledAutoApprovePermissions(cfg);
  const totalCount = countTotalAutoApprovePermissions();
  const adminStatus = cfg.terminalAndCommands.execAsAdmin
    ? 'ATTIVA (separata)'
    : 'DISATTIVATA (richiede sempre conferma manuale separata)';

  const disabledSensitive: string[] = [];
  for (const cat of AUTO_APPROVE_CATEGORIES) {
    for (const item of cat.items) {
      if (!getAutoApprovePermissionValue(cfg, cat.id, item.key)) {
        disabledSensitive.push(item.label);
      }
    }
  }

  return [
    `[POLITICA AUTO-APPROVE ATTIVA: Profilo "${profileName}" · ${enabledCount}/${totalCount} autorizzazioni indipendenti abilitate]`,
    agentReadOnly
      ? '- VINCOLO AGENTE IN SOLA LETTURA: l’agente attivo è consultivo/sola lettura. Auto-Approve e consenso di sessione sono SOSPESI per scritture (aihub-write) ed esecuzioni locali (aihub-pc-exec): richiedono sempre approvazione esplicita dell’utente.'
      : '',
    `- Privilegi amministrativi: ${adminStatus}.`,
    `- Le operazioni coperte da Auto-Approve attivo vengono eseguite automaticamente dal sistema dopo l'emissione del blocco, mentre le operazioni con Auto-Approve disattivato (o senza CWD autorizzata per scritture/script o con input credenziali interattive) mostrano la card di conferma manuale all'utente.`,
    disabledSensitive.length > 0
      ? `- Operazioni che richiedono SEMPRE conferma manuale dell'utente: ${disabledSensitive.slice(0, 24).join(', ')}${disabledSensitive.length > 24 ? ` (e altre ${disabledSensitive.length - 24})` : ''}.`
      : '- Tutte le operazioni di Auto-Approve sono attualmente abilitate.',
  ]
    .filter(Boolean)
    .join('\n');
}
