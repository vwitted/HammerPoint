import { scrapeAtgPlatformLots } from "./atg";
import { httpFetch } from "../lib/http";
import { noteFailure, noteResponse } from "../lib/sourceHealth";

// High-performance search for The Saleroom via Algolia InstantSearch API with Puppeteer fallback
export async function scrapeTheSaleroomLots(keyword: string, cancelSignal?: AbortSignal): Promise<any[]> {
  const appId = '2125HT9M59';
  const apiKey = 'b1f48e75f522cc67ff7751f1abd75458';
  const url = `https://${appId}-dsn.algolia.net/1/indexes/lots_sr_en/query`;
  const now = Date.now();
  // Reported only if the Chrome fallback also comes back empty.
  let algoliaProblem: (() => void) | null = null;

  const doAlgoliaQuery = async (numericFilters?: string[]) => {
    const body: any = {
      params: new URLSearchParams({
        query: keyword,
        hitsPerPage: '40',
        page: '0',
        facetFilters: JSON.stringify(['privatePlatformCodes:-SR']),
        ...(numericFilters ? { numericFilters: JSON.stringify(numericFilters) } : {})
      }).toString()
    };

    const res = await httpFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Algolia-Application-Id': appId,
        'X-Algolia-API-Key': apiKey
      },
      body: JSON.stringify(body)
    }, cancelSignal, 15000);
    if (!res.ok) {
      algoliaProblem = () => noteResponse(res, "search");
      throw new Error(`Algolia query status: ${res.status}`);
    }
    return await res.json();
  };

  try {
    // 1. Try querying active/live lots first
    let data = await doAlgoliaQuery([`auctionEndDateTimeUtc>=${now}`]);
    let hits = data.hits || [];

    // If 0 live hits, search without numeric date restriction
    if (hits.length === 0) {
      data = await doAlgoliaQuery();
      hits = data.hits || [];
    }

    if (hits.length > 0) {
      return hits.map((h: any, i: number) => {
        const sym = h.currency === 'USD' ? '$' : (h.currency === 'EUR' ? '€' : '£');
        // The low estimate is not a bid; with no next bid published the price is unknown.
        const startPrice = (h.nextBid && h.nextBid > 0) ? h.nextBid : null;
        const currentPrice = (h.lastBid && h.lastBid > 0) ? h.lastBid : startPrice;
        let estimateStr: string | undefined = undefined;
        if (h.lowEstimate && h.highEstimate) {
          estimateStr = `${sym}${h.lowEstimate} - ${sym}${h.highEstimate}`;
        } else if (h.lowEstimate) {
          estimateStr = `${sym}${h.lowEstimate}`;
        }

        const auctioneer = h.auctioneerName || 'The Saleroom';
        const lotUrl = `https://www.the-saleroom.com/en-gb/auction-catalogues/${h.auctioneerRef || 'auctioneer'}/catalogue-id-${h.auctionRef || 'auction'}/lot-${h.objectID}`;

        return {
          id: `saleroom-${h.objectID || `${Date.now()}-${i}`}`,
          title: h.title || `Lot #${h.lotNumber || i + 1}`,
          url: lotUrl,
          details: h.description ? h.description.replace(/<[^>]*>/g, '').trim().slice(0, 300) : `Lot #${h.lotNumber || ''} from ${auctioneer}`,
          endingDate: h.auctionEndDateTimeUtc ? new Date(h.auctionEndDateTimeUtc).toISOString() : new Date(Date.now() + 4 * 86400000).toISOString(),
          startDate: h.auctionStartDateTimeUtc ? new Date(h.auctionStartDateTimeUtc).toISOString() : new Date().toISOString(),
          address: h.countryName || 'United Kingdom',
          latitude: h._geoloc?.lat || 51.5074,
          longitude: h._geoloc?.lng || -0.1278,
          auctioneer,
          category: h.masterCategoryName || 'Art & Antiques',
          country: h.countryCode || 'UK',
          currency: sym,
          currentPrice: currentPrice != null ? currentPrice : null,
          startPrice: startPrice != null ? startPrice : null,
          estimateStr,
          imageUrl: h.imageUrl || 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=800&q=80',
          status: 'active',
          sourcePlatform: 'The Saleroom'
        };
      });
    }
  } catch (err: any) {
    console.warn('[The Saleroom] Algolia failed, falling back to Puppeteer:', err.message);
    algoliaProblem ??= () => noteFailure(err, "search", cancelSignal);
  }

  // Fallback to Puppeteer for The Saleroom if Algolia query yields 0 or fails
  const lots = await scrapeAtgPlatformLots('https://www.the-saleroom.com', 'The Saleroom', 'saleroom', keyword, cancelSignal);
  if (lots.length === 0) algoliaProblem?.();
  return lots;
}
