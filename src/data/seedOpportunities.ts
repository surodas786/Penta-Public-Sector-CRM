import type { Opportunity, Priority, SectionId, SolutionCategory, Stage } from '../types/crm';

interface SeedOpp {
  id: string;
  name: string;
  orgId: string;
  department: string;
  category: SolutionCategory;
  description: string;
  value: number;
  owner: string;
  section: SectionId;
  stage: Stage;
  priority: Priority;
  contacts: string[];
  created: string;
  funding?: string;
  tenderDate?: string;
  awardBy?: string;
  next?: string;
  due?: string;
  awarded?: number;
  awardDate?: string;
  lostReason?: string;
  statusNote?: string;
  closedAt?: string;
}

function mk(s: SeedOpp): Opportunity {
  const createdAt = `${s.created}T10:30:00+06:00`;
  const history = [
  { id: `h-${s.id}-0`, at: createdAt, userId: s.owner, field: 'Record', oldValue: '—', newValue: 'Created (synthetic demo record)' }];

  if (s.closedAt) {
    history.push({ id: `h-${s.id}-1`, at: `${s.closedAt}T16:00:00+06:00`, userId: s.owner, field: 'Stage', oldValue: 'Evaluation', newValue: s.stage });
  }
  return {
    id: s.id,
    name: s.name,
    orgId: s.orgId,
    department: s.department,
    category: s.category,
    description: s.description,
    estimatedValue: s.value,
    fundingSource: s.funding ?? '',
    ownerId: s.owner,
    sectionId: s.section,
    stage: s.stage,
    expectedTenderDate: s.tenderDate ?? '',
    expectedAwardDate: s.awardBy ?? '',
    priority: s.priority,
    contactIds: s.contacts,
    nextAction: s.next ?? '',
    nextActionDue: s.due ?? '',
    awardedValue: s.awarded ?? null,
    awardDate: s.awardDate ?? '',
    lostReason: s.lostReason ?? '',
    statusNote: s.statusNote ?? '',
    closedAt: s.closedAt ?? '',
    createdAt,
    createdBy: s.owner,
    history
  };
}

// Synthetic opportunities. None of these represent real Penta contracts or actual government procurements.
export const seedOpportunities: Opportunity[] = [
mk({ id: 'p1', name: 'Municipal Service Portal', orgId: 'o7', department: 'ICT Cell, Office of the Chief Executive', category: 'Custom Software', description: 'Unified online portal for trade licences, holding tax and birth registration requests.', value: 42000000, funding: 'City Corporation development budget', owner: 'u-rafiq', section: 'GA', stage: 'Requirements Discussion', tenderDate: '2026-11-15', awardBy: '2027-02-28', priority: 'High', contacts: ['c13', 'c14'], next: 'Send revised scope to Sylvan Hills ICT Cell', due: '2026-09-30', created: '2026-07-08' }),
mk({ id: 'p2', name: 'Public Training Institute ERP', orgId: 'o4', department: 'Planning & Development Wing', category: 'ERP', description: 'Integrated ERP covering trainee admissions, finance, HR and asset management for 14 training institutes.', value: 68000000, funding: 'Government revenue budget (FY 2026–27)', owner: 'u-tasnia', section: 'GA', stage: 'Bid Preparation', tenderDate: '2026-09-10', awardBy: '2026-12-20', priority: 'High', contacts: ['c6', 'c7'], next: 'Finalise financial proposal and obtain bid security', due: '2026-10-03', created: '2026-05-20' }),
mk({ id: 'p3', name: 'Agency Document Management System', orgId: 'o2', department: 'Records Management Division', category: 'Custom Software', description: 'Digitise and index civic records with workflow-based approvals and retention rules.', value: 31000000, owner: 'u-rafiq', section: 'GA', stage: 'Tender Published', tenderDate: '2026-09-22', awardBy: '2026-12-31', priority: 'Medium', contacts: ['c3', 'c4'], next: 'Review RFP and submit clarification questions', due: '2026-10-04', created: '2026-06-12' }),
mk({ id: 'p4', name: 'Citizen Service Application', orgId: 'o1', department: 'Service Innovation Unit', category: 'Custom Software', description: 'Mobile and web application for citizens to track public service requests across field offices.', value: 24000000, funding: 'Development partner grant (indicative)', owner: 'u-tasnia', section: 'GA', stage: 'Identified', awardBy: '2027-06-30', priority: 'Medium', contacts: ['c1'], next: 'Request introductory meeting with Joint Secretary (ICT)', due: '2026-10-06', created: '2026-09-18' }),
mk({ id: 'p5', name: 'Riverbank e-Services Portal', orgId: 'o10', department: "Mayor's Office", category: 'Custom Software', description: 'Online municipal services for permits, complaints and fee payments.', value: 26000000, owner: 'u-rafiq', section: 'GA', stage: 'Awarded', awardBy: '2026-10-15', priority: 'Medium', contacts: ['c20', 'c21'], awarded: 23500000, awardDate: '2026-10-01', closedAt: '2026-10-01', created: '2026-03-14' }),
mk({ id: 'p6', name: 'Skills Grants Management System', orgId: 'o3', department: 'Grants & Scholarships Wing', category: 'Custom Software', description: 'Grant application, scoring and disbursement tracking for vocational scholarships.', value: 18000000, owner: 'u-tasnia', section: 'GA', stage: 'Lost', awardBy: '2026-08-31', priority: 'Medium', contacts: ['c5', 'c22'], lostReason: 'Lost on price — winning bid approx. 15% lower', closedAt: '2026-08-26', created: '2026-03-02' }),
mk({ id: 'p7', name: 'Records Agency Archive Search Platform', orgId: 'o9', department: 'Digital Archives Directorate', category: 'Data Platform & Analytics', description: 'Full-text search and metadata catalogue across digitised archive collections.', value: 16000000, owner: 'u-nadia', section: 'GA', stage: 'Initial Engagement', awardBy: '2027-03-31', priority: 'Medium', contacts: ['c17', 'c19'], next: 'Share capability brief with Director General', due: '2026-10-02', created: '2026-08-25' }),
mk({ id: 'p8', name: 'Training Institute Learning Portal', orgId: 'o4', department: 'eLearning Cell', category: 'Custom Software', description: 'Blended learning portal with course authoring and assessment for trainees.', value: 22000000, owner: 'u-rafiq', section: 'GA', stage: 'Bid Submitted', tenderDate: '2026-08-28', awardBy: '2026-11-10', priority: 'Medium', contacts: ['c6', 'c8'], next: 'Respond to evaluation committee queries', due: '2026-10-09', created: '2026-06-30' }),
mk({ id: 'p9', name: 'Civic Grievance Mobile App', orgId: 'o1', department: 'Service Innovation Unit', category: 'Custom Software', description: 'Grievance submission and tracking app with field-office routing.', value: 14500000, owner: 'u-tasnia', section: 'GA', stage: 'On Hold', priority: 'Low', contacts: ['c2'], next: 'Check status of budget revision', due: '2026-11-03', statusNote: 'Ministry budget review pending; revisit after mid-year revision.', created: '2026-04-14' }),
mk({ id: 'p10', name: 'Public Service Analytics Dashboard', orgId: 'o1', department: 'Monitoring & Evaluation Wing', category: 'Data Platform & Analytics', description: 'Performance dashboards on service delivery KPIs across ministries.', value: 34000000, owner: 'u-nadia', section: 'GA', stage: 'Evaluation', tenderDate: '2026-07-30', awardBy: '2026-10-25', priority: 'High', contacts: ['c1', 'c2'], next: 'Prepare technical presentation for evaluation committee', due: '2026-10-07', created: '2026-04-02' }),
mk({ id: 'p21', name: 'Vocational Certification Management System', orgId: 'o3', department: 'Planning Wing', category: 'Custom Software', description: 'Certificate issuance, verification and QR validation for vocational graduates.', value: 21500000, owner: 'u-rafiq', section: 'GA', stage: 'Awaiting Tender', tenderDate: '2026-10-25', awardBy: '2027-01-15', priority: 'Medium', contacts: ['c5', 'c22'], next: 'Confirm tender publication timeline with planning officer', due: '2026-10-12', created: '2026-07-01' }),
mk({ id: 'p11', name: 'Regional Utility Data Platform', orgId: 'o5', department: 'Planning & Monitoring Department', category: 'Data Platform & Analytics', description: 'Consolidated meter, billing and network data with reporting across six zones.', value: 55000000, funding: 'Development partner loan (indicative)', owner: 'u-imran', section: 'IS', stage: 'Awaiting Tender', tenderDate: '2026-10-20', awardBy: '2027-01-31', priority: 'High', contacts: ['c9', 'c10'], next: 'Follow up on procurement committee feedback', due: '2026-09-29', created: '2026-05-05' }),
mk({ id: 'p12', name: 'Government Data Center Upgrade', orgId: 'o9', department: 'ICT Infrastructure Division', category: 'Cloud & Infrastructure', description: 'Compute, storage and virtualisation refresh for the shared government data centre.', value: 125000000, funding: 'Annual Development Programme', owner: 'u-sadia', section: 'IS', stage: 'Bid Preparation', tenderDate: '2026-09-15', awardBy: '2026-12-15', priority: 'High', contacts: ['c17', 'c18'], next: 'Complete OEM authorisation letters', due: '2026-10-05', created: '2026-03-18' }),
mk({ id: 'p13', name: 'Network Security Modernization', orgId: 'o6', department: 'IT Department', category: 'Cybersecurity', description: 'Next-generation firewalls, network access control and SIEM rollout.', value: 48000000, owner: 'u-imran', section: 'IS', stage: 'Tender Published', tenderDate: '2026-09-20', awardBy: '2026-12-10', priority: 'High', contacts: ['c11', 'c12'], next: 'Decide go/no-go on tender participation', due: '2026-10-03', created: '2026-07-22' }),
mk({ id: 'p14', name: 'Disaster Recovery Infrastructure', orgId: 'o8', department: 'Operations Directorate', category: 'Cloud & Infrastructure', description: 'Secondary DR site with replication for port operations systems.', value: 72000000, owner: 'u-sadia', section: 'IS', stage: 'Requirements Discussion', tenderDate: '2026-12-01', awardBy: '2027-03-15', priority: 'Medium', contacts: ['c15'], next: 'Submit DR site sizing note', due: '2026-10-10', created: '2026-08-04' }),
mk({ id: 'p15', name: 'Port Services Security Operations Centre', orgId: 'o8', department: 'IT Security Cell', category: 'Cybersecurity', description: '24x7 security monitoring centre with incident response playbooks.', value: 60000000, owner: 'u-farhan', section: 'IS', stage: 'Awarded', awardBy: '2026-08-31', priority: 'High', contacts: ['c15', 'c16'], awarded: 56500000, awardDate: '2026-08-14', closedAt: '2026-08-14', created: '2026-02-10' }),
mk({ id: 'p16', name: 'Utility SCADA Network Hardening', orgId: 'o6', department: 'Network Operations', category: 'Cybersecurity', description: 'Segmentation and hardening of operational technology networks.', value: 39000000, owner: 'u-sadia', section: 'IS', stage: 'Tender Published', tenderDate: '2026-09-01', awardBy: '2026-11-30', priority: 'Medium', contacts: ['c11'], next: 'Confirm with GM IT whether late submission is possible', due: '2026-10-01', created: '2026-06-02' }),
mk({ id: 'p17', name: 'City Wi-Fi & Edge Security', orgId: 'o7', department: 'ICT Cell', category: 'Cybersecurity', description: 'Public Wi-Fi with secure edge gateways across city hubs.', value: 29000000, owner: 'u-imran', section: 'IS', stage: 'Lost', awardBy: '2026-09-15', priority: 'Medium', contacts: ['c13'], lostReason: 'Technical score below qualifying threshold', closedAt: '2026-09-12', created: '2026-04-20' }),
mk({ id: 'p18', name: 'Riverbank Municipality Network Refresh', orgId: 'o10', department: 'IT Section', category: 'System Integration', description: 'LAN and Wi-Fi refresh across four municipal office buildings.', value: 19000000, owner: 'u-farhan', section: 'IS', stage: 'Identified', awardBy: '2027-05-31', priority: 'Low', contacts: ['c20'], next: 'Arrange site survey of municipal offices', due: '2026-10-14', created: '2026-09-22' }),
mk({ id: 'p19', name: 'Utility Billing System Integration', orgId: 'o5', department: 'IT Department', category: 'System Integration', description: 'Integration of billing with mobile financial service channels.', value: 21000000, owner: 'u-imran', section: 'IS', stage: 'Cancelled', priority: 'Low', contacts: ['c9'], statusNote: 'Procuring entity cancelled the requirement after internal restructuring.', closedAt: '2026-09-05', created: '2026-03-28' }),
mk({ id: 'p20', name: 'Records Agency Cloud Migration', orgId: 'o9', department: 'ICT Infrastructure Division', category: 'Cloud & Infrastructure', description: 'Migration of records systems to the government cloud platform.', value: 84000000, owner: 'u-sadia', section: 'IS', stage: 'Evaluation', tenderDate: '2026-08-10', awardBy: '2026-11-30', priority: 'High', contacts: ['c17', 'c18'], next: 'Provide clarification on licensing model', due: '2026-10-06', created: '2026-05-11' })];