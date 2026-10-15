import { SafeAreaView } from 'react-native-safe-area-context';
import { History } from '@/features/History';

export default function Screen() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <History />
    </SafeAreaView>
  );
}
