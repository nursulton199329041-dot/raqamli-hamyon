import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../design/app_icons.dart';
import '../../design/glass.dart';
import '../../design/theme.dart';
import '../../state/app_state.dart';

const _palette = [
  '#3B82F6', '#22C55E', '#EF4444', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#64748B', '#0EA5E9',
];
const _currencies = ['UZS', 'USD', 'EUR', 'RUB', 'KZT'];

class IconColorPicker extends StatelessWidget {
  const IconColorPicker({super.key, required this.icon, required this.color, required this.onIcon, required this.onColor});
  final String icon, color;
  final ValueChanged<String> onIcon, onColor;

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Wrap(spacing: 8, runSpacing: 8, children: [
        for (final k in AppIcons.glyphs.keys)
          Pressable(
            semanticLabel: k,
            onTap: () => onIcon(k),
            child: Container(
              padding: const EdgeInsets.all(3),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: k == icon ? Colors.white : Colors.transparent, width: 2),
              ),
              child: AppIcon(k, color: parseHex(color), size: 40),
            ),
          ),
      ]),
      const SizedBox(height: 12),
      Wrap(spacing: 10, runSpacing: 10, children: [
        for (final c in _palette)
          Pressable(
            semanticLabel: c,
            onTap: () => onColor(c),
            child: Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: parseHex(c),
                shape: BoxShape.circle,
                border: Border.all(color: c == color ? Colors.white : Colors.transparent, width: 3),
              ),
            ),
          ),
      ]),
    ]);
  }
}

Future<void> showWalletSheet(BuildContext context, WidgetRef ref) =>
    showGlassSheet<void>(context, full: true, builder: (_) => const _WalletForm());

class _WalletForm extends ConsumerStatefulWidget {
  const _WalletForm();
  @override
  ConsumerState<_WalletForm> createState() => _WalletFormState();
}

class _WalletFormState extends ConsumerState<_WalletForm> {
  final name = TextEditingController();
  final balance = TextEditingController();
  final bank = TextEditingController();
  final mask = TextEditingController();
  String currency = 'UZS', icon = 'wallet', color = '#3B82F6';
  int type = 1;
  bool overdraft = false, busy = false;
  String? error;

  @override
  void dispose() {
    name.dispose();
    balance.dispose();
    bank.dispose();
    mask.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final types = {0: s.t('cash'), 1: s.t('card'), 2: s.t('account'), 3: s.t('savings'), 4: s.t('virtual'), 5: s.t('project_wallet')};
    return SingleChildScrollView(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(s.t('new_wallet'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
        const SizedBox(height: 12),
        TextField(controller: name, maxLength: 80, decoration: InputDecoration(labelText: s.t('name'))),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final e in types.entries)
            ChoiceChip(label: Text(e.value), selected: type == e.key, onSelected: (_) => setState(() => type = e.key)),
        ]),
        const SizedBox(height: 10),
        Wrap(spacing: 8, children: [
          for (final c in _currencies)
            ChoiceChip(label: Text(c), selected: currency == c, onSelected: (_) => setState(() => currency = c)),
        ]),
        const SizedBox(height: 10),
        TextField(
          controller: balance,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(labelText: '${s.t('initial_balance')} ($currency)'),
        ),
        const SizedBox(height: 10),
        TextField(controller: bank, decoration: InputDecoration(labelText: s.t('bank_name'))),
        const SizedBox(height: 10),
        TextField(
          controller: mask,
          maxLength: 8,
          decoration: InputDecoration(labelText: s.t('masked_number'), helperText: 'CVV / to\'liq raqam saqlanmaydi'),
        ),
        SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(s.t('overdraft')), value: overdraft,
            onChanged: (v) => setState(() => overdraft = v)),
        IconColorPicker(icon: icon, color: color, onIcon: (v) => setState(() => icon = v), onColor: (v) => setState(() => color = v)),
        if (error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(error!, style: const TextStyle(color: Ink.expense))),
        const SizedBox(height: 16),
        FilledButton(
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
          onPressed: busy ? null : () => _save(s),
          child: Text(s.t('save')),
        ),
      ]),
    );
  }

  Future<void> _save(dynamic s) async {
    if (name.text.trim().isEmpty) return setState(() => error = s.t('name'));
    final initial = balance.text.trim().isEmpty ? 0.0 : parseAmount(balance.text);
    if (initial == null) return setState(() => error = s.t('initial_balance'));
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await ref.read(dataProvider.notifier).createWallet({
        'name': name.text.trim(), 'type': type, 'currency': currency, 'initialBalance': initial, 'icon': icon,
        'color': color, 'bankName': bank.text.trim().isEmpty ? null : bank.text.trim(),
        'maskedNumber': mask.text.trim().isEmpty ? null : mask.text.trim(), 'allowOverdraft': overdraft,
      });
      if (mounted) Navigator.pop(context);
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }
}

/// Creates an expense category (default) or an income source (source: true).
Future<void> showCategorySheet(BuildContext context, WidgetRef ref, {bool source = false}) =>
    showGlassSheet<void>(context, full: true, builder: (_) => _CategoryForm(source: source));

class _CategoryForm extends ConsumerStatefulWidget {
  const _CategoryForm({required this.source});
  final bool source;
  @override
  ConsumerState<_CategoryForm> createState() => _CategoryFormState();
}

class _CategoryFormState extends ConsumerState<_CategoryForm> {
  final name = TextEditingController();
  final limit = TextEditingController();
  String icon = 'tag', color = '#EF4444';
  bool busy = false;
  String? error;

  @override
  void initState() {
    super.initState();
    if (widget.source) {
      icon = 'briefcase';
      color = '#22C55E';
    }
  }

  @override
  void dispose() {
    name.dispose();
    limit.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    return SingleChildScrollView(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(s.t(widget.source ? 'new_source' : 'new_category'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
        const SizedBox(height: 12),
        TextField(controller: name, maxLength: 80, decoration: InputDecoration(labelText: s.t('name'))),
        if (!widget.source)
          TextField(
            controller: limit,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: '${s.t('limit')} (UZS / ${s.t('month')})'),
          ),
        const SizedBox(height: 12),
        IconColorPicker(icon: icon, color: color, onIcon: (v) => setState(() => icon = v), onColor: (v) => setState(() => color = v)),
        if (error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(error!, style: const TextStyle(color: Ink.expense))),
        const SizedBox(height: 16),
        FilledButton(
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
          onPressed: busy ? null : _save,
          child: Text(s.t('save')),
        ),
      ]),
    );
  }

  Future<void> _save() async {
    if (name.text.trim().isEmpty) return setState(() => error = '?');
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final n = ref.read(dataProvider.notifier);
      if (widget.source) {
        await n.createSource(name.text.trim(), icon, color);
      } else {
        await n.createCategory(name.text.trim(), icon, color,
            limit: limit.text.trim().isEmpty ? null : parseAmount(limit.text), currency: 'UZS');
      }
      if (mounted) Navigator.pop(context);
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }
}

Future<void> showProjectSheet(BuildContext context, WidgetRef ref) =>
    showGlassSheet<void>(context, full: true, builder: (_) => const _ProjectForm());

class _ProjectForm extends ConsumerStatefulWidget {
  const _ProjectForm();
  @override
  ConsumerState<_ProjectForm> createState() => _ProjectFormState();
}

class _ProjectFormState extends ConsumerState<_ProjectForm> {
  final name = TextEditingController();
  String icon = 'project', color = '#8B5CF6', currency = 'UZS';
  bool busy = false;
  String? error;

  @override
  void dispose() {
    name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    return SingleChildScrollView(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(s.t('new_project'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
        const SizedBox(height: 12),
        TextField(controller: name, maxLength: 80, decoration: InputDecoration(labelText: s.t('name'))),
        Wrap(spacing: 8, children: [
          for (final c in _currencies)
            ChoiceChip(label: Text(c), selected: currency == c, onSelected: (_) => setState(() => currency = c)),
        ]),
        const SizedBox(height: 12),
        IconColorPicker(icon: icon, color: color, onIcon: (v) => setState(() => icon = v), onColor: (v) => setState(() => color = v)),
        if (error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(error!, style: const TextStyle(color: Ink.expense))),
        const SizedBox(height: 16),
        FilledButton(
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
          onPressed: busy
              ? null
              : () async {
                  if (name.text.trim().isEmpty) return setState(() => error = '?');
                  setState(() => busy = true);
                  try {
                    await ref.read(dataProvider.notifier).createProject(name.text.trim(), icon, color, currency);
                    if (mounted) Navigator.pop(context);
                  } on ApiException catch (e) {
                    if (mounted) setState(() => error = e.message);
                  } finally {
                    if (mounted) setState(() => busy = false);
                  }
                },
          child: Text(s.t('save')),
        ),
      ]),
    );
  }
}
