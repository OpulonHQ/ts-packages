import { emailTemplate } from '@opulonjs/emails/server'

/** Sent to an invitee: the link where they set their password (valid 7 days). */
export const invitationEmail = emailTemplate({
  key: 'users.invitation',
  audience: 'staff',
  placeholders: { link: 'https://example.com/admin/accept-invitation#token=…' },
  defaults: {
    en: {
      subject: 'You are invited to the admin',
      body:
        '<p>You have been invited to the admin.</p>' +
        '<p><a href="{{link}}">Accept the invitation and set your password</a></p>' +
        '<p>The link is valid for 7 days. If you did not expect this email, ignore it.</p>',
    },
    sk: {
      subject: 'Pozvánka do administrácie',
      body:
        '<p>Dostali ste pozvánku do administrácie.</p>' +
        '<p><a href="{{link}}">Prijať pozvánku a nastaviť heslo</a></p>' +
        '<p>Odkaz platí 7 dní. Ak ste tento e-mail nečakali, ignorujte ho.</p>',
    },
  },
})

/** Sent on a password reset request: the link where the user sets a new password (1 hour). */
export const passwordResetEmail = emailTemplate({
  key: 'users.password_reset',
  audience: 'staff',
  placeholders: { name: 'Jana', link: 'https://example.com/admin/reset-password#token=…' },
  defaults: {
    en: {
      subject: 'Reset your password',
      body:
        '<p>Hello {{name}},</p>' +
        '<p><a href="{{link}}">Set a new password</a></p>' +
        '<p>The link is valid for 1 hour. If you did not ask for it, ignore this email.</p>',
    },
    sk: {
      subject: 'Obnovenie hesla',
      body:
        '<p>Dobrý deň, {{name}},</p>' +
        '<p><a href="{{link}}">Nastaviť nové heslo</a></p>' +
        '<p>Odkaz platí 1 hodinu. Ak ste oň nežiadali, tento e-mail ignorujte.</p>',
    },
  },
})
