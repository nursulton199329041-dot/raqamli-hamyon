import type { Category, Debt, IncomeSource, Person, Tx, Wallet } from '@/api/types';
import type { LocalDb } from './db';
import { uuid } from './ids';
import { AccountKind } from './ledger';
import { toMinor } from './money';

/** One ledger line of a server entry: the account is named by (kind, ref, currency), never by a server row id. */
export interface RemoteLine { kind: number; refId: string; currency: string; amount: number }

/** `/api/sync/pull` as the engine reads it (projects are not part of the local book yet). */
export interface RemotePull {
  cursor: string; hasMore: boolean; transactions: Tx[]; lines: Record<string, RemoteLine[]>;
  wallets: Wallet[]; categories: Category[]; incomeSources: IncomeSource[]; people: Person[]; debts: Debt[];
}

export interface PushOp { clientOperationId: string; kind: string; payload: unknown; targetId: string | null }
export interface PushResult { clientOperationId: string; status: 'applied' | 'duplicate' | 'rejected'; errorCode?: string | null; message?: string | null }

/** How the engine reaches the server; profile ids are the server's (adopted on sign-in). */
export interface SyncTransport {
  push(profileId: string, ops: PushOp[]): Promise<PushResult[]>;
  pull(profileId: string, since: string | null): Promise<RemotePull>;
}

export interface SyncReport {
  pushed: number; duplicates: number; rejected: number; pulled: number; waiting: number;
  /** wallets whose local balance differs from the server's although nothing is waiting to be sent */
  drift: { walletId: string; local: number; server: number }[];
  error: string | null;
}

/** 5 s, 10 s, 20 s ... capped at one hour. */
export const backoffMs = (attempts: number) => Math.min(5000 * 2 ** Math.max(0, attempts - 1), 3_600_000);

/** Pull overlaps the previous cursor by this much: rows committed late on the server are not missed (ids dedupe). */
const PULL_OVERLAP_MS = 5 * 60_000;
const MAX_PAGES = 50;

/** Signed decimal from the server -> minor units (exact, no float arithmetic). */
function signed(n: number, currency: string): number {
  if (n === 0) return 0;
  return n < 0 ? -toMinor(String(-n), currency) : toMinor(String(n), currency);
}
const minorOrNull = (n: number | null | undefined, currency: string | null | undefined) =>
  n == null || !currency ? null : signed(n, currency);

/**
 * Moves the outbox to the server and the server's changes into the book.
 * - push: oldest first, in batches; applied/duplicate -> done, rejected -> kept with the reason (the user decides);
 *   a failed request backs the whole batch off exponentially, so the order of operations is kept.
 * - pull: from the checkpoint (with overlap), page by page; each page and its checkpoint commit together.
 */
export class SyncEngine {
  private running: Promise<SyncReport> | null = null;

  constructor(private db: LocalDb, private transport: SyncTransport, private clock: () => Date = () => new Date(), private batch = 100) {}

  /** One full cycle. Concurrent calls share the running cycle. */
  run(profileId: string): Promise<SyncReport> {
    if (!this.running)
      this.running = this.cycle(profileId).finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async cycle(profileId: string): Promise<SyncReport> {
    const report: SyncReport = { pushed: 0, duplicates: 0, rejected: 0, pulled: 0, waiting: 0, drift: [], error: null };
    try {
      await this.push(profileId, report);
      if (!report.error) await this.pull(profileId, report);
    } catch (e) {
      report.error = e instanceof Error ? e.message : String(e);
    }
    report.waiting = (await this.db.first<{ n: number }>(
      "SELECT count(*) AS n FROM sync_outbox WHERE profile_id = ? AND status = 'pending'", profileId))?.n ?? 0;
    return report;
  }

  async push(profileId: string, report: SyncReport) {
    for (;;) {
      const now = this.clock().toISOString();
      const ops = await this.db.all<{ op_id: string; kind: string; payload: string; target_id: string | null; attempts: number; next_attempt_at: string | null }>(
        "SELECT op_id, kind, payload, target_id, attempts, next_attempt_at FROM sync_outbox WHERE profile_id = ? AND status = 'pending' ORDER BY seq LIMIT ?",
        profileId, this.batch);
      if (ops.length === 0) return;
      // the oldest waiting operation is still backing off: later ones wait too (they may depend on it)
      if (ops[0]!.next_attempt_at && ops[0]!.next_attempt_at > now) {
        report.error = 'sync.backoff';
        return;
      }
      let results: PushResult[];
      try {
        results = await this.transport.push(profileId, ops.map((o) => ({
          clientOperationId: o.op_id, kind: o.kind, payload: JSON.parse(o.payload) as unknown, targetId: o.target_id,
        })));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await this.db.tx(async () => {
          for (const o of ops)
            await this.db.run('UPDATE sync_outbox SET attempts = attempts + 1, next_attempt_at = ?, last_error = ? WHERE op_id = ?',
              new Date(this.clock().getTime() + backoffMs(o.attempts + 1)).toISOString(), msg, o.op_id);
        });
        report.error = msg;
        return;
      }
      const byId = new Map(results.map((r) => [r.clientOperationId, r]));
      let settled = 0;
      await this.db.tx(async () => {
        for (const o of ops) {
          const r = byId.get(o.op_id);
          if (!r) continue; // not answered: stays pending, retried next cycle
          settled++;
          if (r.status === 'rejected') {
            report.rejected++;
            await this.db.run("UPDATE sync_outbox SET status = 'rejected', attempts = attempts + 1, last_error = ? WHERE op_id = ?",
              `${r.errorCode ?? 'error'}: ${r.message ?? ''}`, o.op_id);
          } else {
            if (r.status === 'duplicate') report.duplicates++;
            else report.pushed++;
            await this.db.run("UPDATE sync_outbox SET status = 'done', attempts = attempts + 1, next_attempt_at = NULL, last_error = NULL WHERE op_id = ?", o.op_id);
          }
        }
      });
      if (settled === 0 || ops.length < this.batch) return;
    }
  }

  async pull(profileId: string, report: SyncReport) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const cp = await this.db.first<{ cursor: string | null }>('SELECT cursor FROM sync_checkpoints WHERE profile_id = ?', profileId);
      const since = cp?.cursor ? new Date(new Date(cp.cursor).getTime() - PULL_OVERLAP_MS).toISOString() : null;
      const data = await this.transport.pull(profileId, since);
      const r = await applyPull(this.db, profileId, data, this.clock().toISOString());
      report.pulled += r.inserted;
      report.drift = r.drift;
      if (!data.hasMore) return;
    }
  }
}

/**
 * Brings one pulled page into the book in ONE transaction (with the checkpoint). Catalog rows are upserted by id (a
 * local edit that is still waiting to be sent wins until it is sent); entries the device does not have yet are rebuilt
 * from their lines, so balances move exactly as on the server. Entries the device already has (it created them, same
 * id) only receive the reversal link.
 */
export async function applyPull(db: LocalDb, profileId: string, data: RemotePull, now: string) {
  let inserted = 0;
  const drift: SyncReport['drift'] = [];
  await db.tx(async () => {
    const pending = (await db.first<{ n: number }>(
      "SELECT count(*) AS n FROM sync_outbox WHERE profile_id = ? AND status = 'pending'", profileId))?.n ?? 0;
    const pendingWalletEdits = new Set((await db.all<{ target_id: string }>(
      "SELECT target_id FROM sync_outbox WHERE profile_id = ? AND status = 'pending' AND kind = 'wallet.update'", profileId)).map((r) => r.target_id));

    const account = async (kind: number, ref: string, currency: string, allowNegative: boolean, name = '') => {
      const found = await db.first<{ id: string }>(
        'SELECT id FROM ledger_accounts WHERE profile_id = ? AND kind = ? AND ref_id = ? AND currency = ?', profileId, kind, ref, currency);
      if (found) return found.id;
      const id = uuid();
      await db.run('INSERT INTO ledger_accounts (id, profile_id, kind, ref_id, currency, name, allow_negative, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id, profileId, kind, ref, currency, name, allowNegative ? 1 : 0, now);
      return id;
    };

    for (const p of data.people)
      await db.run(`INSERT INTO people (id, profile_id, name, phone, note, created_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, note = excluded.note`,
        p.id, profileId, p.name, p.phone ?? null, p.note ?? null, now);

    // parents before children (parent_id references categories)
    const cats = [...data.categories].sort((a, b) => Number(!!a.parentId) - Number(!!b.parentId));
    for (const c of cats)
      await db.run(`INSERT INTO categories (id, profile_id, parent_id, name, icon, color, monthly_limit_minor, limit_currency, is_archived, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET parent_id = excluded.parent_id, name = excluded.name, icon = excluded.icon, color = excluded.color,
          monthly_limit_minor = excluded.monthly_limit_minor, limit_currency = excluded.limit_currency, is_archived = excluded.is_archived,
          sort_order = excluded.sort_order, updated_at = excluded.updated_at`,
        c.id, profileId, c.parentId ?? null, c.name, c.icon, c.color, minorOrNull(c.monthlyLimit, c.limitCurrency), c.limitCurrency ?? null,
        c.isArchived ? 1 : 0, c.sortOrder, now, now);

    for (const s of data.incomeSources)
      await db.run(`INSERT INTO income_sources (id, profile_id, name, icon, color, is_archived, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon, color = excluded.color, is_archived = excluded.is_archived,
          sort_order = excluded.sort_order, updated_at = excluded.updated_at`,
        s.id, profileId, s.name, s.icon, s.color, s.isArchived ? 1 : 0, s.sortOrder, now, now);

    for (const w of data.wallets) {
      const known = await db.first<{ id: string }>('SELECT id FROM wallets WHERE id = ?', w.id);
      if (!known) {
        const acc = await account(AccountKind.Wallet, w.id, w.currency, w.allowOverdraft, w.name);
        await db.run(`INSERT INTO wallets (id, profile_id, name, type, currency, icon, color, bank_name, masked_number, note, allow_overdraft,
            is_archived, sort_order, ledger_account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          w.id, profileId, w.name, w.type, w.currency, w.icon, w.color, w.bankName ?? null, w.maskedNumber ?? null, w.note ?? null,
          w.allowOverdraft ? 1 : 0, w.isArchived ? 1 : 0, w.sortOrder, acc, now, now);
      } else if (!pendingWalletEdits.has(w.id)) {
        await db.run(`UPDATE wallets SET name = ?, type = ?, icon = ?, color = ?, bank_name = ?, masked_number = ?, note = ?, allow_overdraft = ?,
            is_archived = ?, sort_order = ?, updated_at = ? WHERE id = ? AND profile_id = ?`,
          w.name, w.type, w.icon, w.color, w.bankName ?? null, w.maskedNumber ?? null, w.note ?? null, w.allowOverdraft ? 1 : 0,
          w.isArchived ? 1 : 0, w.sortOrder, now, w.id, profileId);
        await db.run('UPDATE ledger_accounts SET allow_negative = ? WHERE profile_id = ? AND kind = ? AND ref_id = ?',
          w.allowOverdraft ? 1 : 0, profileId, AccountKind.Wallet, w.id);
      }
    }

    for (const d of data.debts) {
      const principal = signed(d.principal, d.currency);
      const outstanding = signed(d.outstanding, d.currency);
      const known = await db.first<{ id: string }>('SELECT id FROM debts WHERE id = ?', d.id);
      if (!known) {
        const acc = await account(AccountKind.Debt, d.id, d.currency, true, 'Debt');
        await db.run(`INSERT INTO debts (id, profile_id, person_id, direction, currency, principal_minor, outstanding_minor, due_date, status, reason, note,
            ledger_account_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          d.id, profileId, d.personId, d.direction, d.currency, principal, outstanding, d.dueDate ?? null, d.status, d.reason ?? null,
          d.note ?? null, acc, d.createdAt);
      } else if (pending === 0) {
        // the server is the authority once nothing local is waiting
        await db.run('UPDATE debts SET outstanding_minor = ?, status = ? WHERE id = ? AND profile_id = ?', outstanding, d.status, d.id, profileId);
      }
    }

    for (const t of [...data.transactions].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const known = await db.first<{ id: string }>('SELECT id FROM transactions WHERE id = ?', t.id);
      if (!known) {
        const lines = data.lines[t.id] ?? [];
        if (lines.length < 2) throw new Error(`sync.lines_missing: ${t.id}`);
        const cols: [string, string | number | null][] = [
          ['id', t.id], ['profile_id', profileId], ['type', t.type], ['occurred_at', new Date(t.occurredAt).toISOString()],
          ['amount_minor', signed(t.amount, t.currency)], ['currency', t.currency], ['wallet_id', t.walletId ?? null],
          ['to_wallet_id', t.toWalletId ?? null], ['to_amount_minor', minorOrNull(t.toAmount, t.toCurrency)], ['to_currency', t.toCurrency ?? null],
          ['fx_rate', t.fxRate == null ? null : String(t.fxRate)], ['rate_date', t.rateDate ?? null], ['rate_source', t.rateSource ?? null],
          ['category_id', t.categoryId ?? null], ['income_source_id', t.incomeSourceId ?? null], ['person_id', t.personId ?? null],
          ['debt_id', t.debtId ?? null], ['reason', t.reason ?? null], ['memo', t.memo ?? null], ['reversal_of_id', t.reversalOfId ?? null],
          ['reversed_by_id', null], ['replaces_id', t.replacesId ?? null], ['project_id', t.projectId ?? null], ['idempotency_key', `remote:${t.id}`], ['origin', 'server'],
          ['created_at', t.createdAt], ['updated_at', now],
        ];
        await db.run(`INSERT INTO transactions (${cols.map((c) => c[0]).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map((c) => c[1]));
        for (const l of lines) {
          const acc = await account(l.kind, l.refId, l.currency, l.kind !== AccountKind.Wallet);
          const amount = signed(l.amount, l.currency);
          await db.run('INSERT INTO transaction_entries (id, transaction_id, profile_id, ledger_account_id, amount_minor, currency) VALUES (?, ?, ?, ?, ?, ?)',
            uuid(), t.id, profileId, acc, amount, l.currency);
          // the server already enforced its rules; the device follows, never refuses a remote entry
          await db.run('UPDATE ledger_accounts SET balance_minor = balance_minor + ? WHERE id = ?', amount, acc);
        }
        inserted++;
      }
      if (t.reversalOfId)
        await db.run('UPDATE transactions SET reversed_by_id = ?, updated_at = ? WHERE id = ? AND reversed_by_id IS NULL', t.id, now, t.reversalOfId);
    }

    await db.run(`INSERT INTO sync_checkpoints (profile_id, cursor, pulled_at) VALUES (?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET cursor = excluded.cursor, pulled_at = excluded.pulled_at`, profileId, data.cursor, now);

    if (pending === 0)
      for (const w of data.wallets) {
        const local = await db.first<{ b: number }>(
          'SELECT a.balance_minor AS b FROM wallets w JOIN ledger_accounts a ON a.id = w.ledger_account_id WHERE w.id = ?', w.id);
        const server = signed(w.balance, w.currency);
        if (local && local.b !== server) drift.push({ walletId: w.id, local: local.b, server });
      }
  });
  return { inserted, drift };
}
