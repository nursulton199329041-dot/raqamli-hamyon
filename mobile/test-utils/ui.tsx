import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { DragProvider } from '@/dnd/DragDrop';
import { queryClient } from '@/state/runtime';

/** Mounts the given screens inside the same providers the app root uses. */
export async function renderApp(children: ReactNode) {
  return render(
    <QueryClientProvider client={queryClient}>
      <DragProvider>{children}</DragProvider>
    </QueryClientProvider>,
  );
}

const KEY: Record<string, string> = { '+': '+', '-': '-', '−': '-', '×': '*', '*': '*', '÷': '/', '/': '/', ',': '.', '.': '.', '=': '=', C: 'C', '<': 'DEL' };

/** Presses the on-screen money keypad like a finger: typeKeys('150000+25000='). */
export async function typeKeys(keys: string) {
  for (const ch of keys.replace(/ /g, '')) {
    await fireEvent.press(screen.getByTestId(`key:${KEY[ch] ?? ch}`));
  }
}

export const amountText = () => String((screen.getByTestId('amount-display').props.children as unknown[]).flat().join(''));

/** Text of the shown amount without the currency suffix, e.g. "150 000". */
export function shownAmount(): string {
  const raw = screen.getByTestId('amount-display').props.children as unknown;
  const first = Array.isArray(raw) ? raw[0] : raw;
  return String(first).replace(/\s/g, ' ');
}

export const endpoint = (testID: string) => within(screen.getByTestId(testID));

export async function save() {
  await act(async () => { await fireEvent.press(screen.getByTestId('save-button')); });
}
/** Flattens a rendered Text's children (strings, numbers, nested <Text>) the way a user reads it; money NBSPs become spaces. */
function flat(c: unknown): string {
  if (c === null || c === undefined || typeof c === 'boolean') return '';
  if (typeof c === 'string' || typeof c === 'number') return String(c);
  if (Array.isArray(c)) return c.map(flat).join('');
  if (typeof c === 'object' && 'props' in c) return flat((c as { props: { children?: unknown } }).props.children);
  return '';
}

export const textOf = (testID: string): string => flat(screen.getByTestId(testID).props.children).replace(/\s/g, ' ');

export const footerHas = (text: string) => within(screen.getByTestId('sheet-footer')).findByText(text);
