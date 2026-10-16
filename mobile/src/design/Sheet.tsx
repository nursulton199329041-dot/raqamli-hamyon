import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassCard } from './Glass';
import { usePalette } from './theme';

/**
 * iOS-style bottom sheet used by every form; identical look on iOS, Android and Web.
 *
 * Layout rules that matter on Android:
 *  - every wrapper between the max-height box and the ScrollView has `flexShrink: 1` (React Native defaults to 0,
 *    so without it the ScrollView grows to its full content height, is clipped and cannot scroll);
 *  - `KeyboardAvoidingView` uses `padding` on every platform (Android is edge-to-edge, `adjustResize` no longer
 *    shrinks the window), so the open keyboard never covers the form;
 *  - `footer` (the confirm button) sits outside the ScrollView and therefore always stays visible and tappable.
 */
export function Sheet({ visible, onClose, children, full, footer }: {
  visible: boolean; onClose(): void; children: ReactNode; full?: boolean; footer?: ReactNode;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView testID="sheet-kav" behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable accessibilityLabel="close" style={[StyleSheet.absoluteFill, { backgroundColor: p.overlay }]} onPress={onClose} />
        <View style={{ maxHeight: full ? '94%' : '88%', paddingHorizontal: 8, paddingBottom: Math.max(insets.bottom, 8) }}>
          <GlassCard
            radius={30}
            padding={0}
            style={{ flexShrink: 1, backgroundColor: p.dark ? 'rgba(14,24,48,0.92)' : 'rgba(250,251,255,0.95)' }}
            innerStyle={{ flexShrink: 1 }}
          >
            <View style={{ alignItems: 'center', paddingTop: 10 }}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: p.textSecondary, opacity: 0.5 }} />
            </View>
            <ScrollView
              testID="sheet-scroll"
              style={{ flexShrink: 1 }}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              contentContainerStyle={{ padding: 20, paddingTop: 12, paddingBottom: footer ? 8 : 20 }}
            >
              {children}
            </ScrollView>
            {footer ? <View testID="sheet-footer" style={{ paddingHorizontal: 20, paddingBottom: 16, paddingTop: 4 }}>{footer}</View> : null}
          </GlassCard>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
