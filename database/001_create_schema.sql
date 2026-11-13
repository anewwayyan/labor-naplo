/*
LaborNapló - initial Azure SQL schema
Target: labor-naplo-db
Branch: feature/azure-functions-api

This migration creates the six core tables, constraints and indexes.
It does NOT enable Row-Level Security or grant database permissions.

Security rollout is intentionally separate:
1. The Functions API must derive tenant_id and owner_user_id only from its
   already-validated Entra External ID token.
2. It must set SESSION_CONTEXT on the exact SQL connection used by the query.
3. It must clear both values in a finally block before returning a pooled
   connection. If cleanup fails, the connection must be discarded, not reused.
4. Only then should the RLS predicate and security policy be enabled and tested.

SESSION_CONTEXT values are not cryptographically protected: any database
principal able to execute sp_set_session_context can set them. RLS is therefore
defense in depth; API authorization, parameterized SQL and least privilege
remain mandatory.

PDF bytes are stored in private Blob Storage. BlobName is a server-generated
object name, not a user-supplied path.
*/

SET XACT_ABORT ON;

BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.LabParameters', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.LabParameters
    (
        ParameterId       int IDENTITY(1,1) NOT NULL,
        CanonicalName     nvarchar(150) NOT NULL,
        NormalizedName    nvarchar(150) NOT NULL,
        IsActive          bit NOT NULL CONSTRAINT DF_LabParameters_IsActive DEFAULT (1),
        CreatedAt         datetime2(3) NOT NULL CONSTRAINT DF_LabParameters_CreatedAt DEFAULT (SYSUTCDATETIME()),

        CONSTRAINT PK_LabParameters PRIMARY KEY (ParameterId),
        CONSTRAINT UQ_LabParameters_NormalizedName UNIQUE (NormalizedName)
    );
END;

IF OBJECT_ID(N'dbo.LabParameterAliases', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.LabParameterAliases
    (
        AliasId           int IDENTITY(1,1) NOT NULL,
        ParameterId       int NOT NULL,
        AliasName         nvarchar(150) NOT NULL,
        NormalizedAlias   nvarchar(150) NOT NULL,
        LanguageCode      nvarchar(10) NULL,
        CreatedAt         datetime2(3) NOT NULL CONSTRAINT DF_LabParameterAliases_CreatedAt DEFAULT (SYSUTCDATETIME()),

        CONSTRAINT PK_LabParameterAliases PRIMARY KEY (AliasId),
        CONSTRAINT FK_LabParameterAliases_LabParameters
            FOREIGN KEY (ParameterId) REFERENCES dbo.LabParameters(ParameterId),
        CONSTRAINT UQ_LabParameterAliases_NormalizedAlias UNIQUE (NormalizedAlias)
    );
END;

IF OBJECT_ID(N'dbo.LabReports', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.LabReports
    (
        ReportId          uniqueidentifier NOT NULL CONSTRAINT DF_LabReports_ReportId DEFAULT (NEWSEQUENTIALID()),
        TenantId          uniqueidentifier NOT NULL,
        OwnerUserId       nvarchar(255) NOT NULL,
        LabName           nvarchar(200) NULL,
        SampleDate        date NULL,
        OriginalFileName  nvarchar(260) NOT NULL,
        BlobName          nvarchar(512) NOT NULL,
        ContentType       varchar(100) NOT NULL CONSTRAINT DF_LabReports_ContentType DEFAULT ('application/pdf'),
        FileSizeBytes     bigint NOT NULL,
        Status            nvarchar(20) NOT NULL CONSTRAINT DF_LabReports_Status DEFAULT (N'Draft'),
        CreatedAt         datetime2(3) NOT NULL CONSTRAINT DF_LabReports_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt         datetime2(3) NOT NULL CONSTRAINT DF_LabReports_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        ApprovedAt        datetime2(3) NULL,
        RowVersion        rowversion NOT NULL,

        CONSTRAINT PK_LabReports PRIMARY KEY (ReportId),
        CONSTRAINT UQ_LabReports_Owner_Report UNIQUE (TenantId, OwnerUserId, ReportId),
        CONSTRAINT UQ_LabReports_BlobName UNIQUE (BlobName),
        CONSTRAINT CK_LabReports_FileSize CHECK (FileSizeBytes > 0),
        CONSTRAINT CK_LabReports_PdfOnly CHECK (ContentType = 'application/pdf'),
        CONSTRAINT CK_LabReports_Status
            CHECK (Status IN (N'Draft', N'Review', N'Approved', N'DeletePending'))
    );
END;

IF OBJECT_ID(N'dbo.ExtractedLabValues', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ExtractedLabValues
    (
        ExtractedValueId      uniqueidentifier NOT NULL CONSTRAINT DF_ExtractedLabValues_Id DEFAULT (NEWSEQUENTIALID()),
        TenantId              uniqueidentifier NOT NULL,
        OwnerUserId           nvarchar(255) NOT NULL,
        ReportId              uniqueidentifier NOT NULL,
        SourcePageNumber      smallint NULL,
        RawParameterName      nvarchar(200) NOT NULL,
        RawValue              nvarchar(200) NOT NULL,
        ParsedNumericValue    decimal(18,6) NULL,
        Unit                  nvarchar(50) NULL,
        ReferenceRange        nvarchar(100) NULL,
        ReferenceLow          decimal(18,6) NULL,
        ReferenceHigh         decimal(18,6) NULL,
        IsAbnormal            bit NULL,
        ExtractionConfidence  decimal(5,4) NULL,
        CreatedAt             datetime2(3) NOT NULL CONSTRAINT DF_ExtractedLabValues_CreatedAt DEFAULT (SYSUTCDATETIME()),

        CONSTRAINT PK_ExtractedLabValues PRIMARY KEY (ExtractedValueId),
        CONSTRAINT UQ_ExtractedLabValues_Owner_Report_Id
            UNIQUE (TenantId, OwnerUserId, ReportId, ExtractedValueId),
        CONSTRAINT FK_ExtractedLabValues_LabReports
            FOREIGN KEY (TenantId, OwnerUserId, ReportId)
            REFERENCES dbo.LabReports (TenantId, OwnerUserId, ReportId),
        CONSTRAINT CK_ExtractedLabValues_Page
            CHECK (SourcePageNumber IS NULL OR SourcePageNumber > 0),
        CONSTRAINT CK_ExtractedLabValues_Confidence
            CHECK (ExtractionConfidence IS NULL OR (ExtractionConfidence >= 0 AND ExtractionConfidence <= 1)),
        CONSTRAINT CK_ExtractedLabValues_ReferenceRange
            CHECK (ReferenceLow IS NULL OR ReferenceHigh IS NULL OR ReferenceLow <= ReferenceHigh)
    );
END;

IF OBJECT_ID(N'dbo.LabValues', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.LabValues
    (
        LabValueId            uniqueidentifier NOT NULL CONSTRAINT DF_LabValues_Id DEFAULT (NEWSEQUENTIALID()),
        TenantId              uniqueidentifier NOT NULL,
        OwnerUserId           nvarchar(255) NOT NULL,
        ReportId              uniqueidentifier NOT NULL,
        ExtractedValueId      uniqueidentifier NULL,
        ParameterId           int NULL,
        OriginalParameterName nvarchar(200) NOT NULL,
        ValueNumeric          decimal(18,6) NULL,
        ValueText             nvarchar(200) NULL,
        Unit                  nvarchar(50) NULL,
        ReferenceRange        nvarchar(100) NULL,
        ReferenceLow          decimal(18,6) NULL,
        ReferenceHigh         decimal(18,6) NULL,
        IsAbnormal            bit NULL,
        CreatedAt             datetime2(3) NOT NULL CONSTRAINT DF_LabValues_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt             datetime2(3) NOT NULL CONSTRAINT DF_LabValues_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        RowVersion            rowversion NOT NULL,

        CONSTRAINT PK_LabValues PRIMARY KEY (LabValueId),
        CONSTRAINT UQ_LabValues_Owner_Report_Id
            UNIQUE (TenantId, OwnerUserId, ReportId, LabValueId),
        CONSTRAINT FK_LabValues_LabReports
            FOREIGN KEY (TenantId, OwnerUserId, ReportId)
            REFERENCES dbo.LabReports (TenantId, OwnerUserId, ReportId),
        CONSTRAINT FK_LabValues_ExtractedLabValues
            FOREIGN KEY (TenantId, OwnerUserId, ReportId, ExtractedValueId)
            REFERENCES dbo.ExtractedLabValues (TenantId, OwnerUserId, ReportId, ExtractedValueId),
        CONSTRAINT FK_LabValues_LabParameters
            FOREIGN KEY (ParameterId) REFERENCES dbo.LabParameters(ParameterId),
        CONSTRAINT CK_LabValues_ExactlyOneValue
            CHECK (
                (ValueNumeric IS NOT NULL AND ValueText IS NULL)
                OR
                (ValueNumeric IS NULL AND ValueText IS NOT NULL)
            ),
        CONSTRAINT CK_LabValues_ReferenceRange
            CHECK (ReferenceLow IS NULL OR ReferenceHigh IS NULL OR ReferenceLow <= ReferenceHigh)
    );
END;

IF OBJECT_ID(N'dbo.LabValueHistory', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.LabValueHistory
    (
        HistoryId          bigint IDENTITY(1,1) NOT NULL,
        TenantId           uniqueidentifier NOT NULL,
        OwnerUserId        nvarchar(255) NOT NULL,
        ReportId           uniqueidentifier NOT NULL,
        LabValueId         uniqueidentifier NOT NULL,
        ChangeType         nvarchar(20) NOT NULL,
        ChangedByUserId    nvarchar(255) NOT NULL,
        OldSnapshotJson    nvarchar(max) NULL,
        NewSnapshotJson    nvarchar(max) NOT NULL,
        ChangedAt          datetime2(3) NOT NULL CONSTRAINT DF_LabValueHistory_ChangedAt DEFAULT (SYSUTCDATETIME()),

        CONSTRAINT PK_LabValueHistory PRIMARY KEY (HistoryId),
        CONSTRAINT FK_LabValueHistory_LabReports
            FOREIGN KEY (TenantId, OwnerUserId, ReportId)
            REFERENCES dbo.LabReports (TenantId, OwnerUserId, ReportId),
        CONSTRAINT CK_LabValueHistory_ChangeType
            CHECK (ChangeType IN (N'Created', N'Updated', N'Deleted', N'Approved')),
        CONSTRAINT CK_LabValueHistory_OldJson
            CHECK (OldSnapshotJson IS NULL OR ISJSON(OldSnapshotJson) = 1),
        CONSTRAINT CK_LabValueHistory_NewJson
            CHECK (ISJSON(NewSnapshotJson) = 1)
    );
END;

/* Supporting indexes for report lists, aliases, report values and trends. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LabReports_Owner_CreatedAt' AND object_id = OBJECT_ID(N'dbo.LabReports'))
    CREATE INDEX IX_LabReports_Owner_CreatedAt
        ON dbo.LabReports (TenantId, OwnerUserId, CreatedAt DESC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LabParameterAliases_ParameterId' AND object_id = OBJECT_ID(N'dbo.LabParameterAliases'))
    CREATE INDEX IX_LabParameterAliases_ParameterId
        ON dbo.LabParameterAliases (ParameterId);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ExtractedLabValues_Report' AND object_id = OBJECT_ID(N'dbo.ExtractedLabValues'))
    CREATE INDEX IX_ExtractedLabValues_Report
        ON dbo.ExtractedLabValues (TenantId, OwnerUserId, ReportId);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LabValues_Report' AND object_id = OBJECT_ID(N'dbo.LabValues'))
    CREATE INDEX IX_LabValues_Report
        ON dbo.LabValues (TenantId, OwnerUserId, ReportId);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LabValues_Trend' AND object_id = OBJECT_ID(N'dbo.LabValues'))
    CREATE INDEX IX_LabValues_Trend
        ON dbo.LabValues (TenantId, OwnerUserId, ParameterId, Unit);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LabValueHistory_Value_ChangedAt' AND object_id = OBJECT_ID(N'dbo.LabValueHistory'))
    CREATE INDEX IX_LabValueHistory_Value_ChangedAt
        ON dbo.LabValueHistory (TenantId, OwnerUserId, LabValueId, ChangedAt DESC);

COMMIT TRANSACTION;
