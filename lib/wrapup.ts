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
  { key: 'holdups', prompt: 'Anything hold you up?' },
  {
    key: 'materials',
    prompt: 'Any material worth recording?',
    materialsOnly: true,
  },
  { key: 'safety_forms', prompt: "Were today's safety forms done?" },
  { key: 'safety_incident', prompt: 'Any incidents or near misses?' },
  { key: 'notes', prompt: 'Anything else for the office?' },
]

export function wrapUpQuestions(materialsEnabled: boolean): WrapUpQuestion[] {
  return WRAPUP_QUESTIONS.filter((q) => !q.materialsOnly || materialsEnabled)
}
