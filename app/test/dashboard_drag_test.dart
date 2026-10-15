import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:raqamli_hamyon/core/models.dart';
import 'package:raqamli_hamyon/design/theme.dart';
import 'package:raqamli_hamyon/features/dashboard/dashboard_page.dart';
import 'package:raqamli_hamyon/features/ops/operation_sheet.dart';
import 'package:raqamli_hamyon/state/app_state.dart';

class _FakeData extends DataNotifier {
  @override
  DataState build() => DataState(
        loaded: true,
        wallets: [
          Wallet(id: 'w1', name: 'Spark 4775', type: 1, currency: 'UZS', balance: 1000000, icon: 'car', color: '#0EA5E9'),
          Wallet(id: 'w2', name: 'Nexia 3', type: 4, currency: 'UZS', balance: 500000, icon: 'car', color: '#F59E0B'),
        ],
        categories: [Category(id: 'c1', name: 'Kommunal', icon: 'utilities', color: '#14B8A6')],
        sources: [IncomeSource(id: 's1', name: 'Biznes', icon: 'business', color: '#16A34A')],
      );
}

Widget _app() => ProviderScope(
      overrides: [dataProvider.overrideWith(_FakeData.new)],
      child: MaterialApp(
        home: GlassTheme(
          palette: GlassPalette.dark,
          reduceEffects: true,
          child: const Scaffold(body: DashboardPage()),
        ),
      ),
    );

Future<void> _drag(WidgetTester t, Finder from, Finder to) async {
  final g = await t.startGesture(t.getCenter(from));
  await t.pump(const Duration(milliseconds: 700)); // long press starts the drag
  await g.moveTo(t.getCenter(to));
  await t.pump(const Duration(milliseconds: 100));
  await g.up();
  await t.pumpAndSettle();
}

void main() {
  testWidgets('wallet dropped on category opens expense form with both prefilled', (t) async {
    await t.pumpWidget(_app());
    await t.pumpAndSettle();
    await _drag(t, find.text('Spark 4775'), find.text('Kommunal'));

    final form = t.widget<OperationForm>(find.byType(OperationForm));
    expect(form.prefill.kind, OpKind.expense);
    expect(form.prefill.walletId, 'w1');
    expect(form.prefill.categoryId, 'c1');
  });

  testWidgets('wallet dropped on another wallet opens transfer form', (t) async {
    await t.pumpWidget(_app());
    await t.pumpAndSettle();
    await _drag(t, find.text('Spark 4775'), find.text('Nexia 3'));

    final form = t.widget<OperationForm>(find.byType(OperationForm));
    expect(form.prefill.kind, OpKind.transfer);
    expect(form.prefill.walletId, 'w1');
    expect(form.prefill.toWalletId, 'w2');
  });

  testWidgets('income source dropped on wallet opens income form', (t) async {
    await t.pumpWidget(_app());
    await t.pumpAndSettle();
    await _drag(t, find.text('Biznes'), find.text('Nexia 3'));

    final form = t.widget<OperationForm>(find.byType(OperationForm));
    expect(form.prefill.kind, OpKind.income);
    expect(form.prefill.walletId, 'w2');
    expect(form.prefill.sourceId, 's1');
  });

  testWidgets('dropping a wallet on itself does nothing', (t) async {
    await t.pumpWidget(_app());
    await t.pumpAndSettle();
    final w = find.text('Spark 4775');
    final g = await t.startGesture(t.getCenter(w));
    await t.pump(const Duration(milliseconds: 700));
    await g.moveBy(const Offset(4, 4));
    await g.up();
    await t.pumpAndSettle();
    expect(find.byType(OperationForm), findsNothing);
  });

  testWidgets('dropping on empty space cancels without any form', (t) async {
    await t.pumpWidget(_app());
    await t.pumpAndSettle();
    final g = await t.startGesture(t.getCenter(find.text('Spark 4775')));
    await t.pump(const Duration(milliseconds: 700));
    await g.moveTo(const Offset(5, 5));
    await g.up();
    await t.pumpAndSettle();
    expect(find.byType(OperationForm), findsNothing);
  });
}
