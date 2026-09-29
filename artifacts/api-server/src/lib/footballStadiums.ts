/**
 * NFL + major NCAAF stadium reference (lat/lon, roof, surface).
 * Real public stadium facts — unknown schools are omitted (never invented).
 * Keyed by ESPN team abbreviation.
 */

export type FootballStadium = {
  lat: number;
  lon: number;
  dome: boolean;
  /** Playing surface — real venue fact; not a scoring invention. */
  surface: "turf" | "grass";
  name: string;
  city: string;
};

/** All 32 NFL home venues. */
export const NFL_STADIUMS: Record<string, FootballStadium> = {
  ARI: { lat: 33.5277, lon: -112.2626, dome: true, surface: "grass", name: "State Farm Stadium", city: "Glendale, AZ" },
  ATL: { lat: 33.7554, lon: -84.4008, dome: true, surface: "turf", name: "Mercedes-Benz Stadium", city: "Atlanta, GA" },
  BAL: { lat: 39.278, lon: -76.6227, dome: false, surface: "grass", name: "M&T Bank Stadium", city: "Baltimore, MD" },
  BUF: { lat: 42.7738, lon: -78.787, dome: false, surface: "turf", name: "Highmark Stadium", city: "Orchard Park, NY" },
  CAR: { lat: 35.2258, lon: -80.8528, dome: false, surface: "turf", name: "Bank of America Stadium", city: "Charlotte, NC" },
  CHI: { lat: 41.8623, lon: -87.6167, dome: false, surface: "grass", name: "Soldier Field", city: "Chicago, IL" },
  CIN: { lat: 39.0954, lon: -84.516, dome: false, surface: "turf", name: "Paycor Stadium", city: "Cincinnati, OH" },
  CLE: { lat: 41.5061, lon: -81.6995, dome: false, surface: "grass", name: "Huntington Bank Field", city: "Cleveland, OH" },
  DAL: { lat: 32.7473, lon: -97.0945, dome: true, surface: "turf", name: "AT&T Stadium", city: "Arlington, TX" },
  DEN: { lat: 39.7439, lon: -105.0201, dome: false, surface: "grass", name: "Empower Field at Mile High", city: "Denver, CO" },
  DET: { lat: 42.34, lon: -83.0456, dome: true, surface: "turf", name: "Ford Field", city: "Detroit, MI" },
  GB: { lat: 44.5013, lon: -88.0622, dome: false, surface: "grass", name: "Lambeau Field", city: "Green Bay, WI" },
  HOU: { lat: 29.6847, lon: -95.4107, dome: true, surface: "turf", name: "NRG Stadium", city: "Houston, TX" },
  IND: { lat: 39.7601, lon: -86.1639, dome: true, surface: "turf", name: "Lucas Oil Stadium", city: "Indianapolis, IN" },
  JAX: { lat: 30.3239, lon: -81.6373, dome: false, surface: "grass", name: "EverBank Stadium", city: "Jacksonville, FL" },
  KC: { lat: 39.0489, lon: -94.4839, dome: false, surface: "grass", name: "GEHA Field at Arrowhead Stadium", city: "Kansas City, MO" },
  LAC: { lat: 33.9535, lon: -118.339, dome: true, surface: "turf", name: "SoFi Stadium", city: "Inglewood, CA" },
  LAR: { lat: 33.9535, lon: -118.339, dome: true, surface: "turf", name: "SoFi Stadium", city: "Inglewood, CA" },
  LV: { lat: 36.0908, lon: -115.1836, dome: true, surface: "grass", name: "Allegiant Stadium", city: "Las Vegas, NV" },
  MIA: { lat: 25.958, lon: -80.2389, dome: false, surface: "grass", name: "Hard Rock Stadium", city: "Miami Gardens, FL" },
  MIN: { lat: 44.9738, lon: -93.2577, dome: true, surface: "turf", name: "U.S. Bank Stadium", city: "Minneapolis, MN" },
  NE: { lat: 42.0909, lon: -71.2643, dome: false, surface: "turf", name: "Gillette Stadium", city: "Foxborough, MA" },
  NO: { lat: 29.9511, lon: -90.0812, dome: true, surface: "turf", name: "Caesars Superdome", city: "New Orleans, LA" },
  NYG: { lat: 40.8128, lon: -74.0742, dome: false, surface: "turf", name: "MetLife Stadium", city: "East Rutherford, NJ" },
  NYJ: { lat: 40.8128, lon: -74.0742, dome: false, surface: "turf", name: "MetLife Stadium", city: "East Rutherford, NJ" },
  PHI: { lat: 39.9008, lon: -75.1675, dome: false, surface: "grass", name: "Lincoln Financial Field", city: "Philadelphia, PA" },
  PIT: { lat: 40.4468, lon: -80.0158, dome: false, surface: "grass", name: "Acrisure Stadium", city: "Pittsburgh, PA" },
  SEA: { lat: 47.5952, lon: -122.3316, dome: false, surface: "turf", name: "Lumen Field", city: "Seattle, WA" },
  SF: { lat: 37.403, lon: -121.97, dome: false, surface: "grass", name: "Levi's Stadium", city: "Santa Clara, CA" },
  TB: { lat: 27.9759, lon: -82.5033, dome: false, surface: "grass", name: "Raymond James Stadium", city: "Tampa, FL" },
  TEN: { lat: 36.1665, lon: -86.7713, dome: false, surface: "turf", name: "Nissan Stadium", city: "Nashville, TN" },
  WSH: { lat: 38.9077, lon: -76.8645, dome: false, surface: "grass", name: "Northwest Stadium", city: "Landover, MD" },
};

/**
 * Major FBS venues we can resolve by ESPN abbreviation.
 * Schools missing here are skipped honestly (no invented coords).
 */
export const NCAAF_STADIUMS: Record<string, FootballStadium> = {
  ALA: { lat: 33.2083, lon: -87.5504, dome: false, surface: "grass", name: "Bryant-Denny Stadium", city: "Tuscaloosa, AL" },
  UGA: { lat: 33.9498, lon: -83.3733, dome: false, surface: "grass", name: "Sanford Stadium", city: "Athens, GA" },
  OSU: { lat: 40.0017, lon: -83.0197, dome: false, surface: "turf", name: "Ohio Stadium", city: "Columbus, OH" },
  MICH: { lat: 42.2659, lon: -83.7487, dome: false, surface: "turf", name: "Michigan Stadium", city: "Ann Arbor, MI" },
  TEX: { lat: 30.2839, lon: -97.7328, dome: false, surface: "turf", name: "Darrell K Royal–Texas Memorial Stadium", city: "Austin, TX" },
  OU: { lat: 35.2058, lon: -97.4424, dome: false, surface: "grass", name: "Gaylord Family Oklahoma Memorial Stadium", city: "Norman, OK" },
  ORE: { lat: 44.0583, lon: -123.0685, dome: false, surface: "turf", name: "Autzen Stadium", city: "Eugene, OR" },
  USC: { lat: 34.0141, lon: -118.2879, dome: false, surface: "grass", name: "Los Angeles Memorial Coliseum", city: "Los Angeles, CA" },
  ND: { lat: 41.6983, lon: -86.2339, dome: false, surface: "turf", name: "Notre Dame Stadium", city: "Notre Dame, IN" },
  PSU: { lat: 40.8122, lon: -77.8561, dome: false, surface: "grass", name: "Beaver Stadium", city: "University Park, PA" },
  LSU: { lat: 30.412, lon: -91.1838, dome: false, surface: "grass", name: "Tiger Stadium", city: "Baton Rouge, LA" },
  FLA: { lat: 29.65, lon: -82.3487, dome: false, surface: "grass", name: "Ben Hill Griffin Stadium", city: "Gainesville, FL" },
  FSU: { lat: 30.4382, lon: -84.3044, dome: false, surface: "grass", name: "Doak Campbell Stadium", city: "Tallahassee, FL" },
  MIA: { lat: 25.6506, lon: -80.2797, dome: false, surface: "grass", name: "Hard Rock Stadium", city: "Miami Gardens, FL" },
  CLEM: { lat: 34.6787, lon: -82.8432, dome: false, surface: "grass", name: "Memorial Stadium", city: "Clemson, SC" },
  TENN: { lat: 35.955, lon: -83.925, dome: false, surface: "grass", name: "Neyland Stadium", city: "Knoxville, TN" },
  "TA&M": { lat: 30.61, lon: -96.34, dome: false, surface: "grass", name: "Kyle Field", city: "College Station, TX" },
  TAMU: { lat: 30.61, lon: -96.34, dome: false, surface: "grass", name: "Kyle Field", city: "College Station, TX" },
  MISS: { lat: 34.362, lon: -89.534, dome: false, surface: "turf", name: "Vaught-Hemingway Stadium", city: "Oxford, MS" },
  MSST: { lat: 33.4563, lon: -88.7934, dome: false, surface: "grass", name: "Davis Wade Stadium", city: "Starkville, MS" },
  AUB: { lat: 32.6026, lon: -85.4899, dome: false, surface: "grass", name: "Jordan-Hare Stadium", city: "Auburn, AL" },
  UK: { lat: 38.0226, lon: -84.5052, dome: false, surface: "turf", name: "Kroger Field", city: "Lexington, KY" },
  ARK: { lat: 36.068, lon: -94.178, dome: false, surface: "turf", name: "Donald W. Reynolds Razorback Stadium", city: "Fayetteville, AR" },
  SC: { lat: 33.973, lon: -81.0192, dome: false, surface: "grass", name: "Williams-Brice Stadium", city: "Columbia, SC" },
  WIS: { lat: 43.07, lon: -89.4128, dome: false, surface: "turf", name: "Camp Randall Stadium", city: "Madison, WI" },
  IOWA: { lat: 41.6586, lon: -91.551, dome: false, surface: "turf", name: "Kinnick Stadium", city: "Iowa City, IA" },
  NEB: { lat: 40.8206, lon: -96.7056, dome: false, surface: "turf", name: "Memorial Stadium", city: "Lincoln, NE" },
  WASH: { lat: 47.6506, lon: -122.3016, dome: false, surface: "turf", name: "Husky Stadium", city: "Seattle, WA" },
  UW: { lat: 47.6506, lon: -122.3016, dome: false, surface: "turf", name: "Husky Stadium", city: "Seattle, WA" },
  UCLA: { lat: 34.1614, lon: -118.1676, dome: false, surface: "turf", name: "Rose Bowl", city: "Pasadena, CA" },
  UTAH: { lat: 40.76, lon: -111.849, dome: false, surface: "turf", name: "Rice-Eccles Stadium", city: "Salt Lake City, UT" },
  ASU: { lat: 33.4265, lon: -111.9326, dome: false, surface: "grass", name: "Mountain America Stadium", city: "Tempe, AZ" },
  ARIZ: { lat: 32.229, lon: -110.949, dome: false, surface: "turf", name: "Arizona Stadium", city: "Tucson, AZ" },
  COLO: { lat: 40.0095, lon: -105.2669, dome: false, surface: "grass", name: "Folsom Field", city: "Boulder, CO" },
  BAY: { lat: 31.5585, lon: -97.1158, dome: false, surface: "turf", name: "McLane Stadium", city: "Waco, TX" },
  TCU: { lat: 32.71, lon: -97.368, dome: false, surface: "grass", name: "Amon G. Carter Stadium", city: "Fort Worth, TX" },
  KSU: { lat: 39.2019, lon: -96.5938, dome: false, surface: "turf", name: "Bill Snyder Family Stadium", city: "Manhattan, KS" },
  KU: { lat: 38.9575, lon: -95.2467, dome: false, surface: "turf", name: "David Booth Kansas Memorial Stadium", city: "Lawrence, KS" },
  ISU: { lat: 42.014, lon: -93.6359, dome: false, surface: "grass", name: "Jack Trice Stadium", city: "Ames, IA" },
  OKST: { lat: 36.1257, lon: -97.0665, dome: false, surface: "turf", name: "Boone Pickens Stadium", city: "Stillwater, OK" },
  TTU: { lat: 33.591, lon: -101.873, dome: false, surface: "turf", name: "Jones AT&T Stadium", city: "Lubbock, TX" },
  CIN: { lat: 39.131, lon: -84.516, dome: false, surface: "turf", name: "Nippert Stadium", city: "Cincinnati, OH" },
  UCF: { lat: 28.608, lon: -81.1926, dome: false, surface: "grass", name: "FBC Mortgage Stadium", city: "Orlando, FL" },
  BYU: { lat: 40.2575, lon: -111.6545, dome: false, surface: "turf", name: "LaVell Edwards Stadium", city: "Provo, UT" },
  LOU: { lat: 38.2058, lon: -85.7589, dome: false, surface: "turf", name: "L&N Federal Credit Union Stadium", city: "Louisville, KY" },
  VT: { lat: 37.22, lon: -80.418, dome: false, surface: "grass", name: "Lane Stadium", city: "Blacksburg, VA" },
  UNC: { lat: 35.9069, lon: -79.0479, dome: false, surface: "turf", name: "Kenan Memorial Stadium", city: "Chapel Hill, NC" },
  DUKE: { lat: 35.9953, lon: -78.9419, dome: false, surface: "grass", name: "Wallace Wade Stadium", city: "Durham, NC" },
  NCST: { lat: 35.7708, lon: -78.6744, dome: false, surface: "grass", name: "Carter-Finley Stadium", city: "Raleigh, NC" },
  GT: { lat: 33.7725, lon: -84.3928, dome: false, surface: "grass", name: "Bobby Dodd Stadium", city: "Atlanta, GA" },
  PITT: { lat: 40.4468, lon: -80.0158, dome: false, surface: "grass", name: "Acrisure Stadium", city: "Pittsburgh, PA" },
  SYR: { lat: 43.0362, lon: -76.1363, dome: true, surface: "turf", name: "JMA Wireless Dome", city: "Syracuse, NY" },
  WVU: { lat: 39.6503, lon: -79.9545, dome: false, surface: "turf", name: "Milan Puskar Stadium", city: "Morgantown, WV" },
  BOIS: { lat: 43.603, lon: -116.196, dome: false, surface: "turf", name: "Albertsons Stadium", city: "Boise, ID" },
  MEM: { lat: 35.121, lon: -89.978, dome: false, surface: "turf", name: "Simmons Bank Liberty Stadium", city: "Memphis, TN" },
  TULN: { lat: 29.944, lon: -90.117, dome: false, surface: "turf", name: "Yulman Stadium", city: "New Orleans, LA" },
  JMU: { lat: 38.433, lon: -78.869, dome: false, surface: "turf", name: "Bridgeforth Stadium", city: "Harrisonburg, VA" },
  LIB: { lat: 37.353, lon: -79.177, dome: false, surface: "turf", name: "Williams Stadium", city: "Lynchburg, VA" },
  APP: { lat: 36.2116, lon: -81.685, dome: false, surface: "turf", name: "Kidd Brewer Stadium", city: "Boone, NC" },
};

export function footballStadiumsForSport(
  sport: string,
): Record<string, FootballStadium> | null {
  const s = sport.toLowerCase();
  if (s === "nfl") return NFL_STADIUMS;
  if (s === "ncaaf") return NCAAF_STADIUMS;
  return null;
}

export function resolveFootballStadium(
  sport: string,
  homeAbbr: string | null | undefined,
): FootballStadium | null {
  const table = footballStadiumsForSport(sport);
  if (!table || !homeAbbr) return null;
  const key = String(homeAbbr).toUpperCase().replace(/[^A-Z0-9&]/g, "");
  return table[key] ?? table[String(homeAbbr).toUpperCase()] ?? null;
}
