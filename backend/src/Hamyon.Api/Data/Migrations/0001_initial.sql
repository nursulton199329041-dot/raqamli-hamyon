CREATE TABLE "Attachments" (
    "Id" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "JournalEntryId" uuid NOT NULL,
    "FileName" character varying(200) NOT NULL,
    "ContentType" character varying(100) NOT NULL,
    "Size" bigint NOT NULL,
    "Sha256" character varying(64) NOT NULL,
    "StorageKey" character varying(200) NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_Attachments" PRIMARY KEY ("Id")
);


CREATE TABLE "AuditLogs" (
    "Id" uuid NOT NULL,
    "UserId" uuid,
    "Action" character varying(80) NOT NULL,
    "EntityType" character varying(40),
    "EntityId" uuid,
    "Detail" character varying(2000),
    "Ip" character varying(64),
    "At" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_AuditLogs" PRIMARY KEY ("Id")
);


CREATE TABLE "Categories" (
    "Id" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "ParentId" uuid,
    "Name" character varying(80) NOT NULL,
    "Icon" text NOT NULL,
    "Color" text NOT NULL,
    "MonthlyLimit" numeric(19,4),
    "LimitCurrency" character varying(3),
    "IsArchived" boolean NOT NULL,
    "SortOrder" integer NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_Categories" PRIMARY KEY ("Id")
);


CREATE TABLE "Debts" (
    "Id" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "PersonId" uuid NOT NULL,
    "Direction" integer NOT NULL,
    "Currency" character varying(3) NOT NULL,
    "Principal" numeric(19,4) NOT NULL,
    "Outstanding" numeric(19,4) NOT NULL,
    "DueDate" timestamp with time zone,
    "Status" integer NOT NULL,
    "ProjectId" uuid,
    "Reason" text,
    "Note" text,
    "LedgerAccountId" uuid NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_Debts" PRIMARY KEY ("Id")
);


CREATE TABLE "IncomeSources" (
    "Id" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "Name" character varying(80) NOT NULL,
    "Icon" text NOT NULL,
    "Color" text NOT NULL,
    "IsArchived" boolean NOT NULL,
    "SortOrder" integer NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_IncomeSources" PRIMARY KEY ("Id")
);


CREATE TABLE "JournalEntries" (
    "Id" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "Type" integer NOT NULL,
    "OccurredAt" timestamp with time zone NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "Amount" numeric(19,4) NOT NULL,
    "Currency" character varying(3) NOT NULL,
    "WalletId" uuid,
    "ToWalletId" uuid,
    "ToAmount" numeric(19,4),
    "ToCurrency" character varying(3),
    "FxRate" numeric(19,8),
    "CategoryId" uuid,
    "IncomeSourceId" uuid,
    "PersonId" uuid,
    "ProjectId" uuid,
    "DebtId" uuid,
    "Reason" character varying(200),
    "Memo" character varying(1000),
    "IdempotencyKey" character varying(100) NOT NULL,
    "RequestFingerprint" character varying(64) NOT NULL,
    "ReversalOfId" uuid,
    "ReversedById" uuid,
    "ReplacesId" uuid,
    "ReversedAt" timestamp with time zone,
    CONSTRAINT "PK_JournalEntries" PRIMARY KEY ("Id")
);


CREATE TABLE "LedgerAccounts" (
    "Id" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "Kind" integer NOT NULL,
    "Currency" character varying(3) NOT NULL,
    "Name" character varying(120) NOT NULL,
    "RefId" uuid,
    "AllowNegative" boolean NOT NULL,
    "Balance" numeric(19,4) NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_LedgerAccounts" PRIMARY KEY ("Id")
);


CREATE TABLE "People" (
    "Id" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "Name" character varying(100) NOT NULL,
    "Phone" character varying(32),
    "Note" character varying(500),
    "CreatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_People" PRIMARY KEY ("Id")
);


CREATE TABLE "Projects" (
    "Id" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "Name" character varying(80) NOT NULL,
    "Icon" text NOT NULL,
    "Color" text NOT NULL,
    "Currency" character varying(3) NOT NULL,
    "Note" text,
    "IsArchived" boolean NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_Projects" PRIMARY KEY ("Id")
);


CREATE TABLE "RefreshTokens" (
    "Id" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "TokenHash" text NOT NULL,
    "FamilyId" uuid NOT NULL,
    "ExpiresAt" timestamp with time zone NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "UsedAt" timestamp with time zone,
    "RevokedAt" timestamp with time zone,
    CONSTRAINT "PK_RefreshTokens" PRIMARY KEY ("Id")
);


CREATE TABLE "Users" (
    "Id" uuid NOT NULL,
    "Email" character varying(254) NOT NULL,
    "NormalizedEmail" character varying(254) NOT NULL,
    "PasswordHash" text NOT NULL,
    "DisplayName" character varying(100) NOT NULL,
    "ExternalSubjectId" text,
    "ExternalIssuer" text,
    "Locale" character varying(8) NOT NULL,
    "DefaultCurrency" character varying(3) NOT NULL,
    "Theme" text NOT NULL,
    "FailedLoginCount" integer NOT NULL,
    "LockoutUntil" timestamp with time zone,
    "IsDemo" boolean NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_Users" PRIMARY KEY ("Id")
);


CREATE TABLE "Wallets" (
    "Id" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "Name" character varying(80) NOT NULL,
    "Type" integer NOT NULL,
    "Icon" character varying(40) NOT NULL,
    "Color" character varying(9) NOT NULL,
    "Currency" character varying(3) NOT NULL,
    "BankName" character varying(80),
    "MaskedNumber" character varying(24),
    "Note" character varying(500),
    "AllowOverdraft" boolean NOT NULL,
    "IsArchived" boolean NOT NULL,
    "SortOrder" integer NOT NULL,
    "LedgerAccountId" uuid NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_Wallets" PRIMARY KEY ("Id")
);


CREATE TABLE "LedgerLines" (
    "Id" uuid NOT NULL,
    "JournalEntryId" uuid NOT NULL,
    "LedgerAccountId" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "Amount" numeric(19,4) NOT NULL,
    "Currency" character varying(3) NOT NULL,
    "ProjectId" uuid,
    CONSTRAINT "PK_LedgerLines" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_LedgerLines_JournalEntries_JournalEntryId" FOREIGN KEY ("JournalEntryId") REFERENCES "JournalEntries" ("Id") ON DELETE RESTRICT
);


CREATE INDEX "IX_Attachments_JournalEntryId" ON "Attachments" ("JournalEntryId");


CREATE INDEX "IX_AuditLogs_UserId_At" ON "AuditLogs" ("UserId", "At");


CREATE INDEX "IX_Categories_UserId" ON "Categories" ("UserId");


CREATE INDEX "IX_Debts_UserId_Status" ON "Debts" ("UserId", "Status");


CREATE INDEX "IX_IncomeSources_UserId" ON "IncomeSources" ("UserId");


CREATE INDEX "IX_JournalEntries_ProjectId" ON "JournalEntries" ("ProjectId");


CREATE INDEX "IX_JournalEntries_ReversalOfId" ON "JournalEntries" ("ReversalOfId");


CREATE UNIQUE INDEX "IX_JournalEntries_UserId_IdempotencyKey" ON "JournalEntries" ("UserId", "IdempotencyKey");


CREATE INDEX "IX_JournalEntries_UserId_OccurredAt" ON "JournalEntries" ("UserId", "OccurredAt");


CREATE INDEX "IX_JournalEntries_WalletId" ON "JournalEntries" ("WalletId");


CREATE UNIQUE INDEX "IX_LedgerAccounts_UserId_Kind_RefId_Currency" ON "LedgerAccounts" ("UserId", "Kind", "RefId", "Currency");


CREATE INDEX "IX_LedgerLines_JournalEntryId" ON "LedgerLines" ("JournalEntryId");


CREATE INDEX "IX_LedgerLines_LedgerAccountId" ON "LedgerLines" ("LedgerAccountId");


CREATE INDEX "IX_LedgerLines_UserId_ProjectId" ON "LedgerLines" ("UserId", "ProjectId");


CREATE INDEX "IX_People_UserId" ON "People" ("UserId");


CREATE INDEX "IX_Projects_UserId" ON "Projects" ("UserId");


CREATE INDEX "IX_RefreshTokens_FamilyId" ON "RefreshTokens" ("FamilyId");


CREATE UNIQUE INDEX "IX_RefreshTokens_TokenHash" ON "RefreshTokens" ("TokenHash");


CREATE UNIQUE INDEX "IX_Users_ExternalIssuer_ExternalSubjectId" ON "Users" ("ExternalIssuer", "ExternalSubjectId");


CREATE UNIQUE INDEX "IX_Users_NormalizedEmail" ON "Users" ("NormalizedEmail");


CREATE INDEX "IX_Wallets_UserId_IsArchived" ON "Wallets" ("UserId", "IsArchived");



