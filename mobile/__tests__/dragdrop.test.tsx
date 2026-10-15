import { act, render } from '@testing-library/react-native';
import type { RefObject } from 'react';
import type { View } from 'react-native';
import { DragProvider, useDrag, type DragPayload } from '@/dnd/DragDrop';

jest.mock('react-native-gesture-handler', () => {
  const chain: unknown = new Proxy(function () {}, { get: () => () => chain, apply: () => chain });
  return { Gesture: chain, GestureDetector: ({ children }: { children: unknown }) => children };
});
jest.mock('react-native-worklets', () => ({ scheduleOnRN: (fn: (...a: unknown[]) => void, ...a: unknown[]) => fn(...a) }));

type Api = ReturnType<typeof useDrag>;
const holder: { api: Api } = { api: undefined as unknown as Api };
function Probe() {
  // eslint-disable-next-line react-hooks/immutability
  holder.api = useDrag();
  return null;
}
const api = new Proxy({} as Api, { get: (_t, k) => (holder.api as unknown as Record<string | symbol, unknown>)[k] });

/** A fake native node whose measureInWindow reports a fixed rect. */
function node(x: number, y: number, w: number, h: number): RefObject<View | null> {
  return { current: { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(x, y, w, h) } as unknown as View };
}

async function setup() {
  await render(<DragProvider><Probe /></DragProvider>);
  const drops: string[] = [];
  await act(async () => {
    api.registerZone('cat:food', { accepts: (p) => p.kind === 'wallet', onDrop: (p) => drops.push(`expense:${p.id}->food`), ref: node(0, 100, 100, 100) });
    api.registerZone('wallet:b', { accepts: (p) => (p.kind === 'wallet' && p.id !== 'b') || p.kind === 'source', onDrop: (p) => drops.push(`${p.kind}:${p.id}->b`), ref: node(200, 100, 100, 100) });
  });
  return drops;
}

const wallet = (id: string): DragPayload => ({ kind: 'wallet', id });

describe('drag & drop', () => {
  it('wallet dropped on a category triggers its drop handler (opens the form, no money moves here)', async () => {
    const drops = await setup();
    await act(async () => { api.begin(wallet('a'), null, 10, 10); });
    await act(async () => { api.move(50, 150); });
    expect(api.hoverId).toBe('cat:food');
    await act(async () => { api.end(50, 150); });
    expect(drops).toEqual(['expense:a->food']);
    expect(api.dragging).toBeNull();
  });

  it('wallet dropped on another wallet and source dropped on wallet both route to that wallet', async () => {
    const drops = await setup();
    await act(async () => { api.begin(wallet('a'), null, 0, 0); });
    await act(async () => { api.end(250, 150); });
    await act(async () => { api.begin({ kind: 'source', id: 's1' }, null, 0, 0); });
    await act(async () => { api.end(250, 150); });
    expect(drops).toEqual(['wallet:a->b', 'source:s1->b']);
  });

  it('a wallet dropped on itself is rejected and flagged invalid', async () => {
    const drops = await setup();
    await act(async () => { api.begin(wallet('b'), null, 0, 0); });
    await act(async () => { api.move(250, 150); });
    expect(api.rejectedId).toBe('wallet:b');
    expect(api.hoverId).toBeNull();
    await act(async () => { api.end(250, 150); });
    expect(drops).toEqual([]);
  });

  it('a source cannot be dropped on a category', async () => {
    const drops = await setup();
    await act(async () => { api.begin({ kind: 'source', id: 's1' }, null, 0, 0); });
    await act(async () => { api.end(50, 150); });
    expect(drops).toEqual([]);
  });

  it('dropping outside any zone or cancelling does nothing', async () => {
    const drops = await setup();
    await act(async () => { api.begin(wallet('a'), null, 0, 0); });
    await act(async () => { api.end(500, 500); });
    await act(async () => { api.begin(wallet('a'), null, 0, 0); });
    await act(async () => { api.cancel(); });
    expect(drops).toEqual([]);
    expect(api.dragging).toBeNull();
  });

  it('marks only accepting zones as valid targets while dragging', async () => {
    await setup();
    await act(async () => { api.begin({ kind: 'source', id: 's1' }, null, 0, 0); });
    expect([...api.validIds]).toEqual(['wallet:b']);
  });
});