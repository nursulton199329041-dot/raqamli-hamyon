namespace Hamyon.Domain;

/// <summary>
/// Supported currencies and their rounding rules. Money is always <see cref="decimal"/>; amounts of
/// different currencies are never added together – callers group by currency.
/// </summary>
public static class Currencies
{
    private static readonly Dictionary<string, int> Decimals = new(StringComparer.OrdinalIgnoreCase)
    {
        ["UZS"] = 2, ["USD"] = 2, ["EUR"] = 2, ["RUB"] = 2, ["KZT"] = 2, ["GBP"] = 2, ["TRY"] = 2, ["CNY"] = 2,
    };

    public const decimal MaxAmount = 9_999_999_999_999m; // < 1e13, fits numeric(19,4)
    public const int RateScale = 8;

    public static IReadOnlyCollection<string> Supported => Decimals.Keys;

    public static bool IsSupported(string? code) => code is not null && Decimals.ContainsKey(code);

    public static string Normalize(string code) => code.Trim().ToUpperInvariant();

    public static int DecimalsOf(string code) =>
        Decimals.TryGetValue(code, out var d) ? d : throw new DomainException("currency.unsupported", $"Unsupported currency '{code}'.");

    /// <summary>Validates that an amount is positive, within range and has no more fraction digits than the currency allows.</summary>
    public static void ValidateAmount(decimal amount, string currency, string field = "amount")
    {
        if (amount <= 0) throw new DomainException("amount.not_positive", $"{field} must be greater than zero.");
        if (amount > MaxAmount) throw new DomainException("amount.too_large", $"{field} is too large.");
        var scale = DecimalsOf(currency);
        if (decimal.Round(amount, scale, MidpointRounding.ToZero) != amount)
            throw new DomainException("amount.precision", $"{field} has more than {scale} fraction digits for {currency}.");
    }

    /// <summary>Converts using a user supplied rate (to = from × rate), rounded half away from zero to the target currency scale.</summary>
    public static decimal Convert(decimal amount, decimal rate, string toCurrency)
    {
        if (rate <= 0) throw new DomainException("fx.rate_invalid", "Exchange rate must be greater than zero.");
        var result = decimal.Round(amount * rate, DecimalsOf(toCurrency), MidpointRounding.AwayFromZero);
        if (result <= 0) throw new DomainException("fx.result_zero", "Converted amount rounds to zero.");
        return result;
    }
}

public class DomainException : Exception
{
    public string Code { get; }
    public int Status { get; }

    public DomainException(string code, string message, int status = 400) : base(message)
    {
        Code = code;
        Status = status;
    }
}

public sealed class InsufficientFundsException : DomainException
{
    public InsufficientFundsException(string walletName)
        : base("wallet.insufficient_funds", $"Insufficient funds in '{walletName}'.", 422) { }
}

public sealed class NotFoundException : DomainException
{
    public NotFoundException(string what) : base("not_found", $"{what} not found.", 404) { }
}
