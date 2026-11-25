import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ChatAttachment,
  ChatSession,
  CopilotLicenseStatus,
  CopilotMode,
  CopilotModelInfo,
  CopilotPublicStatus,
  CopilotSessionMode,
} from '../src/types/ai.ts';
import { ensureDataDir, getDataDir } from './dataDir.ts';
import { validateOutboundUrl } from './ssrfGuard.ts';
import {
  clearCopilotTokens,
  getCopilotTokens,
  saveCopilotTokens,
  type CopilotStoredTokens,
} from './vault.ts';

function getCopilotStateFile(): string {
  return path.join(getDataDir(), 'copilot.json');
}

interface PersistedCopilotState {
  mode: CopilotMode;
  m365: {
    tenantId: string;
    clientId: string;
    accountName?: string;
    accountEmail?: string;
    license?: CopilotLicenseStatus;
  };
  github: {
    enterpriseUrl: string;
    clientId: string;
    accountLogin?: string;
    accountName?: string;
    selectedModelId: string;
    models: CopilotModelInfo[];
    license?: CopilotLicenseStatus;
  };
  sessions: ChatSession[];
}

interface PendingOAuthTransaction {
  mode: CopilotMode;
  codeVerifier?: string;
  tenantId?: string;
  clientId: string;
  enterpriseUrl?: string;
  redirectUri: string;
  createdAt: number;
}

const pendingOAuthStates = new Map<string, PendingOAuthTransaction>();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function cleanupExpiredOAuthStates(): void {
  const cutoff = Date.now() - OAUTH_STATE_TTL_MS;
  for (const [key, tx] of pendingOAuthStates.entries()) {
    if (tx.createdAt < cutoff) {
      pendingOAuthStates.delete(key);
    }
  }
}

function defaultState(): PersistedCopilotState {
  return {
    mode: 'm365',
    m365: {
      tenantId: process.env.M365_COPILOT_TENANT_ID?.trim() || 'organizations',
      clientId: '',
    },
    github: {
      enterpriseUrl: 'https://github.com',
      clientId: '',
      selectedModelId: 'gpt-4o',
      models: [],
    },
    sessions: [],
  };
}

export function loadCopilotState(): PersistedCopilotState {
  ensureDataDir();
  const stateFile = getCopilotStateFile();
  const base = defaultState();
  if (!fs.existsSync(stateFile)) {
    return base;
  }
  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedCopilotState>;
    return {
      mode: parsed.mode === 'github' ? 'github' : 'm365',
      m365: {
        ...base.m365,
        ...(parsed.m365 ?? {}),
      },
      github: {
        ...base.github,
        ...(parsed.github ?? {}),
        models: Array.isArray(parsed.github?.models) ? parsed.github.models : [],
      },
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch {
    return base;
  }
}

export function saveCopilotState(state: PersistedCopilotState): void {
  ensureDataDir();
  const stateFile = getCopilotStateFile();
  const tmpFile = `${stateFile}.tmp-${process.pid}`;
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmpFile, stateFile);
}

export function getPublicCopilotStatus(): CopilotPublicStatus {
  const state = loadCopilotState();
  const m365Tokens = getCopilotTokens('m365');
  const ghTokens = getCopilotTokens('github');
  const envM365Client = process.env.M365_COPILOT_CLIENT_ID?.trim() || '';
  const envM365Secret = process.env.M365_COPILOT_CLIENT_SECRET?.trim() || '';
  const envGhClient = process.env.GITHUB_COPILOT_CLIENT_ID?.trim() || '';
  const envGhSecret = process.env.GITHUB_COPILOT_CLIENT_SECRET?.trim() || '';

  return {
    mode: state.mode,
    m365: {
      connected: Boolean(m365Tokens?.accessToken),
      tenantId: state.m365.tenantId || 'organizations',
      clientId: state.m365.clientId || envM365Client,
      hasEnvClientId: Boolean(envM365Client),
      hasEnvClientSecret: Boolean(envM365Secret),
      accountName: state.m365.accountName,
      accountEmail: state.m365.accountEmail,
      expiresAt: m365Tokens?.expiresAt,
      license: state.m365.license,
    },
    github: {
      connected: Boolean(ghTokens?.accessToken),
      enterpriseUrl: state.github.enterpriseUrl || 'https://github.com',
      clientId: state.github.clientId || envGhClient,
      hasEnvClientId: Boolean(envGhClient),
      hasEnvClientSecret: Boolean(envGhSecret),
      accountLogin: state.github.accountLogin,
      accountName: state.github.accountName,
      selectedModelId: state.github.selectedModelId || 'gpt-4o',
      models: state.github.models,
      license: state.github.license,
    },
    sessions: state.sessions,
  };
}

export async function updateCopilotConfig(patch: {
  mode?: CopilotMode;
  tenantId?: string;
  m365ClientId?: string;
  enterpriseUrl?: string;
  githubClientId?: string;
  selectedModelId?: string;
}): Promise<CopilotPublicStatus> {
  const state = loadCopilotState();

  if (patch.mode === 'm365' || patch.mode === 'github') {
    state.mode = patch.mode;
  }
  if (typeof patch.tenantId === 'string') {
    const cleanTenant = patch.tenantId.trim() || 'organizations';
    if (!/^[a-zA-Z0-9.-]{1,128}$/.test(cleanTenant)) {
      throw new Error('Tenant ID Microsoft non valido.');
    }
    state.m365.tenantId = cleanTenant;
  }
  if (typeof patch.m365ClientId === 'string') {
    state.m365.clientId = patch.m365ClientId.trim();
  }
  if (typeof patch.enterpriseUrl === 'string') {
    const raw = patch.enterpriseUrl.trim() || 'https://github.com';
    const parsed = await validateOutboundUrl(raw);
    if (parsed.protocol !== 'https:') {
      throw new Error('Il dominio GitHub / Enterprise deve usare HTTPS.');
    }
    state.github.enterpriseUrl = `${parsed.protocol}//${parsed.host}`;
  }
  if (typeof patch.githubClientId === 'string') {
    state.github.clientId = patch.githubClientId.trim();
  }
  if (typeof patch.selectedModelId === 'string' && patch.selectedModelId.trim()) {
    state.github.selectedModelId = patch.selectedModelId.trim();
  }

  saveCopilotState(state);
  return getPublicCopilotStatus();
}

export function disconnectCopilotAccount(mode?: CopilotMode): CopilotPublicStatus {
  const state = loadCopilotState();
  const target = mode ?? state.mode;
  clearCopilotTokens(target);
  if (target === 'm365') {
    state.m365.accountName = undefined;
    state.m365.accountEmail = undefined;
    state.m365.license = undefined;
  } else {
    state.github.accountLogin = undefined;
    state.github.accountName = undefined;
    state.github.models = [];
    state.github.license = undefined;
  }
  saveCopilotState(state);
  return getPublicCopilotStatus();
}

export function resolveAppBaseUrl(clientOrigin?: string): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl && envUrl !== 'MY_APP_URL' && /^https?:\/\//i.test(envUrl)) {
    return envUrl.replace(/\/+$/, '');
  }
  if (clientOrigin && /^https?:\/\/(localhost|127\.0\.0\.1|[a-zA-Z0-9.-]+\.run\.app)(:\d+)?$/i.test(clientOrigin.trim())) {
    return clientOrigin.trim().replace(/\/+$/, '');
  }
  return 'http://localhost:3000';
}

function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ---------- MICROSOFT 365 COPILOT (ENTRA ID OAUTH + GRAPH CHAT API) ----------

const DEFAULT_M365_PUBLIC_CLIENT_ID = '14d82eec-204b-4c2f-b7e8-296a70dab67e';
const DEFAULT_GITHUB_COPILOT_PUBLIC_CLIENT_ID = 'Iv1.b507a08c87ecfe98';

const M365_BASE_SCOPES = 'openid profile email offline_access User.Read';

const M365_COPILOT_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'Sites.Read.All',
  'Mail.Read',
  'People.Read.All',
  'OnlineMeetingTranscript.Read.All',
  'Chat.Read',
  'ChannelMessage.Read.All',
  'ExternalItem.Read.All',
].join(' ');

function resolveM365Client(
  overrideClientId?: string,
  stateClientId?: string,
): { clientId: string; isCustomApp: boolean } {
  const custom = (
    overrideClientId?.trim() ||
    stateClientId?.trim() ||
    process.env.M365_COPILOT_CLIENT_ID?.trim() ||
    ''
  ).trim();
  if (custom) {
    return { clientId: custom, isCustomApp: true };
  }
  return { clientId: DEFAULT_M365_PUBLIC_CLIENT_ID, isCustomApp: false };
}

const M365_E7_SKU_ID = '9a18296a-025f-4e37-9ffa-30bf8d1ce775';
const M365_COPILOT_SKU_ID = '639dec6b-bb19-468b-871c-c5c441c4b0cb';

export async function inspectM365Licenses(accessToken: string): Promise<CopilotLicenseStatus> {
  const checkedAt = new Date().toISOString();
  const detectedPlans = new Set<string>();
  let hasE7 = false;
  let hasCopilotSku = false;
  let hasCoworkPlan = false;
  let hasCopilotChatPlan = false;

  try {
    const detailsRes = await fetch('https://graph.microsoft.com/v1.0/me/licenseDetails', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (detailsRes.ok) {
      const json = (await detailsRes.json()) as {
        value?: Array<{
          skuId?: string;
          skuPartNumber?: string;
          servicePlans?: Array<{
            servicePlanName?: string;
            provisioningStatus?: string;
          }>;
        }>;
      };
      for (const lic of json.value ?? []) {
        const skuId = (lic.skuId || '').toLowerCase();
        const skuName = (lic.skuPartNumber || '').trim();
        if (skuName) {
          detectedPlans.add(skuName);
        }
        if (skuId === M365_E7_SKU_ID || /MICROSOFT_365_E7/i.test(skuName)) {
          hasE7 = true;
          hasCoworkPlan = true;
          hasCopilotChatPlan = true;
        }
        if (
          skuId === M365_COPILOT_SKU_ID ||
          /MICROSOFT_365_COPILOT|COPILOT_PRO/i.test(skuName)
        ) {
          hasCopilotSku = true;
          hasCopilotChatPlan = true;
        }
        if (/COWORK|FRONTIER/i.test(skuName)) {
          hasCoworkPlan = true;
          hasCopilotChatPlan = true;
        }

        for (const sp of lic.servicePlans ?? []) {
          const spName = (sp.servicePlanName || '').trim();
          const status = (sp.provisioningStatus || '').toLowerCase();
          if (!spName || status === 'disabled') continue;
          if (/COPILOT|COWORK|FRONTIER|AGENT|BING_CHAT/i.test(spName)) {
            detectedPlans.add(spName);
          }
          if (
            /COWORK|FRONTIER|AGENT_365|ASSISTIVE_AGENTS|COPILOT_AGENTS|WORK_IQ|COPILOT_STUDIO_IN_COPILOT_FOR_M365/i.test(
              spName,
            )
          ) {
            hasCoworkPlan = true;
            hasCopilotChatPlan = true;
          }
          if (
            /MICROSOFT_365_COPILOT|MICROSOFT_COPILOT_WITH_GRAPH|M365_COPILOT|COPILOT_PRO|BING_CHAT_ENTERPRISE/i.test(
              spName,
            )
          ) {
            hasCopilotChatPlan = true;
          }
        }
      }

      if (hasE7 || hasCoworkPlan) {
        return {
          checked: true,
          checkedAt,
          copilotChatEnabled: true,
          coworkEnabled: true,
          licenseTierLabel: hasE7
            ? 'Microsoft 365 E7 (Frontier + Cowork)'
            : 'Microsoft 365 Copilot + Cowork',
          coworkReason: 'Abilitato dalla licenza aziendale rilevata su Microsoft Graph.',
          detectedPlans: Array.from(detectedPlans).slice(0, 12),
        };
      }

      if (hasCopilotSku || hasCopilotChatPlan) {
        return {
          checked: true,
          checkedAt,
          copilotChatEnabled: true,
          coworkEnabled: false,
          licenseTierLabel: 'Microsoft 365 Copilot (Solo Chat)',
          coworkReason:
            'La licenza corrente include Copilot Chat ma non prevede piani Frontier / Cowork (es. Microsoft 365 E7 o add-on Copilot Cowork).',
          detectedPlans: Array.from(detectedPlans).slice(0, 12),
        };
      }

      return {
        checked: true,
        checkedAt,
        copilotChatEnabled: true,
        coworkEnabled: false,
        licenseTierLabel: 'Account Microsoft 365 senza add-on Cowork',
        coworkReason:
          'Nessun piano Copilot Cowork / Frontier rilevato tra le licenze assegnate a questa utenza.',
        detectedPlans: Array.from(detectedPlans).slice(0, 12),
      };
    }

    // Fallback: inspect assignedLicenses GUIDs from /v1.0/me
    const meRes = await fetch(
      'https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName,assignedLicenses',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (meRes.ok) {
      const me = (await meRes.json()) as {
        assignedLicenses?: Array<{ skuId?: string }>;
      };
      for (const lic of me.assignedLicenses ?? []) {
        const skuId = (lic.skuId || '').toLowerCase();
        if (skuId === M365_E7_SKU_ID) {
          hasE7 = true;
          hasCoworkPlan = true;
          detectedPlans.add('MICROSOFT_365_E7');
        } else if (skuId === M365_COPILOT_SKU_ID) {
          hasCopilotSku = true;
          detectedPlans.add('Microsoft_365_Copilot');
        }
      }
      if (hasE7) {
        return {
          checked: true,
          checkedAt,
          copilotChatEnabled: true,
          coworkEnabled: true,
          licenseTierLabel: 'Microsoft 365 E7 (Frontier + Cowork)',
          coworkReason: 'Licenza Microsoft 365 E7 rilevata sul profilo aziendale.',
          detectedPlans: Array.from(detectedPlans),
        };
      }
      if (hasCopilotSku) {
        return {
          checked: true,
          checkedAt,
          copilotChatEnabled: true,
          coworkEnabled: false,
          licenseTierLabel: 'Microsoft 365 Copilot (Solo Chat)',
          coworkReason:
            'Licenza Microsoft 365 Copilot rilevata senza piano Cowork / Frontier (E7).',
          detectedPlans: Array.from(detectedPlans),
        };
      }
    }
  } catch {
    // Non-fatal Graph license check failure
  }

  return {
    checked: true,
    checkedAt,
    copilotChatEnabled: true,
    coworkEnabled: false,
    licenseTierLabel: 'Licenza aziendale non verificabile da Graph',
    coworkReason:
      'Il tenant non espone i dettagli licenza (/me/licenseDetails): modalità Cowork disabilitata per sicurezza.',
    detectedPlans: Array.from(detectedPlans),
  };
}

export function buildM365AuthUrl(params: {
  tenantId?: string;
  clientId?: string;
  clientOrigin?: string;
  loginHint?: string;
}): { url: string; redirectUri: string } {
  cleanupExpiredOAuthStates();
  const state = loadCopilotState();
  const tenantId = (params.tenantId?.trim() || state.m365.tenantId || 'organizations').trim();
  if (!/^[a-zA-Z0-9.-]{1,128}$/.test(tenantId)) {
    throw new Error('Tenant ID Microsoft non valido.');
  }
  const { clientId, isCustomApp } = resolveM365Client(params.clientId, state.m365.clientId);
  if (!isCustomApp) {
    throw new Error(
      'Il popup OAuth Web richiede un Client ID personalizzato con Redirect URI registrato. Usa il login con Email & Password oppure il Codice Dispositivo Microsoft.',
    );
  }

  state.m365.tenantId = tenantId;
  if (params.clientId?.trim()) {
    state.m365.clientId = params.clientId.trim();
  }
  state.mode = 'm365';
  saveCopilotState(state);

  const baseUrl = resolveAppBaseUrl(params.clientOrigin);
  const redirectUri = `${baseUrl}/api/copilot/m365/callback`;
  const oauthState = crypto.randomBytes(24).toString('base64url');
  const pkce = generatePkcePair();

  pendingOAuthStates.set(oauthState, {
    mode: 'm365',
    codeVerifier: pkce.verifier,
    tenantId,
    clientId,
    redirectUri,
    createdAt: Date.now(),
  });

  const query = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: M365_COPILOT_SCOPES,
    state: oauthState,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    prompt: params.loginHint ? 'login' : 'select_account',
  });
  if (params.loginHint?.trim()) {
    query.set('login_hint', params.loginHint.trim());
  }

  return {
    url: `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize?${query.toString()}`,
    redirectUri,
  };
}

async function finalizeM365Login(
  tokenJson: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  },
  fallbackEmail?: string,
): Promise<CopilotPublicStatus> {
  const expiresAt = tokenJson.expires_in
    ? new Date(Date.now() + Math.max(60, tokenJson.expires_in - 60) * 1000).toISOString()
    : undefined;

  let accountName: string | undefined;
  let accountEmail: string | undefined = fallbackEmail;
  try {
    const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (meRes.ok) {
      const me = (await meRes.json()) as {
        displayName?: string;
        mail?: string;
        userPrincipalName?: string;
      };
      accountName = me.displayName;
      accountEmail = me.mail || me.userPrincipalName || fallbackEmail;
    }
  } catch {
    // Non-fatal profile lookup
  }

  const license = await inspectM365Licenses(tokenJson.access_token);

  saveCopilotTokens('m365', {
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token,
    expiresAt,
  });

  const nextState = loadCopilotState();
  nextState.mode = 'm365';
  nextState.m365.accountName = accountName;
  nextState.m365.accountEmail = accountEmail;
  nextState.m365.license = license;
  saveCopilotState(nextState);

  return getPublicCopilotStatus();
}

export async function startM365DeviceLogin(params: {
  tenantId?: string;
  clientId?: string;
  emailHint?: string;
}): Promise<{
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  message?: string;
}> {
  const state = loadCopilotState();
  const tenantId = (params.tenantId?.trim() || state.m365.tenantId || 'organizations').trim();
  if (!/^[a-zA-Z0-9.-]{1,128}$/.test(tenantId)) {
    throw new Error('Tenant ID Microsoft non valido.');
  }
  const { clientId, isCustomApp } = resolveM365Client(params.clientId, state.m365.clientId);

  state.m365.tenantId = tenantId;
  if (params.clientId?.trim()) {
    state.m365.clientId = params.clientId.trim();
  }
  state.mode = 'm365';
  saveCopilotState(state);

  const requestDeviceCode = async (scope: string) => {
    const res = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/devicecode`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          scope,
        }).toString(),
      },
    );
    const json = (await res.json()) as {
      device_code?: string;
      user_code?: string;
      verification_uri?: string;
      expires_in?: number;
      interval?: number;
      message?: string;
      error?: string;
      error_description?: string;
    };
    return { res, json };
  };

  let attempt = await requestDeviceCode(M365_COPILOT_SCOPES);
  if (
    (!attempt.res.ok || !attempt.json.device_code) &&
    !isCustomApp &&
    /AADSTS65001|AADSTS70011|invalid_scope|consent/i.test(
      `${attempt.json.error || ''} ${attempt.json.error_description || ''}`,
    )
  ) {
    attempt = await requestDeviceCode(M365_BASE_SCOPES);
  }

  if (!attempt.res.ok || !attempt.json.device_code || !attempt.json.user_code) {
    throw new Error(
      attempt.json.error_description ||
        attempt.json.error ||
        `Impossibile avviare il login Microsoft Device Code (HTTP ${attempt.res.status}).`,
    );
  }

  return {
    deviceCode: attempt.json.device_code,
    userCode: attempt.json.user_code,
    verificationUri: attempt.json.verification_uri || 'https://microsoft.com/devicelogin',
    expiresIn: attempt.json.expires_in ?? 900,
    interval: attempt.json.interval ?? 5,
    message: attempt.json.message,
  };
}

export async function pollM365DeviceLogin(params: {
  deviceCode: string;
  tenantId?: string;
  clientId?: string;
  emailHint?: string;
}): Promise<{
  status: 'pending' | 'slow_down' | 'complete';
  interval?: number;
  copilot?: CopilotPublicStatus;
}> {
  const state = loadCopilotState();
  const tenantId = (params.tenantId?.trim() || state.m365.tenantId || 'organizations').trim();
  const { clientId } = resolveM365Client(params.clientId, state.m365.clientId);

  if (!params.deviceCode) {
    throw new Error('Codice dispositivo Microsoft mancante.');
  }

  const form = new URLSearchParams({
    client_id: clientId,
    device_code: params.deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  const envSecret = process.env.M365_COPILOT_CLIENT_SECRET?.trim();
  if (envSecret && clientId !== DEFAULT_M365_PUBLIC_CLIENT_ID) {
    form.set('client_secret', envSecret);
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    },
  );

  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (json.error === 'authorization_pending') {
    return { status: 'pending' };
  }
  if (json.error === 'slow_down') {
    return { status: 'slow_down' };
  }
  if (json.error) {
    throw new Error(json.error_description || json.error);
  }
  if (!json.access_token) {
    throw new Error('Token Microsoft non ricevuto.');
  }

  const copilot = await finalizeM365Login(
    {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_in: json.expires_in,
    },
    params.emailHint,
  );
  return { status: 'complete', copilot };
}

export async function loginM365WithCredentials(params: {
  email: string;
  password: string;
  tenantId?: string;
  clientId?: string;
  clientOrigin?: string;
}): Promise<
  | { ok: true; copilot: CopilotPublicStatus }
  | {
      ok: false;
      requiresInteractiveOAuth: true;
      url: string;
      redirectUri: string;
      message: string;
    }
  | {
      ok: false;
      requiresDeviceCode: true;
      deviceCode: string;
      userCode: string;
      verificationUri: string;
      interval: number;
      message: string;
    }
> {
  const email = params.email.trim();
  const password = params.password;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Inserisci un indirizzo email aziendale valido.');
  }
  if (!password) {
    throw new Error('Inserisci la password del tuo account aziendale.');
  }

  const state = loadCopilotState();
  const tenantId = (params.tenantId?.trim() || state.m365.tenantId || 'organizations').trim();
  if (!/^[a-zA-Z0-9.-]{1,128}$/.test(tenantId)) {
    throw new Error('Tenant aziendale non valido.');
  }

  const { clientId, isCustomApp } = resolveM365Client(params.clientId, state.m365.clientId);

  if (params.clientId?.trim()) {
    state.m365.clientId = params.clientId.trim();
  }
  if (params.tenantId?.trim()) {
    state.m365.tenantId = params.tenantId.trim();
  }
  state.mode = 'm365';
  saveCopilotState(state);

  const runPasswordGrant = async (scope: string) => {
    const form = new URLSearchParams({
      client_id: clientId,
      grant_type: 'password',
      username: email,
      password,
      scope,
    });
    const envSecret = process.env.M365_COPILOT_CLIENT_SECRET?.trim();
    if (envSecret && isCustomApp) {
      form.set('client_secret', envSecret);
    }

    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
      error_codes?: number[];
    };
    return { tokenRes, tokenJson };
  };

  let attempt = await runPasswordGrant(M365_COPILOT_SCOPES);

  if (
    (!attempt.tokenRes.ok || !attempt.tokenJson.access_token) &&
    !isCustomApp &&
    /AADSTS65001|AADSTS70011|invalid_scope/i.test(
      `${attempt.tokenJson.error || ''} ${attempt.tokenJson.error_description || ''}`,
    )
  ) {
    attempt = await runPasswordGrant(M365_BASE_SCOPES);
  }

  const { tokenRes, tokenJson } = attempt;

  if (!tokenRes.ok || !tokenJson.access_token) {
    const errText = `${tokenJson.error || ''} ${tokenJson.error_description || ''}`;
    const codes = new Set(tokenJson.error_codes ?? []);
    const needsInteractiveMfa =
      codes.has(50076) ||
      codes.has(50079) ||
      codes.has(50158) ||
      codes.has(53003) ||
      codes.has(65001) ||
      codes.has(50055) ||
      codes.has(7000218) ||
      (!codes.has(50126) &&
        /AADSTS50076|AADSTS50079|AADSTS50158|AADSTS53003|AADSTS65001|AADSTS7000218|interaction_required|multi-factor|federat|ADFS|WS-Trust|ROPC/i.test(
          errText,
        ));

    if (needsInteractiveMfa) {
      if (isCustomApp) {
        const oauth = buildM365AuthUrl({
          tenantId,
          clientId,
          clientOrigin: params.clientOrigin,
          loginHint: email,
        });
        return {
          ok: false,
          requiresInteractiveOAuth: true,
          url: oauth.url,
          redirectUri: oauth.redirectUri,
          message:
            'Il tuo account aziendale richiede verifica MFA / SSO Microsoft. Completa l’accesso nella finestra Microsoft con la tua email precompilata.',
        };
      }

      const device = await startM365DeviceLogin({
        tenantId,
        clientId,
        emailHint: email,
      });
      return {
        ok: false,
        requiresDeviceCode: true,
        deviceCode: device.deviceCode,
        userCode: device.userCode,
        verificationUri: device.verificationUri,
        interval: device.interval,
        message:
          'Il tuo account aziendale richiede verifica MFA o SSO Microsoft. Apri il link qui sotto ed inserisci il codice con la tua email aziendale.',
      };
    }

    throw new Error(
      tokenJson.error_description ||
        tokenJson.error ||
        `Autenticazione Microsoft rifiutata (HTTP ${tokenRes.status}).`,
    );
  }

  const copilot = await finalizeM365Login(
    {
      access_token: tokenJson.access_token,
      refresh_token: tokenJson.refresh_token,
      expires_in: tokenJson.expires_in,
    },
    email,
  );
  return { ok: true, copilot };
}

export async function completeM365OAuthCallback(params: {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}): Promise<{ accountEmail?: string; accountName?: string }> {
  cleanupExpiredOAuthStates();
  if (params.error) {
    throw new Error(params.errorDescription || params.error);
  }
  if (!params.code || !params.state) {
    throw new Error('Parametri OAuth mancanti nella risposta Microsoft.');
  }

  const tx = pendingOAuthStates.get(params.state);
  if (!tx || tx.mode !== 'm365') {
    throw new Error('Sessione OAuth scaduta o non valida. Riprova ad accedere.');
  }
  pendingOAuthStates.delete(params.state);

  const form = new URLSearchParams({
    client_id: tx.clientId,
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: tx.redirectUri,
    code_verifier: tx.codeVerifier || '',
    scope: M365_COPILOT_SCOPES,
  });
  const envSecret = process.env.M365_COPILOT_CLIENT_SECRET?.trim();
  if (envSecret) {
    form.set('client_secret', envSecret);
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tx.tenantId || 'organizations')}/oauth2/v2.0/token`;
  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(
      tokenJson.error_description ||
        tokenJson.error ||
        `Errore scambio token Microsoft (HTTP ${tokenRes.status}).`,
    );
  }

  const expiresAt = tokenJson.expires_in
    ? new Date(Date.now() + Math.max(60, tokenJson.expires_in - 60) * 1000).toISOString()
    : undefined;

  let accountName: string | undefined;
  let accountEmail: string | undefined;
  try {
    const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (meRes.ok) {
      const me = (await meRes.json()) as {
        displayName?: string;
        mail?: string;
        userPrincipalName?: string;
      };
      accountName = me.displayName;
      accountEmail = me.mail || me.userPrincipalName;
    }
  } catch {
    // Non-fatal profile lookup failure
  }

  const license = await inspectM365Licenses(tokenJson.access_token);

  saveCopilotTokens('m365', {
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token,
    expiresAt,
  });

  const state = loadCopilotState();
  state.mode = 'm365';
  state.m365.accountName = accountName;
  state.m365.accountEmail = accountEmail;
  state.m365.license = license;
  saveCopilotState(state);

  return { accountEmail, accountName };
}

async function ensureFreshM365Token(): Promise<string> {
  const tokens = getCopilotTokens('m365');
  if (!tokens?.accessToken) {
    throw new Error('Account aziendale Microsoft non connesso. Effettua prima il login.');
  }
  if (!tokens.expiresAt || Date.parse(tokens.expiresAt) > Date.now() + 30_000) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) {
    return tokens.accessToken;
  }

  const state = loadCopilotState();
  const { clientId, isCustomApp } = resolveM365Client(undefined, state.m365.clientId);

  const form = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    scope: isCustomApp ? M365_COPILOT_SCOPES : M365_BASE_SCOPES,
  });
  const envSecret = process.env.M365_COPILOT_CLIENT_SECRET?.trim();
  if (envSecret && isCustomApp) {
    form.set('client_secret', envSecret);
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(state.m365.tenantId || 'organizations')}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    },
  );
  if (!res.ok) {
    throw new Error('Sessione Microsoft scaduta. Riconnetti il tuo account aziendale.');
  }
  const refreshed = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!refreshed.access_token) {
    throw new Error('Sessione Microsoft scaduta. Riconnetti il tuo account aziendale.');
  }

  saveCopilotTokens('m365', {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || tokens.refreshToken,
    expiresAt: refreshed.expires_in
      ? new Date(Date.now() + Math.max(60, refreshed.expires_in - 60) * 1000).toISOString()
      : undefined,
  });
  return refreshed.access_token;
}

// ---------- GITHUB COPILOT (PRO / BUSINESS / ENTERPRISE AZIENDALE) ----------

function getGitHubApiRoot(enterpriseUrl: string): string {
  const parsed = new URL(enterpriseUrl);
  if (parsed.hostname === 'github.com' || parsed.hostname === 'www.github.com') {
    return 'https://api.github.com';
  }
  if (parsed.hostname.endsWith('.ghe.com')) {
    return `https://api.${parsed.hostname}`;
  }
  return `${parsed.protocol}//${parsed.host}/api/v3`;
}

function getCopilotDefaultApiBase(enterpriseUrl: string): string {
  const parsed = new URL(enterpriseUrl);
  if (parsed.hostname.endsWith('.ghe.com')) {
    return `https://copilot-api.${parsed.hostname}`;
  }
  return 'https://api.githubcopilot.com';
}

const COPILOT_HEADERS = {
  'Accept': 'application/json',
  'Editor-Version': 'vscode/1.99.0',
  'Editor-Plugin-Version': 'copilot-chat/0.26.7',
  'User-Agent': 'GitHubCopilotChat/0.26.7',
  'Copilot-Integration-Id': 'vscode-chat',
  'openai-intent': 'conversation-panel',
  'x-github-api-version': '2025-04-01',
};

async function exchangeGitHubForCopilotSession(
  githubAccessToken: string,
  enterpriseUrl: string,
): Promise<{
  token: string;
  expiresAt?: string;
  apiEndpoint: string;
  sku?: string;
  copilotPlan?: string;
  chatEnabled?: boolean;
}> {
  const apiRoot = getGitHubApiRoot(enterpriseUrl);
  const res = await fetch(`${apiRoot}/copilot_internal/v2/token`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${githubAccessToken}`,
      Accept: 'application/json',
      'Editor-Version': COPILOT_HEADERS['Editor-Version'],
      'Editor-Plugin-Version': COPILOT_HEADERS['Editor-Plugin-Version'],
      'User-Agent': COPILOT_HEADERS['User-Agent'],
    },
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      throw new Error(
        `L'account autenticato non ha accesso attivo a GitHub Copilot Pro / Business / Enterprise (HTTP ${res.status}). Verifica la licenza aziendale.`,
      );
    }
    throw new Error(`Errore token sessione Copilot (HTTP ${res.status}): ${body.slice(0, 160)}`);
  }

  const json = (await res.json()) as {
    token?: string;
    expires_at?: number;
    endpoints?: { api?: string };
    sku?: string;
    copilot_plan?: string;
    chat_enabled?: boolean;
  };
  if (!json.token) {
    throw new Error('Risposta token sessione Copilot non valida.');
  }

  return {
    token: json.token,
    expiresAt: json.expires_at ? new Date(json.expires_at * 1000).toISOString() : undefined,
    apiEndpoint: json.endpoints?.api?.replace(/\/+$/, '') || getCopilotDefaultApiBase(enterpriseUrl),
    sku: json.sku,
    copilotPlan: json.copilot_plan,
    chatEnabled: json.chat_enabled,
  };
}

function buildGitHubLicenseStatus(session: {
  sku?: string;
  copilotPlan?: string;
  chatEnabled?: boolean;
}): CopilotLicenseStatus {
  const skuRaw = (session.sku || session.copilotPlan || '').trim();
  const isEnterpriseOrBusiness = /enterprise|business|pro_plus|team|org/i.test(skuRaw);
  const label = skuRaw
    ? `GitHub Copilot (${skuRaw})`
    : 'GitHub Copilot Pro / Aziendale';

  return {
    checked: true,
    checkedAt: new Date().toISOString(),
    copilotChatEnabled: session.chatEnabled !== false,
    coworkEnabled: isEnterpriseOrBusiness,
    licenseTierLabel: label,
    coworkReason: isEnterpriseOrBusiness
      ? 'Piano Business / Enterprise / Pro+ rilevato: modalità Cowork multi-file abilitata.'
      : 'La licenza GitHub Copilot rilevata abilita la Chat standard. Cowork richiede un piano Enterprise / Business / Pro+.',
    detectedPlans: skuRaw ? [skuRaw] : ['github_copilot'],
  };
}

async function finalizeGitHubLogin(
  githubAccessToken: string,
  enterpriseUrl: string,
): Promise<{ accountLogin?: string; accountName?: string; models: CopilotModelInfo[] }> {
  const apiRoot = getGitHubApiRoot(enterpriseUrl);
  const session = await exchangeGitHubForCopilotSession(githubAccessToken, enterpriseUrl);

  let accountLogin: string | undefined;
  let accountName: string | undefined;
  try {
    const userRes = await fetch(`${apiRoot}/user`, {
      headers: {
        Authorization: `Bearer ${githubAccessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Free-AI-Hub',
      },
    });
    if (userRes.ok) {
      const u = (await userRes.json()) as { login?: string; name?: string };
      accountLogin = u.login;
      accountName = u.name || u.login;
    }
  } catch {
    // Optional profile info
  }

  const tokensToSave: CopilotStoredTokens = {
    accessToken: githubAccessToken,
    sessionToken: session.token,
    sessionExpiresAt: session.expiresAt,
    apiEndpoint: session.apiEndpoint,
  };
  saveCopilotTokens('github', tokensToSave);

  const models = await fetchGitHubCopilotModelsInternal(session.token, session.apiEndpoint);
  const state = loadCopilotState();
  state.mode = 'github';
  state.github.enterpriseUrl = enterpriseUrl;
  state.github.accountLogin = accountLogin;
  state.github.accountName = accountName;
  state.github.models = models;
  state.github.license = buildGitHubLicenseStatus(session);
  if (models.length > 0 && !models.some((m) => m.id === state.github.selectedModelId)) {
    state.github.selectedModelId = models[0].id;
  }
  saveCopilotState(state);

  return { accountLogin, accountName, models };
}

export async function startGitHubDeviceLogin(params: {
  enterpriseUrl?: string;
  clientId?: string;
}): Promise<{
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}> {
  const state = loadCopilotState();
  const rawEnt = (params.enterpriseUrl?.trim() || state.github.enterpriseUrl || 'https://github.com').trim();
  const parsed = await validateOutboundUrl(rawEnt);
  if (parsed.protocol !== 'https:') {
    throw new Error('Il dominio GitHub / Enterprise deve usare HTTPS.');
  }
  const enterpriseUrl = `${parsed.protocol}//${parsed.host}`;

  const clientId = (
    params.clientId?.trim() ||
    state.github.clientId ||
    process.env.GITHUB_COPILOT_CLIENT_ID?.trim() ||
    DEFAULT_GITHUB_COPILOT_PUBLIC_CLIENT_ID
  ).trim();

  state.github.enterpriseUrl = enterpriseUrl;
  if (params.clientId?.trim()) {
    state.github.clientId = params.clientId.trim();
  }
  state.mode = 'github';
  saveCopilotState(state);

  const res = await fetch(`${enterpriseUrl}/login/device/code`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      scope: 'read:user user:email',
    }).toString(),
  });

  const json = (await res.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !json.device_code || !json.user_code || !json.verification_uri) {
    throw new Error(
      json.error_description ||
        json.error ||
        `Impossibile avviare il login GitHub Device Flow (HTTP ${res.status}).`,
    );
  }

  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    expiresIn: json.expires_in ?? 900,
    interval: json.interval ?? 5,
  };
}

export async function pollGitHubDeviceLogin(params: {
  deviceCode: string;
  enterpriseUrl?: string;
  clientId?: string;
}): Promise<{
  status: 'pending' | 'slow_down' | 'complete';
  interval?: number;
  copilot?: CopilotPublicStatus;
}> {
  const state = loadCopilotState();
  const enterpriseUrl = state.github.enterpriseUrl || 'https://github.com';
  const clientId = (
    params.clientId?.trim() ||
    state.github.clientId ||
    process.env.GITHUB_COPILOT_CLIENT_ID?.trim() ||
    DEFAULT_GITHUB_COPILOT_PUBLIC_CLIENT_ID
  ).trim();
  if (!clientId || !params.deviceCode) {
    throw new Error('Parametri Device Flow mancanti.');
  }

  const res = await fetch(`${enterpriseUrl}/login/oauth/access_token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      device_code: params.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }).toString(),
  });

  const json = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
    interval?: number;
  };

  if (json.error === 'authorization_pending') {
    return { status: 'pending' };
  }
  if (json.error === 'slow_down') {
    return { status: 'slow_down', interval: json.interval };
  }
  if (json.error) {
    throw new Error(json.error_description || json.error);
  }
  if (!json.access_token) {
    throw new Error('Token GitHub non ricevuto.');
  }

  await finalizeGitHubLogin(json.access_token, enterpriseUrl);
  return {
    status: 'complete',
    copilot: getPublicCopilotStatus(),
  };
}

export async function buildGitHubAuthUrl(params: {
  enterpriseUrl?: string;
  clientId?: string;
  clientOrigin?: string;
}): Promise<{ url: string; redirectUri: string }> {
  cleanupExpiredOAuthStates();
  const state = loadCopilotState();
  const rawEnt = (params.enterpriseUrl?.trim() || state.github.enterpriseUrl || 'https://github.com').trim();
  const parsed = await validateOutboundUrl(rawEnt);
  if (parsed.protocol !== 'https:') {
    throw new Error('Il dominio GitHub / Enterprise deve usare HTTPS.');
  }
  const enterpriseUrl = `${parsed.protocol}//${parsed.host}`;

  const clientId = (
    params.clientId?.trim() ||
    state.github.clientId ||
    process.env.GITHUB_COPILOT_CLIENT_ID?.trim() ||
    ''
  ).trim();
  if (!clientId) {
    throw new Error(
      'Inserisci il Client ID della GitHub OAuth App (o imposta GITHUB_COPILOT_CLIENT_ID).',
    );
  }

  state.github.enterpriseUrl = enterpriseUrl;
  if (params.clientId?.trim()) {
    state.github.clientId = params.clientId.trim();
  }
  state.mode = 'github';
  saveCopilotState(state);

  const baseUrl = resolveAppBaseUrl(params.clientOrigin);
  const redirectUri = `${baseUrl}/api/copilot/github/callback`;
  const oauthState = crypto.randomBytes(24).toString('base64url');

  pendingOAuthStates.set(oauthState, {
    mode: 'github',
    clientId,
    enterpriseUrl,
    redirectUri,
    createdAt: Date.now(),
  });

  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'read:user user:email',
    state: oauthState,
  });

  return {
    url: `${enterpriseUrl}/login/oauth/authorize?${query.toString()}`,
    redirectUri,
  };
}

export async function completeGitHubOAuthCallback(params: {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}): Promise<void> {
  cleanupExpiredOAuthStates();
  if (params.error) {
    throw new Error(params.errorDescription || params.error);
  }
  if (!params.code || !params.state) {
    throw new Error('Parametri OAuth GitHub mancanti.');
  }

  const tx = pendingOAuthStates.get(params.state);
  if (!tx || tx.mode !== 'github') {
    throw new Error('Sessione OAuth GitHub scaduta o non valida.');
  }
  pendingOAuthStates.delete(params.state);

  const clientSecret = process.env.GITHUB_COPILOT_CLIENT_SECRET?.trim();
  if (!clientSecret) {
    throw new Error(
      'Per il login Popup OAuth GitHub serve GITHUB_COPILOT_CLIENT_SECRET sul server. In alternativa usa il login Device Code (senza secret).',
    );
  }

  const enterpriseUrl = tx.enterpriseUrl || 'https://github.com';
  const res = await fetch(`${enterpriseUrl}/login/oauth/access_token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: tx.clientId,
      client_secret: clientSecret,
      code: params.code,
      redirect_uri: tx.redirectUri,
    }).toString(),
  });
  const json = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || 'Errore scambio token GitHub.');
  }

  await finalizeGitHubLogin(json.access_token, enterpriseUrl);
}

async function ensureFreshGitHubCopilotSession(): Promise<{
  sessionToken: string;
  apiEndpoint: string;
}> {
  const tokens = getCopilotTokens('github');
  if (!tokens?.accessToken) {
    throw new Error('Account aziendale GitHub Copilot non connesso.');
  }
  const state = loadCopilotState();
  const enterpriseUrl = state.github.enterpriseUrl || 'https://github.com';

  if (
    tokens.sessionToken &&
    tokens.apiEndpoint &&
    (!tokens.sessionExpiresAt || Date.parse(tokens.sessionExpiresAt) > Date.now() + 60_000)
  ) {
    return {
      sessionToken: tokens.sessionToken,
      apiEndpoint: tokens.apiEndpoint,
    };
  }

  const session = await exchangeGitHubForCopilotSession(tokens.accessToken, enterpriseUrl);
  saveCopilotTokens('github', {
    ...tokens,
    sessionToken: session.token,
    sessionExpiresAt: session.expiresAt,
    apiEndpoint: session.apiEndpoint,
  });
  return {
    sessionToken: session.token,
    apiEndpoint: session.apiEndpoint,
  };
}

async function fetchGitHubCopilotModelsInternal(
  sessionToken: string,
  apiEndpoint: string,
): Promise<CopilotModelInfo[]> {
  try {
    const res = await fetch(`${apiEndpoint}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        ...COPILOT_HEADERS,
      },
    });
    if (!res.ok) {
      return defaultCopilotModels();
    }
    const json = (await res.json()) as {
      data?: Array<{
        id?: string;
        name?: string;
        vendor?: string;
        model_picker_enabled?: boolean;
        capabilities?: {
          type?: string;
          supports?: { vision?: boolean; tool_calls?: boolean };
        };
      }>;
    };
    const rows = Array.isArray(json.data) ? json.data : [];
    const parsed = rows
      .filter((r) => Boolean(r.id) && r.capabilities?.type !== 'embeddings' && r.model_picker_enabled !== false)
      .map((r) => {
        const caps: string[] = ['text'];
        if (r.capabilities?.supports?.vision) caps.push('multimodal');
        if (r.capabilities?.supports?.tool_calls) caps.push('coding');
        return {
          id: r.id!,
          name: r.name || r.id!,
          vendor: r.vendor,
          capabilities: caps,
          pricingTier: 'free_tier' as const,
        };
      });
    return parsed.length > 0 ? parsed : defaultCopilotModels();
  } catch {
    return defaultCopilotModels();
  }
}

function defaultCopilotModels(): CopilotModelInfo[] {
  return [
    { id: 'gpt-4o', name: 'GPT-4o (Copilot)', vendor: 'OpenAI', pricingTier: 'free_tier' },
    { id: 'gpt-4.1', name: 'GPT-4.1 (Copilot)', vendor: 'OpenAI', pricingTier: 'free_tier' },
    { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet (Copilot)', vendor: 'Anthropic', pricingTier: 'free_tier' },
    { id: 'o3-mini', name: 'o3-mini (Copilot)', vendor: 'OpenAI', pricingTier: 'free_tier' },
  ];
}

export async function refreshGitHubCopilotModels(): Promise<CopilotPublicStatus> {
  const { sessionToken, apiEndpoint } = await ensureFreshGitHubCopilotSession();
  const models = await fetchGitHubCopilotModelsInternal(sessionToken, apiEndpoint);
  const state = loadCopilotState();
  state.github.models = models;
  if (models.length > 0 && !models.some((m) => m.id === state.github.selectedModelId)) {
    state.github.selectedModelId = models[0].id;
  }
  saveCopilotState(state);
  return getPublicCopilotStatus();
}

export async function refreshCopilotLicenseStatus(
  mode?: CopilotMode,
): Promise<CopilotPublicStatus> {
  const state = loadCopilotState();
  const target = mode ?? state.mode;

  if (target === 'm365') {
    const accessToken = await ensureFreshM365Token();
    state.m365.license = await inspectM365Licenses(accessToken);
    saveCopilotState(state);
    return getPublicCopilotStatus();
  }

  const tokens = getCopilotTokens('github');
  if (!tokens?.accessToken) {
    throw new Error('Account GitHub Copilot non connesso.');
  }
  const enterpriseUrl = state.github.enterpriseUrl || 'https://github.com';
  const session = await exchangeGitHubForCopilotSession(tokens.accessToken, enterpriseUrl);
  saveCopilotTokens('github', {
    ...tokens,
    sessionToken: session.token,
    sessionExpiresAt: session.expiresAt,
    apiEndpoint: session.apiEndpoint,
  });
  state.github.license = buildGitHubLicenseStatus(session);
  saveCopilotState(state);
  return getPublicCopilotStatus();
}

export function isCoworkLicensed(mode?: CopilotMode): boolean {
  const state = loadCopilotState();
  const target = mode ?? state.mode;
  return target === 'm365'
    ? Boolean(state.m365.license?.coworkEnabled)
    : Boolean(state.github.license?.coworkEnabled);
}

// ---------- UNIFIED COPILOT PRO + COWORK STREAMING CHAT ----------

const COWORK_SYSTEM_DIRECTIVE = `
[MODALITA' COPILOT COWORK ATTIVA]
Stai operando in modalità **Copilot Cowork** (orchestrazione operativa multi-step su lavoro aziendale e cartella locale).
1. Scomponi le attività complesse in un breve **Piano operativo Cowork** a step numerati (Analisi -> Raccolta/Verifica -> Esecuzione -> Sintesi).
2. Quando l'utente ha collegato una cartella locale sul PC, coordina attivamente la lettura multi-file (con blocchi \`aihub-read\`) e proponi modifiche o nuovi file completi (con blocchi \`aihub-write\`) chiedendo sempre l'autorizzazione tramite le schede interattive.
3. Fornisci deliverable pronti per il lavoro (report strutturati, email/bozze operative, refactoring coordinati tra più file, checklist con milestone e rischi).`.trim();

export async function streamCopilotChat(params: {
  mode?: CopilotMode;
  sessionMode?: CopilotSessionMode;
  modelId?: string;
  systemPrompt?: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    attachments?: ChatAttachment[];
  }>;
  onDelta: (delta: string) => void;
  signal?: AbortSignal;
}): Promise<{ text: string; modelId: string; latencyMs: number }> {
  const state = loadCopilotState();
  const mode = params.mode ?? state.mode;
  const sessionMode: CopilotSessionMode = params.sessionMode === 'cowork' ? 'cowork' : 'chat';
  const start = Date.now();

  if (sessionMode === 'cowork' && !isCoworkLicensed(mode)) {
    throw new Error(
      'La modalità Cowork non è abilitata dalla licenza dell’utenza attualmente connessa.',
    );
  }

  const effectiveSystemPrompt =
    sessionMode === 'cowork'
      ? [COWORK_SYSTEM_DIRECTIVE, params.systemPrompt?.trim() || ''].filter(Boolean).join('\n\n')
      : params.systemPrompt;

  if (mode === 'm365') {
    const accessToken = await ensureFreshM365Token();
    const convRes = await fetch('https://graph.microsoft.com/beta/copilot/conversations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
      signal: params.signal,
    });

    if (!convRes.ok) {
      const errBody = await convRes.text();
      const usingDefaultPublicClient =
        !state.m365.clientId?.trim() && !process.env.M365_COPILOT_CLIENT_ID?.trim();
      const customAppHint =
        convRes.status === 403 && usingDefaultPublicClient
          ? ' Se il tenant aziendale blocca il client pubblico Microsoft predefinito per le API Copilot Chat, apri "Configurazione tecnica (opzionale)" e inserisci un Client ID Entra ID autorizzato dall’amministratore IT.'
          : '';
      throw new Error(
        `Microsoft 365 Copilot ha rifiutato la sessione (HTTP ${convRes.status}). Verifica che il tuo account aziendale abbia una licenza Microsoft 365 Copilot attiva e i permessi approvati.${customAppHint} Dettaglio: ${errBody.slice(0, 200)}`,
      );
    }

    const convJson = (await convRes.json()) as { id?: string };
    if (!convJson.id) {
      throw new Error('ID conversazione Microsoft 365 Copilot mancante.');
    }

    const recentHistory = params.messages.slice(-8);
    const historyTranscript =
      recentHistory.length > 1
        ? recentHistory
            .slice(0, -1)
            .map((m) => `${m.role === 'user' ? 'Utente' : 'Copilot'}: ${m.content}`)
            .join('\n\n')
        : '';
    const latestUserText = recentHistory[recentHistory.length - 1]?.content || '';

    const composedPrompt = [
      effectiveSystemPrompt ? `[ISTRUZIONI DI SISTEMA]\n${effectiveSystemPrompt}` : '',
      historyTranscript ? `[CRONOLOGIA RECENTE]\n${historyTranscript}` : '',
      `[RICHIESTA ATTUALE]\n${latestUserText}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const requestBody = {
      message: { text: composedPrompt },
      locationHint: { timeZone: 'Europe/Rome' },
      ...(sessionMode === 'cowork'
        ? {
            contextualResources: {
              webContext: { isWebEnabled: true },
            },
          }
        : {}),
    };

    const convId = encodeURIComponent(convJson.id);
    const streamRes = await fetch(
      `https://graph.microsoft.com/beta/copilot/conversations/${convId}/chatOverStream`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(requestBody),
        signal: params.signal,
      },
    );

    if (streamRes.ok && streamRes.body) {
      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastFullText = '';

      const processStreamBlock = (block: string) => {
        for (const rawLine of block.split('\n')) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr || dataStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(dataStr) as {
              messages?: Array<{ text?: string; author?: { role?: string } }>;
              text?: string;
            };
            const assistantMessages = Array.isArray(parsed.messages) ? parsed.messages : [];
            const lastAssistant =
              [...assistantMessages].reverse().find((m) => m.author?.role !== 'user' && m.text) ??
              assistantMessages[assistantMessages.length - 1];
            const nextText = lastAssistant?.text || parsed.text || '';
            if (nextText && nextText.length > lastFullText.length) {
              const delta = nextText.startsWith(lastFullText)
                ? nextText.slice(lastFullText.length)
                : nextText;
              lastFullText = nextText;
              if (delta) params.onDelta(delta);
            }
          } catch {
            // ignore keepalive chunks
          }
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        for (const block of blocks) processStreamBlock(block);
      }
      buffer += decoder.decode().replace(/\r\n/g, '\n');
      if (buffer.trim()) {
        for (const block of buffer.split('\n\n')) processStreamBlock(block);
      }

      if (lastFullText) {
        return {
          text: lastFullText,
          modelId: sessionMode === 'cowork' ? 'microsoft-365-cowork' : 'microsoft-365-copilot',
          latencyMs: Date.now() - start,
        };
      }
    }

    // Fallback to synchronous /chat if chatOverStream isn't supported on tenant
    const chatRes = await fetch(
      `https://graph.microsoft.com/beta/copilot/conversations/${convId}/chat`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: params.signal,
      },
    );

    if (!chatRes.ok) {
      const errBody = await chatRes.text();
      throw new Error(`Errore Microsoft 365 Copilot (HTTP ${chatRes.status}): ${errBody.slice(0, 240)}`);
    }

    const chatJson = (await chatRes.json()) as {
      messages?: Array<{ text?: string; author?: { role?: string } }>;
      text?: string;
    };
    const assistantMessages = Array.isArray(chatJson.messages) ? chatJson.messages : [];
    const lastAssistant =
      [...assistantMessages].reverse().find((m) => m.author?.role !== 'user' && m.text) ??
      assistantMessages[assistantMessages.length - 1];
    const replyText = lastAssistant?.text || chatJson.text || '';
    if (replyText) {
      params.onDelta(replyText);
    }

    return {
      text: replyText,
      modelId: sessionMode === 'cowork' ? 'microsoft-365-cowork' : 'microsoft-365-copilot',
      latencyMs: Date.now() - start,
    };
  }

  // GitHub Copilot Pro / Business / Enterprise streaming chat
  const { sessionToken, apiEndpoint } = await ensureFreshGitHubCopilotSession();
  const chosenModel = params.modelId?.trim() || state.github.selectedModelId || 'gpt-4o';

  const payloadMessages: Array<Record<string, unknown>> = [];
  if (effectiveSystemPrompt?.trim()) {
    payloadMessages.push({ role: 'system', content: effectiveSystemPrompt.trim() });
  }
  for (const m of params.messages) {
    if (m.role === 'system') continue;
    if (m.attachments && m.attachments.length > 0 && m.role === 'user') {
      const parts: Array<Record<string, unknown>> = [];
      if (m.content) parts.push({ type: 'text', text: m.content });
      for (const att of m.attachments) {
        if (att.mimeType.startsWith('image/')) {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${att.mimeType};base64,${att.dataBase64}` },
          });
        }
      }
      payloadMessages.push({ role: m.role, content: parts });
    } else {
      payloadMessages.push({ role: m.role, content: m.content });
    }
  }

  const res = await fetch(`${apiEndpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      'Content-Type': 'application/json',
      ...COPILOT_HEADERS,
    },
    body: JSON.stringify({
      model: chosenModel,
      messages: payloadMessages,
      stream: true,
    }),
    signal: params.signal,
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Errore GitHub Copilot (HTTP ${res.status}): ${errBody.slice(0, 240)}`);
  }
  if (!res.body) {
    throw new Error('Risposta stream vuota da GitHub Copilot.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  const processLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return;
    const dataStr = line.slice(5).trim();
    if (dataStr === '[DONE]') return;
    try {
      const parsed = JSON.parse(dataStr) as {
        choices?: Array<{ delta?: { content?: string } }>;
      };
      const delta = parsed.choices?.[0]?.delta?.content ?? '';
      if (delta) {
        fullText += delta;
        params.onDelta(delta);
      }
    } catch {
      // Ignore keepalive chunks
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      processLine(line);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    for (const line of buffer.split('\n')) {
      processLine(line);
    }
  }

  return {
    text: fullText,
    modelId: chosenModel,
    latencyMs: Date.now() - start,
  };
}
