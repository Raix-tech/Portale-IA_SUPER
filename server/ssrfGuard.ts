import dns from 'node:dns/promises';
import net from 'node:net';

function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // link-local & cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isPrivateOrReservedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // ULA
  if (normalized.startsWith('fe80:')) return true; // link-local
  if (normalized.startsWith('::ffff:')) {
    const v4 = normalized.slice(7);
    if (net.isIPv4(v4)) return isPrivateOrReservedIPv4(v4);
  }
  return false;
}

export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateOrReservedIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateOrReservedIPv6(ip);
  return true;
}

export async function validateOutboundUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('URL non valido. Inserisci un URL completo (es. https://api.example.com/v1).');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Protocollo non consentito. Usa solo https:// o http://.');
  }

  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === 'metadata.google.internal' ||
    host === 'metadata'
  ) {
    throw new Error('Host non consentito per motivi di sicurezza (indirizzi locali o metadata bloccati).');
  }

  if (net.isIP(host)) {
    if (isBlockedIp(host)) {
      throw new Error('Indirizzo IP privato, loopback o link-local non consentito.');
    }
    return parsed;
  }

  try {
    const records = await dns.lookup(host, { all: true });
    if (records.length === 0) {
      throw new Error(`Impossibile risolvere il dominio "${host}".`);
    }
    for (const rec of records) {
      if (isBlockedIp(rec.address)) {
        throw new Error('Il dominio selezionato punta a un indirizzo di rete privato o non consentito.');
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('non consentito')) {
      throw err;
    }
    throw new Error(`Impossibile verificare la risoluzione DNS per "${host}".`);
  }

  return parsed;
}
