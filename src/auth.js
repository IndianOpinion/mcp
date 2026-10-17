// The one place a request's credentials are read. Three answers: no
// credential (public tools only), an `ioa_` bearer token, which the Worker
// never validates itself (it forwards the token to the REST agent API, the only
// judge of whether it is live), and, since phase 2, an OAuth access token
// (`iot_...`) issued by src/oauth.js. An OAuth token resolves to the ioa_ token
// it was minted for, so tool code sees the same { kind: 'bearer' } either way.

import { lookupAccessToken, challenge } from './oauth.js';

const IOA = /^ioa_([A-Za-z0-9]{6,64})_([A-Za-z0-9_-]{8,256})$/;
const IOT = /^iot_[A-Za-z0-9_-]{30,80}$/;

/**
 * resolveAuth(request, env) -> one of
 *   { kind: 'none' }
 *   { kind: 'bearer', token, tokenId, scopes, via }   token is the raw ioa_ string; via 'token' or 'oauth'
 *   { kind: 'invalid', reason }                       a credential was sent but is not usable
 * Never log `token`. `tokenId` is the public half and is safe to log.
 */
export async function resolveAuth(request, env = {}) {
  const h = request.headers.get('Authorization');
  if (!h || !h.trim()) return { kind: 'none' };
  const m = h.trim().match(/^Bearer\s+(.+)$/i);
  if (!m) return { kind: 'invalid', reason: 'Authorization must be "Bearer ioa_..." or an OAuth access token.' };
  const token = m[1].trim();
  if (IOT.test(token)) {
    const rec = await lookupAccessToken(env, token);
    if (!rec) return { kind: 'invalid', reason: 'That OAuth access token is unknown, revoked or expired. Refresh it or connect again.' };
    return { kind: 'bearer', token: rec.ioa, tokenId: rec.token_id, scopes: String(rec.scope || '').split(' ').filter(Boolean), via: 'oauth' };
  }
  const t = token.match(IOA);
  if (!t) return { kind: 'invalid', reason: 'That is not an Indian Opinion agent token (they start with ioa_).' };
  // Scopes are enforced by the REST API; phase 1 tokens carry the defaults.
  return { kind: 'bearer', token, tokenId: t[1], scopes: ['news:read', 'account:read', 'account:write'], via: 'token' };
}

/** 401 for a credential that is not usable. With an origin it carries the RFC 9728 resource_metadata. */
export function invalidTokenResponse(reason, cors, origin, mcpPath = '/mcp') {
  return new Response(JSON.stringify({
    jsonrpc: '2.0', id: null,
    error: { code: -32001, message: `${reason} Remove the header to use the public tools, or sign up at https://indianopinion.org/agents/.` },
  }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': origin ? challenge(origin, mcpPath, 'invalid_token') : 'Bearer realm="indianopinion.org", error="invalid_token"',
      'Cache-Control': 'no-store',
      ...cors,
    },
  });
}

/** 401 for no credential on the OAuth endpoint: the challenge that starts a connector's OAuth flow. */
export function authRequiredResponse(cors, origin, mcpPath) {
  return new Response(JSON.stringify({
    jsonrpc: '2.0', id: null,
    error: { code: -32001, message: 'Sign in to use this endpoint (OAuth). For the public tools without an account use /mcp.' },
  }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': challenge(origin, mcpPath), 'Cache-Control': 'no-store', ...cors },
  });
}
