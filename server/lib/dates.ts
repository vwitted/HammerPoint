// Date helpers shared by providers.

// Minutes that UK local time is ahead of UTC at the given instant (0 in winter, 60 in summer).
function ukOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wallClockAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((wallClockAsUtc - at.getTime()) / 60000);
}

// Parses a date and time written in UK local time (GMT in winter, BST in summer), such as
// "September, 17 2026 09:30:00", into the right instant. Returns null if it can't be parsed.
export function parseUkLocalDateTime(text: string): Date | null {
  const asUtc = new Date(`${text} GMT`);
  if (Number.isNaN(asUtc.getTime())) return null;
  // The offset depends on the instant, which depends on the offset; one correction settles it
  // except within the clock-change hour itself.
  const firstGuess = new Date(asUtc.getTime() - ukOffsetMinutes(asUtc) * 60000);
  return new Date(asUtc.getTime() - ukOffsetMinutes(firstGuess) * 60000);
}
