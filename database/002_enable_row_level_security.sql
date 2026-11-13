/*
LaborNapló - Row-Level Security and application permissions
Target: labor-naplo-db
Branch: feature/azure-functions-api

Prerequisite:
- Run database/001_create_schema.sql first.
- The external database user [labor-naplo-api] must already exist.
- The Functions API must use a request-scoped SQL pool, set both session
  context keys with @read_only = 1 on the transaction's connection, and close
  that pool before completing the HTTP request.

This migration enables RLS for all user-owned tables. Missing or malformed
SESSION_CONTEXT values fail closed for the application principal.
The database administrator / separate maintenance principals are not filtered;
only [labor-naplo-api] is subject to the tenant-owner predicate.

The app role has no hard-delete permission. Report deletion is a separate
DeletePending + maintenance workflow so SQL and Blob Storage cleanup can be
retried safely. LabValueHistory is append-only for the app role.
*/

SET XACT_ABORT ON;

BEGIN TRANSACTION;

IF DATABASE_PRINCIPAL_ID(N'labor-naplo-api') IS NULL
    THROW 51000, 'Database user [labor-naplo-api] does not exist.', 1;

IF OBJECT_ID(N'dbo.LabReports', N'U') IS NULL
   OR OBJECT_ID(N'dbo.ExtractedLabValues', N'U') IS NULL
   OR OBJECT_ID(N'dbo.LabValues', N'U') IS NULL
   OR OBJECT_ID(N'dbo.LabValueHistory', N'U') IS NULL
   OR OBJECT_ID(N'dbo.LabParameters', N'U') IS NULL
   OR OBJECT_ID(N'dbo.LabParameterAliases', N'U') IS NULL
    THROW 51001, 'Run the initial schema migration before enabling RLS.', 1;

IF DATABASE_PRINCIPAL_ID(N'labornaplo_app_role') IS NULL
    CREATE ROLE [labornaplo_app_role] AUTHORIZATION [dbo];

IF NOT EXISTS
(
    SELECT 1
    FROM sys.database_role_members
    WHERE role_principal_id = DATABASE_PRINCIPAL_ID(N'labornaplo_app_role')
      AND member_principal_id = DATABASE_PRINCIPAL_ID(N'labor-naplo-api')
)
    ALTER ROLE [labornaplo_app_role] ADD MEMBER [labor-naplo-api];

IF SCHEMA_ID(N'Security') IS NULL
    EXEC(N'CREATE SCHEMA [Security] AUTHORIZATION [dbo];');

IF OBJECT_ID(N'Security.fn_LabOwnerPredicate', N'IF') IS NULL
BEGIN
    DECLARE @functionSql nvarchar(max) = N'
CREATE FUNCTION [Security].[fn_LabOwnerPredicate]
(
    @TenantId uniqueidentifier,
    @OwnerUserId uniqueidentifier
)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
(
    SELECT 1 AS [access_result]
    WHERE
        DATABASE_PRINCIPAL_ID() <> DATABASE_PRINCIPAL_ID(N''labor-naplo-api'')
        OR
        (
            @TenantId = TRY_CONVERT(uniqueidentifier, SESSION_CONTEXT(N''tenant_id''))
            AND
            @OwnerUserId = TRY_CONVERT(uniqueidentifier, SESSION_CONTEXT(N''owner_user_id''))
        )
);';
    EXEC sys.sp_executesql @functionSql;
END;

GRANT SELECT, INSERT, UPDATE ON OBJECT::dbo.LabReports TO [labornaplo_app_role];
GRANT SELECT, INSERT, UPDATE ON OBJECT::dbo.ExtractedLabValues TO [labornaplo_app_role];
GRANT SELECT, INSERT, UPDATE ON OBJECT::dbo.LabValues TO [labornaplo_app_role];
GRANT SELECT, INSERT ON OBJECT::dbo.LabValueHistory TO [labornaplo_app_role];
GRANT SELECT ON OBJECT::dbo.LabParameters TO [labornaplo_app_role];
GRANT SELECT ON OBJECT::dbo.LabParameterAliases TO [labornaplo_app_role];

DENY UPDATE (TenantId, OwnerUserId) ON OBJECT::dbo.LabReports TO [labornaplo_app_role];
DENY UPDATE (TenantId, OwnerUserId) ON OBJECT::dbo.ExtractedLabValues TO [labornaplo_app_role];
DENY UPDATE (TenantId, OwnerUserId) ON OBJECT::dbo.LabValues TO [labornaplo_app_role];
DENY UPDATE (TenantId, OwnerUserId, ChangedByUserId) ON OBJECT::dbo.LabValueHistory TO [labornaplo_app_role];

DENY DELETE ON OBJECT::dbo.LabReports TO [labornaplo_app_role];
DENY DELETE ON OBJECT::dbo.ExtractedLabValues TO [labornaplo_app_role];
DENY DELETE ON OBJECT::dbo.LabValues TO [labornaplo_app_role];
DENY UPDATE, DELETE ON OBJECT::dbo.LabValueHistory TO [labornaplo_app_role];

IF NOT EXISTS
(
    SELECT 1
    FROM sys.security_policies
    WHERE name = N'LabOwnerIsolation'
      AND schema_id = SCHEMA_ID(N'Security')
)
BEGIN
    DECLARE @policySql nvarchar(max) = N'
CREATE SECURITY POLICY [Security].[LabOwnerIsolation]
    ADD FILTER PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[LabReports],
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[LabReports] AFTER INSERT,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[LabReports] BEFORE UPDATE,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[LabReports] AFTER UPDATE,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[LabReports] BEFORE DELETE,

    ADD FILTER PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[ExtractedLabValues],
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[ExtractedLabValues] AFTER INSERT,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[ExtractedLabValues] BEFORE UPDATE,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[ExtractedLabValues] AFTER UPDATE,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[ExtractedLabValues] BEFORE DELETE,

    ADD FILTER PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[LabValues],
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[LabValues] AFTER INSERT,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[LabValues] BEFORE UPDATE,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[LabValues] AFTER UPDATE,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[LabValues] BEFORE DELETE,

    ADD FILTER PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[LabValueHistory],
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[LabValueHistory] AFTER INSERT,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[LabValueHistory] BEFORE UPDATE,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[LabValueHistory] AFTER UPDATE,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[LabValueHistory] BEFORE DELETE
WITH (STATE = ON, SCHEMABINDING = ON);';
    EXEC sys.sp_executesql @policySql;
END
ELSE
BEGIN
    IF EXISTS
    (
        SELECT 1
        FROM sys.security_policies
        WHERE name = N'LabOwnerIsolation'
          AND schema_id = SCHEMA_ID(N'Security')
          AND is_enabled = 0
    )
        THROW 51002, 'The existing RLS policy is disabled. Review it manually before rerunning this migration.', 1;
END;

COMMIT TRANSACTION;
