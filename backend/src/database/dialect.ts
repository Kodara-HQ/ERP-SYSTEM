const noIdentity = new Set(['system_settings', 'reference_sequences', 'role_permissions', 'department_workspaces']);

const conflictTargets: Record<string, string> = {
  permissions: '(code)',
  segregation_rules: '(code)',
  roles: '(code)',
  reference_sequences: '(sequence_key)',
  system_settings: '(setting_key)',
  leave_types: '(company_id, code)',
  ledger_accounts: '(company_id, code)',
  cash_accounts: '(company_id, code)',
  department_workspaces: '(department_id, workspace_code)',
  leave_balances: '(employee_id, leave_type_id, balance_year)',
  attendance_records: '(employee_id, work_date)',
  exit_records: '(employee_id)',
};

export function translateSql(sql: string, params: unknown[] = []): { text: string; values: unknown[] } {
  let text = rewriteUpdateJoin(sql);
  text = rewriteDates(text);
  text = text.replace(/JSON_QUOTE\('([^']*)'\)/g, "to_json('$1'::text)");
  text = text.replace(/UTC_TIMESTAMP\(\d+\)/g, 'CURRENT_TIMESTAMP');
  text = text.replace(/<=>/g, 'IS NOT DISTINCT FROM');
  text = text.replace(/ESCAPE '\\\\'/g, "ESCAPE '\\'");
  text = text.replace(/\bIF\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/gi, 'CASE WHEN $1 THEN $2 ELSE $3 END');
  text = text.replace(/\bYEAR\s*\(\s*([a-z0-9_.]+)\s*\)/gi, 'EXTRACT(YEAR FROM $1)');
  text = text.replace(
    /INSERT\s+IGNORE\s+INTO\s+stock_balances\s*(\([^)]*\))\s*VALUES\s*(\([^)]*\))/gi,
    'INSERT INTO stock_balances $1 VALUES $2 ON CONFLICT (warehouse_id, item_id) DO NOTHING',
  );
  text = text.replace(/\bSUM\((?!\s*CASE\b)([^()]*?(?:=|<>|<|>)[^()]*?)\)/gi, 'SUM(CASE WHEN $1 THEN 1 ELSE 0 END)');
  text = lockBaseTable(text);
  text = rewriteUpsert(text);
  let index = 0;
  text = text.replace(/'(?:''|[^'])*'|(\?)/g, (match, placeholder: string | undefined) => (placeholder ? `$${++index}` : match));
  if (shouldReturnId(text)) text += ' RETURNING id';
  return { text, values: params };
}

const clauseWords = new Set(['where', 'join', 'left', 'right', 'inner', 'outer', 'cross', 'on', 'group', 'order', 'limit', 'for']);

function lockBaseTable(sql: string): string {
  if (!/\bFOR UPDATE\s*$/i.test(sql) || !/\bJOIN\b/i.test(sql)) return sql;
  const from = sql.match(/\bFROM\s+([a-z0-9_]+)(?:\s+(?:AS\s+)?([a-z0-9_]+))?/i);
  if (!from?.[1]) return sql;
  const alias = from[2] && !clauseWords.has(from[2].toLowerCase()) ? from[2] : from[1];
  return sql.replace(/\bFOR UPDATE\s*$/i, `FOR UPDATE OF ${alias}`);
}

function rewriteUpdateJoin(sql: string): string {
  const match = sql.match(/^UPDATE\s+([a-z0-9_]+)\s+([a-z0-9_]+)\s+JOIN\s+([a-z0-9_]+)\s+([a-z0-9_]+)\s+ON\s+([\s\S]+?)\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$/i);
  if (!match) return sql;
  const table = match[1];
  const alias = match[2];
  const joinTable = match[3];
  const joinAlias = match[4];
  const on = match[5];
  const assignment = match[6];
  const where = match[7];
  if (!table || !alias || !joinTable || !joinAlias || !on || !assignment || !where) return sql;
  const setClause = assignment.replace(new RegExp(`\\b${alias}\\.`, 'g'), '');
  return `UPDATE ${table} AS ${alias} SET ${setClause} FROM ${joinTable} AS ${joinAlias} WHERE ${on} AND ${where}`;
}

function rewriteDates(sql: string): string {
  return sql
    .replace(/DATE_SUB\(\s*CURRENT_DATE\s*,\s*INTERVAL\s+(\d+)\s+DAY\s*\)/gi, "CURRENT_DATE - INTERVAL '$1 days'")
    .replace(/DATE_ADD\(\s*CURRENT_DATE\s*,\s*INTERVAL\s+(\d+)\s+DAY\s*\)/gi, "CURRENT_DATE + INTERVAL '$1 days'")
    .replace(/DATE_SUB\(\s*UTC_TIMESTAMP\(\d+\)\s*,\s*INTERVAL\s+\?\s+DAY\s*\)/gi, "(CURRENT_TIMESTAMP - (? * INTERVAL '1 day'))")
    .replace(/DATE_SUB\(\s*UTC_TIMESTAMP\(\d+\)\s*,\s*INTERVAL\s+(\d+)\s+DAY\s*\)/gi, "CURRENT_TIMESTAMP - INTERVAL '$1 day'")
    .replace(/DATE_ADD\(\s*UTC_TIMESTAMP\(\d+\)\s*,\s*INTERVAL\s+\?\s+DAY\s*\)/gi, "(CURRENT_TIMESTAMP + (? * INTERVAL '1 day'))")
    .replace(/DATE_ADD\(\s*UTC_TIMESTAMP\(\d+\)\s*,\s*INTERVAL\s+\?\s+MINUTE\s*\)/gi, "(CURRENT_TIMESTAMP + (? * INTERVAL '1 minute'))")
    .replace(/DATE_ADD\(\s*\?\s*,\s*INTERVAL\s+1\s+DAY\s*\)/gi, "(?::timestamp + INTERVAL '1 day')");
}

function rewriteUpsert(sql: string): string {
  const marker = sql.search(/ON DUPLICATE KEY UPDATE/i);
  if (marker < 0) return sql;
  const table = sql.match(/insert\s+into\s+([a-z0-9_]+)/i)?.[1];
  const target = table ? conflictTargets[table] : undefined;
  if (!target) return sql;
  const assignments = sql.slice(marker).replace(/ON DUPLICATE KEY UPDATE/i, '').trim().replace(/;\s*$/, '');
  const head = sql.slice(0, marker).trim();
  const parts = splitTopLevel(assignments).map((part) => part.trim()).filter(Boolean);
  const noop = parts.every((part) => {
    const [left, right] = part.split('=').map((piece) => piece.trim());
    return left === right;
  });
  if (noop) return `${head} ON CONFLICT ${target} DO NOTHING`;
  const setClause = parts.map((part) => part.replace(/VALUES\s*\(\s*([a-z0-9_]+)\s*\)/gi, 'EXCLUDED.$1')).join(', ');
  return `${head} ON CONFLICT ${target} DO UPDATE SET ${setClause}`;
}

function shouldReturnId(sql: string): boolean {
  if (!/^\s*insert\b/i.test(sql)) return false;
  if (/\breturning\b/i.test(sql)) return false;
  const table = sql.match(/insert\s+into\s+([a-z0-9_]+)/i)?.[1];
  return Boolean(table) && !noIdentity.has(table!);
}

export function translateMigration(sql: string): string[] {
  if (/CREATE TRIGGER/i.test(sql)) return translateTrigger(sql);
  const output: string[] = [];
  for (const statement of splitStatements(sql)) {
    if (/^CREATE TABLE/i.test(statement)) output.push(...translateCreateTable(statement));
    else if (/^ALTER TABLE/i.test(statement)) output.push(...translateAlter(statement));
    else if (/^(INSERT|UPDATE|DELETE)/i.test(statement)) output.push(translateSql(statement).text);
    else output.push(statement);
  }
  return output.filter((statement) => statement.trim().length > 0);
}

function translateCreateTable(sql: string): string[] {
  let body = sql.replace(/\)\s*ENGINE=InnoDB[\s\S]*$/i, ')');
  body = body.replace(/`/g, '');
  body = body.replace(
    /scope_key VARCHAR\(40\) GENERATED ALWAYS AS \(CONCAT\(scope_type, ':', IFNULL\(scope_id, 0\)\)\) STORED/i,
    "scope_key VARCHAR(40) GENERATED ALWAYS AS (scope_type::text || ':' || COALESCE(scope_id::text, '0')) STORED",
  );
  body = body.replace(/\bBIGINT\s+UNSIGNED\b/gi, 'BIGINT');
  body = body.replace(/\b(?:INT|INTEGER|SMALLINT|TINYINT)\s+UNSIGNED\b/gi, (match) => match.replace(/\s+UNSIGNED/i, '').replace(/TINYINT/i, 'SMALLINT').replace(/\bINT\b/i, 'INTEGER'));
  body = body.replace(/\bTINYINT\(1\)/gi, 'SMALLINT');
  body = body.replace(/\bTINYINT\b/gi, 'SMALLINT');
  body = body.replace(/\bDATETIME\(\d+\)/gi, 'TIMESTAMP');
  body = body.replace(/\s+ON UPDATE CURRENT_TIMESTAMP(?:\(\d+\))?/gi, '');
  body = body.replace(/\bCURRENT_TIMESTAMP\(\d+\)/gi, 'CURRENT_TIMESTAMP');
  body = body.replace(/\bAUTO_INCREMENT\b/gi, 'GENERATED BY DEFAULT AS IDENTITY');
  body = body.replace(/\bUNSIGNED\b/gi, '');
  body = body.replace(/(\b[a-z_][a-z0-9_]*)\s+ENUM\(([^)]+)\)/gi, '$1 TEXT CHECK ($1 IN ($2))');
  const table = body.match(/CREATE TABLE\s+([a-z0-9_]+)/i)?.[1];
  const indexes: string[] = [];
  body = body.replace(/UNIQUE KEY\s+[a-z0-9_]+\s*\(([^)]+)\)/gi, 'UNIQUE ($1)');
  body = body.replace(/,?\s*(?<!UNIQUE )(?<!PRIMARY )(?<!FOREIGN )\bKEY\s+([a-z0-9_]+)\s*\(([^)]+)\)/gi, (match, name: string, columns: string) => {
    if (!table) return match;
    indexes.push(`CREATE INDEX ${name} ON ${table} (${columns})`);
    return '';
  });
  body = body.replace(/,\s*,/g, ',');
  body = body.replace(/,\s*\)/g, '\n)');
  return [body, ...indexes];
}

function translateAlter(sql: string): string[] {
  const table = sql.match(/ALTER TABLE\s+([a-z0-9_]+)/i)?.[1];
  if (!table) return [sql];
  let rest = sql.replace(/ALTER TABLE\s+[a-z0-9_]+\s*/i, '').replace(/`/g, '');
  rest = rest.replace(/\bBIGINT\s+UNSIGNED\b/gi, 'BIGINT').replace(/\bUNSIGNED\b/gi, '').replace(/\s+AFTER\s+[a-z0-9_]+/gi, '');
  const alters: string[] = [];
  const extra: string[] = [];
  for (const part of splitTopLevel(rest)) {
    const item = part.trim().replace(/,\s*$/, '');
    if (!item) continue;
    const key = item.match(/^ADD\s+KEY\s+([a-z0-9_]+)\s*\(([^)]+)\)/i);
    if (key) {
      extra.push(`CREATE INDEX ${key[1]} ON ${table} (${key[2]})`);
      continue;
    }
    const modify = item.match(/^MODIFY\s+([a-z0-9_]+)\s+(.+?)\s+NOT NULL\s*$/i);
    if (modify) {
      extra.push(`ALTER TABLE ${table} ALTER COLUMN ${modify[1]} TYPE ${modify[2].trim()}, ALTER COLUMN ${modify[1]} SET NOT NULL`);
      continue;
    }
    if (/^ADD\s+COLUMN/i.test(item)) alters.push(item);
    else if (/^ADD\s+(?!KEY|CONSTRAINT|UNIQUE|PRIMARY)/i.test(item)) alters.push(item.replace(/^ADD\s+/i, 'ADD COLUMN '));
    else alters.push(item);
  }
  const statements: string[] = [];
  if (alters.length > 0) statements.push(`ALTER TABLE ${table}\n  ${alters.join(',\n  ')}`);
  statements.push(...extra);
  return statements;
}

function translateTrigger(sql: string): string[] {
  const name = sql.match(/CREATE TRIGGER\s+([a-z0-9_]+)/i)?.[1];
  const timing = sql.match(/BEFORE\s+(UPDATE|DELETE)\s+ON\s+([a-z0-9_]+)/i);
  const message = sql.match(/MESSAGE_TEXT\s*=\s*'([^']+)'/i)?.[1];
  if (!name || !timing || !message) return [sql];
  const event = timing[1]!.toUpperCase();
  const table = timing[2];
  const guard = /IF NOT \(/i.test(sql)
    ? `IF NOT (
    NEW.debit = OLD.debit
    AND NEW.credit = OLD.credit
    AND NEW.ledger_account_id = OLD.ledger_account_id
    AND NEW.journal_id = OLD.journal_id
    AND NEW.department_id IS NOT DISTINCT FROM OLD.department_id
    AND NEW.memo IS NOT DISTINCT FROM OLD.memo
  ) THEN
    RAISE EXCEPTION '${message}';
  END IF;
  RETURN NEW;`
    : `RAISE EXCEPTION '${message}';
  RETURN ${event === 'DELETE' ? 'OLD' : 'NEW'};`;
  return [
    `CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger AS $$\nBEGIN\n  ${guard}\nEND;\n$$ LANGUAGE plpgsql`,
    `DROP TRIGGER IF EXISTS ${name} ON ${table}`,
    `CREATE TRIGGER ${name} BEFORE ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${name}()`,
  ];
}

function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.replace(/^(?:\s*--[^\n]*(?:\r?\n|$))+/g, '').trim())
    .filter((statement) => statement.length > 0 && !statement.split('\n').every((line) => line.trim().startsWith('--') || line.trim() === ''));
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of input) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}
