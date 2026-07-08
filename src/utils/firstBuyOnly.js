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

function hasVerifiedExactReserves(order) {
  return getVerifiedExactReserves(order) !== null;
}

function prepareBuyQuoteState({
  swapState,
  order,
  firstBuyOnly,
  buySlippageBps,
  firstBuySlippageBps = 0,
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

  if (order?.exactReserveSource !== 'tx_post_balances') {
    throw new Error('first_buy_only: exact post-dump reserves not verified');
  }

  const exactReserves = getVerifiedExactReserves(order);
  if (!exactReserves) {
    throw new Error('first_buy_only: exact post-dump reserves unavailable');
  }
  const { baseRaw, quoteRaw } = exactReserves;

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
  hasVerifiedExactReserves,
  normalizeRawTokenAmount,
  prepareBuyQuoteState,
};
