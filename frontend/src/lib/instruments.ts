import { div, parseDecimal } from "@/lib/decimal";

/**
 * Contract specifications for the instruments the calculator supports.
 *
 * Reference data, not a database table. These figures are properties of the
 * contract, identical for every user, and never edited from the app - a table
 * would buy a migration, a seed, a fetch and a loading state on a form whose
 * whole value is that it answers instantly. If user-defined symbols are ever
 * wanted, a table can be layered on top of this shape without changing it.
 *
 * Numeric fields are strings, not numbers. A literal like `0.00001` is already
 * inexact by the time the parser is done with it; keeping the decimal text and
 * scaling it in `parseDecimal` means the spec the code uses is the spec written
 * here. See lib/decimal.ts.
 */
export interface InstrumentSpec {
  symbol: string;
  label: string;
  /** Units of the base asset in one standard (1.00) lot. */
  contractSize: string;
  /** Smallest price increment the venue quotes - MT5 calls this Point. */
  tickSize: string;
  /** Account-currency value of one tick, per 1.00 lot. */
  tickValue: string;
  /** Price movement counted as one pip. See the XAUUSD note below. */
  pipSize: string;
  minimumLot: string;
  maximumLot: string;
  lotStep: string;
  /** Decimals to render prices at, matching the venue's quote. */
  priceDecimals: number;
  quoteCurrency: string;
}

/**
 * v1 is limited to USD-quoted instruments on purpose.
 *
 * For a pair whose quote currency is USD, one tick is worth a fixed number of
 * USD and the pip value is a constant. For USDJPY, USDCHF and USDCAD it is not:
 * the tick is denominated in the quote currency, so converting it to a USD
 * account balance needs a live rate. Shipping those with a hardcoded rate would
 * produce numbers that look authoritative and drift out of date silently, so
 * they are left out until the rate is handled properly.
 */
export const INSTRUMENTS: readonly InstrumentSpec[] = [
  {
    symbol: "EURUSD",
    label: "EUR/USD",
    contractSize: "100000",
    tickSize: "0.00001",
    tickValue: "1.00",
    pipSize: "0.0001",
    minimumLot: "0.01",
    maximumLot: "200",
    lotStep: "0.01",
    priceDecimals: 5,
    quoteCurrency: "USD",
  },
  {
    symbol: "GBPUSD",
    label: "GBP/USD",
    contractSize: "100000",
    tickSize: "0.00001",
    tickValue: "1.00",
    pipSize: "0.0001",
    minimumLot: "0.01",
    maximumLot: "200",
    lotStep: "0.01",
    priceDecimals: 5,
    quoteCurrency: "USD",
  },
  {
    symbol: "AUDUSD",
    label: "AUD/USD",
    contractSize: "100000",
    tickSize: "0.00001",
    tickValue: "1.00",
    pipSize: "0.0001",
    minimumLot: "0.01",
    maximumLot: "200",
    lotStep: "0.01",
    priceDecimals: 5,
    quoteCurrency: "USD",
  },
  {
    // PIP CONVENTION - read before "correcting" this.
    //
    // Gold has no universal pip. Three conventions are in active use: 0.01
    // (most MT4/MT5 platforms), 0.10 (many online pip calculators) and 1.00
    // (how traders usually speak - "gold ran 30 pips").
    //
    // 0.01 is used here because it is what the terminal reports. MT5 has no
    // "pip" concept at all - it displays Point, which equals Tick size, and for
    // a 2-decimal gold quote that is 0.01. Exness publishes 0.01 as the pip
    // size for XAUUSD alongside the 100oz contract. So a 3300.00 -> 3305.00
    // move reads as 500 here and as 500 points in MT5, which is the whole point
    // of the choice: the calculator agrees with the platform, not with a
    // colloquialism.
    //
    // Verify against Market Watch -> right-click XAUUSD -> Specification and
    // check Digits / Point. A 3-decimal feed would make Point 0.001 and this
    // value wrong; changing `pipSize` here is the entire fix.
    symbol: "XAUUSD",
    label: "XAU/USD (Gold)",
    contractSize: "100",
    tickSize: "0.01",
    tickValue: "1.00",
    pipSize: "0.01",
    minimumLot: "0.01",
    maximumLot: "200",
    lotStep: "0.01",
    priceDecimals: 2,
    quoteCurrency: "USD",
  },
] as const;

export const DEFAULT_INSTRUMENT = INSTRUMENTS.find((i) => i.symbol === "XAUUSD") ?? INSTRUMENTS[0];

export function findInstrument(symbol: string): InstrumentSpec | undefined {
  const wanted = symbol.trim().toUpperCase();
  return INSTRUMENTS.find((i) => i.symbol === wanted);
}

/**
 * Account-currency value of a one-unit price move, per 1.00 lot.
 *
 * The single bridge between price space and money space - every monetary figure
 * the engine produces goes through it. Derived from tickValue/tickSize rather
 * than read off contractSize so a venue that prices its ticks unusually is
 * described by the spec instead of needing a special case here. For every
 * instrument above the two agree (EURUSD: 1.00/0.00001 = 100000 = contract
 * size), which is the arrangement being relied on, not a coincidence.
 */
export function valuePerPriceUnitPerLot(instrument: InstrumentSpec): bigint {
  const tickValue = parseDecimal(instrument.tickValue);
  const tickSize = parseDecimal(instrument.tickSize);
  if (tickValue === null || tickSize === null || tickSize === 0n) {
    throw new Error(`Invalid tick specification for ${instrument.symbol}`);
  }
  return div(tickValue, tickSize);
}
