// Real-backend scenario (steps 1-15 of the main-panel acceptance test).
// Usage: node scripts/e2e-scenario.mjs http://localhost:5081   (use a DEDICATED database, it registers a fresh user)
const base = process.argv[2] ?? 'http://localhost:5081';
let token = '';
let failed = 0;
const rnd = Math.random().toString(36).slice(2, 8);

async function call(method, path, body, idem) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(idem ? { 'idempotency-key': idem } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return json;
}
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`);
}
const push = async (kind, payload) => {
  const id = `e2e-${rnd}-${Math.random().toString(36).slice(2, 10)}`;
  const r = await call('POST', '/api/sync/push', { operations: [{ clientOperationId: id, kind, payload }] });
  if (r.results[0].status !== 'applied') throw new Error(`push ${kind}: ${JSON.stringify(r.results[0])}`);
  return id;
};
const pull = () => call('GET', '/api/sync/pull');
const bal = async (id) => (await pull()).wallets.find((w) => w.id === id).balance;
const bd = async (by, type) => call('GET', `/api/analytics/breakdown?by=${by}&type=${type}`);

// 1. fresh user (own isolated data)
const auth = await call('POST', '/api/auth/register', { email: `e2e-${rnd}@hamyon.local`, password: 'E2e-Passw0rd!', displayName: 'E2E' });
token = auth.accessToken;
let snap = await pull();
const kommunal = snap.categories.find((c) => c.name === 'Kommunal');
const biznes = snap.incomeSources.find((s) => s.name === 'Biznes');
check('default categories/sources exist', !!kommunal && !!biznes, true);

// 2-4. Bank kartasi with 5 000 000 opening balance
const karta = await call('POST', '/api/wallets', { name: 'Bank kartasi', type: 1, currency: 'UZS', initialBalance: 5000000, icon: 'card', color: '#3B82F6', allowOverdraft: false }, `w-${rnd}-1`);
check('4. opening balance 5 000 000', await bal(karta.id), 5000000);

// 5-9. expense 150 000 to Kommunal
await push('expense', { walletId: karta.id, amount: 150000, categoryId: kommunal.id, memo: 'Elektr' });
check('7. wallet 4 850 000', await bal(karta.id), 4850000);
const kom = (await bd('category', 2)).find((r) => r.id === kommunal.id);
check('8. Kommunal spent 150 000', kom?.total, 150000);
const tx = (await call('GET', '/api/transactions')).items;
check('9. expense in history (wallet+category)', tx.some((t) => t.type === 2 && t.amount === 150000 && t.walletId === karta.id && t.categoryId === kommunal.id), true);

// 10-14. second wallet + transfer 200 000
const naqd = await call('POST', '/api/wallets', { name: 'Naqd', type: 0, currency: 'UZS', initialBalance: 0, icon: 'cash', color: '#22C55E', allowOverdraft: false }, `w-${rnd}-2`);
await push('transfer', { fromWalletId: karta.id, toWalletId: naqd.id, amount: 200000, memo: 'Transfer' });
check('12. source 4 650 000', await bal(karta.id), 4650000);
check('13. target +200 000', await bal(naqd.id), 200000);
const exp = await call('GET', '/api/analytics/summary');
check('14. transfer is not an expense (expense still 150 000)', exp.totals.find((t) => t.currency === 'UZS').expense, 150000);
const transfers = (await call('GET', '/api/transactions')).items.filter((t) => t.type === 3);
check('14b. one linked transfer record', transfers.length, 1);

// 15. income from source Biznes to Bank kartasi
await push('income', { walletId: karta.id, amount: 1000000, incomeSourceId: biznes.id, reason: 'Savdo' });
check('15. wallet 5 650 000 after income', await bal(karta.id), 5650000);
const biz = (await bd('source', 1)).find((r) => r.id === biznes.id);
check('15b. Biznes income 1 000 000', biz?.total, 1000000);
const sum = await call('GET', '/api/analytics/summary');
check('15c. income total = 1 000 000 (opening/transfer excluded)', sum.totals.find((t) => t.currency === 'UZS').income, 1000000);

// borrowing must not count as income
await push('debt', { direction: 0, personName: 'Aziz', walletId: karta.id, amount: 300000 });
const sum2 = await call('GET', '/api/analytics/summary');
check('16. borrowing is not income', sum2.totals.find((t) => t.currency === 'UZS').income, 1000000);
check('16b. wallet 5 950 000 after borrowing', await bal(karta.id), 5950000);

// idempotency: same client op id twice must not double-apply
const dup = `e2e-${rnd}-dup`;
for (let i = 0; i < 2; i++) await call('POST', '/api/sync/push', { operations: [{ clientOperationId: dup, kind: 'expense', payload: { walletId: karta.id, amount: 1000, categoryId: kommunal.id } }] });
check('17. idempotent retry applies once', await bal(karta.id), 5949000);

console.log(failed === 0 ? '\nALL PASSED' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
