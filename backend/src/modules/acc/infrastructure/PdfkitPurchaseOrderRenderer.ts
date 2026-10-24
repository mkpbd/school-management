import PDFDocument from 'pdfkit';
import { takaInWords } from '../../../shared/domain/words.js';
import type { PurchaseOrderDocument, PurchaseOrderPdfRenderer } from '../application/ProcurementUseCases.js';

const tk = (paisa: number) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paisa / 100);
const qty = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(n);
const day = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`),
  );

/**
 * A4 purchase order with pdfkit (built-in Helvetica, English). Cancelled orders carry a CANCELLED watermark; the
 * order is valid only with the authorised signature.
 */
export class PdfkitPurchaseOrderRenderer implements PurchaseOrderPdfRenderer {
  render(po: PurchaseOrderDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 48,
        info: { Title: `Purchase order ${po.poNo}`, Author: po.schoolName },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      this.page(doc, po);
      doc.end();
    });
  }

  private page(doc: PDFKit.PDFDocument, po: PurchaseOrderDocument): void {
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    if (po.status === 'cancelled') {
      doc
        .save()
        .fillColor('#f1d5d5')
        .fontSize(80)
        .rotate(-35, { origin: [300, 420] });
      doc.text('CANCELLED', 60, 360, { lineBreak: false });
      doc.restore();
    }

    doc
      .fillColor('#111111')
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(po.schoolName, left, 48, { width, align: 'center' });
    if (po.campusName !== po.schoolName)
      doc.font('Helvetica').fontSize(10).text(po.campusName, { width, align: 'center' });
    doc.moveDown(0.6).font('Helvetica-Bold').fontSize(13).text('PURCHASE ORDER', { width, align: 'center' });

    // order facts (right) and vendor (left)
    const top = doc.y + 14;
    const half = width / 2 - 10;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#5b6b7f').text('SUPPLIER', left, top);
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#111111')
      .text(po.vendor.name, left, top + 12, { width: half });
    doc.font('Helvetica').fontSize(9);
    for (const line of [
      po.vendor.address,
      po.vendor.phone,
      po.vendor.email,
      po.vendor.binVat ? `BIN: ${po.vendor.binVat}` : null,
      po.vendor.tin ? `TIN: ${po.vendor.tin}` : null,
    ])
      if (line) doc.text(line, { width: half });
    const vendorBottom = doc.y;

    const facts: Array<[string, string]> = [
      ['PO number', po.poNo],
      ['Order date', day(po.orderDate)],
      ['Deliver by', po.expectedOn ? day(po.expectedOn) : '-'],
      ['Requisition', po.requisitionNo ?? '-'],
      ['Payment terms', `${po.vendor.paymentTermsDays} days from bill`],
    ];
    let y = top;
    for (const [k, v] of facts) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#5b6b7f')
        .text(k, left + half + 20, y, { width: 90 });
      doc
        .font('Helvetica-Bold')
        .fillColor('#111111')
        .text(v, left + half + 110, y, { width: half - 90 });
      y += 14;
    }

    // lines
    let rowY = Math.max(vendorBottom, y) + 18;
    const cols = [
      { title: '#', w: 24, align: 'left' as const },
      { title: 'Description', w: width - 24 - 70 - 90 - 100, align: 'left' as const },
      { title: 'Qty', w: 70, align: 'right' as const },
      { title: 'Unit price (Tk)', w: 90, align: 'right' as const },
      { title: 'Amount (Tk)', w: 100, align: 'right' as const },
    ];
    const row = (cells: string[], bold = false, fill?: string) => {
      const h =
        Math.max(
          ...cells.map((c, i) =>
            doc
              .font(bold ? 'Helvetica-Bold' : 'Helvetica')
              .fontSize(9)
              .heightOfString(c, { width: cols[i]!.w - 8 }),
          ),
        ) + 8;
      if (fill) doc.save().rect(left, rowY, width, h).fill(fill).restore();
      let x = left;
      cells.forEach((c, i) => {
        doc
          .fillColor('#111111')
          .font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(9)
          .text(c, x + 4, rowY + 4, { width: cols[i]!.w - 8, align: cols[i]!.align });
        x += cols[i]!.w;
      });
      rowY += h;
      doc
        .moveTo(left, rowY)
        .lineTo(left + width, rowY)
        .strokeColor('#d0d5dd')
        .lineWidth(0.5)
        .stroke();
    };
    row(
      cols.map((c) => c.title),
      true,
      '#eef2f6',
    );
    po.lines.forEach((l, n) =>
      row([String(n + 1), l.description, qty(l.quantity), tk(l.unitPaisa), tk(Math.round(l.quantity * l.unitPaisa))]),
    );
    row(['', 'Total', '', '', tk(po.totalPaisa)], true, '#f7f9fb');
    doc
      .font('Helvetica-Oblique')
      .fontSize(9)
      .text(`In words: ${takaInWords(po.totalPaisa)}`, left, rowY + 8, { width });

    // terms and notes
    doc.moveDown(1).font('Helvetica-Bold').fontSize(10).text('Terms', left);
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(
        [
          po.terms,
          'Prices include delivery to the address above.',
          'VAT and income tax are deducted at source from the bill as required by law; the bill must show the BIN.',
          `Quote the PO number ${po.poNo} on the delivery challan and the bill. Goods are accepted against a goods receipt note; bills are paid for received quantities only.`,
        ]
          .filter(Boolean)
          .map((t) => `- ${t}`)
          .join('\n'),
        { width },
      );

    // signatures
    const sigY = Math.max(doc.y + 50, doc.page.height - doc.page.margins.bottom - 70);
    const sigW = (width - 40) / 2;
    for (const [i, label] of [
      [0, `Prepared by${po.issuedByName ? `: ${po.issuedByName}` : ''}`],
      [1, 'Authorised signature'],
    ] as const) {
      const x = left + i * (sigW + 40);
      doc
        .moveTo(x, sigY)
        .lineTo(x + sigW, sigY)
        .strokeColor('#111111')
        .lineWidth(0.7)
        .stroke();
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#111111')
        .text(label, x, sigY + 4, { width: sigW, align: 'center' });
    }
  }
}
