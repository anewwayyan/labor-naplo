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
const MAX_FILE_SIZE = 20 * 1024 * 1024;

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
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    },
    jsonBody: { error, message }
  };
}

function safeInlineDisposition(fileName) {
  const safeName = String(fileName || 'lelet.pdf')
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[";]/g, '_')
    .trim() || 'lelet.pdf';
  const asciiName = safeName
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_');
  const encodedName = encodeURIComponent(safeName).replace(/['()*]/g, (char) =>
    '%' + char.charCodeAt(0).toString(16).toUpperCase()
  );

  return `inline; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}

app.http('getReportPdf', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reports/{reportId}/pdf',
  handler: async (request, context) => {
    try {
      const user = await authenticateRequest(request);
      const reportId = request.params.reportId;

      if (typeof reportId !== 'string' || !GUID_RE.test(reportId)) {
        return errorResponse(400, 'invalid_report_id', 'Érvénytelen leletazonosító.');
      }

      // Resolve the blob path only after checking the authenticated owner and
      // tenant in SQL. The path is never accepted from the browser.
      const reportResult = await withUserDatabaseContext(user, async ({ sql, transaction }) => {
        return new sql.Request(transaction)
          .input('reportId', sql.UniqueIdentifier, reportId)
          .input('tenantId', sql.UniqueIdentifier, user.tenantId)
          .input('ownerUserId', sql.UniqueIdentifier, user.userId)
          .query(`
            SELECT
              BlobName AS blobName,
              OriginalFileName AS originalFileName,
              ContentType AS contentType,
              FileSizeBytes AS fileSizeBytes
            FROM dbo.LabReports
            WHERE ReportId = @reportId
              AND TenantId = @tenantId
              AND OwnerUserId = @ownerUserId
              AND Status <> N'DeletePending';
          `);
      });

      const report = reportResult.recordset?.[0];
      if (!report) {
        return errorResponse(404, 'report_not_found', 'A lelet nem található.');
      }

      if (
        report.contentType !== 'application/pdf' ||
        Number(report.fileSizeBytes) <= 0 ||
        Number(report.fileSizeBytes) > MAX_FILE_SIZE
      ) {
        context.error('Leletke PDF preview rejected unexpected document metadata.');
        return errorResponse(415, 'unsupported_document', 'Ez a dokumentum nem jeleníthető meg PDF-ként.');
      }

      const containerClient = await getContainerClient();
      const blobClient = containerClient.getBlockBlobClient(report.blobName);
      const pdfBuffer = await blobClient.downloadToBuffer();

      if (
        !Buffer.isBuffer(pdfBuffer) ||
        pdfBuffer.length < 5 ||
        pdfBuffer.length > MAX_FILE_SIZE ||
        pdfBuffer.subarray(0, 5).toString('ascii') !== '%PDF-'
      ) {
        context.error('Leletke PDF preview found invalid stored PDF content.');
        return errorResponse(415, 'invalid_stored_pdf', 'A tárolt dokumentum nem érvényes PDF.');
      }

      return {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(pdfBuffer.length),
          'Content-Disposition': safeInlineDisposition(report.originalFileName),
          'Cache-Control': 'private, no-store, max-age=0',
          'Pragma': 'no-cache',
          'X-Content-Type-Options': 'nosniff'
        },
        body: pdfBuffer
      };
    } catch (error) {
      if (error instanceof UnauthorizedError || error?.code === 'UNAUTHORIZED') {
        return {
          status: 401,
          headers: {
            'Cache-Control': 'private, no-store, max-age=0',
            'WWW-Authenticate': 'Bearer'
          },
          jsonBody: { error: 'unauthorized', message: 'Érvényes bejelentkezés szükséges.' }
        };
      }

      if (error instanceof AuthConfigurationError || error?.code === 'AUTH_CONFIGURATION_ERROR') {
        context.error('Leletke PDF preview authentication configuration error.');
        return errorResponse(503, 'authentication_not_configured', 'A biztonságos API-hitelesítés beállítása még nem teljes.');
      }

      if (error instanceof DatabaseConfigurationError || error?.code === 'DATABASE_CONFIGURATION_ERROR') {
        context.error('Leletke PDF preview database configuration error.');
        return errorResponse(503, 'database_not_configured', 'Az adatbázis-kapcsolat beállítása még nem teljes.');
      }

      if (error instanceof StorageConfigurationError || error?.code === 'STORAGE_CONFIGURATION_ERROR') {
        context.error('Leletke PDF preview storage configuration error.');
        return errorResponse(503, 'storage_not_configured', 'A biztonságos fájltároló jelenleg nem érhető el.');
      }

      if (error?.statusCode === 404 || error?.code === 'BlobNotFound') {
        return errorResponse(404, 'document_not_found', 'A PDF-fájl nem található a dokumentumtárban.');
      }

      context.error('Leletke PDF preview failed:', error?.code || error?.name || 'UNKNOWN');
      return errorResponse(503, 'pdf_preview_unavailable', 'A PDF megnyitása most nem sikerült. Próbáld újra később.');
    }
  }
});
