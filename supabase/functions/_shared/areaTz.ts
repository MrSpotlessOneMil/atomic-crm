// Area code -> IANA timezone for US/Canada (NANP) phone numbers.
//
// Used for SMS quiet hours and call scheduling: texting or double-dialing a
// lead at 9pm THEIR time, not ours, requires knowing their tz, and the area
// code is the only geographic signal a raw phone number carries. Mapping is
// state/province-level: a split-state code goes to the zone covering most of
// its population (e.g. 850 -> Central for the Florida panhandle, 915 ->
// Mountain for El Paso). That is accurate enough for quiet hours — worst case
// is one hour off for a sliver of subscribers, and number portability makes
// finer precision an illusion anyway.
//
// Zones are canonicalized to a SMALL closed set — one per US zone, the no-DST
// outliers (America/Phoenix, America/Regina), the Canadian zones, and the US
// territories — so downstream schedulers can rely on a fixed vocabulary.
// Unknown or non-NANP numbers return null; callers fall back to a default tz.
//
// This module is PURE (no supabase / Deno imports) so vitest can run it in node.

// Codes grouped by zone, with state/province comments, then flattened into
// AREA_CODE_TZ below. Includes recently activated overlay codes.
const ZONE_CODES: Array<[string, number[]]> = [
  [
    "America/New_York",
    [
      203,
      475,
      860,
      959, // Connecticut
      302, // Delaware
      202,
      771, // District of Columbia
      239,
      305,
      321,
      324,
      352,
      386,
      407,
      561,
      645,
      656,
      689,
      727,
      754,
      772,
      786,
      813,
      863,
      904,
      941,
      954, // Florida (peninsula)
      229,
      404,
      470,
      478,
      678,
      706,
      762,
      770,
      912,
      943, // Georgia
      260,
      317,
      463,
      574,
      765,
      812,
      930, // Indiana (all but the NW corner)
      502,
      606,
      859, // Kentucky (eastern half)
      207, // Maine
      227,
      240,
      301,
      410,
      443,
      667, // Maryland
      339,
      351,
      413,
      508,
      617,
      774,
      781,
      857,
      978, // Massachusetts
      231,
      248,
      269,
      313,
      517,
      586,
      616,
      679,
      734,
      810,
      906,
      947,
      989, // Michigan
      603, // New Hampshire
      201,
      551,
      609,
      640,
      732,
      848,
      856,
      862,
      908,
      973, // New Jersey
      212,
      315,
      329,
      332,
      347,
      363,
      516,
      518,
      585,
      607,
      631,
      646,
      680,
      716,
      718,
      838,
      845,
      914,
      917,
      929,
      934, // New York
      252,
      336,
      472,
      704,
      743,
      828,
      910,
      919,
      980,
      984, // North Carolina
      216,
      220,
      234,
      283,
      326,
      330,
      380,
      419,
      440,
      513,
      567,
      614,
      740,
      937, // Ohio
      215,
      223,
      267,
      272,
      412,
      445,
      484,
      570,
      582,
      610,
      717,
      724,
      814,
      878, // Pennsylvania
      401, // Rhode Island
      803,
      839,
      843,
      854,
      864, // South Carolina
      423,
      865, // Tennessee (east: Knoxville, Chattanooga, Tri-Cities)
      802, // Vermont
      276,
      434,
      540,
      571,
      686,
      703,
      757,
      804,
      826,
      948, // Virginia
      304,
      681, // West Virginia
    ],
  ],
  [
    "America/Chicago",
    [
      205,
      251,
      256,
      334,
      659,
      938, // Alabama
      327,
      479,
      501,
      870, // Arkansas
      448,
      850, // Florida (panhandle: Pensacola, Panama City)
      217,
      224,
      309,
      312,
      331,
      447,
      464,
      618,
      630,
      708,
      730,
      773,
      779,
      815,
      847,
      861,
      872, // Illinois
      219, // Indiana (NW corner: Gary)
      319,
      515,
      563,
      641,
      712, // Iowa
      316,
      620,
      785,
      913, // Kansas
      270,
      364, // Kentucky (western half)
      225,
      318,
      337,
      457,
      504,
      985, // Louisiana
      218,
      320,
      507,
      612,
      651,
      763,
      952, // Minnesota
      228,
      601,
      662,
      769, // Mississippi
      235,
      314,
      417,
      557,
      573,
      636,
      660,
      816, // Missouri
      308,
      402,
      531, // Nebraska
      701, // North Dakota
      405,
      539,
      572,
      580,
      918, // Oklahoma
      605, // South Dakota
      615,
      629,
      731,
      901,
      931, // Tennessee (middle/west: Nashville, Memphis)
      210,
      214,
      254,
      281,
      325,
      346,
      361,
      409,
      430,
      432,
      469,
      512,
      621,
      682,
      713,
      726,
      737,
      806,
      817,
      830,
      832,
      903,
      936,
      940,
      945,
      956,
      972,
      979, // Texas (all but El Paso)
      262,
      274,
      353,
      414,
      534,
      608,
      715,
      920, // Wisconsin
    ],
  ],
  [
    "America/Denver",
    [
      303,
      719,
      720,
      970,
      983, // Colorado
      208,
      986, // Idaho
      406, // Montana
      505,
      575, // New Mexico
      915, // Texas (El Paso)
      385,
      435,
      801, // Utah
      307, // Wyoming
    ],
  ],
  [
    "America/Phoenix",
    [
      480,
      520,
      602,
      623,
      928, // Arizona (no DST)
    ],
  ],
  [
    "America/Los_Angeles",
    [
      209,
      213,
      279,
      310,
      323,
      341,
      350,
      369,
      408,
      415,
      424,
      442,
      510,
      530,
      559,
      562,
      619,
      626,
      628,
      650,
      657,
      661,
      669,
      707,
      714,
      747,
      760,
      805,
      818,
      820,
      831,
      840,
      858,
      909,
      916,
      925,
      949,
      951, // California
      702,
      725,
      775, // Nevada
      458,
      503,
      541,
      971, // Oregon
      206,
      253,
      360,
      425,
      509,
      564, // Washington
    ],
  ],
  ["America/Anchorage", [907]], // Alaska
  ["Pacific/Honolulu", [808]], // Hawaii
  [
    "America/Puerto_Rico",
    [
      787,
      939, // Puerto Rico
      340, // US Virgin Islands (same Atlantic zone)
    ],
  ],
  [
    "Pacific/Guam",
    [
      671, // Guam
      670, // Northern Mariana Islands (same zone)
    ],
  ],
  ["Pacific/Pago_Pago", [684]], // American Samoa
  [
    "America/Toronto",
    [
      // Ontario
      416,
      647,
      437,
      387, // Toronto
      905,
      289,
      365,
      742,
      942, // GTA suburbs (Hamilton, Niagara)
      613,
      343,
      753, // Ottawa / eastern ON
      519,
      226,
      548,
      382, // SW ON (London, Windsor, Kitchener)
      705,
      249,
      683, // NE ON (Sudbury, Barrie)
      807, // NW ON (Thunder Bay; mostly Eastern)
      // Quebec (Eastern; canonicalized to Toronto)
      514,
      438,
      263, // Montreal
      450,
      579,
      354, // Montreal suburbs
      418,
      581,
      367, // Quebec City / eastern QC
      819,
      873,
      468, // western QC (Gatineau, Sherbrooke)
    ],
  ],
  ["America/Winnipeg", [204, 431, 584]], // Manitoba
  ["America/Regina", [306, 639, 474]], // Saskatchewan (no DST — Regina, not Winnipeg)
  [
    "America/Edmonton",
    [
      403,
      587,
      825,
      368, // Alberta
      867, // YT/NWT/NU (mostly Mountain; nearest canonical zone)
    ],
  ],
  ["America/Vancouver", [604, 778, 236, 672, 250, 257]], // British Columbia
  [
    "America/Halifax",
    [
      506,
      428, // New Brunswick
      902,
      782, // Nova Scotia / PEI
    ],
  ],
  ["America/St_Johns", [709, 879]], // Newfoundland and Labrador
];

export const AREA_CODE_TZ: Record<string, string> = {};
for (const [tz, codes] of ZONE_CODES) {
  for (const code of codes) AREA_CODE_TZ[String(code)] = tz;
}

// IANA tz for a US/Canada phone number, or null when it cannot be determined.
// Accepts E.164 ("+13105550000"), bare digits with or without the country code
// ("13105550000", "3105550000"), and formatted variants ("(310) 555-0000") —
// everything but digits is stripped before parsing. Non-NANP numbers (+44...),
// toll-free / non-geographic codes, and Caribbean NANP countries all fall
// through to null so callers apply their default tz instead of a wrong one.
export function tzForPhone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  let area: string;
  if (digits.length === 11 && digits.startsWith("1")) {
    area = digits.slice(1, 4);
  } else if (digits.length === 10) {
    area = digits.slice(0, 3);
  } else {
    return null;
  }
  // NANP area codes never start with 0 or 1.
  if (area[0] === "0" || area[0] === "1") return null;
  return AREA_CODE_TZ[area] ?? null;
}
