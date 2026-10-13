/**
 * Parses CSV text per RFC 4180: comma-separated fields, CRLF or LF line ends, fields quoted
 * with `"` may hold commas, line breaks and `""` for a quote. A leading BOM is dropped, and so
 * are blank lines. Returns undefined for an unterminated quote. Spreadsheet exports (Excel,
 * Google Sheets, Rank Math) all write this dialect; the caller bounds the input size.
 */
export const parseCsv = (text: string): Array<Array<string>> | undefined => {
  const rows: Array<Array<string>> = []
  let row: Array<string> = []
  let field = ''
  let quoted = false
  const endRow = () => {
    row.push(field)
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
    field = ''
  }
  const input = text.startsWith('﻿') ? text.slice(1) : text
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!
    if (quoted) {
      if (c !== '"') field += c
      else if (input[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = false
    } else if (c === '"' && field === '') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') endRow()
    else if (c === '\r' && input[i + 1] === '\n') {
      endRow()
      i++
    } else field += c
  }
  if (quoted) return undefined
  endRow()
  return rows
}
