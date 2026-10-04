import type { Contact, Organization, User } from '../types/crm';

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function userName(users: User[], id?: string | null): string {
  return users.find((u) => u.id === id)?.name ?? '—';
}

export function orgName(orgs: Organization[], id?: string | null): string {
  return orgs.find((o) => o.id === id)?.name ?? '—';
}

export function contactName(contacts: Contact[], id?: string | null): string {
  return contacts.find((c) => c.id === id)?.name ?? '—';
}