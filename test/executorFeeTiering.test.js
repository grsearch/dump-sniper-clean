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

test('fee tiering keeps ideal first-buy candidates at normal fee even with 2-3% slippage', () => {
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
    assert.equal(plan.feeMode, 'normal');
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
