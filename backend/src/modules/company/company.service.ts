import type { RowDataPacket } from '../../database/rows';
import { pool } from '../../database/pool';
import { execute, queryOne, withTransaction } from '../../database/query';
import { writeAudit } from '../../services/auditService';
import { requireCompanyId } from '../../services/companyContext';
import { notFound } from '../../utils/httpError';

type Actor = { userId: number; ipAddress: string | null; userAgent: string | null };

function mapCompany(row: RowDataPacket) {
  return {
    id: Number(row.id),
    legalName: row.legal_name,
    tradingName: row.trading_name,
    registrationNumber: row.registration_number,
    taxIdentificationNumber: row.tax_identification_number,
    email: row.email,
    phone: row.phone,
    website: row.website,
    addressLine: row.address_line,
    city: row.city,
    country: row.country,
    currencyCode: row.currency_code,
    timezone: row.timezone,
    fiscalYearStartMonth: Number(row.fiscal_year_start_month),
    status: row.status,
    updatedAt: row.updated_at,
  };
}

export async function getCompany() {
  const id = await requireCompanyId(pool);
  const row = await queryOne<RowDataPacket>(pool, 'SELECT * FROM companies WHERE id = ?', [id]);
  if (!row) {
    throw notFound('Company');
  }
  return mapCompany(row);
}

export async function updateCompany(input: {
  legalName: string;
  tradingName?: string | null;
  registrationNumber?: string | null;
  taxIdentificationNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  addressLine?: string | null;
  city?: string | null;
  country?: string | null;
  currencyCode: string;
  timezone: string;
  fiscalYearStartMonth: number;
}, actor: Actor) {
  return withTransaction(async (connection) => {
    const id = await requireCompanyId(connection);
    const current = await queryOne<RowDataPacket>(connection, 'SELECT * FROM companies WHERE id = ? FOR UPDATE', [id]);
    if (!current) {
      throw notFound('Company');
    }
    await execute(
      connection,
      `UPDATE companies
       SET legal_name = ?, trading_name = ?, registration_number = ?, tax_identification_number = ?,
           email = ?, phone = ?, website = ?, address_line = ?, city = ?, country = ?,
           currency_code = ?, timezone = ?, fiscal_year_start_month = ?
       WHERE id = ?`,
      [
        input.legalName,
        input.tradingName ?? null,
        input.registrationNumber ?? null,
        input.taxIdentificationNumber ?? null,
        input.email ?? null,
        input.phone ?? null,
        input.website ?? null,
        input.addressLine ?? null,
        input.city ?? null,
        input.country ?? null,
        input.currencyCode,
        input.timezone,
        input.fiscalYearStartMonth,
        id,
      ],
    );
    const updated = await queryOne<RowDataPacket>(connection, 'SELECT * FROM companies WHERE id = ?', [id]);
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'company.update',
      module: 'company',
      entityType: 'company',
      entityId: id,
      previousValue: mapCompany(current),
      newValue: mapCompany(updated!),
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return mapCompany(updated!);
  });
}
