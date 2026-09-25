import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

export const generateCorporateDocx = async (metrics: any): Promise<Buffer> => {
  const templatePath = path.resolve(__dirname, '../assets/template.docx');
  if (!fs.existsSync(templatePath)) {
    throw new Error('Template file not found');
  }

  const content = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(content);
  
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });

  const parsedMetrics = typeof metrics === 'string' ? JSON.parse(metrics) : metrics;
  doc.render({ metrics: parsedMetrics });

  const buf = doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });

  return buf;
};
