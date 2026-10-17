import { act, render } from '@testing-library/react-native';
import type { RefObject } from 'react';
import type { View } from 'react-native';
import { DragProvider, setDragTrace, useDrag, type DragPayload } from '@/dnd/DragDrop';

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

describe('drop reliability', () => {
  /** zone whose real position can change after the drag started (page scrolled) */
  function movable(x: number, y: number, w: number, h: number) {
    const rect = { x, y, w, h };
    const ref = { current: { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(rect.x, rect.y, rect.w, rect.h) } as unknown as View };
    return { rect, ref: ref as RefObject<View | null> };
  }

  it('a thumb that lands in the gap next to a valid tile (<= 14px) still drops on it; farther away does not', async () => {
    const drops = await setup(); // cat:food is x 0..100, y 100..200
    await act(async () => { api.begin(wallet('a'), null, 0, 0); });
    await act(async () => { api.end(108, 150); }); // 8px right of the tile
    expect(drops).toEqual(['expense:a->food']);
    await act(async () => { api.begin(wallet('a'), null, 0, 0); });
    await act(async () => { api.end(135, 150); }); // 35px away, between the tiles
    expect(drops).toEqual(['expense:a->food']);
  });

  it('the nearest zone that ACCEPTS the payload wins over a closer one that rejects it', async () => {
    const drops = await setup(); // wallet:b x 200..300 rejects wallet "b" itself, cat:food accepts
    await act(async () => { api.begin(wallet('b'), null, 0, 0); });
    await act(async () => { api.end(104, 150); });
    expect(drops).toEqual(['expense:b->food']);
  });

  it('zone rectangles are re-measured at the drop: a zone that moved since the drag started (scroll) is still hit', async () => {
    await render(<DragProvider><Probe /></DragProvider>);
    const drops: string[] = [];
    const z = movable(0, 900, 100, 100); // off screen when the drag begins
    await act(async () => { api.registerZone('cat:far', { accepts: () => true, onDrop: (p) => drops.push(p.id), ref: z.ref }); });
    await act(async () => { api.begin(wallet('a'), null, 50, 700); });
    z.rect.y = 600; // the page scrolled 300px while the finger rested on the edge
    await act(async () => { api.end(50, 650); });
    expect(drops).toEqual(['a']);
  });

  it('a second "end" for the same touch cannot create a second drop (no duplicate transactions)', async () => {
    const drops = await setup();
    await act(async () => { api.begin(wallet('a'), null, 0, 0); });
    await act(async () => { api.end(50, 150); api.end(50, 150); });
    await act(async () => { api.end(50, 150); });
    expect(drops).toEqual(['expense:a->food']);
  });

  it('a rejected drop sends the tile back home before the drag state clears; nothing is dropped', async () => {
    jest.useFakeTimers();
    try {
      const drops = await setup();
      await act(async () => { api.begin(wallet('a'), null, 0, 0); });
      await act(async () => { api.end(500, 500, { x: 10, y: 10 }); });
      expect(drops).toEqual([]);
      expect(api.dragging).not.toBeNull(); // ghost still on screen, flying back
      await act(async () => { jest.advanceTimersByTime(250); });
      expect(api.dragging).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('retry after a miss works: the next attempt starts clean and drops', async () => {
    const drops = await setup();
    await act(async () => { api.begin(wallet('a'), null, 0, 0); });
    await act(async () => { api.end(500, 500); });
    expect(api.dragging).toBeNull();
    await act(async () => { api.begin(wallet('a'), null, 0, 0); });
    await act(async () => { api.end(50, 150); });
    expect(drops).toEqual(['expense:a->food']);
  });

  it('the trace says WHY a drop produced nothing', async () => {
    await setup();
    const ends: Record<string, unknown>[] = [];
    setDragTrace((ev, data) => { if (ev === 'end') ends.push({ ...data }); });
    await act(async () => { api.begin(wallet('b'), null, 0, 0); });
    await act(async () => { api.end(250, 150); }); // on itself
    await act(async () => { api.begin(wallet('a'), null, 0, 0); });
    await act(async () => { api.end(500, 500); }); // nowhere
    await act(async () => { api.begin(wallet('a'), null, 0, 0); });
    await act(async () => { api.end(50, 150); });
    setDragTrace(null);
    expect(ends.map((e) => e.reason)).toEqual(['rejected', 'no-zone-under-finger', 'drop']);
    expect(ends[1]?.nearest).toBe('wallet:b@361px'); // closest measured zone and how far the finger was from it
    expect(ends[2]?.drop).toBe('cat:food');
  });
});
