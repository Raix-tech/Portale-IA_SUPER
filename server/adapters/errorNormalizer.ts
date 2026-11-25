import type { AIErrorCode, NormalizedAIError } from '../../src/types/ai.ts';

function extractBodyMessage(rawBody?: string): string {
  if (!rawBody) return '';
  try {
    const parsed = JSON.parse(rawBody) as {
      error?: { message?: string; type?: string; code?: string | number } | string;
      message?: string;
      detail?: string;
      errors?: Array<{ message?: string }>;
    };
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.error && typeof parsed.error === 'object' && parsed.error.message) {
      return parsed.error.message;
    }
    if (parsed.message) return parsed.message;
    if (parsed.detail) return parsed.detail;
    if (Array.isArray(parsed.errors) && parsed.errors[0]?.message) {
      return parsed.errors[0].message;
    }
  } catch {
    // Plain text body
  }
  return rawBody.slice(0, 280).trim();
}

export function normalizeProviderError(
  providerId: string,
  providerName: string,
  error: unknown,
  httpStatus?: number,
  responseBody?: string,
): NormalizedAIError {
  const errObj = error instanceof Error ? error : undefined;
  const rawMessage = errObj?.message ?? (typeof error === 'string' ? error : '');
  const bodyMessage = extractBodyMessage(responseBody);
  const combined = `${rawMessage} ${bodyMessage}`.toLowerCase();

  // Abort / Timeout
  if (
    errObj?.name === 'AbortError' ||
    combined.includes('timeout') ||
    combined.includes('timed out') ||
    combined.includes('aborted')
  ) {
    return {
      code: 'TIMEOUT',
      httpStatus: 408,
      message: `${providerName} non ha risposto entro il tempo limite (timeout).`,
      detail: bodyMessage || rawMessage || undefined,
      retryable: true,
      allowFallback: true,
      providerId,
    };
  }

  // Missing API key
  if (combined.includes('missing_api_key') || combined.includes('api key mancante')) {
    return {
      code: 'MISSING_API_KEY',
      message: `API key mancante per ${providerName}. Configurala nella sezione Providers.`,
      retryable: false,
      allowFallback: false,
      providerId,
    };
  }

  // Safety / Policy refusal (never fallback automatically)
  if (
    combined.includes('safety') ||
    combined.includes('content_filter') ||
    combined.includes('content policy') ||
    combined.includes('prohibited') ||
    combined.includes('blocked') ||
    combined.includes('moderation')
  ) {
    return {
      code: 'SAFETY_REFUSAL',
      httpStatus,
      message: `La richiesta è stata rifiutata dai filtri di sicurezza di ${providerName}.`,
      detail: bodyMessage || rawMessage || undefined,
      retryable: false,
      allowFallback: false,
      providerId,
    };
  }

  // Network errors
  if (
    combined.includes('econnrefused') ||
    combined.includes('enotfound') ||
    combined.includes('eai_again') ||
    combined.includes('econnreset') ||
    combined.includes('fetch failed') ||
    combined.includes('network')
  ) {
    return {
      code: 'NETWORK_ERROR',
      message: `Impossibile raggiungere ${providerName}: errore di rete o connessione assente.`,
      detail: bodyMessage || rawMessage || undefined,
      retryable: true,
      allowFallback: true,
      providerId,
    };
  }

  // HTTP 401 or Invalid API key
  if (
    httpStatus === 401 ||
    combined.includes('invalid_api_key') ||
    combined.includes('api_key_invalid') ||
    combined.includes('api key not valid') ||
    combined.includes('incorrect api key') ||
    combined.includes('unauthorized') ||
    combined.includes('invalid token')
  ) {
    const code: AIErrorCode =
      combined.includes('key') || combined.includes('token') ? 'INVALID_API_KEY' : 'HTTP_401';
    return {
      code,
      httpStatus: httpStatus ?? 401,
      message: `API key o token non valido per ${providerName}. Verifica le credenziali nella pagina Providers.`,
      detail: bodyMessage || rawMessage || undefined,
      retryable: false,
      allowFallback: false,
      providerId,
    };
  }

  // HTTP 403 Forbidden
  if (httpStatus === 403 || combined.includes('permission_denied') || combined.includes('forbidden')) {
    return {
      code: 'HTTP_403',
      httpStatus: 403,
      message: `Accesso negato da ${providerName} (permessi insufficienti o chiave non abilitata per questa risorsa).`,
      detail: bodyMessage || rawMessage || undefined,
      retryable: false,
      allowFallback: false,
      providerId,
    };
  }

  // HTTP 404 or Model unavailable
  if (
    httpStatus === 404 ||
    combined.includes('model_not_found') ||
    combined.includes('does not exist') ||
    combined.includes('not found') ||
    combined.includes('model unavailable') ||
    combined.includes('no endpoints found')
  ) {
    const isModel =
      combined.includes('model') || combined.includes('endpoint') || combined.includes('deployment');
    return {
      code: isModel ? 'MODEL_UNAVAILABLE' : 'HTTP_404',
      httpStatus: 404,
      message: isModel
        ? `Il modello selezionato su ${providerName} non è disponibile o è stato rimosso.`
        : `Endpoint o risorsa non trovata su ${providerName} (HTTP 404).`,
      detail: bodyMessage || rawMessage || undefined,
      retryable: false,
      allowFallback: true,
      providerId,
    };
  }

  // HTTP 429 Rate Limit vs Quota Exhausted
  if (
    httpStatus === 429 ||
    combined.includes('rate limit') ||
    combined.includes('rate_limit') ||
    combined.includes('too many requests') ||
    combined.includes('resource_exhausted') ||
    combined.includes('quota') ||
    combined.includes('insufficient_quota') ||
    combined.includes('credit') ||
    combined.includes('exceeded')
  ) {
    const isQuota =
      combined.includes('quota') ||
      combined.includes('insufficient_quota') ||
      combined.includes('billing') ||
      combined.includes('credit') ||
      combined.includes('balance');
    return {
      code: isQuota ? 'QUOTA_EXHAUSTED' : 'HTTP_429',
      httpStatus: 429,
      message: isQuota
        ? `Quota o crediti esauriti su ${providerName}.`
        : `Limite di richieste raggiunto (rate limit) su ${providerName}. Riprova tra poco o usa un altro provider.`,
      detail: bodyMessage || rawMessage || undefined,
      retryable: !isQuota,
      allowFallback: true,
      providerId,
    };
  }

  // HTTP 5xx Server error
  if (httpStatus !== undefined && httpStatus >= 500) {
    return {
      code: 'HTTP_5XX',
      httpStatus,
      message: `Errore temporaneo del server di ${providerName} (HTTP ${httpStatus}).`,
      detail: bodyMessage || rawMessage || undefined,
      retryable: true,
      allowFallback: true,
      providerId,
    };
  }

  // HTTP 400 Bad request (do not blindly fallback on malformed request, except if provider reports model issue)
  if (httpStatus === 400 || httpStatus === 422) {
    const isModelUnavailable =
      combined.includes('model') &&
      (combined.includes('not supported') || combined.includes('deprecated') || combined.includes('unavailable'));
    return {
      code: isModelUnavailable ? 'MODEL_UNAVAILABLE' : 'BAD_REQUEST',
      httpStatus,
      message: isModelUnavailable
        ? `Il modello non supporta questa richiesta su ${providerName}.`
        : `Richiesta non valida rifiutata da ${providerName}.`,
      detail: bodyMessage || rawMessage || undefined,
      retryable: false,
      allowFallback: isModelUnavailable,
      providerId,
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    httpStatus,
    message: bodyMessage || rawMessage || `Errore imprevisto durante la comunicazione con ${providerName}.`,
    detail: bodyMessage && rawMessage && bodyMessage !== rawMessage ? rawMessage : undefined,
    retryable: false,
    allowFallback: true,
    providerId,
  };
}
