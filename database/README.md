# LaborNapló Azure SQL database setup

These scripts target the Azure SQL database `labor-naplo-db` on
`labor-naplo-sql.database.windows.net`.

## Deployment order

1. Deploy the Functions API from `feature/azure-functions-api` and confirm the
   GitHub Actions deployment succeeds.
2. In the Function App `labor-naplo-api`, add these application settings:
   - `AZURE_SQL_SERVER=labor-naplo-sql.database.windows.net`
   - `AZURE_SQL_DATABASE=labor-naplo-db`
   - Do not set `AZURE_SQL_CLIENT_ID` when using the Function App's
     system-assigned managed identity. It is optional only for a user-assigned
     identity.
3. Connect to `labor-naplo-db` as the Microsoft Entra administrator and run
   `001_create_schema.sql`.
4. Confirm the schema exists, then run `002_enable_row_level_security.sql`.
   This second migration creates the application role, grants the minimum
   table permissions and enables the RLS policy.
5. Call the authenticated endpoint
   `GET /api/db-check` with a valid LaborNapló API access token. A successful
   response confirms that the Function App connected using managed identity,
   set its read-only session context and queried only the reports visible to
   that user under RLS.

## Security notes

- The API derives `TenantId` and `OwnerUserId` from the verified token's
  `tid` and `oid` claims. It does not accept either value from request data.
- The API uses a one-connection pool per database operation and physically
  closes it after the transaction. This is deliberately conservative for the
  first version because the session-context keys are set read-only.
- The application role cannot hard-delete records. It cannot update ownership
  columns. `LabValueHistory` is append-only for the application role.
- RLS is defense in depth, not a replacement for token validation,
  parameterized SQL and least-privilege permissions.
- The current SQL Server network setting that allows Azure services to reach
  the server is a temporary development convenience. Revisit it before
  production; prefer private networking or a narrowly scoped network design.
- The database migration scripts are not automatically executed by GitHub
  Actions. Run them manually as the database administrator in the documented
  order. Do not run the RLS migration before the initial schema exists.
