import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { usePalette } from './theme';
import { useLook, useMotionOff } from './look';
import { haptic as haptics, motion } from './tokens';

/**
 * Full-screen background: a quiet two-stop gradient only. The large decorative light orbs were removed — they competed
 * with the content and cost an extra full-screen gradient layer on every frame.
 */
export function GlassBackground({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ flex: 1, backgroundColor: p.bgTop, overflow: 'hidden' }}>
      <LinearGradient colors={[p.bgTop, p.bgBottom]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {children}
    </View>
  );
}
interface GlassCardProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  tint?: string;
  highlight?: boolean;
  padding?: number;
  /** style of the inner padded wrapper (e.g. `flexShrink: 1` so a ScrollView inside can shrink and scroll) */
  innerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Frosted glass surface. One component for both platforms: backdrop blur + translucent fill + hairline border.
 * Android blurs only on SDK 31+ (`dimezisBlurViewSdk31Plus`; older devices get the translucent fill, the blur is too slow
 * there); with "reduce effects" every platform falls back to the plain translucent fill.
 */
export function GlassCard({ children, style, radius = 24, tint, highlight, padding = 16, innerStyle, testID }: GlassCardProps) {
  const p = usePalette();
  const look = useLook();
  const reduce = !look.glass;
  const r = Math.round(radius * look.radiusScale);
  const border = highlight ? p.accent : p.glassBorder;
  const fill = tint ? `${tint}29` : p.glassFill;
  return (
    <View
      testID={testID}
      style={[
        {
          borderRadius: r,
          borderWidth: highlight ? 1.6 : StyleSheet.hairlineWidth * 1.5,
          borderColor: border,
          overflow: 'hidden',
          shadowColor: highlight ? p.accent : '#000',
          shadowOpacity: highlight ? 0.45 : p.dark ? 0.22 : 0.08,
          shadowRadius: highlight ? 18 : 14,
          shadowOffset: { width: 0, height: 6 },
          elevation: highlight ? 6 : 1,
          backgroundColor: reduce ? p.glassFillStrong : undefined,
        },
        style,
      ]}
    >
      {!reduce && (
        <BlurView
          intensity={Platform.OS === 'android' ? look.blurIntensity : look.blurIntensity + 5}
          tint={p.blurTint}
          blurMethod="dimezisBlurViewSdk31Plus"
          style={StyleSheet.absoluteFill}
        />
      )}
      <LinearGradient
        colors={[fill, `${tint ?? '#FFFFFF'}0D`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={[{ padding }, innerStyle]}>{children}</View>
    </View>
  );
}

interface PressableProps {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** style of the outer Pressable (use for flex/width inside rows; style only styles the inner animated view) */
  containerStyle?: StyleProp<ViewStyle>;
  label?: string;
  disabled?: boolean;
  haptic?: boolean;
  testID?: string;
}

/** Soft scale-down + haptic tick. Accessible by default (role=button + label). Honors the OS "reduce motion" setting. */
export function Tap({ children, onPress, onLongPress, style, containerStyle, label, disabled, haptic = true, testID }: PressableProps) {
  const scale = useSharedValue(1);
  const reduced = useMotionOff();
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      testID={testID}
      style={containerStyle}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPressIn={() => { if (!reduced) scale.set(withSpring(0.96, motion.press)); }}
      onPressOut={() => { if (!reduced) scale.set(withSpring(1, motion.release)); }}
      onPress={() => {
        if (haptic) haptics.tick();
        onPress?.();
      }}
      onLongPress={onLongPress}
    >
      <Animated.View style={[anim, style]}>{children}</Animated.View>
    </Pressable>
  );
}
