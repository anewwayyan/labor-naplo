'use strict';

const { app } = require('@azure/functions');
const { DefaultAzureCredential } = require('@azure/identity');
const { BlobServiceClient } = require('@azure/storage-blob');
const {
  authenticateRequest,
  UnauthorizedError,
  AuthConfigurationError
} = require('../lib/auth');
const {
  withUserDatabaseContext,
  DatabaseConfigurationError
} = require('../lib/database');

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class StorageConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.code = 'STORAGE_CONFIGURATION_ERROR';
  }
}

let containerClientPromise;

function getContainerClient() {
  if (!containerClientPromise) {
    containerClientPromise = (async () => {
      const accountUrl = (process.env.BLOB_STORAGE_ACCOUNT_URL || '').trim();
      const containerName = (process.env.BLOB_STORAGE_CONTAINER || '').trim();
      if (!accountUrl || !containerName) {
        throw new StorageConfigurationError('Blob Storage settings are missing.');
      }

      let parsedUrl;
      try {
        parsedUrl = new URL(accountUrl);
      } catch {
        throw new StorageConfigurationError('Blob Storage account URL is invalid.');
      }

      if (
        parsedUrl.protocol !== 'https:' ||
        !/^[a-z0-9]+\.blob\.core\.windows\.net$/i.test(parsedUrl.hostname) ||
        parsedUrl.pathname !== '/' ||
        parsedUrl.search ||
        parsedUrl.hash
      ) {
        throw new StorageConfigurationError('Blob Storage account URL is not an approved Azure endpoint.');
      }

      if (!/^[a-z0-9-]{3,63}$/.test(containerName)) {
        throw new StorageConfigurationError('Blob Storage container name is invalid.');
      }

      return new BlobServiceClient(accountUrl, new DefaultAzureCredential())
        .getContainerClient(containerName);
    })().catch((error) => {
      containerClientPromise = undefined;
      throw error;
    });
  }
  return containerClientPromise;
}

function errorResponse(status, error, message) {
  return {
    status,
    headers: { 'Cache-Control': 'no-store' },
    jsonBody: { error, message }
  };
}

app.http('deleteReport', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'reports/{reportId}',
  handler: async (request, context) => {
    let previousStatus = null;
    let reportId;

    try {
      const user = await authenticateRequest(request);
      reportId = request.params.reportId;

      if (typeof reportId !== 'string' || !GUID_RE.test(reportId)) {
        return errorResponse(400, 'invalid_report_id', 'Érvénytelen leletazonosító.');
      }

      // Mark first, then remove the private PDF. This is retry-safe: if Blob
      // deletion fails, the previous status is restored when possible.
      const reportResult = await withUserDatabaseContext(user, async ({ sql, transaction }) => {
        const result = await new sql.Request(transaction)
          .input('reportId', sql.UniqueIdentifier, reportId)
          .input('tenantId', sql.UniqueIdentifier, user.tenantId)
          .input('ownerUserId', sql.UniqueIdentifier, user.userId)
          .query(`
            SELECT BlobName AS blobName, Status AS status
            FROM dbo.LabReports
            WHERE ReportId = @reportId
              AND TenantId = @tenantId
              AND OwnerUserId = @ownerUserId;

            UPDATE dbo.LabReports
            SET Status = N'DeletePending',
                UpdatedAt = SYSUTCDATETIME()
            WHERE ReportId = @reportId
              AND TenantId = @tenantId
              AND OwnerUserId = @ownerUserId
              AND Status <> N'DeletePending';
          `);

        return result.recordsets?.[0]?.[0] || null;
      });

      if (!reportResult) {
        return errorResponse(404, 'report_not_found', 'A lelet nem található.');
      }

      previousStatus = reportResult.status;

      try {
        const containerClient = await getContainerClient();
        const blobClient = containerClient.getBlockBlobClient(reportResult.blobName);
        await blobClient.deleteIfExists();
      } catch (storageError) {
        // Restore the old state so the user can see and retry the deletion.
        if (previousStatus !== 'DeletePending') {
          try {
            await withUserDatabaseContext(user, async ({ sql, transaction }) => {
              await new sql.Request(transaction)
                .input('reportId', sql.UniqueIdentifier, reportId)
                .input('tenantId', sql.UniqueIdentifier, user.tenantId)
                .input('ownerUserId', sql.UniqueIdentifier, user.userId)
                .input('previousStatus', sql.NVarChar(20), previousStatus)
                .query(`
                  UPDATE dbo.LabReports
                  SET Status = @previousStatus,
                      UpdatedAt = SYSUTCDATETIME()
                  WHERE ReportId = @reportId
                    AND TenantId = @tenantId
                    AND OwnerUserId = @ownerUserId
                    AND Status = N'DeletePending';
                `);
            });
          } catch (restoreError) {
            context.error('LaborNapló delete status restore failed:', restoreError?.code || restoreError?.name || 'UNKNOWN');
          }
        }

        throw storageError;
      }

      // The SQL row remains as a DeletePending tombstone. The database role
      // intentionally has no hard-delete permission; a separate maintenance
      // process can later purge metadata and dependent/audit rows safely.
      return {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
        jsonBody: { deleted: true, reportId }
      };
    } catch (error) {
      if (error instanceof UnauthorizedError || error?.code === 'UNAUTHORIZED') {
        return {
          status: 401,
          headers: { 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Bearer' },
          jsonBody: { error: 'unauthorized', message: 'Érvényes bejelentkezés szükséges.' }
        };
      }

      if (error instanceof AuthConfigurationError || error?.code === 'AUTH_CONFIGURATION_ERROR') {
        context.error('LaborNapló report-delete authentication configuration error.');
        return errorResponse(503, 'authentication_not_configured', 'A biztonságos API-hitelesítés beállítása még nem teljes.');
      }

      if (error instanceof DatabaseConfigurationError || error?.code === 'DATABASE_CONFIGURATION_ERROR') {
        context.error('LaborNapló report-delete database configuration error.');
        return errorResponse(503, 'database_not_configured', 'Az adatbázis-kapcsolat beállítása még nem teljes.');
      }

      if (error instanceof StorageConfigurationError || error?.code === 'STORAGE_CONFIGURATION_ERROR') {
        context.error('LaborNapló report-delete storage configuration error.');
        return errorResponse(503, 'storage_not_configured', 'A biztonságos fájltároló jelenleg nem érhető el.');
      }

      context.error('LaborNapló PDF delete failed:', error?.code || error?.name || 'UNKNOWN');
      return errorResponse(503, 'delete_unavailable', 'A lelet törlése most nem sikerült. A leletet nem távolítottuk el a listádból; próbáld újra később.');
    }
  }
});
