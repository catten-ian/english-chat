'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const world=require('../server/services/world-game');
test('each provider-free fallback chapter has three distinct questions and four choices',()=>{
  for(const stage of world.stages){
    assert.equal(stage.questions.length,3,stage.id);
    assert.equal(new Set(stage.questions.map(q=>q.q)).size,3,stage.id);
    for(const q of stage.questions){assert.equal(q.options.length,4);assert.equal(new Set(q.options).size,4);assert.ok(Number.isInteger(q.answer)&&q.answer>=0&&q.answer<4);assert.ok(q.why);}
  }
});
