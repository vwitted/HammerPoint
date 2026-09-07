const searchParameters = {
  searchTerm: "mariner",
  page: 1,
  pageSize: 24,
  sort: "-relevance",
  options: {
    status: ["upcoming", "live", "online"]
  },
  skipAggs: true // Used to reduce latency by skipping aggregate counts
};
const deviceId=generateUUID();
// The parameters are then stringified and appended to the search endpoint
const url = `https://search-party-prod.liveauctioneers.com/search/v4/web?parameters=${encodeURIComponent(JSON.stringify(searchParameters))}&deviceId=${deviceId}`;
