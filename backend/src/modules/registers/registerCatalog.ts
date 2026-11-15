/**
 * Department registers. Each register is a typed list of records owned by one department workspace.
 * Common fields are real columns (title, status, dates, amount, quantity) so they can be reported on;
 * the rest are kept in `details`. Access follows the workspace and the register's permissions.
 */
export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select';
export type Column = 'title' | 'entry_date' | 'due_on' | 'amount' | 'quantity';

export interface RegisterField {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  required?: boolean;
  /** Stored in a real column instead of `details`. */
  column?: Column;
}

export interface RegisterDefinition {
  code: string;
  name: string;
  description: string;
  group: 'Operations' | 'Legal' | 'IT' | 'Marketing';
  workspace: string;
  viewPermission: string;
  managePermission: string;
  prefix: string;
  statuses: string[];
  /** Statuses that count as closed for alerts and summaries. */
  closedStatuses: string[];
  fields: RegisterField[];
  /** People holding this permission may raise records and see only their own. */
  selfServicePermission?: string;
  /** Records whose due date falls within this many days are flagged and notified. */
  dueAlertDays?: number;
}

const ops = { group: 'Operations' as const, workspace: 'operations', viewPermission: 'operations.view', managePermission: 'operations.manage' };
const legal = { group: 'Legal' as const, workspace: 'legal', viewPermission: 'legal.view_confidential', managePermission: 'legal.manage' };
const it = { group: 'IT' as const, workspace: 'it', viewPermission: 'it.view', managePermission: 'it.manage' };
const marketing = { group: 'Marketing' as const, workspace: 'marketing', viewPermission: 'marketing.view', managePermission: 'marketing.manage' };

export const registerCatalog: RegisterDefinition[] = [
  {
    ...ops, code: 'farm_plots', name: 'Farm plots', prefix: 'BJG-FRM',
    description: 'Cashew farms and plots under management.',
    statuses: ['active', 'fallow', 'inactive'], closedStatuses: ['inactive'],
    fields: [
      { key: 'title', label: 'Plot name', type: 'text', required: true, column: 'title' },
      { key: 'location', label: 'Location', type: 'text', required: true },
      { key: 'sizeHectares', label: 'Size (hectares)', type: 'number', column: 'quantity' },
      { key: 'crop', label: 'Crop', type: 'text' },
      { key: 'treeCount', label: 'Trees', type: 'number' },
      { key: 'plantedYear', label: 'Year planted', type: 'number' },
    ],
  },
  {
    ...ops, code: 'crop_activities', name: 'Crop management', prefix: 'BJG-CRP',
    description: 'Planting, weeding, pruning, spraying, fertilising, and inspections.',
    statuses: ['planned', 'done', 'cancelled'], closedStatuses: ['done', 'cancelled'],
    fields: [
      { key: 'title', label: 'Activity', type: 'text', required: true, column: 'title' },
      { key: 'activityDate', label: 'Date', type: 'date', required: true, column: 'entry_date' },
      { key: 'plot', label: 'Plot', type: 'text', required: true },
      { key: 'activityType', label: 'Type', type: 'select', required: true, options: ['planting', 'weeding', 'pruning', 'spraying', 'fertilising', 'inspection', 'other'] },
      { key: 'labourCount', label: 'Workers', type: 'number' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  {
    ...ops, code: 'harvests', name: 'Harvesting', prefix: 'BJG-HRV',
    description: 'Raw cashew nut harvested by plot.',
    statuses: ['recorded', 'stored', 'dispatched'], closedStatuses: ['dispatched'],
    fields: [
      { key: 'title', label: 'Plot', type: 'text', required: true, column: 'title' },
      { key: 'harvestDate', label: 'Harvest date', type: 'date', required: true, column: 'entry_date' },
      { key: 'quantityKg', label: 'Quantity (kg)', type: 'number', required: true, column: 'quantity' },
      { key: 'grade', label: 'Grade', type: 'text' },
      { key: 'moisturePercent', label: 'Moisture %', type: 'number' },
      { key: 'storedAt', label: 'Stored at', type: 'text' },
    ],
  },
  {
    ...ops, code: 'processing_batches', name: 'Production and processing', prefix: 'BJG-BAT',
    description: 'Processing batches from raw nut to graded kernel.',
    statuses: ['in_progress', 'completed', 'rejected'], closedStatuses: ['completed', 'rejected'],
    fields: [
      { key: 'title', label: 'Batch', type: 'text', required: true, column: 'title' },
      { key: 'batchDate', label: 'Start date', type: 'date', required: true, column: 'entry_date' },
      { key: 'inputKg', label: 'Raw nut input (kg)', type: 'number', required: true, column: 'quantity' },
      { key: 'outputKg', label: 'Kernel output (kg)', type: 'number' },
      { key: 'stage', label: 'Stage', type: 'select', required: true, options: ['drying', 'steaming', 'shelling', 'peeling', 'grading', 'packing', 'finished'] },
      { key: 'kernelGrade', label: 'Kernel grade', type: 'text' },
    ],
  },
  {
    ...ops, code: 'quality_checks', name: 'Quality control', prefix: 'BJG-QC',
    description: 'Moisture, nut count, outturn, and defect checks.',
    statuses: ['pass', 'conditional', 'fail'], closedStatuses: [],
    fields: [
      { key: 'title', label: 'Lot or batch', type: 'text', required: true, column: 'title' },
      { key: 'checkDate', label: 'Check date', type: 'date', required: true, column: 'entry_date' },
      { key: 'subjectType', label: 'Checked', type: 'select', required: true, options: ['harvest', 'purchase', 'batch', 'dispatch'] },
      { key: 'moisturePercent', label: 'Moisture %', type: 'number' },
      { key: 'nutCount', label: 'Nut count per kg', type: 'number' },
      { key: 'outturnKor', label: 'Outturn (KOR lbs)', type: 'number' },
      { key: 'defectPercent', label: 'Defects %', type: 'number' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  {
    ...ops, code: 'equipment', name: 'Equipment and fleet', prefix: 'BJG-EQP',
    description: 'Vehicles, tractors, machines, and their service dates.',
    statuses: ['available', 'in_use', 'maintenance', 'retired'], closedStatuses: ['retired'], dueAlertDays: 14,
    fields: [
      { key: 'title', label: 'Asset', type: 'text', required: true, column: 'title' },
      { key: 'assetType', label: 'Type', type: 'select', required: true, options: ['truck', 'vehicle', 'tractor', 'processing_machine', 'generator', 'tool', 'other'] },
      { key: 'registrationNumber', label: 'Registration or serial', type: 'text' },
      { key: 'lastService', label: 'Last service', type: 'date', column: 'entry_date' },
      { key: 'nextService', label: 'Next service due', type: 'date', column: 'due_on' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  {
    ...ops, code: 'haulage_trips', name: 'Transport and haulage', prefix: 'BJG-TRP',
    description: 'Haulage trips, loads, distance, and fuel.',
    statuses: ['planned', 'in_transit', 'delivered', 'cancelled'], closedStatuses: ['delivered', 'cancelled'],
    fields: [
      { key: 'title', label: 'Route', type: 'text', required: true, column: 'title' },
      { key: 'tripDate', label: 'Trip date', type: 'date', required: true, column: 'entry_date' },
      { key: 'vehicle', label: 'Vehicle', type: 'text', required: true },
      { key: 'driver', label: 'Driver', type: 'text' },
      { key: 'cargo', label: 'Cargo', type: 'text' },
      { key: 'quantityKg', label: 'Load (kg)', type: 'number', column: 'quantity' },
      { key: 'distanceKm', label: 'Distance (km)', type: 'number' },
      { key: 'fuelLitres', label: 'Fuel (litres)', type: 'number' },
    ],
  },
  {
    ...legal, code: 'legal_cases', name: 'Legal cases', prefix: 'BJG-CAS',
    description: 'Litigation, disputes, claims, and regulatory matters.',
    statuses: ['open', 'pending', 'closed'], closedStatuses: ['closed'], dueAlertDays: 14,
    fields: [
      { key: 'title', label: 'Matter', type: 'text', required: true, column: 'title' },
      { key: 'caseType', label: 'Type', type: 'select', required: true, options: ['litigation', 'dispute', 'claim', 'regulatory', 'other'] },
      { key: 'counterparty', label: 'Counterparty', type: 'text', required: true },
      { key: 'forum', label: 'Court or forum', type: 'text' },
      { key: 'filedOn', label: 'Filed', type: 'date', column: 'entry_date' },
      { key: 'nextHearing', label: 'Next hearing', type: 'date', column: 'due_on' },
      { key: 'exposure', label: 'Estimated exposure', type: 'number', column: 'amount' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  {
    ...legal, code: 'compliance', name: 'Licences, land, and compliance', prefix: 'BJG-CMP',
    description: 'Licences, permits, land documents, certificates, and regulatory filings with renewal dates.',
    statuses: ['valid', 'renewal_due', 'pending', 'expired'], closedStatuses: [], dueAlertDays: 30,
    fields: [
      { key: 'title', label: 'Item', type: 'text', required: true, column: 'title' },
      { key: 'category', label: 'Category', type: 'select', required: true, options: ['licence', 'permit', 'land_document', 'certificate', 'regulatory_filing', 'other'] },
      { key: 'authority', label: 'Issuing authority', type: 'text', required: true },
      { key: 'referenceNo', label: 'Document number', type: 'text' },
      { key: 'issuedOn', label: 'Issued', type: 'date', column: 'entry_date' },
      { key: 'expiresOn', label: 'Expires or renews', type: 'date', column: 'due_on' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  {
    ...it, code: 'support_tickets', name: 'IT support', prefix: 'BJG-SUP', selfServicePermission: 'support.request',
    description: 'Support requests from staff. Staff see their own requests; IT sees all.',
    statuses: ['open', 'in_progress', 'resolved', 'closed'], closedStatuses: ['resolved', 'closed'],
    fields: [
      { key: 'title', label: 'Problem', type: 'text', required: true, column: 'title' },
      { key: 'category', label: 'Category', type: 'select', required: true, options: ['access', 'erp', 'hardware', 'software', 'network', 'other'] },
      { key: 'priority', label: 'Priority', type: 'select', required: true, options: ['low', 'normal', 'high', 'urgent'] },
      { key: 'description', label: 'Description', type: 'textarea', required: true },
      { key: 'assignedTo', label: 'Assigned to', type: 'text' },
      { key: 'resolution', label: 'Resolution', type: 'textarea' },
    ],
  },
  {
    ...it, code: 'backup_checks', name: 'Database backup monitoring', prefix: 'BJG-BKP',
    description: 'Each backup check: result, size, and where the copy is held.',
    statuses: ['success', 'partial', 'failed'], closedStatuses: [],
    fields: [
      { key: 'title', label: 'Backup', type: 'text', required: true, column: 'title' },
      { key: 'checkedOn', label: 'Checked on', type: 'date', required: true, column: 'entry_date' },
      { key: 'backupType', label: 'Type', type: 'select', required: true, options: ['database', 'files', 'offsite', 'restore_test'] },
      { key: 'sizeMb', label: 'Size (MB)', type: 'number', column: 'quantity' },
      { key: 'location', label: 'Copy held at', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  {
    ...it, code: 'infrastructure', name: 'Infrastructure and security', prefix: 'BJG-INF',
    description: 'Servers, network, devices, licences, and security controls with renewal dates.',
    statuses: ['active', 'maintenance', 'retired'], closedStatuses: ['retired'], dueAlertDays: 30,
    fields: [
      { key: 'title', label: 'Item', type: 'text', required: true, column: 'title' },
      { key: 'kind', label: 'Kind', type: 'select', required: true, options: ['server', 'network', 'device', 'software_licence', 'security_control', 'service'] },
      { key: 'location', label: 'Location', type: 'text' },
      { key: 'renewalOn', label: 'Renewal or review', type: 'date', column: 'due_on' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  {
    ...it, code: 'integrations', name: 'Technical integrations', prefix: 'BJG-INT',
    description: 'External systems connected to the ERP, such as SMS and banking.',
    statuses: ['planned', 'active', 'disabled'], closedStatuses: ['disabled'],
    fields: [
      { key: 'title', label: 'Integration', type: 'text', required: true, column: 'title' },
      { key: 'provider', label: 'Provider', type: 'text', required: true },
      { key: 'purpose', label: 'Purpose', type: 'textarea', required: true },
      { key: 'owner', label: 'Owner', type: 'text' },
    ],
  },
  {
    ...marketing, code: 'customers', name: 'Customer management', prefix: 'BJG-CRM',
    description: 'Buyers, exporters, processors, and traders. Invoices stay in finance.',
    statuses: ['prospect', 'active', 'inactive'], closedStatuses: ['inactive'],
    fields: [
      { key: 'title', label: 'Customer', type: 'text', required: true, column: 'title' },
      { key: 'customerType', label: 'Type', type: 'select', required: true, options: ['exporter', 'processor', 'local_trader', 'retailer', 'haulage_client', 'other'] },
      { key: 'contactPerson', label: 'Contact person', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'region', label: 'Region', type: 'text' },
    ],
  },
  {
    ...marketing, code: 'campaigns', name: 'Marketing campaigns', prefix: 'BJG-CMN',
    description: 'Campaigns, channels, budgets, and results.',
    statuses: ['planned', 'active', 'completed', 'cancelled'], closedStatuses: ['completed', 'cancelled'],
    fields: [
      { key: 'title', label: 'Campaign', type: 'text', required: true, column: 'title' },
      { key: 'channel', label: 'Channel', type: 'select', required: true, options: ['radio', 'print', 'digital', 'trade_show', 'field', 'other'] },
      { key: 'startOn', label: 'Start', type: 'date', column: 'entry_date' },
      { key: 'endOn', label: 'End', type: 'date', column: 'due_on' },
      { key: 'budget', label: 'Planned budget', type: 'number', column: 'amount' },
      { key: 'targetMarket', label: 'Target market', type: 'text' },
      { key: 'results', label: 'Results', type: 'textarea' },
    ],
  },
  {
    ...marketing, code: 'opportunities', name: 'Sales opportunities', prefix: 'BJG-OPP',
    description: 'Sales pipeline for raw nut, kernels, and haulage.',
    statuses: ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'], closedStatuses: ['won', 'lost'],
    fields: [
      { key: 'title', label: 'Opportunity', type: 'text', required: true, column: 'title' },
      { key: 'customer', label: 'Customer', type: 'text', required: true },
      { key: 'product', label: 'Product', type: 'select', required: true, options: ['raw_cashew', 'kernels', 'haulage', 'other'] },
      { key: 'quantityKg', label: 'Quantity (kg)', type: 'number', column: 'quantity' },
      { key: 'expectedValue', label: 'Expected value', type: 'number', column: 'amount' },
      { key: 'expectedClose', label: 'Expected close', type: 'date', column: 'due_on' },
      { key: 'owner', label: 'Owner', type: 'text' },
    ],
  },
  {
    ...marketing, code: 'market_research', name: 'Market research', prefix: 'BJG-MRS',
    description: 'Prices, competitors, and buyer research.',
    statuses: ['draft', 'final'], closedStatuses: [],
    fields: [
      { key: 'title', label: 'Topic', type: 'text', required: true, column: 'title' },
      { key: 'researchDate', label: 'Date', type: 'date', required: true, column: 'entry_date' },
      { key: 'market', label: 'Market', type: 'text', required: true },
      { key: 'findings', label: 'Findings', type: 'textarea', required: true },
      { key: 'source', label: 'Source', type: 'text' },
    ],
  },
  {
    ...marketing, code: 'customer_relations', name: 'Customer relations', prefix: 'BJG-CRL',
    description: 'Calls, visits, complaints, and follow-ups with customers.',
    statuses: ['open', 'closed'], closedStatuses: ['closed'], dueAlertDays: 7,
    fields: [
      { key: 'title', label: 'Customer', type: 'text', required: true, column: 'title' },
      { key: 'contactDate', label: 'Date', type: 'date', required: true, column: 'entry_date' },
      { key: 'channel', label: 'Channel', type: 'select', required: true, options: ['call', 'visit', 'email', 'complaint', 'meeting'] },
      { key: 'summary', label: 'Summary', type: 'textarea', required: true },
      { key: 'followUpOn', label: 'Follow up', type: 'date', column: 'due_on' },
    ],
  },
  {
    ...marketing, code: 'brand_assets', name: 'Branding', prefix: 'BJG-BRD',
    description: 'Logos, packaging, and brand material in use.',
    statuses: ['active', 'retired'], closedStatuses: ['retired'],
    fields: [
      { key: 'title', label: 'Asset', type: 'text', required: true, column: 'title' },
      { key: 'assetType', label: 'Type', type: 'select', required: true, options: ['logo', 'packaging', 'signage', 'print', 'digital', 'other'] },
      { key: 'usageNotes', label: 'Usage notes', type: 'textarea' },
    ],
  },
];

export function registerByCode(code: string): RegisterDefinition | undefined {
  return registerCatalog.find((register) => register.code === code);
}
