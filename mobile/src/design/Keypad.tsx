import * as Haptics from 'expo-haptics';
import { Platform, Pressable, Text, View } from 'react-native';
import { Glyph } from './Icon';
import { usePalette, useT } from './theme';
import type { Key } from '@/lib/calc';

type Cell = { key: Key | 'CLOSE'; label?: string; span?: number; kind: 'digit' | 'op' | 'fn' | 'close' };

// Same arrangement as the reference app: C ⌫ ÷ / 1 2 3 × / 4 5 6 − / 7 8 9 + / . 0 = Close
const ROWS: Cell[][] = [
  [{ key: 'C', label: 'C', span: 2, kind: 'fn' }, { key: 'DEL', kind: 'fn' }, { key: '/', label: '÷', kind: 'op' }],
  [{ key: '1', kind: 'digit' }, { key: '2', kind: 'digit' }, { key: '3', kind: 'digit' }, { key: '*', label: '×', kind: 'op' }],
  [{ key: '4', kind: 'digit' }, { key: '5', kind: 'digit' }, { key: '6', kind: 'digit' }, { key: '-', label: '−', kind: 'op' }],
  [{ key: '7', kind: 'digit' }, { key: '8', kind: 'digit' }, { key: '9', kind: 'digit' }, { key: '+', label: '+', kind: 'op' }],
  [{ key: '.', label: ',', kind: 'digit' }, { key: '0', kind: 'digit' }, { key: '=', label: '=', kind: 'op' }, { key: 'CLOSE', kind: 'close' }],
];

/**
 * Money keypad: big, one-handed, sits under the Save button. It only emits keys; the arithmetic lives in
 * `lib/calc` (exact decimals). `testID`s are `key:<key>` so tests drive it like a finger.
 */
export function Keypad({ onKey, onClose }: { onKey(k: Key): void; onClose(): void }) {
  const p = usePalette();
  const t = useT();
  return (
    <View testID="keypad" style={{ borderTopWidth: 1, borderTopColor: p.glassBorder, backgroundColor: p.dark ? 'rgba(20,8,11,0.96)' : 'rgba(252,245,242,0.97)' }}>
      {ROWS.map((row, ri) => (
        <View key={ri} style={{ flexDirection: 'row' }}>
          {row.map((c) => {
            const color = c.kind === 'op' || c.kind === 'fn' || c.kind === 'close' ? p.accent : p.text;
            return (
              <Pressable
                key={c.key}
                testID={`key:${c.key}`}
                accessibilityRole="button"
                accessibilityLabel={c.key === 'CLOSE' ? t('keypad_close') : c.key === 'DEL' ? 'delete' : (c.label ?? c.key)}
                android_ripple={{ color: `${p.accent}33` }}
                onPress={() => {
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  if (c.key === 'CLOSE') onClose();
                  else onKey(c.key);
                }}
                style={({ pressed }) => ({
                  flex: c.span ?? 1, height: 58, alignItems: 'center', justifyContent: 'center',
                  borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: p.glassBorder,
                  backgroundColor: pressed ? `${p.accent}2E` : 'transparent',
                })}
              >
                {c.key === 'DEL' ? <Glyph name="backspace" color={color} size={26} />
                  : c.key === 'CLOSE' ? <Text style={{ color, fontSize: 16, fontWeight: '700' }}>{t('keypad_close')}</Text>
                    : <Text style={{ color, fontSize: c.kind === 'digit' ? 26 : 24, fontWeight: c.kind === 'digit' ? '500' : '600' }}>{c.label ?? c.key}</Text>}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
