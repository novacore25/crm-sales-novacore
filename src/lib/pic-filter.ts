import type { UserProfile } from '@/types';

/**
 * Who may appear in a "choose a PIC" dropdown.
 *
 * A `pending` account is someone who signed in but has not been granted a role
 * yet. Offering them as a PIC does not just add a harmless name to the list: the
 * dashboard filters leads by the name in `funnel_history.by_user_name`, and a
 * pending account has never been assigned a lead, so selecting one returns a
 * permanently empty result. The dropdown would be offering a choice that can
 * only ever show "nothing".
 *
 * `lord` IS included. The lord closes deals and owns the target, so leaving them
 * out would make their own work invisible in the scorecard - and on the
 * dashboard the lord is the person most likely to be auditing it.
 *
 * This is one function on purpose. The same rule was previously written out
 * inline in five components, and they had already drifted apart: three included
 * `lord`, one excluded it, and one filtered on a different predicate entirely.
 * A pending account appearing in one dropdown and not another is the kind of
 * inconsistency nobody reports but everybody notices.
 */
export function assignablePICs(users: UserProfile[]): UserProfile[] {
  return users.filter(
    u => u.role === 'staff' || u.role === 'admin' || u.role === 'lord',
  );
}

/** Names only, sorted, ready to map into an <option> list. */
export function assignablePICNames(users: UserProfile[]): string[] {
  return assignablePICs(users)
    .map(u => u.name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'id'));
}

/**
 * Drop names that are not assignable PICs, preserving the input order.
 *
 * The OI Forecast PIC dropdown used to be built from the names found in the
 * forecast rows themselves rather than from the user list. That meant it
 * offered anyone who had ever touched a lead - including departed staff whose
 * name is still in the history, and pending accounts. Filtered against the user
 * list here instead.
 *
 * A name present in the data but absent from `users` is kept: the work is real
 * and hiding the person who did it would make the total look like it came from
 * nowhere. Only names belonging to a *pending* account are removed.
 */
export function knownAssignablePICs(names: string[], users: UserProfile[]): string[] {
  const pending = new Set(
    users.filter(u => u.role === 'pending').map(u => u.name),
  );
  return names.filter(n => !pending.has(n));
}
