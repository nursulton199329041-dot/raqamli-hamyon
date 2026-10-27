import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import { Dashboard } from '@/features/Dashboard';
import { OperationSheet } from '@/features/OperationSheet';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { FakeServer, category, source, wallet } from '../test-utils/fakeServer';
import { gestures } from '../test-utils/gestureMock';
import { useLayout } from '../test-utils/layout';
import { endpoint, footerHas, renderApp, save, shownAmount, textOf, typeKeys } from '../test-utils/ui';

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

async function ready() {
  await renderApp(<><Dashboard /><OperationSheet /></>);
  await screen.findByText('1 000 000 UZS');
}

beforeEach(() => {
  useSettings.setState({ lang: 'uz', reduceEffects: true });
  useUi.setState({ op: null, lastOp: null, form: null, formId: null });
  server = new FakeServer();
  server.wallets = [wallet('w1', 'Bank kartasi', 1_000_000), wallet('w2', 'Naqd pul', 200_000, { type: 0, icon: 'cash' })];
  server.categories = [category('c1', 'Kommunal'), category('c1a', 'Svet', { parentId: 'c1' })];
  server.sources = [source('s1', 'Maosh')];
  restore = server.install();
});
afterEach(() => restore());

describe('dashboard: three sections, always-visible balances', () => {
  it('shows income sources, wallets (balance under each icon) and expense categories with section totals; sub-categories stay out of the grid', async () => {
    useLayout(BOXES);
    await ready();
    expect(screen.getByText('Kirim manbalari')).toBeTruthy();
    expect(screen.getByText('Hamyonlar')).toBeTruthy();
    expect(screen.getByText('Xarajat toifalari')).toBeTruthy();
    expect(within(screen.getByTestId('drag:wallet:w1')).getByText('1 000 000 UZS')).toBeTruthy();
    expect(within(screen.getByTestId('drag:wallet:w2')).getByText('200 000 UZS')).toBeTruthy();
    expect(textOf('section-wallets-total')).toBe('1 200 000 UZS');
    expect(textOf('section-income-total')).toBe('0');
    expect(screen.getAllByText('Kommunal').length).toBeGreaterThan(0);
    expect(screen.queryByText('Svet')).toBeNull(); // sub-category is chosen inside the operation form
  });

  it('grid: wallets are 2 per row, expense categories 3 per row, income sources 4 per row', async () => {
    useLayout(BOXES);
    await ready();
    const cellWidth = (id: string) => {
      let n = screen.getByTestId(id).parent;
      while (n && !(n.props?.style && !Array.isArray(n.props.style) && n.props.style.width)) n = n.parent;
      return n?.props.style.width;
    };
    expect(cellWidth('drop:wallet:w1')).toBe('50%');
    expect(cellWidth('drop:cat:c1')).toBe('33.3333%');
    expect(cellWidth('drag:source:s1')).toBe('25%');
  });

  it('collapsing a section hides its tiles without touching data', async () => {
    useLayout(BOXES);
    await ready();
    await fireEvent.press(screen.getByTestId('section-wallets-header'));
    expect(screen.queryByTestId('drag:wallet:w1')).toBeNull();
    await fireEvent.press(screen.getByTestId('section-wallets-header'));
    expect(screen.getByTestId('drag:wallet:w1')).toBeTruthy();
  });
});

describe('dashboard drag & drop (Android-like touch space: absoluteY is 24px below the window space)', () => {
  it('wallet -> category: opens a pre-filled expense form, moves NO money until saved, then updates balance and category total', async () => {
    const L = useLayout(BOXES, ANDROID_STATUS_BAR);
    await ready();

    await L.drag('drag:wallet:w1', { x: 10, y: 10 }, [{ tx: 10, ty: 100 }, { tx: 45, ty: 315 }]);

    expect(useUi.getState().op).toEqual({ kind: 'expense', walletId: 'w1', categoryId: 'c1' });
    expect(server.pushes).toHaveLength(0); // nothing sent yet
    expect(server.wallets[0]?.balance).toBe(1_000_000);

    // wallet and category are preselected; the amount is empty and the keypad is already up
    expect(await endpoint('from-endpoint').findByText('Bank kartasi')).toBeTruthy();
    expect(endpoint('category-endpoint').getByText('Kommunal')).toBeTruthy();
    expect(screen.getByTestId('keypad')).toBeTruthy();
    expect(shownAmount()).toBe('0');

    await typeKeys('150000');
    expect(shownAmount()).toBe('150 000');
    await save();

    await waitFor(() => expect(server.pushes).toHaveLength(1));
    expect(server.pushes[0]?.payload).toMatchObject({ walletId: 'w1', categoryId: 'c1', amount: 150000 });
    await screen.findByText('850 000 UZS'); // dashboard refreshed from the ledger
    await waitFor(() => expect(textOf('section-expense-total')).toBe('150 000 UZS'));
    expect(useUi.getState().op).toBeNull();
  });

  it('wallet -> wallet: opens a transfer with both wallets chosen and moves money only after saving', async () => {
    const L = useLayout(BOXES, ANDROID_STATUS_BAR);
    await ready();
    await L.drag('drag:wallet:w1', { x: 10, y: 10 }, [{ tx: 200, ty: 20 }]); // finger -> window (230, 330) inside w2

    expect(useUi.getState().op).toEqual({ kind: 'transfer', walletId: 'w1', toWalletId: 'w2' });
    expect(server.pushes).toHaveLength(0);
    expect(await endpoint('from-endpoint').findByText('Bank kartasi')).toBeTruthy();
    expect(endpoint('to-endpoint').getByText('Naqd pul')).toBeTruthy();

    await typeKeys('300000');
    await save();
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
    expect(await endpoint('source-endpoint').findByText('Maosh')).toBeTruthy();
    expect(endpoint('to-endpoint').getByText('Naqd pul')).toBeTruthy();

    await typeKeys('500000');
    await save();
    await waitFor(() => expect(server.pushes).toHaveLength(1));
    expect(server.pushes[0]?.payload).toMatchObject({ walletId: 'w2', incomeSourceId: 's1', amount: 500000 });
    await screen.findByText('700 000 UZS'); // w2: 200 000 + 500 000
    await waitFor(() => expect(textOf('section-income-total')).toBe('500 000 UZS'));
  });

  it('invalid drops and cancelled touches do nothing and restore the screen', async () => {
    const L = useLayout(BOXES, ANDROID_STATUS_BAR);
    await ready();
    const scroll = () => screen.getByTestId('dash-scroll');

    await L.drag('drag:wallet:w1', { x: 10, y: 10 }, [{ tx: 30, ty: 10 }]); // on itself
    await L.drag('drag:wallet:w1', { x: 10, y: 10 }, [{ tx: 300, ty: 450 }]); // empty space
    await L.drag('drag:source:s1', { x: 5, y: 5 }, [{ tx: 60, ty: 470 }]); // source on a category (not accepted)
    expect(useUi.getState().op).toBeNull();

    // Android cancels the touch (parent ScrollView / system took it): no drop, scrolling comes back
    await L.drag('drag:wallet:w1', { x: 10, y: 10 }, [{ tx: 45, ty: 315 }], 'cancel');
    expect(useUi.getState().op).toBeNull();
    expect(scroll().props.scrollEnabled).toBe(true);
    expect(server.pushes).toHaveLength(0);
  });

  it('while a tile is dragged the page ScrollView is locked, and unlocked again after the drop', async () => {
    useLayout(BOXES, ANDROID_STATUS_BAR);
    await ready();
    const rec = gestures.get('drag:wallet:w1')!;
    const ev = { x: 10, y: 10, absoluteX: 30, absoluteY: 334, translationX: 0, translationY: 0 };
    await act(async () => { rec.onStart?.(ev); });
    expect(screen.getByTestId('dash-scroll').props.scrollEnabled).toBe(false);
    await act(async () => { rec.onEnd?.({ ...ev, translationX: 900, translationY: 900 }, true); });
    // a missed drop flies the tile back first (~200 ms), then the page unlocks
    await waitFor(() => expect(screen.getByTestId('dash-scroll').props.scrollEnabled).toBe(true));
  });

  it('the gesture is a 350 ms long-press pan (taps and normal scrolling are not hijacked)', async () => {
    useLayout(BOXES);
    await ready();
    expect(gestures.get('drag:wallet:w1')!.longPressMs).toBe(350);
  });
});

describe('auto-scroll during a drag keeps drop zones in sync', () => {
  // The category strip lives in CONTENT space at y=900 and moves up by the REAL scroll offset. The native scroll events the
  // page receives LAG behind the real offset (as on a busy Android UI thread), which used to make the shifted zone rectangle
  // drift away from the real one -> the drop landed on "nothing" (drop:null).
  it.each([
    ['accurate scroll events', 0],
    ['scroll events lagging 40px behind', 40],
  ])('dragging to the bottom edge scrolls the page and the category that scrolls under the finger becomes the target (%s)', async (_n, lag) => {
    jest.useFakeTimers();
    try {
      let realScroll = 0;
      const spy = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(((o: { y: number }) => { realScroll = o.y; }) as never);
      const boxes = { ...BOXES, 'drop:cat:c1': { x: 20, y: 900, w: 110, h: 50 } };
      Object.defineProperty(boxes['drop:cat:c1'], 'y', { get: () => 900 - realScroll, enumerable: true });
      useLayout(boxes, ANDROID_STATUS_BAR);
      await renderApp(<><Dashboard /><OperationSheet /></>);
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

      for (let i = 0; i < 15; i += 1) {
        await act(async () => { jest.advanceTimersByTime(16); });
        await fireEvent(screen.getByTestId('dash-scroll'), 'scroll', { nativeEvent: { contentOffset: { x: 0, y: Math.max(0, realScroll - lag) } } });
      }
      expect(realScroll).toBeGreaterThan(100); // the page really scrolled
      await act(async () => { rec.onEnd?.(at(45, 460), true); });

      expect(useUi.getState().op).toEqual({ kind: 'expense', walletId: 'w1', categoryId: 'c1' });
      spy.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('tap path (the permanent alternative to drag & drop)', () => {
  it('wallet tap -> Xarajat -> category -> amount -> save works without any dragging', async () => {
    useLayout(BOXES);
    await ready();

    await fireEvent.press(screen.getByLabelText('Bank kartasi 1 000 000 UZS'));
    await fireEvent.press(await screen.findByLabelText('Xarajat'));
    expect(useUi.getState().op).toEqual({ kind: 'expense', walletId: 'w1' });

    // no category yet -> a clear message, nothing sent; pick it on the category page of the same sheet
    await typeKeys('50000');
    await save();
    expect(await footerHas('Toifani tanlang')).toBeTruthy();
    expect(server.pushes).toHaveLength(0);

    await fireEvent.press(screen.getByTestId('category-endpoint'));
    await fireEvent.press(await within(screen.getByTestId('sheet-scroll')).findByLabelText('Kommunal'));
    await save();
    await waitFor(() => expect(server.pushes).toHaveLength(1));
    expect(server.pushes[0]?.payload).toMatchObject({ walletId: 'w1', categoryId: 'c1', amount: 50000 });
    await screen.findByText('950 000 UZS');
  });

  it('category tap opens an expense form for that category with the first wallet as default', async () => {
    useLayout(BOXES);
    await ready();
    await fireEvent.press(within(screen.getByTestId('drop:cat:c1')).getByLabelText('Kommunal'));
    expect(useUi.getState().op).toEqual({ kind: 'expense', categoryId: 'c1' });
    expect(await endpoint('from-endpoint').findByText('Bank kartasi')).toBeTruthy();
  });
});
