import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  startCall,
  afterTurn,
  afterSpeaking,
  afterListening,
  phaseFor,
  isLive,
  progress,
  type CallState,
} from './agent-call.ts'

const ask = (say: string, key: string) => ({ kind: 'ask' as const, questionKey: key, say })

test('a fresh call is idle with nothing said', () => {
  const s = startCall()
  assert.equal(s.phase, 'idle')
  assert.equal(s.log.length, 0)
  assert.equal(s.asked, null)
})

test('the agent speaks, then the phone listens by itself', () => {
  let s = startCall()
  s = afterTurn(s, { move: ask('Was everybody here for a full day?', 'crew') })
  assert.equal(s.phase, 'speaking')
  assert.equal(s.asked, 'crew')

  // No tap needed to start listening — that is the whole point.
  s = afterSpeaking(s)
  assert.equal(s.phase, 'listening')

  s = afterListening(s)
  assert.equal(s.phase, 'thinking')
})

test('what he said is attached to the question he was answering', () => {
  let s = startCall()
  s = afterTurn(s, { move: ask('Was everybody here for a full day?', 'crew') })
  s = afterTurn(s, {
    move: ask('What did the crew get done today?', 'work'),
    heard: 'Dave was out sick',
    answers: { crew: 'Dave was out sick' },
  })

  assert.equal(s.log.length, 2)
  assert.equal(s.log[0].agent, 'Was everybody here for a full day?')
  assert.equal(s.log[0].foreman, 'Dave was out sick')
  assert.equal(s.log[1].foreman, null)
})

test('a repeat REPLACES the unanswered line instead of stacking', () => {
  let s = startCall()
  s = afterTurn(s, { move: ask('Any incidents or near misses?', 'safety_incident') })

  for (let i = 0; i < 3; i++) {
    s = afterTurn(s, {
      move: { kind: 'repeat', questionKey: 'safety_incident', say: "Sorry, I didn't catch that." },
      heard: '',
    })
  }

  // Three failed attempts at one question must not read as three questions.
  assert.equal(s.log.length, 1)
  assert.equal(s.log[0].foreman, null)
})

test('a follow-up is its own line — it is a different question', () => {
  let s = startCall()
  s = afterTurn(s, { move: ask('Was everybody here for a full day?', 'crew') })
  s = afterTurn(s, {
    move: { kind: 'follow_up', questionKey: 'crew', say: 'How many hours did Dave miss?' },
    heard: 'Dave was short',
  })

  assert.equal(s.log.length, 2)
  assert.equal(s.log[0].foreman, 'Dave was short')
  assert.equal(s.log[1].agent, 'How many hours did Dave miss?')
})

test('silence leaves the answer blank rather than recording an empty string', () => {
  let s = startCall()
  s = afterTurn(s, { move: ask('Any incidents or near misses?', 'safety_incident') })
  s = afterTurn(s, {
    move: { kind: 'repeat', questionKey: 'safety_incident', say: 'Say again?' },
    heard: '   ',
  })
  // Whitespace is not an answer — the log shows nothing was heard.
  assert.equal(s.log[0].foreman, null)
})

test('done and handoff both end the call, and neither keeps listening', () => {
  assert.equal(phaseFor({ kind: 'done', say: "That's everything." }), 'done')
  assert.equal(phaseFor({ kind: 'handoff', say: 'Finish on the screen.' }), 'handoff')

  assert.equal(isLive('done'), false)
  assert.equal(isLive('handoff'), false)
  assert.equal(isLive('listening'), true)

  // afterSpeaking must not drag a finished call back into listening.
  const ended: CallState = { ...startCall(), phase: 'done' }
  assert.equal(afterSpeaking(ended).phase, 'done')
})

test('phase transitions only fire from the right phase', () => {
  const thinking: CallState = { ...startCall(), phase: 'thinking' }
  assert.equal(afterListening(thinking).phase, 'thinking')
  assert.equal(afterSpeaking(thinking).phase, 'thinking')
})

test('progress counts answers, capped at the number of questions', () => {
  const s: CallState = {
    ...startCall(),
    answers: { crew: 'x', work: 'y', holdups: '' },
  }
  assert.deepEqual(progress(s, 7), { answered: 3, total: 7 })
  assert.deepEqual(progress(s, 2), { answered: 2, total: 2 })
})
