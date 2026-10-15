import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../design/glass.dart';
import '../../design/theme.dart';
import '../../state/app_state.dart';

class AuthPage extends ConsumerStatefulWidget {
  const AuthPage({super.key});
  @override
  ConsumerState<AuthPage> createState() => _AuthPageState();
}

class _AuthPageState extends ConsumerState<AuthPage> {
  final email = TextEditingController();
  final password = TextEditingController();
  final name = TextEditingController();
  bool register = false, busy = false;
  String? error;

  @override
  void dispose() {
    email.dispose();
    password.dispose();
    name.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final s = ref.read(stringsProvider);
    if (email.text.trim().isEmpty || password.text.isEmpty) {
      return setState(() => error = '${s.t('email')} / ${s.t('password')}');
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final n = ref.read(sessionProvider.notifier);
      if (register) {
        await n.register(email.text.trim(), password.text, name.text.trim().isEmpty ? email.text.trim() : name.text.trim());
      } else {
        await n.login(email.text.trim(), password.text);
      }
      await ref.read(dataProvider.notifier).init();
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final st = ref.watch(settingsProvider);
    final p = GlassTheme.of(context).palette;
    return GlassBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: GlassCard(
                radius: 30,
                padding: const EdgeInsets.all(24),
                child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Icon(Icons.account_balance_wallet_rounded, size: 52, color: p.accent),
                  const SizedBox(height: 8),
                  Text(s.t('app'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 18),
                  if (register) ...[
                    TextField(controller: name, textInputAction: TextInputAction.next, decoration: InputDecoration(labelText: s.t('name'))),
                    const SizedBox(height: 12),
                  ],
                  TextField(
                    controller: email,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.email],
                    textInputAction: TextInputAction.next,
                    decoration: InputDecoration(labelText: s.t('email')),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: password,
                    obscureText: true,
                    autofillHints: const [AutofillHints.password],
                    onSubmitted: (_) => _submit(),
                    decoration: InputDecoration(labelText: s.t('password')),
                  ),
                  if (error != null)
                    Padding(padding: const EdgeInsets.only(top: 10), child: Text(error!, style: const TextStyle(color: Ink.expense))),
                  const SizedBox(height: 18),
                  FilledButton(
                    style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                    onPressed: busy ? null : _submit,
                    child: busy
                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                        : Text(s.t(register ? 'register' : 'login')),
                  ),
                  TextButton(
                    onPressed: () => setState(() => register = !register),
                    child: Text(s.t(register ? 'login' : 'register')),
                  ),
                  Wrap(alignment: WrapAlignment.center, spacing: 6, children: [
                    for (final l in ['uz', 'ru', 'en'])
                      ChoiceChip(
                        label: Text(l.toUpperCase()),
                        selected: st.lang == l,
                        onSelected: (_) => ref.read(settingsProvider.notifier).update(st.copyWith(lang: l)),
                      ),
                  ]),
                ]),
              ),
            ),
          ),
        ),
      ),
      ),
    );
  }
}
