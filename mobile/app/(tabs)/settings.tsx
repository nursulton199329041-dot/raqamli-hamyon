import { TabScreen } from '@/design/TabScreen';
import { Settings } from '@/features/Settings';

/** Settings is a main tab (Home, History, Reports, Settings); a settings form reads best at phone-to-tablet width. */
export default function SettingsScreen() {
  return (
    <TabScreen max={720}>
      <Settings />
    </TabScreen>
  );
}
