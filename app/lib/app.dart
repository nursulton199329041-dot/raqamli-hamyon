import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'design/glass.dart';
import 'design/theme.dart';
import 'features/analytics/analytics_page.dart';
import 'features/auth/auth_page.dart';
import 'features/dashboard/dashboard_page.dart';
import 'features/debts/debts_page.dart';
import 'features/history/history_page.dart';
import 'features/ops/operation_sheet.dart';
import 'features/projects/projects_page.dart';
import 'features/settings/settings_page.dart';
import 'state/app_state.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.listen(sessionProvider, (_, __) => refresh.value++);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: '/',
    refreshListenable: refresh,
    redirect: (context, state) {
      final status = ref.read(sessionProvider).status;
      final atAuth = state.matchedLocation == '/auth';
      if (status == SessionStatus.loading) return null;
      if (status == SessionStatus.signedOut) return atAuth ? null : '/auth';
      return atAuth ? '/' : null;
    },
    routes: [
      GoRoute(path: '/auth', builder: (_, __) => const AuthPage()),
      GoRoute(path: '/settings', builder: (_, __) => const _Scaffolded(child: SettingsPage(), back: true)),
      ShellRoute(
        builder: (context, state, child) => _Shell(location: state.matchedLocation, child: child),
        routes: [
          GoRoute(path: '/', pageBuilder: (_, __) => _fade(const DashboardPage())),
          GoRoute(path: '/history', pageBuilder: (_, __) => _fade(const HistoryPage())),
          GoRoute(path: '/analytics', pageBuilder: (_, __) => _fade(const AnalyticsPage())),
          GoRoute(path: '/projects', pageBuilder: (_, __) => _fade(const ProjectsPage())),
          GoRoute(path: '/debts', pageBuilder: (_, __) => _fade(const DebtsPage())),
        ],
      ),
    ],
  );
});

CustomTransitionPage<void> _fade(Widget child) => CustomTransitionPage<void>(
      child: child,
      transitionDuration: const Duration(milliseconds: 220),
      transitionsBuilder: (_, a, __, c) => FadeTransition(opacity: CurvedAnimation(parent: a, curve: Curves.easeOut), child: c),
    );

class RaqamliApp extends ConsumerWidget {
  const RaqamliApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = ref.watch(settingsProvider);
    final router = ref.watch(routerProvider);
    final platformDark = PlatformDispatcher.instance.platformBrightness == Brightness.dark;
    final isDark = switch (settings.themeMode) {
      ThemeMode.dark => true,
      ThemeMode.light => false,
      ThemeMode.system => platformDark,
    };
    final palette = isDark ? GlassPalette.dark : GlassPalette.light;

    return MaterialApp.router(
      title: 'Raqamli Hamyon',
      debugShowCheckedModeBanner: false,
      routerConfig: router,
      theme: buildMaterialTheme(GlassPalette.light, Brightness.light),
      darkTheme: buildMaterialTheme(GlassPalette.dark, Brightness.dark),
      themeMode: settings.themeMode,
      locale: Locale(settings.lang == 'uz' ? 'en' : settings.lang), // uz has no Material delegate; strings come from S
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [Locale('en'), Locale('ru')],
      builder: (context, child) => GlassTheme(
        palette: palette,
        reduceEffects: settings.reduceEffects,
        child: DefaultTextStyle.merge(
          style: TextStyle(color: palette.textPrimary),
          child: child ?? const SizedBox.shrink(),
        ),
      ),
    );
  }
}

class _Scaffolded extends StatelessWidget {
  const _Scaffolded({required this.child, this.back = false});
  final Widget child;
  final bool back;

  @override
  Widget build(BuildContext context) => GlassBackground(
        child: Scaffold(
          backgroundColor: Colors.transparent,
          appBar: back ? AppBar(backgroundColor: Colors.transparent, elevation: 0) : null,
          body: SafeArea(child: child),
        ),
      );
}

class _Shell extends ConsumerWidget {
  const _Shell({required this.location, required this.child});
  final String location;
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final p = GlassTheme.of(context).palette;
    final items = <(String, IconData, String)>[
      ('/', Icons.home_rounded, s.t('home')),
      ('/history', Icons.receipt_long_rounded, s.t('history')),
      ('/analytics', Icons.pie_chart_rounded, s.t('analytics')),
      ('/projects', Icons.folder_special_rounded, s.t('projects')),
      ('/debts', Icons.handshake_rounded, s.t('debts')),
    ];
    final index = items.indexWhere((e) => e.$1 == location).clamp(0, items.length - 1);

    return GlassBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        extendBody: true,
        body: SafeArea(bottom: false, child: child),
        floatingActionButtonLocation: FloatingActionButtonLocation.centerFloat,
        floatingActionButton: _FloatingNav(
          items: items,
          index: index,
          palette: p,
          onSelect: (i) => context.go(items[i].$1),
          onSettings: () => context.push('/settings'),
          onAdd: () => showOperationSheet(context, const OpPrefill()),
        ),
      ),
    );
  }
}

class _FloatingNav extends StatelessWidget {
  const _FloatingNav({
    required this.items, required this.index, required this.palette, required this.onSelect,
    required this.onSettings, required this.onAdd,
  });
  final List<(String, IconData, String)> items;
  final int index;
  final GlassPalette palette;
  final ValueChanged<int> onSelect;
  final VoidCallback onSettings, onAdd;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      child: GlassCard(
        radius: 30,
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
        child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          for (var i = 0; i < items.length; i++)
            Expanded(
              child: Pressable(
                semanticLabel: items[i].$3,
                onTap: () => onSelect(i),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(22),
                    color: i == index ? palette.accent.withValues(alpha: 0.22) : Colors.transparent,
                  ),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Icon(items[i].$2, size: 24, color: i == index ? palette.accent : palette.textSecondary),
                    Text(items[i].$3,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 10, color: i == index ? palette.accent : palette.textSecondary)),
                  ]),
                ),
              ),
            ),
          IconButton(tooltip: '+', onPressed: onAdd, icon: Icon(Icons.add_circle_rounded, color: palette.accent, size: 30)),
          IconButton(onPressed: onSettings, icon: Icon(Icons.settings_rounded, color: palette.textSecondary)),
        ]),
      ),
    );
  }
}
