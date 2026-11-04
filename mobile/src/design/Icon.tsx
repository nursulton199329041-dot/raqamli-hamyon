import { LinearGradient } from 'expo-linear-gradient';
import { Platform, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useLook } from './look';

/**
 * Own icon vocabulary: 24x24 stroke glyphs drawn with react-native-svg, rendered identically on iOS/Android/Web.
 * The backend stores just the key.
 */
type GlyphFn = (c: string) => React.ReactNode;

const stroke = (c: string) => ({ stroke: c, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' });

const GLYPHS: Record<string, GlyphFn> = {
  wallet: (c) => (<><Path {...stroke(c)} d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a2 2 0 0 1 2 2v1.5" /><Rect {...stroke(c)} x="3" y="8" width="18" height="12" rx="3" /><Circle cx="16.5" cy="14" r="1.2" fill={c} /></>),
  card: (c) => (<><Rect {...stroke(c)} x="3" y="5.5" width="18" height="13" rx="3" /><Path {...stroke(c)} d="M3 10h18M7 15h4" /></>),
  cash: (c) => (<><Rect {...stroke(c)} x="3" y="6.5" width="18" height="11" rx="2.5" /><Circle {...stroke(c)} cx="12" cy="12" r="2.6" /><Path {...stroke(c)} d="M6.5 9.5v.01M17.5 14.5v.01" /></>),
  car: (c) => (<><Path {...stroke(c)} d="M5 16v-4l2-5h10l2 5v4M5 16h14M5 16v2.5M19 16v2.5M3.5 12h17" /><Circle cx="8" cy="14" r="1" fill={c} /><Circle cx="16" cy="14" r="1" fill={c} /></>),
  home: (c) => (<Path {...stroke(c)} d="M4 11l8-6.5L20 11v8a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" />),
  utilities: (c) => (<Path {...stroke(c)} d="M13 3L5.5 13.5H11L10 21l7.5-10.5H12z" />),
  transport: (c) => (<><Rect {...stroke(c)} x="5" y="4" width="14" height="13" rx="3" /><Path {...stroke(c)} d="M5 11h14M8 20l1.5-3M16 20l-1.5-3" /><Circle cx="9" cy="14" r="1" fill={c} /><Circle cx="15" cy="14" r="1" fill={c} /></>),
  food: (c) => (<Path {...stroke(c)} d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1.5-3 4-3 7v3h3" />),
  salary: (c) => (<><Rect {...stroke(c)} x="3.5" y="7.5" width="17" height="12" rx="2.5" /><Path {...stroke(c)} d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 13h17" /></>),
  business: (c) => (<><Path {...stroke(c)} d="M4 9l1.5-4.5h13L20 9M4 9v10.5h16V9M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9" /><Path {...stroke(c)} d="M10 19.5v-5h4v5" /></>),
  project: (c) => (<><Path {...stroke(c)} d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /><Path {...stroke(c)} d="M12 11l.9 1.9 2.1.3-1.5 1.5.4 2.1-1.9-1-1.9 1 .4-2.1L9 13.2l2.1-.3z" /></>),
  folder: (c) => (<Path {...stroke(c)} d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />),
  equipment: (c) => (<><Rect {...stroke(c)} x="3.5" y="5" width="17" height="11" rx="2" /><Path {...stroke(c)} d="M9 20h6M12 16v4" /></>),
  phone: (c) => (<><Rect {...stroke(c)} x="7" y="3" width="10" height="18" rx="2.5" /><Path {...stroke(c)} d="M11 18h2" /></>),
  debt: (c) => (<Path {...stroke(c)} d="M5 9h13l-3.5-3.5M19 15H6l3.5 3.5" />),
  investment: (c) => (<Path {...stroke(c)} d="M3.5 17l5.5-5.5 3.5 3.5 7-7M15 8h5v5" />),
  savings: (c) => (<><Path {...stroke(c)} d="M5 12.5a7 5.5 0 0 1 7-5.5c4 0 7 2.4 7 5.5 0 1.7-.9 3.2-2.3 4.2V19h-3v-1.2c-.6.1-1.1.2-1.7.2s-1.1-.1-1.7-.2V19h-3v-2.3C5.9 15.7 5 14.2 5 12.5z" /><Circle cx="15" cy="11" r="0.9" fill={c} /></>),
  staff: (c) => (<><Circle {...stroke(c)} cx="9" cy="8.5" r="3" /><Path {...stroke(c)} d="M3.5 19a5.5 5.5 0 0 1 11 0M15.5 6.2a3 3 0 0 1 0 5.6M17.5 14a5.5 5.5 0 0 1 3 5" /></>),
  repair: (c) => (<Path {...stroke(c)} d="M14.5 6.5a4 4 0 0 0 4.8 4.8L10 20.5a2.1 2.1 0 0 1-3-3l9.2-9.3a4 4 0 0 0-1.7-1.7z" />),
  fun: (c) => (<><Path {...stroke(c)} d="M4.5 19.5L8 9l7 7z" /><Path {...stroke(c)} d="M13 5v.01M18.5 9v.01M17 3.5v.01M19.5 14v.01M12 9.5l1.5-1.5" /></>),
  briefcase: (c) => (<><Rect {...stroke(c)} x="3.5" y="7.5" width="17" height="12" rx="2.5" /><Path {...stroke(c)} d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5" /></>),
  tag: (c) => (<><Path {...stroke(c)} d="M3.5 12.2V5a1.5 1.5 0 0 1 1.5-1.5h7.2a1.5 1.5 0 0 1 1 .44l7.3 7.3a1.5 1.5 0 0 1 0 2.1l-7 7a1.5 1.5 0 0 1-2.1 0l-7.3-7.3a1.5 1.5 0 0 1-.6-1.04z" /><Circle cx="8" cy="8" r="1.2" fill={c} /></>),
  other: (c) => (<><Rect {...stroke(c)} x="4" y="4" width="7" height="7" rx="2" /><Rect {...stroke(c)} x="13" y="4" width="7" height="7" rx="2" /><Rect {...stroke(c)} x="4" y="13" width="7" height="7" rx="2" /><Rect {...stroke(c)} x="13" y="13" width="7" height="7" rx="2" /></>),
  // UI glyphs
  plus: (c) => (<Path {...stroke(c)} d="M12 5v14M5 12h14" />),
  settings: (c) => (<><Path {...stroke(c)} strokeWidth={2} d="M10.08 4.85L10.52 2.11L13.48 2.11L13.92 4.85L15.70 5.59L17.95 3.96L20.04 6.05L18.41 8.30L19.15 10.08L21.89 10.52L21.89 13.48L19.15 13.92L18.41 15.70L20.04 17.95L17.95 20.04L15.70 18.41L13.92 19.15L13.48 21.89L10.52 21.89L10.08 19.15L8.30 18.41L6.05 20.04L3.96 17.95L5.59 15.70L4.85 13.92L2.11 13.48L2.11 10.52L4.85 10.08L5.59 8.30L3.96 6.05L6.05 3.96L8.30 5.59z" /><Circle {...stroke(c)} strokeWidth={2} cx="12" cy="12" r="3" /></>),
  history: (c) => (<><Path {...stroke(c)} d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z" /><Path {...stroke(c)} d="M9 8h6M9 12h6" /></>),
  chart: (c) => (<><Path {...stroke(c)} d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z" /><Path {...stroke(c)} d="M15 3.8A8.5 8.5 0 0 1 20.2 9H15z" /></>),
  arrowIn: (c) => (<Path {...stroke(c)} d="M17 7L7 17M7 8v9h9" />),
  arrowOut: (c) => (<Path {...stroke(c)} d="M7 17L17 7M8 7h9v9" />),
  swap: (c) => (<Path {...stroke(c)} d="M5 9h13l-3.5-3.5M19 15H6l3.5 3.5" />),
  handshake: (c) => (<Path {...stroke(c)} d="M3 11l4-3 4 1.5 2.5-1.5 4 .5 3.5 2M3 11l3 6 3 1.5 2.5-1.5M21 11l-3 6-3.5 1.5-3-2" />),
  check: (c) => (<Path {...stroke(c)} d="M5 12.5l4.5 4.5L19 7.5" />),
  close: (c) => (<Path {...stroke(c)} d="M6 6l12 12M18 6L6 18" />),
  clock: (c) => (<><Circle {...stroke(c)} cx="12" cy="12" r="8.5" /><Path {...stroke(c)} d="M12 7.5V12l3 2" /></>),
  share: (c) => (<Path {...stroke(c)} d="M12 4v11M8 8l4-4 4 4M5 13v6h14v-6" />),
  undo: (c) => (<Path {...stroke(c)} d="M9 7L4.5 11.5 9 16M5 11.5h9a5 5 0 0 1 0 10h-1" />),
  search: (c) => (<><Circle {...stroke(c)} cx="11" cy="11" r="6.5" /><Path {...stroke(c)} d="M16 16l4 4" /></>),
  refresh: (c) => (<Path {...stroke(c)} d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5V9H15" />),
  backspace: (c) => (<><Path {...stroke(c)} d="M9 5h10a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 19 19H9l-5.5-7z" /><Path {...stroke(c)} d="M12.5 9.5l5 5M17.5 9.5l-5 5" /></>),
  trash: (c) => (<Path {...stroke(c)} d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.2A1.5 1.5 0 0 0 8.8 20.6h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7M10 11v6M14 11v6" />),
  chevronDown: (c) => (<Path {...stroke(c)} d="M6 9.5l6 6 6-6" />),
  chevronLeft: (c) => (<Path {...stroke(c)} d="M14.5 5.5L8 12l6.5 6.5" />),
  chevronRight: (c) => (<Path {...stroke(c)} d="M9.5 5.5L16 12l-6.5 6.5" />),
  filter: (c) => (<Path {...stroke(c)} d="M4 5.5h16l-6 7.2v5.3l-4 2v-7.3z" />),
  calendar: (c) => (<><Rect {...stroke(c)} x="4" y="5.5" width="16" height="14" rx="2.5" /><Path {...stroke(c)} d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>),
  grid: (c) => (<><Circle cx="6" cy="6" r="1.7" fill={c} /><Circle cx="12" cy="6" r="1.7" fill={c} /><Circle cx="18" cy="6" r="1.7" fill={c} /><Circle cx="6" cy="12" r="1.7" fill={c} /><Circle cx="12" cy="12" r="1.7" fill={c} /><Circle cx="18" cy="12" r="1.7" fill={c} /><Circle cx="6" cy="18" r="1.7" fill={c} /><Circle cx="12" cy="18" r="1.7" fill={c} /><Circle cx="18" cy="18" r="1.7" fill={c} /></>),
  forward: (c) => (<Path {...stroke(c)} d="M6 6.5l5.5 5.5L6 17.5M12.5 6.5l5.5 5.5-5.5 5.5" />),
  user: (c) => (<><Circle {...stroke(c)} cx="12" cy="8.5" r="3.6" /><Path {...stroke(c)} d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>),
  edit: (c) => (<Path {...stroke(c)} d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 0l.5.5a2.1 2.1 0 0 1 0 3L8.5 19 4 20zM14.5 6l3.5 3.5" />),
  sync: (c) => (<><Path {...stroke(c)} strokeWidth={2.2} d="M4.2 12a7.8 7.8 0 0 1 12.6-6.15M19.8 12a7.8 7.8 0 0 1-12.6 6.15" /><Path fill={c} d="M20.3 3.2v6.6h-6.6zM3.7 20.8v-6.6h6.6z" /></>),
  more: (c) => (<><Circle cx="5.5" cy="12" r="1.7" fill={c} /><Circle cx="12" cy="12" r="1.7" fill={c} /><Circle cx="18.5" cy="12" r="1.7" fill={c} /></>),
};

const UI_GLYPHS = ['plus', 'settings', 'history', 'chart', 'arrowIn', 'arrowOut', 'swap', 'handshake', 'check', 'close', 'clock', 'share', 'undo', 'search', 'refresh',
  'backspace', 'trash', 'chevronDown', 'chevronLeft', 'chevronRight', 'filter', 'calendar', 'grid', 'forward', 'user', 'sync', 'more', 'edit'];
export const ICON_KEYS = Object.keys(GLYPHS).filter((k) => !UI_GLYPHS.includes(k));

/** Decorative: hidden from screen readers. react-native-svg forwards unknown props to the DOM on web, so web gets aria-hidden. */
const HIDDEN = Platform.OS === 'web'
  ? { 'aria-hidden': true }
  : { accessibilityElementsHidden: true, importantForAccessibility: 'no' as const };

export function Glyph({ name, color = '#fff', size = 24 }: { name: string; color?: string; size?: number }) {
  const g = GLYPHS[name] ?? GLYPHS.other!;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...HIDDEN}>
      {g(color)}
    </Svg>
  );
}

/**
 * Round glass-lit badge used by dashboard tiles and the operation sheet endpoints.
 * The coloured glow sits on an outer, unclipped view (an `overflow: hidden` view cannot cast a shadow on iOS);
 * Android gets no elevation here — dozens of elevated tiles cost overdraw and draw grey, not coloured, shadows.
 */
export function CircleBadge({ name, color = '#6EA8FF', size = 52, ring, depth }: {
  name: string; color?: string; size?: number; ring?: string;
  /** wallets: a soft bottom shade + stronger drop shadow so the coin reads as a physical object */
  depth?: boolean;
}) {
  const look = useLook();
  const r = look.iconShape === 'squircle' ? size * 0.3 : size / 2;
  const fill: [string, string] = look.badge === 'flat' ? [color, color]
    : look.badge === 'vivid' ? [lighten(color, 0.28), shade(color, 0.12)]
      : [lighten(color, 0.16), color];
  return (
    <View
      style={{
        width: size, height: size, borderRadius: r,
        shadowColor: color, shadowOpacity: look.badge === 'flat' ? 0 : depth ? 0.55 : 0.4,
        shadowRadius: depth ? 12 : 9, shadowOffset: { width: 0, height: depth ? 6 : 4 },
      }}
    >
      <View style={{ flex: 1, borderRadius: r, overflow: 'hidden', borderWidth: ring ? 2 : 1, borderColor: ring ?? 'rgba(255,255,255,0.32)' }}>
        <LinearGradient colors={fill} start={{ x: 0.15, y: 0 }} end={{ x: 0.85, y: 1 }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Glyph name={name} size={size * 0.48} />
        </LinearGradient>
        {look.badge !== 'flat' ? (
          // specular highlight: the "liquid" top edge
          <LinearGradient pointerEvents="none" colors={['rgba(255,255,255,0.40)', 'rgba(255,255,255,0)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.55 }}
            style={{ position: 'absolute', left: 0, right: 0, top: 0, height: size * 0.55 }} />
        ) : null}
        {depth ? (
          <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.22)']} start={{ x: 0.5, y: 0.5 }} end={{ x: 0.5, y: 1 }}
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: size * 0.5 }} />
        ) : null}
      </View>
    </View>
  );
}

/** Mix a #RRGGBB colour towards white (amount 0..1). */
function lighten(hex: string, amount: number) {
  return mix(hex, 255, amount);
}

/** Mix a #RRGGBB colour towards black (amount 0..1). */
function shade(hex: string, amount: number) {
  return mix(hex, 0, amount);
}

function mix(hex: string, to: number, amount: number) {
  const m = /^#([0-9a-f]{6})/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) + (to - ((n >> shift) & 255)) * amount);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

/** Unified icon badge: tinted squircle with soft gradient and inner highlight. */
export function IconBadge({ name, color = '#6EA8FF', size = 44 }: { name: string; color?: string; size?: number }) {
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size * 0.34, overflow: 'hidden',
        borderWidth: 0.8, borderColor: 'rgba(255,255,255,0.35)',
        shadowColor: color, shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4,
      }}
    >
      <LinearGradient colors={[color, `${color}8C`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Glyph name={name} size={size * 0.52} />
      </LinearGradient>
    </View>
  );
}
