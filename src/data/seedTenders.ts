import type { DocCategory, DocumentRecord, Tender } from '../types/crm';

// Synthetic tender records. Notice URLs use the reserved example.com domain; no live e-GP integration.
export const seedTenders: Tender[] = [
{ id: 't1', oppId: 'p2', title: 'Supply, Installation and Commissioning of ERP for Public Training Institutes', reference: 'DPTI/ICT/2026/014', procuringEntity: 'Directorate of Public Training Institutes', method: 'Open Tendering Method (OTM)', noticeUrl: 'https://tenders.example.com/notice/DPTI-2026-014', publicationDate: '2026-09-10', clarificationDeadline: '2026-09-24', submissionDeadline: '2026-10-04T12:00:00+06:00', bidStatus: 'Preparing', submissionDate: '', ownerId: 'u-tasnia', notes: 'Bid security of 2% required. Payroll partner letter pending.' },
{ id: 't2', oppId: 'p3', title: 'Design and Development of Civic Records Document Management System', reference: 'DCR/PROC/2026/221', procuringEntity: 'Department of Civic Records', method: 'Request for Proposal (RFP)', noticeUrl: '', publicationDate: '2026-09-22', clarificationDeadline: '2026-10-01', submissionDeadline: '2026-10-08T15:00:00+06:00', bidStatus: 'Reviewing', submissionDate: '', ownerId: 'u-rafiq', notes: 'Quality and cost based selection (70:30).' },
{ id: 't3', oppId: 'p8', title: 'Development of eLearning Portal for Training Institutes', reference: 'DPTI/ICT/2026/009', procuringEntity: 'Directorate of Public Training Institutes', method: 'Open Tendering Method (OTM)', noticeUrl: 'https://tenders.example.com/notice/DPTI-2026-009', publicationDate: '2026-08-28', clarificationDeadline: '', submissionDeadline: '2026-09-24T12:00:00+06:00', bidStatus: 'Submitted', submissionDate: '2026-09-23', ownerId: 'u-rafiq', notes: 'Submitted one day early.' },
{ id: 't4', oppId: 'p10', title: 'Public Service Analytics and Reporting Platform', reference: 'MPSI/ME/2026/031', procuringEntity: 'Ministry of Public Service Innovation', method: 'Two-Stage Tendering', noticeUrl: 'https://tenders.example.com/notice/MPSI-2026-031', publicationDate: '2026-07-30', clarificationDeadline: '2026-08-20', submissionDeadline: '2026-09-10T14:00:00+06:00', bidStatus: 'Submitted', submissionDate: '2026-09-09', ownerId: 'u-nadia', notes: 'Technical presentation expected during evaluation.' },
{ id: 't5', oppId: 'p12', title: 'Upgrade of National Data Centre Compute and Storage', reference: 'NDRA/ICT/2026/005', procuringEntity: 'National Data & Records Agency', method: 'Open Tendering Method (OTM)', noticeUrl: 'https://tenders.example.com/notice/NDRA-2026-005', publicationDate: '2026-09-15', clarificationDeadline: '2026-09-28', submissionDeadline: '2026-10-07T13:00:00+06:00', bidStatus: 'Preparing', submissionDate: '', ownerId: 'u-sadia', notes: 'OEM authorisation required for all major components.' },
{ id: 't6', oppId: 'p13', title: 'Network Security Modernization — Firewalls, NAC and SIEM', reference: 'PPDC/IT/2026/118', procuringEntity: 'Padma Power Distribution Corporation', method: 'Open Tendering Method (OTM)', noticeUrl: '', publicationDate: '2026-09-20', clarificationDeadline: '', submissionDeadline: '2026-10-05T15:00:00+06:00', bidStatus: 'Reviewing', submissionDate: '', ownerId: 'u-imran', notes: 'Go/no-go decision pending.' },
{ id: 't7', oppId: 'p16', title: 'SCADA Network Hardening and Segmentation', reference: 'PPDC/IT/2026/097', procuringEntity: 'Padma Power Distribution Corporation', method: 'Limited Tendering Method (LTM)', noticeUrl: 'https://tenders.example.com/notice/PPDC-2026-097', publicationDate: '2026-09-01', clarificationDeadline: '2026-09-15', submissionDeadline: '2026-09-29T17:00:00+06:00', bidStatus: 'Preparing', submissionDate: '', ownerId: 'u-sadia', notes: 'OEM letter was not received in time.' },
{ id: 't8', oppId: 'p20', title: 'Migration of Records Systems to Government Cloud', reference: 'NDRA/ICT/2026/003', procuringEntity: 'National Data & Records Agency', method: 'Limited Tendering Method (LTM)', noticeUrl: '', publicationDate: '2026-08-10', clarificationDeadline: '', submissionDeadline: '2026-09-15T12:00:00+06:00', bidStatus: 'Submitted', submissionDate: '2026-09-14', ownerId: 'u-sadia', notes: 'Under evaluation.' }];


type DocRow = [string, string, DocCategory, string, string, number];

const docRows: DocRow[] = [
['p2', 'DPTI_ERP_Tender_Document.pdf', 'Tender document', 'u-tasnia', '2026-09-11T11:20:00+06:00', 1843200],
['p2', 'ERP_Functional_Requirements_v2.docx', 'Requirements', 'u-tasnia', '2026-08-02T15:05:00+06:00', 412000],
['p1', 'Sylvan_Hills_Workshop_Notes.docx', 'Meeting notes', 'u-rafiq', '2026-09-17T17:40:00+06:00', 96000],
['p3', 'DCR_RFP_Document.pdf', 'Tender document', 'u-rafiq', '2026-09-23T10:30:00+06:00', 2210000],
['p8', 'Learning_Portal_Technical_Proposal.pdf', 'Proposal', 'u-rafiq', '2026-09-22T18:10:00+06:00', 3150000],
['p10', 'Analytics_Dashboard_Proposal.pdf', 'Proposal', 'u-nadia', '2026-09-08T16:00:00+06:00', 2740000],
['p12', 'Data_Centre_BoQ_Draft.xlsx', 'Requirements', 'u-sadia', '2026-09-25T12:45:00+06:00', 188000],
['p13', 'PPDC_Security_Tender_Notice.pdf', 'Tender document', 'u-imran', '2026-09-21T12:15:00+06:00', 640000],
['p15', 'SOC_Award_Correspondence.pdf', 'Correspondence', 'u-farhan', '2026-08-15T11:00:00+06:00', 120000],
['p14', 'DR_Site_Discussion_Notes.docx', 'Meeting notes', 'u-sadia', '2026-09-03T14:30:00+06:00', 74000]];


function demoText(filename: string, category: DocCategory): string {
  const title = filename.replace(/\.[a-z]+$/i, '').replace(/_/g, ' ');
  return [
  `DEMO DOCUMENT — SYNTHETIC CONTENT`,
  ``,
  `${title}`,
  `Category: ${category}`,
  ``,
  `This preview contains fictional placeholder text generated for the Penta Public Sector Sales CRM demo.`,
  `It does not represent a real tender, proposal, government procurement or Penta contract.`,
  ``,
  `1. Background — The procuring organization seeks a modern, secure and maintainable solution aligned with national digital service goals.`,
  `2. Scope summary — Requirements gathering, solution design, implementation, data migration, training and 12 months of support.`,
  `3. Key dates — Refer to the tender record in the CRM for submission and clarification deadlines.`,
  `4. Notes — Synthetic content only. Replace with actual documents in a production system.`].
  join('\n');
}

export const seedDocuments: DocumentRecord[] = docRows.map(([oppId, filename, category, uploadedBy, uploadedAt, sizeBytes], i) => ({
  id: `d${i + 1}`,
  oppId,
  filename,
  category,
  uploadedBy,
  uploadedAt,
  sizeBytes,
  mimeType: 'text/plain',
  isDemo: true,
  demoContent: demoText(filename, category),
  dataUrl: null
}));