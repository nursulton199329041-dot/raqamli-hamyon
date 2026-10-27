import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ApiError } from '@/api/client';
import type { Debt, ProjectSummary } from '@/api/types';
import { Button, Chip, ErrorText, Field, Label, Wrap } from '@/design/Controls';
import { GlassCard, Tap } from '@/design/Glass';
import { Grid } from '@/design/Grid';
import { Glyph, IconBadge } from '@/design/Icon';
import { useScreenLayout } from '@/design/layout';
import { Sheet } from '@/design/Sheet';
import { Ink, usePalette, useT } from '@/design/theme';
import { fmtDate, fmtMoney, parseAmount } from '@/lib/money';
import { useCatalog, useSummary } from '@/state/data';
import { useQueue } from '@/state/queue';
import { api } from '@/state/runtime';
import { useUi } from '@/state/ui';

export function Projects() {
  const t = useT();
  const p = usePalette();
  const cat = useCatalog();
  const openForm = useUi((s) => s.openForm);
  const [openId, setOpenId] = useState<string | null>(null);
  const L = useScreenLayout();
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: L.gutter, paddingTop: 16, paddingBottom: L.bottomSpace + 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: p.text, fontSize: 24, fontWeight: '800' }}>{t('projects')}</Text>
        <Tap label={t('new_project')} onPress={() => openForm('project')}><Glyph name="plus" color={p.accent} size={28} /></Tap>
      </View>
      <Grid columns={L.cardColumns}>
      {cat.projects.map((pr) => (
        <Tap key={pr.id} label={pr.name} onPress={() => setOpenId(pr.id)}>
          <GlassCard>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <IconBadge name={pr.icon} color={pr.color} />
              <Text style={{ flex: 1, color: p.text, fontWeight: '800', fontSize: 16 }}>{pr.name}</Text>
              <Text style={{ color: p.textSecondary }}>{pr.currency}</Text>
            </View>
          </GlassCard>
        </Tap>
      ))}
      </Grid>
      <ProjectSheet id={openId} onClose={() => setOpenId(null)} />
    </ScrollView>
  );
}

function ProjectSheet({ id, onClose }: { id: string | null; onClose(): void }) {
  const t = useT();
  const p = usePalette();
  const cat = useCatalog();
  const q = useQuery({
    queryKey: ['project', id],
    enabled: id !== null,
    queryFn: () => api.get<ProjectSummary>(`/api/projects/${id}/summary`),
  });
  const s = q.data;
  const currencies = s ? [...new Set([...Object.keys(s.income), ...Object.keys(s.expense), ...Object.keys(s.remaining)])] : [];
  return (
    <Sheet visible={id !== null} onClose={onClose} full>
      {s && (
        <View>
          <Text style={{ color: p.text, fontSize: 22, fontWeight: '800' }}>{s.project.name}</Text>
          {currencies.map((cur) => (
            <View key={cur} style={{ marginTop: 12, gap: 4 }}>
              <Text style={{ color: p.textSecondary, fontWeight: '700' }}>{cur}</Text>
              <Row k={t('income')} v={fmtMoney(s.income[cur] ?? 0, cur)} c={Ink.income} />
              <Row k={t('expense')} v={fmtMoney(s.expense[cur] ?? 0, cur)} c={Ink.expense} />
              <Row k={t('bucket')} v={fmtMoney(s.remaining[cur] ?? 0, cur)} c={Ink.transfer} />
            </View>
          ))}
          <Label>{t('real_balance')}</Label>
          {s.wallets.map((w) => (
            <View key={w.walletId} style={{ flexDirection: 'row', paddingVertical: 3 }}>
              <Text style={{ flex: 1, color: p.text }}>{w.wallet}</Text>
              <Text style={{ color: p.textSecondary }}>
                {fmtMoney(w.allocated, w.currency)} / {fmtMoney(cat.wallet(w.walletId)?.balance ?? 0, w.currency)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Sheet>
  );
}

function Row({ k, v, c }: { k: string; v: string; c: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row' }}>
      <Text style={{ flex: 1, color: p.text }}>{k}</Text>
      <Text style={{ color: c, fontWeight: '800' }}>{v}</Text>
    </View>
  );
}

export function Debts() {
  const t = useT();
  const p = usePalette();
  const cat = useCatalog();
  const summary = useSummary('all');
  const openOp = useUi((s) => s.openOp);
  const [repay, setRepay] = useState<Debt | null>(null);
  const open = cat.debts.filter((d) => d.status === 0);
  const closed = cat.debts.filter((d) => d.status !== 0);
  const L = useScreenLayout();

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: L.gutter, paddingTop: 16, paddingBottom: L.bottomSpace + 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: p.text, fontSize: 24, fontWeight: '800' }}>{t('debts')}</Text>
        <Tap label={t('debt')} onPress={() => openOp({ kind: 'debt' })}><Glyph name="plus" color={p.accent} size={28} /></Tap>
      </View>
      <Grid columns={Math.min(L.cardColumns, Math.max(1, (summary.data?.debts ?? []).length))}>
      {(summary.data?.debts ?? []).map((d) => (
        <GlassCard key={d.currency} tint={Ink.debt}>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: p.textSecondary, fontSize: 12 }}>{t('i_owe')}</Text>
              <Text style={{ color: p.text, fontWeight: '800', fontSize: 17 }}>{fmtMoney(d.iOwe, d.currency)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: p.textSecondary, fontSize: 12 }}>{t('owed_to_me')}</Text>
              <Text style={{ color: p.text, fontWeight: '800', fontSize: 17 }}>{fmtMoney(d.owedToMe, d.currency)}</Text>
            </View>
          </View>
        </GlassCard>
      ))}
      </Grid>
      {open.length === 0 && <Text style={{ color: p.textSecondary, textAlign: 'center', marginTop: 30 }}>{t('empty_history')}</Text>}
      <Grid columns={L.cardColumns}>{open.map((d) => <DebtCard key={d.id} debt={d} onRepay={() => setRepay(d)} />)}</Grid>
      {closed.length > 0 && <Text style={{ color: p.textSecondary, fontWeight: '700', marginTop: 12 }}>{t('archived')}</Text>}
      <Grid columns={L.cardColumns}>{closed.map((d) => <DebtCard key={d.id} debt={d} />)}</Grid>
      <RepaySheet debt={repay} onClose={() => setRepay(null)} />
    </ScrollView>
  );
}

function DebtCard({ debt, onRepay }: { debt: Debt; onRepay?: () => void }) {
  const t = useT();
  const p = usePalette();
  const cat = useCatalog();
  const iOwe = debt.direction === 0;
  const paid = debt.principal === 0 ? 0 : Math.min(1, Math.max(0, 1 - debt.outstanding / debt.principal));
  const overdue = debt.status === 0 && !!debt.dueDate && new Date(debt.dueDate) < new Date();
  return (
    <GlassCard style={{ opacity: debt.status === 0 ? 1 : 0.6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Glyph name={iOwe ? 'arrowIn' : 'arrowOut'} color={Ink.debt} size={22} />
        <Text numberOfLines={1} style={{ flex: 1, color: p.text, fontWeight: '800', fontSize: 16 }}>{cat.person(debt.personId)?.name ?? '?'}</Text>
        <Text style={{ color: p.textSecondary }}>{iOwe ? t('borrowed') : t('lent')}</Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.14)', marginTop: 10, overflow: 'hidden' }}>
        <View style={{ width: `${paid * 100}%`, height: 8, backgroundColor: Ink.debt }} />
      </View>
      <View style={{ flexDirection: 'row', marginTop: 6 }}>
        <Text style={{ flex: 1, color: p.text, fontWeight: '700' }}>{t('outstanding')}: {fmtMoney(debt.outstanding, debt.currency)}</Text>
        <Text style={{ color: p.textSecondary }}>{fmtMoney(debt.principal, debt.currency)}</Text>
      </View>
      {debt.dueDate && (
        <Text style={{ color: overdue ? Ink.expense : p.textSecondary, fontSize: 12 }}>{t('due')}: {fmtDate(debt.dueDate)}</Text>
      )}
      {onRepay && <Button title={t('repay')} variant="tonal" color={Ink.debt} onPress={onRepay} style={{ minHeight: 44 }} />}
    </GlassCard>
  );
}

function RepaySheet({ debt, onClose }: { debt: Debt | null; onClose(): void }) {
  const t = useT();
  const p = usePalette();
  const cat = useCatalog();
  const submit = useQueue((s) => s.submit);
  const qc = useQueryClient();
  const wallets = cat.activeWallets.filter((w) => w.currency === debt?.currency);
  const [amount, setAmount] = useState('');
  const [walletId, setWalletId] = useState<string | undefined>();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wid = walletId ?? wallets[0]?.id;

  return (
    <Sheet visible={debt !== null} onClose={onClose}>
      {debt && (
        <View>
          <Text style={{ color: p.text, fontSize: 20, fontWeight: '800' }}>{t('repay')}</Text>
          <Field label={`${t('amount')} (${debt.currency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad"
            placeholder={String(debt.outstanding)} />
          <Label>{t('wallet')}</Label>
          <Wrap>
            {wallets.map((w) => <Chip key={w.id} label={w.name} icon={w.icon} color={w.color} selected={wid === w.id} onPress={() => setWalletId(w.id)} />)}
          </Wrap>
          <ErrorText>{err}</ErrorText>
          <Button title={t('confirm')} busy={busy} onPress={async () => {
            const v = parseAmount(amount) ?? debt.outstanding;
            if (!wid) return setErr(t('select_wallet'));
            setBusy(true);
            const r = await submit('repay', { walletId: wid, amount: v }, debt.id);
            setBusy(false);
            if (!r.ok) return setErr(r.message);
            setAmount('');
            await qc.invalidateQueries();
            onClose();
          }} />
        </View>
      )}
    </Sheet>
  );
}

export { ApiError };
