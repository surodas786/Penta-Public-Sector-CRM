/**
 * Synthetic contacts, opportunity-contact links and activities, converted from
 * the approved demo's fixtures (Milestone 4). Every person is fictional and
 * every email uses the reserved example.com domain.
 *
 * Conversion notes:
 *
 *  - The demo kept one free-text "notes" field on each contact. Production
 *    keeps relationship notes on the opportunity-contact link instead
 *    (BR-020), because a contact shared across teams must not show one team's
 *    notes to another. Each demo note is placed on the contact's FIRST link
 *    only, in the demo's opportunity order. This is a synthetic-only mapping
 *    (`demoNote` below) and must never be applied to live data without a
 *    separately reviewed migration.
 *  - Activity times keep the demo's Bangladesh-time instants. Every activity's
 *    contact is linked to the same opportunity; the seed checks this.
 *
 * Generated once from src/data/ and committed, so the seed never imports the
 * demo build's source.
 */
import type { ActivityType } from '../../shared/enums.js';

export interface SeedContact {
  legacyId: string;
  organizationLegacyId: string;
  fullName: string;
  designation: string;
  department: string;
  email: string | null;
  phone: string | null;
  demoNote: string | null;
}

export interface SeedContactLink {
  opportunityLegacyId: string;
  contactLegacyId: string;
}

export interface SeedActivity {
  legacyId: string;
  opportunityLegacyId: string;
  occurredAt: string;
  type: ActivityType;
  subject: string;
  notes: string | null;
  contactLegacyId: string | null;
  authorLegacyId: string;
}

export const seedContacts: SeedContact[] = [
  { legacyId: "c1", organizationLegacyId: "o1", fullName: "Shirin Sultana", designation: "Joint Secretary (ICT)", department: "Service Innovation Unit", email: "shirin.sultana@example.com", phone: "+880 1700-000101", demoNote: "Decision maker for citizen-facing applications. Prefers concise briefs." },
  { legacyId: "c2", organizationLegacyId: "o1", fullName: "Mahbub Alam", designation: "Senior Systems Analyst", department: "Monitoring & Evaluation Wing", email: "mahbub.alam@example.com", phone: "+880 1700-000102", demoNote: "Technical evaluator; detail oriented." },
  { legacyId: "c3", organizationLegacyId: "o2", fullName: "Rokeya Begum", designation: "Director, Records Management", department: "Records Management Division", email: "rokeya.begum@example.com", phone: "+880 1700-000103", demoNote: "Champion for retention-schedule automation." },
  { legacyId: "c4", organizationLegacyId: "o2", fullName: "Tanvir Chowdhury", designation: "Programmer", department: "ICT Cell", email: "tanvir.chowdhury@example.com", phone: null, demoNote: "Day-to-day technical contact." },
  { legacyId: "c5", organizationLegacyId: "o3", fullName: "Abdul Matin", designation: "Deputy Secretary", department: "Grants & Scholarships Wing", email: "abdul.matin@example.com", phone: "+880 1700-000105", demoNote: "Oversees grant and certification systems." },
  { legacyId: "c6", organizationLegacyId: "o4", fullName: "Farzana Yasmin", designation: "Director General", department: "Director General's Office", email: "farzana.yasmin@example.com", phone: "+880 1700-000106", demoNote: "Executive sponsor for ERP and eLearning initiatives." },
  { legacyId: "c7", organizationLegacyId: "o4", fullName: "Sajjad Hossain", designation: "Procurement Officer", department: "Planning & Development Wing", email: "sajjad.hossain@example.com", phone: "+880 1700-000107", demoNote: "Point of contact for tender clarifications." },
  { legacyId: "c8", organizationLegacyId: "o4", fullName: "Nusrat Jahan", designation: "ICT Coordinator", department: "eLearning Cell", email: "nusrat.jahan@example.com", phone: null, demoNote: "Coordinates institute-level ICT rollout." },
  { legacyId: "c9", organizationLegacyId: "o5", fullName: "Habibur Rahman", designation: "Chief Engineer", department: "Planning & Monitoring Department", email: "habibur.rahman@example.com", phone: "+880 1700-000109", demoNote: "Chairs procurement committee." },
  { legacyId: "c10", organizationLegacyId: "o5", fullName: "Shamima Nasrin", designation: "Head of IT", department: "IT Department", email: "shamima.nasrin@example.com", phone: "+880 1700-000110", demoNote: "Owns data platform requirements." },
  { legacyId: "c11", organizationLegacyId: "o6", fullName: "Mizanur Rahman", designation: "General Manager, IT", department: "IT Department", email: "mizanur.rahman@example.com", phone: "+880 1700-000111", demoNote: "Security-first mindset; values local support capacity." },
  { legacyId: "c12", organizationLegacyId: "o6", fullName: "Ayesha Siddiqua", designation: "Network Manager", department: "Network Operations", email: "ayesha.siddiqua@example.com", phone: null, demoNote: "Technical lead for network security tender." },
  { legacyId: "c13", organizationLegacyId: "o7", fullName: "Golam Mostafa", designation: "Chief Executive Officer", department: "Office of the Chief Executive", email: "golam.mostafa@example.com", phone: "+880 1700-000113", demoNote: "Final approver for city digital projects." },
  { legacyId: "c14", organizationLegacyId: "o7", fullName: "Laila Arjumand", designation: "Assistant Engineer (IT)", department: "ICT Cell", email: "laila.arjumand@example.com", phone: "+880 1700-000114", demoNote: "Coordinates requirements workshops." },
  { legacyId: "c15", organizationLegacyId: "o8", fullName: "Zahid Hasan", designation: "Director, Operations", department: "Operations Directorate", email: "zahid.hasan@example.com", phone: "+880 1700-000115", demoNote: "Sponsor for resilience and DR initiatives." },
  { legacyId: "c16", organizationLegacyId: "o8", fullName: "Sharmin Akhter", designation: "IT Security Lead", department: "IT Security Cell", email: "sharmin.akhter@example.com", phone: null, demoNote: "Runs SOC operations post-award." },
  { legacyId: "c17", organizationLegacyId: "o9", fullName: "Rezaul Karim", designation: "Director General", department: "Director General's Office", email: "rezaul.karim@example.com", phone: "+880 1700-000117", demoNote: "Engaged across archive, data centre and cloud programmes." },
  { legacyId: "c18", organizationLegacyId: "o9", fullName: "Moushumi Das", designation: "Systems Manager", department: "ICT Infrastructure Division", email: "moushumi.das@example.com", phone: "+880 1700-000118", demoNote: "Technical owner for infrastructure tenders." },
  { legacyId: "c19", organizationLegacyId: "o9", fullName: "Anisul Haque", designation: "Records Officer", department: "Digital Archives Directorate", email: "anisul.haque@example.com", phone: null, demoNote: "Knows archive search pain points well." },
  { legacyId: "c20", organizationLegacyId: "o10", fullName: "Delwar Hossain", designation: "Secretary, Mayor's Office", department: "Mayor's Office", email: "delwar.hossain@example.com", phone: "+880 1700-000120", demoNote: "Gatekeeper for municipal meetings." },
  { legacyId: "c21", organizationLegacyId: "o10", fullName: "Parveen Akter", designation: "IT Officer", department: "IT Section", email: "parveen.akter@example.com", phone: null, demoNote: "Implementation counterpart for e-services." },
  { legacyId: "c22", organizationLegacyId: "o3", fullName: "Kazi Faisal", designation: "Planning Officer", department: "Planning Wing", email: "kazi.faisal@example.com", phone: "+880 1700-000122", demoNote: "Tracks tender publication timelines." },
];

export const seedContactLinks: SeedContactLink[] = [
  { opportunityLegacyId: "p1", contactLegacyId: "c13" },
  { opportunityLegacyId: "p1", contactLegacyId: "c14" },
  { opportunityLegacyId: "p2", contactLegacyId: "c6" },
  { opportunityLegacyId: "p2", contactLegacyId: "c7" },
  { opportunityLegacyId: "p3", contactLegacyId: "c3" },
  { opportunityLegacyId: "p3", contactLegacyId: "c4" },
  { opportunityLegacyId: "p4", contactLegacyId: "c1" },
  { opportunityLegacyId: "p5", contactLegacyId: "c20" },
  { opportunityLegacyId: "p5", contactLegacyId: "c21" },
  { opportunityLegacyId: "p6", contactLegacyId: "c5" },
  { opportunityLegacyId: "p6", contactLegacyId: "c22" },
  { opportunityLegacyId: "p7", contactLegacyId: "c17" },
  { opportunityLegacyId: "p7", contactLegacyId: "c19" },
  { opportunityLegacyId: "p8", contactLegacyId: "c6" },
  { opportunityLegacyId: "p8", contactLegacyId: "c8" },
  { opportunityLegacyId: "p9", contactLegacyId: "c2" },
  { opportunityLegacyId: "p10", contactLegacyId: "c1" },
  { opportunityLegacyId: "p10", contactLegacyId: "c2" },
  { opportunityLegacyId: "p21", contactLegacyId: "c5" },
  { opportunityLegacyId: "p21", contactLegacyId: "c22" },
  { opportunityLegacyId: "p11", contactLegacyId: "c9" },
  { opportunityLegacyId: "p11", contactLegacyId: "c10" },
  { opportunityLegacyId: "p12", contactLegacyId: "c17" },
  { opportunityLegacyId: "p12", contactLegacyId: "c18" },
  { opportunityLegacyId: "p13", contactLegacyId: "c11" },
  { opportunityLegacyId: "p13", contactLegacyId: "c12" },
  { opportunityLegacyId: "p14", contactLegacyId: "c15" },
  { opportunityLegacyId: "p15", contactLegacyId: "c15" },
  { opportunityLegacyId: "p15", contactLegacyId: "c16" },
  { opportunityLegacyId: "p16", contactLegacyId: "c11" },
  { opportunityLegacyId: "p17", contactLegacyId: "c13" },
  { opportunityLegacyId: "p18", contactLegacyId: "c20" },
  { opportunityLegacyId: "p19", contactLegacyId: "c9" },
  { opportunityLegacyId: "p20", contactLegacyId: "c17" },
  { opportunityLegacyId: "p20", contactLegacyId: "c18" },
];

export const seedActivities: SeedActivity[] = [
  { legacyId: "a1", opportunityLegacyId: "p1", occurredAt: "2026-08-12T10:00:00+06:00", type: "office_visit", subject: "Introductory visit to City Corporation", notes: "Met CEO; discussed citizen service backlog and current manual processes.", contactLegacyId: "c13", authorLegacyId: "u-rafiq" },
  { legacyId: "a2", opportunityLegacyId: "p1", occurredAt: "2026-09-17T11:00:00+06:00", type: "meeting", subject: "Requirements workshop with ICT Cell", notes: "Walked through trade licence and holding tax workflows. Client wants bilingual UI and SMS notifications.", contactLegacyId: "c14", authorLegacyId: "u-rafiq" },
  { legacyId: "a3", opportunityLegacyId: "p1", occurredAt: "2026-09-24T15:30:00+06:00", type: "phone_call", subject: "Scope clarification call", notes: "CEO office asked for a phased delivery option; revised scope promised by 30 Sep.", contactLegacyId: "c13", authorLegacyId: "u-rafiq" },
  { legacyId: "a4", opportunityLegacyId: "p2", occurredAt: "2026-07-15T11:30:00+06:00", type: "meeting", subject: "ERP requirements discussion with Director General", notes: "Agreed module priorities: admissions, finance and HR first.", contactLegacyId: "c6", authorLegacyId: "u-tasnia" },
  { legacyId: "a5", opportunityLegacyId: "p2", occurredAt: "2026-09-12T12:00:00+06:00", type: "internal_discussion", subject: "Bid/no-bid review for ERP tender", notes: "Decision: participate. Payroll partner to be confirmed.", contactLegacyId: null, authorLegacyId: "u-tasnia" },
  { legacyId: "a6", opportunityLegacyId: "p2", occurredAt: "2026-09-24T14:00:00+06:00", type: "meeting", subject: "Pre-bid meeting at Directorate", notes: "Raised queries on data migration volume and training scope.", contactLegacyId: "c7", authorLegacyId: "u-tasnia" },
  { legacyId: "a7", opportunityLegacyId: "p2", occurredAt: "2026-09-30T16:00:00+06:00", type: "email", subject: "Clarification response received", notes: "Directorate confirmed 14 institutes in phase 1 and five years of records to migrate.", contactLegacyId: "c7", authorLegacyId: "u-tasnia" },
  { legacyId: "a8", opportunityLegacyId: "p3", occurredAt: "2026-08-20T13:00:00+06:00", type: "meeting", subject: "Records digitisation demo", notes: "Demonstrated DMS prototype; Director keen on retention schedule features.", contactLegacyId: "c3", authorLegacyId: "u-rafiq" },
  { legacyId: "a9", opportunityLegacyId: "p3", occurredAt: "2026-09-23T10:15:00+06:00", type: "email", subject: "RFP document circulated internally", notes: "Technical lead reviewing evaluation criteria.", contactLegacyId: "c4", authorLegacyId: "u-rafiq" },
  { legacyId: "a10", opportunityLegacyId: "p4", occurredAt: "2026-09-18T12:30:00+06:00", type: "phone_call", subject: "Initial outreach to Service Innovation Unit", notes: "Joint Secretary open to a short introductory meeting in October.", contactLegacyId: "c1", authorLegacyId: "u-tasnia" },
  { legacyId: "a11", opportunityLegacyId: "p5", occurredAt: "2026-09-25T11:00:00+06:00", type: "meeting", subject: "Contract negotiation", notes: "Agreed final price and a 9-month delivery timeline.", contactLegacyId: "c20", authorLegacyId: "u-rafiq" },
  { legacyId: "a12", opportunityLegacyId: "p5", occurredAt: "2026-10-01T15:00:00+06:00", type: "email", subject: "Notification of award received", notes: "Formal award notification received; kick-off to be scheduled.", contactLegacyId: "c21", authorLegacyId: "u-rafiq" },
  { legacyId: "a13", opportunityLegacyId: "p6", occurredAt: "2026-08-26T10:00:00+06:00", type: "email", subject: "Tender result published", notes: "Not awarded; winning bid approximately 15% lower.", contactLegacyId: "c5", authorLegacyId: "u-tasnia" },
  { legacyId: "a14", opportunityLegacyId: "p7", occurredAt: "2026-09-10T11:00:00+06:00", type: "meeting", subject: "Introductory meeting with Director General", notes: "Discussed archive search pain points; DG requested a capability brief.", contactLegacyId: "c17", authorLegacyId: "u-nadia" },
  { legacyId: "a15", opportunityLegacyId: "p8", occurredAt: "2026-09-05T15:00:00+06:00", type: "internal_discussion", subject: "Proposal pricing review", notes: "Final price approved by Section Lead.", contactLegacyId: null, authorLegacyId: "u-rafiq" },
  { legacyId: "a16", opportunityLegacyId: "p8", occurredAt: "2026-09-23T11:45:00+06:00", type: "office_visit", subject: "Bid submission", notes: "Bid submitted in person with all annexures; receipt obtained.", contactLegacyId: "c8", authorLegacyId: "u-rafiq" },
  { legacyId: "a17", opportunityLegacyId: "p9", occurredAt: "2026-08-05T10:30:00+06:00", type: "phone_call", subject: "Budget status check", notes: "Project placed on hold pending budget revision.", contactLegacyId: "c2", authorLegacyId: "u-tasnia" },
  { legacyId: "a18", opportunityLegacyId: "p10", occurredAt: "2026-09-09T16:30:00+06:00", type: "internal_discussion", subject: "Bid submission completed", notes: "Two-envelope bid submitted; technical team on standby for presentation.", contactLegacyId: null, authorLegacyId: "u-nadia" },
  { legacyId: "a19", opportunityLegacyId: "p10", occurredAt: "2026-09-29T11:00:00+06:00", type: "phone_call", subject: "Evaluation status", notes: "Committee expects technical presentations next week.", contactLegacyId: "c2", authorLegacyId: "u-nadia" },
  { legacyId: "a20", opportunityLegacyId: "p21", occurredAt: "2026-09-15T11:00:00+06:00", type: "meeting", subject: "Certification system pre-tender discussion", notes: "Planning officer expects publication in late October.", contactLegacyId: "c22", authorLegacyId: "u-rafiq" },
  { legacyId: "a21", opportunityLegacyId: "p11", occurredAt: "2026-09-18T10:00:00+06:00", type: "meeting", subject: "Data platform scoping session", notes: "Reviewed meter data sources and reporting needs across six zones.", contactLegacyId: "c10", authorLegacyId: "u-imran" },
  { legacyId: "a22", opportunityLegacyId: "p11", occurredAt: "2026-09-26T14:30:00+06:00", type: "phone_call", subject: "Procurement committee update", notes: "Committee reviewing estimate; feedback expected by month end.", contactLegacyId: "c9", authorLegacyId: "u-imran" },
  { legacyId: "a23", opportunityLegacyId: "p12", occurredAt: "2026-09-16T11:00:00+06:00", type: "internal_discussion", subject: "Tender kick-off with OEM partners", notes: "Assigned BoQ owners; OEM letters requested.", contactLegacyId: null, authorLegacyId: "u-sadia" },
  { legacyId: "a24", opportunityLegacyId: "p12", occurredAt: "2026-09-28T10:00:00+06:00", type: "office_visit", subject: "Pre-bid site visit at data centre", notes: "Power and cooling constraints noted in server hall B.", contactLegacyId: "c18", authorLegacyId: "u-sadia" },
  { legacyId: "a25", opportunityLegacyId: "p13", occurredAt: "2026-08-14T15:00:00+06:00", type: "meeting", subject: "Security posture discussion", notes: "GM IT outlined priorities: NAC, SIEM and firewall consolidation.", contactLegacyId: "c11", authorLegacyId: "u-imran" },
  { legacyId: "a26", opportunityLegacyId: "p13", occurredAt: "2026-09-21T12:00:00+06:00", type: "email", subject: "Tender notice reviewed", notes: "Requirements include NAC and SIEM; go/no-go decision due 03 Oct.", contactLegacyId: "c12", authorLegacyId: "u-imran" },
  { legacyId: "a27", opportunityLegacyId: "p14", occurredAt: "2026-09-03T11:00:00+06:00", type: "meeting", subject: "DR requirements discussion", notes: "RPO/RTO targets discussed; client requested a sizing note.", contactLegacyId: "c15", authorLegacyId: "u-sadia" },
  { legacyId: "a28", opportunityLegacyId: "p15", occurredAt: "2026-08-14T12:00:00+06:00", type: "meeting", subject: "Contract signing", notes: "SOC contract signed at negotiated value.", contactLegacyId: "c16", authorLegacyId: "u-farhan" },
  { legacyId: "a29", opportunityLegacyId: "p16", occurredAt: "2026-09-30T10:00:00+06:00", type: "phone_call", subject: "Missed submission follow-up", notes: "Submission deadline passed while OEM letter was pending.", contactLegacyId: "c11", authorLegacyId: "u-sadia" },
  { legacyId: "a30", opportunityLegacyId: "p17", occurredAt: "2026-09-12T14:00:00+06:00", type: "email", subject: "Evaluation result received", notes: "Technical score below qualifying threshold.", contactLegacyId: "c13", authorLegacyId: "u-imran" },
  { legacyId: "a31", opportunityLegacyId: "p18", occurredAt: "2026-09-22T11:30:00+06:00", type: "phone_call", subject: "Network refresh enquiry", notes: "Mayor's office interested in refreshing LAN across four buildings.", contactLegacyId: "c20", authorLegacyId: "u-farhan" },
  { legacyId: "a32", opportunityLegacyId: "p19", occurredAt: "2026-09-05T12:00:00+06:00", type: "email", subject: "Requirement cancelled", notes: "Authority cancelled the requirement after restructuring.", contactLegacyId: "c9", authorLegacyId: "u-imran" },
  { legacyId: "a33", opportunityLegacyId: "p20", occurredAt: "2026-09-14T13:00:00+06:00", type: "office_visit", subject: "Bid submission", notes: "Bid submitted; acknowledgement received.", contactLegacyId: "c18", authorLegacyId: "u-sadia" },
  { legacyId: "a34", opportunityLegacyId: "p20", occurredAt: "2026-09-30T15:00:00+06:00", type: "email", subject: "Clarification request on licensing", notes: "Evaluation committee asked for licensing model details.", contactLegacyId: "c18", authorLegacyId: "u-sadia" },
];
