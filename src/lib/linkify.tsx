import React from "react";

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/gi;

/** Render text with auto-detected URLs converted to anchor tags. Preserves newlines. */
export function linkify(text: string): React.ReactNode {
  if (!text) return null;
  const lines = text.split("\n");
  return lines.map((line, li) => {
    const parts: React.ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(line)) !== null) {
      if (m.index > last) parts.push(line.slice(last, m.index));
      parts.push(
        <a
          key={`${li}-${m.index}`}
          href={m[0]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-primary hover:opacity-80 break-all"
        >
          {m[0]}
        </a>,
      );
      last = m.index + m[0].length;
    }
    if (last < line.length) parts.push(line.slice(last));
    return (
      <React.Fragment key={li}>
        {parts}
        {li < lines.length - 1 && <br />}
      </React.Fragment>
    );
  });
}
