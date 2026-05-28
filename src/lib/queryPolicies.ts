import { keepPreviousData } from "@tanstack/react-query";

export const CRITICAL_FINANCIAL_QUERY_POLICY = {
  staleTime: 0,
  gcTime: 5 * 60 * 1000,
  refetchOnMount: "always" as const,
  refetchOnWindowFocus: true,
};

export const READ_DASHBOARD_QUERY_POLICY = {
  staleTime: 60 * 1000,
  gcTime: 10 * 60 * 1000,
  refetchOnWindowFocus: false,
  placeholderData: keepPreviousData,
};
