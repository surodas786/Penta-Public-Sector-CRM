/** A follow-up entered inside another action: a replacement or a required next action. */
export interface FollowUpDraft {
  title: string;
  dueDate: string;
  assigneeId: string;
}

export const emptyDraft = (dueDate = ''): FollowUpDraft => ({ title: '', dueDate, assigneeId: '' });

/** Serialises a draft; an empty assignee lets the server choose the eligible default. */
export function draftBody(draft: FollowUpDraft) {
  return {
    title: draft.title,
    dueDate: draft.dueDate,
    ...(draft.assigneeId ? { assigneeId: draft.assigneeId } : {}),
  };
}

