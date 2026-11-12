import fs from 'fs';
import path from 'path';

const root = path.resolve('backend');

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') walk(full);
    else if (entry.name.endsWith('.ts')) {
      let text = fs.readFileSync(full, 'utf8');
      if (!text.includes("mysql2/promise")) continue;
      let spec = path.relative(path.dirname(full), path.join(root, 'src', 'database', 'rows.ts')).replaceAll('\\', '/').replace(/\.ts$/, '');
      if (!spec.startsWith('.')) spec = `./${spec}`;
      text = text.replaceAll("from 'mysql2/promise'", `from '${spec}'`);
      fs.writeFileSync(full, text);
      console.log(full);
    }
  }
}

walk(root);
