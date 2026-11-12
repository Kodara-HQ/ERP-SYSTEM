const formats = [
  { ext: 'csv', label: 'CSV' },
  { ext: 'xlsx', label: 'Excel' },
  { ext: 'pdf', label: 'PDF' },
] as const;

export function ReportDownloads({ base }: { base: string }) {
  const [path, query = ''] = base.split('?');
  const stem = path.replace(/\.csv$/, '');
  const suffix = query ? `?${query}` : '';
  return (
    <div className="flex flex-wrap gap-2">
      {formats.map((format) => (
        <a
          key={format.ext}
          className="inline-flex h-9 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-pine hover:bg-cream"
          href={`${stem}.${format.ext}${suffix}`}
        >
          {format.label}
        </a>
      ))}
    </div>
  );
}
