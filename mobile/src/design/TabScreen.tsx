import { useIsFocused } from 'expo-router';
import type { ReactNode } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Tab scene shell. Scenes are transparent (the glass background shows through), so an unfocused but still
 * mounted tab must be removed from layout or it renders on top of the active one (seen on web).
 */
export function TabScreen({ children }: { children: ReactNode }) {
  const focused = useIsFocused();
  return (
    <SafeAreaView style={{ flex: 1, display: focused ? 'flex' : 'none' }} edges={['top']}>
      {children}
    </SafeAreaView>
  );
}
