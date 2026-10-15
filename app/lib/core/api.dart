import 'dart:convert';

import 'package:http/http.dart' as http;

import 'models.dart';

class ApiException implements Exception {
  ApiException(this.status, this.code, this.message);
  final int status;
  final String code, message;
  bool get isNetwork => status == 0;
  @override
  String toString() => message;
}

/// Thin typed client over the REST API. Holds tokens in memory; persistence is done by [SessionStore].
class ApiClient {
  ApiClient({required this.baseUrl, http.Client? client}) : _http = client ?? http.Client();

  final String baseUrl;
  final http.Client _http;
  String? accessToken;
  String? refreshToken;

  /// Called when a refresh succeeds so the app can persist the rotated tokens.
  void Function(String access, String refresh)? onTokens;
  void Function()? onSessionExpired;

  Uri _u(String path, [Map<String, String?>? q]) {
    final clean = <String, String>{};
    q?.forEach((k, v) {
      if (v != null && v.isNotEmpty) clean[k] = v;
    });
    final trimmed = path.length > 1 && path.endsWith('/') ? path.substring(0, path.length - 1) : path;
    return Uri.parse('$baseUrl$trimmed').replace(queryParameters: clean.isEmpty ? null : clean);
  }

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (accessToken != null) 'Authorization': 'Bearer $accessToken',
      };

  Future<dynamic> _send(Future<http.Response> Function() call, {bool retry = true}) async {
    http.Response res;
    try {
      res = await call().timeout(const Duration(seconds: 20));
    } catch (_) {
      throw ApiException(0, 'network', 'Server bilan aloqa yo\'q');
    }
    if (res.statusCode == 401 && retry && refreshToken != null) {
      if (await _refresh()) return _send(call, retry: false);
      onSessionExpired?.call();
    }
    if (res.statusCode >= 200 && res.statusCode < 300) {
      if (res.body.isEmpty) return null;
      return jsonDecode(utf8.decode(res.bodyBytes));
    }
    String code = 'error', message = 'Xatolik (${res.statusCode})';
    try {
      final j = jsonDecode(utf8.decode(res.bodyBytes));
      code = j['code'] ?? code;
      message = j['message'] ?? message;
    } catch (_) {}
    throw ApiException(res.statusCode, code, message);
  }

  Future<bool> _refresh() async {
    try {
      final res = await _http.post(_u('/api/auth/refresh'),
          headers: {'Content-Type': 'application/json'}, body: jsonEncode({'refreshToken': refreshToken}));
      if (res.statusCode != 200) return false;
      final j = jsonDecode(res.body);
      accessToken = j['accessToken'];
      refreshToken = j['refreshToken'];
      onTokens?.call(accessToken!, refreshToken!);
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<dynamic> get(String path, [Map<String, String?>? q]) =>
      _send(() => _http.get(_u(path, q), headers: _headers));

  Future<dynamic> post(String path, Object? body, {String? idempotencyKey}) => _send(() => _http.post(_u(path),
      headers: {..._headers, if (idempotencyKey != null) 'Idempotency-Key': idempotencyKey},
      body: jsonEncode(body ?? {})));

  Future<dynamic> put(String path, Object? body) =>
      _send(() => _http.put(_u(path), headers: _headers, body: jsonEncode(body)));

  Future<dynamic> patch(String path, Object? body) =>
      _send(() => _http.patch(_u(path), headers: _headers, body: jsonEncode(body)));

  Future<dynamic> delete(String path) => _send(() => _http.delete(_u(path), headers: _headers));

  Future<List<int>> download(String path, [Map<String, String?>? q]) async {
    try {
      final res = await _http.get(_u(path, q), headers: _headers).timeout(const Duration(seconds: 60));
      if (res.statusCode != 200) throw ApiException(res.statusCode, 'download', 'Yuklab bo\'lmadi');
      return res.bodyBytes;
    } on ApiException {
      rethrow;
    } catch (_) {
      throw ApiException(0, 'network', 'Server bilan aloqa yo\'q');
    }
  }

  // ---- auth
  Future<UserProfile> register(String email, String password, String name, String locale) async {
    final j = await post('/api/auth/register',
        {'email': email, 'password': password, 'displayName': name, 'locale': locale});
    return _adopt(j);
  }

  Future<UserProfile> login(String email, String password) async {
    final j = await post('/api/auth/login', {'email': email, 'password': password});
    return _adopt(j);
  }

  UserProfile _adopt(dynamic j) {
    accessToken = j['accessToken'];
    refreshToken = j['refreshToken'];
    onTokens?.call(accessToken!, refreshToken!);
    return UserProfile.fromJson(j['user']);
  }

  Future<void> logout() async {
    final t = refreshToken;
    if (t != null) {
      try {
        await post('/api/auth/logout', {'refreshToken': t});
      } catch (_) {}
    }
    accessToken = null;
    refreshToken = null;
  }
}
