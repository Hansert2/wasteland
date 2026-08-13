/**
 * Postgres being unreachable is an operational problem, not a bug in the game, and
 * the two deserve different pages.
 *
 * Node reports a dual-stack connection failure as an AggregateError whose own `code`
 * is set but whose detail lives in `.errors`, so both places have to be checked.
 */
const UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ETIMEDOUT']);

export function isDatabaseUnreachable(error) {
  const codes = [error?.code, ...(Array.isArray(error?.errors) ? error.errors : []).map((e) => e?.code)];
  return codes.some((code) => UNREACHABLE_CODES.has(code));
}
