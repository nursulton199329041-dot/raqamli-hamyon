import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { GlassCard } from '@/design/Glass';
import { CircleBadge } from '@/design/Icon';
import { Ink, usePalette, useT } from '@/design/theme';
import { DropZone, Draggable, setDragTrace, useDrag } from '@/dnd/DragDrop';

/**
 * Touch playground for a REAL device. Long-press the wallet circle (350 ms), drag it onto zone A (accepts wallets)
 * or zone B (rejects), release. The log shows what the app saw:
 *  - `touch-space offset`  = raw touch coordinates minus window coordinates. Non-zero on Android means a status-bar/inset
 *    shift, which the drag code compensates for (it derives the finger from window coordinates).
 *  - hit result (zone id or none) and whether the touch was cancelled by the system / the page ScrollView.
 * The page is deliberately taller than the screen so scroll-vs-drag conflicts can be felt.
 */
export function DndDiagnostics() {
  const p = usePalette();
  const t = useT();
  const { dragging } = useDrag();
  const [lines, setLines] = useState<string[]>([]);
  const [live, setLive] = useState('—');
  const [offset, setOffset] = useState<string>('—');
  const lastMove = useRef(0);

  useEffect(() => {
    setDragTrace((event, data) => {
      if (event === 'move') {
        const now = Date.now();
        if (now - lastMove.current > 80) {
          lastMove.current = now;
          setLive(`x=${data?.x} y=${data?.y} zone=${data?.zone ?? 'none'}`);
        }
        return;
      }
      if (event === 'origin') setOffset(`dx=${data?.dx} dy=${data?.dy}`);
      const stamp = new Date().toLocaleTimeString();
      setLines((l) => [`${stamp}  ${event} ${data ? JSON.stringify(data) : ''}`, ...l].slice(0, 14));
    });
    return () => setDragTrace(null);
  }, []);

  return (
    <ScrollView scrollEnabled={!dragging} contentContainerStyle={{ padding: 16, paddingBottom: 200, gap: 14 }}>
      <Text style={{ color: p.text, fontSize: 22, fontWeight: '800' }}>{t('dnd_diag')}</Text>
      <Text style={{ color: p.textSecondary }}>
        1) Bosib ushlang (≈0.35 s) · 2) suring · 3) A zonaga qo‘ying. Pastga scroll qilib ham sinab ko‘ring.
      </Text>

      <GlassCard>
        <Text style={{ color: p.textSecondary, fontSize: 12 }}>touch-space offset (raw − window)</Text>
        <Text testID="diag-offset" style={{ color: p.text, fontWeight: '800', fontSize: 18 }}>{offset}</Text>
        <Text style={{ color: p.textSecondary, fontSize: 12, marginTop: 8 }}>finger (window space)</Text>
        <Text testID="diag-live" style={{ color: p.text, fontWeight: '700' }}>{dragging ? live : '—'}</Text>
      </GlassCard>

      <View style={{ alignItems: 'center' }}>
        <DropZone id="diag:wallet" accepts={() => false} onDrop={() => undefined}>
          {() => (
            <Draggable payload={{ kind: 'wallet', id: 'diag-wallet' }}
              ghost={<View style={{ alignItems: 'center' }}><CircleBadge name="wallet" color="#3B82F6" size={62} ring={p.accent} /></View>}>
              <View style={{ alignItems: 'center', gap: 4, width: 90 }}>
                <CircleBadge name="wallet" color="#3B82F6" size={56} />
                <Text style={{ color: p.text, fontSize: 12 }}>Test hamyon</Text>
              </View>
            </Draggable>
          )}
        </DropZone>
      </View>

      <Zone id="diag:A" title="Zona A — hamyonni qabul qiladi" accepts color={Ink.income} />
      <Zone id="diag:B" title="Zona B — rad etadi (qizil)" accepts={false} color={Ink.expense} />

      <GlassCard>
        <Text style={{ color: p.textSecondary, fontSize: 12, marginBottom: 6 }}>log</Text>
        {lines.length === 0 ? <Text style={{ color: p.textSecondary }}>—</Text> : lines.map((l, i) => (
          <Text key={i} testID={`diag-line-${i}`} style={{ color: p.text, fontSize: 11 }}>{l}</Text>
        ))}
      </GlassCard>
    </ScrollView>
  );
}

function Zone({ id, title, accepts, color }: { id: string; title: string; accepts: boolean; color: string }) {
  const p = usePalette();
  return (
    <DropZone id={id} accepts={() => accepts} onDrop={() => undefined}>
      {({ active, rejected }) => (
        <View style={{
          height: 110, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderStyle: 'dashed',
          borderColor: active ? Ink.income : rejected ? Ink.expense : color, backgroundColor: active ? `${Ink.income}33` : rejected ? `${Ink.expense}22` : p.glassFill,
        }}>
          <Text style={{ color: p.text, fontWeight: '700' }}>{title}</Text>
          <Text style={{ color: p.textSecondary, fontSize: 12 }}>{active ? 'ACTIVE' : rejected ? 'REJECTED' : 'idle'}</Text>
        </View>
      )}
    </DropZone>
  );
}
