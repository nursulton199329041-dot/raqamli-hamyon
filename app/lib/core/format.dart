import 'package:intl/intl.dart';

/// Display-only money formatting. Large values use thin grouping so they stay readable and never overflow.
String fmtMoney(num v, [String? currency, bool compact = false]) {
  final abs = v.abs();
  String body;
  if (compact && abs >= 1e9) {
    body = '${(abs / 1e9).toStringAsFixed(abs >= 1e10 ? 0 : 1)} mlrd';
  } else if (compact && abs >= 1e6) {
    body = '${(abs / 1e6).toStringAsFixed(abs >= 1e7 ? 0 : 1)} mln';
  } else {
    final hasFraction = (abs - abs.truncate()).abs() > 0.004;
    body = NumberFormat(hasFraction ? '#,##0.00' : '#,##0', 'en_US').format(abs).replaceAll(',', ' ');
  }
  final sign = v < 0 ? '−' : '';
  return currency == null ? '$sign$body' : '$sign$body $currency';
}

String fmtDate(DateTime d) => DateFormat('dd.MM.yyyy').format(d);
String fmtDateTime(DateTime d) => DateFormat('dd.MM.yyyy HH:mm').format(d);

String dayHeader(DateTime d) {
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final day = DateTime(d.year, d.month, d.day);
  final diff = today.difference(day).inDays;
  if (diff == 0) return 'Bugun';
  if (diff == 1) return 'Kecha';
  return fmtDate(d);
}
