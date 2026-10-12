export default {
  nav: { log: 'Email log' },
  log: {
    title: 'Email log',
    description: 'Every email the system decided to send in the last 90 days, with its outcome.',
    empty: 'No emails yet.',
    failed: 'The email log could not be loaded.',
    columns: {
      createdAt: 'Queued',
      templateKey: 'Template',
      recipients: 'Recipients',
      subject: 'Subject',
      status: 'Status',
      attempts: 'Attempts',
    },
    status: { queued: 'Queued', sent: 'Sent', failed: 'Failed', skipped: 'Skipped' },
  },
  permissions: { 'emails.log.view': 'View the email log' },
}
