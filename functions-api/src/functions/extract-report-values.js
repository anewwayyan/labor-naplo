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
const { extractLabCandidates } = require('../lib/lab-value-parser-enhanced');

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const F0_MAX_FILE_SIZE = 4 * 1024 * 1024;
const MAX_PAGES = '1-2';

class ServiceConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.code = 'SERVICE_CONFIGURATION_ERROR';
  }
}

function getStorageContainer() {
  const accountUrl = (process.env.BLOB_STORAGE_ACCOUNT_URL || '').trim();
  const containerName = (process.env.BLOB_STORAGE_CONTAINER || '').trim();
  if (!accountUrl || !containerName) throw new ServiceConfigurationError('A dokumentumtár nincs beállítva.');
  return new BlobServiceClient(accountUrl, new DefaultAzureCredential()).getContainerClient(containerName);
}

async function analyzeWithDocumentIntelligence(pdfBuffer) {
  const endpoint = (process.env.DOCUMENT_INTELLIGENCE_ENDPOINT || '').trim().replace(/\/$/, '');
  const key = (process.env.DOCUMENT_INTELLIGENCE_KEY || '').trim();
  if (!endpoint || !key) {
    throw new ServiceConfigurationError('Az Azure AI Document Intelligence F0 erőforrás még nincs összekötve az API-val.');
  }

  const base = new URL(endpoint);
  if (base.protocol !== 'https:' || !/\.cognitiveservices\.azure\.com$/i.test(base.hostname) &&
      !/\.services\.ai\.azure\.com$/i.test(base.hostname)) {
    throw new ServiceConfigurationError('A Document Intelligence végpontja nem érvényes Azure HTTPS-cím.');
  }

  const analyzeUrl = new URL('/documentintelligence/documentModels/prebuilt-read:analyze', base);
  analyzeUrl.searchParams.set('api-version', '2024-11-30');
  analyzeUrl.searchParams.set('pages', MAX_PAGES);

  const response = await fetch(analyzeUrl, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/pdf',
      'Accept': 'application/json'
    },
    body: pdfBuffer,
    signal: AbortSignal.timeout(30000)
  });

  if (response.status !== 202) {
    const detail = await response.text().catch(() => '');
    const error = new Error('Az Azure OCR feldolgozás elindítása nem sikerült.');
    error.upstreamStatus = response.status;
    error.upstreamCode = detail.slice(0, 300);
    throw error;
  }

  const operationUrl = response.headers.get('operation-location');
  if (!operationUrl) throw new Error('Az OCR szolgáltatás nem adott feldolgozási azonosítót.');

  const parsedOperationUrl = new URL(operationUrl);
  if (parsedOperationUrl.protocol !== 'https:' || parsedOperationUrl.hostname !== base.hostname) {
    throw new Error('Az OCR szolgáltatás érvénytelen feldolgozási címet adott.');
  }

  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const poll = await fetch(parsedOperationUrl, {
      headers: { 'Ocp-Apim-Subscription-Key': key, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000)
    });
    if (!poll.ok) throw new Error('Az OCR feldolgozás állapotának lekérdezése nem sikerült.');
    const result = await poll.json();
    if (result.status === 'succeeded') return result.analyzeResult || {};
    if (result.status === 'failed' || result.status === 'canceled') {
      throw new Error('Az Azure OCR nem tudta feldolgozni ezt a PDF-et.');
    }
  }

  const timeout = new Error('Az OCR feldolgozás a vártnál tovább tart. Próbáld újra később.');
  timeout.code = 'OCR_TIMEOUT';
  throw timeout;
}

function response(status, error, message) {
  return { status, headers: { 'Cache-Control': 'private, no-store' }, jsonBody: { error, message } };
}

app.http('extractReportValues', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'reports/{reportId}/extract',
  handler: async (request, context) => {
    try {
      const user = await authenticateRequest(request);
      const reportId = request.params.reportId;
      if (!GUID_RE.test(reportId || '')) return response(400, 'invalid_report_id', 'Érvénytelen leletazonosító.');

      const existing = await withUserDatabaseContext(user, async ({ sql, transaction }) =>
        new sql.Request(transaction)
          .input('reportId', sql.UniqueIdentifier, reportId)
          .input('tenantId', sql.UniqueIdentifier, user.tenantId)
          .input('ownerUserId', sql.UniqueIdentifier, user.userId)
          .query(`
            SELECT ExtractedValueId AS extractedValueId, SourcePageNumber AS sourcePageNumber,
              RawParameterName AS rawParameterName, RawValue AS rawValue,
              ParsedNumericValue AS parsedNumericValue, Unit AS unit,
              ReferenceRange AS referenceRange, ReferenceLow AS referenceLow,
              ReferenceHigh AS referenceHigh, IsAbnormal AS isAbnormal
            FROM dbo.ExtractedLabValues
            WHERE ReportId = @reportId AND TenantId = @tenantId AND OwnerUserId = @ownerUserId
              AND EXISTS (
                SELECT 1 FROM dbo.LabReports r
                WHERE r.ReportId = @reportId AND r.TenantId = @tenantId
                  AND r.OwnerUserId = @ownerUserId AND r.Status <> N'DeletePending'
              );
          `)
      );
      if (existing.recordset?.length) {
        return { status: 200, headers: { 'Cache-Control': 'private, no-store' },
          jsonBody: { extracted: true, alreadyProcessed: true, items: existing.recordset } };
      }

      const reportResult = await withUserDatabaseContext(user, async ({ sql, transaction }) =>
        new sql.Request(transaction)
          .input('reportId', sql.UniqueIdentifier, reportId)
          .input('tenantId', sql.UniqueIdentifier, user.tenantId)
          .input('ownerUserId', sql.UniqueIdentifier, user.userId)
          .query(`
            SELECT BlobName AS blobName, ContentType AS contentType, FileSizeBytes AS fileSizeBytes, Status AS status
            FROM dbo.LabReports
            WHERE ReportId = @reportId AND TenantId = @tenantId AND OwnerUserId = @ownerUserId;
          `)
      );
      const report = reportResult.recordset?.[0];
      if (!report || report.status === 'DeletePending') return response(404, 'report_not_found', 'A lelet nem található.');
      if (report.status === 'Approved') return response(409, 'report_already_approved', 'Ez a lelet már jóvá van hagyva.');
      if (report.contentType !== 'application/pdf' || Number(report.fileSizeBytes) > MAX_FILE_SIZE) {
        return response(415, 'unsupported_document', 'Ez a dokumentum nem dolgozható fel.');
      }
      if (Number(report.fileSizeBytes) > F0_MAX_FILE_SIZE) {
        return response(413, 'f0_file_too_large', 'Az ingyenes F0 feldolgozáshoz a PDF legfeljebb 4 MB lehet. Kisebb fájlt tölts fel.');
      }

      const container = getStorageContainer();
      const pdf = await container.getBlockBlobClient(report.blobName).downloadToBuffer();
      if (pdf.length < 5 || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
        return response(415, 'invalid_pdf', 'A tárolt fájl nem érvényes PDF.');
      }

      const analyzeResult = await analyzeWithDocumentIntelligence(pdf);

      // Owner-authenticated, opt-in diagnostics. Never log OCR text or expose it by default.
      if (request.query.get('debug') === '1' && process.env.ENABLE_OCR_DEBUG === 'true') {
        const pages = Array.isArray(analyzeResult.pages) ? analyzeResult.pages : [];
        return {
          status: 200,
          headers: { 'Cache-Control': 'private, no-store' },
          jsonBody: {
            diagnostic: true,
            pages: pages.map(page => ({
              pageNumber: page.pageNumber,
              lines: (Array.isArray(page.lines) ? page.lines : []).map(line => ({
                content: line.content || '',
                boundingRegions: line.boundingRegions || []
              })),
              words: (Array.isArray(page.words) ? page.words : []).map(word => ({
                content: word.content || '',
                confidence: word.confidence ?? null,
                boundingRegions: word.boundingRegions || []
              }))
            }))
          }
        };
      }

      const candidates = extractLabCandidates(analyzeResult);
      if (!candidates.length) {
        return response(422, 'no_lab_values_found', 'A leletből nem sikerült biztosan felismerhető laborértéket kinyerni. Ellenőrizd a PDF-et, vagy próbálj jobb minőségű dokumentumot.');
      }

      const inserted = await withUserDatabaseContext(user, async ({ sql, transaction }) => {
        const rows = [];
        for (const item of candidates) {
          const result = await new sql.Request(transaction)
            .input('tenantId', sql.UniqueIdentifier, user.tenantId)
            .input('ownerUserId', sql.UniqueIdentifier, user.userId)
            .input('reportId', sql.UniqueIdentifier, reportId)
            .input('page', sql.SmallInt, item.sourcePageNumber)
            .input('name', sql.NVarChar(200), item.rawParameterName)
            .input('rawValue', sql.NVarChar(200), item.rawValue)
            .input('numericValue', sql.Decimal(18, 6), item.parsedNumericValue)
            .input('unit', sql.NVarChar(50), item.unit)
            .input('range', sql.NVarChar(100), item.referenceRange)
            .input('low', sql.Decimal(18, 6), item.referenceLow)
            .input('high', sql.Decimal(18, 6), item.referenceHigh)
            .input('abnormal', sql.Bit, item.isAbnormal)
            .query(`
              INSERT INTO dbo.ExtractedLabValues
                (TenantId, OwnerUserId, ReportId, SourcePageNumber, RawParameterName, RawValue,
                 ParsedNumericValue, Unit, ReferenceRange, ReferenceLow, ReferenceHigh, IsAbnormal)
              OUTPUT inserted.ExtractedValueId AS extractedValueId
              VALUES
                (@tenantId, @ownerUserId, @reportId, @page, @name, @rawValue,
                 @numericValue, @unit, @range, @low, @high, @abnormal);
            `);
          rows.push({ ...item, extractedValueId: result.recordset[0].extractedValueId });
        }

        await new sql.Request(transaction)
          .input('reportId', sql.UniqueIdentifier, reportId)
          .input('tenantId', sql.UniqueIdentifier, user.tenantId)
          .input('ownerUserId', sql.UniqueIdentifier, user.userId)
          .query(`
            UPDATE dbo.LabReports SET Status = N'Review', UpdatedAt = SYSUTCDATETIME()
            WHERE ReportId = @reportId AND TenantId = @tenantId AND OwnerUserId = @ownerUserId
              AND Status = N'Draft';
          `);
        return rows;
      });

      return { status: 200, headers: { 'Cache-Control': 'private, no-store' },
        jsonBody: { extracted: true, alreadyProcessed: false, pagesProcessed: Math.min(2, analyzeResult.pages?.length || 0), items: inserted } };
    } catch (error) {
      if (error instanceof UnauthorizedError || error?.code === 'UNAUTHORIZED') {
        return { status: 401, headers: { 'Cache-Control': 'private, no-store', 'WWW-Authenticate': 'Bearer' },
          jsonBody: { error: 'unauthorized', message: 'Érvényes bejelentkezés szükséges.' } };
      }
      if (error instanceof AuthConfigurationError || error instanceof DatabaseConfigurationError) {
        return response(503, 'configuration_error', 'A biztonságos API vagy az adatbázis beállítása még nem teljes.');
      }
      if (error instanceof ServiceConfigurationError) return response(503, 'ocr_not_configured', error.message);
      if (error.code === 'OCR_TIMEOUT') return response(504, 'ocr_timeout', error.message);
      context.error('Leletke OCR extraction failed:', error?.code || error?.name || 'UNKNOWN', error?.upstreamStatus || '');
      return response(503, 'extraction_unavailable', 'A lelet feldolgozása most nem sikerült. Próbáld újra később.');
    }
  }
});
