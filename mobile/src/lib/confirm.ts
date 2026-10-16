import { Alert, Platform } from 'react-native';

/** Native confirmation dialog (browser confirm on web). `onOk` runs only after the user confirms. */
export function confirmDialog(title: string, message: string, okLabel: string, cancelLabel: string, onOk: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n${message}`)) onOk();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel' },
    { text: okLabel, style: 'destructive', onPress: onOk },
  ]);
}
