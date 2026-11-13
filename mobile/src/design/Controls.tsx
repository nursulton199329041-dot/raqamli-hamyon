import type { ReactNode } from 'react';
import { ActivityIndicator, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { Glyph } from './Icon';
import { Tap } from './Glass';
import { onAccentOf, usePalette } from './theme';

export function Label({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <Text style={{ color: p.textSecondary, fontWeight: '600', marginTop: 12, marginBottom: 6, fontSize: 13 }}>{children}</Text>;
}

export function Field(props: TextInputProps & { label: string; style?: StyleProp<TextStyle> }) {
  const p = usePalette();
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={{ color: p.textSecondary, fontSize: 12, marginBottom: 4 }}>{label}</Text>
      <TextInput
        placeholderTextColor={p.textSecondary}
        accessibilityLabel={label}
        {...rest}
        style={[{
          borderWidth: 1, borderColor: p.glassBorder, backgroundColor: p.glassFill, color: p.text,
          borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16,
        }, style]}
      />
    </View>
  );
}

export function Chip({ label, selected, color, icon, onPress }: {
  label: string; selected: boolean; color?: string; icon?: string; onPress(): void;
}) {
  const p = usePalette();
  const c = color ?? p.accent;
  return (
    <Tap onPress={onPress} label={label} style={{
      flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14,
      borderWidth: 1, borderColor: selected ? c : p.glassBorder, backgroundColor: selected ? `${c}47` : p.glassFill,
    }}>
      {icon ? <Glyph name={icon} color={c} size={16} /> : null}
      <Text numberOfLines={1} style={{ color: p.text, fontWeight: selected ? '700' : '500', maxWidth: 180 }}>{label}</Text>
    </Tap>
  );
}

export function Wrap({ children, gap = 8 }: { children: ReactNode; gap?: number }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>{children}</View>;
}

export function Button({ title, onPress, color, busy, disabled, style, variant = 'solid', testID }: {
  testID?: string;
  title: string; onPress(): void; color?: string; busy?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>;
  variant?: 'solid' | 'tonal' | 'danger';
}) {
  const p = usePalette();
  const base = variant === 'danger' ? '#EF4444' : (color ?? p.accent);
  const solid = variant === 'solid';
  return (
    <Tap testID={testID} onPress={onPress} disabled={busy || disabled} label={title} style={[{
      minHeight: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
      backgroundColor: solid ? base : `${base}2E`, borderWidth: solid ? 0 : 1, borderColor: `${base}80`,
      opacity: disabled ? 0.5 : 1, marginTop: 14,
    }, style]}>
      {busy ? <ActivityIndicator color={solid ? onAccentOf(base) : base} /> : (
        <Text style={{ color: solid ? onAccentOf(base) : base, fontWeight: '800', fontSize: 16 }}>{title}</Text>
      )}
    </Tap>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange }: {
  options: { value: T; label: string }[]; value: T; onChange(v: T): void;
}) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: p.glassFill, borderRadius: 14, padding: 3, borderWidth: 1, borderColor: p.glassBorder }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Tap key={String(o.value)} label={o.label} onPress={() => onChange(o.value)} style={{
            paddingVertical: 8, borderRadius: 11, alignItems: 'center', backgroundColor: on ? p.accent : 'transparent',
          }}>
            <Text numberOfLines={1} style={{ color: on ? p.onAccent : p.text, fontWeight: '700', fontSize: 13 }}>{o.label}</Text>
          </Tap>
        );
      }).map((el, i) => (<View key={i} style={{ flex: 1 }}>{el}</View>))}
    </View>
  );
}

export function ErrorText({ children }: { children?: string | null }) {
  if (!children) return null;
  return <Text style={{ color: '#FF6B6B', marginTop: 8 }}>{children}</Text>;
}

export function Title({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <Text accessibilityRole="header" style={{ color: p.text, fontSize: 22, fontWeight: '800' }}>{children}</Text>;
}
