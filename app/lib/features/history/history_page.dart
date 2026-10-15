import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../design/app_icons.dart';
import '../../design/glass.dart';
import '../../design/theme.dart';
import '../../state/app_state.dart';

Color txColor(TxType t) => switch (t) {
      TxType.income || TxType.opening || TxType.adjustment => Ink.income,
      TxType.expense => Ink.expense,
      TxType.transfer => Ink.transfer,
      TxType.reversal => const Color(0xFF94A3B8),
      _ => Ink.debt,
    };

String txLabel(TxType t, dynamic s) => switch (t) {
      TxType.income => s.t('income'),
      TxType.expense => s.t('expense'),
      TxType.transfer => s.t('transfer'),
      TxType.debtBorrow => s.t('borrowed'),
      TxType.debtLend => s.t('lent'),
      TxType.debtRepayment || TxType.debtCollection => s.t('repay'),
      TxType.opening => s.t('initial_balance'),
      TxType.adjustment => s.t('adjust'),
      TxType.reversal => s.t('reversed'),
    };

class HistoryPage extends ConsumerStatefulWidget {
  const HistoryPage({super.key});
  @override
  ConsumerState<HistoryPage> createState() => _HistoryPageState();
}

class _HistoryPageState extends ConsumerState<HistoryPage> {
  final search = TextEditingController();
  TxType? type;
  String? walletId, categoryId, projectId;
  List<Tx>? results;
  bool loading = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => loading = true);
    try {
      final r = await ref.read(dataProvider.notifier).search({
        'q': search.text.trim(),
        'type': type == null ? null : '${type!.index}',
        'walletId': walletId,
        'categoryId': categoryId,
        'projectId': projectId,
        'includeReversed': 'true',
      });
      if (mounted) setState(() => results = r);
    } on ApiException {
      // offline: fall back to the cached snapshot (filtered client side for display only)
      final cached = ref.read(dataProvider).transactions;
      final q = search.text.trim().toLowerCase();
      if (mounted) {
        setState(() => results = cached
            .where((t) => (type == null || t.type == type) && (walletId == null || t.walletId == walletId) &&
                (q.isEmpty || (t.memo ?? '').toLowerCase().contains(q)))
            .toList());
      }
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final data = ref.watch(dataProvider);
    final p = GlassTheme.of(context).palette;

    // Show queued (not yet confirmed) operations first, clearly marked as pending.
    final pending = data.pending;
    final items = results ?? data.transactions;
    final groups = <String, List<Tx>>{};
    for (final t in items) {
      groups.putIfAbsent(dayHeader(t.occurredAt), () => []).add(t);
    }

    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
        child: TextField(
          controller: search,
          onSubmitted: (_) => _load(),
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
            hintText: s.t('search'),
            prefixIcon: const Icon(Icons.search_rounded),
            suffixIcon: IconButton(icon: const Icon(Icons.arrow_forward_rounded), onPressed: _load),
          ),
        ),
      ),
      SizedBox(
        height: 46,
        child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12), children: [
          _filterChip(s.t('all'), type == null && walletId == null && categoryId == null, () {
            setState(() {
              type = null;
              walletId = null;
              categoryId = null;
              projectId = null;
            });
            _load();
          }),
          for (final t in [TxType.income, TxType.expense, TxType.transfer, TxType.debtBorrow, TxType.debtLend])
            _filterChip(txLabel(t, s), type == t, () {
              setState(() => type = t);
              _load();
            }),
          for (final w in data.activeWallets)
            _filterChip(w.name, walletId == w.id, () {
              setState(() => walletId = walletId == w.id ? null : w.id);
              _load();
            }),
        ]),
      ),
      if (loading) const LinearProgressIndicator(minHeight: 2),
      Expanded(
        child: RefreshIndicator(
          onRefresh: _load,
          child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 120), children: [
            for (final op in pending)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: GlassCard(
                  tint: Ink.debt,
                  padding: const EdgeInsets.all(12),
                  child: Row(children: [
                    const Icon(Icons.schedule_rounded, color: Ink.debt),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        '${s.t('pending')}: ${op.kind} · ${op.payload['amount']}${op.error != null ? '\n${op.error}' : ''}',
                        style: TextStyle(color: op.error != null ? Ink.expense : null),
                      ),
                    ),
                    if (op.error != null)
                      IconButton(
                        tooltip: s.t('delete'),
                        icon: const Icon(Icons.close_rounded),
                        onPressed: () => ref.read(dataProvider.notifier).dismissRejected(op.clientOperationId),
                      ),
                  ]),
                ),
              ),
            if (groups.isEmpty && !loading)
              Padding(
                padding: const EdgeInsets.only(top: 60),
                child: Column(children: [
                  Icon(Icons.receipt_long_rounded, size: 56, color: p.textSecondary),
                  const SizedBox(height: 8),
                  Text(s.t('empty_history'), style: TextStyle(color: p.textSecondary)),
                ]),
              ),
            for (final g in groups.entries) ...[
              Padding(
                padding: const EdgeInsets.only(top: 12, bottom: 6),
                child: Text(g.key, style: TextStyle(color: p.textSecondary, fontWeight: FontWeight.w700)),
              ),
              for (final t in g.value) _TxRow(tx: t),
            ],
          ]),
        ),
      ),
    ]);
  }

  Widget _filterChip(String label, bool selected, VoidCallback onTap) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
        child: ChoiceChip(label: Text(label), selected: selected, onSelected: (_) => onTap()),
      );
}

class _TxRow extends ConsumerWidget {
  const _TxRow({required this.tx});
  final Tx tx;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final data = ref.watch(dataProvider);
    final p = GlassTheme.of(context).palette;
    final color = txColor(tx.type);
    final cat = data.category(tx.categoryId);
    final src = data.source(tx.incomeSourceId);
    final person = data.person(tx.personId);
    final wallet = data.wallet(tx.walletId);
    final to = data.wallet(tx.toWalletId);
    final title = tx.type == TxType.transfer
        ? '${wallet?.name ?? '?'} → ${to?.name ?? '?'}'
        : (cat?.name ?? src?.name ?? person?.name ?? txLabel(tx.type, s));
    final sign = switch (tx.type) {
      TxType.expense || TxType.debtLend || TxType.debtRepayment => '−',
      TxType.transfer => '',
      _ => '+',
    };
    final strike = tx.isReversed ? TextDecoration.lineThrough : null;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Pressable(
        onTap: () => _detail(context, ref),
        child: GlassCard(
          padding: const EdgeInsets.all(12),
          radius: 20,
          child: Row(children: [
            AppIcon(cat?.icon ?? src?.icon ?? (tx.type == TxType.transfer ? 'wallet' : 'debt'),
                color: cat != null ? parseHex(cat.color) : color, size: 42),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(title, maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontWeight: FontWeight.w700, decoration: strike)),
                Text(
                  [wallet?.name, tx.memo, if (tx.isReversed) s.t('reversed')].whereType<String>().where((e) => e.isNotEmpty).join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: p.textSecondary, fontSize: 12),
                ),
              ]),
            ),
            const SizedBox(width: 8),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 130),
              child: FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerRight,
                child: Text('$sign${fmtMoney(tx.amount, tx.currency)}',
                    style: TextStyle(fontWeight: FontWeight.w800, color: color, decoration: strike)),
              ),
            ),
          ]),
        ),
      ),
    );
  }

  void _detail(BuildContext context, WidgetRef ref) {
    final s = ref.read(stringsProvider);
    final data = ref.read(dataProvider);
    showGlassSheet<void>(context, builder: (ctx) {
      Widget row(String k, String? v) => v == null || v.isEmpty
          ? const SizedBox.shrink()
          : Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                SizedBox(width: 110, child: Text(k, style: const TextStyle(color: Colors.white60))),
                Expanded(child: Text(v)),
              ]),
            );
      return SingleChildScrollView(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('${txLabel(tx.type, s)} · ${fmtMoney(tx.amount, tx.currency)}',
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          row(s.t('date'), fmtDateTime(tx.occurredAt)),
          row(s.t('wallet'), data.wallet(tx.walletId)?.name),
          row(s.t('to_wallet'), data.wallet(tx.toWalletId)?.name),
          if (tx.toAmount != null) row(s.t('to_amount'), fmtMoney(tx.toAmount!, tx.toCurrency)),
          row(s.t('category'), data.category(tx.categoryId)?.name),
          row(s.t('source'), data.source(tx.incomeSourceId)?.name),
          row(s.t('person'), data.person(tx.personId)?.name),
          row(s.t('project'), data.project(tx.projectId)?.name),
          row(s.t('reason'), tx.reason),
          row(s.t('memo'), tx.memo),
          if (tx.isReversed) row('', s.t('reversed')),
          const SizedBox(height: 12),
          if (!tx.isReversed && tx.type != TxType.reversal && tx.type != TxType.opening)
            OutlinedButton.icon(
              icon: const Icon(Icons.undo_rounded),
              label: Text(s.t('reverse')),
              onPressed: () async {
                final nav = Navigator.of(ctx);
                final messenger = ScaffoldMessenger.of(context);
                try {
                  await ref.read(dataProvider.notifier).reverse(tx.id);
                  nav.pop();
                } on ApiException catch (e) {
                  nav.pop();
                  messenger.showSnackBar(SnackBar(content: Text(e.message)));
                }
              },
            ),
        ]),
      );
    });
  }
}
