# CRT Models — TradingView indicator

`crt_models.pine` implements the two Candle Range Theory models as a Pine Script v6
overlay indicator: **Model 1** (reversal) and **trend continuation**, sharing one risk
block (stop-loss mode, 1:1 partial alert, key-time filter, lower-timeframe entry
refinement).

It is an *indicator*, not a strategy — it draws levels and fires alerts, it does not
place orders or produce a backtest report.

## Installing

1. TradingView → **Pine Editor** → **Open** → *New indicator*.
2. Paste the contents of `crt_models.pine`, replacing the template.
3. **Save**, then **Add to chart**.
4. For alerts: create an alert on the chart, condition = the indicator, and pick
   **Any alert() function call** to get the dynamic messages (entry, stop, 1R level).
   The three static `alertcondition` entries — buy, sell, 1:1 reached — are also
   available if you prefer fixed messages.

## Rule → implementation map

### Module 1 — reversal

| Rule | Implementation |
|---|---|
| Candle 1 clears a range high/low, taps an OB/breaker/FVG, or sweeps liquidity | `isCandle1` — first bar to trade through PDH/PDL, PWH/PWL or the last swing pivot, or a bar intersecting a tracked FVG/OB zone. Its high/low become the range. |
| A big bulky candle exits the Candle 1 range | `isBulky` — body ≥ `ATR × mult` **and** body ≥ `%` of the candle's own range (so a large but indecisive long-wicked candle is rejected), and the candle takes out `c1High` or `c1Low`. |
| Confirmation A — the immediate next candle closes inside the body | stage 0 → 1, requires `age == 1` and the close between `bodyLow` and `bodyHigh`. A body close, not a wick: the test is on `close`. |
| Confirmation B — the second or third candle closes beyond the range (MSS) | stage 1 → 2, requires `age ≤ 3` and a close beyond `bulkyLow` (shorts) / `bulkyHigh` (longs). |
| Invalidation — a candle closes beyond the high/low of the bulky candle first | `invalid`, checked before everything else on every bar, in every stage. |
| Entry — price taps the Model 1 candle body, rejects, closes outside the range again | stage 2. `tapped` latches when price re-enters the body; the arrow fires on the first close back outside it. |

Direction is set by which side the manipulation candle exits: exits above the range →
short bias, below → long. A candle that engulfs both sides is assigned to whichever
excursion is larger.

### Module 2 — trend continuation

| Rule | Implementation |
|---|---|
| Confirm a trending market | Pivot structure: higher highs *and* higher lows = uptrend, lower highs *and* lower lows = downtrend. |
| Discount/premium filter | Impulse leg anchored at the pivot that started it and extended by the running extreme; buys require `close` below the leg's 50%, sells above. Toggle with *Require discount/premium*. |
| Mark only the opposite candle | Uptrend → the most recent bearish candle; downtrend → the most recent bullish candle. |
| Sweep — takes the opposite candle's high/low but closes back inside its range | `swept`, plus the session and discount/premium filters. |
| Invalidation — closes completely outside the range | `brokeOut` clears the marked candle so the next one is used instead. |

### Shared execution and risk

| Rule | Implementation |
|---|---|
| LTF refinement | On the signal bar, `request.security_lower_tf` pulls the intrabar highs/lows and finds the newest FVG in the trade direction. Entry becomes the gap's proximal edge / 50% / distal edge per the *Entry inside the FVG* input. |
| Aggressive stop | Just beyond the Model 1 candle **body** (Module 2: beyond the opposite candle's swept edge), plus the tick buffer. |
| Conservative stop ("the soup") | Beyond the highest/lowest **wick** of the whole setup — tracked from the manipulation candle onward. |
| Capital protection | The trade tracker watches for the 1:1 level and fires *"close 50% and move the stop to breakeven"*. |
| Timing filter | `0830-1030` America/New_York by default — the hour before the NY open plus the opening hour. Both modules require it before firing. |

When the LTF refinement supplies an entry, that entry is a **resting limit inside the
gap**, so the tracker waits for price to trade back to it before arming the 1:1 and
stop checks. If it never fills within the zone-expiry window, the setup stands down.

## Known limitations

- **Breakers are not modelled separately.** "Taps an OB, breaker or FVG" is implemented
  as FVGs plus the order block behind each FVG's displacement leg (the last
  opposite-colour candle). A true breaker — an order block that fails, is violated, then
  retested from the other side — is not detected as its own object.
- **One Model 1 setup at a time.** A new manipulation candle supersedes an unconfirmed
  setup, but is ignored while an entry zone is already armed.
- **Trend detection lags** by `tcPivotLen` bars, since a pivot is only confirmed that
  many bars after it prints. This is inherent to pivot-based structure, not a bug.
- **Intrabar ambiguity.** The 1:1 tracker reads bar highs/lows, so if a single bar
  touches both the stop and the 1R level it reports the 1R first. Drop to a lower chart
  timeframe if that distinction matters to you.
- **LTF refinement depends on intrabar history**, which TradingView limits by plan. On
  older bars the gap search silently finds nothing and the entry falls back to the
  signal bar's close.
- **Not repaint-free by accident.** Setups only advance on confirmed bars while
  *Evaluate on bar close only* is on (the default). Turning it off makes setups form and
  un-form intrabar.
- Higher-timeframe levels (PDH/PDL, PWH/PWL) use the previous *completed* day/week, the
  standard non-repainting `request.security` idiom.

## Tuning notes

The defaults are a starting point, not a calibration. The two inputs that change signal
count the most are **Body ≥ ATR ×** (raise it to demand a more violent manipulation
candle) and **Candle 1 stays valid for** (how patient the model is between the sweep and
the manipulation). On fast intraday charts, widening the key-time window or turning the
timing filter off will surface far more setups — check them against your own journal
before trusting them.
