import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'core/storage.dart';
import 'state/app_state.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final store = await LocalStore.open();
  final container = ProviderContainer(overrides: [localStoreProvider.overrideWithValue(store)]);

  await container.read(settingsProvider.notifier).load();
  await container.read(sessionProvider.notifier).restore();
  if (container.read(sessionProvider).status == SessionStatus.signedIn) {
    // Don't block startup on the network; cached data renders immediately.
    container.read(dataProvider.notifier).init().catchError((Object _) {});
  }

  runApp(UncontrolledProviderScope(container: container, child: const RaqamliApp()));
}
