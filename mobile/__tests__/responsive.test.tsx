import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import type { SeriesPoint } from '@/api/types';
import { Donut, arcPath, barsLayout, donutSlices } from '@/design/charts';
import { breakpointOf, layoutFor } from '@/design/layout';
import { Analytics } from '@/features/Analytics';
import { compactMoney } from '@/lib/money';
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
  const day = (i: number, income: number, expense: number): SeriesPoint => ({
    period: `2026-10-${String(i).padStart(2, '0')}`, start: `2026-10-${String(i).padStart(2, '0')}T00:00:00Z`, currency: 'UZS', income, expense,
  });
  const points = Array.from({ length: 31 }, (_, i) => day(i + 1, (i % 5) * 1_000_000, (i % 3) * 400_000));

  it.each([232, 256, 320, 700, 1100])('bars and labels stay inside a %ipx wide chart', (width) => {
    const g = barsLayout(points, width, 180);
    expect(g.bars.length).toBeGreaterThan(0);
    for (const b of g.bars) {
      expect(b.x).toBeGreaterThanOrEqual(g.axisW - 1);
      expect(b.x + b.w).toBeLessThanOrEqual(width);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.w).toBeGreaterThanOrEqual(3); // never squeezed to nothing
    }
    for (const l of [...g.labels, ...g.grid.map((x) => x.label)]) {
      expect(l.x).toBeLessThanOrEqual(width);
      expect(l.y).toBeLessThanOrEqual(180);
    }
    // x labels never overlap
    for (let i = 1; i < g.labels.length; i += 1) expect(g.labels[i]!.x - g.labels[i - 1]!.x).toBeGreaterThanOrEqual(36);
  });

  it('narrow charts show fewer periods instead of squeezing bars', () => {
    expect(barsLayout(points, 256, 180).count).toBeLessThan(barsLayout(points, 900, 180).count);
    expect(barsLayout(points, 900, 180).count).toBe(31);
  });

  it('value axis uses compact, readable labels', () => {
    expect([compactMoney(0), compactMoney(950), compactMoney(12_000), compactMoney(1_500_000), compactMoney(2_000_000_000)])
      .toEqual(['0', '950', '12k', '1.5 mln', '2 mlrd']);
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
    expect(donutSlices([100], 120, 16).slices).toEqual([{ color: expect.any(String), kind: 'ring' }]);
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
describe('analytics screen with real (fake-ledger) data', () => {
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
    await setWindow(original.width, original.height);
  });

  async function layoutAll() {
    for (const id of ['breakdown-UZS', 'bars-UZS']) {
      const n = screen.queryByTestId(id);
      if (n) await fireEvent(n, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 180 } } });
    }
  }

  it.each([[375, 812], [1024, 768], [1440, 900]])('renders KPIs, breakdown and trend from the backend at %ix%i', async (w, h) => {
    await setWindow(w, h);
    await renderApp(<Analytics />);
    expect(await screen.findByTestId('kpi-UZS')).toHaveTextContent(/Kirim2\.0 mln/);
    expect(screen.getByTestId('kpi-UZS')).toHaveTextContent(/Xarajat400 000/);
    expect(screen.getByTestId('kpi-UZS')).toHaveTextContent(/Sof oqim1\.6 mln/);
    await screen.findByTestId('breakdown-UZS');
    await screen.findByTestId('bars-UZS');
    await layoutAll();
    const tree = JSON.stringify(screen.toJSON());
    expect(tree).toMatch(/400\s000/); // donut centre: total expense (thin/no-break space)
    expect(tree).not.toMatch(/"origin"|"rotation"/);
  });
});
