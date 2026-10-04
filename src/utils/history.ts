import type { ChangeEntry, Contact, Opportunity, Organization, User } from '../types/crm';
import { sectionName } from '../data/options';
import { formatBDT, formatDate } from './format';
import { contactName, newId, orgName, userName } from './lookup';

interface Ctx {
  users: User[];
  organizations: Organization[];
  contacts: Contact[];
}

type Fmt = (value: unknown, ctx: Ctx) => string;

const str: Fmt = (v) => v == null || v === '' ? '—' : String(v);

const FIELDS: {key: keyof Opportunity;label: string;fmt: Fmt;}[] = [
{ key: 'name', label: 'Name', fmt: str },
{ key: 'orgId', label: 'Procuring organization', fmt: (v, c) => orgName(c.organizations, v as string) },
{ key: 'department', label: 'Department / office', fmt: str },
{ key: 'category', label: 'Solution category', fmt: str },
{ key: 'description', label: 'Description', fmt: str },
{ key: 'estimatedValue', label: 'Estimated value', fmt: (v) => formatBDT(v as number) },
{ key: 'fundingSource', label: 'Funding source', fmt: str },
{ key: 'ownerId', label: 'Owner', fmt: (v, c) => userName(c.users, v as string) },
{ key: 'sectionId', label: 'Section', fmt: (v) => sectionName(v as string) },
{ key: 'stage', label: 'Stage', fmt: str },
{ key: 'expectedTenderDate', label: 'Expected tender publication', fmt: (v) => formatDate(v as string) },
{ key: 'expectedAwardDate', label: 'Expected award date', fmt: (v) => formatDate(v as string) },
{ key: 'priority', label: 'Priority', fmt: str },
{
  key: 'contactIds',
  label: 'Associated contacts',
  fmt: (v, c) => {
    const ids = v as string[];
    return ids.length ? ids.map((id) => contactName(c.contacts, id)).join(', ') : '—';
  }
},
{ key: 'nextAction', label: 'Next action', fmt: str },
{ key: 'nextActionDue', label: 'Next action due', fmt: (v) => formatDate(v as string) },
{ key: 'awardedValue', label: 'Awarded value', fmt: (v) => v == null ? '—' : formatBDT(v as number) },
{ key: 'awardDate', label: 'Award date', fmt: (v) => formatDate(v as string) },
{ key: 'lostReason', label: 'Lost reason', fmt: str },
{ key: 'statusNote', label: 'Status note', fmt: str }];


export function makeEntry(userId: string, at: string, field: string, oldValue: string, newValue: string): ChangeEntry {
  return { id: newId('h'), at, userId, field, oldValue, newValue };
}

export function diffOpportunity(old: Opportunity, next: Opportunity, ctx: Ctx, userId: string, at: string): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  for (const f of FIELDS) {
    const a = old[f.key];
    const b = next[f.key];
    if (JSON.stringify(a ?? '') !== JSON.stringify(b ?? '')) {
      entries.push(makeEntry(userId, at, f.label, f.fmt(a, ctx), f.fmt(b, ctx)));
    }
  }
  return entries;
}