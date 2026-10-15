import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/models.dart';
import '../../design/app_icons.dart';
import '../../design/glass.dart';
import '../../design/theme.dart';
import '../../state/app_state.dart';
import '../ops/operation_sheet.dart';
import '../wallets/create_sheets.dart';

/// What is being dragged. Only the backend ever changes money; a drop merely opens a pre-filled form.
class DragPayload {
  const DragPayload.wallet(this.id) : kind = 'wallet';
  const DragPayload.source(this.id) : kind = 'source';
  final String kind;
  final String id;
}

class DashboardPage extends ConsumerWidget {
  const DashboardPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final data = ref.watch(dataProvider);
    final session = ref.watch(sessionProvider);
    final p = GlassTheme.of(context).palette;

    return RefreshIndicator(
      onRefresh: () async {
        try {
          await ref.read(dataProvider.notifier).refresh();
        } catch (_) {}
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 120),
        children: [
          _Header(name: session.user?.displayName ?? '', data: data),
          const SizedBox(height: 12),
          _BalanceCard(data: data),
          const SizedBox(height: 14),
          _QuickActions(),
          const SizedBox(height: 18),
          _SectionTitle(
            title: s.t('income_sources'),
            onAdd: () => showCategorySheet(context, ref, source: true),
          ),
          _SourceRow(data: data),
          const SizedBox(height: 16),
          _SectionTitle(title: s.t('wallets'), onAdd: () => showWalletSheet(context, ref)),
          if (data.loaded && data.activeWallets.isEmpty)
            GlassCard(child: Text(s.t('empty_wallets'), style: TextStyle(color: p.textSecondary)))
          else
            _WalletGrid(data: data),
          const SizedBox(height: 16),
          _SectionTitle(title: s.t('expense_categories'), onAdd: () => showCategorySheet(context, ref)),
          _CategoryGrid(data: data),
          const SizedBox(height: 10),
          Center(child: Text(s.t('drag_hint'), style: TextStyle(color: p.textSecondary, fontSize: 12))),
        ],
      ),
    );
  }
}

class _Header extends ConsumerWidget {
  const _Header({required this.name, required this.data});
  final String name;
  final DataState data;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final p = GlassTheme.of(context).palette;
    final String status;
    final Color color;
    if (!data.online) {
      status = s.t('offline');
      color = Ink.debt;
    } else if (data.syncing) {
      status = s.t('syncing');
      color = p.accent;
    } else if (data.pending.isNotEmpty) {
      status = s.t('sync_pending', {'n': '${data.pending.length}'});
      color = Ink.debt;
    } else {
      status = s.t('synced');
      color = Ink.income;
    }
    return Row(children: [
      CircleAvatar(
        backgroundColor: p.accent.withValues(alpha: 0.3),
        child: Text(name.isEmpty ? '?' : name.substring(0, 1).toUpperCase()),
      ),
      const SizedBox(width: 12),
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17)),
          Row(children: [
            Container(width: 8, height: 8, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
            const SizedBox(width: 6),
            Flexible(child: Text(status, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: p.textSecondary, fontSize: 12))),
          ]),
        ]),
      ),
      PopupMenuButton<Period>(
        tooltip: s.t('month'),
        icon: const Icon(Icons.calendar_month_rounded),
        initialValue: data.period,
        onSelected: (v) => ref.read(dataProvider.notifier).setPeriod(v),
        itemBuilder: (_) => [
          PopupMenuItem(value: Period.week, child: Text(s.t('week'))),
          PopupMenuItem(value: Period.month, child: Text(s.t('month'))),
          PopupMenuItem(value: Period.year, child: Text(s.t('year'))),
          PopupMenuItem(value: Period.all, child: Text(s.t('all'))),
        ],
      ),
    ]);
  }
}

class _BalanceCard extends ConsumerWidget {
  const _BalanceCard({required this.data});
  final DataState data;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final p = GlassTheme.of(context).palette;
    // Balances are reported per currency – currencies are never added together.
    final byCurrency = <String, double>{};
    for (final w in data.activeWallets) {
      byCurrency[w.currency] = (byCurrency[w.currency] ?? 0) + w.balance;
    }
    final totals = {for (final t in data.summary?.totals ?? <CurrencyTotals>[]) t.currency: t};
    final debts = {for (final d in data.summary?.debts ?? <DebtPosition>[]) d.currency: d};

    return GlassCard(
      radius: 28,
      padding: const EdgeInsets.all(20),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(s.t('balance'), style: TextStyle(color: p.textSecondary, fontWeight: FontWeight.w600)),
        const SizedBox(height: 6),
        if (byCurrency.isEmpty) const Text('0', style: TextStyle(fontSize: 34, fontWeight: FontWeight.w800)),
        for (final e in byCurrency.entries) ...[
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(fmtMoney(e.value, e.key), style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800)),
          ),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: _Stat(label: s.t('income'), value: fmtMoney(totals[e.key]?.income ?? 0, null, true), color: Ink.income, icon: Icons.south_west_rounded)),
            Expanded(child: _Stat(label: s.t('expense'), value: fmtMoney(totals[e.key]?.expense ?? 0, null, true), color: Ink.expense, icon: Icons.north_east_rounded)),
            Expanded(child: _Stat(label: s.t('i_owe'), value: fmtMoney(debts[e.key]?.iOwe ?? 0, null, true), color: Ink.debt, icon: Icons.swap_horiz_rounded)),
          ]),
          const SizedBox(height: 4),
        ],
      ]),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, required this.color, required this.icon});
  final String label, value;
  final Color color;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final p = GlassTheme.of(context).palette;
    return Row(children: [
      Icon(icon, size: 16, color: color),
      const SizedBox(width: 4),
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: p.textSecondary, fontSize: 11)),
          Text(value, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
        ]),
      ),
    ]);
  }
}

class _QuickActions extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final items = <(OpKind, String, IconData, Color)>[
      (OpKind.income, s.t('income'), Icons.south_west_rounded, Ink.income),
      (OpKind.expense, s.t('expense'), Icons.north_east_rounded, Ink.expense),
      (OpKind.transfer, s.t('transfer'), Icons.swap_horiz_rounded, Ink.transfer),
      (OpKind.debt, s.t('debt'), Icons.handshake_rounded, Ink.debt),
    ];
    return Row(children: [
      for (final it in items)
        Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: Pressable(
              semanticLabel: it.$2,
              onTap: () => showOperationSheet(context, OpPrefill(kind: it.$1)),
              child: GlassCard(
                tint: it.$4,
                padding: const EdgeInsets.symmetric(vertical: 14),
                radius: 20,
                child: Column(children: [
                  Icon(it.$3, color: it.$4),
                  const SizedBox(height: 4),
                  Text(it.$2, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis),
                ]),
              ),
            ),
          ),
        ),
    ]);
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title, required this.onAdd});
  final String title;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(children: [
        Expanded(child: Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800))),
        IconButton(tooltip: title, onPressed: onAdd, icon: const Icon(Icons.add_circle_rounded)),
      ]),
    );
  }
}

// ---------------------------------------------------------------- draggable / target tiles

class _SourceRow extends ConsumerWidget {
  const _SourceRow({required this.data});
  final DataState data;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SizedBox(
      height: 96,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: data.sources.length,
        separatorBuilder: (_, __) => const SizedBox(width: 10),
        itemBuilder: (_, i) {
          final src = data.sources[i];
          final tile = _MiniTile(icon: src.icon, color: parseHex(src.color), title: src.name);
          return Semantics(
            customSemanticsActions: {
              CustomSemanticsAction(label: 'Kirim qo\'shish'): () =>
                  showOperationSheet(context, OpPrefill(kind: OpKind.income, sourceId: src.id)),
            },
            child: Pressable(
              onTap: () => showOperationSheet(context, OpPrefill(kind: OpKind.income, sourceId: src.id)),
              child: LongPressDraggable<DragPayload>(
                data: DragPayload.source(src.id),
                hapticFeedbackOnStart: true,
                feedback: _Lifted(child: tile),
                childWhenDragging: Opacity(opacity: 0.35, child: tile),
                child: tile,
              ),
            ),
          );
        },
      ),
    );
  }
}

class _WalletGrid extends ConsumerWidget {
  const _WalletGrid({required this.data});
  final DataState data;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return LayoutBuilder(builder: (context, c) {
      final cols = c.maxWidth > 700 ? 3 : 2;
      final w = (c.maxWidth - 10 * (cols - 1)) / cols;
      return Wrap(spacing: 10, runSpacing: 10, children: [
        for (final wallet in data.activeWallets) SizedBox(width: w, child: _WalletTile(wallet: wallet)),
      ]);
    });
  }
}

class _WalletTile extends ConsumerWidget {
  const _WalletTile({required this.wallet});
  final Wallet wallet;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final color = parseHex(wallet.color);

    Widget body({bool highlight = false, bool rejected = false}) => GlassCard(
          highlight: highlight,
          tint: rejected ? Ink.expense : color,
          padding: const EdgeInsets.all(14),
          radius: 22,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            AppIcon(wallet.icon, color: color, size: 40),
            const SizedBox(height: 10),
            Text(wallet.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 2),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(fmtMoney(wallet.balance, wallet.currency),
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: wallet.balance < 0 ? Ink.expense : null)),
            ),
          ]),
        );

    return DragTarget<DragPayload>(
      onWillAcceptWithDetails: (d) =>
          (d.data.kind == 'wallet' && d.data.id != wallet.id) || d.data.kind == 'source',
      onAcceptWithDetails: (d) {
        HapticFeedback.mediumImpact();
        if (d.data.kind == 'wallet') {
          // wallet -> wallet = transfer form (manba va qabul qiluvchi avtomatik)
          showOperationSheet(context, OpPrefill(kind: OpKind.transfer, walletId: d.data.id, toWalletId: wallet.id));
        } else {
          // income source -> wallet = income form
          showOperationSheet(context, OpPrefill(kind: OpKind.income, walletId: wallet.id, sourceId: d.data.id));
        }
      },
      builder: (context, candidate, rejected) {
        final tile = Semantics(
          label: wallet.name,
          customSemanticsActions: {
            CustomSemanticsAction(label: s.t('expense')): () =>
                showOperationSheet(context, OpPrefill(kind: OpKind.expense, walletId: wallet.id)),
            CustomSemanticsAction(label: s.t('transfer')): () =>
                showOperationSheet(context, OpPrefill(kind: OpKind.transfer, walletId: wallet.id)),
            CustomSemanticsAction(label: s.t('income')): () =>
                showOperationSheet(context, OpPrefill(kind: OpKind.income, walletId: wallet.id)),
          },
          child: Pressable(
            onTap: () => _walletActions(context, ref, wallet),
            child: LongPressDraggable<DragPayload>(
              data: DragPayload.wallet(wallet.id),
              hapticFeedbackOnStart: true,
              feedback: _Lifted(child: SizedBox(width: 160, child: body())),
              childWhenDragging: Opacity(opacity: 0.35, child: body()),
              child: body(highlight: candidate.isNotEmpty, rejected: rejected.isNotEmpty),
            ),
          ),
        );
        return tile;
      },
    );
  }

  void _walletActions(BuildContext context, WidgetRef ref, Wallet w) {
    final s = ref.read(stringsProvider);
    showGlassSheet<void>(context, builder: (ctx) {
      Widget action(IconData i, String t, Color c, OpKind k) => ListTile(
            leading: Icon(i, color: c),
            title: Text(t),
            onTap: () {
              Navigator.pop(ctx);
              showOperationSheet(context, OpPrefill(kind: k, walletId: w.id));
            },
          );
      return Column(mainAxisSize: MainAxisSize.min, children: [
        Text('${w.name} · ${fmtMoney(w.balance, w.currency)}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
        action(Icons.north_east_rounded, s.t('expense'), Ink.expense, OpKind.expense),
        action(Icons.south_west_rounded, s.t('income'), Ink.income, OpKind.income),
        action(Icons.swap_horiz_rounded, s.t('transfer'), Ink.transfer, OpKind.transfer),
        action(Icons.handshake_rounded, s.t('debt'), Ink.debt, OpKind.debt),
      ]);
    });
  }
}

class _CategoryGrid extends ConsumerWidget {
  const _CategoryGrid({required this.data});
  final DataState data;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return LayoutBuilder(builder: (context, c) {
      final cols = c.maxWidth > 700 ? 4 : 3;
      final w = (c.maxWidth - 10 * (cols - 1)) / cols;
      return Wrap(spacing: 10, runSpacing: 10, children: [
        for (final cat in data.categories)
          SizedBox(
            width: w,
            child: DragTarget<DragPayload>(
              onWillAcceptWithDetails: (d) => d.data.kind == 'wallet',
              onAcceptWithDetails: (d) {
                HapticFeedback.mediumImpact();
                // wallet -> category = expense form with wallet and category pre-selected
                showOperationSheet(context, OpPrefill(kind: OpKind.expense, walletId: d.data.id, categoryId: cat.id));
              },
              builder: (context, candidate, rejected) => Semantics(
                label: cat.name,
                customSemanticsActions: {
                  CustomSemanticsAction(label: s.t('expense')): () =>
                      showOperationSheet(context, OpPrefill(kind: OpKind.expense, categoryId: cat.id)),
                },
                child: Pressable(
                  onTap: () => showOperationSheet(context, OpPrefill(kind: OpKind.expense, categoryId: cat.id)),
                  child: GlassCard(
                    highlight: candidate.isNotEmpty,
                    tint: rejected.isNotEmpty ? Ink.expense : parseHex(cat.color),
                    padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
                    radius: 20,
                    child: Column(children: [
                      AppIcon(cat.icon, color: parseHex(cat.color), size: 38),
                      const SizedBox(height: 6),
                      Text(cat.name, maxLines: 2, textAlign: TextAlign.center, overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                    ]),
                  ),
                ),
              ),
            ),
          ),
      ]);
    });
  }
}

class _MiniTile extends StatelessWidget {
  const _MiniTile({required this.icon, required this.color, required this.title});
  final String icon, title;
  final Color color;

  @override
  Widget build(BuildContext context) => SizedBox(
        width: 96,
        child: GlassCard(
          tint: color,
          padding: const EdgeInsets.all(10),
          radius: 20,
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            AppIcon(icon, color: color, size: 36),
            const SizedBox(height: 6),
            Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
          ]),
        ),
      );
}

/// Drag feedback: slightly enlarged, elevated.
class _Lifted extends StatelessWidget {
  const _Lifted({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => Material(
        color: Colors.transparent,
        child: Transform.scale(scale: 1.08, child: Opacity(opacity: 0.96, child: child)),
      );
}
