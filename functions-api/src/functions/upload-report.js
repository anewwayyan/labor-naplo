'use strict';

const { app } = require('@azure/functions');
const { DefaultAzureCredential } = require('@azure/identity');
const { BlobServiceClient } = require('@azure/storage-blob');
const { randomUUID } = require('node:crypto');
const {
  authenticateRequest,
  UnauthorizedError,
  AuthConfigurationError
} = require('../lib/auth');
const {
  withUserDatabaseContext,
  DatabaseConfigurationError
} = require('../lib/database');

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const PDF_CONTENT_TYPE = 'application/pdf';

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

      const credential = new DefaultAzureCredential();
      const serviceClient = new BlobServiceClient(accountUrl, credential);
      return serviceClient.getContainerClient(containerName);
    })().catch((error) => {
      containerClientPromise = undefined;
      throw error;
    });
  }

  return containerClientPromise;
}

function getOriginalFileName(request) {
  const encodedName = request.headers.get('x-file-name');
  if (!encodedName) return null;

  let decodedName;
  try {
    decodedName = decodeURIComponent(encodedName);
  } catch {
    return null;
  }

  const safeName = decodedName
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();

  if (!safeName || !/\.pdf$/i.test(safeName)) return null;

  // SQL nvarchar(260) stores at most 260 UTF-16 code units; preserve the extension.
  if (safeName.length <= 260) return safeName;
  return safeName.slice(0, 256) + '.pdf';
}

function errorResponse(status, error, message) {
  return {
    status,
    headers: { 'Cache-Control': 'no-store' },
    jsonBody: { error, message }
  };
}

app.http('uploadReport', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'reports',
  handler: async (request, context) => {
    let uploadedBlobClient = null;

    try {
      const user = await authenticateRequest(request);

      const contentType = (request.headers.get('content-type') || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();

      if (contentType !== PDF_CONTENT_TYPE) {
        return errorResponse(415, 'unsupported_media_type', 'Csak PDF-fájl tölthető fel.');
      }

      const declaredLength = Number(request.headers.get('content-length') || 0);
      if (declaredLength > MAX_FILE_SIZE) {
        return errorResponse(413, 'file_too_large', 'A fájl maximális mérete 20 MB.');
      }

      const originalFileName = getOriginalFileName(request);
      if (!originalFileName) {
        return errorResponse(400, 'invalid_file_name', 'Érvényes PDF-fájlnevet kell megadni.');
      }

      const fileBuffer = Buffer.from(await request.arrayBuffer());

      if (fileBuffer.length === 0) {
        return errorResponse(400, 'empty_file', 'A feltöltött fájl üres.');
      }
      if (fileBuffer.length > MAX_FILE_SIZE) {
        return errorResponse(413, 'file_too_large', 'A fájl maximális mérete 20 MB.');
      }
      if (fileBuffer.length < 5 || fileBuffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
        return errorResponse(415, 'invalid_pdf', 'A fájl tartalma nem érvényes PDF-nek tűnik.');
      }

      const reportId = randomUUID();
      const blobName = `reports/${user.tenantId}/${user.userId}/${reportId}.pdf`;
      const containerClient = await getContainerClient();
      uploadedBlobClient = containerClient.getBlockBlobClient(blobName);

      await uploadedBlobClient.uploadData(fileBuffer, {
        blobHTTPHeaders: { blobContentType: PDF_CONTENT_TYPE },
        metadata: { reportid: reportId }
      });

      const result = await withUserDatabaseContext(user, async ({ sql, transaction }) => {
        const insertRequest = new sql.Request(transaction)
          .input('reportId', sql.UniqueIdentifier, reportId)
          .input('tenantId', sql.UniqueIdentifier, user.tenantId)
          .input('ownerUserId', sql.UniqueIdentifier, user.userId)
          .input('originalFileName', sql.NVarChar(260), originalFileName)
          .input('blobName', sql.NVarChar(512), blobName)
          .input('contentType', sql.VarChar(100), PDF_CONTENT_TYPE)
          .input('fileSizeBytes', sql.BigInt, fileBuffer.length);

        const insertResult = await insertRequest.query(`
          INSERT INTO dbo.LabReports
          (
            ReportId,
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
            @reportId,
            @tenantId,
            @ownerUserId,
            @originalFileName,
            @blobName,
            @contentType,
            @fileSizeBytes,
            N'Draft'
          );

          SELECT
            ReportId AS reportId,
            OriginalFileName AS originalFileName,
            FileSizeBytes AS fileSizeBytes,
            Status AS status,
            CreatedAt AS createdAt
          FROM dbo.LabReports
          WHERE ReportId = @reportId;
        `);

        if (!insertResult.recordset?.[0]) {
          throw new Error('REPORT_INSERT_NOT_VISIBLE');
        }

        return insertResult;
      });

      const report = result.recordset[0];

      return {
        status: 201,
        headers: {
          'Cache-Control': 'no-store',
          'Location': `/api/reports/${reportId}`
        },
        jsonBody: {
          uploaded: true,
          report: {
            reportId: report.reportId,
            originalFileName: report.originalFileName,
            fileSizeBytes: String(report.fileSizeBytes),
            status: report.status,
            createdAt: report.createdAt
          }
        }
      };
    } catch (error) {
      // If SQL metadata could not be committed after the blob upload, remove
      // the blob to avoid leaving an unreferenced private document behind.
      if (uploadedBlobClient) {
        try {
          await uploadedBlobClient.deleteIfExists();
        } catch (cleanupError) {
          context.error('Leletke upload cleanup failed:', cleanupError?.code || cleanupError?.name || 'UNKNOWN');
        }
      }

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
        context.error('Leletke upload authentication configuration error.');
        return errorResponse(503, 'authentication_not_configured', 'A biztonságos API-hitelesítés beállítása még nem teljes.');
      }

      if (error instanceof DatabaseConfigurationError || error?.code === 'DATABASE_CONFIGURATION_ERROR') {
        context.error('Leletke upload database configuration error.');
        return errorResponse(503, 'database_not_configured', 'Az adatbázis-kapcsolat beállítása még nem teljes.');
      }

      if (error instanceof StorageConfigurationError || error?.code === 'STORAGE_CONFIGURATION_ERROR') {
        context.error('Leletke upload storage configuration error.');
        return errorResponse(503, 'storage_not_configured', 'A fájltároló beállítása még nem teljes.');
      }

      context.error('Leletke PDF upload failed:', error?.code || error?.name || 'UNKNOWN');
      return errorResponse(503, 'upload_unavailable', 'A feltöltés jelenleg nem sikerült. Kérjük, próbáld újra később.');
    }
  }
});
