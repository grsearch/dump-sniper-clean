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

function prepareBuyQuoteState({
  swapState,
  order,
  firstBuyOnly,
  buySlippageBps,
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

  const baseRaw = normalizeRawTokenAmount({ amount: order?.poolBaseAfterRaw });
  const quoteRaw = normalizeRawTokenAmount({ amount: order?.poolQuoteAfterRaw });
  if (!baseRaw || !quoteRaw || baseRaw === '0' || quoteRaw === '0') {
    throw new Error('first_buy_only: exact post-dump reserves unavailable');
  }

  return {
    swapState: {
      ...swapState,
      poolBaseAmount: new BN(baseRaw),
      poolQuoteAmount: new BN(quoteRaw),
    },
    // PumpSwap buyQuoteInput builds a fixed baseAmountOut with maxQuoteAmountIn.
    // At zero slippage, an earlier buy that worsens the pool price makes the
    // transaction fail on-chain instead of filling behind it.
    slippagePct: 0,
    exactReserveFence: true,
  };
}

module.exports = {
  normalizeRawTokenAmount,
  prepareBuyQuoteState,
};
