import PDFDocument from 'pdfkit';

export const generateCMDBPdf = (metricsData: any): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const buffers: Buffer[] = [];

      doc.on('data', (buffer) => buffers.push(buffer));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      // Title
      doc.fontSize(20).text('CMDB / Healthcheck Report', { align: 'center' });
      doc.moveDown();

      // Date & Server Name/Type
      doc.fontSize(12).text(`Date: ${new Date().toLocaleString()}`, { align: 'right' });
      doc.moveDown();

      doc.fontSize(14).text(`Server Name: ${metricsData?.name || 'Unknown'}`);
      doc.text(`Server Type: ${metricsData?.type || 'Unknown'}`);
      doc.moveDown(2);

      // Metrics
      doc.fontSize(16).text('Metrics Details', { underline: true });
      doc.moveDown();

      if (metricsData && metricsData.metrics) {
        for (const [key, value] of Object.entries(metricsData.metrics)) {
          if (typeof value === 'object' && value !== null) {
            doc.fontSize(12).font('Helvetica-Bold').text(`${key}:`);
            for (const [subKey, subValue] of Object.entries(value)) {
              doc.fontSize(12).font('Helvetica').text(`  ${subKey}: ${subValue}`);
            }
          } else {
            doc.fontSize(12).font('Helvetica-Bold').text(`${key}: `, { continued: true })
               .font('Helvetica').text(`${value}`);
          }
          doc.moveDown(0.5);
        }
      } else {
        doc.fontSize(12).text('No metrics data provided.');
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};
