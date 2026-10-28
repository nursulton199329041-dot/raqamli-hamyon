import { Text, View } from 'react-native';
import { Button, Chip, Label, Segmented, Wrap } from '@/design/Controls';
import { GlassCard, Tap } from '@/design/Glass';
import { CircleBadge, Glyph } from '@/design/Icon';
import { useLook } from '@/design/look';
import { Ink, usePalette, useT } from '@/design/theme';
import { space, type } from '@/design/tokens';
import type { I18nKey } from '@/i18n';
import { DEFAULT_APPEARANCE, EXPENSE_ROWS, useSettings, type ExpenseRows, type HomeSection, type IconShape, type Size3, type UiStyle } from '@/state/settings';

const STYLE_KEY: Record<UiStyle, I18nKey> = {
  liquid: 'st_liquid', super: 'st_super', office: 'st_office', minimal: 'st_minimal', colorful: 'st_colorful',
};
const SECTION_KEY: Record<HomeSection, I18nKey> = { income: 'income_sources', wallets: 'wallets', expense: 'expense_categories' };
const SECTION_ICON: Record<HomeSection, string> = { income: 'salary', wallets: 'wallet', expense: 'food' };
const ACCENTS = ['#4D8DFF', '#7C6CFF', '#1FCB8B', '#F5A524', '#FF6B6B', '#EC4899', '#14B8A6'];

/**
 * Appearance studio: theme, style preset, icon shape / size, accent, font size, corner radius, glass, animations and the
 * order / visibility of the three home sections. Every change is saved at once (settings store -> local storage).
 */
export function AppearanceCard() {
  const t = useT();
  const p = usePalette();
  const look = useLook();
  const a = useSettings((s) => s.appearance);
  const glass = !useSettings((s) => s.reduceEffects);
  const update = useSettings((s) => s.update);
  const setA = useSettings((s) => s.setAppearance);
  const sizes = (v: Size3, on: (x: Size3) => void) => (
    <Segmented<Size3> value={v} onChange={on} options={[{ value: 's', label: t('size_s') }, { value: 'm', label: t('size_m') }, { value: 'l', label: t('size_l') }]} />
  );
  const move = (i: number, d: -1 | 1) => {
    const order = [...a.sectionOrder];
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    void setA({ sectionOrder: order });
  };

  return (
    <GlassCard testID="appearance">
      <Text style={[type.headline, { color: p.text }]}>{t('appearance')}</Text>

      {/* live preview: the three home icons in the current look */}
      <View testID="appearance-preview" style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: space.md }}>
        {(['income', 'wallets', 'expense'] as HomeSection[]).map((s) => (
          <CircleBadge key={s} name={SECTION_ICON[s]} size={look.iconPx}
            color={s === 'income' ? Ink.income : s === 'wallets' ? Ink.transfer : Ink.expense} depth={s === 'wallets'} />
        ))}
      </View>

      <Label>{t('ui_style')}</Label>
      <Wrap>
        {(Object.keys(STYLE_KEY) as UiStyle[]).map((s) => (
          <Chip key={s} label={t(STYLE_KEY[s])} selected={a.uiStyle === s} onPress={() => void setA({ uiStyle: s })} />
        ))}
      </Wrap>

      <Label>{t('icon_shape')}</Label>
      <Segmented<IconShape> value={a.iconShape} onChange={(v) => void setA({ iconShape: v })}
        options={[{ value: 'circle', label: t('shape_circle') }, { value: 'squircle', label: t('shape_squircle') }]} />
      <Label>{t('icon_size')}</Label>
      {sizes(a.iconSize, (v) => void setA({ iconSize: v }))}

      <Label>{t('accent_color')}</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Tap testID="accent-default" label={t('accent_default')} onPress={() => void setA({ accent: null })}
          style={{ height: 36, paddingHorizontal: space.md, borderRadius: 18, justifyContent: 'center', borderWidth: a.accent === null ? 2 : 1, borderColor: a.accent === null ? p.text : p.glassBorder }}>
          <Text style={[type.footnote, { color: p.text }]}>{t('accent_default')}</Text>
        </Tap>
        {ACCENTS.map((c) => (
          <Tap key={c} testID={`accent-${c}`} label={c} onPress={() => void setA({ accent: c })}
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c, borderWidth: a.accent === c ? 3 : 0, borderColor: p.text }}>
            {null}
          </Tap>
        ))}
      </View>

      <Label>{t('font_size')}</Label>
      {sizes(a.fontScale, (v) => void setA({ fontScale: v }))}
      <Label>{t('corner_radius')}</Label>
      {sizes(a.radius, (v) => void setA({ radius: v }))}

      <Label>{t('glass_effect')}</Label>
      <Wrap>
        <Chip label={glass ? t('on') : t('off')} selected={glass} onPress={() => void update({ reduceEffects: glass })} />
      </Wrap>
      <Label>{t('animations')}</Label>
      <Wrap>
        <Chip label={a.animations ? t('on') : t('off')} selected={a.animations} onPress={() => void setA({ animations: !a.animations })} />
      </Wrap>

      <Label>{t('home_sections')}</Label>
      <View testID="section-order" style={{ gap: space.xs }}>
        {a.sectionOrder.map((s, i) => {
          const shown = !a.hiddenSections.includes(s);
          return (
            <View key={s} testID={`order-${s}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 }}>
              <Text style={[type.callout, { width: 18, color: p.textSecondary }]}>{i + 1}</Text>
              <Text numberOfLines={1} style={[type.callout, { flex: 1, color: shown ? p.text : p.textSecondary }]}>{t(SECTION_KEY[s])}</Text>
              <Tap testID={`up-${s}`} label={t('move_up')} disabled={i === 0} onPress={() => move(i, -1)} style={arrowBtn(p, i === 0)}>
                <View style={{ transform: [{ rotate: '180deg' }] }}><Glyph name="chevronDown" color={p.text} size={16} /></View>
              </Tap>
              <Tap testID={`down-${s}`} label={t('move_down')} disabled={i === a.sectionOrder.length - 1} onPress={() => move(i, 1)}
                style={arrowBtn(p, i === a.sectionOrder.length - 1)}>
                <Glyph name="chevronDown" color={p.text} size={16} />
              </Tap>
              <Chip label={shown ? t('shown') : t('hidden')} selected={shown}
                onPress={() => void setA({ hiddenSections: shown ? [...a.hiddenSections, s] : a.hiddenSections.filter((x) => x !== s) })} />
            </View>
          );
        })}
      </View>
      <Label>{t('expense_rows')}</Label>
      <Segmented<string> value={String(a.expenseRows)}
        onChange={(v) => void setA({ expenseRows: v === 'auto' ? 'auto' : (Number(v) as ExpenseRows) })}
        options={EXPENSE_ROWS.map((r) => ({ value: String(r), label: r === 'auto' ? t('rows_auto') : String(r) }))} />
      <Button testID="appearance-reset" title={t('reset_appearance')} variant="tonal"
        onPress={() => { void setA(DEFAULT_APPEARANCE); void update({ reduceEffects: false }); }} />
    </GlassCard>
  );
}

const arrowBtn = (p: ReturnType<typeof usePalette>, disabled: boolean) => ({
  width: 36, height: 36, borderRadius: 18, alignItems: 'center' as const, justifyContent: 'center' as const,
  backgroundColor: p.glassFill, borderWidth: 1, borderColor: p.glassBorder, opacity: disabled ? 0.35 : 1,
});
