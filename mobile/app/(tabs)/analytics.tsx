import { TabScreen } from '@/design/TabScreen';
import { Reports } from '@/features/reports/Reports';

/** The Reports screen (route kept as /analytics so existing links and the tab position stay the same). */
export default function Screen() {
  return (
    <TabScreen>
      <Reports />
    </TabScreen>
  );
}
