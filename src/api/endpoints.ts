/**
 * Typed wrappers for the M1 endpoints.
 *
 * Every list call is paginated and bounded. There is deliberately no call that
 * downloads the whole commercial dataset, and no client-side cache that
 * reassembles one (plan 4.2).
 */
import type {
  AssigneeOptionDto,
  BoardDto,
  CreateOpportunityResultDto,
  CurrentUserDto,
  FollowUpDto,
  FollowUpListDto,
  HistoryEntryDto,
  OpportunityDetailDto,
  OpportunityListItemDto,
  OrganizationSummaryDto,
  OwnerOptionDto,
  Paginated,
} from '../../shared/api.js';
import { apiRequest, setCsrfToken, toQuery } from './client.js';

// --- Authentication ---------------------------------------------------------

export async function fetchCsrfToken(signal?: AbortSignal): Promise<string> {
  const { csrfToken } = await apiRequest<{ csrfToken: string }>('/api/auth/csrf', { signal });
  setCsrfToken(csrfToken);
  return csrfToken;
}

export async function signIn(email: string, password: string): Promise<void> {
  // The token must be bound to the pre-login session.
  await fetchCsrfToken();
  const { csrfToken } = await apiRequest<{ csrfToken: string }>('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    suppressUnauthenticatedNotice: true,
  });
  // The session id changed on sign-in, so the old token is no longer valid.
  setCsrfToken(csrfToken);
}

export async function signOut(): Promise<void> {
  await apiRequest<void>('/api/auth/logout', { method: 'POST' });
  setCsrfToken(null);
}

export async function fetchCurrentUser(signal?: AbortSignal): Promise<CurrentUserDto> {
  const { user, csrfToken } = await apiRequest<{ user: CurrentUserDto; csrfToken: string }>(
    '/api/auth/me',
    { signal, suppressUnauthenticatedNotice: true },
  );
  setCsrfToken(csrfToken);
  return user;
}

// --- Opportunities ----------------------------------------------------------

export interface OpportunityListParams {
  /** Index signature so the params object can be fed straight to toQuery. */
  [key: string]: string | number | undefined;
  page?: number;
  pageSize?: number;
  q?: string;
  stage?: string;
  status?: string;
  priority?: string;
  solutionCategory?: string;
  organizationId?: string;
  ownerId?: string;
  sectionId?: string;
  sort?: string;
  dir?: string;
}

export function fetchOpportunities(
  params: OpportunityListParams,
  signal?: AbortSignal,
): Promise<Paginated<OpportunityListItemDto>> {
  return apiRequest(`/api/opportunities${toQuery(params)}`, { signal });
}

export function fetchOpportunity(id: string, signal?: AbortSignal): Promise<OpportunityDetailDto> {
  return apiRequest(`/api/opportunities/${id}`, { signal });
}

export function fetchOpportunityFollowUps(
  id: string,
  params: { page?: number; pageSize?: number } = {},
  signal?: AbortSignal,
): Promise<Paginated<FollowUpDto>> {
  return apiRequest(`/api/opportunities/${id}/follow-ups${toQuery(params)}`, { signal });
}

export function fetchOpportunityHistory(
  id: string,
  params: { page?: number; pageSize?: number } = {},
  signal?: AbortSignal,
): Promise<Paginated<HistoryEntryDto>> {
  return apiRequest(`/api/opportunities/${id}/history${toQuery(params)}`, { signal });
}

export function createOpportunity(
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<CreateOpportunityResultDto> {
  return apiRequest('/api/opportunities', { method: 'POST', body, idempotencyKey });
}

export function updateOpportunity(
  id: string,
  body: Record<string, unknown>,
): Promise<OpportunityDetailDto> {
  return apiRequest(`/api/opportunities/${id}`, { method: 'PATCH', body });
}

// --- Pipeline board, stage and status (M2) ---------------------------------

export interface BoardParams {
  [key: string]: string | undefined;
  q?: string;
  priority?: string;
  solutionCategory?: string;
}

export function fetchBoard(params: BoardParams, signal?: AbortSignal): Promise<BoardDto> {
  return apiRequest(`/api/opportunities/board${toQuery(params)}`, { signal });
}

/** Every transition carries the version it was read at and a retry-stable key. */
export function changeStage(
  id: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<OpportunityDetailDto> {
  return apiRequest(`/api/opportunities/${id}/stage`, { method: 'POST', body, idempotencyKey });
}

export function changeStatus(
  id: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<OpportunityDetailDto> {
  return apiRequest(`/api/opportunities/${id}/status`, { method: 'POST', body, idempotencyKey });
}

export function reopenOpportunity(
  id: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<OpportunityDetailDto> {
  return apiRequest(`/api/opportunities/${id}/reopen`, { method: 'POST', body, idempotencyKey });
}

// --- Follow-ups (M2) ----------------------------------------------------------

export interface FollowUpListParams {
  [key: string]: string | number | undefined;
  view?: string;
  assignedTo?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export function fetchFollowUps(params: FollowUpListParams, signal?: AbortSignal): Promise<FollowUpListDto> {
  return apiRequest(`/api/follow-ups${toQuery(params)}`, { signal });
}

export function fetchFollowUpAssignees(
  opportunityId: string,
  signal?: AbortSignal,
): Promise<{ items: AssigneeOptionDto[] }> {
  return apiRequest(`/api/opportunities/${opportunityId}/follow-up-assignees`, { signal });
}

export function createFollowUp(
  opportunityId: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<FollowUpDto> {
  return apiRequest(`/api/opportunities/${opportunityId}/follow-ups`, { method: 'POST', body, idempotencyKey });
}

export function completeFollowUp(
  id: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<FollowUpDto> {
  return apiRequest(`/api/follow-ups/${id}/complete`, { method: 'POST', body, idempotencyKey });
}

export function rescheduleFollowUp(
  id: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<FollowUpDto> {
  return apiRequest(`/api/follow-ups/${id}/reschedule`, { method: 'POST', body, idempotencyKey });
}

export function cancelFollowUp(
  id: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<FollowUpDto> {
  return apiRequest(`/api/follow-ups/${id}/cancel`, { method: 'POST', body, idempotencyKey });
}

// --- Lookups ----------------------------------------------------------------

export function fetchOrganizations(
  params: { q?: string; page?: number; pageSize?: number } = {},
  signal?: AbortSignal,
): Promise<Paginated<OrganizationSummaryDto>> {
  return apiRequest(`/api/organizations${toQuery(params)}`, { signal });
}

export function fetchOpportunityOwners(signal?: AbortSignal): Promise<{ items: OwnerOptionDto[] }> {
  return apiRequest('/api/lookups/opportunity-owners', { signal });
}
