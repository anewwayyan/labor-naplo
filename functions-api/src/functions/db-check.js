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

app.http('dbCheck', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'db-check',
  handler: async (request, context) => {
    try {
      const user = await authenticateRequest(request);

      const result = await withUserDatabaseContext(user, async ({ sql, transaction }) => {
        return new sql.Request(transaction).query(
          'SELECT COUNT_BIG(1) AS visibleReports FROM dbo.LabReports;'
        );
      });

      return {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
        jsonBody: {
          databaseConnected: true,
          rowLevelSecurityContextApplied: true,
          visibleReports: String(result.recordset[0].visibleReports)
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
          jsonBody: {
            error: 'unauthorized',
            message: 'Érvényes bejelentkezés szükséges.'
          }
        };
      }

      if (
        error instanceof AuthConfigurationError ||
        error instanceof DatabaseConfigurationError ||
        error?.code === 'AUTH_CONFIGURATION_ERROR' ||
        error?.code === 'DATABASE_CONFIGURATION_ERROR'
      ) {
        context.error('LaborNapló database check configuration error:', error.code);
        return {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
          jsonBody: {
            error: 'database_not_configured',
            message: 'Az adatbázis-kapcsolat beállítása még nem teljes.'
          }
        };
      }

      context.error('LaborNapló database connectivity check failed:', error?.code || error?.name || 'UNKNOWN');
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
