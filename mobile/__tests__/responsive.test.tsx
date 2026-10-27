import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { Donut, arcPath, barsLayout, donutSlices, type Pair } from '@/design/charts';
import { breakpointOf, layoutFor } from '@/design/layout';
import { Reports } from '@/features/reports/Reports';
import { compactMoney } from '@/lib/money';
import { useReports } from '@/state/reports';
import { useSettings } from '@/state/settings';
import { FakeServer, category, wallet } from '../test-utils/fakeServer';
import { renderApp } from '../test-utils/ui';

jest.mock('react-native-gesture-handler', () => jest.requireActual('../test-utils/gestureMock'));
jest.setTimeout(30000);

async function setWindow(width: number, height: number) {
  const d = { width, height, scale: 2, fontScale: 1 };
  await act(async () => { Dimensions.set({ window: d, screen: d }); });
}

describe('breakpoints', () => {
  it.each([
    [320, 'mobile'], [375, 'mobile'], [390, 'mobile'], [430, 'mobile'], [767, 'mobile'],
    [768, 'tablet'], [1024, 'tablet'], [1199, 'tablet'],
    [1200, 'desktop'], [1366, 'desktop'], [1440, 'desktop'], [1920, 'desktop'],
  ] as const)('%ipx is %s', (w, bp) => {
    expect(breakpointOf(w)).toBe(bp);
  });

  it('desktop navigates with a sidebar and needs no room for a bottom bar; phones do', () => {
    expect(layoutFor(1440)).toMatchObject({ sidebar: true, cardColumns: 3 });
    expect(layoutFor(1024)).toMatchObject({ sidebar: false, cardColumns: 2 });
    expect(layoutFor(375)).toMatchObject({ sidebar: false, cardColumns: 1 });
    expect(layoutFor(375).bottomSpace).toBeGreaterThan(layoutFor(1440).bottomSpace);
  });
});

describe('charts fit their container', () => {
  const pair = (i: number, income: number, expense: number): Pair => ({ label: `${i} okt`, income, expense });
  const points = Array.from({ length: 31 }, (_, i) => pair(i + 1, (i % 5) * 1_000_000, (i % 3) * 400_000));

  it.each([232, 256, 320, 700, 1100])('every day of a month fits a %ipx wide chart; bars and labels stay inside', (width) => {
    const g = barsLayout(points, width, 180);
    expect(g.count).toBe(31); // a whole month on a phone: no days dropped
    expect(g.bars.length).toBeGreaterThan(0);
    for (const b of g.bars) {
      expect(b.x).toBeGreaterThanOrEqual(47);
      expect(b.x + b.w).toBeLessThanOrEqual(width);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.w).toBeGreaterThanOrEqual(2); // never squeezed to nothing
    }
    for (const l of [...g.labels, ...g.grid.map((x) => x.label)]) {
      expect(l.x).toBeLessThanOrEqual(width);
      expect(l.y).toBeLessThanOrEqual(180);
    }
    // x labels never overlap
    for (let i = 1; i < g.labels.length; i += 1) expect(g.labels[i]!.x - g.labels[i - 1]!.x).toBeGreaterThanOrEqual(40);
  });

  it('only an extremely narrow chart drops the oldest periods (and reports the offset for tooltips)', () => {
    const g = barsLayout(points, 160, 180);
    expect(g.count).toBeLessThan(31);
    expect(g.offset).toBe(31 - g.count);
  });

  it('value axis uses compact, readable labels', () => {
    expect([compactMoney(0), compactMoney(950), compactMoney(12_000), compactMoney(1_500_000), compactMoney(2_000_000_000)])
      .toEqual(['0', '950', '12 ming', '1,5 mln', '2 mlrd']);
  });
});
describe('donut geometry (no group rotation / transform-origin)', () => {
  it('centre and radius come from the given size; slices are arcs starting at 12 o\'clock', () => {
    const g = donutSlices([50, 30, 20], 180, 20);
    expect([g.c, g.r]).toEqual([90, 80]);
    expect(g.slices.map((s) => s.kind)).toEqual(['arc', 'arc', 'arc']);
    expect(g.slices[0]!.d!.startsWith('M90.00,10.00')).toBe(true); // top of the ring
  });

  it('a single 100% slice is a full ring; an empty breakdown has no slices', () => {
    expect(donutSlices([100], 120, 16).slices).toEqual([{ color: expect.any(String), kind: 'ring', index: 0 }]);
    expect(donutSlices([], 120, 16).slices).toEqual([]);
    expect(donutSlices([0, 0], 120, 16).slices).toEqual([]);
  });

  it('arc path uses the large-arc flag past 180 degrees', () => {
    expect(arcPath(50, 40, 0, 90)).toContain(' 0 0 1 ');
    expect(arcPath(50, 40, 0, 270)).toContain(' 0 1 1 ');
  });

  it('the rendered donut passes no origin / rotation props (source of the web transform-origin warning)', async () => {
    await render(<Donut size={150} percents={[60, 40]} />);
    const json = JSON.stringify(screen.toJSON());
    expect(json).not.toMatch(/"origin"|"rotation"/);
  });
});
describe('reports screen with real (fake-ledger) data', () => {
  let server: FakeServer;
  let restore: () => void;
  const original = Dimensions.get('window');

  beforeEach(() => {
    useSettings.setState({ lang: 'uz', reduceEffects: true });
    server = new FakeServer();
    server.wallets = [wallet('w1', 'Bank kartasi', 1_000_000)];
    server.categories = [category('c1', 'Kommunal'), category('c2', 'Transport')];
    const at = new Date().toISOString();
    const base = { createdAt: at, occurredAt: at, currency: 'UZS', walletId: 'w1' };
    server.txs = [
      { ...base, id: 't1', type: 1, amount: 2_000_000, incomeSourceId: 's1' },
      { ...base, id: 't2', type: 2, amount: 300_000, categoryId: 'c1' },
      { ...base, id: 't3', type: 2, amount: 100_000, categoryId: 'c2' },
    ] as never;
    restore = server.install();
  });
  afterEach(async () => {
    restore();
    useReports.setState({ filter: { kind: 'expense', preset: 'month', anchor: new Date().toISOString() } });
    await setWindow(original.width, original.height);
  });

  async function layoutAll() {
    for (const id of ['main-chart', 'distribution-UZS']) {
      const n = screen.queryByTestId(id);
      if (n) await fireEvent(n, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 200 } } });
    }
  }

  it.each([[375, 812], [1024, 768], [1440, 900]])('reports render statistics, the chart and the distribution from the backend at %ix%i', async (w, h) => {
    await setWindow(w, h);
    useReports.setState({ filter: { kind: 'compare', preset: 'month', anchor: new Date().toISOString() } });
    await renderApp(<Reports />);
    expect(await screen.findByText('2 000 000 UZS')).toBeTruthy();
    expect(screen.getByTestId('stat-expense-value')).toHaveTextContent('400 000 UZS');
    expect(screen.getByTestId('stat-net-value')).toHaveTextContent('+1 600 000 UZS');
    await screen.findByTestId('main-chart');
    await layoutAll();
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/"origin"|"rotation"/);

    await fireEvent.press(screen.getByTestId('kind-expense'));
    await screen.findByTestId('distribution-UZS');
    await layoutAll();
    expect(JSON.stringify(screen.toJSON())).toMatch(/400\s000/); // donut centre: total expense (narrow no-break space)
  });
});