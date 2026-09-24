import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '../../api/queryKeys';
import * as reportsApi from '../../api/reports';
import type { ReportPeriodParams, ReportScopeParams } from '../../api/reports';

/**
 * Reading the reports.
 *
 * One hook per endpoint, and the split between period and current state is
 * carried through from `api/reports.ts`: a hook whose parameter type is
 * `ReportScopeParams` cannot be handed a date range, so a screen cannot
 * accidentally window a present-tense number. See decision D9.
 *
 * `placeholderData: keepPrevious` on the period reports is a deliberate
 * choice. Moving the date picker re-requests every widget, and without it each
 * card would unmount into a spinner and the page would jump by several hundred
 * pixels. Holding the previous render while the new one arrives keeps the
 * layout still; `isFetching` drives the dimming that says it is stale.
 */

/** Keep the last successful answer on screen while a new one is fetched. */
function keepPrevious<T>(previous: T | undefined): T | undefined {
  return previous;
}

/** Backlog summary for the period: status, priority, assignee, daily flow. */
export function useSummaryReport(params: ReportPeriodParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.reports.summary(params),
    queryFn: () => reportsApi.fetchSummary(params),
    placeholderData: keepPrevious,
    enabled,
  });
}

/** What was reported most in the period, by group and subcategory. */
export function useCategoriesReport(params: ReportPeriodParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.reports.categories(params),
    queryFn: () => reportsApi.fetchCategories(params),
    placeholderData: keepPrevious,
    enabled,
  });
}

/** The buildings, floors and seats with the most incidents in the period. */
export function useLocationsReport(params: ReportPeriodParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.reports.locations(params),
    queryFn: () => reportsApi.fetchLocations(params),
    placeholderData: keepPrevious,
    enabled,
  });
}

/** Median time to assign, acknowledge and resolve over the period. */
export function useResponseTimesReport(params: ReportPeriodParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.reports.responseTimes(params),
    queryFn: () => reportsApi.fetchResponseTimes(params),
    placeholderData: keepPrevious,
    enabled,
  });
}

/** Every engineer's live load, and what they resolved during the period. */
/** One engineer's output over the period, for their profile page. */
export function useEngineerDetailReport(userId: string, params: ReportPeriodParams) {
  return useQuery({
    queryKey: queryKeys.reports.engineerDetail(userId, params),
    queryFn: () => reportsApi.fetchEngineerDetail(userId, params),
    placeholderData: keepPrevious,
    enabled: userId !== '',
  });
}

export function useEngineerWorkloadReport(params: ReportPeriodParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.reports.engineerWorkload(params),
    queryFn: () => reportsApi.fetchEngineerWorkload(params),
    placeholderData: keepPrevious,
    enabled,
  });
}

/** Whether reporters were kept informed during the period. */
export function useCommunicationReport(params: ReportPeriodParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.reports.communication(params),
    queryFn: () => reportsApi.fetchCommunication(params),
    placeholderData: keepPrevious,
    enabled,
  });
}

/**
 * What is blocked or escalated **right now**.
 *
 * No `placeholderData`: the only thing that re-requests this is a change of
 * building, which changes the subject of the question rather than its period.
 * Holding the old building's numbers under the new building's heading would be
 * the wrong kind of stillness.
 */
export function useBlockedEscalatedReport(params: ReportScopeParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.reports.blockedEscalated(params),
    queryFn: () => reportsApi.fetchBlockedEscalated(params),
    enabled,
  });
}

/** The caller's own counts, as they stand now. Every persona home opens with this. */
export function useMyReport(params: ReportScopeParams = {}) {
  return useQuery({
    queryKey: queryKeys.reports.me(params),
    queryFn: () => reportsApi.fetchMyReport(params),
  });
}
