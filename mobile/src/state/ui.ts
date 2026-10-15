import { create } from 'zustand';

export type OpKind = 'income' | 'expense' | 'transfer' | 'debt';

export interface OpPrefill {
  kind: OpKind;
  walletId?: string;
  toWalletId?: string;
  categoryId?: string;
  sourceId?: string;
  projectId?: string;
}

export type FormSheet = 'wallet' | 'category' | 'source' | 'project' | null;

interface UiState {
  op: OpPrefill | null;
  /** bumps each time a form opens so a reopened sheet always starts from a clean state */
  opNonce: number;
  form: FormSheet;
  openOp(p: OpPrefill): void;
  closeOp(): void;
  openForm(f: Exclude<FormSheet, null>): void;
  closeForm(): void;
  /** true while a money form is open: OTA updates must not restart the app now */
  busy(): boolean;
}

export const useUi = create<UiState>((set, get) => ({
  op: null,
  opNonce: 0,
  form: null,
  openOp: (p) => set((s) => ({ op: p, opNonce: s.opNonce + 1 })),
  closeOp: () => set({ op: null }),
  openForm: (f) => set({ form: f }),
  closeForm: () => set({ form: null }),
  busy: () => get().op !== null || get().form !== null,
}));
