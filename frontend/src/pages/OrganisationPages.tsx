import { useQuery } from '@tanstack/react-query';
import { Badge } from '../components/ui';
import { RecordPage } from '../components/RecordPage';
import { api } from '../lib/api';

interface Named { id: number; code: string; name?: string; title?: string; status: string }

export function BranchesPage() {
  return (
    <RecordPage<Named & { city: string | null; isHeadOffice: boolean }>
      title="Branches"
      description="Branches are created by a system administrator. Deactivating a branch is blocked while locations or employees are still assigned."
      endpoint="/v1/organisation/branches"
      managePermission="branches.manage"
      empty="No branches yet. Add the company’s real offices, farms, or yards."
      fields={[
        { name: 'code', label: 'Code', required: true },
        { name: 'name', label: 'Name', required: true },
        { name: 'city', label: 'City' },
        { name: 'phone', label: 'Phone' },
        { name: 'email', label: 'Email' },
        { name: 'addressLine', label: 'Address' },
        { name: 'isHeadOffice', label: 'Head office', kind: 'checkbox' },
      ]}
      columns={[
        { header: 'Code', cell: (row) => row.code },
        { header: 'Name', cell: (row) => row.name },
        { header: 'City', cell: (row) => row.city || '—' },
        { header: 'Head office', cell: (row) => row.isHeadOffice ? 'Yes' : 'No' },
        { header: 'Status', cell: (row) => <Badge value={row.status} /> },
      ]}
    />
  );
}

export function LocationsPage() {
  const branches = useQuery({ queryKey: ['branch-options'], queryFn: () => api<{ data: Named[] }>('/v1/organisation/branches?pageSize=200') });
  return (
    <RecordPage<Named & { branchName: string; locationType: string }>
      title="Locations"
      description="Warehouses, farms, yards, and offices belong to a branch."
      endpoint="/v1/organisation/locations"
      managePermission="locations.manage"
      empty="No locations yet."
      fields={[
        { name: 'branchId', label: 'Branch', kind: 'select', required: true, options: branches.data?.data.map((branch) => ({ value: String(branch.id), label: branch.name ?? branch.code })) },
        { name: 'code', label: 'Code', required: true },
        { name: 'name', label: 'Name', required: true },
        { name: 'locationType', label: 'Type', kind: 'select', options: ['office', 'warehouse', 'farm', 'yard', 'workshop', 'other'].map((value) => ({ value, label: value })) },
        { name: 'city', label: 'City' },
        { name: 'addressLine', label: 'Address' },
      ]}
      columns={[
        { header: 'Code', cell: (row) => row.code },
        { header: 'Name', cell: (row) => row.name },
        { header: 'Branch', cell: (row) => row.branchName },
        { header: 'Type', cell: (row) => row.locationType },
        { header: 'Status', cell: (row) => <Badge value={row.status} /> },
      ]}
    />
  );
}

export function DepartmentsPage() {
  const departments = useQuery({ queryKey: ['department-options'], queryFn: () => api<{ data: Named[] }>('/v1/organisation/departments?pageSize=200&status=all') });
  const branches = useQuery({ queryKey: ['branch-options'], queryFn: () => api<{ data: Named[] }>('/v1/organisation/branches?pageSize=200') });
  return (
    <RecordPage<Named & { parentName: string | null; branchName: string | null }>
      title="Departments"
      description="Departments and subdepartments are data, not fixed levels in the application. Only a system administrator can change the structure."
      endpoint="/v1/organisation/departments"
      managePermission="departments.manage"
      empty="No departments yet."
      fields={[
        { name: 'code', label: 'Code', required: true },
        { name: 'name', label: 'Name', required: true },
        { name: 'parentId', label: 'Parent department', kind: 'select', options: departments.data?.data.map((department) => ({ value: String(department.id), label: department.name ?? department.code })) },
        { name: 'branchId', label: 'Branch', kind: 'select', options: branches.data?.data.map((branch) => ({ value: String(branch.id), label: branch.name ?? branch.code })) },
        { name: 'description', label: 'Description', kind: 'textarea' },
      ]}
      columns={[
        { header: 'Code', cell: (row) => row.code },
        { header: 'Name', cell: (row) => row.name },
        { header: 'Parent', cell: (row) => row.parentName || '—' },
        { header: 'Branch', cell: (row) => row.branchName || 'Company-wide' },
        { header: 'Status', cell: (row) => <Badge value={row.status} /> },
      ]}
    />
  );
}

export function PositionsPage() {
  const departments = useQuery({ queryKey: ['department-options'], queryFn: () => api<{ data: Named[] }>('/v1/organisation/departments?pageSize=200') });
  const positions = useQuery({ queryKey: ['position-options'], queryFn: () => api<{ data: Array<Named & { title: string }> }>('/v1/organisation/positions?pageSize=200&status=all') });
  return (
    <RecordPage<Named & { title: string; departmentName: string | null; reportsToTitle: string | null; isManagerial: boolean }>
      title="Positions"
      description="Positions can report to other positions. Employees are assigned separately, so history survives a transfer."
      endpoint="/v1/organisation/positions"
      managePermission="positions.manage"
      empty="No positions yet."
      fields={[
        { name: 'code', label: 'Code', required: true },
        { name: 'title', label: 'Title', required: true },
        { name: 'departmentId', label: 'Department', kind: 'select', options: departments.data?.data.map((department) => ({ value: String(department.id), label: department.name ?? department.code })) },
        { name: 'reportsToPositionId', label: 'Reports to', kind: 'select', options: positions.data?.data.map((position) => ({ value: String(position.id), label: position.title })) },
        { name: 'grade', label: 'Grade' },
        { name: 'isManagerial', label: 'Managerial', kind: 'checkbox' },
        { name: 'description', label: 'Description', kind: 'textarea' },
      ]}
      columns={[
        { header: 'Code', cell: (row) => row.code },
        { header: 'Title', cell: (row) => row.title },
        { header: 'Department', cell: (row) => row.departmentName || 'Company-wide' },
        { header: 'Reports to', cell: (row) => row.reportsToTitle || '—' },
        { header: 'Status', cell: (row) => <Badge value={row.status} /> },
      ]}
    />
  );
}
