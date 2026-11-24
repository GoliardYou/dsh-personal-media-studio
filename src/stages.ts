export type StageId = 'topics' | 'drafts' | 'render'

export interface StageInput {
  status: string
  maturity: string
  projectStatus?: string | null
}

/** Which workbench landing a card belongs on. Paused projects stay with the card status. */
export function stageOf(input: StageInput): StageId {
  const project = input.projectStatus ?? ''
  if (input.status === 'reviewing' || input.status === 'exported' || project === 'reviewing' || project === 'exported') return 'render'
  if (input.maturity === 'mature' || input.status === 'ready_for_production' || input.status === 'in_production' || project === 'drafting') return 'drafts'
  return 'topics'
}
