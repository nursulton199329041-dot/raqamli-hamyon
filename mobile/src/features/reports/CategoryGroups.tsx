import { useEffect, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { BreakdownRow, Tx } from '@/api/types';
import { Tap } from '@/design/Glass';
import { CircleBadge, Glyph } from '@/design/Icon';
import { useMotionOff } from '@/design/look';
import { Skeleton } from '@/design/States';
import { usePalette, useT } from '@/design/theme';
import { radii, space, type } from '@/design/tokens';
import { groupByCategory, spent, type CategoryGroup } from '@/lib/categoryGroups';
import { longDay } from '@/lib/dates';
import type { Query } from '@/lib/reportFilter';
import { fmtMoney } from '@/lib/money';
import { TX_TYPE_LABEL } from '@/lib/txMeta';
import { useCatalog, useSnapshot } from '@/state/data';
import { useCategoryOps } from '@/state/reports';
import { useSettings } from '@/state/settings';
import { DetailSheet } from '../History';

/**
 * Report expenses grouped by top-level category: each category once, with its count and total under the report's
 * period and filters; tapping it opens its operations, tapping an operation opens its details.
 */
export function CategoryGroups({ rows, loading, currency, q }: { rows: BreakdownRow[]; loading: boolean; currency: string; q: Query }) {
  const t = useT();
  const p = usePalette();
  // every category the account ever had (archived ones too), so old expenses still find their parent
  const categories = useSnapshot().data?.categories ?? [];
  const groups = groupByCategory(rows, categories, currency);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Tx | null>(null);
  const motionOff = useMotionOff();

  if (loading && groups.length === 0) return <Skeleton height={48} />;
  if (groups.length === 0) return <Text style={[type.footnote, { color: p.textSecondary, textAlign: 'center', paddingVertical: space.md }]}>{t('no_ops')}</Text>;
  return (
    <View testID="category-groups">
      {groups.map((g) => {
        const key = g.id ?? 'none';
        const isOpen = open === key;
        return (
          <View key={key} style={{ borderTopWidth: 1, borderTopColor: p.glassBorder }}>
            <Tap testID={`cg-${key}`} label={`${g.name} ${fmtMoney(g.total, currency)}`} haptic={false} onPress={() => setOpen(isOpen ? null : key)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, minHeight: 52 }}>
              <CircleBadge name={g.icon} color={g.color} size={34} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={[type.callout, { color: p.text, fontWeight: '700' }]}>{g.id ? g.name : t('no_category')}</Text>
                <Text numberOfLines={1} style={[type.caption, { color: p.textSecondary }]}>{t('ops_count', { n: g.count })} · {g.percent >= 1 || g.percent === 0 ? `${g.percent.toFixed(0)}%` : '<1%'}</Text>
              </View>
              <Text numberOfLines={1} style={[type.callout, { color: p.text, fontWeight: '700', fontVariant: ['tabular-nums'] }]}>{fmtMoney(g.total, currency)}</Text>
              <Glyph name={isOpen ? 'chevronDown' : 'chevronRight'} color={p.textSecondary} size={18} />
            </Tap>
            {isOpen ? <Appear off={motionOff}><GroupOps group={g} q={q} onPick={setDetail} /></Appear> : null}
          </View>
        );
      })}
      <DetailSheet tx={detail} onClose={() => setDetail(null)} label={(ty) => t(TX_TYPE_LABEL[ty])} />
    </View>
  );
}

/** Opening a category: its operations fade and slide in (quick, and skipped when motion is off). */
function Appear({ off, children }: { off: boolean; children: ReactNode }) {
  const v = useSharedValue(off ? 1 : 0);
  useEffect(() => {
    v.set(withTiming(1, { duration: 180 }));
  }, [v]);
  const style = useAnimatedStyle(() => ({ opacity: v.get(), transform: [{ translateY: (1 - v.get()) * -6 }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

function GroupOps({ group, q, onPick }: { group: CategoryGroup; q: Query; onPick(tx: Tx): void }) {
  const t = useT();
  const p = usePalette();
  const lang = useSettings((s) => s.lang);
  const cat = useCatalog();
  const ops = useCategoryOps(q, group.id, true);
  // the same operations the total was made of: this category (or none), spent in the report currency
  const items = (ops.data?.items ?? []).filter((tx) => (group.id ? true : !tx.categoryId) && spent(tx).currency === group.currency);
  const hidden = Math.max(0, group.count - items.length);
  return (
    <View testID={`cg-ops-${group.id ?? 'none'}`}
      style={{ marginLeft: 22, paddingLeft: space.md, borderLeftWidth: 2, borderLeftColor: `${group.color}66`, marginBottom: space.sm }}>
      {ops.isLoading ? <Skeleton height={40} /> : items.map((tx) => {
        const s = spent(tx);
        const c = cat.category(tx.categoryId);
        const sub = c && c.id !== group.id ? c.name : null;
        const w = cat.wallet(tx.walletId);
        // paid from a wallet in another currency: show what left the wallet too
        const paid = s.currency !== tx.currency ? ` · ${fmtMoney(tx.amount, tx.currency)}` : '';
        return (
          <Tap key={tx.id} testID={`cg-tx-${tx.id}`} label={`${longDay(lang, tx.occurredAt)} ${fmtMoney(s.amount, s.currency)}`} haptic={false} onPress={() => onPick(tx)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 8, borderRadius: radii.sm }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={[type.footnote, { color: p.text }]}>
                {longDay(lang, tx.occurredAt)}{sub ? ` · ${sub}` : ''}
              </Text>
              <Text numberOfLines={1} style={[type.caption, { color: p.textSecondary }]}>
                {w?.name ?? '?'}{paid}{tx.memo ? ` · ${tx.memo}` : ''}
              </Text>
            </View>
            <Text numberOfLines={1} style={[type.footnote, { color: p.text, fontVariant: ['tabular-nums'] }]}>{fmtMoney(s.amount, s.currency)}</Text>
          </Tap>
        );
      })}
      {!ops.isLoading && hidden > 0 ? <Text style={[type.caption, { color: p.textSecondary, paddingVertical: 6 }]}>{t('ops_more', { n: hidden })}</Text> : null}
    </View>
  );
}
