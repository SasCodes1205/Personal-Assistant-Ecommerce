import { ConfidentialClientApplication } from '@azure/msal-node';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

/**
 * Microsoft Graph application (app-only) authentication.
 *
 * Uses the OAuth2 client-credentials flow: the app authenticates as ITSELF
 * (not a signed-in user) using the Entra app registration's client secret.
 * This is the recommended model for a 24/7 single-mailbox background service.
 *
 * SECURITY: app-only Graph permissions are tenant-wide by default. You MUST
 * scope mail access to the CEO mailbox only via an Exchange application access
 * policy (see IMPLEMENTATION_GUIDE Stage 2). Likewise, Teams transcript access
 * is scoped via a Teams application access policy.
 */

const msalConfig = {
  auth: {
    clientId: env.AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}`,
    clientSecret: env.AZURE_CLIENT_SECRET,
  },
};

const cca = new ConfidentialClientApplication(msalConfig);

// Simple in-memory token cache. MSAL also caches internally, but we keep a
// small guard so we don't call acquireToken on every single Graph request.
let cached: { token: string; expiresAt: number } | null = null;

/** Get a valid Graph access token (app-only). Refreshes ~2 min before expiry. */
export async function getGraphToken(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAt - 120_000 > now) {
    return cached.token;
  }

  const result = await cca.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });

  if (!result?.accessToken) {
    throw new Error('Failed to acquire Microsoft Graph token');
  }

  cached = {
    token: result.accessToken,
    // result.expiresOn is a Date; fall back to 50 min if absent.
    expiresAt: result.expiresOn ? result.expiresOn.getTime() : now + 50 * 60_000,
  };
  return cached.token;
}

/**
 * Thin Graph REST helper. Uses the global fetch (Node 18+). Returns parsed
 * JSON, or the raw Response for non-JSON (e.g. transcript VTT content).
 */
export async function graphFetch(
  path: string,
  init: RequestInit & { raw?: boolean } = {}
): Promise<any> {
  const token = await getGraphToken();
  const url = path.startsWith('http')
    ? path
    : `https://graph.microsoft.com/v1.0${path}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.error({ status: res.status, path, body: text.slice(0, 500) }, 'graph.error');
    throw new Error(`Graph ${res.status} on ${path}: ${text.slice(0, 300)}`);
  }

  if (init.raw) return res;
  if (res.status === 204) return null;
  return res.json();
}
