import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { DragProvider } from '@/dnd/DragDrop';
import { Dashboard } from '@/features/Dashboard';
import { OperationSheet } from '@/features/OperationSheet';
import { queryClient } from '@/state/runtime';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { FakeServer, category, source, wallet } from '../test-utils/fakeServer';
import { gestures } from '../test-utils/gestureMock';
import { useLayout } from '../test-utils/layout';

jest.mock('react-native-gesture-handler', () => jest.requireActual('../test-utils/gestureMock'));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

// Window rectangles ("measureInWindow" space). Category c1 is a short strip so that a finger computed from the
// shifted Android touch space (absoluteY) would MISS it while the window-space finger hits it.
const BOXES = {
  'dash-wrap': { x: 0, y: 0, w: 400, h: 800 },
  'drag:wallet:w1': { x: 20, y: 300, w: 150, h: 50 },
  'drop:wallet:w1': { x: 20, y: 300, w: 150, h: 50 },
  'drag:wallet:w2': { x: 200, y: 300, w: 150, h: 50 },
  'drop:wallet:w2': { x: 200, y: 300, w: 150, h: 50 },
  'drop:cat:c1': { x: 20, y: 600, w: 110, h: 50 },
  'drag:source:s1': { x: 20, y: 150, w: 92, h: 70 },
};
const ANDROID_STATUS_BAR = { x: 0, y: 24 };

jest.setTimeout(30000);

let server: FakeServer;
let restore: () => void;

async function renderApp() {
  return render(
    <QueryClientProvider client={queryClient}>
      <DragProvider>
        <Dashboard />
        <OperationSheet />
      </DragProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useSettings.setState({ lang: 'uz', reduceEffects: true });
  useUi.setState({ op: null, lastOp: null, form: null, formId: null });
  server = new FakeServer();
  server.wallets = [wallet('w1', 'Bank kartasi', 1_000_000), wallet('w2', 'Naqd pul', 200_000, { type: 0, icon: 'cash' })];
  server.categories = [category('c1', 'Kommunal')];
  server.sources = [source('s1', 'Maosh')];
  restore = server.install();
});
afterEach(() => restore());

async function ready() {
  await renderApp();
  await screen.findByText('1 000 000 UZS');
}
const typeAmount = async (v: string) => fireEvent.changeText(screen.getByLabelText(/^Summa/), v);

describe('dashboard drag & drop (Android-like touch space: absoluteY is 24px below the window space)', () => {
  it('wallet -> category: opens a pre-filled expense form, moves NO money until confirmed, then updates balance', async () => {
    const L = useLayout(BOXES, ANDROID_STATUS_BAR);
    await ready();

    // grab the Bank card at (10,10) inside the tile and carry it onto the Kommunal strip at window (75, 625)
    await L.drag('drag:wallet:w1', { x: 10, y: 10 }, [{ tx: 10, ty: 100 }, { tx: 45, ty: 315 }]);

    expect(useUi.getState().op).toEqual({ kind: 'expense', walletId: 'w1', categoryId: 'c1' });
    expect(server.pushes).toHaveLength(0); // nothing sent yet
    expect(server.wallets[0]?.balance).toBe(1_000_000);

    // the form shows wallet (auto), category (auto) and the confirm button
    expect(await screen.findByText('To‘lov hamyoni')).toBeTruthy();
    expect(screen.getAllByText('Bank kartasi').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Kommunal').length).toBeGreaterThanOrEqual(2); // dashboard tile + form chip
    expect(screen.getByText('Tasdiqlash')).toBeTruthy();

    await typeAmount('150000');
    await act(async () => { await fireEvent.press(screen.getByText('Tasdiqlash')); });

    await waitFor(() => expect(server.pushes).toHaveLength(1));
    expect(server.pushes[0]?.kind).toBe('expense');
    expect(server.pushes[0]?.payload).toMatchObject({ walletId: 'w1', categoryId: 'c1', amount: 150000 });
    await screen.findByText('850 000 UZS'); // dashboard refreshed from the ledger
    expect(useUi.getState().op).toBeNull();
  });

  it('wallet -> wallet: opens a transfer form with both wallets chosen and moves money only after confirmation', async () => {
    const L = useLayout(BOXES, ANDROID_STATUS_BAR);
    await ready();
    await L.drag('drag:wallet:w1', { x: 10, y: 10 }, [{ tx: 200, ty: 20 }]); // finger -> window (230, 330) inside w2

    expect(useUi.getState().op).toEqual({ kind: 'transfer', walletId: 'w1', toWalletId: 'w2' });
    expect(server.pushes).toHaveLength(0);
    expect(await screen.findByText('Manba hamyon')).toBeTruthy();
    expect(screen.getByText('Qabul qiluvchi')).toBeTruthy();

    await typeAmount('300000');
    await act(async () => { await fireEvent.press(screen.getByText('Tasdiqlash')); });
    await waitFor(() => expect(server.pushes).toHaveLength(1));
    expect(server.pushes[0]?.payload).toMatchObject({ fromWalletId: 'w1', toWalletId: 'w2', amount: 300000 });
    await screen.findByText('700 000 UZS');
    await screen.findByText('500 000 UZS');
  });

  it('income source -> wallet: opens the income form with the receiving wallet preset; balance and source total update', async () => {
    const L = useLayout(BOXES, ANDROID_STATUS_BAR);
    await ready();
    await L.drag('drag:source:s1', { x: 5, y: 5 }, [{ tx: 215, ty: 175 }]); // window (240, 330) inside w2

    expect(useUi.getState().op).toEqual({ kind: 'income', walletId: 'w2', sourceId: 's1' });
    expect(server.pushes).toHaveLength(0);
    expect(await screen.findByText('Qabul qiluvchi hamyon')).toBeTruthy();

    await typeAmount('500000');
    await act(async () => { await fireEvent.press(screen.getByText('Tasdiqlash')); });
    await waitFor(() => expect(server.pushes).toHaveLength(1));
    expect(server.pushes[0]?.payload).toMatchObject({ walletId: 'w2', incomeSourceId: 's1', amount: 500000 });
    await screen.findByText('700 000 UZS'); // w2: 200 000 + 500 000
    // the source tile's period total comes from the analytics breakdown and shows the new income
    await waitFor(() => expect(screen.getAllByText('500 000 UZS').length).toBeGreaterThan(0));
  });

  it('invalid drops and cancelled touches do nothing and restore the screen', async () => {
    const L = useLayout(BOXES, ANDROID_STATUS_BAR);
    await ready();
    const scroll = () => screen.getByTestId('dash-scroll');

    // wallet dropped on itself
    await L.drag('drag:wallet:w1', { x: 10, y: 10 }, [{ tx: 30, ty: 10 }]);
    // wallet dropped on empty space
    await L.drag('drag:wallet:w1', { x: 10, y: 10 }, [{ tx: 300, ty: 450 }]);
    // income source dropped on a category (not accepted)
    await L.drag('drag:source:s1', { x: 5, y: 5 }, [{ tx: 60, ty: 470 }]);
    expect(useUi.getState().op).toBeNull();

    // Android cancels the touch (parent ScrollView / system took it): no drop, scrolling comes back
    await L.drag('drag:wallet:w1', { x: 10, y: 10 }, [{ tx: 45, ty: 315 }], 'cancel');
    expect(useUi.getState().op).toBeNull();
    expect(scroll().props.scrollEnabled).toBe(true);
    expect(server.pushes).toHaveLength(0);
  });

  it('while a tile is dragged the page ScrollView is locked, and unlocked again after the drop', async () => {
    const L = useLayout(BOXES, ANDROID_STATUS_BAR);
    await ready();
    const rec = gestures.get('drag:wallet:w1')!;
    const ev = { x: 10, y: 10, absoluteX: 30, absoluteY: 334, translationX: 0, translationY: 0 };
    await act(async () => { rec.onStart?.(ev); });
    expect(screen.getByTestId('dash-scroll').props.scrollEnabled).toBe(false);
    await act(async () => { rec.onEnd?.({ ...ev, translationX: 900, translationY: 900 }, true); });
    expect(screen.getByTestId('dash-scroll').props.scrollEnabled).toBe(true);
    expect(L.boxes['dash-wrap']).toBeDefined();
  });

  it('the gesture is a 350 ms long-press pan (taps and normal scrolling are not hijacked)', async () => {
    useLayout(BOXES);
    await ready();
    const rec = gestures.get('drag:wallet:w1')!;
    expect(rec.longPressMs).toBe(350);
  });
});

describe('auto-scroll during a drag keeps drop zones in sync', () => {
  it('dragging to the bottom edge scrolls the page and the category that scrolls under the finger becomes the target', async () => {
    jest.useFakeTimers();
    try {
      // c1 starts below the visible area (y 900) and can only be reached after scrolling
      const boxes = { ...BOXES, 'drop:cat:c1': { x: 20, y: 900, w: 110, h: 50 } };
      const L = useLayout(boxes, ANDROID_STATUS_BAR);
      await renderApp();
      await screen.findByText('1 000 000 UZS');
      await fireEvent(screen.getByTestId('dash-wrap'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } } });
      await fireEvent(screen.getByTestId('dash-scroll'), 'contentSizeChange', 400, 1600);

      const rec = gestures.get('drag:wallet:w1')!;
      const grab = { x: 10, y: 10 };
      const at = (tx: number, ty: number) => ({
        x: grab.x + tx, y: grab.y + ty, absoluteX: 20 + grab.x + tx, absoluteY: 300 + grab.y + ty + 24, translationX: tx, translationY: ty,
      });
      // finger rests at window (75, 770): inside the bottom auto-scroll edge (800 - 84 = 716)
      await act(async () => { rec.onStart?.(at(0, 0)); });
      await act(async () => { rec.onUpdate?.(at(45, 460)); });
      expect(useUi.getState().op).toBeNull();

      // ~10.3px per 16ms tick at this finger depth: 15 ticks scroll ~154px, so the strip (y 900..950) now spans y 746..796 and lies under the finger (770)
      for (let i = 0; i < 15; i += 1) await act(async () => { jest.advanceTimersByTime(16); });
      await act(async () => { rec.onEnd?.(at(45, 460), true); });

      expect(useUi.getState().op).toEqual({ kind: 'expense', walletId: 'w1', categoryId: 'c1' });
      expect(L.boxes['drop:cat:c1']!.y).toBe(900); // the static fixture never moved; only the tracked rect did
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('tap path (the permanent alternative to drag & drop)', () => {
  it('wallet tap -> Xarajat -> category -> amount -> confirm works without any dragging', async () => {
    useLayout(BOXES);
    await ready();

    await fireEvent.press(screen.getByLabelText('Bank kartasi 1 000 000 UZS'));
    await fireEvent.press(await screen.findByLabelText('Xarajat'));
    expect(useUi.getState().op).toEqual({ kind: 'expense', walletId: 'w1' });

    expect(await screen.findByText('To‘lov hamyoni')).toBeTruthy();
    // no category yet -> a clear message, nothing sent
    await typeAmount('50000');
    await act(async () => { await fireEvent.press(screen.getByText('Tasdiqlash')); });
    expect(await screen.findByText('Toifani tanlang')).toBeTruthy();
    expect(server.pushes).toHaveLength(0);

    await fireEvent.press(within(screen.getByTestId('sheet-scroll')).getByLabelText('Kommunal'));
    await act(async () => { await fireEvent.press(screen.getByText('Tasdiqlash')); });
    await waitFor(() => expect(server.pushes).toHaveLength(1));
    expect(server.pushes[0]?.payload).toMatchObject({ walletId: 'w1', categoryId: 'c1', amount: 50000 });
    await screen.findByText('950 000 UZS');
  });
});



