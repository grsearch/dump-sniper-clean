'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const PositionManager = require('../src/core/PositionManager');
const { getMonitor } = require('../src/monitor/HealthMonitor');

test.after(() => getMonitor().stop());

test('pending jito bundleOnly BUY cannot trigger a sell exit', async () => {
  const manager = Object.create(PositionManager.prototype);
  const pos = {
    mint: 'mint',
    symbol: 'TEST',
    buySubmitMode: 'jito_bundle_only',
    reconciled: false,
    dryRun: false,
    exiting: false,
  };

  await manager._exit(pos, 1, 'SLOT_EXIT');

  assert.equal(pos.exiting, false);
  assert.equal(pos.exitReason, undefined);
});

test('unconfirmed live BUY cannot trigger a sell exit in race mode', async () => {
  const manager = Object.create(PositionManager.prototype);
  const pos = {
    mint: 'mint',
    symbol: 'TEST',
    buySubmitMode: 'race',
    reconciled: false,
    dryRun: false,
    exiting: false,
  };

  await manager._exit(pos, 1, 'SLOT_EXIT');

  assert.equal(pos.exiting, false);
  assert.equal(pos.exitReason, undefined);
});

test('restored buy_slot=0 position cannot trigger a sell exit', async () => {
  const manager = Object.create(PositionManager.prototype);
  const pos = {
    mint: 'mint',
    symbol: 'TEST',
    buySubmitMode: 'race',
    reconciled: true,
    buySlot: 0,
    dryRun: false,
    exiting: false,
  };

  await manager._exit(pos, 1, 'TIMEOUT_5M');

  assert.equal(pos.exiting, false);
  assert.equal(pos.exitReason, undefined);
});

test('token-gone before buy reconcile is not recorded as a full entry loss', () => {
  const manager = Object.create(PositionManager.prototype);
  const pos = {
    positionId: 'p1',
    mint: 'mint',
    symbol: 'TEST',
    entrySol: 1,
    reconciled: false,
    dryRun: false,
    sellFeeLamports: 0,
  };
  let closed = null;
  let buyStatus = null;
  manager.positions = new Map([[pos.positionId, pos]]);
  manager._removeByMint = () => {};
  manager.tradeLogger = {
    closePosition: (_positionId, payload) => { closed = payload; },
    updateTradeStatus: (_positionId, side, payload) => { buyStatus = { side, ...payload }; },
  };
  manager.executor = { poolStateCache: { removeHot: () => {} } };

  manager._scheduleRetryOrStuck(pos, 1, '{"InstructionError":[0,{"Custom":1}]}');

  assert.equal(closed.exitReason, 'BUY_NOT_LANDED');
  assert.ok(closed.pnlSol > -0.001);
  assert.notEqual(closed.pnlSol, -1);
  assert.equal(buyStatus.side, 'BUY');
  assert.equal(buyStatus.success, false);
});

test('token-gone on restored buy_slot=0 position is not recorded as a full entry loss', () => {
  const manager = Object.create(PositionManager.prototype);
  const pos = {
    positionId: 'p2',
    mint: 'mint',
    symbol: 'TEST',
    entrySol: 1,
    reconciled: true,
    buySlot: 0,
    dryRun: false,
    sellFeeLamports: 0,
  };
  let closed = null;
  let buyStatus = null;
  manager.positions = new Map([[pos.positionId, pos]]);
  manager._removeByMint = () => {};
  manager.tradeLogger = {
    closePosition: (_positionId, payload) => { closed = payload; },
    updateTradeStatus: (_positionId, side, payload) => { buyStatus = { side, ...payload }; },
  };
  manager.executor = { poolStateCache: { removeHot: () => {} } };

  manager._scheduleRetryOrStuck(pos, 1, '{"InstructionError":[0,{"Custom":1}]}');

  assert.equal(closed.exitReason, 'BUY_NOT_LANDED');
  assert.ok(closed.pnlSol > -0.001);
  assert.notEqual(closed.pnlSol, -1);
  assert.equal(buyStatus.side, 'BUY');
  assert.equal(buyStatus.success, false);
});
