// Tiny dependency-free markdown renderer for assistant chat bubbles: headings,
// bold/italic, inline + fenced code, bullet/numbered lists, and safe links.
// Everything is built as React elements (never innerHTML), so model output can't
// inject markup. Unknown syntax falls through as plain text.
import { Fragment, type ReactNode } from "react";

/** Inline spans: `code`, **bold**, *italic*, [text](https://url). */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${k++}`;
    if (m[1]) out.push(<code key={key}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<b key={key}>{m[2].slice(2, -2)}</b>);
    else if (m[3]) out.push(<i key={key}>{m[3].slice(1, -1)}</i>);
    else if (m[4]) out.push(<a key={key} href={m[6]} target="_blank" rel="noopener noreferrer">{m[5]}</a>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    // fenced code
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // closing fence
      blocks.push(<pre key={k++} className="md-code"><code>{buf.join("\n")}</code></pre>);
      continue;
    }
    // heading
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = Math.min(4, h[1].length);
      const El = (`h${lvl + 2 > 6 ? 6 : lvl + 2}`) as "h3"; // h1→h3 … keep bubble headings small
      blocks.push(<El key={k++} className="md-h">{inline(h[2], `h${k}`)}</El>);
      i++;
      continue;
    }
    // list (bullet or numbered) — consume the run
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+[.)]/.test(line);
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
        i++;
      }
      const kids = items.map((it, j) => <li key={j}>{inline(it, `li${k}-${j}`)}</li>);
      blocks.push(ordered ? <ol key={k++}>{kids}</ol> : <ul key={k++}>{kids}</ul>);
      continue;
    }
    // blank line → paragraph break (skip)
    if (!line.trim()) {
      i++;
      continue;
    }
    // paragraph — consume until a break or a special line
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*•]|\d+[.)])\s)/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={k++}>
        {buf.map((l, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(l, `p${k}-${j}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="md">{blocks}</div>;
}
