import { SafeAreaView } from 'react-native-safe-area-context';
import { Analytics } from '@/features/Analytics';

export default function Screen() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <Analytics />
    </SafeAreaView>
  );
}
