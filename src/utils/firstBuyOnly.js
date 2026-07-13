'use strict';

const BN = require('bn.js');

function normalizeRawTokenAmount(uiTokenAmount) {
  const amount = uiTokenAmount?.amount;
  if (amount == null) return null;

  const raw = String(amount);
  if (!/^\d+$/.test(raw)) return null;

  try {
    return BigInt(raw).toString();
  } catch (_) {
    return null;
  }
}

function getVerifiedExactReserves(order) {
  if (order?.exactReserveSource !== 'tx_post_balances') {
    return null;
  }

  const baseRaw = normalizeRawTokenAmount({ amount: order?.poolBaseAfterRaw });
  const quoteRaw = normalizeRawTokenAmount({ amount: order?.poolQuoteAfterRaw });
  if (!baseRaw || !quoteRaw || baseRaw === '0' || quoteRaw === '0') {
    return null;
  }

  return { baseRaw, quoteRaw };
}

function isPredictedReserveSource(source) {
  return source === 'predicted_reserve' || source === 'cache_estimate';
}

function getUsableFirstBuyReserves(order, { allowPredicted = false } = {}) {
  const exact = getVerifiedExactReserves(order);
  if (exact) return { ...exact, source: 'tx_post_balances', predicted: false };

  if (!allowPredicted || !isPredictedReserveSource(order?.exactReserveSource)) {
    return null;
  }

  const baseRaw = normalizeRawTokenAmount({ amount: order?.poolBaseAfterRaw });
  const quoteRaw = normalizeRawTokenAmount({ amount: order?.poolQuoteAfterRaw });
  if (!baseRaw || !quoteRaw || baseRaw === '0' || quoteRaw === '0') {
    return null;
  }

  return {
    baseRaw,
    quoteRaw,
    source: order.exactReserveSource,
    predicted: true,
  };
}

function hasVerifiedExactReserves(order) {
  return getVerifiedExactReserves(order) !== null;
}

function hasUsableFirstBuyReserves(order, opts) {
  return getUsableFirstBuyReserves(order, opts) !== null;
}

function prepareBuyQuoteState({
  swapState,
  order,
  firstBuyOnly,
  buySlippageBps,
  firstBuySlippageBps = 0,
  allowPredictedReserves = false,
}) {
  if (!firstBuyOnly) {
    return {
      swapState,
      slippagePct: buySlippageBps / 100,
      exactReserveFence: false,
    };
  }

  if (!swapState) {
    throw new Error('first_buy_only: pool metadata cache miss');
  }

  const reserves = getUsableFirstBuyReserves(order, { allowPredicted: allowPredictedReserves });
  if (!reserves) {
    const source = order?.exactReserveSource || 'none';
    if (source === 'tx_post_balances') {
      throw new Error('first_buy_only: exact post-dump reserves unavailable');
    }
    if (allowPredictedReserves && isPredictedReserveSource(source)) {
      throw new Error('first_buy_only: predicted post-dump reserves unavailable');
    }
    throw new Error('first_buy_only: exact post-dump reserves not verified');
  }
  const { baseRaw, quoteRaw } = reserves;

  return {
    swapState: {
      ...swapState,
      poolBaseAmount: new BN(baseRaw),
      poolQuoteAmount: new BN(quoteRaw),
    },
    // PumpSwap buyQuoteInput builds a fixed baseAmountOut with maxQuoteAmountIn.
    // Keep the default tolerance at 0 for strict first-buy behavior. Raising
    // FIRST_BUY_SLIPPAGE_BPS intentionally trades strictness for fill rate.
    slippagePct: Math.max(0, Number(firstBuySlippageBps) || 0) / 100,
    exactReserveFence: true,
  };
}

module.exports = {
  getVerifiedExactReserves,
  getUsableFirstBuyReserves,
  hasVerifiedExactReserves,
  hasUsableFirstBuyReserves,
  isPredictedReserveSource,
  normalizeRawTokenAmount,
  prepareBuyQuoteState,
};
