import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../design/app_icons.dart';
import '../../design/glass.dart';
import '../../design/theme.dart';
import '../../state/app_state.dart';

enum OpKind { income, expense, transfer, debt }

class OpPrefill {
  const OpPrefill({this.kind = OpKind.expense, this.walletId, this.toWalletId, this.categoryId, this.sourceId, this.projectId});
  final OpKind kind;
  final String? walletId, toWalletId, categoryId, sourceId, projectId;
}

Future<void> showOperationSheet(BuildContext context, OpPrefill prefill) =>
    showGlassSheet<void>(context, full: true, builder: (_) => OperationForm(prefill: prefill));

/// One form for income / expense / transfer / debt. Nothing is sent (and no balance changes) until "Tasdiqlash".
class OperationForm extends ConsumerStatefulWidget {
  const OperationForm({super.key, required this.prefill});
  final OpPrefill prefill;

  @override
  ConsumerState<OperationForm> createState() => _OperationFormState();
}

class _OperationFormState extends ConsumerState<OperationForm> {
  late OpKind kind = widget.prefill.kind;
  String? walletId, toWalletId, categoryId, sourceId, projectId;
  final amount = TextEditingController();
  final toAmount = TextEditingController();
  final rate = TextEditingController();
  final memo = TextEditingController();
  final person = TextEditingController();
  final reason = TextEditingController();
  bool borrowed = true;
  DateTime when = DateTime.now();
  DateTime? due;
  bool more = false, busy = false;
  String? error;

  @override
  void initState() {
    super.initState();
    final p = widget.prefill;
    walletId = p.walletId;
    toWalletId = p.toWalletId;
    categoryId = p.categoryId;
    sourceId = p.sourceId;
    projectId = p.projectId;
  }

  @override
  void dispose() {
    for (final c in [amount, toAmount, rate, memo, person, reason]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final data = ref.watch(dataProvider);
    final p = GlassTheme.of(context).palette;
    final wallets = data.activeWallets;
    walletId ??= wallets.isNotEmpty ? wallets.first.id : null;
    final from = data.wallet(walletId);
    final to = data.wallet(toWalletId);
    final crossCurrency = kind == OpKind.transfer && from != null && to != null && from.currency != to.currency;

    final tabs = <(OpKind, String, Color)>[
      (OpKind.income, s.t('income'), Ink.income),
      (OpKind.expense, s.t('expense'), Ink.expense),
      (OpKind.transfer, s.t('transfer'), Ink.transfer),
      (OpKind.debt, s.t('debt'), Ink.debt),
    ];
    final accent = tabs.firstWhere((t) => t.$1 == kind).$3;

    return SingleChildScrollView(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          for (final t in tabs)
            Expanded(
              child: Pressable(
                semanticLabel: t.$2,
                onTap: () => setState(() => kind = t.$1),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 160),
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(14),
                    color: kind == t.$1 ? t.$3.withValues(alpha: 0.28) : p.glassFill,
                    border: Border.all(color: kind == t.$1 ? t.$3 : p.glassBorder),
                  ),
                  child: Text(t.$2, textAlign: TextAlign.center, style: TextStyle(fontWeight: FontWeight.w700, color: p.textPrimary)),
                ),
              ),
            ),
        ]),
        const SizedBox(height: 16),
        TextField(
          controller: amount,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9 .,]'))],
          style: TextStyle(fontSize: 34, fontWeight: FontWeight.w800, color: accent),
          textAlign: TextAlign.center,
          decoration: InputDecoration(labelText: '${s.t('amount')}${from != null ? ' (${from.currency})' : ''}'),
        ),
        const SizedBox(height: 14),
        if (kind == OpKind.debt) ...[
          SegmentedButton<bool>(
            segments: [
              ButtonSegment(value: true, label: Text(s.t('borrowed'))),
              ButtonSegment(value: false, label: Text(s.t('lent'))),
            ],
            selected: {borrowed},
            onSelectionChanged: (v) => setState(() => borrowed = v.first),
          ),
          const SizedBox(height: 12),
          TextField(controller: person, decoration: InputDecoration(labelText: s.t('person'))),
          const SizedBox(height: 12),
        ],
        _label(s.t(kind == OpKind.transfer ? 'from_wallet' : 'wallet'), p),
        _walletChips(wallets, walletId, (id) => setState(() => walletId = id), exclude: null),
        if (kind == OpKind.transfer) ...[
          _label(s.t('to_wallet'), p),
          _walletChips(wallets, toWalletId, (id) => setState(() => toWalletId = id), exclude: walletId),
          if (walletId != null && walletId == toWalletId)
            Text(s.t('same_wallet'), style: const TextStyle(color: Ink.expense)),
          if (crossCurrency) ...[
            const SizedBox(height: 8),
            Row(children: [
              Expanded(
                child: TextField(
                  controller: rate,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(labelText: '${s.t('rate')} (${from!.currency}→${to!.currency})'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: toAmount,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(labelText: '${s.t('to_amount')} (${to!.currency})'),
                ),
              ),
            ]),
          ],
        ],
        if (kind == OpKind.expense) ...[
          _label(s.t('category'), p),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final c in data.categories)
              _chip(c.name, categoryId == c.id, parseHex(c.color), () => setState(() => categoryId = c.id), icon: c.icon),
          ]),
        ],
        if (kind == OpKind.income) ...[
          _label(s.t('source'), p),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final c in data.sources)
              _chip(c.name, sourceId == c.id, parseHex(c.color), () => setState(() => sourceId = c.id), icon: c.icon),
          ]),
        ],
        const SizedBox(height: 8),
        TextButton.icon(
          onPressed: () => setState(() => more = !more),
          icon: Icon(more ? Icons.expand_less : Icons.expand_more),
          label: Text(s.t('more')),
        ),
        if (more) ...[
          _label(s.t('project'), p),
          Wrap(spacing: 8, runSpacing: 8, children: [
            _chip('—', projectId == null, p.textSecondary, () => setState(() => projectId = null)),
            for (final pr in data.projects)
              _chip(pr.name, projectId == pr.id, parseHex(pr.color), () => setState(() => projectId = pr.id), icon: pr.icon),
          ]),
          if (kind == OpKind.income || kind == OpKind.debt) ...[
            const SizedBox(height: 8),
            TextField(controller: reason, decoration: InputDecoration(labelText: s.t('reason'))),
          ],
          const SizedBox(height: 8),
          TextField(controller: memo, maxLength: 1000, decoration: InputDecoration(labelText: s.t('memo'))),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text('${s.t('date')}: ${fmtDateTime(when)}'),
            trailing: const Icon(Icons.event_rounded),
            onTap: () async {
              final d = await showDatePicker(
                  context: context, initialDate: when, firstDate: DateTime(2000), lastDate: DateTime.now().add(const Duration(days: 365)));
              if (d != null) setState(() => when = DateTime(d.year, d.month, d.day, when.hour, when.minute));
            },
          ),
          if (kind == OpKind.debt)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text('${s.t('due')}: ${due == null ? '—' : fmtDate(due!)}'),
              trailing: const Icon(Icons.alarm_rounded),
              onTap: () async {
                final d = await showDatePicker(
                    context: context, initialDate: DateTime.now().add(const Duration(days: 30)),
                    firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 3650)));
                if (d != null) setState(() => due = d);
              },
            ),
        ],
        if (error != null)
          Padding(padding: const EdgeInsets.only(top: 8), child: Text(error!, style: const TextStyle(color: Ink.expense))),
        const SizedBox(height: 12),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: accent, minimumSize: const Size.fromHeight(54)),
          onPressed: busy ? null : _submit,
          child: busy
              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
              : Text(s.t('confirm'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
        ),
      ]),
    );
  }

  Widget _label(String t, GlassPalette p) => Padding(
        padding: const EdgeInsets.only(top: 6, bottom: 6),
        child: Text(t, style: TextStyle(color: p.textSecondary, fontWeight: FontWeight.w600)),
      );

  Widget _chip(String text, bool selected, Color color, VoidCallback onTap, {String? icon}) {
    return Pressable(
      semanticLabel: text,
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          color: selected ? color.withValues(alpha: 0.3) : Colors.white.withValues(alpha: 0.06),
          border: Border.all(color: selected ? color : Colors.white24),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          if (icon != null) ...[Icon(AppIcons.of(icon), size: 16, color: color), const SizedBox(width: 6)],
          Flexible(child: Text(text, overflow: TextOverflow.ellipsis, maxLines: 1)),
        ]),
      ),
    );
  }

  Widget _walletChips(List<dynamic> wallets, String? selected, ValueChanged<String> onPick, {String? exclude}) {
    return Wrap(spacing: 8, runSpacing: 8, children: [
      for (final w in wallets.where((w) => w.id != exclude))
        _chip('${w.name} · ${fmtMoney(w.balance, w.currency, true)}', selected == w.id, parseHex(w.color), () => onPick(w.id),
            icon: w.icon),
    ]);
  }

  Future<void> _submit() async {
    final s = ref.read(stringsProvider);
    final value = parseAmount(amount.text);
    if (value == null) return setState(() => error = '${s.t('amount')}?');
    if (walletId == null) return setState(() => error = s.t('select_wallet'));

    String endpoint;
    Map<String, dynamic> body;
    String? target;
    switch (kind) {
      case OpKind.income:
        endpoint = 'income';
        body = {
          'walletId': walletId, 'amount': value, 'incomeSourceId': sourceId, 'projectId': projectId,
          'reason': reason.text.trim().isEmpty ? null : reason.text.trim(),
          'memo': memo.text.trim().isEmpty ? null : memo.text.trim(), 'occurredAt': when.toUtc().toIso8601String(),
        };
      case OpKind.expense:
        if (categoryId == null) return setState(() => error = s.t('select_category'));
        endpoint = 'expense';
        body = {
          'walletId': walletId, 'amount': value, 'categoryId': categoryId, 'projectId': projectId,
          'memo': memo.text.trim().isEmpty ? null : memo.text.trim(), 'occurredAt': when.toUtc().toIso8601String(),
        };
      case OpKind.transfer:
        if (toWalletId == null) return setState(() => error = s.t('to_wallet'));
        if (toWalletId == walletId) return setState(() => error = s.t('same_wallet'));
        endpoint = 'transfer';
        body = {
          'fromWalletId': walletId, 'toWalletId': toWalletId, 'amount': value,
          'toAmount': parseAmount(toAmount.text), 'fxRate': parseAmount(rate.text), 'projectId': projectId,
          'memo': memo.text.trim().isEmpty ? null : memo.text.trim(), 'occurredAt': when.toUtc().toIso8601String(),
        };
      case OpKind.debt:
        if (person.text.trim().isEmpty) return setState(() => error = s.t('person'));
        endpoint = 'debt';
        body = {
          'direction': borrowed ? 0 : 1, 'personName': person.text.trim(), 'walletId': walletId, 'amount': value,
          'dueDate': due?.toUtc().toIso8601String(), 'projectId': projectId,
          'reason': reason.text.trim().isEmpty ? null : reason.text.trim(),
          'memo': memo.text.trim().isEmpty ? null : memo.text.trim(), 'occurredAt': when.toUtc().toIso8601String(),
        };
    }

    setState(() {
      busy = true;
      error = null;
    });
    final err = await ref.read(dataProvider.notifier).submit(endpoint, body, targetId: target);
    if (!mounted) return;
    if (err != null) {
      setState(() {
        busy = false;
        error = err;
      });
      HapticFeedback.heavyImpact();
      return;
    }
    HapticFeedback.mediumImpact();
    Navigator.of(context).pop();
  }
}
