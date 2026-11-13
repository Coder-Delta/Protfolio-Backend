import nodemailer from 'nodemailer';

let transporter;

const requiredValue = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured to send contact notifications.`);
  return value;
};

const getTransporter = () => {
  if (transporter) return transporter;

  const host = requiredValue('SMTP_HOST');
  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be a valid TCP port.');
  }

  const secureValue = process.env.SMTP_SECURE?.toLowerCase();
  if (secureValue && !['true', 'false'].includes(secureValue)) {
    throw new Error('SMTP_SECURE must be true or false.');
  }

  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  if (Boolean(user) !== Boolean(pass)) {
    throw new Error('SMTP_USER and SMTP_PASS must both be configured, or both omitted.');
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: secureValue ? secureValue === 'true' : port === 465,
    ...(user && pass ? { auth: { user, pass } } : {}),
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return transporter;
};

export async function sendContactNotification({ name, email, subject, message, createdAt }) {
  const from = requiredValue('CONTACT_EMAIL_FROM');
  const to = requiredValue('CONTACT_EMAIL_TO');
  const safeSubject = subject.replace(/[\r\n]+/g, ' ').trim();

  return getTransporter().sendMail({
    from,
    to,
    replyTo: { name, address: email },
    subject: `Portfolio contact: ${safeSubject}`,
    text: [
      'A new contact request was submitted through the portfolio.',
      '',
      `Name: ${name}`,
      `Email: ${email}`,
      `Subject: ${safeSubject}`,
      `Received: ${createdAt.toISOString()}`,
      '',
      'Message:',
      message,
    ].join('\n'),
  });
}
