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

function errorResponse(status, error, message) {
  return {
    status,
    headers: { 'Cache-Control': 'no-store' },
    jsonBody: { error, message }
  };
}

app.http('listReports', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reports',
  handler: async (request, context) => {
    try {
      // The owner and tenant are always derived from the verified Entra token.
      // The SQL RLS context is applied on the same connection as this query.
      const user = await authenticateRequest(request);

      const result = await withUserDatabaseContext(user, async ({ sql, transaction }) => {
        const query = new sql.Request(transaction)
          .input('tenantId', sql.UniqueIdentifier, user.tenantId)
          .input('ownerUserId', sql.UniqueIdentifier, user.userId);

        return query.query(`
          SELECT
            ReportId AS reportId,
            LabName AS labName,
            SampleDate AS sampleDate,
            OriginalFileName AS originalFileName,
            ContentType AS contentType,
            FileSizeBytes AS fileSizeBytes,
            Status AS status,
            CreatedAt AS createdAt,
            UpdatedAt AS updatedAt
          FROM dbo.LabReports
          WHERE TenantId = @tenantId
            AND OwnerUserId = @ownerUserId
          ORDER BY CreatedAt DESC;
        `);
      });

      const reports = (result.recordset || []).map((report) => ({
        reportId: report.reportId,
        labName: report.labName,
        sampleDate: report.sampleDate,
        originalFileName: report.originalFileName,
        contentType: report.contentType,
        fileSizeBytes: String(report.fileSizeBytes),
        status: report.status,
        createdAt: report.createdAt,
        updatedAt: report.updatedAt
      }));

      return {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
        jsonBody: { reports }
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

      if (error instanceof AuthConfigurationError || error?.code === 'AUTH_CONFIGURATION_ERROR') {
        context.error('LaborNapló report-list authentication configuration error.');
        return errorResponse(503, 'authentication_not_configured', 'A biztonságos API-hitelesítés beállítása még nem teljes.');
      }

      if (error instanceof DatabaseConfigurationError || error?.code === 'DATABASE_CONFIGURATION_ERROR') {
        context.error('LaborNapló report-list database configuration error.');
        return errorResponse(503, 'database_not_configured', 'Az adatbázis-kapcsolat beállítása még nem teljes.');
      }

      context.error('LaborNapló report list failed:', error?.code || error?.name || 'UNKNOWN');
      return errorResponse(503, 'reports_unavailable', 'A leletek listája jelenleg nem érhető el. Próbáld újra később.');
    }
  }
});
