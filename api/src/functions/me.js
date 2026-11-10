'use strict';

const { app } = require('@azure/functions');
const { authenticateRequest, UnauthorizedError, AuthConfigurationError } = require('../lib/auth');

app.http('me', {
  methods: ['GET'],
  // Azure Functions must let the request reach our handler so that it can
  // validate the External ID bearer token itself. Missing/invalid tokens
  // are rejected below with HTTP 401.
  authLevel: 'anonymous',
  route: 'me',
  handler: async (request, context) => {
    try {
      const user = await authenticateRequest(request);

      return {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
        jsonBody: {
          authenticated: true,
          userId: user.userId,
          tenantId: user.tenantId,
          scopes: user.scopes
        }
      };
    } catch (error) {
      if (error instanceof UnauthorizedError || error?.code === 'UNAUTHORIZED') {
        return {
          status: 401,
          headers: {
            'Cache-Control': 'no-store',
            'WWW-Authenticate': 'Bearer'
          },
          jsonBody: { error: 'unauthorized', message: 'Érvényes bejelentkezés szükséges.' }
        };
      }

      if (error instanceof AuthConfigurationError || error?.code === 'AUTH_CONFIGURATION_ERROR') {
        context.error('LaborNapló API authentication configuration error:', error.message);
        return {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
          jsonBody: { error: 'authentication_not_configured', message: 'A biztonságos API-hitelesítés beállítása még nem teljes.' }
        };
      }

      context.error('Unexpected error while validating LaborNapló API authentication.');
      return {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
        jsonBody: { error: 'authentication_unavailable', message: 'A hitelesítés jelenleg nem érhető el.' }
      };
    }
  }
});
