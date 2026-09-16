// Infer category based on lot title and details for US & UK auctions
export function inferCategoryFromTitle(title: string, details?: string): string {
  const text = `${title} ${details || ""}`;
  // Whole words only; \w* allows endings such as "robotic", "spectrometer", "machining".
  const has = (pattern: string) => new RegExp(`\\b(${pattern})\\b`, "i").test(text);
  if (has("biotech\\w*|genetic\\w*|dna|pcr|massarray|hplc|chromatograph\\w*|spectrom\\w*|analy[sz]ers?|labs?|laborator\\w*|medical|centrifuges?|incubators?|biometra")) {
    return "Laboratory & Biotech";
  }
  if (has("robot\\w*|automation|vision systems?|actuators?|motion control")) {
    return "Robotics & Automation";
  }
  if (has("servers?|switch(es)?|cisco|dell|optiplex|workstations?|laptops?|computers?|networking|sfp|transceivers?|nvme|ssds?")) {
    return "IT & Telecom Equipment";
  }
  if (has("test(er|ers|ing)?|measurement|oscilloscopes?|keysight|agilent|tektronix|multimeters?|fluke")) {
    return "Electronics & Test Equipment";
  }
  if (has("semiconductors?|wafers?|lasers?|optical|slides?|lens(es)?|vacuum|chambers?|plasma|mfa-cc")) {
    return "Semiconductor & Photonics";
  }
  if (has("agricultur\\w*|crops?|tractors?|irrigation|climate|hvac|water treatment")) {
    return "Agricultural & Environmental";
  }
  if (has("cars?|auto(mobile|motive)?s?|vehicles?|trucks?|buick|fleet")) {
    return "Vehicles & Fleet";
  }
  if (has("machin\\w*|cnc|lathes?|mill(s|ing)?|press(es)?|tools?|drills?|saws?|warehouse|forklifts?")) {
    return "Industrial & Machinery";
  }
  return "Surplus Tech & Equipment";
}

// Keyword categories shared by the UK sources (BidSpotter, The Saleroom fallback, LiveAuctioneers,
// Easy Live, BPI). Keywords match whole words (plurals allowed), so "table" doesn't match "stable"
// and "car" doesn't match "card". The first matching category wins.
const TITLE_CATEGORIES: [category: string, keywords: string[]][] = [
  ["Machinery", ["lathe", "milling", "cnc", "machine", "machinery", "generator", "press", "welder", "welding", "saw", "compressor"]],
  ["Catering", ["catering", "oven", "fridge", "freezer", "fryer", "cooker", "restaurant"]],
  ["Vehicles", ["car", "van", "truck", "lorry", "trailer", "vehicle", "tractor", "forklift"]],
  ["Furniture", ["furniture", "table", "chair", "armchair", "desk", "cabinet", "sofa"]],
  ["Electronics", ["laptop", "computer", "screen", "monitor", "server", "tech", "electronic", "electronics", "phone"]],
];

const wordPattern = (words: string[]) => new RegExp(`\\b(${words.join("|")})(s|es)?\\b`, "i");
const TITLE_CATEGORY_PATTERNS = TITLE_CATEGORIES.map(([category, words]) => [category, wordPattern(words)] as const);

export function categorizeByTitle(title: string, fallback: string): string {
  const text = title || "";
  for (const [category, pattern] of TITLE_CATEGORY_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return fallback;
}

// Helper to safely extract category string from diverse API payload structures
export function extractCategoryName(categoryField: any, titleHint: string = ""): string {
  if (typeof categoryField === "string" && categoryField.trim()) {
    return categoryField.trim();
  }
  if (categoryField && typeof categoryField === "object") {
    if (typeof categoryField.name === "string" && categoryField.name.trim()) return categoryField.name.trim();
    if (categoryField.name && typeof categoryField.name.en === "string" && categoryField.name.en.trim()) return categoryField.name.en.trim();
    if (typeof categoryField.title === "string" && categoryField.title.trim()) return categoryField.title.trim();
    if (categoryField.title && typeof categoryField.title.en === "string" && categoryField.title.en.trim()) return categoryField.title.en.trim();
    if (typeof categoryField.en === "string" && categoryField.en.trim()) return categoryField.en.trim();
  }
  if (Array.isArray(categoryField) && categoryField.length > 0) {
    return extractCategoryName(categoryField[0], titleHint);
  }

  // Fallback to title keywords
  return categorizeByTitle(titleHint, "General");
}
