// Plain data models mirroring the backend contracts.
// Amounts arrive as JSON numbers; they are used for DISPLAY only. Every financial
// calculation (balances, totals, conversion) is performed by the backend.

enum TxType { opening, income, expense, transfer, debtBorrow, debtLend, debtRepayment, debtCollection, adjustment, reversal }

TxType txTypeFrom(Object? v) {
  final i = v is int ? v : int.tryParse('$v') ?? 1;
  return TxType.values[i.clamp(0, TxType.values.length - 1)];
}

double _d(Object? v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0;
double? _dn(Object? v) => v == null ? null : _d(v);
DateTime? _dt(Object? v) => v == null ? null : DateTime.tryParse('$v')?.toLocal();

class UserProfile {
  UserProfile({required this.id, required this.email, required this.displayName, required this.locale,
      required this.defaultCurrency, required this.theme});
  final String id, email, displayName, locale, defaultCurrency, theme;
  factory UserProfile.fromJson(Map<String, dynamic> j) => UserProfile(
      id: j['id'], email: j['email'], displayName: j['displayName'] ?? '', locale: j['locale'] ?? 'uz',
      defaultCurrency: j['defaultCurrency'] ?? 'UZS', theme: j['theme'] ?? 'system');
}

class Wallet {
  Wallet({required this.id, required this.name, required this.type, required this.currency, required this.balance,
      required this.icon, required this.color, this.bankName, this.maskedNumber, this.note,
      this.allowOverdraft = false, this.isArchived = false, this.sortOrder = 0});
  final String id, name, currency, icon, color;
  final int type;
  final double balance;
  final String? bankName, maskedNumber, note;
  final bool allowOverdraft, isArchived;
  final int sortOrder;
  factory Wallet.fromJson(Map<String, dynamic> j) => Wallet(
      id: j['id'], name: j['name'], type: j['type'] ?? 0, currency: j['currency'], balance: _d(j['balance']),
      icon: j['icon'] ?? 'wallet', color: j['color'] ?? '#3B82F6', bankName: j['bankName'],
      maskedNumber: j['maskedNumber'], note: j['note'], allowOverdraft: j['allowOverdraft'] ?? false,
      isArchived: j['isArchived'] ?? false, sortOrder: j['sortOrder'] ?? 0);
}

class Category {
  Category({required this.id, required this.name, required this.icon, required this.color, this.parentId,
      this.monthlyLimit, this.limitCurrency});
  final String id, name, icon, color;
  final String? parentId, limitCurrency;
  final double? monthlyLimit;
  factory Category.fromJson(Map<String, dynamic> j) => Category(
      id: j['id'], name: j['name'], icon: j['icon'] ?? 'tag', color: j['color'] ?? '#EF4444',
      parentId: j['parentId'], monthlyLimit: _dn(j['monthlyLimit']), limitCurrency: j['limitCurrency']);
}

class IncomeSource {
  IncomeSource({required this.id, required this.name, required this.icon, required this.color});
  final String id, name, icon, color;
  factory IncomeSource.fromJson(Map<String, dynamic> j) =>
      IncomeSource(id: j['id'], name: j['name'], icon: j['icon'] ?? 'briefcase', color: j['color'] ?? '#22C55E');
}

class Person {
  Person({required this.id, required this.name, this.phone});
  final String id, name;
  final String? phone;
  factory Person.fromJson(Map<String, dynamic> j) => Person(id: j['id'], name: j['name'], phone: j['phone']);
}

class Project {
  Project({required this.id, required this.name, required this.icon, required this.color, required this.currency});
  final String id, name, icon, color, currency;
  factory Project.fromJson(Map<String, dynamic> j) => Project(
      id: j['id'], name: j['name'], icon: j['icon'] ?? 'folder', color: j['color'] ?? '#8B5CF6',
      currency: j['currency'] ?? 'UZS');
}

class Debt {
  Debt({required this.id, required this.personId, required this.direction, required this.currency,
      required this.principal, required this.outstanding, required this.status, this.dueDate, this.reason});
  final String id, personId, currency;
  final int direction; // 0 borrowed (I owe), 1 lent (owed to me)
  final double principal, outstanding;
  final int status; // 0 open, 1 settled, 2 cancelled
  final DateTime? dueDate;
  final String? reason;
  bool get iOwe => direction == 0;
  factory Debt.fromJson(Map<String, dynamic> j) => Debt(
      id: j['id'], personId: j['personId'], direction: j['direction'] ?? 0, currency: j['currency'],
      principal: _d(j['principal']), outstanding: _d(j['outstanding']), status: j['status'] ?? 0,
      dueDate: _dt(j['dueDate']), reason: j['reason']);
}

class Tx {
  Tx({required this.id, required this.type, required this.occurredAt, required this.amount, required this.currency,
      this.walletId, this.toWalletId, this.toAmount, this.toCurrency, this.categoryId, this.incomeSourceId,
      this.personId, this.projectId, this.debtId, this.reason, this.memo, this.reversedById, this.reversalOfId,
      this.pending = false});
  final String id, currency;
  final TxType type;
  final DateTime occurredAt;
  final double amount;
  final String? walletId, toWalletId, toCurrency, categoryId, incomeSourceId, personId, projectId, debtId, reason, memo,
      reversedById, reversalOfId;
  final double? toAmount;
  final bool pending; // true while only stored in the offline queue
  bool get isReversed => reversedById != null;
  factory Tx.fromJson(Map<String, dynamic> j) => Tx(
      id: j['id'], type: txTypeFrom(j['type']), occurredAt: _dt(j['occurredAt']) ?? DateTime.now(),
      amount: _d(j['amount']), currency: j['currency'], walletId: j['walletId'], toWalletId: j['toWalletId'],
      toAmount: _dn(j['toAmount']), toCurrency: j['toCurrency'], categoryId: j['categoryId'],
      incomeSourceId: j['incomeSourceId'], personId: j['personId'], projectId: j['projectId'], debtId: j['debtId'],
      reason: j['reason'], memo: j['memo'], reversedById: j['reversedById'], reversalOfId: j['reversalOfId']);
}

class CurrencyTotals {
  CurrencyTotals({required this.currency, required this.income, required this.expense, required this.netFlow,
      required this.borrowed, required this.lent});
  final String currency;
  final double income, expense, netFlow, borrowed, lent;
  factory CurrencyTotals.fromJson(Map<String, dynamic> j) => CurrencyTotals(
      currency: j['currency'], income: _d(j['income']), expense: _d(j['expense']), netFlow: _d(j['netFlow']),
      borrowed: _d(j['borrowed']), lent: _d(j['lent']));
}

class DebtPosition {
  DebtPosition({required this.currency, required this.iOwe, required this.owedToMe});
  final String currency;
  final double iOwe, owedToMe;
  factory DebtPosition.fromJson(Map<String, dynamic> j) =>
      DebtPosition(currency: j['currency'], iOwe: _d(j['iOwe']), owedToMe: _d(j['owedToMe']));
}

class Summary {
  Summary({required this.totals, required this.debts});
  final List<CurrencyTotals> totals;
  final List<DebtPosition> debts;
  factory Summary.fromJson(Map<String, dynamic> j) => Summary(
      totals: (j['totals'] as List? ?? []).map((e) => CurrencyTotals.fromJson(e)).toList(),
      debts: (j['debts'] as List? ?? []).map((e) => DebtPosition.fromJson(e)).toList());
  static Summary empty() => Summary(totals: [], debts: []);
}

class BreakdownRow {
  BreakdownRow({required this.id, required this.name, required this.currency, required this.total,
      required this.percent, required this.count});
  final String? id;
  final String name, currency;
  final double total, percent;
  final int count;
  factory BreakdownRow.fromJson(Map<String, dynamic> j) => BreakdownRow(
      id: j['id'], name: j['name'] ?? '—', currency: j['currency'], total: _d(j['total']),
      percent: _d(j['percent']), count: j['count'] ?? 0);
}

class SeriesPoint {
  SeriesPoint({required this.period, required this.currency, required this.income, required this.expense});
  final String period, currency;
  final double income, expense;
  factory SeriesPoint.fromJson(Map<String, dynamic> j) => SeriesPoint(
      period: j['period'], currency: j['currency'], income: _d(j['income']), expense: _d(j['expense']));
}

class BudgetStatus {
  BudgetStatus({required this.name, required this.currency, required this.limit, required this.spent,
      required this.percent, required this.exceeded});
  final String name, currency;
  final double limit, spent, percent;
  final bool exceeded;
  factory BudgetStatus.fromJson(Map<String, dynamic> j) => BudgetStatus(
      name: j['name'], currency: j['currency'], limit: _d(j['limit']), spent: _d(j['spent']),
      percent: _d(j['percent']), exceeded: j['exceeded'] ?? false);
}

/// A money operation waiting for the server (offline queue entry).
class PendingOp {
  PendingOp({required this.clientOperationId, required this.kind, required this.payload, this.targetId,
      required this.createdAt, this.error});
  final String clientOperationId, kind;
  final Map<String, dynamic> payload;
  final String? targetId, error;
  final DateTime createdAt;

  Map<String, dynamic> toJson() => {
        'clientOperationId': clientOperationId, 'kind': kind, 'payload': payload, 'targetId': targetId,
        'createdAt': createdAt.toIso8601String(), 'error': error,
      };
  factory PendingOp.fromJson(Map<String, dynamic> j) => PendingOp(
      clientOperationId: j['clientOperationId'], kind: j['kind'], payload: Map<String, dynamic>.from(j['payload']),
      targetId: j['targetId'], createdAt: DateTime.parse(j['createdAt']), error: j['error']);
  PendingOp withError(String? e) => PendingOp(
      clientOperationId: clientOperationId, kind: kind, payload: payload, targetId: targetId,
      createdAt: createdAt, error: e);
}
