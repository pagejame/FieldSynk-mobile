import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  startFlow as start,
  currentQuestion,
  withAnswer,
  withoutCurrentAnswer,
  canGoNext,
  next,
  back,
  isFinished,
  missingRequired,
  canSubmit,
  progress,
  isRequired,
} from './wrapup-flow.ts'
import { wrapUpQuestions } from './wrapup.ts'

const startFlow = (materialsEnabled: boolean) => start(wrapUpQuestions(materialsEnabled))

// The guided wrap-up. The point of it is that a foreman cannot reach the end
// having forgotten safety — so the rules about what blocks him, and what does
// not, are the whole thing.

const answerCurrent = (s: ReturnType<typeof startFlow>, secs = 5) => withAnswer(s, `file://${currentQuestion(s)!.key}.m4a`, secs)

test('it opens on the crew question', () => {
  const s = startFlow(false)
  assert.equal(currentQuestion(s)?.key, 'crew')
})

test('materials is only in the run when the module is on', () => {
  assert.ok(!startFlow(false).questions.some((q) => q.key === 'materials'))
  assert.ok(startFlow(true).questions.some((q) => q.key === 'materials'))
})

test('a required question blocks moving on until it is answered', () => {
  const s = startFlow(false)
  assert.ok(isRequired(currentQuestion(s)!))
  assert.ok(!canGoNext(s), 'crew is required')
  assert.equal(next(s).index, 0, 'next does nothing while it is unanswered')

  const answered = answerCurrent(s)
  assert.ok(canGoNext(answered))
  assert.equal(next(answered).index, 1)
})

test('an optional question can be passed over in silence', () => {
  // "Anything hold you up?" on a clean day is silence. Making him say "no" to
  // move on is the friction that stops people using it.
  let s = startFlow(false)
  s = next(answerCurrent(s)) // crew
  s = next(answerCurrent(s)) // work
  assert.equal(currentQuestion(s)?.key, 'delays')
  assert.ok(!isRequired(currentQuestion(s)!))
  assert.ok(canGoNext(s), 'no answer needed')
})

test('re-answering REPLACES, so both versions are never sent', () => {
  // He says it again because the first go was wrong. Sending both would leave
  // the extractor free to believe either one.
  let s = startFlow(false)
  s = withAnswer(s, 'file://first.m4a', 4)
  s = withAnswer(s, 'file://second.m4a', 6)
  assert.equal(s.answers.length, 1)
  assert.equal(s.answers[0].uri, 'file://second.m4a')
  assert.equal(s.answers[0].seconds, 6)
})

test('an answer can be thrown away to start that question again', () => {
  let s = startFlow(false)
  s = answerCurrent(s)
  assert.equal(s.answers.length, 1)
  s = withoutCurrentAnswer(s)
  assert.equal(s.answers.length, 0)
  assert.ok(!canGoNext(s), 'and it blocks again, because crew is required')
})

test('going back does not lose what was already said', () => {
  let s = startFlow(false)
  s = next(answerCurrent(s))
  s = next(answerCurrent(s))
  const beforeBack = s.answers.length
  s = back(back(s))
  assert.equal(s.index, 0)
  assert.equal(s.answers.length, beforeBack, 'answers survive the walk back')
})

test('back stops at the first question rather than going negative', () => {
  assert.equal(back(back(startFlow(false))).index, 0)
})

test('it cannot be sent while a required question is unanswered', () => {
  // The crew answer decides what men are paid, so it cannot be left out. Built
  // directly rather than by walking the flow, because the flow will not LET you
  // step past a required question — which is the same guard, one screen earlier.
  const s0 = startFlow(false)
  const workIdx = s0.questions.findIndex((q) => q.key === 'work')
  const s = withAnswer({ ...s0, index: workIdx }, 'file://work.m4a', 5)

  assert.ok(!canSubmit(s))
  assert.deepEqual(missingRequired(s).map((q) => q.key), ['crew'])
})

test('answering the crew and the work is enough — the optionals are optional', () => {
  let s = startFlow(false)
  s = next(answerCurrent(s)) // crew
  s = next(answerCurrent(s)) // work
  s = next(s) // delays skipped: a clean day genuinely has none
  assert.ok(canSubmit(s))
  assert.deepEqual(missingRequired(s), [])
})

test('answering everything required allows sending, optionals or not', () => {
  let s = startFlow(false)
  for (const q of s.questions) {
    if (isRequired(q)) s = withAnswer({ ...s, index: s.questions.indexOf(q) }, `file://${q.key}.m4a`, 5)
  }
  assert.ok(canSubmit(s))
  assert.deepEqual(missingRequired(s), [])
})

test('the run finishes after the last question', () => {
  let s = startFlow(false)
  for (let i = 0; i < s.questions.length; i++) {
    s = next(canGoNext(s) ? s : answerCurrent(s))
  }
  assert.ok(isFinished(s))
  assert.equal(currentQuestion(s), null)
})

test('progress counts answers against the questions actually asked', () => {
  let s = startFlow(true) // materials on -> crew, work, delays, materials
  assert.deepEqual(progress(s), { answered: 0, total: 4 })
  s = next(answerCurrent(s))
  assert.deepEqual(progress(s), { answered: 1, total: 4 })
})

test('the required set is exactly the crew and the work', () => {
  const req = startFlow(true).questions.filter(isRequired).map((q) => q.key)
  assert.deepEqual(req, ['crew', 'work'])
})
