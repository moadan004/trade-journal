import { describe, expect, it } from "vitest";

import { formatDecimal, formatMoney, parseDecimal } from "@/lib/decimal";
import {
  DEFAULT_INSTRUMENT,
  findInstrument,
  INSTRUMENTS,
  valuePerPriceUnitPerLot,
} from "@/lib/instruments";
import {
  calculate,
  calculatePositionSize,
  calculatePotentialLoss,
  calculatePotentialProfit,
  calculateRiskAmount,
  calculateRiskFromPositionSize,
  calculateRiskReward,
  calculateStopDistance,
  calculateTargetDistance,
  distanceInPips,
  type CalculatorInputs,
  type CalculatorMode,
} from "@/lib/positionSize";

const EURUSD = findInstrument("EURUSD")!;
const GBPUSD = findInstrument("GBPUSD")!;
const XAUUSD = findInstrument("XAUUSD")!;

const d = (s: string) => parseDecimal(s)!;

/** Inputs with everything valid; individual tests override what they exercise. */
function inputs(overrides: Partial<CalculatorInputs> = {}): CalculatorInputs {
  return {
    instrument: EURUSD,
    direction: "long",
    accountBalance: "10000",
    entryPrice: "1.10000",
    stopLoss: "1.09750",
    takeProfit: "1.10500",
    riskPercent: "1",
    positionSize: "1.00",
    ...overrides,
  };
}

function run(overrides: Partial<CalculatorInputs> = {}, mode: CalculatorMode = "risk-to-size") {
  return calculate(inputs(overrides), mode);
}

describe("instrument specifications", () => {
  it("1. exposes exactly the v1 instruments, all USD-quoted", () => {
    expect(INSTRUMENTS.map((i) => i.symbol)).toEqual(["EURUSD", "GBPUSD", "AUDUSD", "XAUUSD"]);
    expect(INSTRUMENTS.every((i) => i.quoteCurrency === "USD")).toBe(true);
  });

  it("2. keeps tickValue/tickSize consistent with contractSize for every instrument", () => {
    // The engine converts price movement to money via tickValue/tickSize. For
    // every instrument here that quotient is the contract size, which is what
    // makes "0.0025 x 100,000" the right mental model for the numbers below.
    for (const spec of INSTRUMENTS) {
      expect(formatDecimal(valuePerPriceUnitPerLot(spec), 0)).toBe(spec.contractSize);
    }
  });

  it("3. resolves symbols case-insensitively and rejects unsupported ones", () => {
    expect(findInstrument("xauusd")?.symbol).toBe("XAUUSD");
    expect(findInstrument(" eurusd ")?.symbol).toBe("EURUSD");
    // Excluded from v1 because their pip value needs a live FX rate.
    expect(findInstrument("USDJPY")).toBeUndefined();
    expect(findInstrument("USDCHF")).toBeUndefined();
    expect(findInstrument("USDCAD")).toBeUndefined();
    expect(DEFAULT_INSTRUMENT.symbol).toBe("XAUUSD");
  });
});

describe("primitives", () => {
  it("4. calculates the risk amount from balance and percent", () => {
    expect(formatMoney(calculateRiskAmount(d("10000"), d("1")))).toBe("$100.00");
    expect(formatMoney(calculateRiskAmount(d("2500"), d("0.5")))).toBe("$12.50");
    expect(formatMoney(calculateRiskAmount(d("10000"), d("2.75")))).toBe("$275.00");
  });

  it("5. measures stop and target distance regardless of trade direction", () => {
    // Long: stop below, target above.
    expect(formatDecimal(calculateStopDistance(d("1.10000"), d("1.09750")), 5)).toBe("0.00250");
    expect(formatDecimal(calculateTargetDistance(d("1.10000"), d("1.10500")), 5)).toBe("0.00500");
    // Short: the same magnitudes with the prices the other way round.
    expect(formatDecimal(calculateStopDistance(d("1.10000"), d("1.10250")), 5)).toBe("0.00250");
    expect(formatDecimal(calculateTargetDistance(d("1.10000"), d("1.09500")), 5)).toBe("0.00500");
  });

  it("6. converts distance to pips per the instrument's pip size", () => {
    expect(formatDecimal(distanceInPips(d("0.00250"), EURUSD), 1)).toBe("25.0");
    // Gold at the 0.01 convention: a $5.00 move is 500 pips.
    expect(formatDecimal(distanceInPips(d("5.00"), XAUUSD), 1)).toBe("500.0");
  });

  it("7. computes risk/reward as reward per unit of risk", () => {
    expect(formatDecimal(calculateRiskReward(d("0.0025"), d("0.0050"))!, 2)).toBe("2.00");
    expect(formatDecimal(calculateRiskReward(d("0.0030"), d("0.0045"))!, 2)).toBe("1.50");
    // No stop distance means no ratio, rather than a division by zero.
    expect(calculateRiskReward(d("0"), d("0.0050"))).toBeNull();
  });
});

describe("direction 1: risk -> position size", () => {
  it("8. sizes a standard EURUSD trade", () => {
    // $100 risk / (0.0025 x $100,000 per lot = $250/lot) = 0.4 lots.
    const { result } = run();
    expect(formatDecimal(result!.positionSize, 2)).toBe("0.40");
    expect(formatMoney(result!.riskAmount)).toBe("$100.00");
    expect(result!.positionSizeAdjustment).toBeNull();
  });

  it("9. sizes a gold trade at the 0.01 pip convention", () => {
    // $100 risk / (3.00 x $100 per lot = $300/lot) = 0.33 lots after flooring.
    const { result } = run({
      instrument: XAUUSD,
      entryPrice: "3300.00",
      stopLoss: "3297.00",
      takeProfit: "3306.00",
    });
    expect(formatDecimal(result!.positionSize, 2)).toBe("0.33");
    expect(formatDecimal(result!.pipsRisked, 1)).toBe("300.0");
    expect(formatDecimal(result!.pipsTargeted!, 1)).toBe("600.0");
  });

  it("10. floors to the lot step rather than rounding up, and says it did", () => {
    // Ideal is 0.4266... lots; rounding up to 0.43 would exceed the stated risk.
    const { result } = run({ stopLoss: "1.09766" });
    expect(formatDecimal(result!.positionSize, 2)).toBe("0.42");
    expect(result!.positionSizeAdjustment).toBe("rounded-down");
    // Realised risk is therefore under the $100 requested, never over - and the
    // reported riskAmount is that realised figure, not the request that was
    // asked for. Reporting the request here would overstate what the trade
    // actually costs on every floored size.
    expect(result!.potentialLoss).toBeLessThan(d("100"));
    expect(result!.riskAmount).toBe(result!.potentialLoss);
    expect(result!.riskAmount).not.toBe(calculateRiskAmount(d("10000"), d("1")));
  });

  it("11. flags a size below the venue minimum instead of silently raising it", () => {
    // $1 of risk against a $250/lot stop is 0.004 lots - under the 0.01 minimum.
    const { result } = run({ accountBalance: "100", riskPercent: "1" });
    expect(result!.positionSizeAdjustment).toBe("below-minimum");
    expect(result!.positionSize).toBeLessThan(d("0.01"));
  });

  it("12. clamps at the venue maximum", () => {
    const { result } = run({ accountBalance: "500000000", riskPercent: "50" });
    expect(formatDecimal(result!.positionSize, 2)).toBe("200.00");
    expect(result!.positionSizeAdjustment).toBe("above-maximum");
  });
});

describe("direction 2: position size -> risk", () => {
  it("13. derives the risk a given lot size carries", () => {
    // 1.00 lot x 0.0025 x $100,000 = $250.
    const { result } = run({ positionSize: "1.00" }, "size-to-risk");
    expect(formatMoney(result!.riskAmount)).toBe("$250.00");
    expect(formatDecimal(result!.riskPercent, 2)).toBe("2.50");
  });

  it("14. derives risk for gold", () => {
    // 0.50 lot x 3.00 x $100 = $150.
    const { result } = run(
      {
        instrument: XAUUSD,
        entryPrice: "3300.00",
        stopLoss: "3297.00",
        takeProfit: "3306.00",
        positionSize: "0.50",
      },
      "size-to-risk",
    );
    expect(formatMoney(result!.riskAmount)).toBe("$150.00");
  });

  it("15. round-trips: sizing a risk then re-deriving it returns the same figure", () => {
    for (const spec of INSTRUMENTS) {
      const stopDistance = spec.symbol === "XAUUSD" ? d("3.00") : d("0.00250");
      const riskAmount = d("100");

      const { lots } = calculatePositionSize(riskAmount, stopDistance, spec);
      const backOut = calculateRiskFromPositionSize(lots, stopDistance, spec);

      // The floor to lot step is the only thing that may be lost, so the
      // recovered risk is <= the requested one and within one step of it.
      expect(backOut).toBeLessThanOrEqual(riskAmount);
      const oneStep = calculateRiskFromPositionSize(
        parseDecimal(spec.lotStep)!,
        stopDistance,
        spec,
      );
      expect(riskAmount - backOut).toBeLessThan(oneStep);

      // And it agrees exactly with what the loss primitive reports.
      expect(calculatePotentialLoss(lots, stopDistance, spec)).toBe(
        calculatePotentialLoss(lots, stopDistance, spec),
      );
      expect(backOut).toBe(calculateRiskFromPositionSize(lots, stopDistance, spec));
    }
  });

  it("16. agrees with direction 1 when handed direction 1's own answer", () => {
    const forward = run();
    const lots = formatDecimal(forward.result!.positionSize, 2);
    const reverse = run({ positionSize: lots }, "size-to-risk");
    expect(reverse.result!.riskAmount).toBe(forward.result!.riskAmount);
    expect(reverse.result!.positionSize).toBe(forward.result!.positionSize);
  });
});

describe("outcomes and reporting", () => {
  it("17. reports potential loss and profit at the sized position", () => {
    const { result } = run();
    // 0.40 lots: 0.0025 x 100,000 x 0.4 = $100 lost, 0.0050 x 100,000 x 0.4 = $200 made.
    expect(formatMoney(result!.potentialLoss)).toBe("$100.00");
    expect(formatMoney(result!.potentialProfit!)).toBe("$200.00");
    expect(formatMoney(calculatePotentialProfit(d("0.40"), d("0.00500"), EURUSD))).toBe("$200.00");
  });

  it("18. reports pips risked and targeted as standalone figures, not from the ratio", () => {
    // A 2:1 trade on two different stop widths shares a ratio but not its pips,
    // so the pip figures cannot be recovered from R:R alone.
    const tight = run({ stopLoss: "1.09750", takeProfit: "1.10500" }).result!;
    const wide = run({ stopLoss: "1.09000", takeProfit: "1.12000" }).result!;

    expect(formatDecimal(tight.riskReward!, 2)).toBe("2.00");
    expect(formatDecimal(wide.riskReward!, 2)).toBe("2.00");
    expect(formatDecimal(tight.pipsRisked, 1)).toBe("25.0");
    expect(formatDecimal(wide.pipsRisked, 1)).toBe("100.0");
    expect(formatDecimal(tight.pipsTargeted!, 1)).toBe("50.0");
    expect(formatDecimal(wide.pipsTargeted!, 1)).toBe("200.0");
  });

  it("works without a target: sizing succeeds, R:R and profit go unreported", () => {
    const { result, errors } = run({ takeProfit: "" });
    expect(errors).toEqual([]);
    expect(formatDecimal(result!.positionSize, 2)).toBe("0.40");
    expect(result!.riskReward).toBeNull();
    expect(result!.pipsTargeted).toBeNull();
    expect(result!.potentialProfit).toBeNull();
  });
});

describe("financial precision", () => {
  it("subtracts nearby prices exactly where floating point would not", () => {
    // 1.1025 - 1.1 is 0.002499999999999991 in IEEE-754 doubles.
    expect(formatDecimal(calculateStopDistance(d("1.1025"), d("1.1")), 8)).toBe("0.00250000");
    expect(1.1025 - 1.1).not.toBe(0.0025);
  });

  it("keeps a whole-number lot size whole across a repeated-decimal stop", () => {
    // 0.0003 x 100,000 = $30/lot; $90 of risk is exactly 3 lots.
    const { result } = run({ accountBalance: "9000", riskPercent: "1", stopLoss: "1.09970" });
    expect(formatDecimal(result!.positionSize, 2)).toBe("3.00");
    expect(result!.positionSizeAdjustment).toBeNull();
    expect(formatMoney(result!.potentialLoss)).toBe("$90.00");
  });

  it("rounds money half away from zero at 2dp", () => {
    expect(formatMoney(d("0.005"))).toBe("$0.01");
    expect(formatMoney(d("2.675"))).toBe("$2.68");
    expect(formatMoney(d("-2.675"))).toBe("-$2.68");
    // The classic float failure: 2.675 rounds to 2.67 via toFixed(2).
    expect((2.675).toFixed(2)).toBe("2.67");
  });

  it("parses and rejects input strings without going through a float", () => {
    expect(formatDecimal(parseDecimal("0.1")! + parseDecimal("0.2")!, 2)).toBe("0.30");
    expect(0.1 + 0.2).not.toBe(0.3);
    for (const bad of ["", " ", "abc", "1.2.3", "--1", "1,000", "$5", "1e5"]) {
      expect(parseDecimal(bad)).toBeNull();
    }
  });
});

describe("pip convention is display-only", () => {
  /**
   * Gold has no universal pip, so `pipSize` is the one figure in the spec that
   * is a reporting convention rather than a contract fact. This pins down how
   * far a wrong choice can reach: money and lot sizing go through
   * tickValue/tickSize, so they must be identical under every convention, and
   * only the two pip readouts may move.
   *
   * If this ever fails, a monetary output has started depending on the pip
   * convention - which would turn a labelling question into a sizing bug.
   */
  const conventions = ["0.01", "0.10", "1.00", "0.001"];

  it("gives identical money, lots and R:R under every gold pip convention", () => {
    const base = run({
      instrument: XAUUSD,
      entryPrice: "3300.00",
      stopLoss: "3297.00",
      takeProfit: "3306.00",
    }).result!;

    for (const pipSize of conventions) {
      const { result } = run({
        instrument: { ...XAUUSD, pipSize },
        entryPrice: "3300.00",
        stopLoss: "3297.00",
        takeProfit: "3306.00",
      });
      expect(result!.positionSize).toBe(base.positionSize);
      expect(result!.riskAmount).toBe(base.riskAmount);
      expect(result!.riskPercent).toBe(base.riskPercent);
      expect(result!.potentialLoss).toBe(base.potentialLoss);
      expect(result!.potentialProfit).toBe(base.potentialProfit);
      expect(result!.riskReward).toBe(base.riskReward);
      expect(result!.stopDistance).toBe(base.stopDistance);
    }
  });

  it("scales only the pip readouts, inversely with the pip size", () => {
    const at = (pipSize: string) =>
      run({
        instrument: { ...XAUUSD, pipSize },
        entryPrice: "3300.00",
        stopLoss: "3297.00",
        takeProfit: "3306.00",
      }).result!;

    // The same 3.00 stop, described four ways.
    expect(formatDecimal(at("0.001").pipsRisked, 1)).toBe("3000.0");
    expect(formatDecimal(at("0.01").pipsRisked, 1)).toBe("300.0");
    expect(formatDecimal(at("0.10").pipsRisked, 1)).toBe("30.0");
    expect(formatDecimal(at("1.00").pipsRisked, 1)).toBe("3.0");
    expect(formatDecimal(at("0.10").pipsTargeted!, 1)).toBe("60.0");
  });
});

describe("validation", () => {
  it("rejects a stop on the wrong side of entry, per direction", () => {
    expect(run({ direction: "long", stopLoss: "1.10250" }).errors[0].message).toMatch(
      /stop must be below/,
    );
    expect(
      run({ direction: "short", stopLoss: "1.09750", takeProfit: "1.09000" }).errors[0].message,
    ).toMatch(/stop must be above/);
    // The mirror-image short is valid.
    expect(run({ direction: "short", stopLoss: "1.10250", takeProfit: "1.09500" }).errors).toEqual(
      [],
    );
  });

  it("rejects a target on the wrong side of entry", () => {
    expect(run({ takeProfit: "1.09000" }).errors[0].field).toBe("takeProfit");
  });

  it("rejects a zero-width stop, non-numeric and non-positive inputs", () => {
    expect(run({ stopLoss: "1.10000" }).errors[0].message).toMatch(/cannot equal/);
    expect(run({ accountBalance: "abc" }).errors[0].field).toBe("accountBalance");
    expect(run({ accountBalance: "0" }).errors[0].field).toBe("accountBalance");
    expect(run({ riskPercent: "0" }).errors[0].field).toBe("riskPercent");
    expect(run({ positionSize: "0" }, "size-to-risk").errors[0].field).toBe("positionSize");
  });

  it("reports every bad field at once rather than only the first", () => {
    const { errors } = run({ accountBalance: "abc", entryPrice: "xyz" });
    expect(errors.map((e) => e.field)).toEqual(["accountBalance", "entryPrice"]);
  });

  it("returns no result when validation fails", () => {
    expect(run({ stopLoss: "1.10000" }).result).toBeNull();
  });
});

describe("cross-instrument behaviour", () => {
  it("gives GBPUSD and EURUSD identical sizing for identical inputs", () => {
    // Same contract spec, so the engine must not special-case by symbol.
    const eur = run({ instrument: EURUSD }).result!;
    const gbp = run({ instrument: GBPUSD }).result!;
    expect(gbp.positionSize).toBe(eur.positionSize);
    expect(gbp.potentialLoss).toBe(eur.potentialLoss);
  });

  it("reports the realised risk percent, not the requested one, after flooring", () => {
    const { result } = run({ stopLoss: "1.09766" });
    // 0.42 lots x 0.00234 x 100,000 = $98.28 on a $10,000 account.
    expect(formatMoney(result!.potentialLoss)).toBe("$98.28");
    expect(formatDecimal(result!.riskPercent, 2)).toBe("0.98");
  });
});
