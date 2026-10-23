/** Text with the divine name (LORD, GOD) set in small capitals, as in printed Bibles. */
export function Typeset({ text }: { text: string }) {
  const parts = text.split(/\b([LG])(ORD|OD)((?:[’']S)?)\b/);
  if (parts.length === 1) return <>{text}</>;
  const out = [];
  for (let i = 0; i < parts.length; i += 4) {
    if (parts[i]) out.push(parts[i]);
    if (i + 1 < parts.length) {
      out.push(parts[i + 1]);
      out.push(
        <span class="sc" key={i}>
          {parts[i + 2]}
          {parts[i + 3]}
        </span>,
      );
    }
  }
  return <>{out}</>;
}
