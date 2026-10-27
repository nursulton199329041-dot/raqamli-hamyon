import { translate, type I18nKey, type Lang } from '@/i18n';

/**
 * Server error codes the user can actually meet -> translated text. The backend answers in English; anything not
 * listed keeps the server's own message (it is still specific and better than a generic "error").
 */
const CODE_KEY: Record<string, I18nKey> = {
  validation: 'e_validation',
  network: 'net_error',
  'auth.email_taken': 'e_email_taken',
  'auth.invalid_credentials': 'e_invalid_credentials',
  'auth.locked': 'e_locked',
  'wallet.insufficient_funds': 'insufficient',
  'wallet.name_required': 'e_wallet_name',
  'transfer.same_wallet': 'same_wallet',
  'transfer.rate_required': 'e_rate_required',
  'fx.rate_invalid': 'e_rate_invalid',
  'debt.overpayment': 'e_overpayment',
  'debt.not_open': 'e_debt_not_open',
  'debt.currency_mismatch': 'e_debt_currency',
  'reverse.already': 'e_reversed_already',
  'reverse.not_allowed': 'e_reverse_not_allowed',
  'category.name_invalid': 'e_name_required',
  'source.name_invalid': 'e_name_required',
  'project.name_invalid': 'e_name_required',
  'person.name_invalid': 'e_name_required',
  'attachment.size': 'e_attachment_size',
  'attachment.type': 'e_attachment_type',
  'currency.unsupported': 'e_currency',
  'ledger.conflict': 'e_conflict',
};

let lang: Lang = 'uz';

/** Kept in sync with the app language by the settings store. */
export function setErrorLang(l: Lang) {
  lang = l;
}

/** Text shown for an error code in the current language; `fallback` (the server message) for unknown codes. */
export function errorText(code: string | null | undefined, fallback: string, status?: number): string {
  const key = code ? CODE_KEY[code] : undefined;
  if (key) return translate(lang, key);
  if (!fallback && status) return translate(lang, 'http_error', { status });
  return fallback || translate(lang, 'error_generic');
}
