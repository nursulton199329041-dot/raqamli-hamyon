import { SafeAreaView } from 'react-native-safe-area-context';
import { Debts } from '@/features/ProjectsAndDebts';

export default function Screen() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <Debts />
    </SafeAreaView>
  );
}
