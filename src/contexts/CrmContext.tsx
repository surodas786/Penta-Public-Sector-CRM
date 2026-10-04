import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type {
  ActionResult,
  ActivityDraft,
  ChangeEntry,
  ContactDraft,
  CrmDb,
  DocumentDraft,
  FollowUp,
  FollowUpDraft,
  Opportunity,
  OpportunityDraft,
  OrganizationDraft,
  Stage,
  StageExtra,
  TenderDraft,
  User,
  UserDraft } from
'../types/crm';
import { seedUsers } from '../data/seedUsers';
import { seedContacts, seedOrganizations } from '../data/seedOrganizations';
import { seedOpportunities } from '../data/seedOpportunities';
import { seedActivities, seedFollowUps } from '../data/seedActivities';
import { seedDocuments, seedTenders } from '../data/seedTenders';
import { PIPELINE_STAGES } from '../data/options';
import {
  assignableOwners,
  canAccessSalesRecords,
  canChangeSection,
  canEditOpportunity,
  canManageUsers,
  canReassignOpportunity,
  canViewContact,
  canViewOpportunity,
  canViewOrganizations,
  taskAssignees } from
'../utils/permissions';
import { DEMO_TODAY, demoTimestamp } from '../utils/demoClock';
import { newId } from '../utils/lookup';
import { diffOpportunity, makeEntry } from '../utils/history';
import { isActiveStage, isValidEmail, stageRequirementError, validateOpportunity } from '../utils/validation';
import { isActiveOpp } from '../utils/metrics';

/*
 * Local mock service layer for the demo. All data lives in browser localStorage.
 * Every mutating action re-checks permissions via utils/permissions.ts.
 * NOTE: In production, these rules must be enforced by the backend — never rely on the client.
 */

const STORAGE_KEY = 'penta-crm-demo-v1';
const DB_VERSION = 1;
const DENIED = 'You do not have permission to perform this action.';

export function createSeedDb(): CrmDb {
  return JSON.parse(
    JSON.stringify({
      version: DB_VERSION,
      currentUserId: 'u-nadia',
      users: seedUsers,
      organizations: seedOrganizations,
      contacts: seedContacts,
      opportunities: seedOpportunities,
      activities: seedActivities,
      followUps: seedFollowUps,
      tenders: seedTenders,
      documents: seedDocuments,
      readNotifications: {}
    })
  ) as CrmDb;
}

function loadDb(): CrmDb {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CrmDb;
      if (parsed.version === DB_VERSION) return parsed;
    }
  } catch {

    // fall through to seed
  }return createSeedDb();
}

const fail = (error: string): ActionResult => ({ ok: false, error });

/** Moves the opportunity's tender ownership and the previous owner's open follow-ups to the new owner. */
function transferRelated(d: CrmDb, oppId: string, oldOwner: string, newOwner: string): CrmDb {
  return {
    ...d,
    tenders: d.tenders.map((t) => t.oppId === oppId ? { ...t, ownerId: newOwner } : t),
    followUps: d.followUps.map((f) =>
    f.oppId === oppId && f.status === 'Open' && f.assigneeId === oldOwner ? { ...f, assigneeId: newOwner } : f
    )
  };
}

interface CrmContextValue {
  db: CrmDb;
  currentUser: User;
  switchUser: (id: string) => void;
  resetDemo: () => void;
  saveOpportunity: (draft: OpportunityDraft, id?: string) => ActionResult;
  changeStage: (oppId: string, stage: Stage, extra?: StageExtra) => ActionResult;
  reassignOpportunity: (oppId: string, newOwnerId: string) => ActionResult;
  saveActivity: (draft: ActivityDraft, id?: string) => ActionResult;
  saveFollowUp: (draft: FollowUpDraft, id?: string) => ActionResult;
  completeFollowUp: (id: string, note: string) => ActionResult;
  rescheduleFollowUp: (id: string, due: string) => ActionResult;
  saveTender: (draft: TenderDraft, id?: string) => ActionResult;
  addDocument: (draft: DocumentDraft) => ActionResult;
  saveOrganization: (draft: OrganizationDraft, id?: string) => ActionResult;
  saveContact: (draft: ContactDraft, linkedOppIds: string[], id?: string) => ActionResult;
  saveUser: (draft: UserDraft, id?: string) => ActionResult;
  setUserActive: (id: string, active: boolean) => ActionResult;
  markNotificationsRead: (ids: string[]) => void;
}

const CrmContext = createContext<CrmContextValue | null>(null);

export function CrmProvider({ children }: {children: React.ReactNode;}) {
  const [db, setDb] = useState<CrmDb>(loadDb);
  const dbRef = useRef(db);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch {
      toast.error('Browser storage is full. Recent changes may not persist after reload.');
    }
  }, [db]);

  const commit = (next: CrmDb) => {
    dbRef.current = next;
    setDb(next);
  };

  const me = (): User => {
    const d = dbRef.current;
    return d.users.find((u) => u.id === d.currentUserId) ?? d.users[0];
  };

  const ctxOf = (d: CrmDb) => ({ users: d.users, organizations: d.organizations, contacts: d.contacts });

  const switchUser = (id: string) => {
    const d = dbRef.current;
    const target = d.users.find((u) => u.id === id);
    if (!target || !target.active) return;
    commit({ ...d, currentUserId: id });
  };

  const resetDemo = () => {
    const current = dbRef.current.currentUserId;
    const seed = createSeedDb();
    if (seed.users.some((u) => u.id === current)) seed.currentUserId = current;
    commit(seed);
  };

  const saveOpportunity = (draft: OpportunityDraft, id?: string): ActionResult => {
    const d = dbRef.current;
    const user = me();
    if (!canAccessSalesRecords(user)) return fail(DENIED);
    if (Object.keys(validateOpportunity(draft)).length) return fail('Please fix the highlighted fields.');
    const owner = d.users.find((u) => u.id === draft.ownerId);
    if (!owner || owner.sectionId !== draft.sectionId) return fail('The owner must belong to the selected section.');
    const at = demoTimestamp();
    const old = id ? d.opportunities.find((o) => o.id === id) : undefined;
    const terminal = !isActiveStage(draft.stage);
    const base = {
      name: draft.name.trim(),
      orgId: draft.orgId,
      department: draft.department.trim(),
      category: draft.category as Opportunity['category'],
      description: draft.description.trim(),
      estimatedValue: draft.estimatedValue ?? 0,
      fundingSource: draft.fundingSource.trim(),
      ownerId: draft.ownerId,
      sectionId: draft.sectionId as Opportunity['sectionId'],
      stage: draft.stage,
      expectedTenderDate: draft.expectedTenderDate,
      expectedAwardDate: draft.expectedAwardDate,
      priority: draft.priority,
      contactIds: draft.contactIds,
      nextAction: draft.nextAction.trim(),
      nextActionDue: draft.nextActionDue,
      awardedValue: draft.stage === 'Awarded' ? draft.awardedValue : old?.awardedValue ?? null,
      awardDate: draft.stage === 'Awarded' ? draft.awardDate : old?.awardDate ?? '',
      lostReason: draft.stage === 'Lost' ? draft.lostReason.trim() : old?.lostReason ?? '',
      statusNote: draft.stage === 'On Hold' || draft.stage === 'Cancelled' ? draft.statusNote.trim() : old?.statusNote ?? '',
      closedAt: terminal ?
      old && old.stage === draft.stage ?
      old.closedAt :
      draft.stage === 'Awarded' ?
      draft.awardDate :
      DEMO_TODAY :
      ''
    };

    if (old) {
      if (!canEditOpportunity(user, old, d.users)) return fail(DENIED);
      const ownerChanged = old.ownerId !== base.ownerId;
      const sectionChanged = old.sectionId !== base.sectionId;
      if (ownerChanged || sectionChanged) {
        if (!canReassignOpportunity(user, old, d.users)) return fail('You cannot change ownership or section.');
        if (sectionChanged && !canChangeSection(user)) return fail('Only management can transfer across sections.');
        if (!assignableOwners(user, d.users).some((u) => u.id === base.ownerId)) return fail('That owner is outside your permitted team.');
      }
      const updated: Opportunity = { ...old, ...base };
      updated.history = [...old.history, ...diffOpportunity(old, updated, ctxOf(d), user.id, at)];
      let next: CrmDb = { ...d, opportunities: d.opportunities.map((o) => o.id === id ? updated : o) };
      if (ownerChanged) next = transferRelated(next, old.id, old.ownerId, base.ownerId);
      commit(next);
      return { ok: true, id: old.id };
    }

    if (!assignableOwners(user, d.users).some((u) => u.id === base.ownerId)) return fail('That owner is outside your permitted team.');
    const created: Opportunity = {
      id: newId('opp'),
      ...base,
      createdAt: at,
      createdBy: user.id,
      history: [makeEntry(user.id, at, 'Record', '—', `Created at stage ${base.stage}`)]
    };
    commit({ ...d, opportunities: [created, ...d.opportunities] });
    return { ok: true, id: created.id };
  };

  const changeStage = (oppId: string, stage: Stage, extra: StageExtra = {}): ActionResult => {
    const d = dbRef.current;
    const user = me();
    const old = d.opportunities.find((o) => o.id === oppId);
    if (!old || !canEditOpportunity(user, old, d.users)) return fail(DENIED);
    if (old.stage === stage) return { ok: true, id: oppId };
    const err = stageRequirementError(old, stage, extra);
    if (err) return fail(err);
    const updated: Opportunity = { ...old, stage };
    if (stage === 'Awarded') {
      updated.awardedValue = extra.awardedValue ?? null;
      updated.awardDate = extra.awardDate ?? '';
      updated.closedAt = extra.awardDate ?? DEMO_TODAY;
    } else if (stage === 'Lost') {
      updated.lostReason = extra.lostReason?.trim() ?? '';
      updated.closedAt = DEMO_TODAY;
    } else if (stage === 'Cancelled') {
      updated.statusNote = extra.statusNote?.trim() ?? '';
      updated.closedAt = DEMO_TODAY;
    } else {
      if (stage === 'On Hold') updated.statusNote = extra.statusNote?.trim() ?? '';
      updated.closedAt = '';
      if (extra.nextAction) updated.nextAction = extra.nextAction.trim();
      if (extra.nextActionDue) updated.nextActionDue = extra.nextActionDue;
    }
    const at = demoTimestamp();
    updated.history = [...old.history, ...diffOpportunity(old, updated, ctxOf(d), user.id, at)];
    commit({ ...d, opportunities: d.opportunities.map((o) => o.id === oppId ? updated : o) });
    return { ok: true, id: oppId };
  };

  const reassignOpportunity = (oppId: string, newOwnerId: string): ActionResult => {
    const d = dbRef.current;
    const user = me();
    const old = d.opportunities.find((o) => o.id === oppId);
    if (!old || !canReassignOpportunity(user, old, d.users)) return fail(DENIED);
    const newOwner = d.users.find((u) => u.id === newOwnerId);
    if (!newOwner || !newOwner.active || !newOwner.sectionId) return fail('Select an active owner.');
    if (newOwnerId === old.ownerId) return fail('This user already owns the opportunity.');
    if (!assignableOwners(user, d.users).some((u) => u.id === newOwnerId)) return fail('That owner is outside your permitted team.');
    if (newOwner.sectionId !== old.sectionId && !canChangeSection(user)) return fail('Only management can transfer across sections.');
    const updated: Opportunity = { ...old, ownerId: newOwnerId, sectionId: newOwner.sectionId };
    const at = demoTimestamp();
    updated.history = [...old.history, ...diffOpportunity(old, updated, ctxOf(d), user.id, at)];
    let next: CrmDb = { ...d, opportunities: d.opportunities.map((o) => o.id === oppId ? updated : o) };
    next = transferRelated(next, oppId, old.ownerId, newOwnerId);
    commit(next);
    return { ok: true, id: oppId };
  };

  const saveActivity = (draft: ActivityDraft, id?: string): ActionResult => {
    const d = dbRef.current;
    const user = me();
    const opp = d.opportunities.find((o) => o.id === draft.oppId);
    if (!opp || !canViewOpportunity(user, opp, d.users)) return fail(DENIED);
    if (!draft.subject.trim() || !draft.at || !draft.type) return fail('Subject, date/time and type are required.');
    const existing = id ? d.activities.find((a) => a.id === id) : undefined;
    const activity = { ...draft, subject: draft.subject.trim(), id: existing?.id ?? newId('act'), createdBy: existing?.createdBy ?? user.id };
    let next: CrmDb = {
      ...d,
      activities: existing ? d.activities.map((a) => a.id === id ? activity : a) : [activity, ...d.activities]
    };
    if (!existing && draft.nextAction.trim() && draft.nextActionDue) {
      const at = demoTimestamp();
      const fu: FollowUp = {
        id: newId('fu'),
        oppId: opp.id,
        title: draft.nextAction.trim(),
        assigneeId: user.id,
        due: draft.nextActionDue,
        priority: opp.priority,
        status: 'Open',
        completionNote: '',
        completedAt: '',
        createdBy: user.id,
        createdAt: at
      };
      next = { ...next, followUps: [fu, ...next.followUps] };
      if (isActiveOpp(opp)) {
        const updated: Opportunity = { ...opp, nextAction: draft.nextAction.trim(), nextActionDue: draft.nextActionDue };
        updated.history = [...opp.history, ...diffOpportunity(opp, updated, ctxOf(d), user.id, at)];
        next = { ...next, opportunities: next.opportunities.map((o) => o.id === opp.id ? updated : o) };
      }
    }
    commit(next);
    return { ok: true, id: activity.id };
  };

  const saveFollowUp = (draft: FollowUpDraft, id?: string): ActionResult => {
    const d = dbRef.current;
    const user = me();
    const opp = d.opportunities.find((o) => o.id === draft.oppId);
    if (!opp || !canViewOpportunity(user, opp, d.users)) return fail(DENIED);
    if (!draft.title.trim() || !draft.due) return fail('Task title and due date are required.');
    const existing = id ? d.followUps.find((f) => f.id === id) : undefined;
    const assigneeAllowed =
    taskAssignees(user, opp, d.users).some((u) => u.id === draft.assigneeId) || existing?.assigneeId === draft.assigneeId;
    if (!assigneeAllowed) return fail('You can only assign follow-ups to permitted users.');
    const at = demoTimestamp();
    const record: FollowUp = {
      ...draft,
      title: draft.title.trim(),
      id: existing?.id ?? newId('fu'),
      createdBy: existing?.createdBy ?? user.id,
      createdAt: existing?.createdAt ?? at,
      completedAt: draft.status === 'Completed' ? existing?.completedAt || at : ''
    };
    commit({
      ...d,
      followUps: existing ? d.followUps.map((f) => f.id === id ? record : f) : [record, ...d.followUps]
    });
    return { ok: true, id: record.id };
  };

  const updateFollowUp = (id: string, patch: Partial<FollowUp>): ActionResult => {
    const d = dbRef.current;
    const user = me();
    const fu = d.followUps.find((f) => f.id === id);
    const opp = fu ? d.opportunities.find((o) => o.id === fu.oppId) : undefined;
    if (!fu || !opp || !canViewOpportunity(user, opp, d.users)) return fail(DENIED);
    commit({ ...d, followUps: d.followUps.map((f) => f.id === id ? { ...f, ...patch } : f) });
    return { ok: true, id };
  };

  const completeFollowUp = (id: string, note: string) =>
  updateFollowUp(id, { status: 'Completed', completionNote: note.trim(), completedAt: demoTimestamp() });

  const rescheduleFollowUp = (id: string, due: string) => {
    if (!due) return fail('Choose a new due date.');
    return updateFollowUp(id, { due });
  };

  const saveTender = (draft: TenderDraft, id?: string): ActionResult => {
    const d = dbRef.current;
    const user = me();
    const opp = d.opportunities.find((o) => o.id === draft.oppId);
    if (!opp || !canViewOpportunity(user, opp, d.users)) return fail(DENIED);
    if (!draft.title.trim() || !draft.reference.trim() || !draft.submissionDeadline || !draft.publicationDate)
    return fail('Please complete the required tender fields.');
    if (draft.bidStatus === 'Submitted' && !draft.submissionDate) return fail('Bid submission date is required when Submitted.');
    const existing = id ? d.tenders.find((t) => t.id === id) : undefined;
    if (!existing && d.tenders.some((t) => t.oppId === draft.oppId)) return fail('This opportunity already has a tender record.');
    const ownerAllowed = taskAssignees(user, opp, d.users).some((u) => u.id === draft.ownerId) || existing?.ownerId === draft.ownerId;
    if (!ownerAllowed) return fail('Responsible owner must be a permitted user.');
    const record = { ...draft, id: existing?.id ?? newId('tdr') };
    let next: CrmDb = { ...d, tenders: existing ? d.tenders.map((t) => t.id === id ? record : t) : [record, ...d.tenders] };

    const at = demoTimestamp();
    const oppEntries: ChangeEntry[] = [];
    let updatedOpp: Opportunity = opp;
    if (!existing) oppEntries.push(makeEntry(user.id, at, 'Tender', '—', `${record.reference} added (${record.bidStatus})`));else
    if (existing.bidStatus !== record.bidStatus)
    oppEntries.push(makeEntry(user.id, at, 'Tender bid status', existing.bidStatus, record.bidStatus));
    const submittedIdx = PIPELINE_STAGES.indexOf('Bid Submitted');
    const curIdx = PIPELINE_STAGES.indexOf(opp.stage);
    if (record.bidStatus === 'Submitted' && curIdx >= 0 && curIdx < submittedIdx) {
      updatedOpp = { ...opp, stage: 'Bid Submitted' };
      oppEntries.push(makeEntry(user.id, at, 'Stage', opp.stage, 'Bid Submitted'));
    }
    if (oppEntries.length) {
      updatedOpp = { ...updatedOpp, history: [...opp.history, ...oppEntries] };
      next = { ...next, opportunities: next.opportunities.map((o) => o.id === opp.id ? updatedOpp : o) };
    }
    commit(next);
    return { ok: true, id: record.id };
  };

  const addDocument = (draft: DocumentDraft): ActionResult => {
    const d = dbRef.current;
    const user = me();
    const opp = d.opportunities.find((o) => o.id === draft.oppId);
    if (!opp || !canViewOpportunity(user, opp, d.users)) return fail(DENIED);
    const record = { ...draft, id: newId('doc'), uploadedBy: user.id, uploadedAt: demoTimestamp() };
    commit({ ...d, documents: [record, ...d.documents] });
    return { ok: true, id: record.id };
  };

  const saveOrganization = (draft: OrganizationDraft, id?: string): ActionResult => {
    const d = dbRef.current;
    if (!canViewOrganizations(me())) return fail(DENIED);
    if (!draft.name.trim() || !draft.type || !draft.location.trim()) return fail('Name, type and location are required.');
    if (id && draft.parentId === id) return fail('An organization cannot be its own parent.');
    const record = { ...draft, name: draft.name.trim(), id: id ?? newId('org') };
    commit({
      ...d,
      organizations: id ? d.organizations.map((o) => o.id === id ? record : o) : [...d.organizations, record]
    });
    return { ok: true, id: record.id };
  };

  const saveContact = (draft: ContactDraft, linkedOppIds: string[], id?: string): ActionResult => {
    const d = dbRef.current;
    const user = me();
    if (!canAccessSalesRecords(user)) return fail(DENIED);
    if (!draft.name.trim() || !draft.designation.trim() || !draft.orgId) return fail('Name, designation and organization are required.');
    if (draft.email && !isValidEmail(draft.email)) return fail('Enter a valid email address.');
    const existing = id ? d.contacts.find((c) => c.id === id) : undefined;
    if (existing && !canViewContact(user, existing, d.opportunities, d.users)) return fail(DENIED);
    const permitted = d.opportunities.filter((o) => canViewOpportunity(user, o, d.users));
    const permittedLinks = linkedOppIds.filter((oid) => permitted.some((o) => o.id === oid));
    if (permittedLinks.length === 0) return fail('Link the contact to at least one opportunity you can access.');
    const record = { ...draft, name: draft.name.trim(), id: existing?.id ?? newId('con') };
    const at = demoTimestamp();
    const opportunities = d.opportunities.map((o) => {
      if (!permitted.some((p) => p.id === o.id)) return o;
      const shouldLink = permittedLinks.includes(o.id);
      const linked = o.contactIds.includes(record.id);
      if (shouldLink === linked) return o;
      const updated: Opportunity = {
        ...o,
        contactIds: shouldLink ? [...o.contactIds, record.id] : o.contactIds.filter((c) => c !== record.id)
      };
      const contacts = existing ? d.contacts.map((c) => c.id === record.id ? record : c) : [...d.contacts, record];
      updated.history = [...o.history, ...diffOpportunity(o, updated, { ...ctxOf(d), contacts }, user.id, at)];
      return updated;
    });
    commit({
      ...d,
      opportunities,
      contacts: existing ? d.contacts.map((c) => c.id === id ? record : c) : [...d.contacts, record]
    });
    return { ok: true, id: record.id };
  };

  const saveUser = (draft: UserDraft, id?: string): ActionResult => {
    const d = dbRef.current;
    if (!canManageUsers(me())) return fail(DENIED);
    if (!draft.name.trim() || !draft.email.trim()) return fail('Name and email are required.');
    if (!isValidEmail(draft.email)) return fail('Enter a valid email address.');
    if (d.users.some((u) => u.email.toLowerCase() === draft.email.toLowerCase() && u.id !== id)) return fail('Email is already in use.');
    const needsSection = draft.role === 'lead' || draft.role === 'sales';
    if (needsSection && !draft.sectionId) return fail('Section leads and salespeople must belong to a section.');
    if (draft.role === 'sales') {
      const mgr = d.users.find((u) => u.id === draft.managerId);
      if (!mgr || mgr.role !== 'lead' || mgr.sectionId !== draft.sectionId) return fail('Salespeople must report to the section lead of their section.');
    }
    if (draft.role === 'lead' && draft.active && d.users.some((u) => u.role === 'lead' && u.active && u.sectionId === draft.sectionId && u.id !== id))
    return fail('This version supports one active section lead per section.');
    const existing = id ? d.users.find((u) => u.id === id) : undefined;
    if (existing) {
      const ownsActive = d.opportunities.some((o) => o.ownerId === id && isActiveOpp(o));
      if (ownsActive && (existing.sectionId !== draft.sectionId || !needsSection))
      return fail(`${existing.name} owns active opportunities. Reassign them before changing role or section.`);
      const hasReports = d.users.some((u) => u.managerId === id && u.active && u.role === 'sales');
      if (hasReports && (draft.role !== 'lead' || draft.sectionId !== existing.sectionId))
      return fail(`${existing.name} has direct reports. Move them to another lead first.`);
    }
    const record: User = {
      ...draft,
      name: draft.name.trim(),
      email: draft.email.trim(),
      sectionId: needsSection ? draft.sectionId : null,
      managerId: draft.role === 'admin' || draft.role === 'management' ? null : draft.managerId,
      id: existing?.id ?? newId('u')
    };
    commit({ ...d, users: existing ? d.users.map((u) => u.id === id ? record : u) : [...d.users, record] });
    return { ok: true, id: record.id };
  };

  const setUserActive = (id: string, active: boolean): ActionResult => {
    const d = dbRef.current;
    const user = me();
    if (!canManageUsers(user)) return fail(DENIED);
    const target = d.users.find((u) => u.id === id);
    if (!target) return fail('User not found.');
    if (!active) {
      if (id === user.id) return fail('You cannot deactivate the account you are signed in with.');
      const owned = d.opportunities.filter((o) => o.ownerId === id && isActiveOpp(o)).length;
      if (owned > 0)
      return fail(`${target.name} owns ${owned} active ${owned === 1 ? 'opportunity' : 'opportunities'}. Reassign them before deactivating this account.`);
      if (d.users.some((u) => u.managerId === id && u.active && u.role === 'sales'))
      return fail(`${target.name} has active direct reports. Move them to another lead first.`);
    } else if (target.role === 'lead' && d.users.some((u) => u.role === 'lead' && u.active && u.sectionId === target.sectionId && u.id !== id)) {
      return fail('Another section lead is already active for this section.');
    }
    commit({ ...d, users: d.users.map((u) => u.id === id ? { ...u, active } : u) });
    return { ok: true, id };
  };

  const markNotificationsRead = (ids: string[]) => {
    const d = dbRef.current;
    const uid = d.currentUserId;
    const existing = new Set(d.readNotifications[uid] ?? []);
    ids.forEach((i) => existing.add(i));
    commit({ ...d, readNotifications: { ...d.readNotifications, [uid]: Array.from(existing) } });
  };

  const currentUser = db.users.find((u) => u.id === db.currentUserId) ?? db.users[0];

  const value: CrmContextValue = {
    db,
    currentUser,
    switchUser,
    resetDemo,
    saveOpportunity,
    changeStage,
    reassignOpportunity,
    saveActivity,
    saveFollowUp,
    completeFollowUp,
    rescheduleFollowUp,
    saveTender,
    addDocument,
    saveOrganization,
    saveContact,
    saveUser,
    setUserActive,
    markNotificationsRead
  };

  return <CrmContext.Provider value={value}>{children}</CrmContext.Provider>;
}

export function useCrm(): CrmContextValue {
  const ctx = useContext(CrmContext);
  if (!ctx) throw new Error('useCrm must be used within CrmProvider');
  return ctx;
}