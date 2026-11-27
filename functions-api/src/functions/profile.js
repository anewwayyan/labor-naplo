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

const PROFILE_FIELDS = new Set([
  'firstName',
  'preferredName',
  'greetingEnabled',
  'dateOfBirth',
  'sex'
]);

class ProfileValidationError extends Error {
  constructor(message) {
    super(message);
    this.code = 'PROFILE_VALIDATION_ERROR';
  }
}

function response(status, error, message) {
  return {
    status,
    headers: { 'Cache-Control': 'no-store' },
    jsonBody: error ? { error, message } : message
  };
}

function normalizeOptionalText(value, field, maxLength) {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new ProfileValidationError(field + ' must be a string or null.');
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new ProfileValidationError(field + ' is too long.');
  }
  return normalized || null;
}

function normalizeDate(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ProfileValidationError('dateOfBirth must use YYYY-MM-DD format or null.');
  }
  const parsed = new Date(value + 'T00:00:00.000Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ProfileValidationError('dateOfBirth is not a valid calendar date.');
  }
  if (value > new Date().toISOString().slice(0, 10)) {
    throw new ProfileValidationError('dateOfBirth cannot be in the future.');
  }
  return value;
}

function validateProfileBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ProfileValidationError('A JSON object is required.');
  }
  const keys = Object.keys(body);
  if (keys.length === 0) {
    throw new ProfileValidationError('At least one profile field is required.');
  }
  for (const key of keys) {
    if (!PROFILE_FIELDS.has(key)) {
      throw new ProfileValidationError('Unknown profile field: ' + key + '.');
    }
  }

  const values = {};
  for (const key of PROFILE_FIELDS) {
    values[key] = Object.prototype.hasOwnProperty.call(body, key) ? body[key] : undefined;
  }
  if (values.firstName !== undefined) values.firstName = normalizeOptionalText(values.firstName, 'firstName', 100);
  if (values.preferredName !== undefined) values.preferredName = normalizeOptionalText(values.preferredName, 'preferredName', 100);
  if (values.sex !== undefined) values.sex = normalizeOptionalText(values.sex, 'sex', 30);
  if (values.dateOfBirth !== undefined) values.dateOfBirth = normalizeDate(values.dateOfBirth);
  if (values.greetingEnabled !== undefined && typeof values.greetingEnabled !== 'boolean') {
    throw new ProfileValidationError('greetingEnabled must be true or false.');
  }
  return values;
}

function profileFromRow(row) {
  if (!row) {
    return {
      firstName: null,
      preferredName: null,
      greetingEnabled: true,
      dateOfBirth: null,
      sex: null
    };
  }
  return {
    firstName: row.firstName,
    preferredName: row.preferredName,
    greetingEnabled: row.greetingEnabled,
    dateOfBirth: row.dateOfBirth ? new Date(row.dateOfBirth).toISOString().slice(0, 10) : null,
    sex: row.sex
  };
}

function unauthorizedResponse() {
  return {
    status: 401,
    headers: { 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Bearer' },
    jsonBody: { error: 'unauthorized', message: 'Érvényes bejelentkezés szükséges.' }
  };
}

app.http('getProfile', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'profile',
  handler: async (request, context) => {
    try {
      const user = await authenticateRequest(request);
      const result = await withUserDatabaseContext(user, async ({ sql, transaction }) => {
        return new sql.Request(transaction)
          .input('tenantId', sql.UniqueIdentifier, user.tenantId)
          .input('ownerUserId', sql.UniqueIdentifier, user.userId)
          .query(`
            SELECT
              FirstName AS firstName,
              PreferredName AS preferredName,
              GreetingEnabled AS greetingEnabled,
              DateOfBirth AS dateOfBirth,
              Sex AS sex
            FROM dbo.UserProfiles
            WHERE TenantId = @tenantId
              AND OwnerUserId = @ownerUserId;
          `);
      });

      return response(200, null, {
        profile: profileFromRow(result.recordset?.[0] || null),
        profileExists: Boolean(result.recordset?.[0])
      });
    } catch (error) {
      if (error instanceof UnauthorizedError || error?.code === 'UNAUTHORIZED') return unauthorizedResponse();
      if (error instanceof AuthConfigurationError || error?.code === 'AUTH_CONFIGURATION_ERROR') {
        context.error('Leletke profile authentication configuration error.');
        return response(503, 'authentication_not_configured', 'A biztonságos API-hitelesítés beállítása még nem teljes.');
      }
      if (error instanceof DatabaseConfigurationError || error?.code === 'DATABASE_CONFIGURATION_ERROR') {
        context.error('Leletke profile database configuration error.');
        return response(503, 'database_not_configured', 'Az adatbázis-kapcsolat beállítása még nem teljes.');
      }
      context.error('Leletke profile read failed:', error?.code || error?.name || 'UNKNOWN');
      return response(503, 'profile_unavailable', 'A profil jelenleg nem érhető el. Próbáld újra később.');
    }
  }
});

app.http('saveProfile', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'profile',
  handler: async (request, context) => {
    try {
      const user = await authenticateRequest(request);
      let body;
      try {
        body = await request.json();
      } catch {
        throw new ProfileValidationError('Érvényes JSON-kérés szükséges.');
      }

      const values = validateProfileBody(body);
      const result = await withUserDatabaseContext(user, async ({ sql, transaction }) => {
        const query = new sql.Request(transaction)
          .input('tenantId', sql.UniqueIdentifier, user.tenantId)
          .input('ownerUserId', sql.UniqueIdentifier, user.userId)
          .input('hasFirstName', sql.Bit, values.firstName !== undefined)
          .input('firstName', sql.NVarChar(100), values.firstName ?? null)
          .input('hasPreferredName', sql.Bit, values.preferredName !== undefined)
          .input('preferredName', sql.NVarChar(100), values.preferredName ?? null)
          .input('hasGreetingEnabled', sql.Bit, values.greetingEnabled !== undefined)
          .input('greetingEnabled', sql.Bit, values.greetingEnabled ?? true)
          .input('hasDateOfBirth', sql.Bit, values.dateOfBirth !== undefined)
          .input('dateOfBirth', sql.Date, values.dateOfBirth ?? null)
          .input('hasSex', sql.Bit, values.sex !== undefined)
          .input('sex', sql.NVarChar(30), values.sex ?? null);

        return query.query(`
          IF EXISTS
          (
            SELECT 1
            FROM dbo.UserProfiles WITH (UPDLOCK, HOLDLOCK)
            WHERE TenantId = @tenantId
              AND OwnerUserId = @ownerUserId
          )
          BEGIN
            UPDATE dbo.UserProfiles
            SET
              FirstName = CASE WHEN @hasFirstName = 1 THEN @firstName ELSE FirstName END,
              PreferredName = CASE WHEN @hasPreferredName = 1 THEN @preferredName ELSE PreferredName END,
              GreetingEnabled = CASE WHEN @hasGreetingEnabled = 1 THEN @greetingEnabled ELSE GreetingEnabled END,
              DateOfBirth = CASE WHEN @hasDateOfBirth = 1 THEN @dateOfBirth ELSE DateOfBirth END,
              Sex = CASE WHEN @hasSex = 1 THEN @sex ELSE Sex END,
              UpdatedAt = SYSUTCDATETIME()
            WHERE TenantId = @tenantId
              AND OwnerUserId = @ownerUserId;
          END
          ELSE
          BEGIN
            INSERT INTO dbo.UserProfiles
              (TenantId, OwnerUserId, FirstName, PreferredName, GreetingEnabled, DateOfBirth, Sex)
            VALUES
              (@tenantId, @ownerUserId, @firstName, @preferredName, @greetingEnabled, @dateOfBirth, @sex);
          END;

          SELECT
            FirstName AS firstName,
            PreferredName AS preferredName,
            GreetingEnabled AS greetingEnabled,
            DateOfBirth AS dateOfBirth,
            Sex AS sex
          FROM dbo.UserProfiles
          WHERE TenantId = @tenantId
            AND OwnerUserId = @ownerUserId;
        `);
      });

      return response(200, null, {
        saved: true,
        profile: profileFromRow(result.recordset?.[0] || null)
      });
    } catch (error) {
      if (error instanceof ProfileValidationError || error?.code === 'PROFILE_VALIDATION_ERROR') {
        return response(400, 'invalid_profile', error.message);
      }
      if (error instanceof UnauthorizedError || error?.code === 'UNAUTHORIZED') return unauthorizedResponse();
      if (error instanceof AuthConfigurationError || error?.code === 'AUTH_CONFIGURATION_ERROR') {
        context.error('Leletke profile authentication configuration error.');
        return response(503, 'authentication_not_configured', 'A biztonságos API-hitelesítés beállítása még nem teljes.');
      }
      if (error instanceof DatabaseConfigurationError || error?.code === 'DATABASE_CONFIGURATION_ERROR') {
        context.error('Leletke profile database configuration error.');
        return response(503, 'database_not_configured', 'Az adatbázis-kapcsolat beállítása még nem teljes.');
      }
      context.error('Leletke profile save failed:', error?.code || error?.name || 'UNKNOWN');
      return response(503, 'profile_save_unavailable', 'A profil mentése jelenleg nem sikerült. Próbáld újra később.');
    }
  }
});
