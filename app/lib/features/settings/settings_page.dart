import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../design/glass.dart';
import '../../state/app_state.dart';

class SettingsPage extends ConsumerWidget {
  const SettingsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final st = ref.watch(settingsProvider);
    final user = ref.watch(sessionProvider).user;
    final data = ref.watch(dataProvider);
    final notifier = ref.read(settingsProvider.notifier);

    return ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 120), children: [
      Text(s.t('settings'), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
      const SizedBox(height: 12),
      GlassCard(
        child: Row(children: [
          const Icon(Icons.person_rounded, size: 36),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(user?.displayName ?? '', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
              Text(user?.email ?? ''),
            ]),
          ),
        ]),
      ),
      const SizedBox(height: 12),
      GlassCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(s.t('language'), style: const TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'uz', label: Text('O\'zbek')),
              ButtonSegment(value: 'ru', label: Text('Русский')),
              ButtonSegment(value: 'en', label: Text('English')),
            ],
            selected: {st.lang},
            onSelectionChanged: (v) => notifier.update(st.copyWith(lang: v.first)),
          ),
          const SizedBox(height: 16),
          Text(s.t('theme'), style: const TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          SegmentedButton<ThemeMode>(
            segments: [
              ButtonSegment(value: ThemeMode.dark, label: Text(s.t('dark'))),
              ButtonSegment(value: ThemeMode.light, label: Text(s.t('light'))),
              ButtonSegment(value: ThemeMode.system, label: Text(s.t('system'))),
            ],
            selected: {st.themeMode},
            onSelectionChanged: (v) => notifier.update(st.copyWith(themeMode: v.first)),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(s.t('reduce_effects')),
            value: st.reduceEffects,
            onChanged: (v) => notifier.update(st.copyWith(reduceEffects: v)),
          ),
        ]),
      ),
      const SizedBox(height: 12),
      GlassCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(s.t('syncing'), style: const TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Text(data.online ? s.t('synced') : s.t('offline')),
          if (data.pending.isNotEmpty) Text(s.t('sync_pending', {'n': '${data.pending.length}'})),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            icon: const Icon(Icons.sync_rounded),
            label: Text(s.t('retry')),
            onPressed: () async {
              try {
                await ref.read(dataProvider.notifier).refresh();
              } catch (_) {}
            },
          ),
          const SizedBox(height: 8),
          TextFormField(
            initialValue: st.apiUrl,
            decoration: const InputDecoration(labelText: 'API URL'),
            onFieldSubmitted: (v) => notifier.update(st.copyWith(apiUrl: v.trim())),
          ),
        ]),
      ),
      const SizedBox(height: 12),
      FilledButton.tonal(
        onPressed: () => ref.read(sessionProvider.notifier).signOut(),
        child: Text(s.t('logout')),
      ),
      const SizedBox(height: 8),
      TextButton(
        style: TextButton.styleFrom(foregroundColor: Colors.redAccent),
        onPressed: () async {
          final ok = await showDialog<bool>(
            context: context,
            builder: (ctx) => AlertDialog(
              title: Text(s.t('delete_account')),
              content: Text(s.t('delete_account_confirm')),
              actions: [
                TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(s.t('cancel'))),
                TextButton(onPressed: () => Navigator.pop(ctx, true), child: Text(s.t('delete'))),
              ],
            ),
          );
          if (ok != true) return;
          try {
            await ref.read(dataProvider.notifier).deleteAccount();
            await ref.read(sessionProvider.notifier).signOut(remote: false);
          } on ApiException catch (e) {
            if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
          }
        },
        child: Text(s.t('delete_account')),
      ),
    ]);
  }
}
