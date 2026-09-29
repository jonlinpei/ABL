import { Fragment, type ReactNode } from "react";

/**
 * Renders the small Markdown subset our legal pages use: #/##/### headings,
 * paragraphs, "-" and "1." lists, pipe tables, --- rules, **bold** and
 * [links](url).
 * The documents live as Markdown so they're easy to review and redline.
 */
export function SimpleMarkdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const text = inline(heading[2]!);
      const id = slug(heading[2]!);
      blocks.push(
        level === 1 ? (
          <h1 key={i} id={id} className="text-3xl font-semibold tracking-tight">{text}</h1>
        ) : level === 2 ? (
          <h2 key={i} id={id} className="mt-8 text-xl font-semibold">{text}</h2>
        ) : (
          <h3 key={i} id={id} className="mt-5 font-semibold">{text}</h3>
        ),
      );
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      blocks.push(<hr key={i} className="my-6 border-foreground/15" />);
      i++;
      continue;
    }
    // Pipe tables: a header row, a |---| separator, then rows.
    if (line.trim().startsWith("|") && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const header = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(cells(lines[i++]!));
      blocks.push(
        <div key={i} className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {header.map((h, n) => (
                  <th key={n} className="border-b border-foreground/20 py-2 pr-4 text-left font-semibold">{inline(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, n) => (
                <tr key={n}>
                  {r.map((c, m) => (
                    <td key={m} className="border-b border-foreground/10 py-2 pr-4 align-top">{inline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const ordered = /^\d+\.\s/.test(line);
    if (ordered || /^-\s/.test(line)) {
      const marker = ordered ? /^\d+\.\s+/ : /^-\s+/;
      const items: string[] = [];
      while (i < lines.length && marker.test(lines[i]!)) {
        let item = lines[i]!.replace(marker, "");
        i++;
        // Indented continuation lines belong to the item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!) && !marker.test(lines[i]!.trim())) {
          item += ` ${lines[i]!.trim()}`;
          i++;
        }
        items.push(item);
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={i} className={`mt-3 flex flex-col gap-1.5 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((item, n) => (
            <li key={n}>{inline(item)}</li>
          ))}
        </Tag>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,3}\s|-\s|\d+\.\s|---|\s*\|)/.test(lines[i]!)) {
      para.push(lines[i]!.trim());
      i++;
    }
    // Each paragraph is one source line, so a line break inside one (an
    // address, "Effective date" over "Last updated") is kept.
    blocks.push(
      <p key={i} className="mt-3 leading-relaxed">
        {para.map((l, n) => (
          <Fragment key={n}>
            {n > 0 && <br />}
            {inline(l)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <>{blocks}</>;
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g).map((chunk, i) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(chunk);
    if (bold) return <strong key={i} className="font-semibold">{bold[1]}</strong>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(chunk);
    if (link) {
      const external = /^https?:\/\//.test(link[2]!);
      return (
        <a key={i} href={link[2]} className="underline" {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
          {link[1]}
        </a>
      );
    }
    return <Fragment key={i}>{chunk}</Fragment>;
  });
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
