import { getProviderSecrets } from '../vault.ts';
import type { StoredProviderMeta } from '../store.ts';
import { GeminiAdapter } from './geminiAdapter.ts';
import { OpenAICompatibleAdapter } from './openaiCompatible.ts';
import type { AdapterContext, ProviderAdapter } from './types.ts';

const geminiAdapter = new GeminiAdapter();
const adapterCache = new Map<string, ProviderAdapter>();

export function getAdapterForProvider(providerId: string): ProviderAdapter {
  if (providerId === 'gemini') {
    return geminiAdapter;
  }
  let adapter = adapterCache.get(providerId);
  if (!adapter) {
    adapter = new OpenAICompatibleAdapter(providerId);
    adapterCache.set(providerId, adapter);
  }
  return adapter;
}

export function buildAdapterContext(meta: StoredProviderMeta): AdapterContext {
  const secrets = getProviderSecrets(meta.id);
  return {
    meta,
    apiKey: secrets.apiKey,
    customHeaders: secrets.customHeaders,
  };
}
