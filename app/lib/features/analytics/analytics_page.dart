import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../design/glass.dart';
import '../../design/theme.dart';
import '../../state/app_state.dart';

const _slice = [
  Color(0xFF6EA8FF), Color(0xFFFF6B6B), Color(0xFF22C55E), Color(0xFFF59E0B), Color(0xFF8B5CF6),
  Color(0xFF14B8A6), Color(0xFFEC4899), Color(0xFF94A3B8),
];

class AnalyticsPage extends ConsumerStatefulWidget {
  const AnalyticsPage({super.key});
  @override
  ConsumerState<AnalyticsPage> createState() => _AnalyticsPageState();
}

class _AnalyticsPageState extends ConsumerState<AnalyticsPage> {
  String by = 'category';
  String granularity = 'day';
  List<BreakdownRow> rows = [];
  List<SeriesPoint> series = [];
  bool loading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Map<String, String?> get _q {
    final now = DateTime.now().toUtc();
    final from = switch (ref.read(dataProvider).period) {
      Period.month => DateTime.utc(now.year, now.month, 1),
      Period.week => DateTime.utc(now.year, now.month, now.day).subtract(Duration(days: now.weekday - 1)),
      Period.year => DateTime.utc(now.year, 1, 1),
      Period.all => null,
    };
    return {'from': from?.toIso8601String()};
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final n = ref.read(dataProvider.notifier);
      final r = await Future.wait([n.breakdown(by, _q), n.series(granularity, _q)]);
      if (mounted) {
        setState(() {
          rows = r[0] as List<BreakdownRow>;
          series = r[1] as List<SeriesPoint>;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _export(String format) async {
    final s = ref.read(stringsProvider);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final bytes = await ref.read(dataProvider.notifier).export(format, _q, s.lang);
      final mime = switch (format) {
        'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'pdf' => 'application/pdf',
        _ => 'text/csv',
      };
      await Share.shareXFiles([XFile.fromData(Uint8List.fromList(bytes), mimeType: mime, name: 'hamyon.$format')],
          fileNameOverrides: ['hamyon.$format']);
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final data = ref.watch(dataProvider);
    final p = GlassTheme.of(context).palette;
    final summary = data.summary;
    final currencies = rows.map((r) => r.currency).toSet().toList()..sort();

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 120), children: [
        Row(children: [
          Expanded(child: Text(s.t('analytics'), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800))),
          PopupMenuButton<String>(
            icon: const Icon(Icons.ios_share_rounded),
            tooltip: s.t('export'),
            onSelected: _export,
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'xlsx', child: Text('Excel (.xlsx)')),
              PopupMenuItem(value: 'pdf', child: Text('PDF')),
              PopupMenuItem(value: 'csv', child: Text('CSV')),
            ],
          ),
        ]),
        const SizedBox(height: 8),
        if (summary != null)
          for (final t in summary.totals)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: GlassCard(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(t.currency, style: TextStyle(color: p.textSecondary, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 6),
                  Row(children: [
                    Expanded(child: _kv(s.t('income'), fmtMoney(t.income, null, true), Ink.income)),
                    Expanded(child: _kv(s.t('expense'), fmtMoney(t.expense, null, true), Ink.expense)),
                    Expanded(child: _kv(s.t('net_flow'), fmtMoney(t.netFlow, null, true), t.netFlow >= 0 ? Ink.income : Ink.expense)),
                  ]),
                ]),
              ),
            ),
        const SizedBox(height: 4),
        SegmentedButton<String>(
          segments: [
            ButtonSegment(value: 'category', label: Text(s.t('category'))),
            ButtonSegment(value: 'wallet', label: Text(s.t('wallet'))),
            ButtonSegment(value: 'project', label: Text(s.t('project'))),
          ],
          selected: {by},
          onSelectionChanged: (v) {
            setState(() => by = v.first);
            _load();
          },
        ),
        const SizedBox(height: 12),
        if (loading) const LinearProgressIndicator(minHeight: 2),
        if (error != null) Text(error!, style: const TextStyle(color: Ink.expense)),
        for (final cur in currencies) ...[
          GlassCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${s.t('expense')} · $cur', style: const TextStyle(fontWeight: FontWeight.w800)),
              const SizedBox(height: 12),
              Row(children: [
                SizedBox(
                  width: 120,
                  height: 120,
                  child: CustomPaint(painter: DonutPainter(rows.where((r) => r.currency == cur).map((r) => r.percent).toList())),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(children: [
                    for (final e in rows.where((r) => r.currency == cur).take(6).toList().asMap().entries)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 3),
                        child: Row(children: [
                          Container(width: 10, height: 10, decoration: BoxDecoration(color: _slice[e.key % _slice.length], shape: BoxShape.circle)),
                          const SizedBox(width: 8),
                          Expanded(child: Text(e.value.name, maxLines: 1, overflow: TextOverflow.ellipsis)),
                          Text('${e.value.percent.toStringAsFixed(0)}%', style: TextStyle(color: p.textSecondary)),
                        ]),
                      ),
                  ]),
                ),
              ]),
            ]),
          ),
          const SizedBox(height: 12),
        ],
        Row(children: [
          Expanded(child: Text(s.t('trend'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17))),
          SegmentedButton<String>(
            showSelectedIcon: false,
            segments: [
              ButtonSegment(value: 'day', label: Text(s.t('day'))),
              ButtonSegment(value: 'week', label: Text(s.t('week'))),
              ButtonSegment(value: 'month', label: Text(s.t('month'))),
            ],
            selected: {granularity},
            onSelectionChanged: (v) {
              setState(() => granularity = v.first);
              _load();
            },
          ),
        ]),
        const SizedBox(height: 8),
        for (final cur in series.map((e) => e.currency).toSet()) ...[
          GlassCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(cur, style: TextStyle(color: p.textSecondary, fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              SizedBox(
                height: 150,
                width: double.infinity,
                child: CustomPaint(painter: BarsPainter(series.where((e) => e.currency == cur).toList())),
              ),
            ]),
          ),
          const SizedBox(height: 12),
        ],
        if (data.budgets.isNotEmpty) ...[
          Text(s.t('budgets'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
          const SizedBox(height: 8),
          for (final b in data.budgets)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: GlassCard(
                tint: b.exceeded ? Ink.expense : null,
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text(b.name, style: const TextStyle(fontWeight: FontWeight.w700))),
                    if (b.exceeded) Text(s.t('exceeded'), style: const TextStyle(color: Ink.expense, fontWeight: FontWeight.w700)),
                  ]),
                  const SizedBox(height: 8),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: LinearProgressIndicator(
                      value: (b.percent / 100).clamp(0, 1).toDouble(),
                      minHeight: 8,
                      color: b.exceeded ? Ink.expense : Ink.income,
                      backgroundColor: Colors.white12,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text('${fmtMoney(b.spent, b.currency)} / ${fmtMoney(b.limit, b.currency)}',
                      style: TextStyle(color: p.textSecondary, fontSize: 12)),
                ]),
              ),
            ),
        ],
      ]),
    );
  }

  Widget _kv(String k, String v, Color c) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(k, style: const TextStyle(fontSize: 12, color: Colors.white60)),
        Text(v, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w800, color: c)),
      ]);
}

class DonutPainter extends CustomPainter {
  DonutPainter(this.percents);
  final List<double> percents;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Rect.fromLTWH(10, 10, size.width - 20, size.height - 20);
    final base = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 16
      ..color = Colors.white12;
    canvas.drawArc(rect, 0, math.pi * 2, false, base);
    var start = -math.pi / 2;
    for (var i = 0; i < percents.length; i++) {
      final sweep = percents[i] / 100 * math.pi * 2;
      if (sweep <= 0) continue;
      final paint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.butt
        ..strokeWidth = 16
        ..color = _slice[i % _slice.length];
      canvas.drawArc(rect, start, math.max(0.01, sweep - 0.02), false, paint);
      start += sweep;
    }
  }

  @override
  bool shouldRepaint(DonutPainter old) => old.percents != percents;
}

class BarsPainter extends CustomPainter {
  BarsPainter(this.points);
  final List<SeriesPoint> points;

  @override
  void paint(Canvas canvas, Size size) {
    if (points.isEmpty) return;
    final pts = points.length > 14 ? points.sublist(points.length - 14) : points;
    final maxV = pts.fold<double>(1, (m, p) => math.max(m, math.max(p.income, p.expense)));
    final slot = size.width / pts.length;
    final barW = math.min(14.0, slot / 2.6);
    for (var i = 0; i < pts.length; i++) {
      final x = slot * i + slot / 2;
      final hi = pts[i].income / maxV * (size.height - 8);
      final he = pts[i].expense / maxV * (size.height - 8);
      final r = Radius.circular(barW / 2);
      canvas.drawRRect(
        RRect.fromRectAndCorners(Rect.fromLTWH(x - barW - 1, size.height - hi, barW, math.max(hi, 1)), topLeft: r, topRight: r),
        Paint()..color = Ink.income,
      );
      canvas.drawRRect(
        RRect.fromRectAndCorners(Rect.fromLTWH(x + 1, size.height - he, barW, math.max(he, 1)), topLeft: r, topRight: r),
        Paint()..color = Ink.expense,
      );
    }
  }

  @override
  bool shouldRepaint(BarsPainter old) => old.points != points;
}
