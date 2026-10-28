import { ApiError } from '@/api/client';
import { errorText } from '@/api/errors';
import type { Category, PendingOp, Wallet } from '@/api/types';
import { correctUiOp, type LocalBook } from '@/local/bridge';
import { LedgerError } from '@/local/ledger';
import { toMinor } from '@/local/money';
import { newKey } from '@/lib/money';
import { currentBook, useQueue } from './queue';
import { api } from './runtime';

/**
 * Catalog edits and corrections from the screens. With the device's book (offline-first or guest) they are written
 * locally and synced later; otherwise they go to the server as before. Local errors carry the same codes and texts.
 */
async function book(): Promise<LocalBook | null> {
  const opening = currentBook();
  return opening && (await opening);
}

async function local<T>(b: LocalBook, work: () => Promise<T>): Promise<T> {
  try {
    const out = await work();
    void useQueue.getState().syncLocal(b);
    return out;
  } catch (e) {
    if (e instanceof LedgerError) throw new ApiError(400, e.code, errorText(e.code, e.message));
    throw e;
  }
}

export interface WalletInput {
  name: string; type: number; currency: string; initialBalance: number; icon: string; color: string;
  bankName: string | null; maskedNumber: string | null; allowOverdraft: boolean;
}

export async function createWallet(w: WalletInput): Promise<{ id: string }> {
  const b = await book();
  if (!b) return api.post<Wallet>('/api/wallets', w, newKey('w'));
  return local(b, () => b.ledger.createWallet(b.profileId, {
    name: w.name, type: w.type, currency: w.currency, initialMinor: toMinor(String(w.initialBalance), w.currency), icon: w.icon,
    color: w.color, allowOverdraft: w.allowOverdraft,
  }));
}

/** Local book: name, icon, colour and archive (bank details and overdraft are edited online). */
export async function patchWallet(id: string, patch: Partial<WalletInput> & { isArchived?: boolean }): Promise<void> {
  const b = await book();
  if (!b) return void (await api.patch(`/api/wallets/${id}`, patch));
  await local(b, async () => {
    const w = await b.ledger.wallet(b.profileId, id);
    if (!w) throw new LedgerError('not_found', 'Wallet not found.');
    await b.ledger.updateWallet(b.profileId, id, w.revision, { name: patch.name, icon: patch.icon, color: patch.color, isArchived: patch.isArchived });
  });
}

export async function createCategory(c: { name: string; icon: string; color: string; parentId?: string | null; monthlyLimit?: number | null; limitCurrency?: string }): Promise<{ id: string }> {
  const b = await book();
  if (!b) return api.post<Category>('/api/categories', c);
  return local(b, async () => ({ id: await b.ledger.createCategory(b.profileId, { name: c.name, icon: c.icon, color: c.color, parentId: c.parentId ?? null }) }));
}

export async function createSource(s: { name: string; icon: string; color: string }): Promise<{ id: string }> {
  const b = await book();
  if (!b) return api.post('/api/income-sources', s);
  return local(b, async () => ({ id: await b.ledger.createSource(b.profileId, s) }));
}

export async function reverseTx(id: string): Promise<void> {
  const b = await book();
  if (!b) return void (await api.post(`/api/transactions/${id}/reverse`, {}));
  await local(b, () => b.ledger.reverse(b.profileId, id));
}

/** Correction = reversal + new entry (server: one PUT; device: one SQLite transaction). */
export async function correctTx(id: string, kind: 'income' | 'expense' | 'transfer', body: Record<string, unknown>): Promise<void> {
  const b = await book();
  if (!b) return void (await api.put(`/api/transactions/${id}/${kind}`, body));
  await local(b, () => correctUiOp(b, id, kind as PendingOp['kind'], body));
}

/** True when writes go to the device's book (people are then created together with the operation that names them). */
export async function writesLocally(): Promise<boolean> {
  return !!(await book());
}
