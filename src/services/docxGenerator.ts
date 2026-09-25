import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, WidthType } from 'docx';

export const generateCMDBDocx = async (metricsData: any): Promise<Buffer> => {
  const sections: any[] = [];
  
  // Title
  sections.push(
    new Paragraph({
      text: 'CMDB Report',
      heading: HeadingLevel.TITLE,
    })
  );
  
  sections.push(
    new Paragraph({
      text: `Generated on: ${new Date().toLocaleString()}`,
    })
  );

  const parsedMetrics = typeof metricsData === 'string' ? JSON.parse(metricsData) : metricsData;
  const dataList = Array.isArray(parsedMetrics) ? parsedMetrics : [parsedMetrics];

  for (const item of dataList) {
    sections.push(
      new Paragraph({
        text: `Server: ${item.name || 'Unknown'} (${item.type || 'N/A'})`,
        heading: HeadingLevel.HEADING_1,
      })
    );
    
    if (item.metrics) {
      sections.push(
        new Paragraph({
          children: [
            new TextRun({ text: 'Metrics Summary:', bold: true })
          ]
        })
      );
      
      const metricsText = JSON.stringify(item.metrics, null, 2);
      sections.push(
        new Paragraph({
          text: metricsText,
        })
      );
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: sections,
      },
    ],
  });

  return await Packer.toBuffer(doc);
};
