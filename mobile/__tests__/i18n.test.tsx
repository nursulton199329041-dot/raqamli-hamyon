import { screen, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/api/client';
import { errorText } from '@/api/errors';
import { Dashboard } from '@/features/Dashboard';
import { monthName } from '@/lib/dates';
import { fmtDate } from '@/lib/money';
import { api } from '@/state/runtime';
import { useSettings } from '@/state/settings';
import { FakeServer, category, source, wallet } from '../test-utils/fakeServer';
import { renderApp } from '../test-utils/ui';

jest.mock('react-native-gesture-handler', () => jest.requireActual('../test-utils/gestureMock'));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.setTimeout(30000);

afterEach(() => useSettings.setState({ lang: 'uz' }));

describe('server errors are shown in the app language', () => {
  it.each([
    ['uz', 'Email yoki parol noto‘g‘ri'],
    ['ru', 'Неверный email или пароль'],
    ['en', 'Invalid email or password'],
  ] as const)('%s', (lang, text) => {
    useSettings.setState({ lang });
    expect(errorText('auth.invalid_credentials', 'Invalid email or password.')).toBe(text);
  });

  it('unknown codes keep the server text; an empty body falls back to "Error (status)"', () => {
    useSettings.setState({ lang: 'ru' });
    expect(errorText('some.new_code', 'Specific server message.')).toBe('Specific server message.');
    expect(errorText('error', '', 503)).toBe('Ошибка (503)');
  });

  it('the API client builds translated errors from the server code', async () => {
    useSettings.setState({ lang: 'ru' });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'wallet.insufficient_funds', message: 'Balance cannot be negative.' }), { status: 400 }),
    );
    try {
      await expect(api.get('/api/anything')).rejects.toEqual(expect.objectContaining({ code: 'wallet.insufficient_funds' }));
      const err = await api.get('/api/anything').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).not.toMatch(/Balance cannot/);
      fetchMock.mockRejectedValue(new TypeError('offline'));
      expect(((await api.get('/x').catch((e: unknown) => e)) as ApiError).message).toBe('Нет связи с сервером');
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe('dates follow the language', () => {
  it('short dates and stand-alone month names', () => {
    const d = new Date(2026, 10, 26);
    expect(fmtDate(d)).toBe('26.11.2026');
    useSettings.setState({ lang: 'en' });
    expect(fmtDate(d)).toBe('Nov 26, 2026');
    expect(monthName('ru', 9, true)).toBe('октябрь');
    expect(monthName('ru', 9)).toBe('октября');
  });
});

describe('the whole app switches language; user-entered names are never translated', () => {
  let server: FakeServer;
  let restore: () => void;
  beforeEach(() => {
    server = new FakeServer();
    server.wallets = [wallet('w1', 'Bank kartasi', 1_000_000)];
    server.categories = [category('c1', 'Kommunal')];
    server.sources = [source('s1', 'Maosh')];
    restore = server.install();
  });
  afterEach(() => restore());

  it.each([
    ['uz', ['Kirim manbalari', 'Hamyonlar', 'Xarajat toifalari'], '1 000 000 UZS'],
    ['ru', ['Источники дохода', 'Кошельки', 'Категории расходов'], '1 000 000 UZS'],
    ['en', ['Income sources', 'Wallets', 'Expense categories'], '1,000,000 UZS'],
  ] as const)('%s', async (lang, labels, amount) => {
    useSettings.setState({ lang, reduceEffects: true });
    await renderApp(<Dashboard />);
    for (const l of labels) expect(await screen.findByText(new RegExp(l, 'i'))).toBeTruthy();
    // user data stays exactly as typed
    expect(screen.getAllByText('Bank kartasi').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Kommunal').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Maosh').length).toBeGreaterThan(0);
    expect(screen.getAllByText(amount.replace(/ /g, ' ')).length).toBeGreaterThan(0);
  });

  it('the chosen language is saved and restored on the next start', async () => {
    await useSettings.getState().update({ lang: 'en' });
    useSettings.setState({ lang: 'uz', hydrated: false });
    await useSettings.getState().hydrate();
    await waitFor(() => expect(useSettings.getState().lang).toBe('en'));
  });
});
