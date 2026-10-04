import type { Activity, ActivityType, FollowUp, FollowUpStatus, Priority } from '../types/crm';

type ActivityRow = [string, string, ActivityType, string, string, string | null, string];

const activityRows: ActivityRow[] = [
['p1', '2026-08-12 10:00', 'Office Visit', 'Introductory visit to City Corporation', 'Met CEO; discussed citizen service backlog and current manual processes.', 'c13', 'u-rafiq'],
['p1', '2026-09-17 11:00', 'Meeting', 'Requirements workshop with ICT Cell', 'Walked through trade licence and holding tax workflows. Client wants bilingual UI and SMS notifications.', 'c14', 'u-rafiq'],
['p1', '2026-09-24 15:30', 'Phone Call', 'Scope clarification call', 'CEO office asked for a phased delivery option; revised scope promised by 30 Sep.', 'c13', 'u-rafiq'],
['p2', '2026-07-15 11:30', 'Meeting', 'ERP requirements discussion with Director General', 'Agreed module priorities: admissions, finance and HR first.', 'c6', 'u-tasnia'],
['p2', '2026-09-12 12:00', 'Internal Discussion', 'Bid/no-bid review for ERP tender', 'Decision: participate. Payroll partner to be confirmed.', null, 'u-tasnia'],
['p2', '2026-09-24 14:00', 'Meeting', 'Pre-bid meeting at Directorate', 'Raised queries on data migration volume and training scope.', 'c7', 'u-tasnia'],
['p2', '2026-09-30 16:00', 'Email', 'Clarification response received', 'Directorate confirmed 14 institutes in phase 1 and five years of records to migrate.', 'c7', 'u-tasnia'],
['p3', '2026-08-20 13:00', 'Meeting', 'Records digitisation demo', 'Demonstrated DMS prototype; Director keen on retention schedule features.', 'c3', 'u-rafiq'],
['p3', '2026-09-23 10:15', 'Email', 'RFP document circulated internally', 'Technical lead reviewing evaluation criteria.', 'c4', 'u-rafiq'],
['p4', '2026-09-18 12:30', 'Phone Call', 'Initial outreach to Service Innovation Unit', 'Joint Secretary open to a short introductory meeting in October.', 'c1', 'u-tasnia'],
['p5', '2026-09-25 11:00', 'Meeting', 'Contract negotiation', 'Agreed final price and a 9-month delivery timeline.', 'c20', 'u-rafiq'],
['p5', '2026-10-01 15:00', 'Email', 'Notification of award received', 'Formal award notification received; kick-off to be scheduled.', 'c21', 'u-rafiq'],
['p6', '2026-08-26 10:00', 'Email', 'Tender result published', 'Not awarded; winning bid approximately 15% lower.', 'c5', 'u-tasnia'],
['p7', '2026-09-10 11:00', 'Meeting', 'Introductory meeting with Director General', 'Discussed archive search pain points; DG requested a capability brief.', 'c17', 'u-nadia'],
['p8', '2026-09-05 15:00', 'Internal Discussion', 'Proposal pricing review', 'Final price approved by Section Lead.', null, 'u-rafiq'],
['p8', '2026-09-23 11:45', 'Office Visit', 'Bid submission', 'Bid submitted in person with all annexures; receipt obtained.', 'c8', 'u-rafiq'],
['p9', '2026-08-05 10:30', 'Phone Call', 'Budget status check', 'Project placed on hold pending budget revision.', 'c2', 'u-tasnia'],
['p10', '2026-09-09 16:30', 'Internal Discussion', 'Bid submission completed', 'Two-envelope bid submitted; technical team on standby for presentation.', null, 'u-nadia'],
['p10', '2026-09-29 11:00', 'Phone Call', 'Evaluation status', 'Committee expects technical presentations next week.', 'c2', 'u-nadia'],
['p21', '2026-09-15 11:00', 'Meeting', 'Certification system pre-tender discussion', 'Planning officer expects publication in late October.', 'c22', 'u-rafiq'],
['p11', '2026-09-18 10:00', 'Meeting', 'Data platform scoping session', 'Reviewed meter data sources and reporting needs across six zones.', 'c10', 'u-imran'],
['p11', '2026-09-26 14:30', 'Phone Call', 'Procurement committee update', 'Committee reviewing estimate; feedback expected by month end.', 'c9', 'u-imran'],
['p12', '2026-09-16 11:00', 'Internal Discussion', 'Tender kick-off with OEM partners', 'Assigned BoQ owners; OEM letters requested.', null, 'u-sadia'],
['p12', '2026-09-28 10:00', 'Office Visit', 'Pre-bid site visit at data centre', 'Power and cooling constraints noted in server hall B.', 'c18', 'u-sadia'],
['p13', '2026-08-14 15:00', 'Meeting', 'Security posture discussion', 'GM IT outlined priorities: NAC, SIEM and firewall consolidation.', 'c11', 'u-imran'],
['p13', '2026-09-21 12:00', 'Email', 'Tender notice reviewed', 'Requirements include NAC and SIEM; go/no-go decision due 03 Oct.', 'c12', 'u-imran'],
['p14', '2026-09-03 11:00', 'Meeting', 'DR requirements discussion', 'RPO/RTO targets discussed; client requested a sizing note.', 'c15', 'u-sadia'],
['p15', '2026-08-14 12:00', 'Meeting', 'Contract signing', 'SOC contract signed at negotiated value.', 'c16', 'u-farhan'],
['p16', '2026-09-30 10:00', 'Phone Call', 'Missed submission follow-up', 'Submission deadline passed while OEM letter was pending.', 'c11', 'u-sadia'],
['p17', '2026-09-12 14:00', 'Email', 'Evaluation result received', 'Technical score below qualifying threshold.', 'c13', 'u-imran'],
['p18', '2026-09-22 11:30', 'Phone Call', 'Network refresh enquiry', "Mayor's office interested in refreshing LAN across four buildings.", 'c20', 'u-farhan'],
['p19', '2026-09-05 12:00', 'Email', 'Requirement cancelled', 'Authority cancelled the requirement after restructuring.', 'c9', 'u-imran'],
['p20', '2026-09-14 13:00', 'Office Visit', 'Bid submission', 'Bid submitted; acknowledgement received.', 'c18', 'u-sadia'],
['p20', '2026-09-30 15:00', 'Email', 'Clarification request on licensing', 'Evaluation committee asked for licensing model details.', 'c18', 'u-sadia']];


export const seedActivities: Activity[] = activityRows.map(([oppId, when, type, subject, notes, contactId, createdBy], i) => ({
  id: `a${i + 1}`,
  oppId,
  at: `${when.replace(' ', 'T')}:00+06:00`,
  type,
  subject,
  notes,
  contactId,
  createdBy,
  nextAction: '',
  nextActionDue: ''
}));

type FollowUpRow = [string, string, string, string, Priority, FollowUpStatus, string];

const followUpRows: FollowUpRow[] = [
['p1', 'Send revised scope to Sylvan Hills ICT Cell', 'u-rafiq', '2026-09-30', 'High', 'Open', ''],
['p1', 'Prepare phased delivery cost options', 'u-rafiq', '2026-10-06', 'Medium', 'Open', ''],
['p3', 'Submit clarification questions on RFP', 'u-rafiq', '2026-10-04', 'High', 'Open', ''],
['p8', 'Check evaluation committee schedule', 'u-rafiq', '2026-09-28', 'Medium', 'Open', ''],
['p21', 'Confirm tender publication timeline', 'u-rafiq', '2026-10-12', 'Medium', 'Open', ''],
['p2', 'Obtain bid security from bank', 'u-tasnia', '2026-10-02', 'High', 'Open', ''],
['p2', 'Finalise financial proposal', 'u-tasnia', '2026-10-03', 'High', 'Open', ''],
['p4', 'Request introductory meeting with Joint Secretary', 'u-tasnia', '2026-10-06', 'Medium', 'Open', ''],
['p9', 'Check status of budget revision', 'u-tasnia', '2026-09-25', 'Low', 'Open', ''],
['p7', 'Share capability brief with Director General', 'u-nadia', '2026-10-02', 'Medium', 'Open', ''],
['p10', 'Prepare technical presentation deck', 'u-nadia', '2026-10-07', 'High', 'Open', ''],
['p11', 'Follow up on procurement committee feedback', 'u-imran', '2026-09-29', 'High', 'Open', ''],
['p13', 'Decide go/no-go on tender participation', 'u-imran', '2026-10-03', 'High', 'Open', ''],
['p12', 'Complete OEM authorisation letters', 'u-sadia', '2026-10-05', 'High', 'Open', ''],
['p14', 'Submit DR site sizing note', 'u-sadia', '2026-10-10', 'Medium', 'Open', ''],
['p16', 'Confirm late submission options with GM IT', 'u-sadia', '2026-10-01', 'High', 'Open', ''],
['p20', 'Provide licensing clarification', 'u-sadia', '2026-10-06', 'High', 'Open', ''],
['p18', 'Arrange site survey of municipal offices', 'u-farhan', '2026-10-14', 'Low', 'Open', ''],
['p12', 'Review bid pricing for Data Center Upgrade', 'u-arif', '2026-10-04', 'High', 'Open', ''],
['p2', 'Approve ERP bid submission', 'u-arif', '2026-10-03', 'Medium', 'Open', ''],
['p8', 'Submit learning portal bid', 'u-rafiq', '2026-09-23', 'High', 'Completed', 'Submitted in person; receipt filed.'],
['p5', 'Collect award notification letter', 'u-rafiq', '2026-10-01', 'Medium', 'Completed', 'Letter received by email and filed.'],
['p15', 'Countersign SOC contract', 'u-farhan', '2026-08-14', 'High', 'Completed', ''],
['p10', 'Submit analytics bid', 'u-nadia', '2026-09-09', 'High', 'Completed', 'Submitted on time.'],
['p11', 'Share data platform reference architecture', 'u-imran', '2026-09-20', 'Medium', 'Completed', '']];


export const seedFollowUps: FollowUp[] = followUpRows.map(([oppId, title, assigneeId, due, priority, status, completionNote], i) => ({
  id: `f${i + 1}`,
  oppId,
  title,
  assigneeId,
  due,
  priority,
  status,
  completionNote,
  completedAt: status === 'Completed' ? `${due}T17:00:00+06:00` : '',
  createdBy: assigneeId,
  createdAt: '2026-09-15T09:00:00+06:00'
}));