import Constants from 'expo-constants';
import { QueryClient } from '@tanstack/react-query';
import { ApiClient } from '@/api/client';

/** Build-time EXPO_PUBLIC_API_URL (set per EAS profile/environment) wins over app.json extra. */
export const DEFAULT_API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ||
  'http://localhost:5080';

export const api = new ApiClient(DEFAULT_API_URL);

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false } },
});
