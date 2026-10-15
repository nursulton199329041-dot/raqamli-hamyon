import { ApiError } from '@/api/client';
import { __setStorageForTests, type Storage } from '@/offline/storage';
import { useQueue } from '@/state/queue';
import { api } from '@/state/runtime';

function memStorage(): Storage {
  const kv = new Map<string, string>();
  let ops: { id: string; json: string }[] = [];
  return {
    get: async (k) => kv.get(k) ?? null,
    set: async (k, v) => void kv.set(k, v),
    remove: async (k) => void kv.delete(k),
    list: async () => ops.map((o) => o.json),
    replaceAll: async (items) => void (ops = items),
    logUpdate: async () => undefined,
    updateLog: async () => [],
    clearUserData: async () => void (ops = []),
  };
}

describe('offline queue', () => {
  beforeEach(() => {
    __setStorageForTests(memStorage());
    useQueue.setState({ pending: [], online: true, syncing: false });
  });

  it('queues the operation when the network is down and keeps it across hydrate()', async () => {
    jest.spyOn(api, 'post').mockRejectedValue(new ApiError(0, 'network', 'down'));
    const r = await useQueue.getState().submit('expense', { walletId: 'w', amount: 5, categoryId: 'c' });
    expect(r).toEqual({ ok: true, queued: true });
    expect(useQueue.getState().pending).toHaveLength(1);
    expect(useQueue.getState().online).toBe(false);

    useQueue.setState({ pending: [] });
    await useQueue.getState().hydrate(); // simulates an app restart / OTA reload
    expect(useQueue.getState().pending).toHaveLength(1);
  });

  it('does not queue server-side rejections', async () => {
    jest.spyOn(api, 'post').mockRejectedValue(new ApiError(422, 'wallet.insufficient_funds', 'Insufficient funds'));
    const r = await useQueue.getState().submit('expense', { amount: 5 });
    expect(r).toEqual({ ok: false, message: 'Insufficient funds' });
    expect(useQueue.getState().pending).toHaveLength(0);
  });

  it('flush removes applied + duplicate ops and keeps rejected ones with the error', async () => {
    const spy = jest.spyOn(api, 'post');
    spy.mockRejectedValueOnce(new ApiError(0, 'network', 'down')).mockRejectedValueOnce(new ApiError(0, 'network', 'down'));
    await useQueue.getState().submit('income', { amount: 1 });
    await useQueue.getState().submit('income', { amount: 2 });
    const [a, b] = useQueue.getState().pending;
    spy.mockResolvedValueOnce({
      results: [
        { clientOperationId: a!.clientOperationId, status: 'duplicate' },
        { clientOperationId: b!.clientOperationId, status: 'rejected', message: 'nope' },
      ],
    });
    await useQueue.getState().flush();
    const left = useQueue.getState().pending;
    expect(left).toHaveLength(1);
    expect(left[0]!.error).toBe('nope');
  });

  it('resends the same client operation id after a lost response (idempotency key preserved)', async () => {
    const spy = jest.spyOn(api, 'post').mockRejectedValueOnce(new ApiError(0, 'network', 'down'));
    await useQueue.getState().submit('expense', { amount: 9 });
    const id = useQueue.getState().pending[0]!.clientOperationId;
    spy.mockRejectedValueOnce(new ApiError(0, 'network', 'down'));
    await useQueue.getState().flush(); // still offline
    expect(useQueue.getState().pending[0]!.clientOperationId).toBe(id);
    const sent = spy.mock.calls.at(-1)![1] as { operations: { clientOperationId: string }[] };
    expect(sent.operations[0]!.clientOperationId).toBe(id);
  });
});