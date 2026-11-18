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

const TEST_FILE_NAME = '__rls_isolation_test__.pdf';

function isEnabled() {
  return (process.env.ENABLE_RLS_TEST_ENDPOINT || '').trim().toLowerCase() === 'true';
}

function unauthorizedResponse() {
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

app.http('rlsTest', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'rls-test',
  handler: async (request, context) => {
    // This diagnostic endpoint is disabled unless explicitly enabled in the
    // Function App settings. It creates metadata only; no PDF/blob is created.
    if (!isEnabled()) {
      return {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
        jsonBody: { error: 'not_found' }
      };
    }

    try {
      const user = await authenticateRequest(request);

      const result = await withUserDatabaseContext(user, async ({ sql, transaction }) => {
        const dbRequest = new sql.Request(transaction)
          .input('tenantId', sql.UniqueIdentifier, user.tenantId)
          .input('ownerUserId', sql.UniqueIdentifier, user.userId)
          .input('fileName', sql.NVarChar(260), TEST_FILE_NAME)
          .input(
            'blobName',
            sql.NVarChar(512),
            `rls-tests/${user.tenantId}/${user.userId}/isolation-test.pdf`
          );

        if (request.method === 'POST') {
          return dbRequest.query(`
            IF NOT EXISTS
            (
              SELECT 1
              FROM dbo.LabReports
              WHERE OriginalFileName = @fileName
            )
            BEGIN
              INSERT INTO dbo.LabReports
              (
                TenantId,
                OwnerUserId,
                OriginalFileName,
                BlobName,
                ContentType,
                FileSizeBytes,
                Status
              )
              VALUES
              (
                @tenantId,
                @ownerUserId,
                @fileName,
                @blobName,
                'application/pdf',
                1,
                N'Draft'
              );
            END;

            SELECT TOP (1)
              ReportId AS reportId,
              OriginalFileName AS originalFileName,
              CreatedAt AS createdAt
            FROM dbo.LabReports
            WHERE OriginalFileName = @fileName
            ORDER BY CreatedAt DESC;
          `);
        }

        return dbRequest.query(`
          SELECT
            ReportId AS reportId,
            OriginalFileName AS originalFileName,
            CreatedAt AS createdAt
          FROM dbo.LabReports
          WHERE OriginalFileName = @fileName
          ORDER BY CreatedAt DESC;
        `);
      });

      const reports = result.recordset.map((row) => ({
        reportId: row.reportId,
        originalFileName: row.originalFileName,
        createdAt: row.createdAt
      }));

      return {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
        jsonBody: {
          authenticated: true,
          operation: request.method === 'POST' ? 'create-or-get' : 'list',
          visibleTestReports: reports.length,
          reports
        }
      };
    } catch (error) {
      if (error instanceof UnauthorizedError || error?.code === 'UNAUTHORIZED') {
        return unauthorizedResponse();
      }

      if (
        error instanceof AuthConfigurationError ||
        error instanceof DatabaseConfigurationError ||
        error?.code === 'AUTH_CONFIGURATION_ERROR' ||
        error?.code === 'DATABASE_CONFIGURATION_ERROR'
      ) {
        context.error('LaborNapló RLS test configuration error:', error?.code || error?.name);
        return {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
          jsonBody: { error: 'service_not_configured' }
        };
      }

      context.error('LaborNapló RLS test failed:', error?.code || error?.name || 'UNKNOWN');
      return {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
        jsonBody: { error: 'rls_test_unavailable' }
      };
    }
  }
});
