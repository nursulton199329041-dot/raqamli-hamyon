import { useState, type ReactNode } from 'react';
import { Platform, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Defs, G, Line as SvgLine, LinearGradient as SvgGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { compactMoney } from '@/lib/money';
import { Ink, usePalette } from './theme';
import { radii, space, type } from './tokens';

/** SVG <text> does not inherit the app font: on web it would fall back to the browser's serif default. */
const AXIS_FONT = Platform.OS === 'web' ? 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' : undefined;

export const SLICE_COLORS = ['#4D8DFF', '#FF6B6B', '#1FCB8B', '#F5A524', '#7C6CFF', '#14B8A6', '#EC4899', '#94A3B8'];

/** Left value-axis width and bottom label band shared by every cartesian chart. */
const AXIS_W = 48;
const LABEL_H = 18;
const TOP = 8;

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
    <View testID={testID} onLayout={onLayout} style={{ width: '100%', height }}>
      {w > 0 ? children(w) : null}
    </View>
  );
}

// ------------------------------------------------------------------------------------------------ scales

/**
 * "Nice" axis: bounds and ticks on 1 / 2 / 2.5 / 5 × 10^n so labels read 0, 2 mln, 4 mln — never 3 333 333.
 * Handles negative ranges (a negative balance or net flow) and the all-zero case.
 */
export function niceScale(min: number, max: number, count = 4): { lo: number; hi: number; ticks: number[] } {
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (lo === hi) {
    if (lo === 0) return { lo: 0, hi: 1, ticks: [0, 1] };
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  const raw = (hi - lo) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const nlo = Math.floor(lo / step) * step;
  const nhi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = nlo; v <= nhi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : +v.toPrecision(12));
  return { lo: nlo, hi: nhi, ticks };
}

/** Indices of x labels to draw so neighbours stay >= `minGap` px apart (the last point is always labelled). */
export function labelIndices(n: number, slot: number, minGap = 44): number[] {
  if (n <= 0) return [];
  const every = Math.max(1, Math.ceil(minGap / Math.max(1, slot)));
  const out: number[] = [];
  for (let i = 0; i < n; i += every) out.push(i);
  const last = n - 1;
  if (out[out.length - 1] !== last) {
    if ((last - (out[out.length - 1] ?? 0)) * slot < minGap) out.pop();
    out.push(last);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ layouts (pure)

export interface BarRect { x: number; y: number; w: number; h: number; kind: 'income' | 'expense' | 'positive' | 'negative'; index: number }
export interface AxisText { x: number; y: number; text: string; anchor: 'start' | 'middle' | 'end' }
export interface Gridline { y: number; label: AxisText; zero: boolean }
export interface Pair { label: string; income: number; expense: number }

/**
 * Grouped income/expense bars drawn to the given pixel size. Every period is shown (a 31-day month fits a 320px phone:
 * slots shrink to 5px, bars to 2px); the tooltip carries the exact figures.
 */
export function barsLayout(points: Pair[], width: number, height: number) {
  const plotW = Math.max(40, width - AXIS_W);
  const plotH = height - LABEL_H - TOP;
  const pts = points.slice(-Math.max(4, Math.floor(plotW / 5)));
  const s = niceScale(0, Math.max(0, ...pts.map((x) => Math.max(x.income, x.expense))));
  const y = (v: number) => TOP + plotH - ((v - s.lo) / (s.hi - s.lo)) * plotH;
  const slot = plotW / Math.max(1, pts.length);
  const bw = Math.max(2, Math.min(14, (slot - 1) / 2.2));
  const centers = pts.map((_, i) => AXIS_W + slot * i + slot / 2);
  const base = y(0);
  const bars: BarRect[] = [];
  pts.forEach((pt, i) => {
    const x = centers[i]!;
    if (pt.income > 0) bars.push({ kind: 'income', index: i, x: x - bw - 0.5, y: Math.min(y(pt.income), base - 2), w: bw, h: Math.max(2, base - y(pt.income)) });
    if (pt.expense > 0) bars.push({ kind: 'expense', index: i, x: x + 0.5, y: Math.min(y(pt.expense), base - 2), w: bw, h: Math.max(2, base - y(pt.expense)) });
  });
  return { grid: grid(s, y), bars, centers, labels: xLabels(pts.map((p) => p.label), centers, slot, height), count: pts.length, slot, offset: points.length - pts.length };
}

/** Single signed series (net flow): green above zero, red below; the zero line is always drawn. */
export function signedLayout(points: { label: string; value: number }[], width: number, height: number) {
  const plotW = Math.max(40, width - AXIS_W);
  const plotH = height - LABEL_H - TOP;
  const pts = points.slice(-Math.max(4, Math.floor(plotW / 5)));
  const vals = pts.map((p) => p.value);
  const s = niceScale(Math.min(0, ...vals), Math.max(0, ...vals));
  const y = (v: number) => TOP + plotH - ((v - s.lo) / (s.hi - s.lo)) * plotH;
  const slot = plotW / Math.max(1, pts.length);
  const bw = Math.max(2, Math.min(18, slot * 0.6));
  const centers = pts.map((_, i) => AXIS_W + slot * i + slot / 2);
  const bars: BarRect[] = pts.flatMap((p, i) => {
    if (p.value === 0) return [];
    const top = Math.min(y(p.value), y(0));
    return [{ kind: p.value > 0 ? 'positive' as const : 'negative' as const, index: i, x: centers[i]! - bw / 2, y: top, w: bw, h: Math.max(2, Math.abs(y(p.value) - y(0))) }];
  });
  return { grid: grid(s, y), bars, centers, labels: xLabels(pts.map((p) => p.label), centers, slot, height), count: pts.length, slot, offset: points.length - pts.length };
}

/** Line through every point; the value range hugs the data (zero is included only when it is crossed or close). */
export function lineLayout(points: { label: string; value: number }[], width: number, height: number) {
  const plotW = Math.max(40, width - AXIS_W - 8);
  const plotH = height - LABEL_H - TOP;
  const vals = points.map((p) => p.value);
  const mn = vals.length ? Math.min(...vals) : 0;
  const mx = vals.length ? Math.max(...vals) : 0;
  const includeZero = mn <= 0 || mn < mx * 0.35;
  const s = niceScale(includeZero ? Math.min(0, mn) : mn, includeZero ? Math.max(0, mx) : mx);
  const y = (v: number) => TOP + plotH - ((v - s.lo) / (s.hi - s.lo)) * plotH;
  const step = points.length > 1 ? plotW / (points.length - 1) : 0;
  const centers = points.map((_, i) => AXIS_W + 4 + (points.length > 1 ? step * i : plotW / 2));
  const xy = points.map((p, i) => ({ x: centers[i]!, y: y(p.value) }));
  const d = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const base = y(Math.max(s.lo, Math.min(0, s.hi)));
  const last = xy[xy.length - 1];
  const first = xy[0];
  const area = last && first && xy.length > 1 ? `${d} L${last.x.toFixed(1)},${base.toFixed(1)} L${first.x.toFixed(1)},${base.toFixed(1)} Z` : '';
  return { grid: grid(s, y), d, area, xy, centers, labels: xLabels(points.map((p) => p.label), centers, Math.max(step, 1), height), count: points.length, slot: Math.max(step, 1) };
}

function grid(s: { ticks: number[] }, y: (v: number) => number): Gridline[] {
  return s.ticks.map((v) => ({ y: y(v), zero: v === 0, label: { x: AXIS_W - 6, y: y(v) + 3.5, text: compactMoney(v), anchor: 'end' } }));
}

function xLabels(labels: string[], centers: number[], slot: number, height: number): AxisText[] {
  // never past the plot: bars end at the last slot's edge, a line ends 4px after its last point
  const right = (centers[centers.length - 1] ?? 0) + Math.min(slot / 2, 4);
  return labelIndices(labels.length, slot).map((i) => {
    const x = centers[i]!;
    // the last label ends at the plot's right edge instead of being centred past it ("31 o…" was cut off)
    const end = i === labels.length - 1 && labels.length > 1 && right - x < 24;
    return { x: end ? right : x, y: height - 4, text: labels[i] ?? '', anchor: end ? 'end' as const : 'middle' as const };
  });
}

/** Index of the data point nearest to x (tooltip hit-testing). */
export function nearestIndex(centers: number[], x: number): number {
  let best = -1;
  let dist = Infinity;
  centers.forEach((c, i) => {
    const d = Math.abs(c - x);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return best;
}

// ------------------------------------------------------------------------------------------------ interaction

export interface Tip { title: string; lines: { label: string; value: string; color: string }[] }

/**
 * Transparent touch layer over a chart: press / drag selects the nearest point, a second tap on it closes the tooltip.
 * It is the responder only while touched and yields on request, so a vertical drag still scrolls the page.
 */
function TouchLayer({ centers, selected, onSelect, testID }: {
  centers: number[]; selected: number | null; onSelect(i: number | null): void; testID?: string;
}) {
  const pick = (e: GestureResponderEvent) => nearestIndex(centers, e.nativeEvent.locationX);
  return (
    <View
      testID={testID}
      style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => true}
      onResponderGrant={(e) => {
        const i = pick(e);
        onSelect(i === selected ? null : i);
      }}
      onResponderMove={(e) => onSelect(pick(e))}
    />
  );
}

/** Tooltip card next to the selected point, kept inside the chart. */
function Tooltip({ x, width, tip }: { x: number; width: number; tip: Tip }) {
  const p = usePalette();
  const w = Math.min(196, width - 8);
  const left = Math.max(4, Math.min(width - w - 4, x - w / 2));
  return (
    <View pointerEvents="none" testID="chart-tooltip" style={{
      position: 'absolute', top: 0, left, width: w, padding: space.sm, borderRadius: radii.sm,
      backgroundColor: p.dark ? 'rgba(10,16,36,0.96)' : 'rgba(255,255,255,0.98)', borderWidth: 1, borderColor: p.glassBorder, gap: 2,
    }}>
      <Text numberOfLines={1} style={[type.caption, { color: p.textSecondary }]}>{tip.title}</Text>
      {tip.lines.map((l) => (
        <View key={l.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: l.color }} />
          <Text numberOfLines={1} style={[type.caption, { flex: 1, color: p.textSecondary }]}>{l.label}</Text>
          <Text numberOfLines={1} style={[type.caption, { color: p.text, fontWeight: '800' }]}>{l.value}</Text>
        </View>
      ))}
    </View>
  );
}

function AxisLayer({ lines, labels, width, ink, line }: { lines: Gridline[]; labels: AxisText[]; width: number; ink: string; line: string }) {
  return (
    <>
      {lines.map((g, i) => (
        <G key={`g${i}`}>
          <SvgLine x1={AXIS_W} x2={width} y1={g.y} y2={g.y} stroke={line} strokeWidth={g.zero ? 1.4 : 1} strokeDasharray={g.zero ? undefined : '3 4'} />
          <SvgText x={g.label.x} y={g.label.y} fontSize={10} fontFamily={AXIS_FONT} fill={ink} textAnchor="end">{g.label.text}</SvgText>
        </G>
      ))}
      {labels.map((l, i) => (
        <SvgText key={`x${i}`} x={l.x} y={l.y} fontSize={10} fontFamily={AXIS_FONT} fill={ink} textAnchor={l.anchor}>{l.text}</SvgText>
      ))}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ charts

/** Grouped income/expense bars with tooltip. `tip(i)` describes the i-th point (index into `points`). */
export function Bars({ points, width, height = 200, tip, testID }: {
  points: Pair[]; width: number; height?: number; tip?(i: number): Tip; testID?: string;
}) {
  const p = usePalette();
  const [sel, setSel] = useState<number | null>(null);
  const g = barsLayout(points, width, height);
  if (g.count === 0) return <View style={{ height }} />;
  const c = sel !== null ? g.centers[sel] : undefined;
  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        <AxisLayer lines={g.grid} labels={g.labels} width={width} ink={p.textSecondary} line={p.glassBorder} />
        {c !== undefined && <Rect x={c - g.slot / 2} y={TOP} width={g.slot} height={height - LABEL_H - TOP} fill={`${p.accent}1F`} />}
        {g.bars.map((b, i) => (
          <Rect key={`b${i}`} x={b.x} y={b.y} width={b.w} height={b.h} rx={Math.min(3, b.w / 2)}
            fill={b.kind === 'income' ? Ink.income : Ink.expense} opacity={sel === null || sel === b.index ? 1 : 0.45} />
        ))}
      </Svg>
      {tip ? <TouchLayer testID={testID} centers={g.centers} selected={sel} onSelect={setSel} /> : null}
      {tip && sel !== null && c !== undefined ? <Tooltip x={c} width={width} tip={tip(sel + g.offset)} /> : null}
    </View>
  );
}

/** Signed bars around a zero line (net flow per period). `tone` paints a one-sided series (income only / expenses only). */
export function SignedBars({ points, width, height = 200, tip, testID, tone }: {
  points: { label: string; value: number }[]; width: number; height?: number; tip?(i: number): Tip; testID?: string; tone?: string;
}) {
  const p = usePalette();
  const [sel, setSel] = useState<number | null>(null);
  const g = signedLayout(points, width, height);
  if (g.count === 0) return <View style={{ height }} />;
  const c = sel !== null ? g.centers[sel] : undefined;
  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        <AxisLayer lines={g.grid} labels={g.labels} width={width} ink={p.textSecondary} line={p.glassBorder} />
        {g.bars.map((b, i) => (
          <Rect key={`b${i}`} x={b.x} y={b.y} width={b.w} height={b.h} rx={Math.min(3, b.w / 2)}
            fill={tone ?? (b.kind === 'positive' ? Ink.income : Ink.expense)} opacity={sel === null || sel === b.index ? 1 : 0.45} />
        ))}
      </Svg>
      {tip ? <TouchLayer testID={testID} centers={g.centers} selected={sel} onSelect={setSel} /> : null}
      {tip && sel !== null && c !== undefined ? <Tooltip x={c} width={width} tip={tip(sel + g.offset)} /> : null}
    </View>
  );
}

/** Area line (balance trend). */
export function LineChart({ points, width, height = 200, color, tip, testID }: {
  points: { label: string; value: number }[]; width: number; height?: number; color?: string; tip?(i: number): Tip; testID?: string;
}) {
  const p = usePalette();
  const col = color ?? p.accent;
  const [sel, setSel] = useState<number | null>(null);
  const g = lineLayout(points, width, height);
  const first = g.xy[0];
  if (g.count === 0 || !first) return <View style={{ height }} />;
  const id = `area-${testID ?? 'line'}`;
  const pt = sel !== null ? g.xy[sel] : undefined;
  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        <Defs>
          <SvgGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={col} stopOpacity={0.32} />
            <Stop offset="1" stopColor={col} stopOpacity={0} />
          </SvgGradient>
        </Defs>
        <AxisLayer lines={g.grid} labels={g.labels} width={width} ink={p.textSecondary} line={p.glassBorder} />
        {g.area ? <Path d={g.area} fill={`url(#${id})`} /> : null}
        {g.count > 1 ? <Path d={g.d} stroke={col} strokeWidth={2.4} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          : <Circle cx={first.x} cy={first.y} r={4} fill={col} />}
        {pt ? (
          <G>
            <SvgLine x1={pt.x} x2={pt.x} y1={TOP} y2={height - LABEL_H} stroke={p.textSecondary} strokeWidth={1} strokeDasharray="3 3" />
            <Circle cx={pt.x} cy={pt.y} r={5} fill={col} stroke={p.dark ? '#0B1220' : '#fff'} strokeWidth={2} />
          </G>
        ) : null}
      </Svg>
      {tip ? <TouchLayer testID={testID} centers={g.centers} selected={sel} onSelect={setSel} /> : null}
      {tip && sel !== null && pt ? <Tooltip x={pt.x} width={width} tip={tip(sel)} /> : null}
    </View>
  );
}

// ------------------------------------------------------------------------------------------------ donut

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

export interface Slice { color: string; kind: 'ring' | 'arc'; d?: string; index: number }

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
    if (sweep >= 359.9) slices.push({ color, kind: 'ring', index: i });
    else slices.push({ color, kind: 'arc', d: arcPath(c, r, a0, a0 + sweep - gapDeg), index: i });
  });
  return { c, r, slices };
}

/**
 * Donut whose geometry comes from its `size` (the caller passes the measured container size). Slices are explicit arc
 * paths — no `rotation`/`origin` group transform, which react-native-svg's web renderer emits as an invalid
 * `transform-origin` DOM attribute. `highlight` dims every other slice.
 */
export function Donut({ percents, size = 120, stroke, center, highlight }: {
  percents: number[]; size?: number; stroke?: number; center?: ReactNode; highlight?: number | null;
}) {
  const p = usePalette();
  const sw = stroke ?? Math.max(10, Math.round(size * 0.13));
  const { c, r, slices } = donutSlices(percents, size, sw);
  const op = (i: number) => (highlight == null || highlight === i ? 1 : 0.3);
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={c} cy={c} r={r} stroke={p.dark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)'} strokeWidth={sw} fill="none" />
        {slices.map((s) => (s.kind === 'ring'
          ? <Circle key={s.index} cx={c} cy={c} r={r} stroke={s.color} strokeWidth={sw} fill="none" opacity={op(s.index)} />
          : <Path key={s.index} d={s.d} stroke={s.color} strokeWidth={sw} fill="none" opacity={op(s.index)} />))}
      </Svg>
      {center ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: sw, right: sw, top: sw, bottom: sw, alignItems: 'center', justifyContent: 'center' }}>
          {center}
        </View>
      ) : null}
    </View>
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
