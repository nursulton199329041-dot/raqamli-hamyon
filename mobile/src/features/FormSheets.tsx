import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { ApiError } from '@/api/client';
import type { Wallet } from '@/api/types';
import { Button, Chip, ErrorText, Field, Label, Wrap } from '@/design/Controls';
import { ICON_KEYS, IconBadge } from '@/design/Icon';
import { Tap } from '@/design/Glass';
import { Sheet } from '@/design/Sheet';
import { usePalette, useT } from '@/design/theme';
import { newKey, parseAmount } from '@/lib/money';
import { api } from '@/state/runtime';
import { useCatalog } from '@/state/data';
import { useUi } from '@/state/ui';

const COLORS = ['#3B82F6', '#22C55E', '#EF4444', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#64748B', '#0EA5E9'];
const CURRENCIES = ['UZS', 'USD', 'EUR', 'RUB', 'KZT'];

export function IconColorPicker({ icon, color, onIcon, onColor }: {
  icon: string; color: string; onIcon(k: string): void; onColor(c: string): void;
}) {
  return (
    <View>
      <Label>Icon</Label>
      <Wrap gap={8}>
        {ICON_KEYS.map((k) => (
          <Tap key={k} label={k} onPress={() => onIcon(k)} style={{
            padding: 3, borderRadius: 16, borderWidth: 2, borderColor: k === icon ? '#fff' : 'transparent',
          }}>
            <IconBadge name={k} color={color} size={40} />
          </Tap>
        ))}
      </Wrap>
      <Label>Color</Label>
      <Wrap gap={10}>
        {COLORS.map((c) => (
          <Tap key={c} label={c} onPress={() => onColor(c)} style={{
            width: 34, height: 34, borderRadius: 17, backgroundColor: c, borderWidth: 3, borderColor: c === color ? '#fff' : 'transparent',
          }}>
            <View />
          </Tap>
        ))}
      </Wrap>
    </View>
  );
}

function useSave(done: () => void, onResult?: (result: unknown) => void) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      await qc.invalidateQueries();
      onResult?.(result);
      done();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** Create/edit wallet form. `onCreated` receives the wallet returned by the backend (after the catalog was refreshed). */
export function WalletForm({ done, walletId, onCreated }: { done(): void; walletId: string | null; onCreated?(w: Wallet): void }) {
  const t = useT();
  const cat = useCatalog();
  const existing = walletId ? cat.wallet(walletId) : undefined;
  const editing = !!existing;
  const { busy, error, run } = useSave(done, (r) => {
    if (!editing && onCreated && r && typeof r === 'object' && 'id' in r) onCreated(r as Wallet);
  });
  const [name, setName] = useState(existing?.name ?? '');
  const [balance, setBalance] = useState('');
  const [bank, setBank] = useState(existing?.bankName ?? '');
  const [mask, setMask] = useState(existing?.maskedNumber ?? '');
  const [currency, setCurrency] = useState(existing?.currency ?? 'UZS');
  const [type, setType] = useState(existing?.type ?? 1);
  const [icon, setIcon] = useState(existing?.icon ?? 'wallet');
  const [color, setColor] = useState(existing?.color ?? '#3B82F6');
  const [overdraft, setOverdraft] = useState(existing?.allowOverdraft ?? false);
  const [local, setLocal] = useState<string | null>(null);
  const p = usePalette();
  const types: [number, string][] = [[0, t('cash')], [1, t('card')], [2, t('account')], [3, t('savings')], [4, t('virtual')], [5, t('project_wallet')]];

  return (
    <View>
      <Text style={{ color: p.text, fontSize: 20, fontWeight: '800' }}>{t(editing ? 'edit_wallet' : 'new_wallet')}</Text>
      <Field label={t('name')} value={name} onChangeText={setName} maxLength={80} />
      {!editing && (
        <>
          <Label>{t('type')}</Label>
          <Wrap>{types.map(([v, l]) => <Chip key={v} label={l} selected={type === v} onPress={() => setType(v)} />)}</Wrap>
          <Label>{t('currency')}</Label>
          <Wrap>{CURRENCIES.map((c) => <Chip key={c} label={c} selected={currency === c} onPress={() => setCurrency(c)} />)}</Wrap>
          <Field label={`${t('initial_balance')} (${currency})`} value={balance} onChangeText={setBalance} keyboardType="decimal-pad" />
        </>
      )}
      <Field label={t('bank_name')} value={bank} onChangeText={setBank} />
      <Field label={t('masked_number')} value={mask} onChangeText={setMask} maxLength={8} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
        <Text style={{ color: p.text }}>{t('overdraft')}</Text>
        <Switch value={overdraft} onValueChange={setOverdraft} />
      </View>
      <IconColorPicker icon={icon} color={color} onIcon={setIcon} onColor={setColor} />
      <ErrorText>{local ?? error}</ErrorText>
      <Button title={t('save')} busy={busy} onPress={() => {
        if (!name.trim()) return setLocal(t('name'));
        const initial = /^\s*0*([.,]0*)?\s*$/.test(balance) ? 0 : parseAmount(balance); // an empty or zero opening balance is valid
        if (initial === null) return setLocal(t('initial_balance'));
        setLocal(null);
        if (editing && walletId) {
          void run(() => api.patch(`/api/wallets/${walletId}`, {
            name: name.trim(), icon, color, bankName: bank.trim() || null, maskedNumber: mask.trim() || null, allowOverdraft: overdraft,
          }));
          return;
        }
        void run(() => api.post<Wallet>('/api/wallets', {
          name: name.trim(), type, currency, initialBalance: initial, icon, color,
          bankName: bank.trim() || null, maskedNumber: mask.trim() || null, allowOverdraft: overdraft,
        }, newKey('w')));
      }} />
    </View>
  );
}

function CategoryForm({ done, source }: { done(): void; source: boolean }) {
  const t = useT();
  const p = usePalette();
  const { busy, error, run } = useSave(done);
  const [name, setName] = useState('');
  const [limit, setLimit] = useState('');
  const [icon, setIcon] = useState(source ? 'briefcase' : 'tag');
  const [color, setColor] = useState(source ? '#22C55E' : '#EF4444');
  const [local, setLocal] = useState<string | null>(null);
  return (
    <View>
      <Text style={{ color: p.text, fontSize: 20, fontWeight: '800' }}>{t(source ? 'new_source' : 'new_category')}</Text>
      <Field label={t('name')} value={name} onChangeText={setName} maxLength={80} />
      {!source && <Field label={`${t('limit')} (UZS / ${t('month')})`} value={limit} onChangeText={setLimit} keyboardType="decimal-pad" />}
      <IconColorPicker icon={icon} color={color} onIcon={setIcon} onColor={setColor} />
      <ErrorText>{local ?? error}</ErrorText>
      <Button title={t('save')} busy={busy} onPress={() => {
        if (!name.trim()) return setLocal(t('name'));
        setLocal(null);
        void run(() => source
          ? api.post('/api/income-sources', { name: name.trim(), icon, color })
          : api.post('/api/categories', {
              name: name.trim(), icon, color, monthlyLimit: limit.trim() ? parseAmount(limit) : null, limitCurrency: 'UZS',
            }));
      }} />
    </View>
  );
}

function ProjectForm({ done }: { done(): void }) {
  const t = useT();
  const p = usePalette();
  const { busy, error, run } = useSave(done);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('UZS');
  const [icon, setIcon] = useState('project');
  const [color, setColor] = useState('#8B5CF6');
  const [local, setLocal] = useState<string | null>(null);
  return (
    <View>
      <Text style={{ color: p.text, fontSize: 20, fontWeight: '800' }}>{t('new_project')}</Text>
      <Field label={t('name')} value={name} onChangeText={setName} maxLength={80} />
      <Label>{t('currency')}</Label>
      <Wrap>{CURRENCIES.map((c) => <Chip key={c} label={c} selected={currency === c} onPress={() => setCurrency(c)} />)}</Wrap>
      <IconColorPicker icon={icon} color={color} onIcon={setIcon} onColor={setColor} />
      <ErrorText>{local ?? error}</ErrorText>
      <Button title={t('save')} busy={busy} onPress={() => {
        if (!name.trim()) return setLocal(t('name'));
        setLocal(null);
        void run(() => api.post('/api/projects', { name: name.trim(), icon, color, currency }));
      }} />
    </View>
  );
}

export function FormSheets() {
  const form = useUi((s) => s.form);
  const close = useUi((s) => s.closeForm);
  const formId = useUi((s) => s.formId);
  return (
    <Sheet visible={form !== null} onClose={close} full>
      {form === 'wallet' && <WalletForm key={formId ?? 'new'} done={close} walletId={formId} />}
      {form === 'category' && <CategoryForm done={close} source={false} />}
      {form === 'source' && <CategoryForm done={close} source />}
      {form === 'project' && <ProjectForm done={close} />}
    </Sheet>
  );
}
