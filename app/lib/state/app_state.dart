import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import '../core/api.dart';
import '../core/i18n.dart';
import '../core/models.dart';
import '../core/storage.dart';

const _defaultApi = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:5080');
const _uuid = Uuid();

// ---------------------------------------------------------------- settings

class Settings {
  const Settings({this.lang = 'uz', this.themeMode = ThemeMode.dark, this.reduceEffects = false, this.apiUrl = _defaultApi});
  final String lang;
  final ThemeMode themeMode;
  final bool reduceEffects;
  final String apiUrl;

  Settings copyWith({String? lang, ThemeMode? themeMode, bool? reduceEffects, String? apiUrl}) => Settings(
      lang: lang ?? this.lang,
      themeMode: themeMode ?? this.themeMode,
      reduceEffects: reduceEffects ?? this.reduceEffects,
      apiUrl: apiUrl ?? this.apiUrl);
}

class SettingsNotifier extends Notifier<Settings> {
  @override
  Settings build() => const Settings();

  Future<void> load() async {
    final p = await SharedPreferences.getInstance();
    state = Settings(
      lang: p.getString('lang') ?? 'uz',
      themeMode: ThemeMode.values[(p.getInt('theme') ?? ThemeMode.dark.index).clamp(0, 2)],
      reduceEffects: p.getBool('reduce') ?? false,
      apiUrl: p.getString('api') ?? _defaultApi,
    );
  }

  Future<void> update(Settings s) async {
    state = s;
    final p = await SharedPreferences.getInstance();
    await p.setString('lang', s.lang);
    await p.setInt('theme', s.themeMode.index);
    await p.setBool('reduce', s.reduceEffects);
    await p.setString('api', s.apiUrl);
  }
}

final settingsProvider = NotifierProvider<SettingsNotifier, Settings>(SettingsNotifier.new);
final stringsProvider = Provider<S>((ref) => S(ref.watch(settingsProvider.select((s) => s.lang))));

// ---------------------------------------------------------------- infrastructure

final localStoreProvider = Provider<LocalStore>((ref) => throw UnimplementedError('overridden in main()'));
final sessionStoreProvider = Provider<SessionStore>((ref) => SessionStore());

final apiProvider = Provider<ApiClient>((ref) {
  final url = ref.watch(settingsProvider.select((s) => s.apiUrl));
  final api = ApiClient(baseUrl: url);
  final session = ref.read(sessionStoreProvider);
  api.onTokens = (a, r) => session.write(a, r);
  return api;
});

// ---------------------------------------------------------------- session

enum SessionStatus { loading, signedOut, signedIn }

class SessionState {
  const SessionState(this.status, [this.user]);
  final SessionStatus status;
  final UserProfile? user;
}

class SessionNotifier extends Notifier<SessionState> {
  @override
  SessionState build() => const SessionState(SessionStatus.loading);

  Future<void> restore() async {
    final api = ref.read(apiProvider);
    api.onSessionExpired = () => signOut(remote: false);
    final saved = await ref.read(sessionStoreProvider).read();
    if (saved == null) {
      state = const SessionState(SessionStatus.signedOut);
      return;
    }
    api.accessToken = saved.access;
    api.refreshToken = saved.refresh;
    try {
      final j = await api.get('/api/me/');
      state = SessionState(SessionStatus.signedIn, UserProfile.fromJson(j));
    } on ApiException catch (e) {
      if (e.isNetwork) {
        // Offline start: keep the session, cached data will be shown.
        final cached = await ref.read(localStoreProvider).get('profile');
        if (cached != null) {
          state = SessionState(SessionStatus.signedIn, UserProfile.fromJson(jsonDecode(cached)));
          return;
        }
      }
      state = const SessionState(SessionStatus.signedOut);
    }
  }

  Future<void> login(String email, String password) async {
    final u = await ref.read(apiProvider).login(email, password);
    await _signedIn(u);
  }

  Future<void> register(String email, String password, String name) async {
    final lang = ref.read(settingsProvider).lang;
    final u = await ref.read(apiProvider).register(email, password, name, lang);
    await _signedIn(u);
  }

  Future<void> _signedIn(UserProfile u) async {
    await ref.read(localStoreProvider).put('profile', jsonEncode({
          'id': u.id, 'email': u.email, 'displayName': u.displayName, 'locale': u.locale,
          'defaultCurrency': u.defaultCurrency, 'theme': u.theme,
        }));
    state = SessionState(SessionStatus.signedIn, u);
  }

  Future<void> signOut({bool remote = true}) async {
    if (remote) await ref.read(apiProvider).logout();
    await ref.read(sessionStoreProvider).clear();
    await ref.read(localStoreProvider).clear();
    ref.read(apiProvider)
      ..accessToken = null
      ..refreshToken = null;
    state = const SessionState(SessionStatus.signedOut);
  }
}

final sessionProvider = NotifierProvider<SessionNotifier, SessionState>(SessionNotifier.new);

// ---------------------------------------------------------------- data

enum Period { month, week, year, all }

class DataState {
  const DataState({
    this.wallets = const [],
    this.categories = const [],
    this.sources = const [],
    this.people = const [],
    this.projects = const [],
    this.debts = const [],
    this.transactions = const [],
    this.summary,
    this.budgets = const [],
    this.pending = const [],
    this.online = true,
    this.syncing = false,
    this.loaded = false,
    this.period = Period.month,
  });

  final List<Wallet> wallets;
  final List<Category> categories;
  final List<IncomeSource> sources;
  final List<Person> people;
  final List<Project> projects;
  final List<Debt> debts;
  final List<Tx> transactions;
  final Summary? summary;
  final List<BudgetStatus> budgets;
  final List<PendingOp> pending;
  final bool online, syncing, loaded;
  final Period period;

  DataState copyWith({
    List<Wallet>? wallets, List<Category>? categories, List<IncomeSource>? sources, List<Person>? people,
    List<Project>? projects, List<Debt>? debts, List<Tx>? transactions, Summary? summary,
    List<BudgetStatus>? budgets, List<PendingOp>? pending, bool? online, bool? syncing, bool? loaded, Period? period,
  }) =>
      DataState(
        wallets: wallets ?? this.wallets,
        categories: categories ?? this.categories,
        sources: sources ?? this.sources,
        people: people ?? this.people,
        projects: projects ?? this.projects,
        debts: debts ?? this.debts,
        transactions: transactions ?? this.transactions,
        summary: summary ?? this.summary,
        budgets: budgets ?? this.budgets,
        pending: pending ?? this.pending,
        online: online ?? this.online,
        syncing: syncing ?? this.syncing,
        loaded: loaded ?? this.loaded,
        period: period ?? this.period,
      );

  Wallet? wallet(String? id) => wallets.where((w) => w.id == id).firstOrNull;
  Category? category(String? id) => categories.where((c) => c.id == id).firstOrNull;
  IncomeSource? source(String? id) => sources.where((c) => c.id == id).firstOrNull;
  Person? person(String? id) => people.where((c) => c.id == id).firstOrNull;
  Project? project(String? id) => projects.where((c) => c.id == id).firstOrNull;
  List<Wallet> get activeWallets => wallets.where((w) => !w.isArchived).toList();
}

class DataNotifier extends Notifier<DataState> {
  @override
  DataState build() => const DataState();

  ApiClient get _api => ref.read(apiProvider);
  LocalStore get _store => ref.read(localStoreProvider);

  Map<String, String?> _periodQuery(Period p) {
    final now = DateTime.now().toUtc();
    DateTime? from;
    switch (p) {
      case Period.month:
        from = DateTime.utc(now.year, now.month, 1);
      case Period.week:
        from = DateTime.utc(now.year, now.month, now.day).subtract(Duration(days: now.weekday - 1));
      case Period.year:
        from = DateTime.utc(now.year, 1, 1);
      case Period.all:
        from = null;
    }
    return {'from': from?.toIso8601String()};
  }

  Future<void> init() async {
    // 1) show cached snapshot instantly, 2) refresh from server.
    final cached = await _store.get('snapshot');
    final queue = await _store.get('queue');
    var pending = <PendingOp>[];
    if (queue != null) {
      pending = (jsonDecode(queue) as List).map((e) => PendingOp.fromJson(e)).toList();
    }
    if (cached != null) {
      try {
        state = _fromSnapshot(jsonDecode(cached), pending);
      } catch (_) {}
    } else {
      state = state.copyWith(pending: pending);
    }
    await refresh();
  }

  DataState _fromSnapshot(Map<String, dynamic> j, List<PendingOp> pending) => state.copyWith(
        wallets: (j['wallets'] as List).map((e) => Wallet.fromJson(e)).toList(),
        categories: (j['categories'] as List).where((e) => e['isArchived'] != true).map((e) => Category.fromJson(e)).toList(),
        sources: (j['incomeSources'] as List).where((e) => e['isArchived'] != true).map((e) => IncomeSource.fromJson(e)).toList(),
        people: (j['people'] as List).map((e) => Person.fromJson(e)).toList(),
        projects: (j['projects'] as List).where((e) => e['isArchived'] != true).map((e) => Project.fromJson(e)).toList(),
        debts: (j['debts'] as List).map((e) => Debt.fromJson(e)).toList(),
        transactions: (j['transactions'] as List).map((e) => Tx.fromJson(e)).toList()
          ..sort((a, b) => b.occurredAt.compareTo(a.occurredAt)),
        pending: pending,
        loaded: true,
      );

  /// Pull full snapshot + analytics from the server; falls back to cached data when offline.
  Future<void> refresh() async {
    try {
      await flushPending();
      final pull = await _api.get('/api/sync/pull') as Map<String, dynamic>;
      await _store.put('snapshot', jsonEncode(pull));
      state = _fromSnapshot(pull, state.pending).copyWith(online: true);
      await loadAnalytics();
    } on ApiException catch (e) {
      if (e.isNetwork) state = state.copyWith(online: false, loaded: true);
      rethrow;
    }
  }

  Future<void> loadAnalytics() async {
    final q = _periodQuery(state.period);
    final s = await _api.get('/api/analytics/summary', q);
    final b = await _api.get('/api/analytics/budgets');
    state = state.copyWith(
      summary: Summary.fromJson(s),
      budgets: (b as List).map((e) => BudgetStatus.fromJson(e)).toList(),
    );
  }

  Future<void> setPeriod(Period p) async {
    state = state.copyWith(period: p);
    try {
      await loadAnalytics();
    } catch (_) {}
  }

  // ---- operations (online-first, queued when the network is unreachable)

  Future<String?> submit(String kind, Map<String, dynamic> payload, {String? targetId}) async {
    final id = 'op-${_uuid.v4()}';
    final op = PendingOp(clientOperationId: id, kind: kind, payload: payload, targetId: targetId, createdAt: DateTime.now());
    try {
      final res = await _api.post('/api/sync/push', {
        'operations': [
          {'clientOperationId': id, 'kind': kind, 'payload': payload, 'targetId': targetId}
        ]
      });
      final r = (res['results'] as List).first as Map<String, dynamic>;
      if (r['status'] == 'rejected') return r['message'] as String? ?? r['errorCode'] as String?;
      await refresh();
      return null;
    } on ApiException catch (e) {
      if (!e.isNetwork) return e.message;
      await _enqueue(op);
      state = state.copyWith(online: false);
      return null; // accepted locally, shown as pending
    }
  }

  Future<void> _enqueue(PendingOp op) async {
    final list = [...state.pending, op];
    state = state.copyWith(pending: list);
    await _persistQueue(list);
  }

  Future<void> _persistQueue(List<PendingOp> list) =>
      _store.put('queue', jsonEncode(list.map((e) => e.toJson()).toList()));

  /// Replays the offline queue. Client operation ids make this safe to repeat after a lost response.
  Future<void> flushPending() async {
    if (state.pending.isEmpty || state.syncing) return;
    state = state.copyWith(syncing: true);
    try {
      final batch = state.pending.where((o) => o.error == null).toList();
      if (batch.isEmpty) return;
      final res = await _api.post('/api/sync/push', {
        'operations': batch
            .map((o) => {
                  'clientOperationId': o.clientOperationId, 'kind': o.kind, 'payload': o.payload, 'targetId': o.targetId
                })
            .toList()
      });
      final results = {for (final r in res['results'] as List) r['clientOperationId'] as String: r as Map<String, dynamic>};
      final remaining = <PendingOp>[];
      for (final o in state.pending) {
        final r = results[o.clientOperationId];
        if (r == null) {
          remaining.add(o);
        } else if (r['status'] == 'rejected') {
          // Surface the rejection; the user decides (the server never forces an invalid operation).
          remaining.add(o.withError(r['message'] as String? ?? r['errorCode'] as String?));
        }
      }
      state = state.copyWith(pending: remaining);
      await _persistQueue(remaining);
    } on ApiException catch (e) {
      if (e.isNetwork) state = state.copyWith(online: false);
    } finally {
      state = state.copyWith(syncing: false);
    }
  }

  Future<void> dismissRejected(String opId) async {
    final list = state.pending.where((o) => o.clientOperationId != opId).toList();
    state = state.copyWith(pending: list);
    await _persistQueue(list);
  }

  // ---- direct (online-only) management calls

  Future<void> reverse(String txId) async {
    await _api.post('/api/transactions/$txId/reverse', {});
    await refresh();
  }

  Future<void> createWallet(Map<String, dynamic> body) async {
    await _api.post('/api/wallets/', body, idempotencyKey: 'w-${_uuid.v4()}');
    await refresh();
  }

  Future<void> archiveWallet(String id, bool archived) async {
    await _api.patch('/api/wallets/$id', {'isArchived': archived});
    await refresh();
  }

  Future<void> adjustWallet(String id, double newBalance) async {
    await _api.post('/api/wallets/$id/adjust', {'newBalance': newBalance, 'clientKey': 'adj-${_uuid.v4()}'});
    await refresh();
  }

  Future<void> createCategory(String name, String icon, String color, {double? limit, String? currency}) async {
    await _api.post('/api/categories/',
        {'name': name, 'icon': icon, 'color': color, 'monthlyLimit': limit, 'limitCurrency': currency});
    await refresh();
  }

  Future<void> createSource(String name, String icon, String color) async {
    await _api.post('/api/income-sources/', {'name': name, 'icon': icon, 'color': color});
    await refresh();
  }

  Future<void> createProject(String name, String icon, String color, String currency) async {
    await _api.post('/api/projects/', {'name': name, 'icon': icon, 'color': color, 'currency': currency});
    await refresh();
  }

  Future<Map<String, dynamic>> projectSummary(String id) async =>
      Map<String, dynamic>.from(await _api.get('/api/projects/$id/summary'));

  Future<List<Tx>> search(Map<String, String?> q) async {
    final res = await _api.get('/api/transactions/', {...q, 'pageSize': '100'});
    return (res['items'] as List).map((e) => Tx.fromJson(e)).toList();
  }

  Future<List<BreakdownRow>> breakdown(String by, Map<String, String?> q) async {
    final res = await _api.get('/api/analytics/breakdown', {...q, 'by': by});
    return (res as List).map((e) => BreakdownRow.fromJson(e)).toList();
  }

  Future<List<SeriesPoint>> series(String granularity, Map<String, String?> q) async {
    final res = await _api.get('/api/analytics/timeseries', {...q, 'granularity': granularity});
    return (res as List).map((e) => SeriesPoint.fromJson(e)).toList();
  }

  Future<List<int>> export(String format, Map<String, String?> q, String lang) =>
      _api.download('/api/reports/export', {...q, 'format': format, 'lang': lang});

  Future<void> deleteAccount() async {
    await _api.delete('/api/me/');
  }
}

final dataProvider = NotifierProvider<DataNotifier, DataState>(DataNotifier.new);

/// Tolerant decimal parsing of user input ("1 500 000,50" -> 1500000.5). Returns null when invalid.
double? parseAmount(String input) {
  final s = input.replaceAll(RegExp(r'[\s ]'), '').replaceAll(',', '.');
  if (s.isEmpty) return null;
  final v = double.tryParse(s);
  return (v == null || v <= 0 || v.isNaN || v.isInfinite) ? null : v;
}

String newKey() => 'op-${_uuid.v4()}';
