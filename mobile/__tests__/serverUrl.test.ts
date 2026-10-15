import { isLocalUrl } from '@/lib/serverUrl';

test('detects addresses a phone cannot reach', () => {
  expect(isLocalUrl('http://localhost:5080')).toBe(true);
  expect(isLocalUrl('http://127.0.0.1:5080/')).toBe(true);
  expect(isLocalUrl('http://192.168.1.20:5080')).toBe(false);
  expect(isLocalUrl('https://api.example.uz')).toBe(false);
});
