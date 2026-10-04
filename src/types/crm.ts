export type Role = 'management' | 'lead' | 'sales' | 'admin';
export type SectionId = 'GA' | 'IS';

export interface Section {
  id: SectionId;
  name: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  sectionId: SectionId | null;
  managerId: string | null;
  active: boolean;
}

export type Stage =
'Identified' |
'Initial Engagement' |
'Requirements Discussion' |
'Awaiting Tender' |
'Tender Published' |
'Bid Preparation' |
'Bid Submitted' |
'Evaluation' |
'Awarded' |
'Lost' |
'On Hold' |
'Cancelled';

export type SolutionCategory =
'ERP' |
'Custom Software' |
'Data Platform & Analytics' |
'Cloud & Infrastructure' |
'Cybersecurity' |
'System Integration' |
'Other';

export type Priority = 'High' | 'Medium' | 'Low';

export interface ChangeEntry {
  id: string;
  at: string;
  userId: string;
  field: string;
  oldValue: string;
  newValue: string;
}

export interface Opportunity {
  id: string;
  name: string;
  orgId: string;
  department: string;
  category: SolutionCategory;
  description: string;
  estimatedValue: number;
  fundingSource: string;
  ownerId: string;
  sectionId: SectionId;
  stage: Stage;
  expectedTenderDate: string;
  expectedAwardDate: string;
  priority: Priority;
  contactIds: string[];
  nextAction: string;
  nextActionDue: string;
  awardedValue: number | null;
  awardDate: string;
  lostReason: string;
  statusNote: string;
  closedAt: string;
  createdAt: string;
  createdBy: string;
  history: ChangeEntry[];
}

export type OrgType =
'Ministry' |
'Department' |
'Directorate' |
'Authority' |
'Public Corporation' |
'Local Government' |
'Other';

export interface Organization {
  id: string;
  name: string;
  type: OrgType;
  parentId: string | null;
  location: string;
  website: string;
  notes: string;
}

export interface Contact {
  id: string;
  name: string;
  designation: string;
  orgId: string;
  department: string;
  email: string;
  phone: string;
  notes: string;
}

export type ActivityType = 'Meeting' | 'Phone Call' | 'Email' | 'Office Visit' | 'Internal Discussion' | 'Other';

export interface Activity {
  id: string;
  oppId: string;
  at: string;
  type: ActivityType;
  subject: string;
  notes: string;
  contactId: string | null;
  createdBy: string;
  nextAction: string;
  nextActionDue: string;
}

export type FollowUpStatus = 'Open' | 'Completed';

export interface FollowUp {
  id: string;
  oppId: string;
  title: string;
  assigneeId: string;
  due: string;
  priority: Priority;
  status: FollowUpStatus;
  completionNote: string;
  completedAt: string;
  createdBy: string;
  createdAt: string;
}

export type BidStatus = 'Reviewing' | 'Preparing' | 'Submitted' | 'Not Participating';

export interface Tender {
  id: string;
  oppId: string;
  title: string;
  reference: string;
  procuringEntity: string;
  method: string;
  noticeUrl: string;
  publicationDate: string;
  clarificationDeadline: string;
  submissionDeadline: string;
  bidStatus: BidStatus;
  submissionDate: string;
  ownerId: string;
  notes: string;
}

export type DocCategory = 'Tender document' | 'Requirements' | 'Meeting notes' | 'Proposal' | 'Correspondence' | 'Other';

export interface DocumentRecord {
  id: string;
  oppId: string;
  filename: string;
  category: DocCategory;
  uploadedBy: string;
  uploadedAt: string;
  sizeBytes: number;
  mimeType: string;
  isDemo: boolean;
  demoContent: string;
  dataUrl: string | null;
}

export interface CrmDb {
  version: number;
  currentUserId: string;
  users: User[];
  organizations: Organization[];
  contacts: Contact[];
  opportunities: Opportunity[];
  activities: Activity[];
  followUps: FollowUp[];
  tenders: Tender[];
  documents: DocumentRecord[];
  readNotifications: Record<string, string[]>;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

export interface OpportunityDraft {
  name: string;
  orgId: string;
  department: string;
  category: SolutionCategory | '';
  description: string;
  estimatedValue: number | null;
  fundingSource: string;
  ownerId: string;
  sectionId: SectionId | '';
  stage: Stage;
  expectedTenderDate: string;
  expectedAwardDate: string;
  priority: Priority;
  contactIds: string[];
  nextAction: string;
  nextActionDue: string;
  awardedValue: number | null;
  awardDate: string;
  lostReason: string;
  statusNote: string;
}

export type StageExtra = Partial<
  Pick<Opportunity, 'awardedValue' | 'awardDate' | 'lostReason' | 'statusNote' | 'nextAction' | 'nextActionDue'>>;


export type ActivityDraft = Omit<Activity, 'id' | 'createdBy'>;
export type FollowUpDraft = Omit<FollowUp, 'id' | 'createdBy' | 'createdAt' | 'completedAt'>;
export type TenderDraft = Omit<Tender, 'id'>;
export type DocumentDraft = Omit<DocumentRecord, 'id' | 'uploadedBy' | 'uploadedAt'>;
export type OrganizationDraft = Omit<Organization, 'id'>;
export type ContactDraft = Omit<Contact, 'id'>;
export type UserDraft = Omit<User, 'id'>;