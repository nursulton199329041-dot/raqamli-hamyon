import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { api } from '@/state/runtime';
import { periodFrom, type Period } from '@/state/data';

const MIME: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  csv: 'text/csv',
};

/** Downloads the server-generated report (active period filter applied) and opens the share sheet / browser download. */
export async function exportReport(format: 'xlsx' | 'pdf' | 'csv', lang: string, period: Period): Promise<void> {
  const bytes = await api.download('/api/reports/export', { format, lang, from: periodFrom(period) });
  const name = `hamyon-${new Date().toISOString().slice(0, 10)}.${format}`;

  if (Platform.OS === 'web') {
    const blob = new Blob([bytes], { type: MIME[format] });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(new Uint8Array(bytes));
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: MIME[format], dialogTitle: name });
}
