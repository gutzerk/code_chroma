import { Fragment, useMemo, type ReactNode } from "react";

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const tok = m[0];
    if (m[1]) out.push(<code key={at}>{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={at}>{tok.slice(2, -2)}</strong>);
    else if (m[3]) out.push(<em key={at}>{tok.slice(1, -1)}</em>);
    else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok) ?? [];
      out.push(
        /^(https?:|mailto:)/i.test(href ?? "") ? (
          <a key={at} href={href} target="_blank" rel="noreferrer noopener">
            {label}
          </a>
        ) : (
          label
        ),
      );
    }
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function isMarkdownFile(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

/** A small dependency-free Markdown renderer (headings, lists, quotes, fences, inline); builds elements, never HTML. */
export function MarkdownPreview({ source }: { source: string }) {
  const blocks = useMemo(() => {
    const lines = source.split(/\r?\n/);
    const nodes: ReactNode[] = [];
    let i = 0;
    let key = 0;
    while (i < lines.length) {
      const line = lines[i] ?? "";
      const fence = /^```/.exec(line);
      if (fence) {
        const body: string[] = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i] ?? "")) body.push(lines[i++] ?? "");
        i++;
        nodes.push(
          <pre key={key++}>
            <code>{body.join("\n")}</code>
          </pre>,
        );
        continue;
      }
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        const Tag = `h${heading[1]!.length}` as "h1";
        nodes.push(<Tag key={key++}>{inline(heading[2]!)}</Tag>);
        i++;
        continue;
      }
      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        const ordered = /^\s*\d+\./.test(line);
        const items: ReactNode[] = [];
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i] ?? "")) {
          items.push(<li key={i}>{inline((lines[i] ?? "").replace(/^\s*([-*+]|\d+\.)\s+/, ""))}</li>);
          i++;
        }
        nodes.push(ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
        continue;
      }
      if (/^>\s?/.test(line)) {
        const quote: string[] = [];
        while (i < lines.length && /^>\s?/.test(lines[i] ?? "")) quote.push((lines[i++] ?? "").replace(/^>\s?/, ""));
        nodes.push(<blockquote key={key++}>{inline(quote.join(" "))}</blockquote>);
        continue;
      }
      if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
        nodes.push(<hr key={key++} />);
        i++;
        continue;
      }
      if (line.trim() === "") {
        i++;
        continue;
      }
      const para: string[] = [];
      while (
        i < lines.length &&
        (lines[i] ?? "").trim() !== "" &&
        !/^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+\.)\s+)/.test(lines[i] ?? "")
      ) {
        para.push(lines[i++] ?? "");
      }
      nodes.push(<p key={key++}>{inline(para.join(" "))}</p>);
    }
    return nodes;
  }, [source]);

  return (
    <div className="markdown-preview" data-testid="markdown-preview">
      {blocks.map((b, idx) => (
        <Fragment key={idx}>{b}</Fragment>
      ))}
    </div>
  );
}
