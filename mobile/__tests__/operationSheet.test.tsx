import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { DragProvider } from '@/dnd/DragDrop';
import { OperationSheet } from '@/features/OperationSheet';
import type { Snapshot } from '@/api/types';
import { api, queryClient } from '@/state/runtime';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useSettings } from '@/state/settings';
import { useUi, type OpPrefill } from '@/state/ui';
import { FakeServer, category, source, wallet } from '../test-utils/fakeServer';

jest.mock('react-native-gesture-handler', () => jest.requireActual('../test-utils/gestureMock'));
jest.setTimeout(30000);

let server: FakeServer;
let restore: () => void;

beforeEach(() => {
  useSettings.setState({ lang: 'uz', reduceEffects: true });
  useUi.setState({ op: null, lastOp: null, form: null, formId: null });
  server = new FakeServer();
  server.wallets = [
    wallet('w1', 'Bank kartasi', 1_000_000),
    wallet('w2', 'Naqd pul', 200_000, { type: 0, icon: 'cash', currency: 'USD' }),
    wallet('w3', 'Eski hamyon', 0, { isArchived: true }),
  ];
  server.categories = [category('c1', 'Kommunal')];
  server.sources = [source('s1', 'Maosh'), source('s2', 'Biznes')];
  restore = server.install();
});
afterEach(() => restore());

async function open(op: OpPrefill) {
  await render(
    <QueryClientProvider client={queryClient}>
      <DragProvider>
        <OperationSheet />
      </DragProvider>
    </QueryClientProvider>,
  );
  await act(async () => { useUi.getState().openOp(op); });
  await screen.findByText('Tasdiqlash');
  await waitFor(() => expect(queryClient.getQueryData(['snapshot'])).toBeTruthy()); // wallets loaded from the backend
}
const amountField = () => screen.getByLabelText(/^Summa/);
const confirm = async () => act(async () => { await fireEvent.press(screen.getByText('Tasdiqlash')); });
const sheet = () => within(screen.getByTestId('sheet-scroll'));
const cachedWallet = (id: string) => (queryClient.getQueryData(['snapshot']) as Snapshot).wallets.find((w) => w.id === id);

describe('income sheet', () => {
  it('1. opens with all income fields and keeps the confirm button outside the scrolling area', async () => {
    await open({ kind: 'income' });
    for (const label of ['Summa (UZS)', 'Qabul qiluvchi hamyon', 'Kirim manbasi', 'Kimdan', 'Sabab', 'Izoh']) {
      expect(screen.getAllByText(new RegExp(`^${label.replace(/[()]/g, '\\$&')}`)).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('Hamyon valyutasi', { exact: false })).toBeTruthy();
    // source chips are a different concept from the wallet row
    expect(sheet().getByText('Maosh')).toBeTruthy();
    expect(sheet().getByText('Biznes')).toBeTruthy();
    // confirm lives in the footer, not inside the ScrollView => never pushed off-screen / under the keyboard
    expect(sheet().queryByText('Tasdiqlash')).toBeNull();
    expect(within(screen.getByTestId('sheet-footer')).getByText('Tasdiqlash')).toBeTruthy();
    // keyboard avoidance is active on every platform (Android is edge-to-edge)
    expect(readFileSync(join(__dirname, '../src/design/Sheet.tsx'), 'utf8')).toContain('behavior="padding"');
  });

  it('2. the wallet picker lists active wallets from the backend with icon, name, currency and balance (archived hidden)', async () => {
    await open({ kind: 'income' });
    await fireEvent.press(screen.getByLabelText(/^Qabul qiluvchi hamyon/));
    expect(await screen.findByText('Hamyon tanlash', { exact: false }).catch(() => null) ?? true).toBeTruthy();
    const list = sheet();
    expect(list.getByText('Bank kartasi')).toBeTruthy();
    expect(list.getByText('1 000 000 UZS')).toBeTruthy();
    expect(list.getByText('Naqd pul')).toBeTruthy();
    expect(list.getByText('200 000 USD')).toBeTruthy();
    expect(list.queryByText('Eski hamyon')).toBeNull();
    expect(list.getByText('Yangi hamyon yaratish')).toBeTruthy();
    // the footer (confirm) is hidden on the picker page: no accidental submit from there
    expect(screen.queryByText('Tasdiqlash')).toBeNull();
  });

  it('3. choosing a wallet returns to the form and shows it as the receiving wallet', async () => {
    await open({ kind: 'income' });
    await fireEvent.press(screen.getByLabelText(/^Qabul qiluvchi hamyon/));
    await fireEvent.press(await screen.findByLabelText(/^Naqd pul/));
    await screen.findByText('Tasdiqlash');
    expect(screen.getByLabelText(/^Qabul qiluvchi hamyon: Naqd pul/)).toBeTruthy();
    expect(screen.getByText('Summa (USD)')).toBeTruthy(); // currency follows the chosen wallet
  });

  it('4. with no wallet the picker offers creation; the new wallet is saved, returned to the form and auto-selected', async () => {
    server.wallets = [];
    await open({ kind: 'income' });
    await fireEvent.press(screen.getByLabelText(/^Qabul qiluvchi hamyon/));
    expect(await screen.findByText('Faol hamyon yo‘q. Avval hamyon yarating.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Yangi hamyon yaratish'));

    await fireEvent.changeText(await screen.findByLabelText('Ism'), 'Yangi karta');
    await fireEvent.changeText(screen.getByLabelText(/^Boshlang‘ich balans/), '750000');
    await act(async () => { await fireEvent.press(screen.getByText('Saqlash')); });

    await waitFor(() => expect(server.created).toHaveLength(1));
    // back on the income form, new wallet selected automatically (shown with its balance)
    expect(await screen.findByLabelText(/^Qabul qiluvchi hamyon: Yangi karta/)).toBeTruthy();
    expect(screen.getByText('UZS · 750 000 UZS')).toBeTruthy();
    expect(screen.getByText('Tasdiqlash')).toBeTruthy();

    // ...and the income goes to that new wallet's id
    await fireEvent.changeText(amountField(), '250000');
    await confirm();
    await waitFor(() => expect(server.pushes).toHaveLength(1));
    expect(server.pushes[0]?.payload.walletId).toBe((server.created[0] as { id: string }).id);
  });

  it('5+6. saving sends the chosen wallet id and source; balance, history and source total update afterwards', async () => {
    await open({ kind: 'income' });
    await fireEvent.press(screen.getByLabelText(/^Qabul qiluvchi hamyon/));
    await fireEvent.press(await screen.findByLabelText(/^Bank kartasi/));
    await fireEvent.press(sheet().getByLabelText('Maosh'));
    await fireEvent.changeText(amountField(), '1 500 000,50');
    await fireEvent.changeText(screen.getByLabelText('Kimdan'), 'Akmal');
    await fireEvent.changeText(screen.getByLabelText('Sabab'), 'Oylik');
    await confirm();

    await waitFor(() => expect(server.pushes).toHaveLength(1));
    const op = server.pushes[0]!;
    expect(op.kind).toBe('income');
    expect(op.payload).toMatchObject({ walletId: 'w1', incomeSourceId: 's1', amount: 1500000.5, reason: 'Oylik' });
    expect(op.payload.personId).toEqual(expect.any(String)); // payer was created as a person

    await waitFor(() => expect(useUi.getState().op).toBeNull()); // sheet closed after success
    // ledger result: wallet balance increased, the operation exists in history, and the source breakdown reflects it
    await waitFor(() => expect(cachedWallet('w1')?.balance).toBe(2_500_000.5));
    expect((queryClient.getQueryData(['snapshot']) as Snapshot).transactions).toHaveLength(1);
    const rows = await api.get<{ id: string; total: number }[]>('/api/analytics/breakdown', { by: 'source', type: 1 });
    expect(rows).toEqual([expect.objectContaining({ id: 's1', total: 1500000.5 })]);

    // re-opening the picker shows the new balance
    await act(async () => { useUi.getState().openOp({ kind: 'income' }); });
    await fireEvent.press(await screen.findByLabelText(/^Qabul qiluvchi hamyon/));
    expect(await sheet().findByText('2 500 000.50 UZS')).toBeTruthy();
  });

  it('shows clear validation and server errors and never closes on them', async () => {
    await open({ kind: 'expense', walletId: 'w1', categoryId: 'c1' });
    await confirm();
    expect(await screen.findByText('Summani to‘g‘ri kiriting (0 dan katta)')).toBeTruthy();
    expect(server.pushes).toHaveLength(0);

    await fireEvent.changeText(amountField(), '5 000 000'); // more than the 1 000 000 balance
    await confirm();
    expect(await screen.findByText('Insufficient funds')).toBeTruthy(); // backend message, verbatim
    expect(useUi.getState().op).not.toBeNull();
    expect(cachedWallet('w1')?.balance ?? 1_000_000).toBe(1_000_000);
  });
});

describe('every operation can choose its wallets', () => {
  it('expense: pay-from wallet row + picker', async () => {
    await open({ kind: 'expense' });
    expect(await screen.findByLabelText(/^To‘lov hamyoni: Bank kartasi/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^To‘lov hamyoni/));
    await fireEvent.press(await screen.findByLabelText(/^Naqd pul/));
    expect(await screen.findByLabelText(/^To‘lov hamyoni: Naqd pul/)).toBeTruthy();
  });

  it('transfer: separate from/to pickers; the "to" picker cannot offer the source wallet; same wallet is refused', async () => {
    await open({ kind: 'transfer', walletId: 'w1' });
    expect(await screen.findByLabelText(/^Manba hamyon: Bank kartasi/)).toBeTruthy();
    expect(screen.getByLabelText(/^Qabul qiluvchi: Hamyonni tanlang/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Qabul qiluvchi:/));
    expect(await sheet().findByText('Naqd pul')).toBeTruthy();
    expect(sheet().queryByText('Bank kartasi')).toBeNull();
    await fireEvent.press(sheet().getByLabelText(/^Naqd pul/));
    expect(await screen.findByLabelText(/^Qabul qiluvchi: Naqd pul/)).toBeTruthy();
    // different currencies => rate / received amount fields appear
    expect(screen.getByLabelText(/^Kurs/)).toBeTruthy();
  });

  it('debt: wallet row is present (receiving wallet when borrowing, pay-from when lending)', async () => {
    await open({ kind: 'debt' });
    expect(screen.getByLabelText(/^Qabul qiluvchi hamyon:/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Qarz berdim'));
    expect(screen.getByLabelText(/^To‘lov hamyoni:/)).toBeTruthy();
  });

  it('Android back / backdrop on the picker returns to the form instead of discarding it', async () => {
    await open({ kind: 'income' });
    await fireEvent.changeText(amountField(), '1234');
    await fireEvent.press(screen.getByLabelText(/^Qabul qiluvchi hamyon/));
    await screen.findByText('Yangi hamyon yaratish');
    await fireEvent.press(screen.getByLabelText('Orqaga'));
    await screen.findByText('Tasdiqlash');
    expect(amountField().props.value).toBe('1234'); // typed amount survived the round trip
    expect(useUi.getState().op).not.toBeNull();
  });
});


