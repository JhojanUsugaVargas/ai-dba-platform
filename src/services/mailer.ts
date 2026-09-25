import nodemailer from 'nodemailer';

export const sendReportEmail = async (smtpConfig: any, recipient: string, pdfBuffer: Buffer, serverName: string) => {
  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.port === 465,
    auth: {
      user: smtpConfig.user,
      pass: smtpConfig.pass,
    },
  });

  const mailOptions = {
    from: `"DBA AI Platform" <${smtpConfig.user}>`,
    to: recipient,
    subject: `CMDB / Healthcheck Report - ${serverName}`,
    text: `Attached is the CMDB / Healthcheck report for ${serverName}.`,
    attachments: [
      {
        filename: `Reporte_${serverName}.pdf`,
        content: pdfBuffer,
      },
    ],
  };

  const info = await transporter.sendMail(mailOptions);
  return info;
};
