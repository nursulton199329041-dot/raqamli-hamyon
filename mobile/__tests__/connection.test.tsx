import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Auth } from '@/features/Auth';
import { OperationSheet } from '@/features/OperationSheet';
import { checkConnection, isValidBaseUrl, probeUrl } from '@/lib/connection';
import { useQueue } from '@/state/queue';
import { api, queryClient } from '@/state/runtime';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { FakeServer, wallet } from '../test-utils/fakeServer';
import { gestures } from '../test-utils/gestureMock';
import { useLayout } from '../test-utils/layout';
import { endpoint, renderApp, textOf } from '../test-utils/ui';

jest.mock('react-native-gesture-handler', () => jest.requireActual('../test-utils/gestureMock'));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.setTimeout(30000);

const okResponse = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

describe('checkConnection (what kind of failure is it?)', () => {
  it('builds the exact probe URL and validates the base URL', () => {
    expect(probeUrl('http://192.168.1.5:5080/')).toBe('http://192.168.1.5:5080/api/meta/client-policy');
    expect(isValidBaseUrl('http://192.168.1.5:5080')).toBe(true);
    expect(isValidBaseUrl('192.168.1.5:5080')).toBe(false);
    expect(isValidBaseUrl('http://')).toBe(false);
  });

  it('ok: reachable server reports its API version', async () => {
    const r = await checkConnection('http://x:5080', 1000, (async () => okResponse({ apiVersion: 1 })) as unknown as typeof fetch);
    expect(r).toMatchObject({ kind: 'ok', ok: true, status: 200, apiVersion: 1, url: 'http://x:5080/api/meta/client-policy' });
  });

  it('http: a server that answers with an error is not "no connection"', async () => {
    const r = await checkConnection('http://x:5080', 1000, (async () => okResponse(null, 500)) as unknown as typeof fetch);
    expect(r).toMatchObject({ kind: 'http', ok: false, status: 500 });
  });

  it('refused: an immediate transport failure (wrong port, server off, cleartext blocked)', async () => {
    const r = await checkConnection('http://x:5080', 1000, (async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch);
    expect(r.kind).toBe('refused');
    expect(r.ok).toBe(false);
  });

  it('timeout: packets dropped (wrong IP / other Wi-Fi / firewall) - the probe gives up after the limit', async () => {
    const hang = ((_u: string, init: { signal: AbortSignal }) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(new Error('aborted')));
    })) as unknown as typeof fetch;
    const r = await checkConnection('http://192.168.1.2:5080', 400, hang);
    expect(r.kind).toBe('timeout');
    expect(r.ms).toBeGreaterThanOrEqual(150);
  });

  it('invalid: a malformed address never touches the network', async () => {
    const f = jest.fn();
    const r = await checkConnection('192.168.1.5', 1000, f as unknown as typeof fetch);
    expect(r.kind).toBe('invalid');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('login screen diagnostics work without a server', () => {
  let server: FakeServer;
  let restore: () => void;
  beforeEach(() => {
    useSettings.setState({ lang: 'uz', reduceEffects: true, apiUrl: 'http://192.168.1.2:5080' });
    server = new FakeServer();
    restore = server.install();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    restore();
  });

  it('shows the API URL in use, the exact probe URL and the OTA line; the check reports an unreachable server clearly', async () => {
    global.fetch = jest.fn(async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch;
    await renderApp(<Auth />);
    expect(textOf('conn-url')).toBe('http://192.168.1.2:5080');
    expect(textOf('conn-probe')).toBe('http://192.168.1.2:5080/api/meta/client-policy');
    expect(textOf('conn-ota')).toContain('OTA:');
    await fireEvent.press(screen.getByTestId('conn-check'));
    await waitFor(() => expect(textOf('conn-result')).toContain('Serverga ulanib bo‘lmadi'));
    expect(global.fetch).toHaveBeenCalledWith('http://192.168.1.2:5080/api/meta/client-policy', expect.anything());
  });

  it('a reachable server shows the API version and latency', async () => {
    global.fetch = jest.fn(async () => okResponse({ apiVersion: 1 })) as unknown as typeof fetch;
    await renderApp(<Auth />);
    await fireEvent.press(screen.getByTestId('conn-check'));
    await waitFor(() => expect(textOf('conn-result')).toMatch(/^Server javob berdi: API v1, \d+ ms$/));
  });

  it('touch test opens from the login screen, calls no API and reports a drop in the zone (Android 24px offset)', async () => {
    const calls = [jest.spyOn(api, 'get'), jest.spyOn(api, 'post')];
    const L = useLayout({
      'drag:wallet:diag-wallet': { x: 150, y: 120, w: 90, h: 80 },
      'drop:diag:wallet': { x: 150, y: 120, w: 90, h: 80 },
      'drop:diag:A': { x: 20, y: 400, w: 120, h: 40 },
      'drop:diag:B': { x: 200, y: 400, w: 120, h: 40 },
    }, { x: 0, y: 24 });
    await renderApp(<Auth />);
    await fireEvent.press(screen.getByTestId('open-diag'));
    expect(await screen.findByTestId('diag-offset')).toBeTruthy();
    expect(screen.getByText('Server shart emas — bu ekran faqat sensorni sinaydi')).toBeTruthy();

    // grab the test wallet at (10,10) and drop it on zone A at window (60, 420)
    await L.drag('drag:wallet:diag-wallet', { x: 10, y: 10 }, [{ tx: -60, ty: 150 }, { tx: -100, ty: 290 }]);
    // the origin measurement reports the raw-vs-window offset the app compensates for (24px on the simulated Android)
    expect(textOf('diag-offset')).toBe('dx=0 dy=24');
    await waitFor(() => expect(screen.getAllByTestId(/^diag-line-/).map((n) => textOf(n.props.testID)).join('\n')).toContain('"drop":"diag:A"'));

    // dropping on the rejecting zone B reports no drop
    await L.drag('drag:wallet:diag-wallet', { x: 10, y: 10 }, [{ tx: 60, ty: 290 }]);
    await waitFor(() => expect(textOf('diag-line-0')).toContain('"drop":null'));
    expect(gestures.has('drag:wallet:diag-wallet')).toBe(true);
    for (const c of calls) expect(c).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('diag-close'));
    expect(await screen.findByTestId('conn-check')).toBeTruthy();
  });
});

describe('wallet picker when the API is unreachable', () => {
  let server: FakeServer;
  let restore: () => void;
  beforeEach(() => {
    useSettings.setState({ lang: 'uz', reduceEffects: true, apiUrl: 'http://192.168.1.2:5080' });
    useUi.setState({ op: null, lastOp: null, form: null, formId: null });
    server = new FakeServer();
    server.wallets = [wallet('w1', 'Bank kartasi', 1_000_000)];
    restore = server.install();
    server.offline = true; // nothing was ever loaded: no cached snapshot either
  });
  afterEach(() => {
    jest.restoreAllMocks();
    restore();
  });

  it('shows a clear message with the URL instead of a dead picker, and recovers on retry', async () => {
    await renderApp(<OperationSheet />);
    await act(async () => { useUi.getState().openOp({ kind: 'income' }); });
    // the form itself says the wallet list could not be loaded
    expect(await screen.findByTestId('load-error', {}, { timeout: 8000 })).toBeTruthy(); // the query retries once before it gives up
    expect(within(screen.getByTestId('load-error')).getByText('Hamyonlar ro‘yxati yuklanmadi')).toBeTruthy();

    // opening the picker explains the cause and where to check
    await fireEvent.press(screen.getByTestId('to-endpoint'));
    const err = await screen.findByTestId('picker-error', {}, { timeout: 8000 });
    expect(within(err).getByText('Hamyonlar ro‘yxati yuklanmadi')).toBeTruthy();
    expect(within(err).getByText(/192\.168\.1\.2:5080/)).toBeTruthy();
    expect(within(err).getByText(/Sozlamalar → Server ulanishi/)).toBeTruthy();

    // connection returns -> Retry loads the wallets and they can be chosen
    server.offline = false;
    await fireEvent.press(within(err).getByText('Qayta urinish'));
    expect(await screen.findByLabelText(/^Bank kartasi/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Bank kartasi/));
    expect(await endpoint('to-endpoint').findByText('Bank kartasi')).toBeTruthy();
  });

  it('with a cached snapshot the picker still lists wallets and says it is offline data', async () => {
    server.offline = false;
    await renderApp(<OperationSheet />);
    await act(async () => { useUi.getState().openOp({ kind: 'income' }); });
    await endpoint('to-endpoint').findByText('Bank kartasi');
    server.offline = true;
    await act(async () => { await queryClient.refetchQueries({ queryKey: ['snapshot'] }); }); // falls back to the cached snapshot
    expect(useQueue.getState().online).toBe(false);
    await fireEvent.press(screen.getByTestId('to-endpoint'));
    expect(await screen.findByLabelText(/^Bank kartasi/)).toBeTruthy();
    expect(await screen.findByTestId('picker-cached')).toBeTruthy();
  });
});
