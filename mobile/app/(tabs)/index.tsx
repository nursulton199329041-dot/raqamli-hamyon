import { TabScreen } from '@/design/TabScreen';
import { Dashboard } from '@/features/Dashboard';

export default function Screen() {
  return (
    <TabScreen>
      <Dashboard />
    </TabScreen>
  );
}
