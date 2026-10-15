import 'package:flutter/material.dart';

/// Semantic colours of the finance domain; used moderately.
class Ink {
  static const income = Color(0xFF22C55E);
  static const expense = Color(0xFFFF6B6B);
  static const transfer = Color(0xFF3B82F6);
  static const debt = Color(0xFFF59E0B);
}

Color parseHex(String hex, [Color fallback = const Color(0xFF3B82F6)]) {
  var h = hex.replaceAll('#', '');
  if (h.length == 6) h = 'FF$h';
  final v = int.tryParse(h, radix: 16);
  return v == null ? fallback : Color(v);
}

class GlassPalette {
  const GlassPalette({
    required this.bgTop,
    required this.bgBottom,
    required this.glassFill,
    required this.glassBorder,
    required this.textPrimary,
    required this.textSecondary,
    required this.accent,
    required this.orbA,
    required this.orbB,
  });

  final Color bgTop, bgBottom, glassFill, glassBorder, textPrimary, textSecondary, accent, orbA, orbB;

  static const dark = GlassPalette(
    bgTop: Color(0xFF050B1A),
    bgBottom: Color(0xFF0B1B3A),
    glassFill: Color(0x1AFFFFFF),
    glassBorder: Color(0x33FFFFFF),
    textPrimary: Color(0xFFF4F7FF),
    textSecondary: Color(0xFFA9B6D3),
    accent: Color(0xFF6EA8FF),
    orbA: Color(0xFF2F6BFF),
    orbB: Color(0xFF8FA8D6),
  );

  static const light = GlassPalette(
    bgTop: Color(0xFFF4F6FB),
    bgBottom: Color(0xFFDCE4F2),
    glassFill: Color(0xB3FFFFFF),
    glassBorder: Color(0x99FFFFFF),
    textPrimary: Color(0xFF0E1630),
    textSecondary: Color(0xFF55627D),
    accent: Color(0xFF2563EB),
    orbA: Color(0xFF9DB8FF),
    orbB: Color(0xFFBFD0EE),
  );
}

/// Inherited access to the active palette + performance flag (low-end devices skip backdrop blur).
class GlassTheme extends InheritedWidget {
  const GlassTheme({super.key, required this.palette, required this.reduceEffects, required super.child});

  final GlassPalette palette;
  final bool reduceEffects;

  static GlassTheme of(BuildContext c) => c.dependOnInheritedWidgetOfExactType<GlassTheme>()!;

  @override
  bool updateShouldNotify(GlassTheme old) => palette != old.palette || reduceEffects != old.reduceEffects;
}

ThemeData buildMaterialTheme(GlassPalette p, Brightness b) {
  final scheme = ColorScheme.fromSeed(seedColor: p.accent, brightness: b).copyWith(
    surface: Colors.transparent,
    primary: p.accent,
  );
  return ThemeData(
    useMaterial3: true,
    brightness: b,
    colorScheme: scheme,
    scaffoldBackgroundColor: Colors.transparent,
    canvasColor: Colors.transparent,
    textTheme: Typography.material2021(platform: TargetPlatform.android)
        .black
        .apply(bodyColor: p.textPrimary, displayColor: p.textPrimary),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: p.glassFill,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide(color: p.glassBorder)),
      enabledBorder:
          OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide(color: p.glassBorder)),
      labelStyle: TextStyle(color: p.textSecondary),
    ),
    snackBarTheme: SnackBarThemeData(behavior: SnackBarBehavior.floating, backgroundColor: p.bgBottom),
  );
}
