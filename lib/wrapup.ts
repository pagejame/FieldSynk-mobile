// The daily wrap-up questions, as the supervisor sees them on the phone.
//
// CANONICAL COPY lives in the web repo at
//   src/lib/field-agents/voice/wrapup.ts
// and that is the one the AI extraction reads. The two repos cannot import from
// each other, so this is a deliberate duplicate — if you change one, change both,
// because the extractor looks for answers to the questions in ITS copy.
//
// THE RULE: the crew is assumed to have worked their scheduled hours. Nobody
// says "everybody was on eight". Only the exceptions are spoken.
//
// SAFETY IS NOT ASKED (James, 2026-08-19). "Were the forms done?" gets a yes
// from a man keen to get in his truck, and a yes is not a record. He photographs
// the forms instead, which is what an inspector actually wants. The catch-all
// "anything else for the office?" is gone too — the review screens let him add
// anything, in writing, where he can see what he is saying.

export interface WrapUpQuestion {
  key: string
  prompt: string
  hint?: string
  /** Only asked when the company has the materials module on. */
  materialsOnly?: boolean
}

export const WRAPUP_QUESTIONS: WrapUpQuestion[] = [
  {
    key: 'crew',
    prompt: 'Was everybody here for a full day?',
    hint: "Only say the ones who weren't — who was out or short, how long, and why.",
  },
  { key: 'work', prompt: 'What did the crew get done today?' },
  { key: 'delays', prompt: "Anything that caused a delay in your crew's work?" },
  {
    key: 'materials',
    prompt: 'Any material worth recording?',
    materialsOnly: true,
  },
]

export function wrapUpQuestions(materialsEnabled: boolean): WrapUpQuestion[] {
  return WRAPUP_QUESTIONS.filter((q) => !q.materialsOnly || materialsEnabled)
}
