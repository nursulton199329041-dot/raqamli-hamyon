import type { I18nKey } from '@/i18n';

/** The four main destinations, in tab-bar / sidebar order. */
export const MAIN_TABS: readonly { name: string; icon: string; key: I18nKey }[] = [
  { name: 'index', icon: 'wallet', key: 'home' },
  { name: 'history', icon: 'history', key: 'history' },
  { name: 'analytics', icon: 'chart', key: 'reports' },
  { name: 'settings', icon: 'settings', key: 'settings' },
];

/** Still routable (opened from Settings) but not in the main navigation; their data and APIs are unchanged. */
export const SECONDARY_ROUTES = ['projects', 'debts'] as const;
