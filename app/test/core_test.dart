import 'package:flutter_test/flutter_test.dart';
import 'package:raqamli_hamyon/core/format.dart';
import 'package:raqamli_hamyon/core/i18n.dart';
import 'package:raqamli_hamyon/state/app_state.dart';

void main() {
  group('parseAmount', () {
    test('accepts spaces and comma decimals', () {
      expect(parseAmount('1 500 000,50'), 1500000.5);
      expect(parseAmount('12.5'), 12.5);
    });
    test('rejects empty, zero, negative and garbage', () {
      expect(parseAmount(''), isNull);
      expect(parseAmount('0'), isNull);
      expect(parseAmount('-5'), isNull);
      expect(parseAmount('abc'), isNull);
    });
  });

  group('fmtMoney', () {
    test('groups thousands and keeps sign', () {
      expect(fmtMoney(1500000, 'UZS'), '1 500 000 UZS');
      expect(fmtMoney(-250.5), '−250.50');
    });
    test('compact form for large values', () {
      expect(fmtMoney(2500000, null, true), '2.5 mln');
    });
  });

  test('every uz key exists in ru and en', () {
    final uz = S('uz');
    for (final lang in ['ru', 'en']) {
      final s = S(lang);
      for (final k in _keys(uz)) {
        expect(s.t(k), isNot(k), reason: '$lang is missing "$k"');
      }
    }
  });
}

Iterable<String> _keys(S s) => S.keysFor('uz');
