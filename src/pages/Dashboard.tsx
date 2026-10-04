import { useCrm } from '../contexts/CrmContext';
import { AdminDashboard } from '../components/dashboard/AdminDashboard';
import { SalesDashboard } from '../components/dashboard/SalesDashboard';

export function Dashboard() {
  const { currentUser } = useCrm();
  return currentUser.role === 'admin' ? <AdminDashboard /> : <SalesDashboard key={currentUser.id} />;
}