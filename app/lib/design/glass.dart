import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'theme.dart';

/// Full-screen animated-gradient background with soft light orbs.
class GlassBackground extends StatelessWidget {
  const GlassBackground({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final p = GlassTheme.of(context).palette;
    return Stack(children: [
      Positioned.fill(
        child: DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [p.bgTop, p.bgBottom]),
          ),
        ),
      ),
      Positioned(top: -120, left: -80, child: _Orb(color: p.orbA, size: 320)),
      Positioned(bottom: -140, right: -100, child: _Orb(color: p.orbB, size: 360)),
      Positioned.fill(child: child),
    ]);
  }
}

class _Orb extends StatelessWidget {
  const _Orb({required this.color, required this.size});
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) => IgnorePointer(
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: RadialGradient(colors: [color.withValues(alpha: 0.45), color.withValues(alpha: 0)]),
          ),
        ),
      );
}

/// Frosted glass surface: backdrop blur + translucent gradient + hairline border + soft depth shadow.
class GlassCard extends StatelessWidget {
  const GlassCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.radius = 24,
    this.tint,
    this.highlight = false,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius;
  final Color? tint;
  final bool highlight; // lights up when a drag target is hovered

  @override
  Widget build(BuildContext context) {
    final t = GlassTheme.of(context);
    final p = t.palette;
    final fill = tint != null ? tint!.withValues(alpha: 0.16) : p.glassFill;
    final border = highlight ? p.accent : p.glassBorder;

    final surface = AnimatedContainer(
      duration: const Duration(milliseconds: 160),
      padding: padding,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(radius),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [fill, fill.withValues(alpha: fill.a * 0.55)],
        ),
        border: Border.all(color: border, width: highlight ? 1.6 : 0.8),
        boxShadow: [
          BoxShadow(
            color: (highlight ? p.accent : Colors.black).withValues(alpha: highlight ? 0.45 : 0.18),
            blurRadius: highlight ? 28 : 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: child,
    );

    final clipped = ClipRRect(borderRadius: BorderRadius.circular(radius), child: surface);
    if (t.reduceEffects) return clipped;
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: BackdropFilter(filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18), child: surface),
    );
  }
}

/// Press-feedback wrapper: soft scale-down + haptic tap.
class Pressable extends StatefulWidget {
  const Pressable({super.key, required this.child, this.onTap, this.onLongPress, this.semanticLabel});
  final Widget child;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final String? semanticLabel;

  @override
  State<Pressable> createState() => _PressableState();
}

class _PressableState extends State<Pressable> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: widget.semanticLabel,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: (_) => setState(() => _down = true),
        onTapCancel: () => setState(() => _down = false),
        onTapUp: (_) => setState(() => _down = false),
        onTap: widget.onTap == null
            ? null
            : () {
                HapticFeedback.selectionClick();
                widget.onTap!();
              },
        onLongPress: widget.onLongPress,
        child: AnimatedScale(
          scale: _down ? 0.96 : 1,
          duration: const Duration(milliseconds: 110),
          curve: Curves.easeOut,
          child: widget.child,
        ),
      ),
    );
  }
}

/// iOS-style bottom sheet container used by every operation form.
Future<T?> showGlassSheet<T>(BuildContext context, {required WidgetBuilder builder, bool full = false}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    barrierColor: Colors.black54,
    builder: (ctx) {
      final inset = MediaQuery.of(ctx).viewInsets.bottom;
      return Padding(
        padding: EdgeInsets.only(bottom: inset),
        child: FractionallySizedBox(
          heightFactor: full ? 0.94 : null,
          child: GlassTheme(
            palette: GlassTheme.of(context).palette,
            reduceEffects: GlassTheme.of(context).reduceEffects,
            child: GlassCard(
              radius: 28,
              padding: const EdgeInsets.fromLTRB(20, 10, 20, 20),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Container(
                  width: 40,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 12),
                  decoration: BoxDecoration(color: Colors.white38, borderRadius: BorderRadius.circular(4)),
                ),
                Flexible(child: builder(ctx)),
              ]),
            ),
          ),
        ),
      );
    },
  );
}
