-- V5: financial profiles + conversion details on journal entries.
-- Additive and data-preserving: nothing is deleted. Every existing account gets one "Asosiy" profile and all of its
-- rows are moved into it, so balances, history and reports read exactly as before. Runs in the migration transaction:
-- if any row cannot be assigned a profile, the whole migration is rolled back.

CREATE TABLE "Profiles" (
    "Id" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "Name" character varying(60) NOT NULL,
    "Color" character varying(9) NOT NULL,
    "Icon" character varying(40) NOT NULL,
    "BaseCurrency" character varying(3) NOT NULL,
    "SortOrder" integer NOT NULL,
    "IsArchived" boolean NOT NULL,
    "Revision" integer NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_Profiles" PRIMARY KEY ("Id")
);
CREATE INDEX "IX_Profiles_UserId_SortOrder" ON "Profiles" ("UserId", "SortOrder");

INSERT INTO "Profiles" ("Id", "UserId", "Name", "Color", "Icon", "BaseCurrency", "SortOrder", "IsArchived", "Revision", "CreatedAt")
SELECT gen_random_uuid(), u."Id", 'Asosiy', '#4D8DFF', 'person', u."DefaultCurrency", 0, false, 1, now()
FROM "Users" u;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['Wallets', 'LedgerAccounts', 'JournalEntries', 'LedgerLines', 'Categories', 'IncomeSources',
                             'People', 'Projects', 'Debts', 'Attachments']
    LOOP
        EXECUTE format('ALTER TABLE %I ADD COLUMN "ProfileId" uuid', t);
        EXECUTE format('UPDATE %I x SET "ProfileId" = p."Id" FROM "Profiles" p WHERE p."UserId" = x."UserId"', t);
        EXECUTE format('ALTER TABLE %I ALTER COLUMN "ProfileId" SET NOT NULL', t);
        EXECUTE format('CREATE INDEX %I ON %I ("ProfileId")', 'IX_' || t || '_ProfileId', t);
    END LOOP;
END $$;

-- counter-accounts (equity, FX clearing, income/expense) are per profile now
DROP INDEX "IX_LedgerAccounts_UserId_Kind_RefId_Currency";
CREATE UNIQUE INDEX "IX_LedgerAccounts_UserId_ProfileId_Kind_RefId_Currency"
    ON "LedgerAccounts" ("UserId", "ProfileId", "Kind", "RefId", "Currency");

-- where a stored conversion rate came from; historical rates are never re-priced
ALTER TABLE "JournalEntries" ADD COLUMN "RateDate" date;
ALTER TABLE "JournalEntries" ADD COLUMN "RateSource" character varying(40);
