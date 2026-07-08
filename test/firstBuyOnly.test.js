'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  hasVerifiedExactReserves,
  normalizeRawTokenAmount,
  prepareBuyQuoteState,
} = require('../src/utils/firstBuyOnly');
const DumpDetector = require('../src/core/DumpDetector');
const { getMonitor } = require('../src/monitor/HealthMonitor');

test.after(() => getMonitor().stop());

test('normalizes large raw token balances without Number precision loss', () => {
  const raw = '9876543210123456789';
  assert.equal(normalizeRawTokenAmount({ amount: raw }), raw);
  assert.equal(normalizeRawTokenAmount({ amount: '00042' }), '42');
  assert.equal(normalizeRawTokenAmount({ amount: '1.5' }), null);
});

test('strict mode replaces cached reserves and forces zero slippage', () => {
  const cachedState = {
    poolBaseAmount: { stale: true },
    poolQuoteAmount: { stale: true },
    pool: { id: 'metadata-is-preserved' },
  };

  const result = prepareBuyQuoteState({
    swapState: cachedState,
    order: {
      poolBaseAfterRaw: '1234567890123456789',
      poolQuoteAfterRaw: '9876543210',
      exactReserveSource: 'tx_post_balances',
    },
    firstBuyOnly: true,
    buySlippageBps: 2500,
  });

  assert.notEqual(result.swapState, cachedState);
  assert.equal(result.swapState.pool, cachedState.pool);
  assert.equal(result.swapState.poolBaseAmount.toString(), '1234567890123456789');
  assert.equal(result.swapState.poolQuoteAmount.toString(), '9876543210');
  assert.equal(result.slippagePct, 0);
  assert.equal(result.exactReserveFence, true);
});

test('strict mode fails closed when exact reserves or cache are unavailable', () => {
  assert.throws(
    () => prepareBuyQuoteState({
      swapState: null,
      order: {},
      firstBuyOnly: true,
      buySlippageBps: 2500,
    }),
    /pool metadata cache miss/,
  );

  assert.throws(
    () => prepareBuyQuoteState({
      swapState: { pool: {} },
      order: {
        poolBaseAfterRaw: '10',
        poolQuoteAfterRaw: '20',
        exactReserveSource: 'cache_estimate',
      },
      firstBuyOnly: true,
      buySlippageBps: 2500,
    }),
    /exact post-dump reserves not verified/,
  );

  assert.throws(
    () => prepareBuyQuoteState({
      swapState: { pool: {} },
      order: {
        poolBaseAfterRaw: '10',
        exactReserveSource: 'tx_post_balances',
      },
      firstBuyOnly: true,
      buySlippageBps: 2500,
    }),
    /exact post-dump reserves unavailable/,
  );
});

test('strict mode can be configured with a small first-buy tolerance', () => {
  const result = prepareBuyQuoteState({
    swapState: { pool: {} },
    order: {
      poolBaseAfterRaw: '1000',
      poolQuoteAfterRaw: '2000',
      exactReserveSource: 'tx_post_balances',
    },
    firstBuyOnly: true,
    buySlippageBps: 2500,
    firstBuySlippageBps: 100,
  });

  assert.equal(result.slippagePct, 1);
  assert.equal(result.exactReserveFence, true);
});

test('verified exact reserves require tx post-balance source and both raw reserves', () => {
  assert.equal(hasVerifiedExactReserves({
    poolBaseAfterRaw: '10',
    poolQuoteAfterRaw: '20',
    exactReserveSource: 'tx_post_balances',
  }), true);
  assert.equal(hasVerifiedExactReserves({
    poolBaseAfterRaw: '10',
    poolQuoteAfterRaw: '20',
    exactReserveSource: 'cache_estimate',
  }), false);
  assert.equal(hasVerifiedExactReserves({
    poolBaseAfterRaw: '10',
    exactReserveSource: 'tx_post_balances',
  }), false);
});

test('normal mode preserves cached state and configured slippage', () => {
  const cachedState = { pool: {} };
  const result = prepareBuyQuoteState({
    swapState: cachedState,
    order: {},
    firstBuyOnly: false,
    buySlippageBps: 2500,
  });

  assert.equal(result.swapState, cachedState);
  assert.equal(result.slippagePct, 25);
  assert.equal(result.exactReserveFence, false);
});

test('dump signal carries exact raw post-swap reserves without conversion', () => {
  const detector = new DumpDetector({});
  let emitted = null;
  detector.once('dumpSignal', (signal) => { emitted = signal; });

  detector._emitSingleDumpSignal({
    baseMint: 'mint',
    symbol: 'TEST',
    signer: 'seller',
    signature: 'signature',
    ts: 1,
    slot: 2,
    poolAddress: 'pool',
    poolBaseVault: 'base-vault',
    poolQuoteVault: 'quote-vault',
    poolBaseAfterRaw: '9876543210123456789',
    poolQuoteAfterRaw: '123456789012345678',
    exactReserveSource: 'tx_post_balances',
    priceAfter: 1,
    priceBefore: 2,
    baseDecimals: 6,
    quoteDecimals: 9,
  }, 20, 10, 100);

  assert.equal(emitted.poolBaseAfterRaw, '9876543210123456789');
  assert.equal(emitted.poolQuoteAfterRaw, '123456789012345678');
  assert.equal(emitted.exactReserveSource, 'tx_post_balances');
  clearInterval(detector._recentSellCleanup);
  clearInterval(detector._processedSigCleanup);
});

test('dump detector signature dedup state is initialized', () => {
  const detector = new DumpDetector({ getByMint: () => null });

  assert.doesNotThrow(() => detector.handleTransaction({
    signature: Buffer.from(Array.from({ length: 64 }, (_, i) => i)),
  }));
  assert.equal(detector._processedSigs.size, 1);

  clearInterval(detector._recentSellCleanup);
  clearInterval(detector._processedSigCleanup);
});
