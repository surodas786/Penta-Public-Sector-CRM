import type { Opportunity, OpportunityDraft, Stage, StageExtra } from '../types/crm';
import { CLOSED_STAGES } from '../data/options';

export type Errors = Record<string, string>;

export function isActiveStage(stage: Stage): boolean {
  return !CLOSED_STAGES.includes(stage);
}

export function validateOpportunity(d: OpportunityDraft): Errors {
  const e: Errors = {};
  if (!d.name.trim()) e.name = 'Project / opportunity name is required.';
  if (!d.orgId) e.orgId = 'Select the procuring organization.';
  if (!d.category) e.category = 'Select a solution category.';
  if (d.estimatedValue == null || Number.isNaN(d.estimatedValue) || d.estimatedValue <= 0)
  e.estimatedValue = 'Enter an estimated value greater than 0.';
  if (!d.ownerId) e.ownerId = 'Every opportunity needs a responsible owner.';
  if (!d.sectionId) e.sectionId = 'Every opportunity needs a section.';
  if (!d.stage) e.stage = 'Select the current stage.';
  if (isActiveStage(d.stage)) {
    if (!d.nextAction.trim()) e.nextAction = 'Active opportunities need a next action.';
    if (!d.nextActionDue) e.nextActionDue = 'Active opportunities need a next action due date.';
  }
  if (d.stage === 'Awarded') {
    if (d.awardedValue == null || d.awardedValue <= 0) e.awardedValue = 'Enter the actual awarded value.';
    if (!d.awardDate) e.awardDate = 'Enter the award date.';
  }
  if (d.stage === 'Lost' && !d.lostReason.trim()) e.lostReason = 'A reason is required when marking as Lost.';
  if ((d.stage === 'On Hold' || d.stage === 'Cancelled') && !d.statusNote.trim())
  e.statusNote = `A note is required when moving to ${d.stage}.`;
  if (d.expectedTenderDate && d.expectedAwardDate && d.expectedAwardDate < d.expectedTenderDate)
  e.expectedAwardDate = 'Expected award date cannot be before tender publication.';
  return e;
}

/** Whether moving to this stage requires extra input from the user. */
export function stageNeedsInput(opp: Opportunity, stage: Stage): boolean {
  if (['Awarded', 'Lost', 'On Hold', 'Cancelled'].includes(stage)) return true;
  return !opp.nextAction.trim() || !opp.nextActionDue;
}

export function stageRequirementError(opp: Opportunity, stage: Stage, extra: StageExtra): string | null {
  if (stage === 'Awarded') {
    if (extra.awardedValue == null || extra.awardedValue <= 0) return 'Actual awarded value is required.';
    if (!extra.awardDate) return 'Award date is required.';
  }
  if (stage === 'Lost' && !extra.lostReason?.trim()) return 'A reason is required to mark as Lost.';
  if ((stage === 'On Hold' || stage === 'Cancelled') && !extra.statusNote?.trim()) return `A note is required to move to ${stage}.`;
  if (isActiveStage(stage)) {
    const next = extra.nextAction ?? opp.nextAction;
    const due = extra.nextActionDue ?? opp.nextActionDue;
    if (!next?.trim() || !due) return 'Active opportunities need a next action and due date.';
  }
  return null;
}

export function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function isValidUrl(v: string): boolean {
  return /^https?:\/\/[^\s]+\.[^\s]+/.test(v);
}