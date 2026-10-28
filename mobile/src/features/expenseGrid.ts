import type { ExpenseRows } from '@/state/settings';

/** Narrowest tile that still holds a readable icon, name and amount. */
export const MIN_TILE = 64;
const MAX_TILE = 120;

export interface GridLayout {
  cols: number;
  rows: number;
  tileW: number;
  iconPx: number;
}

/**
 * Expense categories wrap into rows inside the page (no sideways scrolling).
 * - 'auto': as many columns as fit at the normal tile width; rows grow with the number of categories.
 * - 1 / 2 / 3: tiles are spread over that many rows; when they cannot fit at MIN_TILE, extra rows are added.
 * `count` includes the trailing "+" tile.
 */
export function expenseGrid(count: number, width: number, rows: ExpenseRows, iconPx: number, gap: number): GridLayout {
  const n = Math.max(1, count);
  const w = Math.max(MIN_TILE, width);
  const normal = Math.max(80, iconPx + 30);
  const fit = (tile: number) => Math.max(1, Math.floor((w + gap) / (tile + gap)));
  const cols = rows === 'auto' ? fit(normal) : Math.min(fit(MIN_TILE), Math.ceil(n / rows));
  const stretched = (w - gap * (cols - 1)) / cols;
  const tileW = Math.floor(rows === 'auto' ? stretched : Math.min(MAX_TILE, stretched));
  return { cols, rows: Math.ceil(n / cols), tileW, iconPx: Math.min(iconPx, Math.max(36, tileW - 22)) };
}
