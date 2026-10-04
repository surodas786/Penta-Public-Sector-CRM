import type { User } from '../types/crm';

// Fictional demo accounts — synthetic data only.
export const seedUsers: User[] = [
{ id: 'u-arif', name: 'Arif Rahman', email: 'arif.rahman@example.com', role: 'management', sectionId: null, managerId: null, active: true },
{ id: 'u-nadia', name: 'Nadia Islam', email: 'nadia.islam@example.com', role: 'lead', sectionId: 'GA', managerId: 'u-arif', active: true },
{ id: 'u-farhan', name: 'Farhan Ahmed', email: 'farhan.ahmed@example.com', role: 'lead', sectionId: 'IS', managerId: 'u-arif', active: true },
{ id: 'u-rafiq', name: 'Rafiq Hasan', email: 'rafiq.hasan@example.com', role: 'sales', sectionId: 'GA', managerId: 'u-nadia', active: true },
{ id: 'u-tasnia', name: 'Tasnia Karim', email: 'tasnia.karim@example.com', role: 'sales', sectionId: 'GA', managerId: 'u-nadia', active: true },
{ id: 'u-imran', name: 'Imran Hossain', email: 'imran.hossain@example.com', role: 'sales', sectionId: 'IS', managerId: 'u-farhan', active: true },
{ id: 'u-sadia', name: 'Sadia Akter', email: 'sadia.akter@example.com', role: 'sales', sectionId: 'IS', managerId: 'u-farhan', active: true },
{ id: 'u-admin', name: 'Demo Admin', email: 'admin@example.com', role: 'admin', sectionId: null, managerId: null, active: true }];