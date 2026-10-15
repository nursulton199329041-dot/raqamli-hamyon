import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Tap } from '@/design/Glass';
import { Glyph } from '@/design/Icon';
import { usePalette } from '@/design/theme';
import { Settings } from '@/features/Settings';

export default function SettingsScreen() {
  const router = useRouter();
  const p = usePalette();
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, alignItems: 'flex-start' }}>
        <Tap label="close" onPress={() => router.back()}><Glyph name="close" color={p.text} size={26} /></Tap>
      </View>
      <Settings />
    </SafeAreaView>
  );
}