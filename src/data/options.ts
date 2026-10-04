import type {
  ActivityType,
  BidStatus,
  DocCategory,
  OrgType,
  Priority,
  Role,
  Section,
  SolutionCategory,
  Stage } from
'../types/crm';

export const SECTIONS: Section[] = [
{ id: 'GA', name: 'Government Applications' },
{ id: 'IS', name: 'Infrastructure & Security' }];


export const PIPELINE_STAGES: Stage[] = [
'Identified',
'Initial Engagement',
'Requirements Discussion',
'Awaiting Tender',
'Tender Published',
'Bid Preparation',
'Bid Submitted',
'Evaluation'];


export const OUTCOME_STAGES: Stage[] = ['Awarded', 'Lost'];
export const STATUS_STAGES: Stage[] = ['On Hold', 'Cancelled'];
export const ALL_STAGES: Stage[] = [...PIPELINE_STAGES, ...OUTCOME_STAGES, ...STATUS_STAGES];
export const CLOSED_STAGES: Stage[] = ['Awarded', 'Lost', 'Cancelled'];

export const SOLUTION_CATEGORIES: SolutionCategory[] = [
'ERP',
'Custom Software',
'Data Platform & Analytics',
'Cloud & Infrastructure',
'Cybersecurity',
'System Integration',
'Other'];


export const PRIORITIES: Priority[] = ['High', 'Medium', 'Low'];

export const ORG_TYPES: OrgType[] = [
'Ministry',
'Department',
'Directorate',
'Authority',
'Public Corporation',
'Local Government',
'Other'];


export const ACTIVITY_TYPES: ActivityType[] = ['Meeting', 'Phone Call', 'Email', 'Office Visit', 'Internal Discussion', 'Other'];

export const BID_STATUSES: BidStatus[] = ['Reviewing', 'Preparing', 'Submitted', 'Not Participating'];

export const DOC_CATEGORIES: DocCategory[] = [
'Tender document',
'Requirements',
'Meeting notes',
'Proposal',
'Correspondence',
'Other'];


export const PROCUREMENT_METHODS: string[] = [
'Open Tendering Method (OTM)',
'Limited Tendering Method (LTM)',
'Request for Proposal (RFP)',
'Two-Stage Tendering',
'Direct Procurement'];


export const ROLE_LABELS: Record<Role, string> = {
  management: 'Management',
  lead: 'Section Lead',
  sales: 'Salesperson',
  admin: 'System Administrator'
};

export function sectionName(id?: string | null): string {
  return SECTIONS.find((s) => s.id === id)?.name ?? '—';
}