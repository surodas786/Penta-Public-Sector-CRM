import type { Contact, Organization } from '../types/crm';

// Fictional public sector organizations — synthetic demo data, not real entities.
export const seedOrganizations: Organization[] = [
{ id: 'o1', name: 'Ministry of Public Service Innovation', type: 'Ministry', parentId: null, location: 'Dhaka', website: 'https://mpsi.example.com', notes: 'Synthetic organization. Leads cross-government service digitisation programmes.' },
{ id: 'o2', name: 'Department of Civic Records', type: 'Department', parentId: 'o1', location: 'Dhaka', website: 'https://civicrecords.example.com', notes: 'Synthetic organization. Custodian of civic registration records.' },
{ id: 'o3', name: 'Ministry of Skills & Vocational Training', type: 'Ministry', parentId: null, location: 'Dhaka', website: 'https://skills.example.com', notes: 'Synthetic organization.' },
{ id: 'o4', name: 'Directorate of Public Training Institutes', type: 'Directorate', parentId: 'o3', location: 'Gazipur', website: 'https://dpti.example.com', notes: 'Synthetic organization. Oversees 14 public training institutes.' },
{ id: 'o5', name: 'Meghna Regional Utility Authority', type: 'Authority', parentId: null, location: 'Narayanganj', website: 'https://mrua.example.com', notes: 'Synthetic organization. Regional water and utility services.' },
{ id: 'o6', name: 'Padma Power Distribution Corporation', type: 'Public Corporation', parentId: null, location: 'Rajshahi', website: 'https://ppdc.example.com', notes: 'Synthetic organization.' },
{ id: 'o7', name: 'Sylvan Hills City Corporation', type: 'Local Government', parentId: null, location: 'Sylhet', website: 'https://sylvanhills.example.com', notes: 'Synthetic organization.' },
{ id: 'o8', name: 'Karnaphuli Port Services Authority', type: 'Authority', parentId: null, location: 'Chattogram', website: '', notes: 'Synthetic organization.' },
{ id: 'o9', name: 'National Data & Records Agency', type: 'Other', parentId: null, location: 'Dhaka', website: 'https://ndra.example.com', notes: 'Synthetic organization. Operates shared government data centre services.' },
{ id: 'o10', name: 'Riverbank Municipality', type: 'Local Government', parentId: null, location: 'Khulna', website: '', notes: 'Synthetic organization.' }];


// Fictional contacts. Phone numbers are placeholders; emails use the reserved example.com domain.
export const seedContacts: Contact[] = [
{ id: 'c1', name: 'Shirin Sultana', designation: 'Joint Secretary (ICT)', orgId: 'o1', department: 'Service Innovation Unit', email: 'shirin.sultana@example.com', phone: '+880 1700-000101', notes: 'Decision maker for citizen-facing applications. Prefers concise briefs.' },
{ id: 'c2', name: 'Mahbub Alam', designation: 'Senior Systems Analyst', orgId: 'o1', department: 'Monitoring & Evaluation Wing', email: 'mahbub.alam@example.com', phone: '+880 1700-000102', notes: 'Technical evaluator; detail oriented.' },
{ id: 'c3', name: 'Rokeya Begum', designation: 'Director, Records Management', orgId: 'o2', department: 'Records Management Division', email: 'rokeya.begum@example.com', phone: '+880 1700-000103', notes: 'Champion for retention-schedule automation.' },
{ id: 'c4', name: 'Tanvir Chowdhury', designation: 'Programmer', orgId: 'o2', department: 'ICT Cell', email: 'tanvir.chowdhury@example.com', phone: '', notes: 'Day-to-day technical contact.' },
{ id: 'c5', name: 'Abdul Matin', designation: 'Deputy Secretary', orgId: 'o3', department: 'Grants & Scholarships Wing', email: 'abdul.matin@example.com', phone: '+880 1700-000105', notes: 'Oversees grant and certification systems.' },
{ id: 'c6', name: 'Farzana Yasmin', designation: 'Director General', orgId: 'o4', department: "Director General's Office", email: 'farzana.yasmin@example.com', phone: '+880 1700-000106', notes: 'Executive sponsor for ERP and eLearning initiatives.' },
{ id: 'c7', name: 'Sajjad Hossain', designation: 'Procurement Officer', orgId: 'o4', department: 'Planning & Development Wing', email: 'sajjad.hossain@example.com', phone: '+880 1700-000107', notes: 'Point of contact for tender clarifications.' },
{ id: 'c8', name: 'Nusrat Jahan', designation: 'ICT Coordinator', orgId: 'o4', department: 'eLearning Cell', email: 'nusrat.jahan@example.com', phone: '', notes: 'Coordinates institute-level ICT rollout.' },
{ id: 'c9', name: 'Habibur Rahman', designation: 'Chief Engineer', orgId: 'o5', department: 'Planning & Monitoring Department', email: 'habibur.rahman@example.com', phone: '+880 1700-000109', notes: 'Chairs procurement committee.' },
{ id: 'c10', name: 'Shamima Nasrin', designation: 'Head of IT', orgId: 'o5', department: 'IT Department', email: 'shamima.nasrin@example.com', phone: '+880 1700-000110', notes: 'Owns data platform requirements.' },
{ id: 'c11', name: 'Mizanur Rahman', designation: 'General Manager, IT', orgId: 'o6', department: 'IT Department', email: 'mizanur.rahman@example.com', phone: '+880 1700-000111', notes: 'Security-first mindset; values local support capacity.' },
{ id: 'c12', name: 'Ayesha Siddiqua', designation: 'Network Manager', orgId: 'o6', department: 'Network Operations', email: 'ayesha.siddiqua@example.com', phone: '', notes: 'Technical lead for network security tender.' },
{ id: 'c13', name: 'Golam Mostafa', designation: 'Chief Executive Officer', orgId: 'o7', department: 'Office of the Chief Executive', email: 'golam.mostafa@example.com', phone: '+880 1700-000113', notes: 'Final approver for city digital projects.' },
{ id: 'c14', name: 'Laila Arjumand', designation: 'Assistant Engineer (IT)', orgId: 'o7', department: 'ICT Cell', email: 'laila.arjumand@example.com', phone: '+880 1700-000114', notes: 'Coordinates requirements workshops.' },
{ id: 'c15', name: 'Zahid Hasan', designation: 'Director, Operations', orgId: 'o8', department: 'Operations Directorate', email: 'zahid.hasan@example.com', phone: '+880 1700-000115', notes: 'Sponsor for resilience and DR initiatives.' },
{ id: 'c16', name: 'Sharmin Akhter', designation: 'IT Security Lead', orgId: 'o8', department: 'IT Security Cell', email: 'sharmin.akhter@example.com', phone: '', notes: 'Runs SOC operations post-award.' },
{ id: 'c17', name: 'Rezaul Karim', designation: 'Director General', orgId: 'o9', department: "Director General's Office", email: 'rezaul.karim@example.com', phone: '+880 1700-000117', notes: 'Engaged across archive, data centre and cloud programmes.' },
{ id: 'c18', name: 'Moushumi Das', designation: 'Systems Manager', orgId: 'o9', department: 'ICT Infrastructure Division', email: 'moushumi.das@example.com', phone: '+880 1700-000118', notes: 'Technical owner for infrastructure tenders.' },
{ id: 'c19', name: 'Anisul Haque', designation: 'Records Officer', orgId: 'o9', department: 'Digital Archives Directorate', email: 'anisul.haque@example.com', phone: '', notes: 'Knows archive search pain points well.' },
{ id: 'c20', name: 'Delwar Hossain', designation: "Secretary, Mayor's Office", orgId: 'o10', department: "Mayor's Office", email: 'delwar.hossain@example.com', phone: '+880 1700-000120', notes: 'Gatekeeper for municipal meetings.' },
{ id: 'c21', name: 'Parveen Akter', designation: 'IT Officer', orgId: 'o10', department: 'IT Section', email: 'parveen.akter@example.com', phone: '', notes: 'Implementation counterpart for e-services.' },
{ id: 'c22', name: 'Kazi Faisal', designation: 'Planning Officer', orgId: 'o3', department: 'Planning Wing', email: 'kazi.faisal@example.com', phone: '+880 1700-000122', notes: 'Tracks tender publication timelines.' }];