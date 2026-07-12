'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Executor = require('../src/core/Executor');
const { config } = require('../src/config');
const { getMonitor } = require('../src/monitor/HealthMonitor');

test.after(() => getMonitor().stop());

function makeExecutor() {
  const executor = Object.create(Executor.prototype);
  executor.buySubmitMode = 'race';
  executor.buySignalFeeTiering = true;
  executor.computeUnitLimit = 250_000;
  executor.lowConfidenceBuyFeeLamports = 300_000;
  executor.highConfidenceBuyFeeLamports = 9_000_000;
  executor.feeOracle = {
    estimate: () => ({
      totalLamports: 5_000_000,
      microLamportsPerCu: 20_000_000,
      source: 'dynamic',
    }),
  };
  return executor;
}

function withStrategy(overrides, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = config.strategy[key];
    config.strategy[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      config.strategy[key] = value;
    }
  }
}

test('fee tiering promotes ideal strict-needle candidates to high-confidence fee', () => {
  withStrategy({ firstBuyNeedleMode: 'strict', firstBuyLowCompetitionMaxSellSol: 20 }, () => {
    const executor = makeExecutor();
    const plan = executor._classifyBuySubmission({
      exactReserveSource: 'tx_post_balances',
      sellSol: 12,
      _slotGap: 0,
      _poolCompetition: { buyCount: 0, buySol: 0, maxSingleBuySol: 0 },
      _poolCompetitionRaw: { buyCount: 0, buySol: 0, maxSingleBuySol: 0 },
      _dumpTsToSubmitMs: 100,
    }, {
      slippagePct: 3,
      exactReserveFence: true,
    });

    assert.equal(plan.submitMode, 'race');
    assert.equal(plan.feeMode, 'high_confidence');
    assert.match(plan.reason, /high_confidence/);
  });
});

test('fee tiering downgrades risky first-buy candidates to low fee', () => {
  withStrategy({ firstBuyNeedleMode: 'strict', firstBuyLowCompetitionMaxSellSol: 20 }, () => {
    const executor = makeExecutor();

    const largeSell = executor._classifyBuySubmission({
      exactReserveSource: 'tx_post_balances',
      sellSol: 35,
      _slotGap: 0,
      _poolCompetition: { buyCount: 0, buySol: 0, maxSingleBuySol: 0 },
      _poolCompetitionRaw: { buyCount: 0, buySol: 0, maxSingleBuySol: 0 },
      _dumpTsToSubmitMs: 100,
    }, {
      slippagePct: 2,
      exactReserveFence: true,
    });
    assert.equal(largeSell.feeMode, 'low_confidence');
    assert.match(largeSell.reason, /strict_large_sell/);

    const competition = executor._classifyBuySubmission({
      exactReserveSource: 'tx_post_balances',
      sellSol: 12,
      _slotGap: 0,
      _poolCompetition: { buyCount: 1, buySol: 0.4, maxSingleBuySol: 0.4 },
      _poolCompetitionRaw: { buyCount: 0, buySol: 0, maxSingleBuySol: 0 },
      _dumpTsToSubmitMs: 100,
    }, {
      slippagePct: 2,
      exactReserveFence: true,
    });
    assert.equal(competition.feeMode, 'low_confidence');
    assert.match(competition.reason, /competition/);

    const staleSlot = executor._classifyBuySubmission({
      exactReserveSource: 'tx_post_balances',
      sellSol: 12,
      _slotGap: 1,
      _poolCompetition: { buyCount: 0, buySol: 0, maxSingleBuySol: 0 },
      _poolCompetitionRaw: { buyCount: 0, buySol: 0, maxSingleBuySol: 0 },
      _dumpTsToSubmitMs: 100,
    }, {
      slippagePct: 2,
      exactReserveFence: true,
    });
    assert.equal(staleSlot.feeMode, 'low_confidence');
    assert.match(staleSlot.reason, /slot_gap=1/);
  });
});

test('strict needle downgrades raw same-slot competition and stale signals', () => {
  withStrategy({
    firstBuyNeedleMode: 'strict',
    firstBuyStrictMaxRawCompetingBuys: 0,
    firstBuyStrictMaxSignalAgeMs: 800,
  }, () => {
    const executor = makeExecutor();
    const rawCompetition = executor._classifyBuySubmission({
      exactReserveSource: 'tx_post_balances',
      sellSol: 12,
      _slotGap: 0,
      _poolCompetition: { buyCount: 0, buySol: 0, maxSingleBuySol: 0 },
      _poolCompetitionRaw: { buyCount: 1, buySol: 0.2, maxSingleBuySol: 0.2 },
      _dumpTsToSubmitMs: 100,
    }, {
      slippagePct: 3,
      exactReserveFence: true,
    });
    assert.equal(rawCompetition.feeMode, 'low_confidence');
    assert.match(rawCompetition.reason, /raw_competition/);

    const stale = executor._classifyBuySubmission({
      exactReserveSource: 'tx_post_balances',
      sellSol: 12,
      _slotGap: 0,
      _poolCompetition: { buyCount: 0, buySol: 0, maxSingleBuySol: 0 },
      _poolCompetitionRaw: { buyCount: 0, buySol: 0, maxSingleBuySol: 0 },
      _dumpTsToSubmitMs: 1200,
    }, {
      slippagePct: 3,
      exactReserveFence: true,
    });
    assert.equal(stale.feeMode, 'low_confidence');
    assert.match(stale.reason, /signal_age/);
  });
});

test('strict needle caps widened dynamic slippage', () => {
  withStrategy({
    firstBuyOnly: true,
    firstBuyDynamicSlippage: true,
    firstBuySlippageBps: 200,
    firstBuyLowCompetitionSlippageBps: 500,
    firstBuyStrictMaxSlippageBps: 300,
    firstBuyLowCompetitionMaxSellSol: 20,
    firstBuyNeedleMode: 'strict',
  }, () => {
    const executor = makeExecutor();
    const bps = executor._resolveFirstBuySlippageBps({
      exactReserveSource: 'tx_post_balances',
      sellSol: 12,
      _slotGap: 0,
      _poolCompetition: { buyCount: 0, buySol: 0, maxSingleBuySol: 0 },
    });
    assert.equal(bps, 300);
  });
});

test('low-confidence action can skip before signing and submitting', () => {
  withStrategy({ lowConfidenceBuyAction: 'skip' }, () => {
    const executor = makeExecutor();
    assert.equal(executor._shouldSkipLowConfidenceBuy({ feeMode: 'low_confidence' }), true);
    assert.equal(executor._shouldSkipLowConfidenceBuy({ feeMode: 'high_confidence' }), false);
  });
});

test('high-confidence priority fee applies a configurable floor', () => {
  const executor = makeExecutor();

  const high = executor._estimatePriorityFee('BUY', 'high_confidence');
  assert.equal(high.totalLamports, 9_000_000);
  assert.equal(high.microLamportsPerCu, 36_000_000);
  assert.match(high.source, /high_confidence_floor/);

  const low = executor._estimatePriorityFee('BUY', 'low_confidence');
  assert.equal(low.totalLamports, 300_000);
  assert.equal(low.source, 'low_confidence');

  const normal = executor._estimatePriorityFee('BUY', 'normal');
  assert.equal(normal.totalLamports, 5_000_000);
  assert.equal(normal.source, 'dynamic');
});
