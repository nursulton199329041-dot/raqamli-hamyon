import { Text, View } from 'react-native';
import { Tap } from '@/design/Glass';
import { CircleBadge, Glyph } from '@/design/Icon';
import { usePalette, useT } from '@/design/theme';

interface Item { id: string; name: string; icon: string; color: string }

/** Generic in-sheet chooser (categories, income sources): same page-swap pattern as the wallet picker. */
export function ItemPicker({ title, items, selectedId, allowNone, onSelect, onBack }: {
  title: string; items: Item[]; selectedId?: string; allowNone?: boolean; onSelect(id: string | undefined): void; onBack(): void;
}) {
  const t = useT();
  const p = usePalette();
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <Tap label={t('back')} onPress={onBack} style={{ paddingVertical: 6, paddingRight: 10 }}>
          <Text style={{ color: p.accent, fontSize: 16, fontWeight: '700' }}>{`‹ ${t('back')}`}</Text>
        </Tap>
        <Text numberOfLines={1} style={{ flex: 1, color: p.text, fontSize: 18, fontWeight: '800' }}>{title}</Text>
      </View>
      <View style={{ gap: 8, marginTop: 8 }}>
        {allowNone ? (
          <Tap label="—" onPress={() => onSelect(undefined)} style={{ padding: 12, borderRadius: 18, borderWidth: 1, borderColor: p.glassBorder, backgroundColor: p.glassFill }}>
            <Text style={{ color: p.textSecondary, fontWeight: '700' }}>—</Text>
          </Tap>
        ) : null}
        {items.map((it) => {
          const on = it.id === selectedId;
          return (
            <Tap key={it.id} label={it.name} onPress={() => onSelect(it.id)} style={{
              flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 18, borderWidth: on ? 2 : 1,
              borderColor: on ? it.color : p.glassBorder, backgroundColor: on ? `${it.color}2E` : p.glassFill,
            }}>
              <CircleBadge name={it.icon} color={it.color} size={42} />
              <Text numberOfLines={1} style={{ flex: 1, color: p.text, fontWeight: '700', fontSize: 15 }}>{it.name}</Text>
              {on ? <Glyph name="check" color={it.color} size={20} /> : null}
            </Tap>
          );
        })}
      </View>
    </View>
  );
}
