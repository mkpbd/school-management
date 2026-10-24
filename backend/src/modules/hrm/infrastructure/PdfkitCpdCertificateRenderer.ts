import PDFDocument from 'pdfkit';
import type { CpdCertificate, CpdCertificateRenderer } from '../application/CpdUseCases.js';

const longDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`),
  );

/** Landscape A4 certificate of completion with the certificate number for verification. */
export class PdfkitCpdCertificateRenderer implements CpdCertificateRenderer {
  render(c: CpdCertificate): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margin: 50,
        info: { Title: `CPD certificate ${c.certificateNo}` },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (b: Buffer) => chunks.push(b));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const w = doc.page.width;
      const h = doc.page.height;
      doc
        .rect(24, 24, w - 48, h - 48)
        .lineWidth(3)
        .strokeColor('#1f4e79')
        .stroke();
      doc
        .rect(32, 32, w - 64, h - 64)
        .lineWidth(0.8)
        .strokeColor('#9fb3c8')
        .stroke();
      const center = (text: string, y: number, size: number, font = 'Helvetica', color = '#1d2733') =>
        doc
          .font(font)
          .fontSize(size)
          .fillColor(color)
          .text(text, 60, y, { width: w - 120, align: 'center' });
      center(c.school, 80, 20, 'Helvetica-Bold', '#1f4e79');
      center('Certificate of Continuing Professional Development', 130, 26, 'Helvetica-Bold');
      center('This is to certify that', 190, 13, 'Helvetica', '#5b6b7f');
      center(c.staffName, 215, 30, 'Helvetica-Bold');
      center('has successfully completed', 265, 13, 'Helvetica', '#5b6b7f');
      center(c.title, 290, 20, 'Helvetica-Bold');
      center(`${c.hours} CPD hour${c.hours === 1 ? '' : 's'}  ·  completed on ${longDate(c.completedOn)}`, 335, 13);
      if (c.trainer) center(`Facilitated by ${c.trainer}`, 360, 12, 'Helvetica', '#5b6b7f');
      doc
        .moveTo(w / 2 - 120, h - 140)
        .lineTo(w / 2 + 120, h - 140)
        .lineWidth(0.8)
        .strokeColor('#1d2733')
        .stroke();
      center('Principal', h - 132, 11, 'Helvetica', '#5b6b7f');
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#5b6b7f')
        .text(`Certificate no. ${c.certificateNo}`, 60, h - 80, {
          width: w - 120,
          align: 'center',
        });
      doc.end();
    });
  }
}
