'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const SignalEngine = require('../src/core/SignalEngine');
const { config } = require('../src/config');
const { getMonitor } = require('../src/monitor/HealthMonitor');

test.after(() => getMonitor().stop());

function makeEngine() {
  const engine = Object.create(SignalEngine.prototype);
  engine._poolSlotBuys = new Map();
  engine._poolSlotBuyTtlMs = 60_000;
  engine._buy6004Failures = new Map();
  engine._exitCooldowns = new Map();
  engine._exitCooldownReasons = new Map();
  return engine;
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

test('same-slot pool competition guard rejects already crowded pools', () => {
  withStrategy({
    firstBuyCompetitionFilter: true,
    firstBuyMaxCompetingBuys: 3,
    firstBuyMaxCompetingSol: 2,
    firstBuyMaxSingleCompetingBuySol: 3,
  }, () => {
    const engine = makeEngine();
    engine.handleSwapParsed({ side: 'BUY', poolAddress: 'poolA', slot: 100, solVolume: 0.5 });
    engine.handleSwapParsed({ side: 'BUY', poolAddress: 'poolA', slot: 100, solVolume: 0.6 });

    let check = engine.checkPoolCompetition({ poolAddress: 'poolA', slot: 100 });
    assert.equal(check.ok, true);
    assert.equal(check.stats.buyCount, 2);
    assert.equal(Number(check.stats.buySol.toFixed(1)), 1.1);

    engine.handleSwapParsed({ side: 'BUY', poolAddress: 'poolA', slot: 100, solVolume: 0.4 });
    check = engine.checkPoolCompetition({ poolAddress: 'poolA', slot: 100 });
    assert.equal(check.ok, false);
    assert.match(check.reason, /same-slot competition/);

    const baseline = engine.getPoolCompetitionPressure('poolB', 200);
    engine.handleSwapParsed({ side: 'BUY', poolAddress: 'poolB', slot: 200, solVolume: 1.1 });
    check = engine.checkPoolCompetition({
      poolAddress: 'poolB',
      slot: 200,
      _poolCompetitionBaseline: baseline,
    });
    assert.equal(check.ok, true);
    assert.equal(check.stats.buyCount, 1);
    assert.equal(Number(check.stats.buySol.toFixed(1)), 1.1);
  });
});

test('6004 fee-burn guard only cools after consecutive slippage failures', () => {
  withStrategy({
    buy6004CooldownAfter: 2,
    buy6004CooldownMs: 60_000,
    buy6004FailureWindowMs: 600_000,
  }, () => {
    const engine = makeEngine();
    engine.recordBuyChainFailure('mintA', 'TEST', '{"InstructionError":[10,{"Custom":6004}]}');
    assert.equal(engine._exitCooldowns.has('mintA'), false);

    engine.recordBuyChainFailure('mintA', 'TEST', 'ExceededSlippage');
    assert.equal(engine._exitCooldowns.has('mintA'), true);
    assert.ok(engine._exitCooldowns.get('mintA') > Date.now());
    assert.equal(engine._buy6004Failures.has('mintA'), false);

    engine.recordBuyChainFailure('mintB', 'OTHER', 'AccountNotInitialized');
    assert.equal(engine._exitCooldowns.has('mintB'), false);

    engine.recordBuyChainFailure('mintC', 'RESET', '6004');
    engine.recordBuyLanded('mintC');
    assert.equal(engine._buy6004Failures.has('mintC'), false);
  });
});

test('predicted reserve guard requires stronger impact and fresh cache', () => {
  withStrategy({
    firstBuyReserveMode: 'speed_first',
    firstBuyPredictedMinImpactPct: 20,
    firstBuyPredictedMaxCacheAgeMs: 1000,
  }, () => {
    const engine = makeEngine();

    assert.deepEqual(
      engine._checkPredictedReserveSignal({
        exactReserveSource: 'predicted_reserve',
        priceImpactPct: 17,
        predictedReserveCacheAgeMs: 100,
      }),
      { ok: false, reason: 'predicted_reserve impact:17.0%<20%' },
    );

    assert.deepEqual(
      engine._checkPredictedReserveSignal({
        exactReserveSource: 'predicted_reserve',
        priceImpactPct: 22,
        predictedReserveCacheAgeMs: 1500,
      }),
      { ok: false, reason: 'predicted_reserve cache_age:1500ms>1000ms' },
    );

    assert.deepEqual(
      engine._checkPredictedReserveSignal({
        exactReserveSource: 'predicted_reserve',
        priceImpactPct: 22,
        predictedReserveCacheAgeMs: 500,
      }),
      { ok: true },
    );

    assert.deepEqual(
      engine._checkPredictedReserveSignal({
        exactReserveSource: 'tx_post_balances',
        priceImpactPct: 8,
      }),
      { ok: true },
    );
  });
});
