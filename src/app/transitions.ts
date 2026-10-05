/**
 * Pure helpers for stage and status changes in the browser. The server
 * re-decides every rule; these only choose which dialog to open.
 */
import type { OpportunityListItemDto } from '../../shared/api.js';
import {
  STAGE_LABELS,
  classifyStageMove,
  isTerminalStage,
  type BoardLane,
  type OpportunityStage,
  type OpportunityStatus,
} from '../../shared/enums.js';
import { changeStage } from '../api/endpoints.js';

export type TransitionRequest =
  | { kind: 'stage'; target: OpportunityStage }
  | { kind: 'status'; target: OpportunityStatus }
  | { kind: 'reopen'; stage?: OpportunityStage };

export type TransitionSubject = Pick<
  OpportunityListItemDto,
  'id' | 'name' | 'stage' | 'status' | 'version' | 'estimatedValue' | 'nextAction'
>;

/**
 * Whether a move can be sent straight away (the next stage, with a next action
 * already in place) or needs this dialog first. The server decides either way.
 */
export function needsTransitionDialog(subject: TransitionSubject, request: TransitionRequest): boolean {
  if (request.kind !== 'stage') return true;
  if (subject.status !== 'active' || isTerminalStage(subject.stage)) return true;
  return classifyStageMove(subject.stage, request.target) !== 'forward' || !subject.nextAction;
}

/**
 * Maps "put this record in that lane" to the operation that does it, or to a
 * plain explanation when no single operation can. Shared by the board's drag
 * and the detail page's Change Stage menu; the server re-decides regardless.
 */
export function transitionRequestFor(
  subject: Pick<TransitionSubject, 'stage' | 'status'>,
  to: BoardLane,
): TransitionRequest | string {
  if (isTerminalStage(subject.stage)) {
    if (to === 'on_hold' || to === 'cancelled' || isTerminalStage(to)) {
      return 'Awarded and Lost opportunities cannot be put On Hold, cancelled or given another outcome.';
    }
    return { kind: 'reopen', stage: to };
  }
  if (subject.status !== 'active') {
    if (to === subject.stage) return { kind: 'status', target: 'active' };
    if (to === 'cancelled' && subject.status === 'on_hold') return { kind: 'status', target: 'cancelled' };
    return `Return it to Active first — it resumes at ${STAGE_LABELS[subject.stage]}, its retained stage.`;
  }
  if (to === 'on_hold' || to === 'cancelled') return { kind: 'status', target: to };
  return { kind: 'stage', target: to };
}

/** Sends a move that needs no extra input. */
export function sendDirectStageChange(subject: TransitionSubject, target: OpportunityStage, idempotencyKey: string) {
  return changeStage(subject.id, { version: subject.version, stage: target }, idempotencyKey);
}

