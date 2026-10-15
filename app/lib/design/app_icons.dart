import 'package:flutter/material.dart';

import 'theme.dart';

/// The single icon vocabulary of the app. Wallet / category / source / project icon pickers use these keys,
/// and the backend stores just the key string.
class AppIcons {
  static const Map<String, IconData> glyphs = {
    'wallet': Icons.account_balance_wallet_rounded,
    'card': Icons.credit_card_rounded,
    'cash': Icons.payments_rounded,
    'car': Icons.directions_car_filled_rounded,
    'home': Icons.home_rounded,
    'utilities': Icons.bolt_rounded,
    'transport': Icons.commute_rounded,
    'food': Icons.restaurant_rounded,
    'salary': Icons.work_rounded,
    'business': Icons.storefront_rounded,
    'project': Icons.folder_special_rounded,
    'folder': Icons.folder_rounded,
    'equipment': Icons.devices_other_rounded,
    'phone': Icons.phone_iphone_rounded,
    'debt': Icons.swap_horiz_rounded,
    'investment': Icons.trending_up_rounded,
    'savings': Icons.savings_rounded,
    'staff': Icons.groups_rounded,
    'repair': Icons.build_rounded,
    'fun': Icons.celebration_rounded,
    'briefcase': Icons.business_center_rounded,
    'tag': Icons.sell_rounded,
    'other': Icons.category_rounded,
  };

  static IconData of(String key) => glyphs[key] ?? Icons.category_rounded;
}

/// Unified icon badge: tinted glass squircle with a soft inner gradient.
class AppIcon extends StatelessWidget {
  const AppIcon(this.keyName, {super.key, this.color, this.size = 44});
  final String keyName;
  final Color? color;
  final double size;

  @override
  Widget build(BuildContext context) {
    final c = color ?? GlassTheme.of(context).palette.accent;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(size * 0.34),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [c.withValues(alpha: 0.95), c.withValues(alpha: 0.55)],
        ),
        boxShadow: [BoxShadow(color: c.withValues(alpha: 0.35), blurRadius: 12, offset: const Offset(0, 4))],
        border: Border.all(color: Colors.white.withValues(alpha: 0.35), width: 0.8),
      ),
      child: Icon(AppIcons.of(keyName), color: Colors.white, size: size * 0.52),
    );
  }
}
