import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/models.dart';
import '../../design/glass.dart';
import '../../design/theme.dart';
import '../../state/app_state.dart';
import '../ops/operation_sheet.dart';

class DebtsPage extends ConsumerWidget {
  const DebtsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final data = ref.watch(dataProvider);
    final p = GlassTheme.of(context).palette;
    final open = data.debts.where((d) => d.status == 0).toList();
    final closed = data.debts.where((d) => d.status != 0).toList();
    final summary = data.summary;

    return ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 120), children: [
      Row(children: [
        Expanded(child: Text(s.t('debts'), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800))),
        IconButton(
          icon: const Icon(Icons.add_circle_rounded),
          onPressed: () => showOperationSheet(context, const OpPrefill(kind: OpKind.debt)),
        ),
      ]),
      if (summary != null)
        for (final d in summary.debts)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: GlassCard(
              tint: Ink.debt,
              child: Row(children: [
                Expanded(child: _kv(s.t('i_owe'), fmtMoney(d.iOwe, d.currency))),
                Expanded(child: _kv(s.t('owed_to_me'), fmtMoney(d.owedToMe, d.currency))),
              ]),
            ),
          ),
      if (open.isEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 40),
          child: Center(child: Text(s.t('empty_history'), style: TextStyle(color: p.textSecondary))),
        ),
      for (final d in open) _DebtCard(debt: d),
      if (closed.isNotEmpty) ...[
        const SizedBox(height: 16),
        Text(s.t('archived'), style: TextStyle(color: p.textSecondary, fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        for (final d in closed) Opacity(opacity: 0.6, child: _DebtCard(debt: d)),
      ],
    ]);
  }

  Widget _kv(String k, String v) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(k, style: const TextStyle(fontSize: 12, color: Colors.white60)),
        FittedBox(fit: BoxFit.scaleDown, child: Text(v, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17))),
      ]);
}

class _DebtCard extends ConsumerWidget {
  const _DebtCard({required this.debt});
  final Debt debt;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final data = ref.watch(dataProvider);
    final p = GlassTheme.of(context).palette;
    final person = data.person(debt.personId)?.name ?? '?';
    final paid = debt.principal == 0 ? 0.0 : (1 - debt.outstanding / debt.principal).clamp(0.0, 1.0);
    final overdue = debt.dueDate != null && debt.status == 0 && debt.dueDate!.isBefore(DateTime.now());

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: GlassCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(debt.iOwe ? Icons.call_received_rounded : Icons.call_made_rounded, color: Ink.debt),
            const SizedBox(width: 8),
            Expanded(child: Text(person, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
            Text(debt.iOwe ? s.t('borrowed') : s.t('lent'), style: TextStyle(color: p.textSecondary)),
          ]),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(value: paid, minHeight: 8, color: Ink.debt, backgroundColor: Colors.white12),
          ),
          const SizedBox(height: 6),
          Row(children: [
            Expanded(child: Text('${s.t('outstanding')}: ${fmtMoney(debt.outstanding, debt.currency)}',
                style: const TextStyle(fontWeight: FontWeight.w700))),
            Text(fmtMoney(debt.principal, debt.currency), style: TextStyle(color: p.textSecondary)),
          ]),
          if (debt.dueDate != null)
            Text('${s.t('due')}: ${fmtDate(debt.dueDate!)}', style: TextStyle(color: overdue ? Ink.expense : p.textSecondary, fontSize: 12)),
          if (debt.status == 0) ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton.tonal(onPressed: () => _repay(context, ref), child: Text(s.t('repay'))),
            ),
          ],
        ]),
      ),
    );
  }

  void _repay(BuildContext context, WidgetRef ref) {
    final s = ref.read(stringsProvider);
    final data = ref.read(dataProvider);
    final wallets = data.activeWallets.where((w) => w.currency == debt.currency).toList();
    final amount = TextEditingController(text: debt.outstanding.toString());
    String? walletId = wallets.isEmpty ? null : wallets.first.id;
    String? error;

    showGlassSheet<void>(context, builder: (ctx) {
      return StatefulBuilder(builder: (ctx, setState) {
        return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(s.t('repay'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          TextField(
            controller: amount,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: '${s.t('amount')} (${debt.currency})'),
          ),
          const SizedBox(height: 10),
          Wrap(spacing: 8, children: [
            for (final w in wallets)
              ChoiceChip(label: Text(w.name), selected: walletId == w.id, onSelected: (_) => setState(() => walletId = w.id)),
          ]),
          if (error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(error!, style: const TextStyle(color: Ink.expense))),
          const SizedBox(height: 14),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
            onPressed: () async {
              final v = parseAmount(amount.text);
              if (v == null || walletId == null) return setState(() => error = s.t('amount'));
              final err = await ref.read(dataProvider.notifier).submit('repay', {'walletId': walletId, 'amount': v}, targetId: debt.id);
              if (err != null) return setState(() => error = err);
              if (ctx.mounted) Navigator.pop(ctx);
            },
            child: Text(s.t('confirm')),
          ),
        ]);
      });
    });
  }
}
