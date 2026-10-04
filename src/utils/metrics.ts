import type { FollowUp, Opportunity, Tender } from '../types/crm';
import { CLOSED_STAGES } from '../data/options';
import { DEMO_NOW, DEMO_TODAY, daysBetween } from './demoClock';
import { dhakaParts } from './format';

export function isActiveOpp(o: Opportunity): boolean {
  return !CLOSED_STAGES.includes(o.stage);
}

export function pipelineValue(opps: Opportunity[]): number {
  return opps.filter(isActiveOpp).reduce((sum, o) => sum + (o.estimatedValue || 0), 0);
}

export type DueState = 'overdue' | 'today' | 'upcoming';

export function dueState(date: string): DueState {
  const diff = daysBetween(DEMO_TODAY, date);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  return 'upcoming';
}

export type FollowUpBucket = 'completed' | 'overdue' | 'today' | 'upcoming';

export function followUpBucket(f: FollowUp): FollowUpBucket {
  if (f.status === 'Completed') return 'completed';
  return dueState(f.due);
}

export type TenderIndicatorKind = 'missed' | 'due-soon' | 'neutral' | 'submitted' | 'not-participating';

export function tenderIndicator(t: Tender): TenderIndicatorKind {
  if (t.bidStatus === 'Submitted') return 'submitted';
  if (t.bidStatus === 'Not Participating') return 'not-participating';
  if (new Date(t.submissionDeadline).getTime() < new Date(DEMO_NOW).getTime()) return 'missed';
  const days = daysBetween(DEMO_TODAY, dhakaParts(t.submissionDeadline).date);
  return days <= 3 ? 'due-soon' : 'neutral';
}

export function isTenderOpen(t: Tender): boolean {
  return t.bidStatus === 'Reviewing' || t.bidStatus === 'Preparing';
}

/** Open (not submitted) tenders whose submission deadline falls within the next N days of the demo date. */
export function isTenderDueWithin(t: Tender, days: number): boolean {
  if (!isTenderOpen(t)) return false;
  if (new Date(t.submissionDeadline).getTime() < new Date(DEMO_NOW).getTime()) return false;
  return daysBetween(DEMO_TODAY, dhakaParts(t.submissionDeadline).date) <= days;
}