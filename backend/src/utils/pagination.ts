export interface PageQuery {
  page: number;
  pageSize: number;
  search: string;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}

export function pageMeta(query: PageQuery, total: number): PageMeta {
  return { page: query.page, pageSize: query.pageSize, total };
}

export function limitOffset(query: PageQuery): { limit: number; offset: number } {
  return {
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  };
}

export function likeTerm(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
