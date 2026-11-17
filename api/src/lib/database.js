'use strict';

const sql = require('mssql');

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class DatabaseConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.code = 'DATABASE_CONFIGURATION_ERROR';
  }
}

function requireGuid(value, fieldName) {
  if (typeof value !== 'string' || !GUID_RE.test(value)) {
    throw new DatabaseConfigurationError(`Authenticated ${fieldName} is missing or is not a GUID.`);
  }
  return value.toLowerCase();
}

function getSafeErrorDetails(error) {
  return {
    name: error?.name || 'Error',
    code: error?.code || null,
    number: error?.number ?? null,
    state: error?.state ?? null,
    class: error?.class ?? null,
    lineNumber: error?.lineNumber ?? null,
    message: typeof error?.message === 'string'
      ? error.message.slice(0, 500)
      : 'No error message available.'
  };
}

function logDatabaseError(stage, error) {
  // Do not log access tokens, credentials, or connection configuration.
  console.error(`LaborNapló SQL ${stage}:`, JSON.stringify(getSafeErrorDetails(error)));
}

function createPoolConfig() {
  const server = (process.env.AZURE_SQL_SERVER || '').trim();
  const database = (process.env.AZURE_SQL_DATABASE || '').trim();

  if (!server || !database) {
    throw new DatabaseConfigurationError('AZURE_SQL_SERVER and AZURE_SQL_DATABASE must be configured.');
  }

  const authenticationOptions = {};
  const managedIdentityClientId = (process.env.AZURE_SQL_CLIENT_ID || '').trim();
  if (managedIdentityClientId) {
    authenticationOptions.clientId = managedIdentityClientId;
  }

  return {
    server,
    database,
    authentication: {
      type: 'azure-active-directory-msi-app-service',
      options: authenticationOptions
    },
    options: {
      encrypt: true,
      trustServerCertificate: false,
      appName: 'LaborNaplo-Functions-API'
    },
    connectionTimeout: 15000,
    requestTimeout: 30000,
    // This pool belongs to one authenticated operation only. It is never
    // cached or shared between users/requests, and is physically closed below.
    pool: {
      max: 1,
      min: 0,
      idleTimeoutMillis: 1000
    }
  };
}

/**
 * Execute one logical database operation under the authenticated user's RLS
 * context. The caller must pass the identity returned by authenticateRequest.
 *
 * SESSION_CONTEXT keys are read-only for this logical connection. A dedicated
 * one-connection pool is created for this operation and closed in finally,
 * preventing a different request from inheriting the context.
 */
async function withUserDatabaseContext(user, operation) {
  if (!user || typeof operation !== 'function') {
    throw new TypeError('A verified user and database operation are required.');
  }

  const tenantId = requireGuid(user.tenantId, 'tenantId');
  const ownerUserId = requireGuid(user.userId, 'userId');

  const pool = new sql.ConnectionPool(createPoolConfig());
  pool.on('error', (error) => {
    logDatabaseError('pool error', error);
  });

  const transaction = new sql.Transaction(pool);
  let transactionStarted = false;
  let result;
  let operationError;

  try {
    await pool.connect();
    await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
    transactionStarted = true;

    await new sql.Request(transaction)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('ownerUserId', sql.UniqueIdentifier, ownerUserId)
      .query(`
        EXEC sys.sp_set_session_context
          @key = N'tenant_id',
          @value = @tenantId,
          @read_only = 1;

        EXEC sys.sp_set_session_context
          @key = N'owner_user_id',
          @value = @ownerUserId,
          @read_only = 1;
      `);

    result = await operation({ sql, transaction });
    await transaction.commit();
    transactionStarted = false;
  } catch (error) {
    operationError = error;

    if (transactionStarted) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        logDatabaseError('transaction rollback failed', rollbackError);
      }
    }
  } finally {
    // Closing this operation-scoped pool closes its physical connection.
    // This is essential because read_only SESSION_CONTEXT cannot be changed
    // again on the same logical connection.
    try {
      await pool.close();
    } catch (closeError) {
      // A cleanup failure must not hide the actual SQL error or turn an
      // already successful database operation into a misleading 503.
      logDatabaseError('pool close failed', closeError);
    }
  }

  if (operationError) {
    logDatabaseError('operation failed', operationError);
    throw operationError;
  }

  return result;
}

module.exports = {
  withUserDatabaseContext,
  DatabaseConfigurationError
};
