import PdfPrinter from 'pdfmake';
import { TDocumentDefinitions } from 'pdfmake/interfaces';

const fonts = {
  Roboto: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique'
  }
};

export const generateComplexPdf = async (metrics: any): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    try {
      const printer = new PdfPrinter(fonts);
      
      const docDefinition: TDocumentDefinitions = {
        defaultStyle: {
          font: 'Roboto'
        },
        content: [
          {
            text: 'Database Health Report',
            style: 'header',
            alignment: 'center',
            margin: [0, 50, 0, 20]
          },
          {
            text: `Generated on: ${new Date().toLocaleString()}`,
            alignment: 'center',
            margin: [0, 0, 0, 50]
          },
          {
            text: 'System Metrics',
            style: 'subheader'
          },
          {
            table: {
              headerRows: 1,
              widths: ['*', '*'],
              body: [
                [
                  { text: 'Metric', style: 'tableHeader', fillColor: '#4CAF50', color: 'white' },
                  { text: 'Value', style: 'tableHeader', fillColor: '#4CAF50', color: 'white' }
                ],
                ['Server Name', metrics?.name || 'N/A'],
                ['Type', metrics?.type || 'N/A'],
                ['Status', metrics?.status || 'N/A'],
                ['Uptime', metrics?.uptime ? `${metrics.uptime} seconds` : 'N/A'],
                ['CPU Usage', metrics?.cpu ? `${metrics.cpu}%` : 'N/A'],
                ['Memory Usage', metrics?.memory ? `${metrics.memory}%` : 'N/A']
              ]
            },
            layout: {
              hLineWidth: function (i, node) { return (i === 0 || i === node.table.body.length) ? 2 : 1; },
              vLineWidth: function (i, node) { return (i === 0 || i === node.table.widths!.length) ? 2 : 1; },
              hLineColor: function (i, node) { return '#4CAF50'; },
              vLineColor: function (i, node) { return '#4CAF50'; }
            }
          }
        ],
        styles: {
          header: {
            fontSize: 24,
            bold: true,
            color: '#2E7D32'
          },
          subheader: {
            fontSize: 18,
            bold: true,
            margin: [0, 20, 0, 10],
            color: '#1565C0'
          },
          tableHeader: {
            bold: true,
            fontSize: 12,
            color: 'white'
          }
        }
      };

      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      const chunks: Buffer[] = [];
      
      pdfDoc.on('data', (chunk) => chunks.push(chunk));
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
      pdfDoc.on('error', (err) => reject(err));
      
      pdfDoc.end();
    } catch (err) {
      reject(err);
    }
  });
};
