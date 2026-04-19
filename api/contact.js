// ─────────────────────────────────────────────────────────────
//  /api/contact.js  —  Vercel Serverless Function
//  Receives form data, checks bot fields, verifies Turnstile,
//  then sends an email to the client via Gmail + Nodemailer.
//
//  Environment variables required (set in Vercel dashboard):
//    GMAIL_USER          — your agency Gmail address
//    GMAIL_APP_PASSWORD  — Gmail App Password (NOT your login password)
//    CLIENT_EMAIL        — the mechanic's email address
//    TURNSTILE_SECRET    — Cloudflare Turnstile secret key
// ─────────────────────────────────────────────────────────────

const nodemailer = require('nodemailer');

module.exports = async function handler(req, res) {

  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    name,
    phone,
    email,
    vehicle,
    message,
    botField,
  } = req.body;

  const turnstileToken = req.body['cf-turnstile-response'];

  // ── Honeypot check ──────────────────────────────────────────
  // Bots fill hidden fields; humans never see it. Silent reject.
  if (botField) {
    return res.status(200).json({ ok: true });
  }

  // ── Basic field validation ───────────────────────────────────
  if (!name || !phone || !email || !message) {
    return res.status(400).json({ error: 'Please fill in all required fields.' });
  }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  // ── Turnstile verification ───────────────────────────────────
  // Calls Cloudflare's API server-side to confirm the widget was solved.
  const turnstileSecret = process.env.TURNSTILE_SECRET;
  if (turnstileSecret) {
    if (!turnstileToken) {
      return res.status(400).json({ error: 'Please complete the bot verification.' });
    }
    try {
      const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: turnstileSecret,
          response: turnstileToken,
          remoteip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
        }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyData.success) {
        return res.status(400).json({ error: 'Bot verification failed. Please refresh and try again.' });
      }
    } catch (err) {
      console.error('Turnstile error:', err);
      // Don't block the submission if Turnstile itself errors — just log it
    }
  }

  // ── Send email via Gmail SMTP ────────────────────────────────
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    // ── Email HTML template (matches the site's dark/gold aesthetic) ──
    const vehicleRow = vehicle
      ? `<tr>
           <td style="padding:10px 0;border-bottom:1px solid #2a2a2a;color:#888;font-size:13px;width:110px;vertical-align:top;">Vehicle</td>
           <td style="padding:10px 0;border-bottom:1px solid #2a2a2a;color:#e8e4dc;">${escHtml(vehicle)}</td>
         </tr>`
      : '';

    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:20px;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:580px;margin:0 auto;">

    <!-- Header -->
    <div style="background:#141414;padding:24px 28px;border-left:3px solid #B8966A;">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#B8966A;">New Enquiry</p>
      <h1 style="margin:0;font-size:22px;color:#e8e4dc;font-weight:400;">Crescent Prestige Autohaus</h1>
    </div>

    <!-- Body -->
    <div style="background:#1a1a1a;padding:28px;border:1px solid #2a2a2a;border-top:none;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #2a2a2a;color:#888;font-size:13px;width:110px;">Name</td>
          <td style="padding:10px 0;border-bottom:1px solid #2a2a2a;color:#e8e4dc;">${escHtml(name)}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #2a2a2a;color:#888;font-size:13px;">Phone</td>
          <td style="padding:10px 0;border-bottom:1px solid #2a2a2a;">
            <a href="tel:${escHtml(phone)}" style="color:#B8966A;text-decoration:none;">${escHtml(phone)}</a>
          </td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #2a2a2a;color:#888;font-size:13px;">Email</td>
          <td style="padding:10px 0;border-bottom:1px solid #2a2a2a;">
            <a href="mailto:${escHtml(email)}" style="color:#B8966A;text-decoration:none;">${escHtml(email)}</a>
          </td>
        </tr>
        ${vehicleRow}
        <tr>
          <td style="padding:14px 0 0;color:#888;font-size:13px;vertical-align:top;">Message</td>
          <td style="padding:14px 0 0;color:#e8e4dc;line-height:1.65;font-size:14px;">${escHtml(message).replace(/\n/g,'<br>')}</td>
        </tr>
      </table>
    </div>

    <!-- Footer -->
    <div style="background:#111;padding:14px 28px;border:1px solid #2a2a2a;border-top:none;">
      <p style="margin:0;color:#555;font-size:11px;">
        Hit <strong style="color:#777">Reply</strong> to respond directly to ${escHtml(name)} — their email is set as reply-to.
      </p>
    </div>

  </div>
</body>
</html>`;

    await transporter.sendMail({
      from:    `"Crescent Prestige Autohaus Website" <${process.env.GMAIL_USER}>`,
      to:      process.env.CLIENT_EMAIL,
      replyTo: email,
      subject: `New Enquiry from ${name}${vehicle ? ' — ' + vehicle : ''}`,
      html,
    });

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Email send error:', err);
    return res.status(500).json({ error: 'Failed to send your enquiry. Please call us directly on (02) 9746 6533.' });
  }
};

// ── Tiny HTML escape helper — prevents injection via form inputs ──
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}
