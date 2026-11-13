import fs from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

const logoPath = path.resolve(__dirname, '../../assets/bajogo-mark.png');

export interface ReportTable {
  title: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}

function sheetName(title: string, used: Set<string>): string {
  const cleaned = title.replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 31) || 'Report';
  let name = cleaned;
  let extra = 2;
  while (used.has(name)) {
    const suffix = ` ${extra}`;
    name = `${cleaned.slice(0, 31 - suffix.length)}${suffix}`;
    extra += 1;
  }
  used.add(name);
  return name;
}

export async function workbookBuffer(title: string, tables: ReportTable[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BAJOGO ERP';
  workbook.title = title;
  const used = new Set<string>();
  const sheets = tables.length > 0 ? tables : [{ title: 'Report', columns: ['Note'], rows: [['No rows']] }];
  for (const table of sheets) {
    const sheet = workbook.addWorksheet(sheetName(table.title, used));
    sheet.addRow(table.columns);
    sheet.getRow(1).font = { bold: true };
    for (const row of table.rows) sheet.addRow(row);
    sheet.columns.forEach((column) => {
      column.width = 24;
    });
  }
  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

function drawTable(doc: InstanceType<typeof PDFDocument>, table: ReportTable) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const count = Math.max(table.columns.length, 1);
  const widths = Array.from({ length: count }, () => width / count);
  const header = () => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#3E3C28');
    let x = doc.page.margins.left;
    table.columns.forEach((column, index) => {
      doc.text(column, x, y, { width: widths[index] - 6, lineBreak: false });
      x += widths[index];
    });
    doc.y = y + 14;
    doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + width, doc.y).strokeColor('#D9D7B6').stroke();
    doc.y += 6;
  };
  if (doc.y > doc.page.height - doc.page.margins.bottom - 72) doc.addPage();
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#2C2B1C').text(table.title);
  doc.moveDown(0.4);
  header();
  const rows = table.rows.length > 0 ? table.rows : [['None']];
  for (const row of rows) {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 28) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    let x = doc.page.margins.left;
    doc.font('Helvetica').fontSize(9).fillColor('#2C2B1C');
    row.forEach((cell, index) => {
      doc.text(String(cell), x, y, { width: (widths[index] ?? widths[0]) - 6, lineBreak: false });
      x += widths[index] ?? widths[0];
    });
    doc.y = y + 14;
  }
  doc.moveDown();
}

export function pdfBuffer(title: string, tables: ReportTable[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const left = doc.page.margins.left;
    const top = doc.y;
    const hasLogo = fs.existsSync(logoPath);
    if (hasLogo) doc.image(logoPath, left, top, { width: 44, height: 44 });
    const textLeft = hasLogo ? left + 56 : left;
    const textWidth = doc.page.width - doc.page.margins.right - textLeft;
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#2C2B1C').text(title, textLeft, top + 4, { width: textWidth });
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(9).fillColor('#545233').text('BAJOGO ENTERPRISE', textLeft, doc.y, { width: textWidth });
    doc.x = left;
    doc.y = Math.max(doc.y, top + 44);
    doc.moveDown();
    for (const table of tables) drawTable(doc, table);
    doc.end();
  });
}

export async function sendReport(res: Response, format: 'xlsx' | 'pdf', filename: string, title: string, tables: ReportTable[]) {
  if (format === 'xlsx') {
    const body = await workbookBuffer(title, tables);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    res.send(body);
    return;
  }
  const body = await pdfBuffer(title, tables);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  res.send(body);
}
