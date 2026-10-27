import { useEffect } from 'react';
import { Text, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Button } from './Controls';
import { Glyph } from './Icon';
import { Ink, usePalette, useT } from './theme';
import { radii, space, type, useReducedMotion } from './tokens';

/** Empty list / section: glyph, one line of explanation, optional primary action. */
export function EmptyState({ icon, title, hint, action, onAction, testID }: {
  icon: string; title: string; hint?: string; action?: string; onAction?(): void; testID?: string;
}) {
  const p = usePalette();
  return (
    <View testID={testID} style={{ alignItems: 'center', paddingVertical: space.lg, paddingHorizontal: space.md, gap: space.sm, width: '100%' }}>
      <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: `${p.accent}1F` }}>
        <Glyph name={icon} color={p.accent} size={26} />
      </View>
      <Text style={[type.callout, { color: p.text, textAlign: 'center' }]}>{title}</Text>
      {hint ? <Text style={[type.footnote, { color: p.textSecondary, textAlign: 'center' }]}>{hint}</Text> : null}
      {action && onAction ? <Button title={action} onPress={onAction} style={{ alignSelf: 'stretch', marginTop: space.xs }} /> : null}
    </View>
  );
}

/** Failed load with a retry. Keeps the server's message verbatim so the user (and support) see the real cause. */
export function ErrorState({ title, message, retry, onRetry, testID }: {
  title: string; message?: string; retry: string; onRetry(): void; testID?: string;
}) {
  const p = usePalette();
  return (
    <View testID={testID} style={{ alignItems: 'center', padding: space.lg, gap: space.sm }}>
      <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: `${Ink.expense}24` }}>
        <Glyph name="close" color={Ink.expense} size={24} />
      </View>
      <Text style={[type.callout, { color: p.text, textAlign: 'center' }]}>{title}</Text>
      {message ? <Text style={[type.footnote, { color: p.textSecondary, textAlign: 'center' }]}>{message}</Text> : null}
      <Button title={retry} variant="tonal" onPress={onRetry} style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

/** Pulsing placeholder block. Static when the OS asks for reduced motion. */
export function Skeleton({ width = '100%', height = 14, radius = radii.sm, style }: {
  width?: DimensionValue; height?: number; radius?: number; style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const o = useSharedValue(0.55);
  useEffect(() => {
    if (!reduced) o.set(withRepeat(withTiming(1, { duration: 750 }), -1, true));
  }, [o, reduced]);
  const anim = useAnimatedStyle(() => ({ opacity: o.get() }));
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: p.glassFillStrong }, anim, style]} />;
}

/** Skeleton of a tile grid while the first snapshot loads. */
export function LoadingState({ rows = 2, columns = 3, testID }: { rows?: number; columns?: number; testID?: string }) {
  const t = useT();
  return (
    <View testID={testID} accessibilityLabel={t('loading')} style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md }}>
      {Array.from({ length: rows * columns }, (_, i) => (
        <View key={i} style={{ width: `${100 / columns}%`, alignItems: 'center', gap: space.xs }}>
          <Skeleton width="60%" height={10} />
          <Skeleton width={48} height={48} radius={24} />
          <Skeleton width="50%" height={10} />
        </View>
      ))}
    </View>
  );
}
