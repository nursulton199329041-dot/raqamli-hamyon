import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite/sqflite.dart';

/// Local key-value cache. Uses SQLite on mobile/desktop and SharedPreferences on web
/// (sqflite has no web backend). Holds the last server snapshot and the offline operation queue.
class LocalStore {
  LocalStore._(this._db, this._prefs);

  final Database? _db;
  final SharedPreferences? _prefs;

  static Future<LocalStore> open() async {
    if (kIsWeb) return LocalStore._(null, await SharedPreferences.getInstance());
    final path = p.join(await getDatabasesPath(), 'hamyon_cache.db');
    final db = await openDatabase(path, version: 1, onCreate: (d, _) async {
      await d.execute('CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    });
    return LocalStore._(db, null);
  }

  Future<String?> get(String key) async {
    if (_db != null) {
      final rows = await _db.query('kv', where: 'k = ?', whereArgs: [key], limit: 1);
      return rows.isEmpty ? null : rows.first['v'] as String;
    }
    return _prefs!.getString('kv_$key');
  }

  Future<void> put(String key, String value) async {
    if (_db != null) {
      await _db.insert('kv', {'k': key, 'v': value}, conflictAlgorithm: ConflictAlgorithm.replace);
    } else {
      await _prefs!.setString('kv_$key', value);
    }
  }

  Future<void> clear() async {
    if (_db != null) {
      await _db.delete('kv');
    } else {
      for (final k in _prefs!.getKeys().where((k) => k.startsWith('kv_')).toList()) {
        await _prefs!.remove(k);
      }
    }
  }
}

/// Tokens live in the platform keystore (Keychain / Keystore); on web a plain store is the best available.
class SessionStore {
  static const _s = FlutterSecureStorage();

  Future<({String access, String refresh})?> read() async {
    try {
      final a = await _s.read(key: 'access');
      final r = await _s.read(key: 'refresh');
      if (a == null || r == null) return null;
      return (access: a, refresh: r);
    } catch (_) {
      return null;
    }
  }

  Future<void> write(String access, String refresh) async {
    try {
      await _s.write(key: 'access', value: access);
      await _s.write(key: 'refresh', value: refresh);
    } catch (_) {}
  }

  Future<void> clear() async {
    try {
      await _s.deleteAll();
    } catch (_) {}
  }
}
