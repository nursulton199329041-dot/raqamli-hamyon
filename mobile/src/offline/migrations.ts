/**
 * Ordered, additive migrations (index + 1 = PRAGMA user_version after it). A migration may only add: user data is never
 * dropped or reset. Each version runs in one transaction together with its user_version bump (see local/migrate.ts).
 */
export const MIGRATIONS: string[][] = [
  // v1: snapshot cache + offline queue
  [
    'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS ops (id TEXT PRIMARY KEY NOT NULL, seq INTEGER NOT NULL, json TEXT NOT NULL)',
  ],
  // v2: update history
  [
    'CREATE TABLE IF NOT EXISTS update_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL)',
  ],
  // v3: offline-first local ledger (mirrors the backend model; money in integer minor units)
  [
    `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('local','cloud')),
      server_user_id TEXT, email TEXT, display_name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id), name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#4D8DFF', icon TEXT NOT NULL DEFAULT 'person', base_currency TEXT NOT NULL DEFAULT 'UZS',
      sort_order INTEGER NOT NULL DEFAULT 0, is_archived INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS ledger_accounts (
      id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL REFERENCES profiles(id), kind INTEGER NOT NULL,
      ref_id TEXT NOT NULL, currency TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', allow_negative INTEGER NOT NULL DEFAULT 0,
      balance_minor INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
      UNIQUE (profile_id, kind, ref_id, currency))`,
    `CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL REFERENCES profiles(id), name TEXT NOT NULL,
      type INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'wallet', color TEXT NOT NULL DEFAULT '#3B82F6',
      bank_name TEXT, masked_number TEXT, note TEXT, allow_overdraft INTEGER NOT NULL DEFAULT 0, is_archived INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0, ledger_account_id TEXT NOT NULL REFERENCES ledger_accounts(id),
      revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS income_sources (
      id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL REFERENCES profiles(id), name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'briefcase', color TEXT NOT NULL DEFAULT '#22C55E', is_archived INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL REFERENCES profiles(id), parent_id TEXT REFERENCES categories(id),
      name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'tag', color TEXT NOT NULL DEFAULT '#EF4444',
      monthly_limit_minor INTEGER, limit_currency TEXT, is_archived INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL REFERENCES profiles(id), name TEXT NOT NULL, phone TEXT, note TEXT,
      created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS debts (
      id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL REFERENCES profiles(id), person_id TEXT NOT NULL REFERENCES people(id),
      direction INTEGER NOT NULL, currency TEXT NOT NULL, principal_minor INTEGER NOT NULL, outstanding_minor INTEGER NOT NULL,
      due_date TEXT, status INTEGER NOT NULL DEFAULT 0, reason TEXT, note TEXT,
      ledger_account_id TEXT NOT NULL REFERENCES ledger_accounts(id), created_at TEXT NOT NULL,
      CHECK (outstanding_minor >= 0 AND outstanding_minor <= principal_minor))`,
    `CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL REFERENCES profiles(id), type INTEGER NOT NULL,
      occurred_at TEXT NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL,
      wallet_id TEXT, to_wallet_id TEXT, to_amount_minor INTEGER, to_currency TEXT,
      fx_rate TEXT, rate_date TEXT, rate_source TEXT,
      category_id TEXT, income_source_id TEXT, person_id TEXT, debt_id TEXT, reason TEXT, memo TEXT,
      reversal_of_id TEXT, reversed_by_id TEXT, replaces_id TEXT,
      idempotency_key TEXT NOT NULL UNIQUE, origin TEXT NOT NULL DEFAULT 'local' CHECK (origin IN ('local','server')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS transaction_entries (
      id TEXT PRIMARY KEY NOT NULL, transaction_id TEXT NOT NULL REFERENCES transactions(id),
      profile_id TEXT NOT NULL REFERENCES profiles(id), ledger_account_id TEXT NOT NULL REFERENCES ledger_accounts(id),
      amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0), currency TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS currency_rates (
      base TEXT NOT NULL, quote TEXT NOT NULL, rate TEXT NOT NULL, rate_date TEXT NOT NULL, source TEXT NOT NULL,
      fetched_at TEXT NOT NULL, PRIMARY KEY (base, quote, rate_date, source))`,
    `CREATE TABLE IF NOT EXISTS sync_outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT NOT NULL UNIQUE, profile_id TEXT NOT NULL REFERENCES profiles(id),
      kind TEXT NOT NULL, payload TEXT NOT NULL, target_id TEXT, created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','rejected')),
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, last_error TEXT)`,
    `CREATE TABLE IF NOT EXISTS sync_checkpoints (
      profile_id TEXT PRIMARY KEY NOT NULL REFERENCES profiles(id), cursor TEXT, pulled_at TEXT)`,
    `CREATE VIEW IF NOT EXISTS debt_movements AS
      SELECT id, profile_id, debt_id, type, occurred_at, amount_minor, currency, wallet_id, memo, reversed_by_id
      FROM transactions WHERE debt_id IS NOT NULL`,
    'CREATE INDEX IF NOT EXISTS ix_tx_profile_time ON transactions (profile_id, occurred_at)',
    'CREATE INDEX IF NOT EXISTS ix_entries_tx ON transaction_entries (transaction_id)',
    'CREATE INDEX IF NOT EXISTS ix_entries_account ON transaction_entries (ledger_account_id)',
    'CREATE INDEX IF NOT EXISTS ix_wallets_profile ON wallets (profile_id)',
    'CREATE INDEX IF NOT EXISTS ix_categories_profile ON categories (profile_id)',
    'CREATE INDEX IF NOT EXISTS ix_sources_profile ON income_sources (profile_id)',
    'CREATE INDEX IF NOT EXISTS ix_outbox_pending ON sync_outbox (status, seq)',
  ],
  // v4: operations keep their project (synced with the server, shown in history)
  [
    'ALTER TABLE transactions ADD COLUMN project_id TEXT',
  ],
];
