import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Button } from '@/design/Controls';
import { GlassCard } from '@/design/Glass';
import { Ink, usePalette, useT } from '@/design/theme';
import { checkConnection, probeUrl, type ConnResult } from '@/lib/connection';
import { isLocalUrl } from '@/lib/serverUrl';
import { useSettings } from '@/state/settings';
import { runtimeInfo } from '@/updates/updates';

function otaSummary() {
  try {
    const i = runtimeInfo();
    return { id: String(i.updateId).slice(0, 13), channel: String(i.channel) };
  } catch {
    return { id: 'n/a', channel: 'n/a' };
  }
}

/**
 * What the phone really uses to reach the backend: the active API URL, the exact probe URL, the OTA update this build runs,
 * and a one-tap reachability test whose result says which kind of failure it is. Shown on the login screen (no account
 * needed) and in Settings.
 */
export function ConnectionCard() {
  const t = useT();
  const p = usePalette();
  const apiUrl = useSettings((s) => s.apiUrl);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ConnResult | null>(null);
  const ota = otaSummary();

  const run = async () => {
    setBusy(true);
    setRes(await checkConnection(apiUrl));
    setBusy(false);
  };

  const message = (r: ConnResult) => {
    switch (r.kind) {
      case 'ok': return t('conn_ok', { v: r.apiVersion ?? '?', ms: r.ms });
      case 'http': return t('conn_http', { status: r.status ?? 0 });
      case 'refused': return t('conn_refused', { ms: r.ms });
      case 'timeout': return t('conn_timeout', { ms: r.ms });
      default: return t('conn_invalid');
    }
  };

  return (
    <GlassCard padding={14}>
      <Text style={{ color: p.text, fontWeight: '800', fontSize: 16 }}>{t('conn_title')}</Text>
      <Text style={{ color: p.textSecondary, fontSize: 12, marginTop: 6 }}>{t('conn_url')}</Text>
      <Text testID="conn-url" selectable style={{ color: p.text, fontWeight: '700' }}>{apiUrl}</Text>
      <Text style={{ color: p.textSecondary, fontSize: 12, marginTop: 6 }}>{t('conn_test_url')}</Text>
      <Text testID="conn-probe" selectable style={{ color: p.text, fontSize: 12 }}>{probeUrl(apiUrl)}</Text>
      <Text testID="conn-ota" selectable style={{ color: p.textSecondary, fontSize: 12, marginTop: 6 }}>
        {t('ota_line', { id: ota.id, channel: ota.channel })}
      </Text>
      {Platform.OS !== 'web' && isLocalUrl(apiUrl) ? <Text style={{ color: Ink.debt, marginTop: 6 }}>{t('server_local_warn')}</Text> : null}
      <Button testID="conn-check" title={busy ? t('conn_checking') : t('conn_check')} variant="tonal" busy={busy} onPress={() => void run()} />
      {res ? (
        <View style={{ marginTop: 8 }}>
          <Text testID="conn-result" style={{ color: res.ok ? Ink.income : Ink.expense, fontWeight: '700' }}>{message(res)}</Text>
          <Text selectable style={{ color: p.textSecondary, fontSize: 11, marginTop: 2 }}>{res.url}</Text>
        </View>
      ) : null}
    </GlassCard>
  );
}
