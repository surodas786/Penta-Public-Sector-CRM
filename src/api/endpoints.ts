/**
 * Typed wrappers for the M1 endpoints.
 *
 * Every list call is paginated and bounded. There is deliberately no call that
 * downloads the whole commercial dataset, and no client-side cache that
 * reassembles one (plan 4.2).
 */
import type {
  AccountLinkDto,
  ActivityDto,
  ContactDetailDto,
  ContactListItemDto,
  OpportunityContactDto,
  OrganizationDetailDto,
  OrganizationListItemDto,
  AdminAuditEntryDto,
  DocumentDetailDto,
  DocumentDto,
  DocumentPolicyDto,
  StagedUploadDto,
  TenderDto,
  TenderSubmissionResultDto,
  AdminSectionDto,
  AdminUserDto,
  AssigneeOptionDto,
  BoardDto,
  CreateOpportunityResultDto,
  CreateUserResultDto,
  CurrentUserDto,
  FollowUpDto,
  FollowUpListDto,
  HistoryEntryDto,
  OpportunityDetailDto,
  OpportunityListItemDto,
  OrganizationSummaryDto,
  OwnerOptionDto,
  Paginated,
  TeamDto,
} from '../../shared/api.js';
import { FILE_NAME_HEADER } from '../../shared/api.js';
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
  ownerId?: string;
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

// --- Ownership transfer and team view (M3) -----------------------------------

export function transferOpportunity(
  id: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<OpportunityDetailDto> {
  return apiRequest(`/api/opportunities/${id}/transfer`, { method: 'POST', body, idempotencyKey });
}

export function fetchTeam(signal?: AbortSignal): Promise<TeamDto> {
  return apiRequest('/api/team', { signal });
}

// --- Administration (M3) -------------------------------------------------------

export function fetchAdminUsers(
  params: { q?: string; page?: number; pageSize?: number },
  signal?: AbortSignal,
): Promise<Paginated<AdminUserDto>> {
  return apiRequest(`/api/admin/users${toQuery(params)}`, { signal });
}

export function createAdminUser(body: Record<string, unknown>, idempotencyKey: string): Promise<CreateUserResultDto> {
  return apiRequest('/api/admin/users', { method: 'POST', body, idempotencyKey });
}

export function updateAdminUser(id: string, body: Record<string, unknown>): Promise<AdminUserDto> {
  return apiRequest(`/api/admin/users/${id}`, { method: 'PATCH', body });
}

export function setAdminUserActive(id: string, active: boolean, body: Record<string, unknown>): Promise<AdminUserDto> {
  return apiRequest(`/api/admin/users/${id}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST', body });
}

export function issueAccountLink(id: string): Promise<AccountLinkDto> {
  return apiRequest(`/api/admin/users/${id}/link`, { method: 'POST', body: {} });
}

export function fetchAdminSections(signal?: AbortSignal): Promise<{ items: AdminSectionDto[] }> {
  return apiRequest('/api/admin/sections', { signal });
}

export function createAdminSection(body: Record<string, unknown>, idempotencyKey: string): Promise<AdminSectionDto> {
  return apiRequest('/api/admin/sections', { method: 'POST', body, idempotencyKey });
}

export function renameAdminSection(id: string, body: Record<string, unknown>): Promise<AdminSectionDto> {
  return apiRequest(`/api/admin/sections/${id}`, { method: 'PATCH', body });
}

export function replaceSectionLead(id: string, body: Record<string, unknown>): Promise<AdminSectionDto> {
  return apiRequest(`/api/admin/sections/${id}/replace-lead`, { method: 'POST', body });
}

export function setAdminSectionActive(id: string, active: boolean, body: Record<string, unknown>): Promise<AdminSectionDto> {
  return apiRequest(`/api/admin/sections/${id}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST', body });
}

export function fetchAdminAudit(
  params: { page?: number; pageSize?: number },
  signal?: AbortSignal,
): Promise<Paginated<AdminAuditEntryDto>> {
  return apiRequest(`/api/admin/audit${toQuery(params)}`, { signal });
}

// --- Invitations and password reset (M3) ---------------------------------------

/** Public: redeems a single-use link. The caller signs in normally afterwards. */
export async function setPasswordWithLink(token: string, password: string): Promise<void> {
  await fetchCsrfToken();
  await apiRequest<void>('/api/auth/set-password', {
    method: 'POST',
    body: { token, password },
    suppressUnauthenticatedNotice: true,
  });
}

// --- Organization directory (M4) ---------------------------------------------

export function fetchDirectory(
  params: { q?: string; type?: string; page?: number; pageSize?: number; includeArchived?: string },
  signal?: AbortSignal,
): Promise<Paginated<OrganizationListItemDto>> {
  return apiRequest(`/api/organizations${toQuery(params)}`, { signal });
}

export function fetchOrganization(id: string, signal?: AbortSignal): Promise<OrganizationDetailDto> {
  return apiRequest(`/api/organizations/${id}`, { signal });
}

export function createOrganization(body: Record<string, unknown>, idempotencyKey: string): Promise<OrganizationDetailDto> {
  return apiRequest('/api/organizations', { method: 'POST', body, idempotencyKey });
}

export function updateOrganization(id: string, body: Record<string, unknown>): Promise<OrganizationDetailDto> {
  return apiRequest(`/api/organizations/${id}`, { method: 'PATCH', body });
}

export function archiveOrganization(id: string, body: Record<string, unknown>): Promise<OrganizationDetailDto> {
  return apiRequest(`/api/organizations/${id}/archive`, { method: 'POST', body });
}

// --- Contacts and links (M4) ---------------------------------------------------

export function fetchContacts(
  params: { q?: string; organizationId?: string; page?: number; pageSize?: number },
  signal?: AbortSignal,
): Promise<Paginated<ContactListItemDto>> {
  return apiRequest(`/api/contacts${toQuery(params)}`, { signal });
}

export function fetchContact(id: string, signal?: AbortSignal): Promise<ContactDetailDto> {
  return apiRequest(`/api/contacts/${id}`, { signal });
}

export function createContact(body: Record<string, unknown>, idempotencyKey: string): Promise<ContactDetailDto> {
  return apiRequest('/api/contacts', { method: 'POST', body, idempotencyKey });
}

export function updateContact(id: string, body: Record<string, unknown>): Promise<ContactDetailDto> {
  return apiRequest(`/api/contacts/${id}`, { method: 'PATCH', body });
}

export function archiveContact(id: string, body: Record<string, unknown>): Promise<ContactDetailDto> {
  return apiRequest(`/api/contacts/${id}/archive`, { method: 'POST', body });
}

export function fetchOpportunityContacts(
  opportunityId: string,
  signal?: AbortSignal,
): Promise<{ items: OpportunityContactDto[] }> {
  return apiRequest(`/api/opportunities/${opportunityId}/contacts`, { signal });
}

export function linkContact(
  opportunityId: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<OpportunityContactDto> {
  return apiRequest(`/api/opportunities/${opportunityId}/contacts`, { method: 'POST', body, idempotencyKey });
}

export function updateContactLink(linkId: string, body: Record<string, unknown>): Promise<OpportunityContactDto> {
  return apiRequest(`/api/contact-links/${linkId}`, { method: 'PATCH', body });
}

export function removeContactLink(linkId: string, body: Record<string, unknown>): Promise<void> {
  return apiRequest(`/api/contact-links/${linkId}/remove`, { method: 'POST', body });
}

// --- Activities (M4) -------------------------------------------------------------

export function fetchOpportunityActivities(
  opportunityId: string,
  params: { page?: number; pageSize?: number } = {},
  signal?: AbortSignal,
): Promise<Paginated<ActivityDto>> {
  return apiRequest(`/api/opportunities/${opportunityId}/activities${toQuery(params)}`, { signal });
}

export function fetchActivities(
  params: { q?: string; type?: string; organizationId?: string; contactId?: string; authoredBy?: string; page?: number; pageSize?: number },
  signal?: AbortSignal,
): Promise<Paginated<ActivityDto>> {
  return apiRequest(`/api/activities${toQuery(params)}`, { signal });
}

export function createActivity(
  opportunityId: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<ActivityDto> {
  return apiRequest(`/api/opportunities/${opportunityId}/activities`, { method: 'POST', body, idempotencyKey });
}

export function updateActivity(id: string, body: Record<string, unknown>): Promise<ActivityDto> {
  return apiRequest(`/api/activities/${id}`, { method: 'PATCH', body });
}

// --- Tenders (M5) -------------------------------------------------------------

export interface TenderListParams {
  q?: string;
  ownerId?: string;
  sectionId?: string;
  bidStatus?: string;
  deadlineFrom?: string;
  deadlineTo?: string;
  notice?: 'active' | 'all';
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export function fetchTenders(params: TenderListParams, signal?: AbortSignal): Promise<Paginated<TenderDto>> {
  return apiRequest(`/api/tenders${toQuery({ ...params })}`, { signal });
}

export function fetchOpportunityTenders(opportunityId: string, signal?: AbortSignal): Promise<{ items: TenderDto[] }> {
  return apiRequest(`/api/opportunities/${opportunityId}/tenders`, { signal });
}

export function createTender(opportunityId: string, body: Record<string, unknown>, idempotencyKey: string): Promise<TenderDto> {
  return apiRequest(`/api/opportunities/${opportunityId}/tenders`, { method: 'POST', body, idempotencyKey });
}

export function updateTender(id: string, body: Record<string, unknown>): Promise<TenderDto> {
  return apiRequest(`/api/tenders/${id}`, { method: 'PATCH', body });
}

export function submitTender(
  id: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<TenderSubmissionResultDto> {
  return apiRequest(`/api/tenders/${id}/submit`, { method: 'POST', body, idempotencyKey });
}

export function designateCurrentTender(id: string, version: number): Promise<TenderDto> {
  return apiRequest(`/api/tenders/${id}/designate-current`, { method: 'POST', body: { version } });
}

export function cancelTenderNotice(id: string, body: { version: number; reason: string }): Promise<TenderDto> {
  return apiRequest(`/api/tenders/${id}/cancel`, { method: 'POST', body });
}

// --- Documents (M5) -----------------------------------------------------------

export function fetchDocumentPolicy(signal?: AbortSignal): Promise<DocumentPolicyDto> {
  return apiRequest('/api/documents/policy', { signal });
}

export function fetchOpportunityDocuments(
  opportunityId: string,
  includeArchived: boolean,
  signal?: AbortSignal,
): Promise<{ items: DocumentDto[] }> {
  return apiRequest(`/api/opportunities/${opportunityId}/documents${toQuery({ includeArchived: includeArchived ? 'true' : undefined })}`, {
    signal,
  });
}

export function fetchDocument(id: string, signal?: AbortSignal): Promise<DocumentDetailDto> {
  return apiRequest(`/api/documents/${id}`, { signal });
}

/** Step 1: the raw bytes, streamed to private server storage. Nothing is kept in the browser. */
export function stageDocumentUpload(opportunityId: string, file: File): Promise<StagedUploadDto> {
  return apiRequest(`/api/opportunities/${opportunityId}/document-uploads`, {
    method: 'POST',
    file,
    headers: { [FILE_NAME_HEADER]: encodeURIComponent(file.name) },
  });
}

/** Step 2: idempotent; a retry with the same key returns the same document. */
export function finalizeDocumentUpload(
  uploadId: string,
  body: { category?: string; documentId?: string; note?: string },
  idempotencyKey: string,
): Promise<DocumentDetailDto> {
  return apiRequest(`/api/document-uploads/${uploadId}/finalize`, { method: 'POST', body, idempotencyKey });
}

export function archiveDocument(id: string, body: { version: number; reason: string }): Promise<DocumentDetailDto> {
  return apiRequest(`/api/documents/${id}/archive`, { method: 'POST', body });
}

/** An authorized, same-origin streaming URL. It works only while the session can see the record. */
export function documentDownloadUrl(revisionId: string, inline = false): string {
  return `/api/document-revisions/${revisionId}/download${inline ? '?disposition=inline' : ''}`;
}
