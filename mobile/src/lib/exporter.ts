import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { api } from '@/state/runtime';
import type { Query } from './reportFilter';

const MIME: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  csv: 'text/csv',
};

export type ExportFormat = 'xlsx' | 'pdf' | 'csv';

/**
 * Downloads the server-generated report for exactly the query the Reports screen shows (same filters, same calendar)
 * and opens the share sheet / browser download. The file name comes from the server (period + filters,
 * e.g. RaqamliHamyon_2026-10_Oylik_Xarajat_UZS.xlsx). Returns the name that was used.
 */
export async function exportReport(format: ExportFormat, lang: string, query: Query): Promise<string> {
  const { bytes, name: serverName } = await api.download('/api/reports/export', { ...query, format, lang });
  const name = serverName ?? `RaqamliHamyon_${new Date().toISOString().slice(0, 10)}.${format}`;

  if (Platform.OS === 'web') {
    const blob = new Blob([bytes], { type: MIME[format] });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return name;
  }

  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(new Uint8Array(bytes));
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: MIME[format], dialogTitle: name });
  return name;
}
