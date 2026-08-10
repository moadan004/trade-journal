"use client";

import { useMemo, useState } from "react";

import { formatDecimal, formatMoney } from "@/lib/decimal";
import { DEFAULT_INSTRUMENT, findInstrument, INSTRUMENTS } from "@/lib/instruments";
import {
  calculate,
  type CalculatorInputs,
  type CalculatorMode,
  type FieldError,
  type LotAdjustment,
  type TradeDirection,
} from "@/lib/positionSize";

const labelClasses = "block text-xs font-medium text-zinc-500 dark:text-zinc-400";
const inputClasses =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 " +
  "focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300 " +
  "dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600 dark:focus:ring-zinc-700";

const MODES: { id: CalculatorMode; label: string; hint: string }[] = [
  { id: "risk-to-size", label: "Risk → Lot size", hint: "I know my risk. What size do I trade?" },
  { id: "size-to-risk", label: "Lot size → Risk", hint: "I know my size. What am I risking?" },
];

/** Message shown when the venue's lot rules moved the size off the ideal. */
const ADJUSTMENT_NOTE: Record<LotAdjustment, string> = {
  "rounded-down":
    "Rounded down to the lot step, so the realised risk is slightly under the amount requested.",
  "below-minimum":
    "This is below the minimum tradeable lot. Trading the minimum would risk more than you asked for.",
  "above-maximum": "Capped at the maximum tradeable lot for this instrument.",
};

function errorFor(errors: FieldError[], field: keyof CalculatorInputs): string | undefined {
  return errors.find((e) => e.field === field)?.message;
}

function Field({
  id,
  label,
  suffix,
  value,
  onChange,
  error,
  placeholder,
  inputMode = "decimal",
}: {
  id: string;
  label: string;
  suffix?: string;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  placeholder?: string;
  inputMode?: "decimal" | "numeric";
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClasses}>
        {label}
        {suffix && <span className="ml-1 text-zinc-400 dark:text-zinc-500">{suffix}</span>}
      </label>
      <input
        id={id}
        // `text` with a decimal inputMode, not `number`: a number input drops
        // trailing separators mid-typing and its spinners are useless on prices.
        // The engine parses the string itself and reports what it can't read.
        type="text"
        inputMode={inputMode}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${inputClasses} ${error ? "border-red-400 dark:border-red-700" : ""}`}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

/** One headline figure. `tone` colours the outcome pair green/red. */
function Metric({
  label,
  value,
  sub,
  tone = "neutral",
  testId,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "positive" | "negative" | "emphasis";
  testId: string;
}) {
  // -700 in light rather than -600: it matches what SessionIndicator already
  // uses for "open", and it clears 4.5:1 on white outright instead of leaning
  // on the large-text exemption these 24px figures would otherwise need.
  const valueTone = {
    neutral: "text-zinc-900 dark:text-zinc-100",
    emphasis: "text-zinc-900 dark:text-zinc-100",
    positive: "text-emerald-700 dark:text-emerald-400",
    negative: "text-red-700 dark:text-red-400",
  }[tone];

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</p>
      <p
        data-testid={testId}
        className={`mt-1 font-semibold tabular-nums ${
          tone === "emphasis" ? "text-3xl" : "text-2xl"
        } ${valueTone}`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{sub}</p>}
    </div>
  );
}

export function PositionCalculator() {
  const [mode, setMode] = useState<CalculatorMode>("risk-to-size");

  // One state object shared by both modes. Switching mode swaps which field is
  // read, never which fields exist, so nothing the user typed is thrown away.
  const [form, setForm] = useState<CalculatorInputs>({
    instrument: DEFAULT_INSTRUMENT,
    direction: "long",
    accountBalance: "10000",
    entryPrice: "",
    stopLoss: "",
    takeProfit: "",
    riskPercent: "1",
    positionSize: "0.10",
  });

  function set<K extends keyof CalculatorInputs>(key: K, value: CalculatorInputs[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const { result, errors } = useMemo(() => calculate(form, mode), [form, mode]);

  const { instrument } = form;
  const priceStep = `${instrument.tickSize} steps`;
  // Only complain about incomplete input once the user has actually typed.
  const touched = form.entryPrice.trim() !== "" || form.stopLoss.trim() !== "";
  const visibleErrors = touched ? errors : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <section
        aria-label="Trade parameters"
        className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
      >
        {/* Segmented control rather than a dropdown: there are exactly two
            directions and both labels are worth reading at a glance. */}
        <div
          role="group"
          aria-label="Calculation mode"
          className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-950"
        >
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              data-testid={`mode-${m.id}`}
              aria-pressed={mode === m.id}
              onClick={() => setMode(m.id)}
              className={`rounded-lg px-2 py-2 text-xs font-medium transition-colors ${
                mode === m.id
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          {MODES.find((m) => m.id === mode)!.hint}
        </p>

        <div className="mt-4 grid gap-4">
          <div>
            <label htmlFor="calc-instrument" className={labelClasses}>
              Instrument
            </label>
            <select
              id="calc-instrument"
              value={instrument.symbol}
              onChange={(e) => set("instrument", findInstrument(e.target.value) ?? DEFAULT_INSTRUMENT)}
              className={inputClasses}
            >
              {INSTRUMENTS.map((i) => (
                <option key={i.symbol} value={i.symbol}>
                  {i.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              1 pip = {instrument.pipSize} · contract {instrument.contractSize} · lots{" "}
              {instrument.minimumLot}–{instrument.maximumLot} in {instrument.lotStep}
            </p>
          </div>

          <div>
            <span className={labelClasses}>Direction</span>
            <div className="mt-1 grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-950">
              {(["long", "short"] as TradeDirection[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  data-testid={`direction-${d}`}
                  aria-pressed={form.direction === d}
                  onClick={() => set("direction", d)}
                  className={`rounded-lg px-2 py-1.5 text-xs font-medium capitalize transition-colors ${
                    form.direction === d
                      ? d === "long"
                        ? "bg-emerald-500 text-white"
                        : "bg-red-500 text-white"
                      : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <Field
            id="calc-balance"
            label="Account balance"
            suffix="USD"
            value={form.accountBalance}
            onChange={(v) => set("accountBalance", v)}
            error={errorFor(visibleErrors, "accountBalance")}
          />

          {/* The mode-specific input sits between balance and prices so the two
              modes differ by one field in one place, not by a re-ordered form. */}
          {mode === "risk-to-size" ? (
            <Field
              id="calc-risk-percent"
              label="Risk per trade"
              suffix="%"
              value={form.riskPercent}
              onChange={(v) => set("riskPercent", v)}
              error={errorFor(visibleErrors, "riskPercent")}
            />
          ) : (
            <Field
              id="calc-position-size"
              label="Position size"
              suffix="lots"
              value={form.positionSize}
              onChange={(v) => set("positionSize", v)}
              error={errorFor(visibleErrors, "positionSize")}
            />
          )}

          <Field
            id="calc-entry"
            label="Entry price"
            suffix={priceStep}
            placeholder={instrument.symbol === "XAUUSD" ? "3300.00" : "1.10000"}
            value={form.entryPrice}
            onChange={(v) => set("entryPrice", v)}
            error={errorFor(visibleErrors, "entryPrice")}
          />
          <Field
            id="calc-stop"
            label="Stop loss"
            value={form.stopLoss}
            placeholder={instrument.symbol === "XAUUSD" ? "3297.00" : "1.09750"}
            onChange={(v) => set("stopLoss", v)}
            error={errorFor(visibleErrors, "stopLoss")}
          />
          <Field
            id="calc-target"
            label="Take profit"
            suffix="optional"
            value={form.takeProfit}
            placeholder={instrument.symbol === "XAUUSD" ? "3306.00" : "1.10500"}
            onChange={(v) => set("takeProfit", v)}
            error={errorFor(visibleErrors, "takeProfit")}
          />
        </div>
      </section>

      <section aria-label="Calculated trade parameters" className="grid content-start gap-4">
        {!result ? (
          <div
            data-testid="calc-empty"
            className="rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
          >
            {touched && visibleErrors.length > 0
              ? "Fix the highlighted fields to see the numbers."
              : "Enter an entry and a stop to size the trade."}
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {/* The two answers, whichever direction produced them. In
                  risk-to-size the lot size is the output; in size-to-risk the
                  risk is. Both are always shown so switching mode reads as the
                  same numbers re-derived, not a different screen. */}
              <Metric
                testId="out-position-size"
                label="Position size"
                tone="emphasis"
                value={`${formatDecimal(result.positionSize, 2)} lots`}
                sub={`${formatMoney(result.lossPerLot)} risked per 1.00 lot`}
              />
              <Metric
                testId="out-risk"
                label="Risk"
                tone="emphasis"
                value={formatMoney(result.riskAmount)}
                sub={`${formatDecimal(result.riskPercent, 2)}% of balance`}
              />
            </div>

            {result.positionSizeAdjustment && (
              <p
                data-testid="out-adjustment"
                className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-400/10 dark:text-amber-300"
              >
                {ADJUSTMENT_NOTE[result.positionSizeAdjustment]}
              </p>
            )}

            {/* Pips get their own row of standalone figures. They are the
                numbers a scalper actually checks against the chart, and reading
                them off an R:R ratio is not possible - the same 2.0 R:R covers a
                25-pip stop and a 100-pip one. */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Metric
                testId="out-pips-risked"
                label="Pips risked"
                tone="negative"
                value={formatDecimal(result.pipsRisked, 1)}
                sub={`${formatDecimal(result.stopDistance, instrument.priceDecimals)} price`}
              />
              <Metric
                testId="out-pips-targeted"
                label="Pips targeted"
                tone="positive"
                value={result.pipsTargeted !== null ? formatDecimal(result.pipsTargeted, 1) : "—"}
                sub={
                  result.targetDistance !== null
                    ? `${formatDecimal(result.targetDistance, instrument.priceDecimals)} price`
                    : "add a take profit"
                }
              />
              <Metric
                testId="out-rr"
                label="Risk / reward"
                value={result.riskReward !== null ? `1 : ${formatDecimal(result.riskReward, 2)}` : "—"}
                sub={result.riskReward !== null ? "reward per unit risked" : "add a take profit"}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Metric
                testId="out-loss"
                label="Potential loss"
                tone="negative"
                value={`-${formatMoney(result.potentialLoss)}`}
                sub="if the stop is hit"
              />
              <Metric
                testId="out-profit"
                label="Potential profit"
                tone="positive"
                value={
                  result.potentialProfit !== null ? `+${formatMoney(result.potentialProfit)}` : "—"
                }
                sub={result.potentialProfit !== null ? "if the target is hit" : "add a take profit"}
              />
            </div>
          </>
        )}

        <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          Figures are calculated locally from the contract specification and never leave your
          browser. This is a planning tool — it does not connect to a broker or place, modify or
          transmit any order. Spread, commission, swap and slippage are not included, so the live
          fill will differ slightly. Confirm the contract details against your terminal&apos;s symbol
          specification before sizing real money.
        </p>
      </section>
    </div>
  );
}
