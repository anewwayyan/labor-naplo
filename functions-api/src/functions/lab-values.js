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

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function response(status, error, message) {
  return { status, headers: { 'Cache-Control': 'private, no-store' }, jsonBody: { error, message } };
}

function nullableNumber(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 999999999999) {
    throw new TypeError(`Érvénytelen ${field} érték.`);
  }
  return number;
}

function validateValue(item) {
  if (!item || typeof item !== 'object') throw new TypeError('Hibás laborérték.');
  if (!GUID_RE.test(item.extractedValueId || '')) throw new TypeError('Érvénytelen kinyert értékazonosító.');
  const parameterName = String(item.parameterName || '').trim();
  if (!parameterName || parameterName.length > 200) throw new TypeError('A vizsgálat neve kötelező, legfeljebb 200 karakter lehet.');
  const valueText = item.valueText === null || item.valueText === undefined || item.valueText === ''
    ? null : String(item.valueText).trim();
  const valueNumeric = nullableNumber(item.valueNumeric, 'eredmény');
  if ((valueNumeric === null) === (valueText === null)) {
    throw new TypeError('Minden értékhez pontosan egy szám vagy szöveges eredmény szükséges.');
  }
  const referenceLow = nullableNumber(item.referenceLow, 'referencia alsó határ');
  const referenceHigh = nullableNumber(item.referenceHigh, 'referencia felső határ');
  if (referenceLow !== null && referenceHigh !== null && referenceLow > referenceHigh) {
    throw new TypeError('A referencia alsó határa nem lehet nagyobb a felső határnál.');
  }
  return {
    extractedValueId: item.extractedValueId,
    parameterName,
    valueNumeric,
    valueText: valueText?.slice(0, 200) || null,
    unit: String(item.unit || '').trim().slice(0, 50) || null,
    referenceRange: String(item.referenceRange || '').trim().slice(0, 100) || null,
    referenceLow,
    referenceHigh,
    isAbnormal: typeof item.isAbnormal === 'boolean' ? item.isAbnormal :
      (valueNumeric !== null && referenceLow !== null && referenceHigh !== null
        ? valueNumeric < referenceLow || valueNumeric > referenceHigh : null)
  };
}

app.http('getReportExtractedValues', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reports/{reportId}/values',
  handler: async (request, context) => {
    try {
      const user = await authenticateRequest(request);
      const reportId = request.params.reportId;
      if (!GUID_RE.test(reportId || '')) return response(400, 'invalid_report_id', 'Érvénytelen leletazonosító.');
      const result = await withUserDatabaseContext(user, async ({ sql, transaction }) =>
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
            ORDER BY SourcePageNumber, ExtractedValueId;
          `)
      );
      return { status: 200, headers: { 'Cache-Control': 'private, no-store' }, jsonBody: { items: result.recordset || [] } };
    } catch (error) {
      if (error instanceof UnauthorizedError || error?.code === 'UNAUTHORIZED') return response(401, 'unauthorized', 'Érvényes bejelentkezés szükséges.');
      if (error instanceof AuthConfigurationError || error instanceof DatabaseConfigurationError) return response(503, 'configuration_error', 'A biztonságos API vagy az adatbázis beállítása még nem teljes.');
      context.error('Leletke extracted values query failed:', error?.code || error?.name || 'UNKNOWN');
      return response(503, 'values_unavailable', 'A kinyert értékek nem érhetők el.');
    }
  }
});

app.http('approveReportValues', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'reports/{reportId}/approve',
  handler: async (request, context) => {
    try {
      const user = await authenticateRequest(request);
      const reportId = request.params.reportId;
      if (!GUID_RE.test(reportId || '')) return response(400, 'invalid_report_id', 'Érvénytelen leletazonosító.');
      const body = await request.json();
      if (!Array.isArray(body?.values) || body.values.length < 1 || body.values.length > 500) {
        return response(400, 'invalid_values', 'Legalább egy és legfeljebb 500 ellenőrzött laborértéket kell elküldeni.');
      }
      const items = body.values.map(validateValue);
      const ids = new Set(items.map(item => item.extractedValueId.toLowerCase()));
      if (ids.size !== items.length) return response(400, 'duplicate_values', 'Ugyanaz a kinyert érték nem szerepelhet többször.');

      const result = await withUserDatabaseContext(user, async ({ sql, transaction }) => {
        const reportRequest = new sql.Request(transaction)
          .input('reportId', sql.UniqueIdentifier, reportId)
          .input('tenantId', sql.UniqueIdentifier, user.tenantId)
          .input('ownerUserId', sql.UniqueIdentifier, user.userId);
        const reportResult = await reportRequest.query(`
          SELECT Status AS status, SampleDate AS sampleDate
          FROM dbo.LabReports
          WHERE ReportId = @reportId AND TenantId = @tenantId AND OwnerUserId = @ownerUserId;
        `);
        const report = reportResult.recordset?.[0];
        if (!report || report.status === 'DeletePending') {
          const error = new Error('A lelet nem található.'); error.code = 'REPORT_NOT_FOUND'; throw error;
        }
        if (report.status === 'Approved') {
          const error = new Error('A lelet már jóvá van hagyva.'); error.code = 'REPORT_ALREADY_APPROVED'; throw error;
        }

        const approved = [];
        for (const item of items) {
          const source = await new sql.Request(transaction)
            .input('extractedValueId', sql.UniqueIdentifier, item.extractedValueId)
            .input('reportId', sql.UniqueIdentifier, reportId)
            .input('tenantId', sql.UniqueIdentifier, user.tenantId)
            .input('ownerUserId', sql.UniqueIdentifier, user.userId)
            .query(`
              SELECT ExtractedValueId
              FROM dbo.ExtractedLabValues
              WHERE ExtractedValueId = @extractedValueId
                AND ReportId = @reportId AND TenantId = @tenantId AND OwnerUserId = @ownerUserId;
            `);
          if (!source.recordset?.length) {
            const error = new Error('Egy ellenőrzött érték nem ehhez a lelethez tartozik.'); error.code = 'INVALID_SOURCE_VALUE'; throw error;
          }

          const inserted = await new sql.Request(transaction)
            .input('tenantId', sql.UniqueIdentifier, user.tenantId)
            .input('ownerUserId', sql.UniqueIdentifier, user.userId)
            .input('reportId', sql.UniqueIdentifier, reportId)
            .input('extractedValueId', sql.UniqueIdentifier, item.extractedValueId)
            .input('name', sql.NVarChar(200), item.parameterName)
            .input('numeric', sql.Decimal(18, 6), item.valueNumeric)
            .input('text', sql.NVarChar(200), item.valueText)
            .input('unit', sql.NVarChar(50), item.unit)
            .input('range', sql.NVarChar(100), item.referenceRange)
            .input('low', sql.Decimal(18, 6), item.referenceLow)
            .input('high', sql.Decimal(18, 6), item.referenceHigh)
            .input('abnormal', sql.Bit, item.isAbnormal)
            .query(`
              INSERT INTO dbo.LabValues
                (TenantId, OwnerUserId, ReportId, ExtractedValueId, OriginalParameterName,
                 ValueNumeric, ValueText, Unit, ReferenceRange, ReferenceLow, ReferenceHigh, IsAbnormal)
              OUTPUT inserted.LabValueId AS labValueId
              VALUES
                (@tenantId, @ownerUserId, @reportId, @extractedValueId, @name,
                 @numeric, @text, @unit, @range, @low, @high, @abnormal);
            `);
          const labValueId = inserted.recordset[0].labValueId;
          const snapshot = JSON.stringify({ ...item, labValueId });
          await new sql.Request(transaction)
            .input('tenantId', sql.UniqueIdentifier, user.tenantId)
            .input('ownerUserId', sql.UniqueIdentifier, user.userId)
            .input('reportId', sql.UniqueIdentifier, reportId)
            .input('labValueId', sql.UniqueIdentifier, labValueId)
            .input('changedBy', sql.UniqueIdentifier, user.userId)
            .input('snapshot', sql.NVarChar(sql.MAX), snapshot)
            .query(`
              INSERT INTO dbo.LabValueHistory
                (TenantId, OwnerUserId, ReportId, LabValueId, ChangeType, ChangedByUserId, NewSnapshotJson)
              VALUES
                (@tenantId, @ownerUserId, @reportId, @labValueId, N'Created', @changedBy, @snapshot);
            `);
          approved.push(labValueId);
        }

        await new sql.Request(transaction)
          .input('reportId', sql.UniqueIdentifier, reportId)
          .input('tenantId', sql.UniqueIdentifier, user.tenantId)
          .input('ownerUserId', sql.UniqueIdentifier, user.userId)
          .query(`
            UPDATE dbo.LabReports
            SET Status = N'Approved', ApprovedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
            WHERE ReportId = @reportId AND TenantId = @tenantId AND OwnerUserId = @ownerUserId;
          `);
        return approved;
      });

      return { status: 200, headers: { 'Cache-Control': 'private, no-store' },
        jsonBody: { approved: true, reportId, savedCount: result.length, labValueIds: result } };
    } catch (error) {
      if (error instanceof UnauthorizedError || error?.code === 'UNAUTHORIZED') return response(401, 'unauthorized', 'Érvényes bejelentkezés szükséges.');
      if (error instanceof AuthConfigurationError || error instanceof DatabaseConfigurationError) return response(503, 'configuration_error', 'A biztonságos API vagy az adatbázis beállítása még nem teljes.');
      if (error instanceof TypeError) return response(400, 'invalid_values', error.message);
      if (error.code === 'REPORT_NOT_FOUND') return response(404, 'report_not_found', error.message);
      if (error.code === 'REPORT_ALREADY_APPROVED') return response(409, 'report_already_approved', error.message);
      if (error.code === 'INVALID_SOURCE_VALUE') return response(400, 'invalid_source_value', error.message);
      context.error('Leletke report approval failed:', error?.code || error?.name || 'UNKNOWN');
      return response(503, 'approval_unavailable', 'A jóváhagyott értékek mentése nem sikerült.');
    }
  }
});

app.http('listLabValues', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'lab-values',
  handler: async (request, context) => {
    try {
      const user = await authenticateRequest(request);
      const result = await withUserDatabaseContext(user, async ({ sql, transaction }) =>
        new sql.Request(transaction)
          .input('tenantId', sql.UniqueIdentifier, user.tenantId)
          .input('ownerUserId', sql.UniqueIdentifier, user.userId)
          .query(`
            SELECT v.LabValueId AS labValueId, v.ReportId AS reportId,
              v.OriginalParameterName AS parameterName, v.ValueNumeric AS valueNumeric,
              v.ValueText AS valueText, v.Unit AS unit, v.ReferenceRange AS referenceRange,
              v.ReferenceLow AS referenceLow, v.ReferenceHigh AS referenceHigh,
              v.IsAbnormal AS isAbnormal, r.SampleDate AS sampleDate,
              r.LabName AS labName, r.OriginalFileName AS originalFileName
            FROM dbo.LabValues v
            INNER JOIN dbo.LabReports r
              ON r.ReportId = v.ReportId AND r.TenantId = v.TenantId AND r.OwnerUserId = v.OwnerUserId
            WHERE v.TenantId = @tenantId AND v.OwnerUserId = @ownerUserId
              AND v.IsDeleted = 0 AND r.Status = N'Approved'
            ORDER BY r.SampleDate DESC, r.CreatedAt DESC, v.OriginalParameterName;
          `)
      );
      return { status: 200, headers: { 'Cache-Control': 'private, no-store' }, jsonBody: { items: result.recordset || [] } };
    } catch (error) {
      if (error instanceof UnauthorizedError || error?.code === 'UNAUTHORIZED') return response(401, 'unauthorized', 'Érvényes bejelentkezés szükséges.');
      if (error instanceof AuthConfigurationError || error instanceof DatabaseConfigurationError) return response(503, 'configuration_error', 'A biztonságos API vagy az adatbázis beállítása még nem teljes.');
      context.error('Leletke lab values query failed:', error?.code || error?.name || 'UNKNOWN');
      return response(503, 'lab_values_unavailable', 'A laboreredmények jelenleg nem érhetők el.');
    }
  }
});
