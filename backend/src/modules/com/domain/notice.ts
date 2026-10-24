import { InvariantError } from '../../../shared/domain/errors.js';

export type AudienceType =
  | 'everyone'
  | 'campus'
  | 'year_group'
  | 'class_section'
  | 'house'
  | 'role'
  | 'staff'
  | 'guardians'
  | 'students'
  | 'user';

export interface Audience {
  type: AudienceType;
  id?: string | null;
}

const NEEDS_ID: ReadonlySet<AudienceType> = new Set(['campus', 'year_group', 'class_section', 'house', 'role', 'user']);

/** Every entry has an id exactly when its type points at one thing; no duplicates. */
export function normaliseAudiences(list: Audience[]): Array<{ type: AudienceType; id: string | null }> {
  if (!list.length) throw new InvariantError('AUDIENCE_REQUIRED', 'Choose who the notice is for');
  const seen = new Set<string>();
  const out: Array<{ type: AudienceType; id: string | null }> = [];
  for (const a of list) {
    const id = a.id ?? null;
    if (NEEDS_ID.has(a.type) !== (id !== null))
      throw new InvariantError('AUDIENCE_INVALID', `${a.type} ${NEEDS_ID.has(a.type) ? 'needs' : 'takes no'} id`);
    const key = `${a.type}:${id ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ type: a.type, id });
    }
  }
  return out;
}

/** Short plain-text form of a notice body for SMS / push (first sentence-ish, at most `max` characters). */
export function summary(body: string, max = 120): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
