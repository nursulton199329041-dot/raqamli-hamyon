// Real-backend acceptance scenario for the video-based UX rebuild (backend half of the 18 acceptance steps).
// Usage: node scripts/e2e-acceptance.mjs http://localhost:5082   (use a DEDICATED database; it registers a fresh user)
// Money is checked as exact decimals: every expected value is an integer or a 2-decimal literal.
const base = process.argv[2] ?? 'http://localhost:5082';
let token = '';
let failed = 0;
const rnd = Math.random().toString(36).slice(2, 8);

async function raw(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, text };
}
async function call(method, path, body, headers) {
  const r = await raw(method, path, body, headers);
  if (r.status >= 400) throw new Error(`${method} ${path} -> ${r.status} ${r.text}`);
  return r.json;
}
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`);
}
const push = async (kind, payload, id = `acc-${rnd}-${Math.random().toString(36).slice(2, 10)}`) => {
  const r = await call('POST', '/api/sync/push', { operations: [{ clientOperationId: id, kind, payload }] });
  return { id, result: r.results[0] };
};
const pushOk = async (kind, payload) => {
  const r = await push(kind, payload);
  if (r.result.status !== 'applied') throw new Error(`push ${kind}: ${JSON.stringify(r.result)}`);
  return r.id;
};
const pull = () => call('GET', '/api/sync/pull');
const bal = async (id) => (await pull()).wallets.find((w) => w.id === id).balance;
const bd = (by, type) => call('GET', `/api/analytics/breakdown?by=${by}&type=${type}`);
const summary = async (cur = 'UZS') => (await call('GET', '/api/analytics/summary')).totals.find((t) => t.currency === cur);
const history = async () => (await call('GET', '/api/transactions?includeReversed=true&pageSize=200')).items;

const auth = await call('POST', '/api/auth/register', { email: `acc-${rnd}@hamyon.local`, password: 'Acc-Passw0rd!', displayName: 'Acceptance' });
token = auth.accessToken;
const snap0 = await pull();
const kommunal = snap0.categories.find((c) => c.name === 'Kommunal');
const maosh = snap0.incomeSources[0];

// 1-2. a 5 000 000 so'm wallet; its balance is what the dashboard shows under the icon
const spark = await call('POST', '/api/wallets', { name: 'Spark', type: 1, currency: 'UZS', initialBalance: 5000000, icon: 'card', color: '#3B82F6', allowOverdraft: false }, { 'idempotency-key': `w-${rnd}-1` });
check('1-2. wallet created with 5 000 000', await bal(spark.id), 5000000);

// 3-6. drag wallet -> Kommunal = expense 150 000
await pushOk('expense', { walletId: spark.id, amount: 150000, categoryId: kommunal.id, memo: 'Elektr' });
check('5. balance 4 850 000', await bal(spark.id), 4850000);
check('6. Kommunal +150 000', (await bd('category', 2)).find((r) => r.id === kommunal.id)?.total, 150000);

// sub-category: expense booked to a child, breakdown lists the child
const sub = await call('POST', '/api/categories', { name: 'Svet', icon: kommunal.icon, color: kommunal.color, parentId: kommunal.id });
check('sub-category keeps its parent', sub.parentId, kommunal.id);
await pushOk('expense', { walletId: spark.id, amount: 40000, categoryId: sub.id });
check('sub-category breakdown row', (await bd('category', 2)).find((r) => r.id === sub.id)?.total, 40000);
check('wallet 4 810 000 after sub-category expense', await bal(spark.id), 4810000);

// 7-9. second wallet, transfer 200 000
const naqd = await call('POST', '/api/wallets', { name: 'Naqd', type: 0, currency: 'UZS', initialBalance: 0, icon: 'cash', color: '#22C55E', allowOverdraft: false }, { 'idempotency-key': `w-${rnd}-2` });
const transferId = await pushOk('transfer', { fromWalletId: spark.id, toWalletId: naqd.id, amount: 200000, memo: 'Transfer' });
check('9. transfer: source 4 610 000', await bal(spark.id), 4610000);
check('9. transfer: target 200 000', await bal(naqd.id), 200000);
check('9. transfer is not an expense', (await summary()).expense, 190000);

// cross-currency transfer with a typed received amount
const usd = await call('POST', '/api/wallets', { name: 'Dollar', type: 0, currency: 'USD', initialBalance: 0, icon: 'cash', color: '#0EA5E9', allowOverdraft: false }, { 'idempotency-key': `w-${rnd}-3` });
await pushOk('transfer', { fromWalletId: spark.id, toWalletId: usd.id, amount: 1200000, toAmount: 100 });
check('cross-currency: UZS side', await bal(spark.id), 3410000);
check('cross-currency: USD side', await bal(usd.id), 100);

// 10-11. income from a source into a wallet; second income into a hand-picked wallet
await pushOk('income', { walletId: spark.id, amount: 1000000, incomeSourceId: maosh.id, reason: 'Oylik' });
check('10. income into Spark', await bal(spark.id), 4410000);
await pushOk('income', { walletId: naqd.id, amount: 175000, incomeSourceId: maosh.id }); // 150000 + 25000 from the calculator
check('11. income into the chosen wallet (Naqd)', await bal(naqd.id), 375000);
check('11. source total = 1 175 000', (await bd('source', 1)).find((r) => r.id === maosh.id)?.total, 1175000);

// 12. history
const all = await history();
check('12. history has expense, sub-expense, 2 transfers, 2 incomes', all.filter((t) => ![0, 9].includes(t.type)).length, 6);

// exact decimals (no float drift): 3333.33 + 0.01 style amounts
await pushOk('expense', { walletId: spark.id, amount: 3333.33, categoryId: kommunal.id });
check('decimal expense is exact', await bal(spark.id), 4406666.67);

// 18. failures never move money; retries are idempotent
const tooMuch = await push('expense', { walletId: naqd.id, amount: 99999999, categoryId: kommunal.id });
check('insufficient funds is rejected', tooMuch.result.status, 'rejected');
check('rejected operation leaves the balance', await bal(naqd.id), 375000);
const dup = `acc-${rnd}-dup`;
for (let i = 0; i < 3; i++) await push('expense', { walletId: naqd.id, amount: 1000, categoryId: kommunal.id }, dup);
check('18. triple tap with one operation id applies once', await bal(naqd.id), 374000);

// 13. edit = correction (reversal + new entry): Elektr 150 000 -> 120 000
const elektr = all.find((t) => t.type === 2 && t.memo === 'Elektr');
const before = await bal(spark.id);
await call('PUT', `/api/transactions/${elektr.id}/expense`, { walletId: spark.id, amount: 120000, categoryId: kommunal.id, memo: 'Elektr', occurredAt: elektr.occurredAt });
check('13. edit gives 30 000 back', await bal(spark.id), before + 30000);
const afterEdit = await history();
check('13. old entry kept and marked reversed', !!afterEdit.find((t) => t.id === elektr.id)?.reversedById, true);
check('13. new entry replaces it', afterEdit.some((t) => t.replacesId === elektr.id && t.amount === 120000), true);

// 14. reverse the transfer: balances come back, history keeps both records
const tr = all.find((t) => t.type === 3 && t.amount === 200000);
await call('POST', `/api/transactions/${tr.id}/reverse`, {});
check('14. reverse: source +200 000', await bal(spark.id), before + 30000 + 200000);
check('14. reverse: target -200 000', await bal(naqd.id), 174000);
const stillThere = await call('GET', `/api/transactions/${tr.id}`);
check('14. reversed entry is still stored (no physical delete)', stillThere.transaction.id, tr.id);
const dupReverse = await call('POST', `/api/transactions/${tr.id}/reverse`, {});
check('14. a second reversal is an idempotent replay', dupReverse.replayed, true);
check('14. the replay moved no money', await bal(naqd.id), 174000);

// 15. analytics follow the corrections; reversed/transfer entries are excluded
const sum = await summary();
check('15. expense total = 120 000 + 40 000 + 3 333.33 + 1 000 + 1 200 000-transfer excluded', sum.expense, 164333.33);
check('15. income total', sum.income, 1175000);
check('15. Kommunal (after edit): 120 000 + 3 333.33 + 1 000', (await bd('category', 2)).find((r) => r.id === kommunal.id)?.total, 124333.33);

// reconciliation: the ledger is consistent (wallet balances == sum of lines)
const rec = await call('GET', '/api/reconciliation');
console.log('reconciliation:', JSON.stringify(rec).slice(0, 300));

console.log(failed === 0 ? '\nALL PASSED' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
