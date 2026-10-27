import { Children, type ReactNode } from 'react';
import { View } from 'react-native';
import { space } from './tokens';

/** Equal-width cards in `columns` columns (1 on phones); rows wrap, gutters come from the spacing scale. */
export function Grid({ columns, children, gap = space.md }: { columns: number; children: ReactNode; gap?: number }) {
  const items = Children.toArray(children);
  if (items.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -gap / 2, rowGap: gap }}>
      {items.map((child, i) => (
        <View key={i} style={{ width: `${100 / Math.max(1, columns)}%`, paddingHorizontal: gap / 2 }}>{child}</View>
      ))}
    </View>
  );
}
