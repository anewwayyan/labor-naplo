'use strict';

const { app } = require('@azure/functions');
const {
  authenticateRequest,
  UnauthorizedError,
  AuthConfigurationError
} = require('../lib/auth');
const {
  withUserDatabaseContext,
  DatabaseConfigurationError
} = require('../lib/database');

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

      // The SQL connection is scoped to this verified user. RLS context is
      // applied on the same transaction before querying the user's reports.
      const result = await withUserDatabaseContext(user, async ({ sql, transaction }) => {
        return new sql.Request(transaction).query(
          'SELECT COUNT_BIG(1) AS visibleReports FROM dbo.LabReports;'
        );
      });

      return {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
        jsonBody: {
          authenticated: true,
          userId: user.userId,
          tenantId: user.tenantId,
          scopes: user.scopes,
          databaseConnected: true,
          rowLevelSecurityContextApplied: true,
          visibleReports: String(result.recordset[0].visibleReports)
        }
      };
    } catch (error) {
      if (error instanceof UnauthorizedError || error?.code === 'UNAUTHORIZED') {
        // Log and return only the fixed reason code. Never log or expose the
        // bearer token, decoded claims, or other credential material.
        const diagnosticCode = typeof error?.reason === 'string'
          ? error.reason
          : 'TOKEN_REJECTED';

        context.warn('LaborNapló API rejected bearer token:', diagnosticCode);

        return {
          status: 401,
          headers: {
            'Cache-Control': 'no-store',
            'WWW-Authenticate': 'Bearer'
          },
          jsonBody: {
            error: 'unauthorized',
            message: 'Érvényes bejelentkezés szükséges.',
            diagnosticCode
          }
        };
      }

      if (error instanceof AuthConfigurationError || error?.code === 'AUTH_CONFIGURATION_ERROR') {
        context.error('LaborNapló API authentication configuration error:', error.message);
        return {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
          jsonBody: {
            error: 'authentication_not_configured',
            message: 'A biztonságos API-hitelesítés beállítása még nem teljes.'
          }
        };
      }

      if (
        error instanceof DatabaseConfigurationError ||
        error?.code === 'DATABASE_CONFIGURATION_ERROR'
      ) {
        context.error('LaborNapló API database configuration error:', error.code);
        return {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
          jsonBody: {
            error: 'database_not_configured',
            message: 'Az adatbázis-kapcsolat beállítása még nem teljes.'
          }
        };
      }

      // Do not return raw SQL errors, connection details, or credentials.
      context.error(
        'LaborNapló API database operation failed:',
        error?.code || error?.name || 'UNKNOWN'
      );
      return {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
        jsonBody: {
          error: 'database_unavailable',
          message: 'Az adatbázis jelenleg nem érhető el.'
        }
      };
    }
  }
});
