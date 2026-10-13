import type { CurrentUserDto } from '../../shared/api.js';

/** The account's current sections as one label, e.g. "Government Applications, Infrastructure & Security". */
export function sectionNames(user: Pick<CurrentUserDto, 'sections'>): string {
  return user.sections.map((section) => section.name).join(', ');
}
