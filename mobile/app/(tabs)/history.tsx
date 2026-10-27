import { TabScreen } from '@/design/TabScreen';
import { History } from '@/features/History';

export default function Screen() {
  return (
    <TabScreen max={820}>
      <History />
    </TabScreen>
  );
}
