import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { Snapshot, Tx } from '@/api/types';
import { OperationSheet } from '@/features/OperationSheet';
import { monthShort } from '@/lib/dates';
import { useQueue } from '@/state/queue';
import { api, queryClient } from '@/state/runtime';
import { useSettings } from '@/state/settings';
import { useUi, type OpPrefill } from '@/state/ui';
import { FakeServer, category, source, wallet } from '../test-utils/fakeServer';
import { endpoint, footerHas, renderApp, save, shownAmount, textOf, typeKeys } from '../test-utils/ui';

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
  server.categories = [category('c1', 'Kommunal'), category('c1a', 'Svet', { parentId: 'c1' }), category('c2', 'Oziq-ovqat')];
  server.sources = [source('s1', 'Maosh'), source('s2', 'Biznes')];
  restore = server.install();
});
afterEach(() => {
  jest.restoreAllMocks();
  restore();
});

async function open(op: OpPrefill) {
  await renderApp(<OperationSheet />);
  await act(async () => { useUi.getState().openOp(op); });
  await screen.findByTestId('save-button');
  await waitFor(() => expect(queryClient.getQueryData(['snapshot'])).toBeTruthy()); // wallets loaded from the backend
}
const cachedWallet = (id: string) => (queryClient.getQueryData(['snapshot']) as Snapshot).wallets.find((w) => w.id === id);
const sheet = () => within(screen.getByTestId('sheet-scroll'));

describe('operation sheet layout (reference-app mechanics)', () => {
  it('1. income: type + amount on top, source >> wallet in the middle, big Save and the keypad at the bottom (outside the scroll area)', async () => {
    await open({ kind: 'income' });
    expect(within(screen.getByTestId('type-menu')).getByText('Kirim')).toBeTruthy();
    expect(screen.getByTestId('close-op')).toBeTruthy();
    expect(shownAmount()).toBe('0'); // the user can start typing immediately: keypad is open
    expect(screen.getByTestId('keypad')).toBeTruthy();
    expect(await endpoint('to-endpoint').findByText('Bank kartasi')).toBeTruthy();
    expect(endpoint('to-endpoint').getByText('1 000 000 UZS')).toBeTruthy(); // current balance under the icon
    expect(endpoint('source-endpoint').getByText('Kirim manbasi')).toBeTruthy(); // source is not a wallet
    // save + keypad live in the footer, never inside the scrolling body => never pushed off-screen
    const footer = within(screen.getByTestId('sheet-footer'));
    expect(footer.getByTestId('save-button')).toBeTruthy();
    expect(footer.getByTestId('keypad')).toBeTruthy();
    expect(sheet().queryByTestId('save-button')).toBeNull();
    expect(sheet().queryByTestId('keypad')).toBeNull();
    // keyboard avoidance is active on every platform (Android is edge-to-edge)
    expect(readFileSync(join(__dirname, '../src/design/Sheet.tsx'), 'utf8')).toContain('behavior="padding"');
  });

  it('17. typing a note closes the keypad (system keyboard takes over, Save stays reachable); Close key / tapping the amount bring it back', async () => {
    await open({ kind: 'expense', categoryId: 'c1' });
    await fireEvent(screen.getByTestId('memo-input'), 'focus');
    expect(screen.queryByTestId('keypad')).toBeNull();
    expect(within(screen.getByTestId('sheet-footer')).getByTestId('save-button')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Summa'));
    expect(screen.getByTestId('keypad')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('key:CLOSE'));
    expect(screen.queryByTestId('keypad')).toBeNull();
  });

  it('the type menu switches between income / expense / transfer / debt without losing the typed amount', async () => {
    await open({ kind: 'income' });
    await typeKeys('1234');
    await fireEvent.press(screen.getByTestId('type-menu'));
    await fireEvent.press(screen.getByLabelText('Xarajat'));
    expect(within(screen.getByTestId('type-menu')).getByText('Xarajat')).toBeTruthy();
    expect(shownAmount()).toBe('1 234');
    expect(screen.getByTestId('category-endpoint')).toBeTruthy();
  });
});

describe('money keypad inside the form (exact decimals, no float)', () => {
  it('16. "150000 + 25000" shows 175 000 and saves exactly 175000', async () => {
    await open({ kind: 'income', walletId: 'w1' });
    await typeKeys('150000+25000');
    expect(shownAmount()).toBe('175 000');
    expect(await screen.findByText('150 000 + 25 000')).toBeTruthy(); // the raw expression stays visible under the total
    await save();
    await waitFor(() => expect(server.pushes).toHaveLength(1));
    expect(server.pushes[0]?.payload.amount).toBe(175000);
  });

  it('all four operations, decimals, delete and clear', async () => {
    await open({ kind: 'income', walletId: 'w1' });
    await typeKeys('1000+500×2');
    expect(shownAmount()).toBe('2 000');
    await typeKeys('=');
    expect(shownAmount()).toBe('2 000');
    await typeKeys('÷3=');
    expect(shownAmount()).toBe('666,67');
    await typeKeys('<<<<<<');
    expect(shownAmount()).toBe('0');
    await typeKeys('0,1+0,2');
    expect(shownAmount()).toBe('0,3'); // 0.1 + 0.2 is exactly 0.3 here
    await typeKeys('C');
    expect(shownAmount()).toBe('0');
  });

  it('a fractional result is sent as the exact 2-decimal number', async () => {
    await open({ kind: 'income', walletId: 'w1' });
    await typeKeys('10000÷3');
    await save();
    await waitFor(() => expect(server.pushes).toHaveLength(1));
    expect(server.pushes[0]?.payload.amount).toBe(3333.33);
  });

  it('division by zero / non-positive result never reaches the server', async () => {
    await open({ kind: 'income', walletId: 'w1' });
    await typeKeys('5÷0');
    await save();
    expect(await footerHas('Summani to‘g‘ri kiriting (0 dan katta)')).toBeTruthy();
    await typeKeys('C');
    await typeKeys('5-9');
    await save();
    expect(await footerHas('Summani to‘g‘ri kiriting (0 dan katta)')).toBeTruthy();
    expect(server.pushes).toHaveLength(0);
  });
});

describe('wallet choice', () => {
  it('2. the wallet picker lists active wallets from the backend with icon, name, currency and balance (archived hidden)', async () => {
    await open({ kind: 'income' });
    await fireEvent.press(screen.getByTestId('to-endpoint'));
    expect(await sheet().findByText('Naqd pul')).toBeTruthy();
    expect(sheet().getByText('Bank kartasi')).toBeTruthy();
    expect(sheet().getByText('1 000 000 UZS')).toBeTruthy();
    expect(sheet().getByText('200 000 USD')).toBeTruthy();
    expect(sheet().queryByText('Eski hamyon')).toBeNull();
    expect(sheet().getByText('Yangi hamyon yaratish')).toBeTruthy();
    // no footer on the picker page: no accidental submit from there
    expect(screen.queryByTestId('save-button')).toBeNull();
  });

  it('3. choosing a wallet returns to the form: it becomes the receiving wallet and the amount currency follows it', async () => {
    await open({ kind: 'income' });
    await fireEvent.press(screen.getByTestId('to-endpoint'));
    await fireEvent.press(await sheet().findByLabelText(/^Naqd pul/));
    await screen.findByTestId('save-button');
    expect(endpoint('to-endpoint').getByText('Naqd pul')).toBeTruthy();
    expect(textOf('amount-display')).toBe('0 USD');
  });

  it('4. with no wallet the picker offers creation; the new wallet is saved, returned to the form and auto-selected', async () => {
    server.wallets = [];
    await open({ kind: 'income' });
    await fireEvent.press(screen.getByTestId('to-endpoint'));
    expect(await screen.findByText('Faol hamyon yo‘q. Avval hamyon yarating.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Yangi hamyon yaratish'));

    await fireEvent.changeText(await screen.findByLabelText('Ism'), 'Yangi karta');
    await fireEvent.changeText(screen.getByLabelText(/^Boshlang‘ich balans/), '750000');
    await act(async () => { await fireEvent.press(screen.getByText('Saqlash')); });

    await waitFor(() => expect(server.created).toHaveLength(1));
    // back on the income form, new wallet selected automatically (shown with its balance)
    expect(await endpoint('to-endpoint').findByText('Yangi karta')).toBeTruthy();
    expect(endpoint('to-endpoint').getByText('750 000 UZS')).toBeTruthy();

    // ...and the income goes to that new wallet's id
    await typeKeys('250000');
    await save();
    await waitFor(() => expect(server.pushes).toHaveLength(1));
    expect(server.pushes[0]?.payload.walletId).toBe((server.created[0] as { id: string }).id);
  });

  it('every operation can choose its wallets: expense pay-from, transfer from + to (to excludes from), debt follows the direction', async () => {
    await open({ kind: 'expense' });
    expect(await endpoint('from-endpoint').findByText('Bank kartasi')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('from-endpoint'));
    await fireEvent.press(await sheet().findByLabelText(/^Naqd pul/));
    expect(await endpoint('from-endpoint').findByText('Naqd pul')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('type-menu'));
    await fireEvent.press(screen.getByLabelText('Transfer'));
    await fireEvent.press(screen.getByTestId('to-endpoint'));
    expect(await sheet().findByText('Bank kartasi')).toBeTruthy();
    expect(sheet().queryByText('Naqd pul')).toBeNull(); // the source wallet cannot be the target
    await fireEvent.press(sheet().getByLabelText(/^Bank kartasi/));
    expect(await endpoint('to-endpoint').findByText('Bank kartasi')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('type-menu'));
    await fireEvent.press(screen.getByLabelText('Qarz'));
    await fireEvent.press(screen.getByText('Qarz berdim'));
    expect(screen.getByTestId('from-endpoint')).toBeTruthy(); // lending: money leaves a wallet
  });

  it('going back from a picker keeps what was typed', async () => {
    await open({ kind: 'income' });
    await typeKeys('1234');
    await fireEvent.press(screen.getByTestId('to-endpoint'));
    await screen.findByText('Yangi hamyon yaratish');
    await fireEvent.press(screen.getByLabelText('Orqaga'));
    await screen.findByTestId('save-button');
    expect(shownAmount()).toBe('1 234');
    expect(useUi.getState().op).not.toBeNull();
  });
});

describe('saving', () => {
  it('5+6. income: sends wallet id + source, then balance, history and source total update', async () => {
    await open({ kind: 'income' });
    await fireEvent.press(screen.getByTestId('source-endpoint'));
    await fireEvent.press(await screen.findByLabelText('Maosh'));
    await fireEvent.press(screen.getByTestId('to-endpoint'));
    await fireEvent.press(await sheet().findByLabelText(/^Bank kartasi/));
    await typeKeys('1500000,5');
    await fireEvent.changeText(screen.getByLabelText('Kimdan'), 'Akmal');
    await fireEvent.changeText(screen.getByLabelText('Sabab'), 'Oylik');
    await save();

    await waitFor(() => expect(server.pushes).toHaveLength(1));
    const op = server.pushes[0]!;
    expect(op.kind).toBe('income');
    expect(op.payload).toMatchObject({ walletId: 'w1', incomeSourceId: 's1', amount: 1500000.5, reason: 'Oylik' });
    expect(op.payload.personId).toEqual(expect.any(String)); // payer was created as a person

    await waitFor(() => expect(useUi.getState().op).toBeNull()); // sheet closed after success
    await waitFor(() => expect(cachedWallet('w1')?.balance).toBe(2_500_000.5));
    expect((queryClient.getQueryData(['snapshot']) as Snapshot).transactions).toHaveLength(1);
    const rows = await api.get<{ id: string; total: number }[]>('/api/analytics/breakdown', { by: 'source', type: 1 });
    expect(rows).toEqual([expect.objectContaining({ id: 's1', total: 1500000.5 })]);
  });

  it('expense with sub-category: "Svet" under "Kommunal" is sent as the category', async () => {
    await open({ kind: 'expense', walletId: 'w1', categoryId: 'c1' });
    await fireEvent.press(await screen.findByLabelText('Svet'));
    await typeKeys('40000');
    await save();
    await waitFor(() => expect(server.pushes).toHaveLength(1));
    expect(server.pushes[0]?.payload).toMatchObject({ walletId: 'w1', categoryId: 'c1a', amount: 40000 });
  });

  it('a new sub-category can be added on the spot and is selected automatically', async () => {
    await open({ kind: 'expense', walletId: 'w1', categoryId: 'c2' });
    await fireEvent.press(await screen.findByLabelText('Qo‘shish'));
    await fireEvent.changeText(await screen.findByLabelText('Subkategoriya nomi'), 'Go‘sht');
    await act(async () => { await fireEvent.press(within(screen.getByTestId('sheet-scroll')).getAllByText('Saqlash')[0]!); });
    await waitFor(() => expect(server.created).toHaveLength(1));
    expect(server.created[0]).toMatchObject({ name: 'Go‘sht', parentId: 'c2' });
    await typeKeys('25000');
    await save();
    await waitFor(() => expect(server.pushes).toHaveLength(1));
    expect(server.pushes[0]?.payload.categoryId).toBe((server.created[0] as { id: string }).id);
  });

  it('the date strip chooses the operation day (yesterday)', async () => {
    await open({ kind: 'expense', walletId: 'w1', categoryId: 'c2' });
    const y = new Date();
    y.setDate(y.getDate() - 1);
    await fireEvent.press(await screen.findByLabelText(`${y.getDate()} ${monthShort('uz', y.getMonth())}`));
    await typeKeys('5000');
    await save();
    await waitFor(() => expect(server.pushes).toHaveLength(1));
    const at = new Date(String(server.pushes[0]?.payload.occurredAt));
    expect([at.getFullYear(), at.getMonth(), at.getDate()]).toEqual([y.getFullYear(), y.getMonth(), y.getDate()]);
  });

  it('transfer between currencies: two amounts, the received amount is typed and sent; same-currency transfers show one amount', async () => {
    await open({ kind: 'transfer', walletId: 'w1', toWalletId: 'w2' });
    expect(await screen.findByTestId('amount-to-display')).toBeTruthy(); // UZS -> USD: two amounts
    await typeKeys('1000000');
    await fireEvent.press(screen.getAllByLabelText('Summa')[1]!);
    await typeKeys('80');
    expect(textOf('amount-to-display')).toBe('80 USD');
    expect(textOf('rate-line')).toContain('1 UZS = 0,00008 USD');
    await save();
    await waitFor(() => expect(server.pushes).toHaveLength(1));
    expect(server.pushes[0]?.payload).toMatchObject({ fromWalletId: 'w1', toWalletId: 'w2', amount: 1000000, toAmount: 80 });
    await waitFor(() => expect(cachedWallet('w1')?.balance).toBe(0));
    expect(cachedWallet('w2')?.balance).toBe(200_080);
  });

  it('same-currency transfer has a single amount and no received amount is sent', async () => {
    server.wallets.push(wallet('w4', 'Zaxira', 0));
    await open({ kind: 'transfer', walletId: 'w1', toWalletId: 'w4' });
    expect(screen.queryByTestId('amount-to-display')).toBeNull();
    await typeKeys('200000');
    await save();
    await waitFor(() => expect(server.pushes).toHaveLength(1));
    expect(server.pushes[0]?.payload).toMatchObject({ amount: 200000, toAmount: null });
  });

  it('"add another operation" keeps the sheet open, clears the amount and the second save works', async () => {
    await open({ kind: 'expense', walletId: 'w1', categoryId: 'c2' });
    await fireEvent(screen.getByTestId('add-another'), 'valueChange', true);
    await typeKeys('1000');
    await save();
    await waitFor(() => expect(server.pushes).toHaveLength(1));
    expect(useUi.getState().op).not.toBeNull();
    expect(await screen.findByText('✓ Saqlandi')).toBeTruthy();
    expect(shownAmount()).toBe('0');
    await typeKeys('2000');
    await save();
    await waitFor(() => expect(server.pushes).toHaveLength(2));
    expect(server.pushes.map((p) => p.payload.amount)).toEqual([1000, 2000]);
  });
});

describe('validation, errors and unreliable networks', () => {
  it('7. validation + insufficient balance: clear messages, nothing is sent, nothing is deducted, the sheet stays open', async () => {
    await open({ kind: 'expense', walletId: 'w1', categoryId: 'c1' });
    await save();
    expect(await footerHas('Summani to‘g‘ri kiriting (0 dan katta)')).toBeTruthy();
    await typeKeys('5000000'); // more than the 1 000 000 balance
    await save();
    expect(await footerHas('Mablag‘ yetarli emas')).toBeTruthy();
    expect(server.pushes).toHaveLength(0);
    expect(useUi.getState().op).not.toBeNull();
    expect(cachedWallet('w1')?.balance).toBe(1_000_000);
  });

  it('a server rejection is shown verbatim and the screen never claims the money left', async () => {
    await open({ kind: 'expense', walletId: 'w1', categoryId: 'c1' });
    server.wallets[0]!.balance = 100; // the server knows better than the cached snapshot
    await typeKeys('500000');
    await save();
    expect(await footerHas('Insufficient funds')).toBeTruthy();
    expect(useUi.getState().op).not.toBeNull();
    expect(server.wallets[0]?.balance).toBe(100);
  });

  it('18. double tap on Save creates exactly one operation (slow network)', async () => {
    await open({ kind: 'expense', walletId: 'w1', categoryId: 'c1' });
    await typeKeys('10000');
    server.latency = 150;
    const btn = screen.getByTestId('save-button');
    await act(async () => {
      void fireEvent.press(btn);
      void fireEvent.press(btn);
      void fireEvent.press(btn);
    });
    await waitFor(() => expect(useUi.getState().op).toBeNull());
    expect(server.pushes).toHaveLength(1);
    await waitFor(() => expect(cachedWallet('w1')?.balance).toBe(990_000));
  });

  it('18. offline: the operation is queued (not shown as spent), then applied once when the connection returns', async () => {
    await open({ kind: 'expense', walletId: 'w1', categoryId: 'c1' });
    await typeKeys('30000');
    server.offline = true;
    await save();
    await waitFor(() => expect(useUi.getState().op).toBeNull());
    expect(useQueue.getState().pending).toHaveLength(1);
    expect(useQueue.getState().online).toBe(false);
    expect(server.pushes).toHaveLength(0);
    expect(server.wallets[0]?.balance).toBe(1_000_000); // nothing applied yet

    server.offline = false;
    await act(async () => { await useQueue.getState().flush(); });
    expect(useQueue.getState().pending).toHaveLength(0);
    expect(server.pushes).toHaveLength(1);
    expect(server.wallets[0]?.balance).toBe(970_000);
    // retrying the (already applied) queue again must not duplicate anything
    await act(async () => { await useQueue.getState().flush(); });
    expect(server.pushes).toHaveLength(1);
  });
});

describe('edit and reverse (ledger corrections, never physical deletes)', () => {
  const seedExpense = async (): Promise<Tx> => {
    await api.post('/api/sync/push', { operations: [{ clientOperationId: 'seed', kind: 'expense', payload: { walletId: 'w1', amount: 100000, categoryId: 'c1', occurredAt: new Date().toISOString() } }] });
    return server.txs.find((t) => t.type === 2)!;
  };

  it('13. editing an expense changes its amount through a correction (PUT) and fixes the balance', async () => {
    const tx = await seedExpense();
    expect(server.wallets[0]?.balance).toBe(900_000);
    await open({ kind: 'expense', edit: tx });
    expect(within(screen.getByTestId('type-menu')).getByText('Xarajat')).toBeTruthy();
    expect(shownAmount()).toBe('100 000');
    expect(screen.getByTestId('trash')).toBeTruthy();
    await typeKeys('C120000');
    await save();
    await waitFor(() => expect(server.puts).toHaveLength(1));
    expect(server.puts[0]?.path).toBe(`/api/transactions/${tx.id}/expense`);
    expect(server.puts[0]?.body).toMatchObject({ walletId: 'w1', categoryId: 'c1', amount: 120000 });
    await waitFor(() => expect(useUi.getState().op).toBeNull());
    expect(server.wallets[0]?.balance).toBe(880_000);
    expect(server.txs.filter((t) => t.reversedById)).toHaveLength(1); // the old entry is kept, marked reversed
  });

  it('14. the trash button asks for confirmation, then reverses the operation and gives the money back', async () => {
    const tx = await seedExpense();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { buttons?.[1]?.onPress?.(); });
    await open({ kind: 'expense', edit: tx });
    await fireEvent.press(screen.getByTestId('trash'));
    expect(alert).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(server.reversed).toEqual([tx.id]));
    await waitFor(() => expect(useUi.getState().op).toBeNull());
    expect(server.wallets[0]?.balance).toBe(1_000_000); // balance restored
    expect(server.txs.find((t) => t.id === tx.id)?.reversedById).toBeTruthy(); // history kept
  });

  it('cancelling the confirmation reverses nothing', async () => {
    const tx = await seedExpense();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await open({ kind: 'expense', edit: tx });
    await fireEvent.press(screen.getByTestId('trash'));
    expect(server.reversed).toEqual([]);
    expect(server.wallets[0]?.balance).toBe(900_000);
  });
});
