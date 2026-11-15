import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { Button, ErrorText, Modal } from './ui';

interface RowResult { row: number; name: string; status: 'ok' | 'error'; errors: string[]; employeeNumber?: string }
interface ImportResult { committed: boolean; total: number; valid: number; failed: number; rows: RowResult[] }

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Import employees from the Excel template or a CSV file. The file is checked first; it is saved only
 * when every row is valid, and then all rows are saved together.
 */
export function EmployeeImport({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(commit: boolean) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('The file can be at most 5 MB.'); return; }
    setBusy(true);
    setError('');
    try {
      const response = await api<{ data: ImportResult }>('/v1/employees/import', {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, contentBase64: await readBase64(file), commit }),
      });
      setResult(response.data);
      if (response.data.committed) await client.invalidateQueries({ queryKey: ['employees'] });
    } catch (reason) {
      setResult(null);
      setError(reason instanceof ApiError ? reason.message : 'The file could not be processed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Import employees from a spreadsheet" onClose={onClose}>
      <div className="grid gap-4 text-sm">
        <ol className="list-decimal space-y-1 pl-5 text-slate-700">
          <li><a className="font-semibold text-pine" href="/api/v1/employees/import/template.xlsx">Download the Excel template</a>. It lists your departments, positions, and branches to copy from.</li>
          <li>Fill one employee per row on the Employees sheet, then save it.</li>
          <li>Choose the file and check it. Nothing is saved until every row is valid.</li>
        </ol>
        <label className="flex flex-wrap items-center gap-3">
          <span className="inline-flex cursor-pointer items-center rounded-md border border-line px-3 py-2 font-semibold hover:bg-cream">
            Choose file
            <input type="file" className="hidden" accept=".xlsx,.csv" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setResult(null); setError(''); }} />
          </span>
          <span className="text-slate-600">{file ? file.name : 'No file chosen (.xlsx or .csv)'}</span>
        </label>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {result ? (
          <div className="grid gap-2">
            <div className={`rounded-md px-3 py-2 font-semibold ${result.committed ? 'bg-khaki text-navy' : result.failed ? 'bg-red-50 text-[#8d2f2f]' : 'bg-canvas text-pine'}`}>
              {result.committed
                ? `Imported ${result.valid} employee${result.valid === 1 ? '' : 's'}.`
                : result.failed
                  ? `${result.failed} of ${result.total} rows need fixing. Correct them in the file and check again.`
                  : `All ${result.total} rows are valid and ready to import.`}
            </div>
            <div className="max-h-72 overflow-y-auto rounded-md border border-line">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 bg-canvas uppercase tracking-wide text-slate-500">
                  <tr><th className="px-2 py-1.5">Row</th><th className="px-2 py-1.5">Employee</th><th className="px-2 py-1.5">Result</th></tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.row} className="border-t border-line align-top">
                      <td className="px-2 py-1.5 tabular-nums">{row.row}</td>
                      <td className="px-2 py-1.5">{row.name}</td>
                      <td className={`px-2 py-1.5 ${row.status === 'error' ? 'text-[#8d2f2f]' : 'text-pine'}`}>
                        {row.status === 'error' ? row.errors.join(' ') : row.employeeNumber ?? 'Ready'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          {result?.committed ? (
            <Button type="button" onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button type="button" variant="secondary" disabled={!file || busy} onClick={() => void send(false)}>{busy ? 'Checking…' : 'Check file'}</Button>
              <Button type="button" disabled={!file || busy || !result || result.failed > 0} onClick={() => void send(true)}>
                {result && !result.failed ? `Import ${result.valid} employees` : 'Import'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
