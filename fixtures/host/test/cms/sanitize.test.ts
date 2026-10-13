import { expect, test } from 'vitest'
import { page, section, useCmsHost } from './helpers.ts'

const host = useCmsHost()

const stored = async (html: string) => {
  const { body } = await host.create(
    page({ en: `/s-${crypto.randomUUID()}` }, [section('rich_text', { body: { en: html } })]),
  )
  return (body.draft.sections[0]?.data as { body?: { en?: string } }).body?.en
}

test('rich text keeps the restricted format', async () => {
  const html =
    '<h2>Title</h2><p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <a href="https://example.test/x">link</a></p>' +
    '<ul><li><p>one</p></li></ul><ol><li><p>two</p></li></ol><blockquote><p>q</p></blockquote>'
  expect(await stored(html)).toBe(html)
})

test.each([
  ['scripts with their content', '<p>a</p><script>alert(1)</script>', '<p>a</p>'],
  ['event handlers', '<p onclick="alert(1)">a</p>', '<p>a</p>'],
  ['javascript: links', '<p><a href="javascript:alert(1)">x</a></p>', '<p><a>x</a></p>'],
  [
    'images and iframes',
    '<p>a<img src="x" onerror="alert(1)"><iframe src="//evil"></iframe></p>',
    '<p>a</p>',
  ],
  ['styles and classes', '<p style="color:red" class="x">a</p>', '<p>a</p>'],
  ['tags outside the format, keeping their text', '<h1>Big</h1><div><span>t</span></div>', 'Bigt'],
  ['svg payloads', '<svg><script>alert(1)</script></svg><p>ok</p>', '<p>ok</p>'],
])('rich text drops %s', async (_, html, clean) => {
  expect(await stored(html)).toBe(clean)
})

test('rich text that sanitizes to nothing is not stored', async () => {
  expect(await stored('<script>x</script>')).toBeUndefined()
})
