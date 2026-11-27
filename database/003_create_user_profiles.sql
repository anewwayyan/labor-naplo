/*
Leletke - user profile and health background schema
Migration: 003_create_user_profiles.sql
Target: labor-naplo-db

Prerequisites:
- 001_create_schema.sql and 002_enable_row_level_security.sql have been run.
- Security.fn_LabOwnerPredicate and labornaplo_app_role exist.
- The Functions API derives TenantId and OwnerUserId only from the validated
  Entra External ID token and sets tenant_id / owner_user_id in SESSION_CONTEXT
  on the same request-scoped SQL connection before any query.

This migration creates a profile root row and separate extensible collections
for health conditions, medical events, medications and allergies. All personal
rows are isolated by the existing tenant + owner RLS predicate.

This migration does not insert sample or real user data and is not executed
automatically by GitHub Actions.
*/

SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.UserProfiles', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserProfiles
    (
        TenantId          uniqueidentifier NOT NULL,
        OwnerUserId       uniqueidentifier NOT NULL,
        FirstName         nvarchar(100) NULL,
        PreferredName     nvarchar(100) NULL,
        GreetingEnabled   bit NOT NULL CONSTRAINT DF_UserProfiles_GreetingEnabled DEFAULT (1),
        DateOfBirth       date NULL,
        Sex               nvarchar(30) NULL,
        CreatedAt         datetime2(3) NOT NULL CONSTRAINT DF_UserProfiles_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt         datetime2(3) NOT NULL CONSTRAINT DF_UserProfiles_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        RowVersion        rowversion NOT NULL,

        CONSTRAINT PK_UserProfiles PRIMARY KEY (TenantId, OwnerUserId)
    );
END;

IF OBJECT_ID(N'dbo.HealthConditions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.HealthConditions
    (
        HealthConditionId uniqueidentifier NOT NULL CONSTRAINT DF_HealthConditions_Id DEFAULT (NEWSEQUENTIALID()),
        TenantId          uniqueidentifier NOT NULL,
        OwnerUserId       uniqueidentifier NOT NULL,
        Name              nvarchar(200) NOT NULL,
        Details           nvarchar(2000) NULL,
        Status            nvarchar(30) NOT NULL CONSTRAINT DF_HealthConditions_Status DEFAULT (N'Active'),
        DiagnosedDate     date NULL,
        ResolvedDate      date NULL,
        CreatedAt         datetime2(3) NOT NULL CONSTRAINT DF_HealthConditions_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt         datetime2(3) NOT NULL CONSTRAINT DF_HealthConditions_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        RowVersion        rowversion NOT NULL,

        CONSTRAINT PK_HealthConditions PRIMARY KEY (HealthConditionId),
        CONSTRAINT FK_HealthConditions_UserProfiles
            FOREIGN KEY (TenantId, OwnerUserId)
            REFERENCES dbo.UserProfiles (TenantId, OwnerUserId),
        CONSTRAINT CK_HealthConditions_Status
            CHECK (Status IN (N'Active', N'Resolved', N'Historical')),
        CONSTRAINT CK_HealthConditions_Dates
            CHECK (ResolvedDate IS NULL OR DiagnosedDate IS NULL OR ResolvedDate >= DiagnosedDate)
    );
END;

IF OBJECT_ID(N'dbo.MedicalEvents', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MedicalEvents
    (
        MedicalEventId    uniqueidentifier NOT NULL CONSTRAINT DF_MedicalEvents_Id DEFAULT (NEWSEQUENTIALID()),
        TenantId          uniqueidentifier NOT NULL,
        OwnerUserId       uniqueidentifier NOT NULL,
        EventType         nvarchar(30) NOT NULL CONSTRAINT DF_MedicalEvents_EventType DEFAULT (N'Other'),
        Title             nvarchar(200) NOT NULL,
        Details           nvarchar(2000) NULL,
        EventDate         date NULL,
        Facility          nvarchar(200) NULL,
        CreatedAt         datetime2(3) NOT NULL CONSTRAINT DF_MedicalEvents_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt         datetime2(3) NOT NULL CONSTRAINT DF_MedicalEvents_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        RowVersion        rowversion NOT NULL,

        CONSTRAINT PK_MedicalEvents PRIMARY KEY (MedicalEventId),
        CONSTRAINT FK_MedicalEvents_UserProfiles
            FOREIGN KEY (TenantId, OwnerUserId)
            REFERENCES dbo.UserProfiles (TenantId, OwnerUserId),
        CONSTRAINT CK_MedicalEvents_EventType
            CHECK (EventType IN (N'Surgery', N'Hospitalization', N'Examination', N'Other'))
    );
END;

IF OBJECT_ID(N'dbo.Medications', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Medications
    (
        MedicationId      uniqueidentifier NOT NULL CONSTRAINT DF_Medications_Id DEFAULT (NEWSEQUENTIALID()),
        TenantId          uniqueidentifier NOT NULL,
        OwnerUserId       uniqueidentifier NOT NULL,
        Name              nvarchar(200) NOT NULL,
        ActiveIngredient  nvarchar(200) NULL,
        Dose              nvarchar(100) NULL,
        Frequency         nvarchar(200) NULL,
        Instructions      nvarchar(1000) NULL,
        StartDate         date NULL,
        EndDate           date NULL,
        IsActive          bit NOT NULL CONSTRAINT DF_Medications_IsActive DEFAULT (1),
        CreatedAt         datetime2(3) NOT NULL CONSTRAINT DF_Medications_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt         datetime2(3) NOT NULL CONSTRAINT DF_Medications_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        RowVersion        rowversion NOT NULL,

        CONSTRAINT PK_Medications PRIMARY KEY (MedicationId),
        CONSTRAINT FK_Medications_UserProfiles
            FOREIGN KEY (TenantId, OwnerUserId)
            REFERENCES dbo.UserProfiles (TenantId, OwnerUserId),
        CONSTRAINT CK_Medications_Dates
            CHECK (EndDate IS NULL OR StartDate IS NULL OR EndDate >= StartDate)
    );
END;

IF OBJECT_ID(N'dbo.Allergies', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Allergies
    (
        AllergyId         uniqueidentifier NOT NULL CONSTRAINT DF_Allergies_Id DEFAULT (NEWSEQUENTIALID()),
        TenantId          uniqueidentifier NOT NULL,
        OwnerUserId       uniqueidentifier NOT NULL,
        Substance         nvarchar(200) NOT NULL,
        Reaction          nvarchar(1000) NULL,
        Severity          nvarchar(30) NULL,
        Notes             nvarchar(1000) NULL,
        CreatedAt         datetime2(3) NOT NULL CONSTRAINT DF_Allergies_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt         datetime2(3) NOT NULL CONSTRAINT DF_Allergies_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        RowVersion        rowversion NOT NULL,

        CONSTRAINT PK_Allergies PRIMARY KEY (AllergyId),
        CONSTRAINT FK_Allergies_UserProfiles
            FOREIGN KEY (TenantId, OwnerUserId)
            REFERENCES dbo.UserProfiles (TenantId, OwnerUserId),
        CONSTRAINT CK_Allergies_Severity
            CHECK (Severity IS NULL OR Severity IN (N'Mild', N'Moderate', N'Severe', N'Unknown'))
    );
END;

/* Supporting indexes for the user's profile collections. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_HealthConditions_Owner_UpdatedAt' AND object_id = OBJECT_ID(N'dbo.HealthConditions'))
    CREATE INDEX IX_HealthConditions_Owner_UpdatedAt
        ON dbo.HealthConditions (TenantId, OwnerUserId, UpdatedAt DESC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_MedicalEvents_Owner_EventDate' AND object_id = OBJECT_ID(N'dbo.MedicalEvents'))
    CREATE INDEX IX_MedicalEvents_Owner_EventDate
        ON dbo.MedicalEvents (TenantId, OwnerUserId, EventDate DESC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Medications_Owner_IsActive' AND object_id = OBJECT_ID(N'dbo.Medications'))
    CREATE INDEX IX_Medications_Owner_IsActive
        ON dbo.Medications (TenantId, OwnerUserId, IsActive);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Allergies_Owner_Substance' AND object_id = OBJECT_ID(N'dbo.Allergies'))
    CREATE INDEX IX_Allergies_Owner_Substance
        ON dbo.Allergies (TenantId, OwnerUserId, Substance);

/* Grant only the operations needed by the authenticated API. */
GRANT SELECT, INSERT ON OBJECT::dbo.UserProfiles TO [labornaplo_app_role];
GRANT UPDATE (FirstName, PreferredName, GreetingEnabled, DateOfBirth, Sex, UpdatedAt)
    ON OBJECT::dbo.UserProfiles TO [labornaplo_app_role];

GRANT SELECT, INSERT, DELETE ON OBJECT::dbo.HealthConditions TO [labornaplo_app_role];
GRANT UPDATE (Name, Details, Status, DiagnosedDate, ResolvedDate, UpdatedAt)
    ON OBJECT::dbo.HealthConditions TO [labornaplo_app_role];

GRANT SELECT, INSERT, DELETE ON OBJECT::dbo.MedicalEvents TO [labornaplo_app_role];
GRANT UPDATE (EventType, Title, Details, EventDate, Facility, UpdatedAt)
    ON OBJECT::dbo.MedicalEvents TO [labornaplo_app_role];

GRANT SELECT, INSERT, DELETE ON OBJECT::dbo.Medications TO [labornaplo_app_role];
GRANT UPDATE (Name, ActiveIngredient, Dose, Frequency, Instructions, StartDate, EndDate, IsActive, UpdatedAt)
    ON OBJECT::dbo.Medications TO [labornaplo_app_role];

GRANT SELECT, INSERT, DELETE ON OBJECT::dbo.Allergies TO [labornaplo_app_role];
GRANT UPDATE (Substance, Reaction, Severity, Notes, UpdatedAt)
    ON OBJECT::dbo.Allergies TO [labornaplo_app_role];

/* TenantId and OwnerUserId are deliberately excluded from UPDATE grants.
   The API can change profile content, but cannot transfer row ownership. */

/* Dedicated policy keeps the existing laboratory policy untouched. */
IF NOT EXISTS
(
    SELECT 1
    FROM sys.security_policies
    WHERE name = N'ProfileOwnerIsolation'
      AND schema_id = SCHEMA_ID(N'Security')
)
BEGIN
    DECLARE @profilePolicySql nvarchar(max) = N'
CREATE SECURITY POLICY [Security].[ProfileOwnerIsolation]
    ADD FILTER PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[UserProfiles],
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[UserProfiles] AFTER INSERT,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[UserProfiles] BEFORE UPDATE,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[UserProfiles] AFTER UPDATE,

    ADD FILTER PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[HealthConditions],
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[HealthConditions] AFTER INSERT,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[HealthConditions] BEFORE UPDATE,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[HealthConditions] AFTER UPDATE,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[HealthConditions] BEFORE DELETE,

    ADD FILTER PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[MedicalEvents],
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[MedicalEvents] AFTER INSERT,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[MedicalEvents] BEFORE UPDATE,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[MedicalEvents] AFTER UPDATE,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[MedicalEvents] BEFORE DELETE,

    ADD FILTER PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[Medications],
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[Medications] AFTER INSERT,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[Medications] BEFORE UPDATE,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[Medications] AFTER UPDATE,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[Medications] BEFORE DELETE,

    ADD FILTER PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[Allergies],
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[Allergies] AFTER INSERT,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[Allergies] BEFORE UPDATE,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[Allergies] AFTER UPDATE,
    ADD BLOCK PREDICATE [Security].[fn_LabOwnerPredicate]([TenantId], [OwnerUserId])
        ON [dbo].[Allergies] BEFORE DELETE
WITH (STATE = ON, SCHEMABINDING = ON);';
    EXEC sys.sp_executesql @profilePolicySql;
END
ELSE IF EXISTS
(
    SELECT 1
    FROM sys.security_policies
    WHERE name = N'ProfileOwnerIsolation'
      AND schema_id = SCHEMA_ID(N'Security')
      AND is_enabled = 0
)
BEGIN
    THROW 51003, 'The existing profile RLS policy is disabled. Review it manually before rerunning this migration.', 1;
END;

COMMIT TRANSACTION;
