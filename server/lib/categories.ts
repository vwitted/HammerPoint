// Infer category based on lot title and details for US & UK auctions
export function inferCategoryFromTitle(title: string, details?: string): string {
  const text = `${title} ${details || ""}`.toLowerCase();
  if (/biotech|genetic|dna|pcr|massarray|hplc|chromatograph|spectrom|analyzer|lab|medical|centrifuge|incubator|biometra/i.test(text)) {
    return "Laboratory & Biotech";
  }
  if (/robot|robotic|automation|arm|vision system|actuator|motion control/i.test(text)) {
    return "Robotics & Automation";
  }
  if (/server|switch|cisco|dell|optiplex|workstation|laptop|computer|networking|sfp|transceiver|nvme|ssd/i.test(text)) {
    return "IT & Telecom Equipment";
  }
  if (/test|measurement|oscilloscope|keysight|agilent|tektronix|multimeter|analyzer|fluke/i.test(text)) {
    return "Electronics & Test Equipment";
  }
  if (/semiconductor|wafer|laser|optical|slide|lens|vacuum|chamber|plasma|mfa-cc/i.test(text)) {
    return "Semiconductor & Photonics";
  }
  if (/agriculture|crop|tractor|irrigation|climate|hvac|water treatment/i.test(text)) {
    return "Agricultural & Environmental";
  }
  if (/car|auto|vehicle|truck|buick|classic car|fleet/i.test(text)) {
    return "Vehicles & Fleet";
  }
  if (/machin|cnc|lathe|mill|press|tool|drill|saw|warehouse|forklift/i.test(text)) {
    return "Industrial & Machinery";
  }
  return "Surplus Tech & Equipment";
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
  const lower = (titleHint || "").toLowerCase();
  if (lower.includes("lathe") || lower.includes("milling") || lower.includes("cnc") || lower.includes("machin") || lower.includes("press") || lower.includes("weld") || lower.includes("generator") || lower.includes("saw")) return "Machinery";
  if (lower.includes("catering") || lower.includes("oven") || lower.includes("fridge") || lower.includes("freezer") || lower.includes("fryer") || lower.includes("cooker")) return "Catering";
  if (lower.includes("car") || lower.includes("van") || lower.includes("truck") || lower.includes("trailer") || lower.includes("forklift") || lower.includes("vehicle")) return "Vehicles";
  if (lower.includes("desk") || lower.includes("chair") || lower.includes("table") || lower.includes("cabinet") || lower.includes("furniture")) return "Furniture";
  if (lower.includes("laptop") || lower.includes("computer") || lower.includes("screen") || lower.includes("server") || lower.includes("tech") || lower.includes("electronic")) return "Electronics";

  return "General";
}
