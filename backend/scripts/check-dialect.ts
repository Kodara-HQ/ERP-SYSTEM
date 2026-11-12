import fs from 'fs';
import path from 'path';
import { translateMigration } from '../src/database/dialect';

const dir = path.resolve('backend/migrations');
const names = new Map<string, string>();
for (const file of fs.readdirSync(dir).filter((entry) => entry.endsWith('.sql')).sort()) {
  const statements = translateMigration(fs.readFileSync(path.join(dir, file), 'utf8'));
  console.log(`\n===== ${file} (${statements.length}) =====`);
  for (const statement of statements) {
    console.log(statement);
    console.log('---');
    const index = statement.match(/^CREATE INDEX\s+(\S+)/i);
    if (index?.[1]) {
      const previous = names.get(index[1]);
      if (previous) console.log(`DUPLICATE INDEX ${index[1]} in ${previous} and ${file}`);
      names.set(index[1], file);
    }
    if (/UNIQUE KEY|ENGINE=|AUTO_INCREMENT|TINYINT|DATETIME|UNSIGNED|ENUM\(|ON DUPLICATE|JOIN workflows/i.test(statement)) {
      console.log('UNTRANSLATED MARKER');
    }
  }
}
