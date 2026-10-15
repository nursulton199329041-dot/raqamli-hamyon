import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../design/app_icons.dart';
import '../../design/glass.dart';
import '../../design/theme.dart';
import '../../state/app_state.dart';
import '../wallets/create_sheets.dart';

class ProjectsPage extends ConsumerWidget {
  const ProjectsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final data = ref.watch(dataProvider);
    return ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 120), children: [
      Row(children: [
        Expanded(child: Text(s.t('projects'), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800))),
        IconButton(icon: const Icon(Icons.add_circle_rounded), onPressed: () => showProjectSheet(context, ref)),
      ]),
      for (final pr in data.projects)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Pressable(
            onTap: () => _open(context, ref, pr.id),
            child: GlassCard(
              child: Row(children: [
                AppIcon(pr.icon, color: parseHex(pr.color)),
                const SizedBox(width: 12),
                Expanded(child: Text(pr.name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
                const Icon(Icons.chevron_right_rounded),
              ]),
            ),
          ),
        ),
    ]);
  }

  void _open(BuildContext context, WidgetRef ref, String id) {
    final s = ref.read(stringsProvider);
    showGlassSheet<void>(context, full: true, builder: (_) {
      return FutureBuilder<Map<String, dynamic>>(
        future: ref.read(dataProvider.notifier).projectSummary(id),
        builder: (ctx, snap) {
          if (snap.hasError) {
            final e = snap.error;
            return Text(e is ApiException ? e.message : s.t('error_generic'));
          }
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final j = snap.data!;
          final name = j['project']['name'] as String;
          Map<String, dynamic> m(String k) => Map<String, dynamic>.from(j[k] as Map);
          final income = m('income'), expense = m('expense'), remaining = m('remaining');
          final wallets = (j['wallets'] as List).cast<Map<String, dynamic>>();
          final data = ref.read(dataProvider);
          return SingleChildScrollView(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(name, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
              const SizedBox(height: 12),
              for (final cur in {...income.keys, ...expense.keys, ...remaining.keys}) ...[
                Text(cur, style: const TextStyle(fontWeight: FontWeight.w700, color: Colors.white70)),
                _line(s.t('income'), (income[cur] ?? 0) as num, cur, Ink.income),
                _line(s.t('expense'), (expense[cur] ?? 0) as num, cur, Ink.expense),
                _line(s.t('bucket'), (remaining[cur] ?? 0) as num, cur, Ink.transfer),
                const Divider(),
              ],
              Text(s.t('real_balance'), style: const TextStyle(fontWeight: FontWeight.w700)),
              // Project share of each wallet next to the wallet's real balance – kept separate on purpose.
              for (final w in wallets)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(children: [
                    Expanded(child: Text(w['wallet'] as String)),
                    Text('${fmtMoney(w['allocated'] as num, w['currency'] as String)}  /  '
                        '${fmtMoney(data.wallet(w['walletId'] as String)?.balance ?? 0, w['currency'] as String)}'),
                  ]),
                ),
            ]),
          );
        },
      );
    });
  }

  Widget _line(String k, num v, String cur, Color c) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [
          Expanded(child: Text(k)),
          Text(fmtMoney(v, cur), style: TextStyle(fontWeight: FontWeight.w800, color: c)),
        ]),
      );
}
