import sanitizeHtml from 'sanitize-html'

// The restricted rich text format (TSPACK-11): what RichTextControl's toolbar produces, nothing
// else. sanitize-html parses with htmlparser2 (no DOM), so the server on Workers and the admin's
// live preview run the same code.
const options: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'a',
    'ul',
    'ol',
    'li',
    'h2',
    'h3',
    'blockquote',
  ],
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowProtocolRelative: false,
  // Text of dropped tags stays, except for these, whose content is never text.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'svg'],
}

/** Sanitizes editor HTML against the allowlist; empty results become null. */
export const sanitizeRichText = (html: string): string | null => {
  const clean = sanitizeHtml(html, options).trim()
  return clean === '' || clean === '<p></p>' ? null : clean
}
