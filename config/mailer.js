const nodemailer = require("nodemailer");

// SMTP settings. Defaults match Zoho Mail. Override in .env if needed:
//   EMAIL_HOST=smtp.zoho.com   (smtp.zoho.eu for EU accounts, smtppro.zoho.com for Zoho paid plans on custom domains)
//   EMAIL_PORT=465             (try 587 if 465 times out)
const port = Number(process.env.EMAIL_PORT || 465);

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.zoho.com",
    port,
    secure: port === 465,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    // Fail fast instead of hanging for minutes when the mail server can't be reached.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000
})

module.exports = transporter;
