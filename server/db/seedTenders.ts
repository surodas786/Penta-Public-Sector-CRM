/**
 * Synthetic tender cycles, converted from the approved demo's fixtures
 * (Milestone 5). Every notice is fictional; notice URLs use the reserved
 * example.com domain.
 *
 * Conversion notes:
 *
 *  - The demo's free-text procuring entity is the organization record of the
 *    same name, which in every fixture is also the opportunity's organization.
 *  - The demo recorded a submission date only. Production stores a time
 *    (FR-051), so each becomes 16:00 Bangladesh time on that date, which in
 *    every fixture is before the recorded deadline.
 *  - The demo's per-tender owner is not carried over: the responsible owner is
 *    always the opportunity's current owner (§7.1), and in every fixture the
 *    two were already the same person.
 *  - Each demo opportunity had one notice, so each fixture is the current one.
 *  - The demo's placeholder documents are not seeded. They were text stand-ins
 *    held in browser storage; production files come only through the upload
 *    path, with validation and scanning.
 */
import type { BidStatus } from '../../shared/enums.js';

export interface SeedTender {
  legacyId: string;
  opportunityLegacyId: string;
  procuringOrganizationLegacyId: string;
  title: string;
  reference: string;
  procurementMethod: string;
  noticeUrl: string | null;
  publicationDate: string;
  clarificationDeadline: string | null;
  submissionDeadline: string;
  bidStatus: BidStatus;
  submittedAt: string | null;
  notes: string;
}

export const seedTenders: SeedTender[] = [
  {
    legacyId: 't1',
    opportunityLegacyId: 'p2',
    procuringOrganizationLegacyId: 'o4',
    title: 'Supply, Installation and Commissioning of ERP for Public Training Institutes',
    reference: 'DPTI/ICT/2026/014',
    procurementMethod: 'Open Tendering Method (OTM)',
    noticeUrl: 'https://tenders.example.com/notice/DPTI-2026-014',
    publicationDate: '2026-09-10',
    clarificationDeadline: '2026-09-24T17:00:00+06:00',
    submissionDeadline: '2026-10-04T12:00:00+06:00',
    bidStatus: 'preparing',
    submittedAt: null,
    notes: 'Bid security of 2% required. Payroll partner letter pending.',
  },
  {
    legacyId: 't2',
    opportunityLegacyId: 'p3',
    procuringOrganizationLegacyId: 'o2',
    title: 'Design and Development of Civic Records Document Management System',
    reference: 'DCR/PROC/2026/221',
    procurementMethod: 'Request for Proposal (RFP)',
    noticeUrl: null,
    publicationDate: '2026-09-22',
    clarificationDeadline: '2026-10-01T17:00:00+06:00',
    submissionDeadline: '2026-10-08T15:00:00+06:00',
    bidStatus: 'reviewing',
    submittedAt: null,
    notes: 'Quality and cost based selection (70:30).',
  },
  {
    legacyId: 't3',
    opportunityLegacyId: 'p8',
    procuringOrganizationLegacyId: 'o4',
    title: 'Development of eLearning Portal for Training Institutes',
    reference: 'DPTI/ICT/2026/009',
    procurementMethod: 'Open Tendering Method (OTM)',
    noticeUrl: 'https://tenders.example.com/notice/DPTI-2026-009',
    publicationDate: '2026-08-28',
    clarificationDeadline: null,
    submissionDeadline: '2026-09-24T12:00:00+06:00',
    bidStatus: 'submitted',
    submittedAt: '2026-09-23T16:00:00+06:00',
    notes: 'Submitted one day early.',
  },
  {
    legacyId: 't4',
    opportunityLegacyId: 'p10',
    procuringOrganizationLegacyId: 'o1',
    title: 'Public Service Analytics and Reporting Platform',
    reference: 'MPSI/ME/2026/031',
    procurementMethod: 'Two-Stage Tendering',
    noticeUrl: 'https://tenders.example.com/notice/MPSI-2026-031',
    publicationDate: '2026-07-30',
    clarificationDeadline: '2026-08-20T17:00:00+06:00',
    submissionDeadline: '2026-09-10T14:00:00+06:00',
    bidStatus: 'submitted',
    submittedAt: '2026-09-09T16:00:00+06:00',
    notes: 'Technical presentation expected during evaluation.',
  },
  {
    legacyId: 't5',
    opportunityLegacyId: 'p12',
    procuringOrganizationLegacyId: 'o9',
    title: 'Upgrade of National Data Centre Compute and Storage',
    reference: 'NDRA/ICT/2026/005',
    procurementMethod: 'Open Tendering Method (OTM)',
    noticeUrl: 'https://tenders.example.com/notice/NDRA-2026-005',
    publicationDate: '2026-09-15',
    clarificationDeadline: '2026-09-28T17:00:00+06:00',
    submissionDeadline: '2026-10-07T13:00:00+06:00',
    bidStatus: 'preparing',
    submittedAt: null,
    notes: 'OEM authorisation required for all major components.',
  },
  {
    legacyId: 't6',
    opportunityLegacyId: 'p13',
    procuringOrganizationLegacyId: 'o6',
    title: 'Network Security Modernization — Firewalls, NAC and SIEM',
    reference: 'PPDC/IT/2026/118',
    procurementMethod: 'Open Tendering Method (OTM)',
    noticeUrl: null,
    publicationDate: '2026-09-20',
    clarificationDeadline: null,
    submissionDeadline: '2026-10-05T15:00:00+06:00',
    bidStatus: 'reviewing',
    submittedAt: null,
    notes: 'Go/no-go decision pending.',
  },
  {
    legacyId: 't7',
    opportunityLegacyId: 'p16',
    procuringOrganizationLegacyId: 'o6',
    title: 'SCADA Network Hardening and Segmentation',
    reference: 'PPDC/IT/2026/097',
    procurementMethod: 'Limited Tendering Method (LTM)',
    noticeUrl: 'https://tenders.example.com/notice/PPDC-2026-097',
    publicationDate: '2026-09-01',
    clarificationDeadline: '2026-09-15T17:00:00+06:00',
    submissionDeadline: '2026-09-29T17:00:00+06:00',
    bidStatus: 'preparing',
    submittedAt: null,
    notes: 'OEM letter was not received in time.',
  },
  {
    legacyId: 't8',
    opportunityLegacyId: 'p20',
    procuringOrganizationLegacyId: 'o9',
    title: 'Migration of Records Systems to Government Cloud',
    reference: 'NDRA/ICT/2026/003',
    procurementMethod: 'Limited Tendering Method (LTM)',
    noticeUrl: null,
    publicationDate: '2026-08-10',
    clarificationDeadline: null,
    submissionDeadline: '2026-09-15T12:00:00+06:00',
    bidStatus: 'submitted',
    submittedAt: '2026-09-14T16:00:00+06:00',
    notes: 'Under evaluation.',
  },
];
