jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn, ...args) => fn(...args),
  scheduleOnUI: (fn, ...args) => fn(...args),
  runOnJS: (fn) => fn,
}));
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  const sv = (v) => {
    const o = { value: v, get: () => o.value, set: (n) => { o.value = typeof n === 'function' ? n(o.value) : n; } };
    return o;
  };
  const AnimatedView = React.forwardRef((props, ref) => React.createElement(View, { ...props, ref }));
  AnimatedView.displayName = 'AnimatedView';
  return {
    __esModule: true,
    default: { View: AnimatedView },
    useSharedValue: (v) => React.useRef(sv(v)).current,
    useAnimatedStyle: (fn) => fn(),
    withSpring: (v) => v,
    withTiming: (v) => v,
    withRepeat: (v) => v,
    withSequence: (...v) => v[v.length - 1],
    useReducedMotion: () => false,
  };
});
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(), notificationAsync: jest.fn(), selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: 'medium' }, NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));