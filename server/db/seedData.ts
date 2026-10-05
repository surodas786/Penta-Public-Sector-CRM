/**
 * Synthetic fixtures converted from the approved MagicPatterns demo.
 *
 * Every person, organization and project here is fictional. None represents a
 * real Penta contract or an actual government procurement. This module is
 * imported only by the seed script, never by the running server.
 *
 * Conversion notes (plan section 5):
 *
 *  - Legacy string ids ('p1', 'o7', 'u-rafiq') are mapped to deterministic
 *    UUIDs by `legacyUuid`, so relationships stay consistent across reseeds and
 *    tests can address a known record.
 *  - The demo put On Hold and Cancelled in the stage dropdown. Here they become
 *    `status`, and the stage they are paired with is the record's prior
 *    pipeline stage. Two fixtures carried no prior stage; their mapping is
 *    marked `syntheticStageMapping` below and is synthetic-only — it must never
 *    be applied to live data without a separately reviewed migration.
 *  - The demo's separate next-action text becomes the opportunity's first open
 *    follow-up, which is the single source of truth for "next action" (BR-013,
 *    D-003). No distinct action was dropped.
 */
import { createHash } from 'node:crypto';

import type {
  OpportunityStage,
  OpportunityStatus,
  OrganizationType,
  Priority,
  SolutionCategory,
  UserRole,
} from '../../shared/enums.js';

/**
 * Deterministic UUIDv5-style identifier derived from a legacy demo id.
 * Same input always yields the same UUID, so seeds are reproducible.
 */
export function legacyUuid(legacyId: string): string {
  const digest = createHash('sha1').update(`penta-crm-synthetic:${legacyId}`).digest();
  const bytes = Uint8Array.prototype.slice.call(digest, 0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface SeedSection {
  legacyId: string;
  name: string;
  leadLegacyId: string;
  active: boolean;
}

export const seedSections: SeedSection[] = [
  { legacyId: 'GA', name: 'Government Applications', leadLegacyId: 'u-nadia', active: true },
  { legacyId: 'IS', name: 'Infrastructure & Security', leadLegacyId: 'u-farhan', active: true },
];

export interface SeedUser {
  legacyId: string;
  fullName: string;
  email: string;
  role: UserRole;
  sectionLegacyId: string | null;
  managerLegacyId: string | null;
  active: boolean;
  /** Explains a fixture that exists to exercise a specific scope rule. */
  note?: string;
}

export const seedUsers: SeedUser[] = [
  {
    legacyId: 'u-arif',
    fullName: 'Arif Rahman',
    email: 'arif.rahman@example.com',
    role: 'management',
    sectionLegacyId: null,
    managerLegacyId: null,
    active: true,
  },
  {
    legacyId: 'u-nadia',
    fullName: 'Nadia Islam',
    email: 'nadia.islam@example.com',
    role: 'lead',
    sectionLegacyId: 'GA',
    managerLegacyId: 'u-arif',
    active: true,
  },
  {
    legacyId: 'u-farhan',
    fullName: 'Farhan Ahmed',
    email: 'farhan.ahmed@example.com',
    role: 'lead',
    sectionLegacyId: 'IS',
    managerLegacyId: 'u-arif',
    active: true,
  },
  {
    legacyId: 'u-rafiq',
    fullName: 'Rafiq Hasan',
    email: 'rafiq.hasan@example.com',
    role: 'sales',
    sectionLegacyId: 'GA',
    managerLegacyId: 'u-nadia',
    active: true,
  },
  {
    legacyId: 'u-tasnia',
    fullName: 'Tasnia Karim',
    email: 'tasnia.karim@example.com',
    role: 'sales',
    sectionLegacyId: 'GA',
    managerLegacyId: 'u-nadia',
    active: true,
  },
  {
    legacyId: 'u-imran',
    fullName: 'Imran Hossain',
    email: 'imran.hossain@example.com',
    role: 'sales',
    sectionLegacyId: 'IS',
    managerLegacyId: 'u-farhan',
    active: true,
  },
  {
    legacyId: 'u-sadia',
    fullName: 'Sadia Akter',
    email: 'sadia.akter@example.com',
    role: 'sales',
    sectionLegacyId: 'IS',
    managerLegacyId: 'u-farhan',
    active: true,
  },
  {
    legacyId: 'u-admin',
    fullName: 'Shahana Ferdous',
    email: 'admin@example.com',
    role: 'admin',
    sectionLegacyId: null,
    managerLegacyId: null,
    active: true,
  },
  // --- Scope fixtures ------------------------------------------------------
  // Plan 7.6 scenario 9: a lead's section scope must still include records
  // whose owner is deactivated, or whose owner has no manager_id. These two
  // accounts exist to prove that. They are historical shapes only and do NOT
  // legitimise creating malformed accounts through the administration screens.
  {
    legacyId: 'u-shuvo',
    fullName: 'Shuvo Barua',
    email: 'shuvo.barua@example.com',
    role: 'sales',
    sectionLegacyId: 'GA',
    managerLegacyId: 'u-nadia',
    active: false,
    note: 'Deactivated historical owner; owns a closed Government Applications record.',
  },
  {
    legacyId: 'u-mehjabin',
    fullName: 'Mehjabin Chowdhury',
    email: 'mehjabin.chowdhury@example.com',
    role: 'sales',
    sectionLegacyId: 'GA',
    managerLegacyId: null,
    active: true,
    note: 'Section member with no recorded reporting line; still inside the lead’s section scope.',
  },
];

export interface SeedOrganization {
  legacyId: string;
  name: string;
  type: OrganizationType;
  parentLegacyId: string | null;
  location: string;
  website: string | null;
  basicNotes: string | null;
}

export const seedOrganizations: SeedOrganization[] = [
  {
    legacyId: 'o1',
    name: 'Ministry of Public Service Innovation',
    type: 'ministry',
    parentLegacyId: null,
    location: 'Dhaka',
    website: 'https://mpsi.example.com',
    basicNotes: 'Synthetic organization. Leads cross-government service digitisation programmes.',
  },
  {
    legacyId: 'o2',
    name: 'Department of Civic Records',
    type: 'department',
    parentLegacyId: 'o1',
    location: 'Dhaka',
    website: 'https://civicrecords.example.com',
    basicNotes: 'Synthetic organization. Custodian of civic registration records.',
  },
  {
    legacyId: 'o3',
    name: 'Ministry of Skills & Vocational Training',
    type: 'ministry',
    parentLegacyId: null,
    location: 'Dhaka',
    website: 'https://skills.example.com',
    basicNotes: 'Synthetic organization.',
  },
  {
    legacyId: 'o4',
    name: 'Directorate of Public Training Institutes',
    type: 'directorate',
    parentLegacyId: 'o3',
    location: 'Gazipur',
    website: 'https://dpti.example.com',
    basicNotes: 'Synthetic organization. Oversees 14 public training institutes.',
  },
  {
    legacyId: 'o5',
    name: 'Meghna Regional Utility Authority',
    type: 'authority',
    parentLegacyId: null,
    location: 'Narayanganj',
    website: 'https://mrua.example.com',
    basicNotes: 'Synthetic organization. Regional water and utility services.',
  },
  {
    legacyId: 'o6',
    name: 'Padma Power Distribution Corporation',
    type: 'public_corporation',
    parentLegacyId: null,
    location: 'Rajshahi',
    website: 'https://ppdc.example.com',
    basicNotes: 'Synthetic organization.',
  },
  {
    legacyId: 'o7',
    name: 'Sylvan Hills City Corporation',
    type: 'local_government',
    parentLegacyId: null,
    location: 'Sylhet',
    website: 'https://sylvanhills.example.com',
    basicNotes: 'Synthetic organization.',
  },
  {
    legacyId: 'o8',
    name: 'Karnaphuli Port Services Authority',
    type: 'authority',
    parentLegacyId: null,
    location: 'Chattogram',
    website: null,
    basicNotes: 'Synthetic organization.',
  },
  {
    legacyId: 'o9',
    name: 'National Data & Records Agency',
    type: 'other',
    parentLegacyId: null,
    location: 'Dhaka',
    website: 'https://ndra.example.com',
    basicNotes: 'Synthetic organization. Operates shared government data centre services.',
  },
  {
    legacyId: 'o10',
    name: 'Riverbank Municipality',
    type: 'local_government',
    parentLegacyId: null,
    location: 'Khulna',
    website: null,
    basicNotes: 'Synthetic organization.',
  },
  {
    legacyId: 'o11',
    // Exercises Unicode/Bangla storage and search (plan 7.6 scenario 22).
    name: 'পল্লী উন্নয়ন অধিদপ্তর (Rural Development Directorate)',
    type: 'directorate',
    parentLegacyId: null,
    location: 'ঢাকা',
    website: null,
    basicNotes: 'Synthetic organization. Present to exercise Bangla storage and search.',
  },
];

export interface SeedOpportunity {
  legacyId: string;
  name: string;
  organizationLegacyId: string;
  department: string;
  solutionCategory: SolutionCategory;
  description: string;
  /** Decimal string — never a float. */
  estimatedValue: string;
  fundingSource?: string;
  ownerLegacyId: string;
  sectionLegacyId: string;
  stage: OpportunityStage;
  status: OpportunityStatus;
  priority: Priority;
  createdOn: string;
  expectedPublicationDate?: string;
  expectedAwardDate?: string;
  /** Becomes the single open follow-up; absent for terminal records. */
  nextAction?: { title: string; dueDate: string };
  awardedValue?: string;
  awardDate?: string;
  lossReason?: string;
  closedDate?: string;
  statusNote?: string;
  /**
   * True where the demo recorded only "On Hold"/"Cancelled" and the prior
   * pipeline stage had to be chosen for this synthetic record.
   */
  syntheticStageMapping?: string;
}

export const seedOpportunities: SeedOpportunity[] = [
  {
    legacyId: 'p1',
    name: 'Municipal Service Portal',
    organizationLegacyId: 'o7',
    department: 'ICT Cell, Office of the Chief Executive',
    solutionCategory: 'custom_software',
    description:
      'Unified online portal for trade licences, holding tax and birth registration requests.',
    estimatedValue: '42000000.00',
    fundingSource: 'City Corporation development budget',
    ownerLegacyId: 'u-rafiq',
    sectionLegacyId: 'GA',
    stage: 'requirements_discussion',
    status: 'active',
    priority: 'high',
    createdOn: '2026-07-08',
    expectedPublicationDate: '2026-11-15',
    expectedAwardDate: '2027-02-28',
    nextAction: { title: 'Send revised scope to Sylvan Hills ICT Cell', dueDate: '2026-09-30' },
  },
  {
    legacyId: 'p2',
    name: 'Public Training Institute ERP',
    organizationLegacyId: 'o4',
    department: 'Planning & Development Wing',
    solutionCategory: 'erp',
    description:
      'Integrated ERP covering trainee admissions, finance, HR and asset management for 14 training institutes.',
    estimatedValue: '68000000.00',
    fundingSource: 'Government revenue budget (FY 2026–27)',
    ownerLegacyId: 'u-tasnia',
    sectionLegacyId: 'GA',
    stage: 'bid_preparation',
    status: 'active',
    priority: 'high',
    createdOn: '2026-05-20',
    expectedPublicationDate: '2026-09-10',
    expectedAwardDate: '2026-12-20',
    nextAction: {
      title: 'Finalise financial proposal and obtain bid security',
      dueDate: '2026-10-03',
    },
  },
  {
    legacyId: 'p3',
    name: 'Agency Document Management System',
    organizationLegacyId: 'o2',
    department: 'Records Management Division',
    solutionCategory: 'custom_software',
    description:
      'Digitise and index civic records with workflow-based approvals and retention rules.',
    estimatedValue: '31000000.00',
    ownerLegacyId: 'u-rafiq',
    sectionLegacyId: 'GA',
    stage: 'tender_published',
    status: 'active',
    priority: 'medium',
    createdOn: '2026-06-12',
    expectedPublicationDate: '2026-09-22',
    expectedAwardDate: '2026-12-31',
    nextAction: { title: 'Review RFP and submit clarification questions', dueDate: '2026-10-04' },
  },
  {
    legacyId: 'p4',
    name: 'Citizen Service Application',
    organizationLegacyId: 'o1',
    department: 'Service Innovation Unit',
    solutionCategory: 'custom_software',
    description:
      'Mobile and web application for citizens to track public service requests across field offices.',
    estimatedValue: '24000000.00',
    fundingSource: 'Development partner grant (indicative)',
    ownerLegacyId: 'u-tasnia',
    sectionLegacyId: 'GA',
    stage: 'identified',
    status: 'active',
    priority: 'medium',
    createdOn: '2026-09-18',
    expectedAwardDate: '2027-06-30',
    nextAction: {
      title: 'Request introductory meeting with Joint Secretary (ICT)',
      dueDate: '2026-10-06',
    },
  },
  {
    legacyId: 'p5',
    name: 'Riverbank e-Services Portal',
    organizationLegacyId: 'o10',
    department: "Mayor's Office",
    solutionCategory: 'custom_software',
    description: 'Online municipal services for permits, complaints and fee payments.',
    estimatedValue: '26000000.00',
    ownerLegacyId: 'u-rafiq',
    sectionLegacyId: 'GA',
    stage: 'awarded',
    status: 'active',
    priority: 'medium',
    createdOn: '2026-03-14',
    expectedAwardDate: '2026-10-15',
    awardedValue: '23500000.00',
    awardDate: '2026-10-01',
    closedDate: '2026-10-01',
  },
  {
    legacyId: 'p6',
    name: 'Skills Grants Management System',
    organizationLegacyId: 'o3',
    department: 'Grants & Scholarships Wing',
    solutionCategory: 'custom_software',
    description: 'Grant application, scoring and disbursement tracking for vocational scholarships.',
    estimatedValue: '18000000.00',
    ownerLegacyId: 'u-tasnia',
    sectionLegacyId: 'GA',
    stage: 'lost',
    status: 'active',
    priority: 'medium',
    createdOn: '2026-03-02',
    expectedAwardDate: '2026-08-31',
    lossReason: 'price',
    closedDate: '2026-08-26',
  },
  {
    legacyId: 'p7',
    name: 'Records Agency Archive Search Platform',
    organizationLegacyId: 'o9',
    department: 'Digital Archives Directorate',
    solutionCategory: 'data_platform_analytics',
    description: 'Full-text search and metadata catalogue across digitised archive collections.',
    estimatedValue: '16000000.00',
    ownerLegacyId: 'u-nadia',
    sectionLegacyId: 'GA',
    stage: 'initial_engagement',
    status: 'active',
    priority: 'medium',
    createdOn: '2026-08-25',
    expectedAwardDate: '2027-03-31',
    nextAction: { title: 'Share capability brief with Director General', dueDate: '2026-10-02' },
  },
  {
    legacyId: 'p8',
    name: 'Training Institute Learning Portal',
    organizationLegacyId: 'o4',
    department: 'eLearning Cell',
    solutionCategory: 'custom_software',
    description: 'Blended learning portal with course authoring and assessment for trainees.',
    estimatedValue: '22000000.00',
    ownerLegacyId: 'u-rafiq',
    sectionLegacyId: 'GA',
    stage: 'bid_submitted',
    status: 'active',
    priority: 'medium',
    createdOn: '2026-06-30',
    expectedPublicationDate: '2026-08-28',
    expectedAwardDate: '2026-11-10',
    nextAction: { title: 'Respond to evaluation committee queries', dueDate: '2026-10-09' },
  },
  {
    legacyId: 'p9',
    name: 'Civic Grievance Mobile App',
    organizationLegacyId: 'o1',
    department: 'Service Innovation Unit',
    solutionCategory: 'custom_software',
    description: 'Grievance submission and tracking app with field-office routing.',
    estimatedValue: '14500000.00',
    ownerLegacyId: 'u-tasnia',
    sectionLegacyId: 'GA',
    stage: 'requirements_discussion',
    status: 'on_hold',
    priority: 'low',
    createdOn: '2026-04-14',
    nextAction: { title: 'Check status of budget revision', dueDate: '2026-11-03' },
    statusNote: 'Ministry budget review pending; revisit after mid-year revision.',
    syntheticStageMapping:
      'Demo recorded only "On Hold". Prior stage set to Requirements Discussion for this synthetic record.',
  },
  {
    legacyId: 'p10',
    name: 'Public Service Analytics Dashboard',
    organizationLegacyId: 'o1',
    department: 'Monitoring & Evaluation Wing',
    solutionCategory: 'data_platform_analytics',
    description: 'Performance dashboards on service delivery KPIs across ministries.',
    estimatedValue: '34000000.00',
    ownerLegacyId: 'u-nadia',
    sectionLegacyId: 'GA',
    stage: 'evaluation',
    status: 'active',
    priority: 'high',
    createdOn: '2026-04-02',
    expectedPublicationDate: '2026-07-30',
    expectedAwardDate: '2026-10-25',
    nextAction: {
      title: 'Prepare technical presentation for evaluation committee',
      dueDate: '2026-10-07',
    },
  },
  {
    legacyId: 'p21',
    name: 'Vocational Certification Management System',
    organizationLegacyId: 'o3',
    department: 'Planning Wing',
    solutionCategory: 'custom_software',
    description: 'Certificate issuance, verification and QR validation for vocational graduates.',
    estimatedValue: '21500000.00',
    ownerLegacyId: 'u-rafiq',
    sectionLegacyId: 'GA',
    stage: 'awaiting_tender',
    status: 'active',
    priority: 'medium',
    createdOn: '2026-07-01',
    expectedPublicationDate: '2026-10-25',
    expectedAwardDate: '2027-01-15',
    nextAction: {
      title: 'Confirm tender publication timeline with planning officer',
      dueDate: '2026-10-12',
    },
  },
  // --- Scope fixtures in Government Applications ---------------------------
  {
    legacyId: 'p22',
    name: 'Civic Records Retention Automation',
    organizationLegacyId: 'o2',
    department: 'Records Management Division',
    solutionCategory: 'custom_software',
    description:
      'Retention-schedule automation. Owned by a deactivated account; still inside the section lead’s scope.',
    estimatedValue: '12500000.00',
    ownerLegacyId: 'u-shuvo',
    sectionLegacyId: 'GA',
    stage: 'awarded',
    status: 'active',
    priority: 'low',
    createdOn: '2026-02-18',
    awardedValue: '11800000.00',
    awardDate: '2026-06-30',
    closedDate: '2026-06-30',
  },
  {
    legacyId: 'p23',
    name: 'পল্লী উন্নয়ন তথ্য ব্যবস্থাপনা (Rural Development MIS)',
    organizationLegacyId: 'o11',
    department: 'পরিকল্পনা শাখা',
    solutionCategory: 'custom_software',
    description:
      'Bangla-language management information system. Owner has no recorded reporting line.',
    estimatedValue: '17250000.50',
    ownerLegacyId: 'u-mehjabin',
    sectionLegacyId: 'GA',
    stage: 'initial_engagement',
    status: 'active',
    priority: 'medium',
    createdOn: '2026-08-11',
    expectedAwardDate: '2027-04-30',
    nextAction: { title: 'উপজেলা পর্যায়ের চাহিদা যাচাই করুন', dueDate: '2026-10-20' },
  },
  // --- Infrastructure & Security -------------------------------------------
  {
    legacyId: 'p11',
    name: 'Regional Utility Data Platform',
    organizationLegacyId: 'o5',
    department: 'Planning & Monitoring Department',
    solutionCategory: 'data_platform_analytics',
    description: 'Consolidated meter, billing and network data with reporting across six zones.',
    estimatedValue: '55000000.00',
    fundingSource: 'Development partner loan (indicative)',
    ownerLegacyId: 'u-imran',
    sectionLegacyId: 'IS',
    stage: 'awaiting_tender',
    status: 'active',
    priority: 'high',
    createdOn: '2026-05-05',
    expectedPublicationDate: '2026-10-20',
    expectedAwardDate: '2027-01-31',
    nextAction: { title: 'Follow up on procurement committee feedback', dueDate: '2026-09-29' },
  },
  {
    legacyId: 'p12',
    name: 'Government Data Center Upgrade',
    organizationLegacyId: 'o9',
    department: 'ICT Infrastructure Division',
    solutionCategory: 'cloud_infrastructure',
    description:
      'Compute, storage and virtualisation refresh for the shared government data centre.',
    estimatedValue: '125000000.00',
    fundingSource: 'Annual Development Programme',
    ownerLegacyId: 'u-sadia',
    sectionLegacyId: 'IS',
    stage: 'bid_preparation',
    status: 'active',
    priority: 'high',
    createdOn: '2026-03-18',
    expectedPublicationDate: '2026-09-15',
    expectedAwardDate: '2026-12-15',
    nextAction: { title: 'Complete OEM authorisation letters', dueDate: '2026-10-05' },
  },
  {
    legacyId: 'p13',
    name: 'Network Security Modernization',
    organizationLegacyId: 'o6',
    department: 'IT Department',
    solutionCategory: 'cybersecurity',
    description: 'Next-generation firewalls, network access control and SIEM rollout.',
    estimatedValue: '48000000.00',
    ownerLegacyId: 'u-imran',
    sectionLegacyId: 'IS',
    stage: 'tender_published',
    status: 'active',
    priority: 'high',
    createdOn: '2026-07-22',
    expectedPublicationDate: '2026-09-20',
    expectedAwardDate: '2026-12-10',
    nextAction: { title: 'Decide go/no-go on tender participation', dueDate: '2026-10-03' },
  },
  {
    legacyId: 'p14',
    name: 'Disaster Recovery Infrastructure',
    organizationLegacyId: 'o8',
    department: 'Operations Directorate',
    solutionCategory: 'cloud_infrastructure',
    description: 'Secondary DR site with replication for port operations systems.',
    estimatedValue: '72000000.00',
    ownerLegacyId: 'u-sadia',
    sectionLegacyId: 'IS',
    stage: 'requirements_discussion',
    status: 'active',
    priority: 'medium',
    createdOn: '2026-08-04',
    expectedPublicationDate: '2026-12-01',
    expectedAwardDate: '2027-03-15',
    nextAction: { title: 'Submit DR site sizing note', dueDate: '2026-10-10' },
  },
  {
    legacyId: 'p15',
    name: 'Port Services Security Operations Centre',
    organizationLegacyId: 'o8',
    department: 'IT Security Cell',
    solutionCategory: 'cybersecurity',
    description: '24x7 security monitoring centre with incident response playbooks.',
    estimatedValue: '60000000.00',
    ownerLegacyId: 'u-farhan',
    sectionLegacyId: 'IS',
    stage: 'awarded',
    status: 'active',
    priority: 'high',
    createdOn: '2026-02-10',
    expectedAwardDate: '2026-08-31',
    awardedValue: '56500000.00',
    awardDate: '2026-08-14',
    closedDate: '2026-08-14',
  },
  {
    legacyId: 'p16',
    name: 'Utility SCADA Network Hardening',
    organizationLegacyId: 'o6',
    department: 'Network Operations',
    solutionCategory: 'cybersecurity',
    description: 'Segmentation and hardening of operational technology networks.',
    estimatedValue: '39000000.00',
    ownerLegacyId: 'u-sadia',
    sectionLegacyId: 'IS',
    stage: 'tender_published',
    status: 'active',
    priority: 'medium',
    createdOn: '2026-06-02',
    expectedPublicationDate: '2026-09-01',
    expectedAwardDate: '2026-11-30',
    nextAction: {
      title: 'Confirm with GM IT whether late submission is possible',
      dueDate: '2026-10-01',
    },
  },
  {
    legacyId: 'p17',
    name: 'City Wi-Fi & Edge Security',
    organizationLegacyId: 'o7',
    department: 'ICT Cell',
    solutionCategory: 'cybersecurity',
    description: 'Public Wi-Fi with secure edge gateways across city hubs.',
    estimatedValue: '29000000.00',
    ownerLegacyId: 'u-imran',
    sectionLegacyId: 'IS',
    stage: 'lost',
    status: 'active',
    priority: 'medium',
    createdOn: '2026-04-20',
    expectedAwardDate: '2026-09-15',
    lossReason: 'technical_eligibility',
    closedDate: '2026-09-12',
  },
  {
    legacyId: 'p18',
    name: 'Riverbank Municipality Network Refresh',
    organizationLegacyId: 'o10',
    department: 'IT Section',
    solutionCategory: 'system_integration',
    description: 'LAN and Wi-Fi refresh across four municipal office buildings.',
    estimatedValue: '19000000.00',
    ownerLegacyId: 'u-farhan',
    sectionLegacyId: 'IS',
    stage: 'identified',
    status: 'active',
    priority: 'low',
    createdOn: '2026-09-22',
    expectedAwardDate: '2027-05-31',
    nextAction: { title: 'Arrange site survey of municipal offices', dueDate: '2026-10-14' },
  },
  {
    legacyId: 'p19',
    name: 'Utility Billing System Integration',
    organizationLegacyId: 'o5',
    department: 'IT Department',
    solutionCategory: 'system_integration',
    description: 'Integration of billing with mobile financial service channels.',
    estimatedValue: '21000000.00',
    ownerLegacyId: 'u-imran',
    sectionLegacyId: 'IS',
    stage: 'awaiting_tender',
    status: 'cancelled',
    priority: 'low',
    createdOn: '2026-03-28',
    statusNote: 'Procuring entity cancelled the requirement after internal restructuring.',
    closedDate: '2026-09-05',
    syntheticStageMapping:
      'Demo recorded only "Cancelled". Prior stage set to Awaiting Tender for this synthetic record.',
  },
  {
    legacyId: 'p20',
    name: 'Records Agency Cloud Migration',
    organizationLegacyId: 'o9',
    department: 'ICT Infrastructure Division',
    solutionCategory: 'cloud_infrastructure',
    description: 'Migration of records systems to the government cloud platform.',
    estimatedValue: '84000000.00',
    ownerLegacyId: 'u-sadia',
    sectionLegacyId: 'IS',
    stage: 'evaluation',
    status: 'active',
    priority: 'high',
    createdOn: '2026-05-11',
    expectedPublicationDate: '2026-08-10',
    expectedAwardDate: '2026-11-30',
    nextAction: { title: 'Provide clarification on licensing model', dueDate: '2026-10-06' },
  },
];
