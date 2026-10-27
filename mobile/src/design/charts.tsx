import { useState, type ReactNode } from 'react';
import { Platform, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line as SvgLine, Path, Rect, Text as SvgText } from 'react-native-svg';
import type { SeriesPoint } from '@/api/types';
import { compactMoney } from '@/lib/money';
import { Ink, usePalette } from './theme';
import { type } from './tokens';

/** SVG <text> does not inherit the app font: on web it would fall back to the browser's serif default. */
const AXIS_FONT = Platform.OS === 'web' ? 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' : undefined;

export const SLICE_COLORS = ['#4D8DFF', '#FF6B6B', '#1FCB8B', '#F5A524', '#7C6CFF', '#14B8A6', '#EC4899', '#94A3B8'];

/**
 * Measures the width actually available to a chart. Charts draw in real pixels of their container — never a hard-coded
 * width (a fixed 300px chart overflowed 320px phones and looked lost on desktops).
 */
export function ChartBox({ height, children, testID }: { height: number; children: (width: number) => ReactNode; testID?: string }) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.floor(e.nativeEvent.layout.width);
    if (next !== w) setW(next);
  };
  return (
    <View testID={testID} onLayout={onLayout} style={{ width: '100%', height, overflow: 'hidden' }}>
      {w > 0 ? children(w) : null}
    </View>
  );
}

/** Point on a circle, angle in degrees clockwise from 12 o'clock. */
function polar(c: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: c + r * Math.cos(a), y: c + r * Math.sin(a) };
}

/** SVG arc path from `a0` to `a1` degrees (clockwise from 12 o'clock). */
export function arcPath(c: number, r: number, a0: number, a1: number) {
  const s = polar(c, r, a0);
  const e = polar(c, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${s.x.toFixed(2)},${s.y.toFixed(2)} A${r},${r} 0 ${large} 1 ${e.x.toFixed(2)},${e.y.toFixed(2)}`;
}

/**
 * Donut whose geometry comes from its `size` (the caller passes the measured container size): centre = size/2,
 * radius = (size - stroke)/2. Slices are explicit arc paths starting at 12 o'clock — no `rotation`/`origin` group
 * transform, which react-native-svg's web renderer emits as an invalid `transform-origin` DOM attribute.
 */
export interface Slice { color: string; kind: 'ring' | 'arc'; d?: string }

/** Pure donut geometry: centre `size/2`, radius `(size - stroke)/2`, one arc per non-empty slice from 12 o'clock. */
export function donutSlices(percents: number[], size: number, stroke: number) {
  const c = size / 2;
  const r = (size - stroke) / 2;
  const total = percents.reduce((s, x) => s + Math.max(0, x), 0);
  const gapDeg = percents.filter((x) => x > 0).length > 1 ? 1.2 : 0;
  const slices: Slice[] = [];
  let at = 0;
  percents.forEach((pc, i) => {
    if (total <= 0) return;
    const sweep = (Math.max(0, pc) / total) * 360;
    const a0 = at;
    at += sweep;
    if (sweep <= gapDeg) return;
    const color = SLICE_COLORS[i % SLICE_COLORS.length]!;
    // a single full slice cannot be one arc (start == end): it is a full ring
    if (sweep >= 359.9) slices.push({ color, kind: 'ring' });
    else slices.push({ color, kind: 'arc', d: arcPath(c, r, a0, a0 + sweep - gapDeg) });
  });
  return { c, r, slices };
}

/**
 * Donut whose geometry comes from its `size` (the caller passes the measured container size). Slices are explicit arc
 * paths — no `rotation`/`origin` group transform, which react-native-svg's web renderer emits as an invalid
 * `transform-origin` DOM attribute.
 */
export function Donut({ percents, size = 120, stroke, center }: { percents: number[]; size?: number; stroke?: number; center?: ReactNode }) {
  const p = usePalette();
  const sw = stroke ?? Math.max(10, Math.round(size * 0.13));
  const { c, r, slices } = donutSlices(percents, size, sw);
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={c} cy={c} r={r} stroke={p.dark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)'} strokeWidth={sw} fill="none" />
        {slices.map((s, i) => (s.kind === 'ring'
          ? <Circle key={i} cx={c} cy={c} r={r} stroke={s.color} strokeWidth={sw} fill="none" />
          : <Path key={i} d={s.d} stroke={s.color} strokeWidth={sw} fill="none" />))}
      </Svg>
      {center ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: sw, right: sw, top: sw, bottom: sw, alignItems: 'center', justifyContent: 'center' }}>
          {center}
        </View>
      ) : null}
    </View>
  );
}

/** "12 OKT", "W42", "2026-10" -> short axis label. */
function axisLabel(pt: SeriesPoint) {
  const d = new Date(pt.start);
  if (Number.isNaN(d.getTime())) return pt.period;
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export interface BarRect { x: number; y: number; w: number; h: number; kind: 'income' | 'expense' }
export interface AxisText { x: number; y: number; text: string; anchor: 'start' | 'middle' | 'end' }

/**
 * Pure bar-chart geometry for the given pixel size: a left value axis with 3 gridlines, at most as many periods as fit
 * (>= 22px each, so both bars stay visible) and x-labels thinned so they never overlap (>= 48px apart).
 */
export function barsLayout(points: SeriesPoint[], width: number, height: number) {
  const axisW = 44;
  const labelH = 18;
  const plotW = Math.max(40, width - axisW);
  const plotH = height - labelH - 6;
  const base = 6 + plotH;
  const fit = Math.max(4, Math.floor(plotW / 22));
  const pts = points.slice(-Math.min(fit, 31));
  const max = Math.max(1, ...pts.map((x) => Math.max(x.income, x.expense)));
  const slot = plotW / Math.max(1, pts.length);
  const bw = Math.max(3, Math.min(14, slot / 2.8));
  const every = Math.max(1, Math.ceil(pts.length / Math.max(1, Math.floor(plotW / 48))));
  const grid = [0, 0.5, 1].map((g) => ({ y: base - g * plotH, label: { x: axisW - 6, y: base - g * plotH + 4, text: compactMoney(max * g), anchor: 'end' as const } }));
  const bars: BarRect[] = [];
  const labels: AxisText[] = [];
  pts.forEach((pt, i) => {
    const x = axisW + slot * i + slot / 2;
    const hi = (pt.income / max) * plotH;
    const he = (pt.expense / max) * plotH;
    if (hi > 0) bars.push({ kind: 'income', x: x - bw - 1, y: base - Math.max(hi, 2), w: bw, h: Math.max(hi, 2) });
    if (he > 0) bars.push({ kind: 'expense', x: x + 1, y: base - Math.max(he, 2), w: bw, h: Math.max(he, 2) });
    if (i % every === 0) labels.push({ x, y: height - 4, text: axisLabel(pt), anchor: 'middle' });
  });
  return { axisW, grid, bars, labels, count: pts.length };
}

/** Grouped income/expense bars for one currency, drawn to the given (measured) width. */
export function Bars({ points, width, height = 180 }: { points: SeriesPoint[]; width: number; height?: number }) {
  const p = usePalette();
  const g = barsLayout(points, width, height);
  if (g.count === 0) return <View style={{ height }} />;
  const text = (t: AxisText, key: string) => (
    <SvgText key={key} x={t.x} y={t.y} fontSize={10} fontFamily={AXIS_FONT} fill={p.textSecondary} textAnchor={t.anchor}>{t.text}</SvgText>
  );
  return (
    <Svg width={width} height={height}>
      {g.grid.map((l, i) => (
        <G key={`g${i}`}>
          <SvgLine x1={g.axisW} x2={width} y1={l.y} y2={l.y} stroke={p.glassBorder} strokeWidth={1} />
          {text(l.label, `gl${i}`)}
        </G>
      ))}
      {g.bars.map((b, i) => (
        <Rect key={`b${i}`} x={b.x} y={b.y} width={b.w} height={b.h} rx={Math.min(3, b.w / 2)} fill={b.kind === 'income' ? Ink.income : Ink.expense} />
      ))}
      {g.labels.map((l, i) => text(l, `x${i}`))}
    </Svg>
  );
}
/** Legend row used next to charts. */
export function LegendDot({ color, label }: { color: string; label: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <Text style={[type.caption, { color: p.textSecondary }]}>{label}</Text>
    </View>
  );
}
