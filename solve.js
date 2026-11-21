// Ixcia's fast broken-CSV reader, an entry for make.fun's
// csv-reader-speed-01-run-20261121. run(input) returns exactly the
// answer csv-reader 1.0.0 gives for {text, header} — {columns, rows,
// errors} under its written broken-row policy — but reads the text in
// one pass and slices fields out of the input instead of building
// them character by character, which is where the house reader spends
// its CPU.
//
// The policy, as implemented below:
//   - a leading U+FEFF is dropped; records end at LF or CRLF and a
//     line with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next undoubled quote,
//     "" inside it is one quote, and CRLF or a lone CR inside becomes
//     LF; text after the closing quote, up to the next comma or line
//     break, is appended as unquoted text (quote_junk when it adds a
//     character); a quote that never closes is a literal character
//     and the rest is re-read as an unquoted field
//     (unterminated_quote, the line counter reset to the line the
//     quoted field started on);
//   - a quote inside an unquoted field is literal; fields are never
//     trimmed or converted;
//   - the first kept record sets the width; with header true it is
//     the columns and the rest are rows, otherwise columns is null
//     and every record is a row; short records are padded with ""
//     (short_row, with fields: their count) and long ones cut
//     (long_row, with extra: the cut fields);
//   - each error is {code, line, row}: line the 1-based line its
//     record starts on (every LF, CRLF and lone CR inside quoted
//     fields counted), row its record's index in rows (null for the
//     header), in the order met.

const ENDED_COMMA = 0;
const ENDED_BREAK = 1;
const ENDED_TEXT = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on, and the index in
  // rows it takes (null while it could still be the header).
  let recordLine = 1;
  let recordRow = null;

  // One field's reading, shared through these three variables.
  let fieldValue = '';
  let fieldEnded = ENDED_TEXT;
  let fieldQuoted = false;

  function fail(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads an unquoted field: the scan starts at pos with `prefix`
  // already in hand ('' for a plain field, '"' for the re-read after
  // an unterminated quote, a quoted value for the junk that follows a
  // closing quote). Sets fieldValue and fieldEnded.
  function readUnquoted(prefix) {
    let segStart = pos;
    let parts = null;
    let i = pos;
    while (i < len) {
      const c = text.charCodeAt(i);
      if (c === 44) {
        // ','
        fieldValue =
          parts === null
            ? prefix + text.slice(segStart, i)
            : (parts.push(text.slice(segStart, i)), prefix + parts.join(''));
        fieldEnded = ENDED_COMMA;
        pos = i + 1;
        return;
      }
      if (c === 10) {
        // LF
        fieldValue =
          parts === null
            ? prefix + text.slice(segStart, i)
            : (parts.push(text.slice(segStart, i)), prefix + parts.join(''));
        fieldEnded = ENDED_BREAK;
        pos = i + 1;
        line += 1;
        return;
      }
      if (c === 13) {
        // CR: CRLF ends the field; a lone CR is dropped (stray_cr).
        if (text.charCodeAt(i + 1) === 10) {
          fieldValue =
            parts === null
              ? prefix + text.slice(segStart, i)
              : (parts.push(text.slice(segStart, i)), prefix + parts.join(''));
          fieldEnded = ENDED_BREAK;
          pos = i + 2;
          line += 1;
          return;
        }
        if (parts === null) parts = [];
        parts.push(text.slice(segStart, i));
        fail('stray_cr');
        i += 1;
        segStart = i;
        continue;
      }
      i += 1;
    }
    fieldValue =
      parts === null
        ? prefix + text.slice(segStart, len)
        : (parts.push(text.slice(segStart, len)), prefix + parts.join(''));
    fieldEnded = ENDED_TEXT;
    pos = len;
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let segStart = open + 1;
    let parts = null;
    let i = segStart;
    while (i < len) {
      const c = text.charCodeAt(i);
      if (c === 34) {
        // '"': a doubled quote is one literal quote; a single one closes.
        if (text.charCodeAt(i + 1) === 34) {
          if (parts === null) parts = [];
          parts.push(text.slice(segStart, i), '"');
          i += 2;
          segStart = i;
          continue;
        }
        fieldValue =
          parts === null
            ? text.slice(segStart, i)
            : (parts.push(text.slice(segStart, i)), parts.join(''));
        pos = i + 1;
        // How the field ends is decided by what follows the quote.
        if (pos >= len) {
          fieldEnded = ENDED_TEXT;
          return;
        }
        const d = text.charCodeAt(pos);
        if (d === 44) {
          pos += 1;
          fieldEnded = ENDED_COMMA;
          return;
        }
        if (d === 10) {
          pos += 1;
          line += 1;
          fieldEnded = ENDED_BREAK;
          return;
        }
        if (d === 13 && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          fieldEnded = ENDED_BREAK;
          return;
        }
        // Anything else is junk read on as unquoted text.
        const quotedValue = fieldValue;
        readUnquoted(quotedValue);
        if (fieldValue.length > quotedValue.length) fail('quote_junk');
        return;
      }
      if (c === 13) {
        // CRLF and a lone CR inside quotes each become one LF.
        if (parts === null) parts = [];
        parts.push(text.slice(segStart, i), '\n');
        line += 1;
        i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
        segStart = i;
        continue;
      }
      if (c === 10) line += 1;
      i += 1;
    }
    // The quote never closes: it is a literal character, and the text
    // after it is read again as an unquoted field, the line counter
    // reset to the line the quoted field started on.
    pos = open + 1;
    line = openLine;
    fail('unterminated_quote');
    readUnquoted('"');
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    do {
      fieldQuoted = text.charCodeAt(pos) === 34;
      if (fieldQuoted) readQuoted();
      else readUnquoted('');
      fields.push(fieldValue);
    } while (fieldEnded === ENDED_COMMA);

    // A record whose single field is empty and was not quoted is no
    // record at all (a line of only stray CRs); its errors stay.
    if (fields.length === 1 && fields[0] === '' && !fieldQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({
        code: 'short_row',
        line: recordLine,
        row: recordRow,
        fields: fields.length,
      });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({
        code: 'long_row',
        line: recordLine,
        row: recordRow,
        extra: fields.splice(width),
      });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
