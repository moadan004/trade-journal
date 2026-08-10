import { abs, div, floorToStep, mul, parseDecimal, roundMoney } from "@/lib/decimal";
import { valuePerPriceUnitPerLot, type InstrumentSpec } from "@/lib/instruments";

/**
 * Position sizing and risk/reward, in both directions.
 *
 * The two directions are not two calculations. Both hinge on one quantity -
 * what a stop-out costs per 1.00 lot - and differ only in which side of
 *
 *     risk = lots x lossPerLot
 *
 * is known. `calculatePositionSize` divides by lossPerLot,
 * `calculateRiskFromPositionSize` multiplies by it, and both call
 * `lossPerLotAtDistance` to obtain it. There is deliberately no second copy of
 * the pip/contract arithmetic for the reverse direction to drift away from.
 *
 * This module computes and reports. It does not place, modify or transmit
 * orders, and has no broker connection of any kind.
 */

export type TradeDirection = "long" | "short";

/** Which quantity the user supplies; the other is solved for. */
export type CalculatorMode = "risk-to-size" | "size-to-risk";

export interface CalculatorInputs {
  instrument: InstrumentSpec;
  direction: TradeDirection;
  accountBalance: string;
  entryPrice: string;
  stopLoss: string;
  takeProfit: string;
  /** Used when mode is "risk-to-size". */
  riskPercent: string;
  /** Used when mode is "size-to-risk". */
  positionSize: string;
}

export interface CalculatorResult {
  riskAmount: bigint;
  riskPercent: bigint;
  positionSize: bigint;
  /** Set when the lot-step floor or a clamp moved the size off the ideal. */
  positionSizeAdjustment: LotAdjustment | null;
  stopDistance: bigint;
  targetDistance: bigint | null;
  pipsRisked: bigint;
  pipsTargeted: bigint | null;
  riskReward: bigint | null;
  potentialLoss: bigint;
  potentialProfit: bigint | null;
  lossPerLot: bigint;
}

export type LotAdjustment = "rounded-down" | "below-minimum" | "above-maximum";

export interface FieldError {
  field: keyof CalculatorInputs | "form";
  message: string;
}

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

/** Money at risk for a given balance and percentage of it. */
export function calculateRiskAmount(accountBalance: bigint, riskPercent: bigint): bigint {
  return div(mul(accountBalance, riskPercent), parseDecimal("100")!);
}

/** Absolute price distance from entry to stop. */
export function calculateStopDistance(entryPrice: bigint, stopLoss: bigint): bigint {
  return abs(entryPrice - stopLoss);
}

/** Absolute price distance from entry to target. */
export function calculateTargetDistance(entryPrice: bigint, takeProfit: bigint): bigint {
  return abs(takeProfit - entryPrice);
}

/** Reward per unit of risk. Null when there is no stop distance to divide by. */
export function calculateRiskReward(stopDistance: bigint, targetDistance: bigint): bigint | null {
  if (stopDistance <= 0n) return null;
  return div(targetDistance, stopDistance);
}

/** A price distance expressed in pips. */
export function distanceInPips(distance: bigint, instrument: InstrumentSpec): bigint {
  const pipSize = parseDecimal(instrument.pipSize);
  if (pipSize === null || pipSize === 0n) return 0n;
  return div(distance, pipSize);
}

/**
 * What moving `distance` against a 1.00 lot position costs.
 * The shared term both directions are built on.
 */
export function lossPerLotAtDistance(distance: bigint, instrument: InstrumentSpec): bigint {
  return mul(distance, valuePerPriceUnitPerLot(instrument));
}

/* -------------------------------------------------------------------------- */
/* The two directions                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Direction 1: risk -> lots.
 *
 * The raw quotient is floored to the venue's lot step, so the realised risk is
 * at or under the requested figure, never over. `adjustment` reports why the
 * returned size differs from the ideal so the UI can say so out loud rather
 * than quietly handing back a different trade than the one asked for.
 */
export function calculatePositionSize(
  riskAmount: bigint,
  stopDistance: bigint,
  instrument: InstrumentSpec,
): { lots: bigint; adjustment: LotAdjustment | null } {
  const lossPerLot = lossPerLotAtDistance(stopDistance, instrument);
  if (lossPerLot <= 0n) return { lots: 0n, adjustment: null };

  const minimumLot = parseDecimal(instrument.minimumLot)!;
  const maximumLot = parseDecimal(instrument.maximumLot)!;
  const lotStep = parseDecimal(instrument.lotStep)!;

  const ideal = div(riskAmount, lossPerLot);
  const stepped = floorToStep(ideal, lotStep);

  // Below the minimum is reported, not silently raised to it: trading the
  // minimum would exceed the stated risk, and that is the user's call to make.
  if (stepped < minimumLot) return { lots: stepped, adjustment: "below-minimum" };
  if (stepped > maximumLot) return { lots: maximumLot, adjustment: "above-maximum" };

  return { lots: stepped, adjustment: stepped === ideal ? null : "rounded-down" };
}

/**
 * Direction 2: lots -> risk. The same relationship, multiplied instead of
 * divided, using the same `lossPerLotAtDistance`.
 */
export function calculateRiskFromPositionSize(
  positionSize: bigint,
  stopDistance: bigint,
  instrument: InstrumentSpec,
): bigint {
  return mul(positionSize, lossPerLotAtDistance(stopDistance, instrument));
}

/** Money lost if the stop is hit at this size. */
export function calculatePotentialLoss(
  positionSize: bigint,
  stopDistance: bigint,
  instrument: InstrumentSpec,
): bigint {
  return roundMoney(calculateRiskFromPositionSize(positionSize, stopDistance, instrument));
}

/** Money made if the target is hit at this size. */
export function calculatePotentialProfit(
  positionSize: bigint,
  targetDistance: bigint,
  instrument: InstrumentSpec,
): bigint {
  return roundMoney(mul(positionSize, lossPerLotAtDistance(targetDistance, instrument)));
}

/* -------------------------------------------------------------------------- */
/* Validation + orchestration                                                  */
/* -------------------------------------------------------------------------- */

function required(raw: string, field: keyof CalculatorInputs, label: string): bigint | FieldError {
  const parsed = parseDecimal(raw);
  if (parsed === null) return { field, message: `${label} must be a number.` };
  return parsed;
}

/**
 * Validates inputs and runs the engine. Returns every problem it finds rather
 * than the first, so a form with two bad fields flags both at once.
 */
export function calculate(
  inputs: CalculatorInputs,
  mode: CalculatorMode,
): { result: CalculatorResult | null; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const { instrument, direction } = inputs;

  function read(raw: string, field: keyof CalculatorInputs, label: string): bigint | null {
    const value = required(raw, field, label);
    if (typeof value === "object") {
      errors.push(value);
      return null;
    }
    return value;
  }

  const balance = read(inputs.accountBalance, "accountBalance", "Account balance");
  const entry = read(inputs.entryPrice, "entryPrice", "Entry price");
  const stop = read(inputs.stopLoss, "stopLoss", "Stop loss");

  // Target is the one optional input: sizing a trade is well defined without
  // one, and R:R simply goes unreported.
  const hasTarget = inputs.takeProfit.trim() !== "";
  const target = hasTarget ? read(inputs.takeProfit, "takeProfit", "Take profit") : null;

  const riskPercentInput =
    mode === "risk-to-size" ? read(inputs.riskPercent, "riskPercent", "Risk percent") : null;
  const lotsInput =
    mode === "size-to-risk" ? read(inputs.positionSize, "positionSize", "Position size") : null;

  if (balance !== null && balance <= 0n) {
    errors.push({ field: "accountBalance", message: "Account balance must be greater than zero." });
  }
  if (riskPercentInput !== null && riskPercentInput <= 0n) {
    errors.push({ field: "riskPercent", message: "Risk percent must be greater than zero." });
  }
  if (lotsInput !== null && lotsInput <= 0n) {
    errors.push({ field: "positionSize", message: "Position size must be greater than zero." });
  }

  if (entry !== null && stop !== null) {
    if (entry === stop) {
      errors.push({ field: "stopLoss", message: "Stop loss cannot equal the entry price." });
    } else if (direction === "long" && stop > entry) {
      errors.push({ field: "stopLoss", message: "On a long, the stop must be below the entry." });
    } else if (direction === "short" && stop < entry) {
      errors.push({ field: "stopLoss", message: "On a short, the stop must be above the entry." });
    }
  }

  if (entry !== null && target !== null) {
    if (direction === "long" && target < entry) {
      errors.push({ field: "takeProfit", message: "On a long, the target must be above the entry." });
    } else if (direction === "short" && target > entry) {
      errors.push({ field: "takeProfit", message: "On a short, the target must be below the entry." });
    }
  }

  if (errors.length > 0 || balance === null || entry === null || stop === null) {
    return { result: null, errors };
  }

  const stopDistance = calculateStopDistance(entry, stop);
  const targetDistance = target !== null ? calculateTargetDistance(entry, target) : null;
  const lossPerLot = lossPerLotAtDistance(stopDistance, instrument);

  // Solve for whichever of {lots, risk} was not supplied. Everything downstream
  // reads the resolved pair, so the two modes share one output path.
  let riskAmount: bigint;
  let positionSize: bigint;
  let adjustment: LotAdjustment | null = null;

  if (mode === "risk-to-size") {
    riskAmount = calculateRiskAmount(balance, riskPercentInput!);
    const sized = calculatePositionSize(riskAmount, stopDistance, instrument);
    positionSize = sized.lots;
    adjustment = sized.adjustment;
  } else {
    positionSize = lotsInput!;
    riskAmount = calculateRiskFromPositionSize(positionSize, stopDistance, instrument);
  }

  const potentialLoss = calculatePotentialLoss(positionSize, stopDistance, instrument);

  return {
    result: {
      // In risk-to-size the requested risk and the achievable risk differ once
      // the size is floored, and the achievable one is what the trade actually
      // costs - so both the money and the percentage are reported from the
      // final size rather than from the request.
      riskAmount: potentialLoss,
      riskPercent: div(mul(potentialLoss, parseDecimal("100")!), balance),
      positionSize,
      positionSizeAdjustment: adjustment,
      stopDistance,
      targetDistance,
      pipsRisked: distanceInPips(stopDistance, instrument),
      pipsTargeted: targetDistance !== null ? distanceInPips(targetDistance, instrument) : null,
      riskReward: targetDistance !== null ? calculateRiskReward(stopDistance, targetDistance) : null,
      potentialLoss,
      potentialProfit:
        targetDistance !== null
          ? calculatePotentialProfit(positionSize, targetDistance, instrument)
          : null,
      lossPerLot,
    },
    errors: [],
  };
}
