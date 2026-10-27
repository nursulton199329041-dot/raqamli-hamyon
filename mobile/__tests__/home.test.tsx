import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import { MAIN_TABS, SECONDARY_ROUTES } from '@/design/navItems';
import { lookOf } from '@/design/look';
import { Dashboard } from '@/features/Dashboard';
import { OperationSheet } from '@/features/OperationSheet';
import { Settings } from '@/features/Settings';
import { DEFAULT_APPEARANCE, sanitizeAppearance, useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { FakeServer, category, source, wallet } from '../test-utils/fakeServer';
import { gestures, type PanEvent } from '../test-utils/gestureMock';
import { useLayout, type Box } from '../test-utils/layout';
import { renderApp } from '../test-utils/ui';

const mockPush = jest.fn();
jest.mock('react-native-gesture-handler', () => jest.requireActual('../test-utils/gestureMock'));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));
jest.setTimeout(30000);

let server: FakeServer;
let restore: () => void;

beforeEach(() => {
  mockPush.mockClear();
  useSettings.setState({ lang: 'uz', reduceEffects: true, appearance: DEFAULT_APPEARANCE });
  useUi.setState({ op: null, lastOp: null, form: null, formId: null });
  server = new FakeServer();
  server.wallets = [wallet('w1', 'Karta', 1_000_000), wallet('w2', 'Naqd', 200_000)];
  server.categories = [category('c1', 'Kommunal'), category('c2', 'Transport')];
  server.sources = [source('s1', 'Maosh')];
  restore = server.install();
});
afterEach(() => restore());

async function home() {
  await renderApp(<><Dashboard /><OperationSheet /></>);
  await screen.findByText('Karta');
}

describe('home: income -> wallets -> expenses, nothing else', () => {
  it('shows exactly the three sections in the default order; no balance card, projects or debts', async () => {
    await home();
    const titles = screen.getAllByRole('header').map((h) => h.props.children);
    expect(titles).toEqual(['Kirim manbalari', 'Hamyonlar', 'Xarajat toifalari']);
    expect(screen.queryByTestId('balance-summary')).toBeNull();
    expect(screen.queryByText('Loyihalar')).toBeNull();
    expect(screen.queryByText('Qarzlar')).toBeNull();
  });

  it('order and visibility follow the Appearance settings', async () => {
    useSettings.setState({ appearance: { ...DEFAULT_APPEARANCE, sectionOrder: ['expense', 'wallets', 'income'], hiddenSections: ['income'] } });
    await home();
    expect(screen.getAllByRole('header').map((h) => h.props.children)).toEqual(['Xarajat toifalari', 'Hamyonlar']);
  });

  it('a tap on an icon opens the right operation; the "+" at a row end opens the create form', async () => {
    await home();
    await fireEvent.press(within(screen.getByTestId('row-scroll-expense')).getByLabelText('Transport'));
    expect(useUi.getState().op).toEqual({ kind: 'expense', categoryId: 'c2' });
    useUi.setState({ op: null });
    await fireEvent.press(within(screen.getByTestId('row-scroll-expense')).getByLabelText('Yangi toifa'));
    expect(useUi.getState().form).toBe('category');
  });
});

describe('navigation', () => {
  it('the main navigation has exactly Home, History, Reports, Settings', () => {
    expect(MAIN_TABS.map((t) => t.name)).toEqual(['index', 'history', 'analytics', 'settings']);
    expect(MAIN_TABS.map((t) => t.key)).toEqual(['home', 'history', 'reports', 'settings']);
    expect(MAIN_TABS.some((t) => (SECONDARY_ROUTES as readonly string[]).includes(t.name))).toBe(false);
  });

  it('projects and debts stay reachable from Settings (data and APIs untouched)', async () => {
    await renderApp(<Settings />);
    await fireEvent.press(screen.getByTestId('open-projects'));
    await fireEvent.press(screen.getByTestId('open-debts'));
    expect(mockPush.mock.calls.map((c) => c[0])).toEqual(['/projects', '/debts']);
  });
});

describe('appearance', () => {
  it('unknown or partial stored values fall back to defaults; the section order always holds all three', () => {
    const a = sanitizeAppearance({ uiStyle: 'neon' as never, iconSize: 'xl' as never, accent: 'red', sectionOrder: ['wallets'], hiddenSections: ['x' as never] });
    expect(a).toMatchObject({ uiStyle: 'liquid', iconSize: 'm', accent: null, sectionOrder: ['wallets', 'income', 'expense'], hiddenSections: [] });
  });

  it('presets change the look consistently (office/minimal: no blur, flat badges; animations off = motion off)', () => {
    expect(lookOf({ ...DEFAULT_APPEARANCE, uiStyle: 'office' }, false, false)).toMatchObject({ glass: false, badge: 'flat' });
    expect(lookOf({ ...DEFAULT_APPEARANCE, uiStyle: 'colorful' }, false, false)).toMatchObject({ glass: true, badge: 'vivid', tintSections: true });
    expect(lookOf({ ...DEFAULT_APPEARANCE, iconSize: 'l' }, false, false).iconPx).toBeGreaterThan(lookOf(DEFAULT_APPEARANCE, false, false).iconPx);
    expect(lookOf({ ...DEFAULT_APPEARANCE, animations: false }, false, false).motionOff).toBe(true);
    expect(lookOf(DEFAULT_APPEARANCE, false, true).motionOff).toBe(true); // OS reduce motion
  });

  it('changes from the Settings screen are saved and restored on the next start', async () => {
    await renderApp(<Settings />);
    await fireEvent.press(screen.getByLabelText('Rang-barang'));
    await fireEvent.press(screen.getByTestId('down-income'));
    await fireEvent.press(screen.getByTestId('accent-#1FCB8B'));
    expect(useSettings.getState().appearance).toMatchObject({ uiStyle: 'colorful', accent: '#1FCB8B', sectionOrder: ['wallets', 'income', 'expense'] });
    useSettings.setState({ appearance: DEFAULT_APPEARANCE, hydrated: false });
    await act(async () => { await useSettings.getState().hydrate(); });
    await waitFor(() => expect(useSettings.getState().appearance).toMatchObject({ uiStyle: 'colorful', accent: '#1FCB8B', sectionOrder: ['wallets', 'income', 'expense'] }));
  });
});

describe('drag & drop inside horizontal rows', () => {
  /**
   * The expense row (window x 0..400 at y 500) was scrolled 100px by the user before the drag. The wallet is dragged to the
   * row's right end: the row auto-scrolls and Transport (content x 700) slides under the finger. Measurements of the row's
   * children lag 60px behind the real offset (Fabric shadow-tree state), as on a device.
   */
  it('a category that scrolls under the finger sideways receives the drop (lagging measurements cannot misplace it)', async () => {
    jest.useFakeTimers();
    const row = { real: 0, reported: 0 };
    const spy = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(((o: { x?: number }) => { if (o.x !== undefined) row.real = o.x; }) as never);
    const content = (x: number, y: number): Box => {
      const b = { x: 0, y, w: 80, h: 90 };
      Object.defineProperty(b, 'x', { get: () => x - row.reported, enumerable: true });
      return b;
    };
    const boxes: Record<string, Box> = {
      'dash-wrap': { x: 0, y: 0, w: 400, h: 800 },
      'drag:wallet:w1': { x: 20, y: 300, w: 80, h: 90 },
      'row-expense': { x: 0, y: 500, w: 400, h: 110 },
      'drop:cat:c1': content(20, 510),
      'drop:cat:c2': content(700, 510),
    };
    try {
      useLayout(boxes);
      await home();
      await fireEvent(screen.getByTestId('row-expense'), 'layout', { nativeEvent: { layout: { x: 0, y: 500, width: 400, height: 110 } } });
      await fireEvent(screen.getByTestId('row-scroll-expense'), 'contentSizeChange', 1200, 110);
      // the user swiped the row before dragging
      row.real = 100;
      row.reported = 100;
      await fireEvent(screen.getByTestId('row-scroll-expense'), 'scroll', { nativeEvent: { contentOffset: { x: 100, y: 0 } } });

      const rec = gestures.get('drag:wallet:w1')!;
      const ev = (tx: number, ty: number): PanEvent => ({ x: 10 + tx, y: 10 + ty, absoluteX: 30 + tx, absoluteY: 310 + ty, translationX: tx, translationY: ty });
      await act(async () => { rec.onStart?.(ev(0, 0)); });
      await act(async () => { rec.onUpdate?.(ev(360, 240)); }); // finger at window (390, 550): right end of the expense row
      for (let i = 0; i < 20; i += 1) {
        await act(async () => { jest.advanceTimersByTime(16); });
        row.reported = Math.max(100, row.real - 60);
      }
      expect(row.real).toBeGreaterThanOrEqual(310); // Transport (700..780) now spans the finger's x = 390
      expect(row.real).toBeLessThanOrEqual(390);
      await act(async () => { rec.onEnd?.(ev(360, 240), true); });
      await act(async () => { jest.advanceTimersByTime(200); });
      expect(useUi.getState().op).toEqual({ kind: 'expense', walletId: 'w1', categoryId: 'c2' });
      expect(server.pushes).toHaveLength(0); // nothing moves before confirmation
    } finally {
      spy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('rows do not scroll natively while a drag runs (swipe and drag never fight)', async () => {
    useLayout({ 'drag:wallet:w1': { x: 20, y: 300, w: 80, h: 90 } });
    await home();
    expect(screen.getByTestId('row-scroll-wallets').props.scrollEnabled).toBe(true);
    const rec = gestures.get('drag:wallet:w1')!;
    await act(async () => { rec.onStart?.({ x: 10, y: 10, absoluteX: 30, absoluteY: 310, translationX: 0, translationY: 0 }); });
    for (const r of ['income', 'wallets', 'expense']) expect(screen.getByTestId(`row-scroll-${r}`).props.scrollEnabled).toBe(false);
    await act(async () => { rec.onFinalize?.({ x: 10, y: 10, absoluteX: 30, absoluteY: 310, translationX: 0, translationY: 0 }, false); });
    await waitFor(() => expect(screen.getByTestId('row-scroll-wallets').props.scrollEnabled).toBe(true));
  });
});
