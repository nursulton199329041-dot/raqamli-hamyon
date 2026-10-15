import Constants from 'expo-constants';
import { QueryClient } from '@tanstack/react-query';
import { ApiClient } from '@/api/client';

export const DEFAULT_API_URL: string =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? 'http://localhost:5080';

export const api = new ApiClient(DEFAULT_API_URL);

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false } },
});
