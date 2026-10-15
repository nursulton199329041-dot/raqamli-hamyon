import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

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
  settings: (c) => (<><Circle {...stroke(c)} cx="12" cy="12" r="3" /><Path {...stroke(c)} d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" /></>),
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
};

export const ICON_KEYS = Object.keys(GLYPHS).filter((k) => !['plus', 'settings', 'history', 'chart', 'arrowIn', 'arrowOut', 'swap', 'handshake', 'check', 'close', 'clock', 'share', 'undo', 'search', 'refresh'].includes(k));

export function Glyph({ name, color = '#fff', size = 24 }: { name: string; color?: string; size?: number }) {
  const g = GLYPHS[name] ?? GLYPHS.other!;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      {g(color)}
    </Svg>
  );
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
