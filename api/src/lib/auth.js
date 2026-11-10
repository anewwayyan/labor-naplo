'use strict';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class UnauthorizedError extends Error {
  constructor(reason = 'TOKEN_REJECTED') {
    super('Unauthorized');
    this.code = 'UNAUTHORIZED';
    // A short, non-sensitive diagnostic code. Never include token contents or claim values.
    this.reason = reason;
  }
}

class AuthConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.code = 'AUTH_CONFIGURATION_ERROR';
  }
}

let validationContextPromise;

function readConfiguration() {
  const tenantSubdomain = (process.env.ENTRA_TENANT_SUBDOMAIN || '').trim().toLowerCase();
  const tenantId = (process.env.ENTRA_TENANT_ID || '').trim();
  const apiClientId = (process.env.ENTRA_API_CLIENT_ID || '').trim();
  const spaClientId = (process.env.ENTRA_SPA_CLIENT_ID || '').trim();
  const requiredScope = (process.env.ENTRA_API_SCOPE || 'access_as_user').trim();

  if (!/^[a-z0-9-]+$/.test(tenantSubdomain)) {
    throw new AuthConfigurationError('ENTRA_TENANT_SUBDOMAIN is missing or invalid.');
  }
  if (!GUID_RE.test(tenantId)) {
    throw new AuthConfigurationError('ENTRA_TENANT_ID is missing or invalid.');
  }
  if (!GUID_RE.test(apiClientId)) {
    throw new AuthConfigurationError('ENTRA_API_CLIENT_ID is missing or invalid.');
  }
  if (!GUID_RE.test(spaClientId)) {
    throw new AuthConfigurationError('ENTRA_SPA_CLIENT_ID is missing or invalid.');
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(requiredScope)) {
    throw new AuthConfigurationError('ENTRA_API_SCOPE is invalid.');
  }

  return {
    tenantSubdomain,
    tenantId: tenantId.toLowerCase(),
    apiClientId: apiClientId.toLowerCase(),
    spaClientId: spaClientId.toLowerCase(),
    requiredScope
  };
}

async function getValidationContext() {
  if (!validationContextPromise) {
    validationContextPromise = (async () => {
      const config = readConfiguration();
      const tenantHost = `${config.tenantSubdomain}.ciamlogin.com`;
      const tenantIdHost = `${config.tenantId}.ciamlogin.com`;
      const trustedCiamHosts = new Set([tenantHost, tenantIdHost]);
      const metadataUrl = `https://${tenantHost}/${config.tenantId}/v2.0/.well-known/openid-configuration`;

      let metadataResponse;
      try {
        metadataResponse = await fetch(metadataUrl, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(10000)
        });
      } catch {
        throw new AuthConfigurationError('Could not download the External ID OpenID configuration.');
      }

      if (!metadataResponse.ok) {
        throw new AuthConfigurationError(`External ID metadata returned HTTP ${metadataResponse.status}.`);
      }

      let metadata;
      try {
        metadata = await metadataResponse.json();
      } catch {
        throw new AuthConfigurationError('External ID metadata was not valid JSON.');
      }

      if (typeof metadata.issuer !== 'string' || typeof metadata.jwks_uri !== 'string') {
        throw new AuthConfigurationError('The External ID metadata is missing issuer or jwks_uri.');
      }

      // External ID documentation has described the issuer host in both
      // tenant-subdomain and tenant-ID forms. The tenant-specific discovery
      // document is the source of truth: validate its structure and then use
      // its exact issuer value for JWT validation (including any trailing slash).
      let issuerUrl;
      let jwksUrl;
      try {
        issuerUrl = new URL(metadata.issuer);
        jwksUrl = new URL(metadata.jwks_uri);
      } catch {
        throw new AuthConfigurationError('The External ID metadata contains an invalid issuer or jwks_uri URL.');
      }

      const expectedIssuerPath = `/${config.tenantId}/v2.0`;
      if (
        issuerUrl.protocol !== 'https:' ||
        !trustedCiamHosts.has(issuerUrl.hostname) ||
        issuerUrl.pathname.replace(/\/+$/, '') !== expectedIssuerPath ||
        issuerUrl.search || issuerUrl.hash
      ) {
        throw new AuthConfigurationError('The External ID metadata issuer does not match the configured tenant.');
      }
      if (
        jwksUrl.protocol !== 'https:' ||
        !trustedCiamHosts.has(jwksUrl.hostname) ||
        jwksUrl.username || jwksUrl.password || jwksUrl.search || jwksUrl.hash
      ) {
        throw new AuthConfigurationError('The External ID signing-key URL is not trusted.');
      }

      // jose downloads and caches Microsoft's public signing keys, and refreshes
      // them when Microsoft rotates keys. No signing key is hard-coded here.
      const { createRemoteJWKSet } = await import('jose');
      const jwks = createRemoteJWKSet(jwksUrl);

      return { ...config, issuer: metadata.issuer, jwks };
    })().catch((error) => {
      // Allow a later invocation to retry after a transient metadata failure.
      validationContextPromise = undefined;
      throw error;
    });
  }

  return validationContextPromise;
}

function getBearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  if (!match) throw new UnauthorizedError('MISSING_BEARER_TOKEN');
  return match[1];
}

async function authenticateRequest(request) {
  const token = getBearerToken(request);
  const context = await getValidationContext();

  let payload;
  try {
    const { jwtVerify } = await import('jose');
    ({ payload } = await jwtVerify(token, context.jwks, {
      algorithms: ['RS256'],
      issuer: context.issuer,
      audience: context.apiClientId,
      clockTolerance: 5
    }));
  } catch (error) {
    // Only expose a coarse diagnostic category when AUTH_DIAGNOSTICS is enabled.
    // Do not log or return the bearer token, raw claims, or personal identifiers.
    const code = String(error?.code || error?.name || 'UNKNOWN');
    let reason = 'JWT_VERIFICATION_FAILED';
    if (code.includes('JWKS_NO_MATCHING_KEY')) reason = 'SIGNING_KEY_NOT_FOUND';
    else if (code.includes('SIGNATURE_VERIFICATION_FAILED')) reason = 'SIGNATURE_INVALID';
    else if (code.includes('JWT_EXPIRED')) reason = 'TOKEN_EXPIRED';
    else if (code.includes('JWT_CLAIM_VALIDATION_FAILED')) {
      const claim = String(error?.claim || '').toLowerCase();
      reason = claim === 'iss' ? 'ISSUER_MISMATCH' : claim === 'aud' ? 'AUDIENCE_MISMATCH' : 'JWT_CLAIM_INVALID';
    }
    throw new UnauthorizedError(reason);
  }

  const tenantId = String(payload.tid || '').toLowerCase();
  const callingClientId = String(payload.azp || payload.appid || '').toLowerCase();
  const scopes = typeof payload.scp === 'string' ? payload.scp.split(/\s+/) : [];
  const userId = typeof payload.oid === 'string' ? payload.oid : payload.sub;

  if (tenantId !== context.tenantId) throw new UnauthorizedError('TENANT_ID_MISMATCH');
  if (callingClientId !== context.spaClientId) throw new UnauthorizedError('CALLING_CLIENT_MISMATCH');
  if (!scopes.includes(context.requiredScope)) throw new UnauthorizedError('REQUIRED_SCOPE_MISSING');
  if (typeof userId !== 'string' || userId.length === 0) throw new UnauthorizedError('USER_IDENTIFIER_MISSING');

  return {
    userId,
    tenantId: context.tenantId,
    scopes
  };
}

module.exports = {
  authenticateRequest,
  UnauthorizedError,
  AuthConfigurationError
};
