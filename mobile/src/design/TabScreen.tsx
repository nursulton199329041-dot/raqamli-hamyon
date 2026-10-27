import { useIsFocused } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CONTENT_MAX, useScreenLayout } from './layout';

/**
 * Tab scene shell. Scenes are transparent (the glass background shows through), so an unfocused but still
 * mounted tab must be removed from layout or it renders on top of the active one (seen on web).
 * Content is centred and capped per breakpoint so cards and charts never stretch across a wide monitor.
 */
export function TabScreen({ children, max }: { children: ReactNode; /** narrower cap for reading-width screens (lists, forms) */ max?: number }) {
  const focused = useIsFocused();
  const { bp } = useScreenLayout();
  return (
    <SafeAreaView style={{ flex: 1, display: focused ? 'flex' : 'none' }} edges={['top']}>
      <PageWidth max={Math.min(max ?? Infinity, CONTENT_MAX[bp])}>{children}</PageWidth>
    </SafeAreaView>
  );
}

/** Full-height column, horizontally centred, at most `max` wide. */
export function PageWidth({ max, children }: { max: number; children: ReactNode }) {
  return (
    <View style={{ flex: 1, width: '100%', maxWidth: Number.isFinite(max) ? max : undefined, alignSelf: 'center' }}>
      {children}
    </View>
  );
}
