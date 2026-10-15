import { View } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import type { SeriesPoint } from '@/api/types';
import { Ink } from './theme';

export const SLICE_COLORS = ['#6EA8FF', '#FF6B6B', '#22C55E', '#F59E0B', '#8B5CF6', '#14B8A6', '#EC4899', '#94A3B8'];

/** Donut built from stroked arcs (strokeDasharray), no layout dependence → same on every platform. */
export function Donut({ percents, size = 120, stroke = 16 }: { percents: number[]; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} fill="none" />
        {percents.map((pc, i) => {
          const len = Math.max(0, (pc / 100) * c);
          const offset = percents.slice(0, i).reduce((s, x) => s + Math.max(0, (x / 100) * c), 0);
          return (
            <Circle
              key={i}
              cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={SLICE_COLORS[i % SLICE_COLORS.length]} strokeWidth={stroke}
              strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`} strokeDashoffset={-offset}
            />
          );
        })}
      </G>
    </Svg>
  );
}

/** Grouped income/expense bars for one currency. */
export function Bars({ points, width = 300, height = 150 }: { points: SeriesPoint[]; width?: number; height?: number }) {
  const pts = points.slice(-14);
  if (pts.length === 0) return <View style={{ height }} />;
  const max = Math.max(1, ...pts.map((p) => Math.max(p.income, p.expense)));
  const slot = width / pts.length;
  const bw = Math.min(14, slot / 2.6);
  const usable = height - 8;
  return (
    <Svg width={width} height={height}>
      {pts.map((p, i) => {
        const x = slot * i + slot / 2;
        const hi = (p.income / max) * usable;
        const he = (p.expense / max) * usable;
        return (
          <G key={p.period + i}>
            <Rect x={x - bw - 1} y={height - hi} width={bw} height={Math.max(hi, 1)} rx={bw / 3} fill={Ink.income} />
            <Rect x={x + 1} y={height - he} width={bw} height={Math.max(he, 1)} rx={bw / 3} fill={Ink.expense} />
          </G>
        );
      })}
    </Svg>
  );
}

/** Smooth trend line of net flow. */
export function Line({ values, width = 300, height = 80, color = '#6EA8FF' }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return <View style={{ height }} />;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const y = (v: number) => height - 6 - ((v - min) / span) * (height - 12);
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <Svg width={width} height={height}>
      <Path d={d} stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
