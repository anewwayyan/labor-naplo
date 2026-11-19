'use strict';

const { app } = require('@azure/functions');
const { authenticateRequest, UnauthorizedError, AuthConfigurationError } = require('../lib/auth');
const { withUserDatabaseContext, DatabaseConfigurationError } = require('../lib/database');

class HealthRecordValidationError extends Error {
  constructor(message) { super(message); this.code = 'HEALTH_RECORD_VALIDATION_ERROR'; }
}

function response(status, error, message) {
  return { status, headers: { 'Cache-Control': 'no-store' }, jsonBody: error ? { error, message } : message };
}

function unauthorizedResponse() {
  return {
    status: 401,
    headers: { 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Bearer' },
    jsonBody: { error: 'unauthorized', message: 'Érvényes bejelentkezés szükséges.' }
  };
}

function normalizeText(value, field, maxLength, required = false) {
  if (value === null && !required) return null;
  if (typeof value !== 'string') throw new HealthRecordValidationError(field + ' must be a string' + (required ? '.' : ' or null.'));
  const normalized = value.trim();
  if (required && !normalized) throw new HealthRecordValidationError(field + ' is required.');
  if (normalized.length > maxLength) throw new HealthRecordValidationError(field + ' is too long.');
  return normalized || (required ? '' : null);
}

function normalizeDate(value, field) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HealthRecordValidationError(field + ' must use YYYY-MM-DD format or null.');
  }
  const parsed = new Date(value + 'T00:00:00.000Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HealthRecordValidationError(field + ' is not a valid calendar date.');
  }
  return value;
}

function normalizeGuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new HealthRecordValidationError('A valid record ID is required.');
  }
  return value;
}

function validateBody(body, config, partial) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HealthRecordValidationError('A JSON object is required.');
  const keys = Object.keys(body);
  if (!keys.length) throw new HealthRecordValidationError('At least one field is required.');
  for (const key of keys) if (!config.fields[key]) throw new HealthRecordValidationError('Unknown field: ' + key + '.');
  if (!partial && !Object.prototype.hasOwnProperty.call(body, config.requiredField)) {
    throw new HealthRecordValidationError(config.requiredField + ' is required.');
  }

  const values = {};
  for (const key of keys) {
    const field = config.fields[key];
    const value = body[key];
    if (field.type === 'text') values[key] = normalizeText(value, key, field.maxLength, field.required === true);
    else if (field.type === 'date') values[key] = normalizeDate(value, key);
    else if (field.type === 'boolean') {
      if (typeof value !== 'boolean') throw new HealthRecordValidationError(key + ' must be true or false.');
      values[key] = value;
    } else if (field.type === 'enum') {
      if (value === null && field.nullable) values[key] = null;
      else if (typeof value !== 'string' || !field.values.includes(value)) throw new HealthRecordValidationError(key + ' has an unsupported value.');
      else values[key] = value;
    }
  }
  return values;
}

function bindValue(request, sql, key, field, value) {
  if (field.type === 'text') request.input(key, sql.NVarChar(field.maxLength), value);
  else if (field.type === 'date') request.input(key, sql.Date, value);
  else if (field.type === 'boolean') request.input(key, sql.Bit, value);
  else if (field.type === 'enum') request.input(key, sql.NVarChar(field.maxLength || 30), value);
}

function registerCollection(config) {
  const selectColumns = Object.entries(config.fields).map(([apiName, field]) => field.column + ' AS ' + apiName).join(',\n              ');
  const idColumn = config.idColumn;

  async function run(request, context, operation) {
    try {
      const user = await authenticateRequest(request);
      return await withUserDatabaseContext(user, ({ sql, transaction }) => operation({ sql, transaction, user }));
    } catch (error) {
      if (error instanceof HealthRecordValidationError || error?.code === 'HEALTH_RECORD_VALIDATION_ERROR') return response(400, 'invalid_health_record', error.message);
      if (error instanceof UnauthorizedError || error?.code === 'UNAUTHORIZED') return unauthorizedResponse();
      if (error instanceof AuthConfigurationError || error?.code === 'AUTH_CONFIGURATION_ERROR') {
        context.error('Leletke health-record authentication configuration error.');
        return response(503, 'authentication_not_configured', 'A biztonságos API-hitelesítés beállítása még nem teljes.');
      }
      if (error instanceof DatabaseConfigurationError || error?.code === 'DATABASE_CONFIGURATION_ERROR') {
        context.error('Leletke health-record database configuration error.');
        return response(503, 'database_not_configured', 'Az adatbázis-kapcsolat beállítása még nem teljes.');
      }
      if (error?.number === 547) return response(400, 'invalid_health_record', 'A megadott adatok ellentmondanak az adatbázis szabályainak.');
      context.error('Leletke health-record operation failed:', error?.code || error?.name || 'UNKNOWN');
      return response(503, 'health_record_unavailable', 'A művelet jelenleg nem sikerült. Próbáld újra később.');
    }
  }

  app.http('list' + config.name, {
    methods: ['GET'], authLevel: 'anonymous', route: config.route,
    handler: async (request, context) => run(request, context, async ({ sql, transaction }) => {
      const result = await new sql.Request(transaction).query(\`
        SELECT ${idColumn} AS id, ${selectColumns},
               CreatedAt AS createdAt, UpdatedAt AS updatedAt
        FROM dbo.${config.table}
        ORDER BY ${config.orderBy};
      \`);
      return response(200, null, { items: result.recordset || [] });
    })
  });

  app.http('get' + config.name, {
    methods: ['GET'], authLevel: 'anonymous', route: config.route + '/{id}',
    handler: async (request, context) => run(request, context, async ({ sql, transaction }) => {
      const id = normalizeGuid(request.params.id);
      const result = await new sql.Request(transaction).input('id', sql.UniqueIdentifier, id).query(\`
        SELECT ${idColumn} AS id, ${selectColumns},
               CreatedAt AS createdAt, UpdatedAt AS updatedAt
        FROM dbo.${config.table}
        WHERE ${idColumn} = @id;
      \`);
      const item = result.recordset?.[0];
      return item ? response(200, null, { item }) : response(404, 'not_found', 'A keresett rekord nem található.');
    })
  });

  app.http('create' + config.name, {
    methods: ['POST'], authLevel: 'anonymous', route: config.route,
    handler: async (request, context) => run(request, context, async ({ sql, transaction, user }) => {
      let body;
      try { body = await request.json(); } catch { throw new HealthRecordValidationError('Érvényes JSON-kérés szükséges.'); }
      const values = validateBody(body, config, false);

      // Child records reference UserProfiles. Create the empty profile root on first use.
      await new sql.Request(transaction)
        .input('tenantId', sql.UniqueIdentifier, user.tenantId)
        .input('ownerUserId', sql.UniqueIdentifier, user.userId)
        .query(\`
          IF NOT EXISTS (SELECT 1 FROM dbo.UserProfiles WHERE TenantId = @tenantId AND OwnerUserId = @ownerUserId)
          BEGIN
            INSERT INTO dbo.UserProfiles (TenantId, OwnerUserId) VALUES (@tenantId, @ownerUserId);
          END;
        \`);

      const insertRequest = new sql.Request(transaction)
        .input('tenantId', sql.UniqueIdentifier, user.tenantId)
        .input('ownerUserId', sql.UniqueIdentifier, user.userId);
      const columns = ['TenantId', 'OwnerUserId'];
      const parameters = ['@tenantId', '@ownerUserId'];
      for (const [key, value] of Object.entries(values)) {
        const field = config.fields[key];
        bindValue(insertRequest, sql, key, field, value);
        columns.push(field.column);
        parameters.push('@' + key);
      }

      const inserted = await insertRequest.query(\`
        INSERT INTO dbo.${config.table} (${columns.join(', ')})
        OUTPUT INSERTED.${idColumn} AS id
        VALUES (${parameters.join(', ')});
      \`);
      const id = inserted.recordset?.[0]?.id;
      const saved = await new sql.Request(transaction).input('id', sql.UniqueIdentifier, id).query(\`
        SELECT ${idColumn} AS id, ${selectColumns},
               CreatedAt AS createdAt, UpdatedAt AS updatedAt
        FROM dbo.${config.table} WHERE ${idColumn} = @id;
      \`);
      return response(201, null, { created: true, item: saved.recordset?.[0] || null });
    })
  });

  app.http('update' + config.name, {
    methods: ['PUT'], authLevel: 'anonymous', route: config.route + '/{id}',
    handler: async (request, context) => run(request, context, async ({ sql, transaction }) => {
      const id = normalizeGuid(request.params.id);
      let body;
      try { body = await request.json(); } catch { throw new HealthRecordValidationError('Érvényes JSON-kérés szükséges.'); }
      const values = validateBody(body, config, true);
      const updateRequest = new sql.Request(transaction).input('id', sql.UniqueIdentifier, id);
      const assignments = [];
      for (const [key, value] of Object.entries(values)) {
        const field = config.fields[key];
        bindValue(updateRequest, sql, key, field, value);
        assignments.push(field.column + ' = @' + key);
      }
      assignments.push('UpdatedAt = SYSUTCDATETIME()');
      const updated = await updateRequest.query(\`
        UPDATE dbo.${config.table}
        SET ${assignments.join(', ')}
        OUTPUT INSERTED.${idColumn} AS id
        WHERE ${idColumn} = @id;
      \`);
      if (!updated.recordset?.length) return response(404, 'not_found', 'A keresett rekord nem található.');

      const saved = await new sql.Request(transaction).input('id', sql.UniqueIdentifier, id).query(\`
        SELECT ${idColumn} AS id, ${selectColumns},
               CreatedAt AS createdAt, UpdatedAt AS updatedAt
        FROM dbo.${config.table} WHERE ${idColumn} = @id;
      \`);
      return response(200, null, { updated: true, item: saved.recordset?.[0] || null });
    })
  });

  app.http('delete' + config.name, {
    methods: ['DELETE'], authLevel: 'anonymous', route: config.route + '/{id}',
    handler: async (request, context) => run(request, context, async ({ sql, transaction }) => {
      const id = normalizeGuid(request.params.id);
      const deleted = await new sql.Request(transaction).input('id', sql.UniqueIdentifier, id).query(\`
        DELETE FROM dbo.${config.table}
        OUTPUT DELETED.${idColumn} AS id
        WHERE ${idColumn} = @id;
      \`);
      return deleted.recordset?.length ? response(200, null, { deleted: true }) : response(404, 'not_found', 'A keresett rekord nem található.');
    })
  });
}

registerCollection({
  name: 'Medications', route: 'medications', table: 'Medications',
  idColumn: 'MedicationId', orderBy: 'IsActive DESC, UpdatedAt DESC', requiredField: 'name',
  fields: {
    name: { column: 'Name', type: 'text', maxLength: 200, required: true },
    activeIngredient: { column: 'ActiveIngredient', type: 'text', maxLength: 200 },
    dose: { column: 'Dose', type: 'text', maxLength: 100 },
    frequency: { column: 'Frequency', type: 'text', maxLength: 200 },
    instructions: { column: 'Instructions', type: 'text', maxLength: 1000 },
    startDate: { column: 'StartDate', type: 'date' },
    endDate: { column: 'EndDate', type: 'date' },
    isActive: { column: 'IsActive', type: 'boolean' }
  }
});

registerCollection({
  name: 'Allergies', route: 'allergies', table: 'Allergies',
  idColumn: 'AllergyId', orderBy: 'Substance ASC', requiredField: 'substance',
  fields: {
    substance: { column: 'Substance', type: 'text', maxLength: 200, required: true },
    reaction: { column: 'Reaction', type: 'text', maxLength: 1000 },
    severity: { column: 'Severity', type: 'enum', maxLength: 30, nullable: true, values: ['Mild', 'Moderate', 'Severe', 'Unknown'] },
    notes: { column: 'Notes', type: 'text', maxLength: 1000 }
  }
});
