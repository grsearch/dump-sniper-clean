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

test('fee tiering promotes ideal first-buy candidates to high-confidence fee even with 2-3% slippage', () => {
  withStrategy({ firstBuyLowCompetitionMaxSellSol: 20 }, () => {
    const executor = makeExecutor();
    const plan = executor._classifyBuySubmission({
      exactReserveSource: 'tx_post_balances',
      sellSol: 12,
      _slotGap: 0,
      _poolCompetition: { buyCount: 0, buySol: 0, maxSingleBuySol: 0 },
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
  withStrategy({ firstBuyLowCompetitionMaxSellSol: 20 }, () => {
    const executor = makeExecutor();

    const largeSell = executor._classifyBuySubmission({
      exactReserveSource: 'tx_post_balances',
      sellSol: 35,
      _slotGap: 0,
      _poolCompetition: { buyCount: 0, buySol: 0, maxSingleBuySol: 0 },
    }, {
      slippagePct: 2,
      exactReserveFence: true,
    });
    assert.equal(largeSell.feeMode, 'low_confidence');
    assert.match(largeSell.reason, /large_sell/);

    const competition = executor._classifyBuySubmission({
      exactReserveSource: 'tx_post_balances',
      sellSol: 12,
      _slotGap: 0,
      _poolCompetition: { buyCount: 1, buySol: 0.4, maxSingleBuySol: 0.4 },
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
    }, {
      slippagePct: 2,
      exactReserveFence: true,
    });
    assert.equal(staleSlot.feeMode, 'low_confidence');
    assert.match(staleSlot.reason, /slot_gap=1/);
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
