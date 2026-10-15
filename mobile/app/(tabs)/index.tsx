import { SafeAreaView } from 'react-native-safe-area-context';
import { Dashboard } from '@/features/Dashboard';

export default function Screen() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <Dashboard />
    </SafeAreaView>
  );
}
