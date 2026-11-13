import { Text, View } from 'react-native';
import { Tap } from '@/design/Glass';
import { CircleBadge, Glyph } from '@/design/Icon';
import { usePalette, useT, type Palette } from '@/design/theme';
import { radii, space, type } from '@/design/tokens';

export interface FilterItem { id: string; name: string; icon?: string; color?: string }

const round = (p: Palette, active: boolean) => ({
  width: 42, height: 42, borderRadius: 21, alignItems: 'center' as const, justifyContent: 'center' as const,
  backgroundColor: p.glassFill, borderWidth: 1, borderColor: active ? p.accent : p.glassBorder,
});

/** The round funnel at the top right of History and Reports: blue with the number of filters when any is on. */
export function FilterButton({ testID, count, onPress }: { testID: string; count: number; onPress(): void }) {
  const t = useT();
  const p = usePalette();
  return (
    <Tap testID={testID} label={count ? `${t('filter')}: ${count}` : t('filter')} onPress={onPress} style={round(p, count > 0)}>
      <Glyph name="filter" color={count ? p.accent : p.text} size={20} />
      {count ? (
        <View style={{ position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: p.accent }}>
          <Text testID={`${testID}-count`} style={{ color: p.onAccent, fontSize: 11, fontWeight: '800' }}>{count}</Text>
        </View>
      ) : null}
    </Tap>
  );
}

/**
 * The filter sheet's title line. Left: leave the sheet; nothing is undone, choices are applied the moment they are made.
 * With `onReset`, right: clear everything, and a check that confirms (`onClose` also takes typed dates, `onExit` does not).
 */
export function FilterHeader({ onClose, onExit, title, onReset, canReset }: { onClose(): void; onExit?(): void; title?: string; onReset?(): void; canReset?: boolean }) {
  const t = useT();
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 42, marginBottom: space.sm }}>
      <Text accessibilityRole="header" numberOfLines={1} style={[type.headline, { position: 'absolute', left: 104, right: 104, textAlign: 'center', color: p.text }]}>{title ?? t('filter')}</Text>
      <Tap testID="filter-close" label={t('close')} onPress={onExit ?? onClose} style={round(p, false)}>
        <Glyph name="close" color={p.text} size={18} />
      </Tap>
      <View style={{ flex: 1 }} />
      {onReset ? (
        <>
          <Tap testID="reset-filters" label={t('reset_filters')} disabled={!canReset} onPress={onReset} style={[round(p, false), { opacity: canReset ? 1 : 0.35 }]}>
            <Glyph name="filterOff" color={p.text} size={21} />
          </Tap>
          <Tap testID="close-filters" label={t('confirm')} onPress={onClose} style={[round(p, false), { backgroundColor: p.accent, borderColor: p.accent }]}>
            <Glyph name="check" color={p.onAccent} size={22} />
          </Tap>
        </>
      ) : null}
    </View>
  );
}

/**
 * One block of the filter: its title, how much is chosen and the icons to tap. The server filters by one wallet, one
 * category and so on, so one can be chosen per block: tapping it again removes it; nothing chosen means all of them.
 */
export function FilterSection({ id, title, items, selected, onChange }: {
  id: string; title: string; items: FilterItem[]; selected?: string; onChange(id: string | undefined): void;
}) {
  const t = useT();
  const p = usePalette();
  if (items.length === 0) return null;
  return (
    <View testID={`filter-section-${id}`} style={{ marginTop: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm }}>
        <Text numberOfLines={1} style={[type.headline, { color: p.text, flexShrink: 1 }]}>{title}</Text>
        <View style={{ paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: selected ? `${p.accent}33` : p.glassFill }}>
          <Text testID={`filter-count-${id}`} style={[type.caption, { color: selected ? p.accent : p.textSecondary, fontWeight: '700' }]}>
            {selected ? `1 / ${items.length}` : t('all')}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.sm, padding: space.sm, borderRadius: radii.lg, backgroundColor: p.glassFill, borderWidth: 1, borderColor: p.glassBorder }}>
        {items.map((x) => {
          const on = selected === x.id;
          return (
            <Tap key={x.id} testID={`filter-${id}-${x.id}`} label={x.name} haptic={false} onPress={() => onChange(on ? undefined : x.id)}
              containerStyle={{ width: '25%' }} style={{ alignItems: 'center', gap: 4, paddingVertical: 4, opacity: selected && !on ? 0.4 : 1 }}>
              <CircleBadge name={x.icon ?? 'tag'} color={x.color} size={46} ring={on ? p.accent : undefined} />
              <Text numberOfLines={2} style={{ color: on ? p.text : p.textSecondary, fontSize: 11, fontWeight: on ? '800' : '600', textAlign: 'center' }}>{x.name}</Text>
            </Tap>
          );
        })}
      </View>
    </View>
  );
}
