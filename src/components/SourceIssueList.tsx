import { sourceChip, type ChipTone, type SourceStreamStatus } from "../utils/sourceStatus";

// Chip colours for each source's search status (on the dark status panels).
export const CHIP_TONE_CLASS: Record<ChipTone, string> = {
  ok: "bg-emerald-950/90 text-emerald-300 border border-emerald-800/80",
  searching: "bg-blue-950/90 text-blue-300 border border-blue-800/80 animate-pulse",
  warning: "bg-amber-950/90 text-amber-300 border border-amber-800/80",
  problem: "bg-red-950/90 text-red-300 border border-red-800/80",
};

// One line per problem a source ran into, e.g. "Easy Live Auction: bid lookups blocked
// (Cloudflare challenge, 35×)". Written out rather than in a tooltip so it reads on phones.
export default function SourceIssueList({ sources }: { sources: Record<string, SourceStreamStatus> }) {
  const lines = (Object.entries(sources) as [string, SourceStreamStatus][]).flatMap(([key, source]) => {
    const tone = sourceChip(source).tone;
    return (source.issues ?? []).map((issue, i) => ({ key: `${key}-${i}`, tone, text: `${source.name}: ${issue.summary}` }));
  });
  if (lines.length === 0) return null;

  return (
    <ul className="space-y-0.5 text-[10px] font-mono leading-snug">
      {lines.map((line) => (
        <li key={line.key} className={line.tone === "problem" ? "text-red-300" : "text-amber-300"}>
          {line.tone === "problem" ? "✕" : "⚠"} {line.text}
        </li>
      ))}
    </ul>
  );
}
