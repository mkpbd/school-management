import PDFDocument from 'pdfkit';
import { takaInWords } from '../../../shared/domain/words.js';
import type { PayslipDetail } from '../application/payrollPorts.js';
import type { PayslipPdfRenderer, PayslipPdfHeader } from '../application/PayrollUseCases.js';

const tk = (paisa: number) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paisa / 100);
const monthLabel = (periodMonth: string) =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${periodMonth}T00:00:00Z`),
  );

/**
 * A4 payslips with pdfkit (built-in Helvetica: English text; Bangla names need an embedded Bangla font and a
 * shaping engine, so the English name is printed). Unlocked runs carry a DRAFT watermark.
 */
export class PdfkitPayslipRenderer implements PayslipPdfRenderer {
  render(header: PayslipPdfHeader, slips: PayslipDetail[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 48,
        info: { Title: `Payslips ${slips[0] ? monthLabel(slips[0].periodMonth) : ''}`, Author: header.schoolName },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      slips.forEach((s, n) => {
        if (n) doc.addPage();
        this.page(doc, header, s);
      });
      if (!slips.length) doc.fontSize(12).text('No payslips.');
      doc.end();
    });
  }

  private page(doc: PDFKit.PDFDocument, h: PayslipPdfHeader, s: PayslipDetail): void {
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const draft = !['locked', 'paid'].includes(s.runStatus);
    if (draft) {
      doc
        .save()
        .fillColor('#dddddd')
        .fontSize(96)
        .rotate(-35, { origin: [300, 420] });
      doc.text('DRAFT', 110, 360, { lineBreak: false });
      doc.restore();
    }

    doc
      .fillColor('#111111')
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(h.schoolName, left, 48, { width, align: 'center' });
    if (h.campusName !== h.schoolName)
      doc.font('Helvetica').fontSize(10).text(h.campusName, { width, align: 'center' });
    doc
      .moveDown(0.4)
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(`Payslip - ${monthLabel(s.periodMonth)}`, {
        width,
        align: 'center',
      });
    doc.moveDown(0.8);

    // employee block
    const y0 = doc.y;
    const field = (label: string, value: string, x: number, y: number) => {
      doc.font('Helvetica').fontSize(9).fillColor('#555555').text(label, x, y);
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#111111')
        .text(value, x, y + 11);
    };
    field('Employee', s.name, left, y0);
    field('Staff no', s.staffNo, left + width * 0.45, y0);
    field('Pay period', monthLabel(s.periodMonth), left + width * 0.72, y0);
    field('Working days', String(s.workingDays), left, y0 + 30);
    field('Paid days', String(s.paidDays), left + width * 0.45, y0 + 30);
    field('Unpaid leave days', String(s.lwpDays), left + width * 0.72, y0 + 30);
    doc
      .moveTo(left, y0 + 58)
      .lineTo(left + width, y0 + 58)
      .strokeColor('#999999')
      .stroke();

    // earnings | deductions
    const colW = (width - 16) / 2;
    const tableTop = y0 + 68;
    const block = (title: string, x: number, lines: PayslipDetail['lines'], total: number) => {
      let y = tableTop;
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111').text(title, x, y);
      doc.text('Amount (Tk)', x, y, { width: colW, align: 'right' });
      y += 16;
      doc.font('Helvetica').fontSize(10);
      for (const l of lines) {
        const label = l.quantity !== null ? `${l.name} x ${l.quantity}` : l.name;
        doc.text(l.note ? `${label} - ${l.note}` : label, x, y, { width: colW - 90 });
        doc.text(tk(l.amountPaisa), x, y, { width: colW, align: 'right' });
        y += 15;
      }
      return { y, total };
    };
    const earnings = s.lines.filter((l) => l.kind === 'earning');
    const deductions = s.lines.filter((l) => l.kind === 'deduction');
    const e = block('Earnings', left, earnings, s.grossPaisa);
    const d = block('Deductions', left + colW + 16, deductions, s.deductionsPaisa);
    const totalsY = Math.max(e.y, d.y) + 6;
    doc
      .moveTo(left, totalsY - 3)
      .lineTo(left + width, totalsY - 3)
      .strokeColor('#cccccc')
      .stroke();
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Gross earnings', left, totalsY);
    doc.text(tk(s.grossPaisa), left, totalsY, { width: colW, align: 'right' });
    doc.text('Total deductions', left + colW + 16, totalsY);
    doc.text(tk(s.deductionsPaisa), left + colW + 16, totalsY, { width: colW, align: 'right' });

    // net pay
    const netY = totalsY + 28;
    doc.rect(left, netY, width, 44).fillAndStroke('#f2f5f9', '#c5ced9');
    doc
      .fillColor('#111111')
      .font('Helvetica-Bold')
      .fontSize(12)
      .text('Net pay', left + 10, netY + 8);
    doc.text(`Tk ${tk(s.netPaisa)}`, left, netY + 8, { width: width - 10, align: 'right' });
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(takaInWords(Math.max(0, s.netPaisa)), left + 10, netY + 27, {
        width: width - 20,
      });

    let noteY = netY + 58;
    doc.fontSize(9).fillColor('#444444');
    const employer = s.lines.filter((l) => l.kind === 'employer_contribution');
    if (employer.length) {
      doc.text(
        `Employer contributions (not deducted): ${employer.map((l) => `${l.name} Tk ${tk(l.amountPaisa)}`).join(', ')}`,
        left,
        noteY,
        { width },
      );
      noteY = doc.y + 4;
    }
    if (s.taxPaisa > 0) {
      doc.text(`Income tax deducted at source this month: Tk ${tk(s.taxPaisa)}`, left, noteY, { width });
    }

    doc
      .fontSize(8)
      .fillColor('#777777')
      .text(
        `Computer-generated payslip${draft ? ' (DRAFT - payroll not locked)' : ''}. Generated ${h.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
        left,
        doc.page.height - doc.page.margins.bottom - 24,
        { width, align: 'center', lineBreak: false },
      );
  }
}
