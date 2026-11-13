-- Device book sync (Avalonia client): every wallet / category / source / operation / profile meta of a book is one
-- document with a stable client uid. Last writer (client updated_at) wins; "Seq" grows on every accepted change so a
-- device pulls everything after the last Seq it has seen. Deleted rows stay as tombstones (Deleted = true).
CREATE SEQUENCE "BookDocs_Seq_seq";

CREATE TABLE "BookDocs" (
    "UserId"    uuid        NOT NULL REFERENCES "Users" ("Id") ON DELETE CASCADE,
    "BookId"    varchar(64) NOT NULL,
    "Kind"      varchar(32) NOT NULL,
    "Uid"       varchar(64) NOT NULL,
    "Data"      text        NOT NULL,
    "UpdatedAt" timestamptz NOT NULL,
    "Deleted"   boolean     NOT NULL DEFAULT false,
    "Seq"       bigint      NOT NULL DEFAULT nextval('"BookDocs_Seq_seq"'),
    CONSTRAINT "PK_BookDocs" PRIMARY KEY ("UserId", "BookId", "Kind", "Uid")
);

CREATE INDEX "IX_BookDocs_UserId_Seq" ON "BookDocs" ("UserId", "Seq");
