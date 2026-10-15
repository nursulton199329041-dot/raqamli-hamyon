using FluentValidation;
using Hamyon.Api.Contracts;
using Hamyon.Domain;

namespace Hamyon.Api.Validation;

public sealed class RegisterValidator : AbstractValidator<RegisterRequest>
{
    public RegisterValidator()
    {
        RuleFor(x => x.Email).NotEmpty().MaximumLength(254).EmailAddress();
        RuleFor(x => x.Password).NotEmpty().MinimumLength(8).MaximumLength(128);
        RuleFor(x => x.DisplayName).NotEmpty().MaximumLength(100);
    }
}

public sealed class LoginValidator : AbstractValidator<LoginRequest>
{
    public LoginValidator()
    {
        RuleFor(x => x.Email).NotEmpty().MaximumLength(254);
        RuleFor(x => x.Password).NotEmpty().MaximumLength(128);
    }
}

public sealed class WalletValidator : AbstractValidator<WalletRequest>
{
    public WalletValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(80);
        RuleFor(x => x.Currency).Must(c => Currencies.IsSupported(c)).WithMessage("Unsupported currency.");
        RuleFor(x => x.Color).Matches("^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$").When(x => x.Color is not null);
        RuleFor(x => x.MaskedNumber).MaximumLength(24).When(x => x.MaskedNumber is not null);
        // Guard against users pasting a full card number: only masked/last digits are accepted.
        RuleFor(x => x.MaskedNumber).Must(m => m!.Count(char.IsDigit) <= 6)
            .When(x => x.MaskedNumber is not null)
            .WithMessage("Store only the masked identifier (last digits), never the full card number.");
    }
}

public sealed class IncomeValidator : AbstractValidator<IncomeRequest>
{
    public IncomeValidator()
    {
        RuleFor(x => x.Amount).GreaterThan(0);
        RuleFor(x => x.Memo).MaximumLength(1000);
        RuleFor(x => x.Reason).MaximumLength(200);
        RuleFor(x => x.ClientKey).MaximumLength(100);
    }
}

public sealed class ExpenseValidator : AbstractValidator<ExpenseRequest>
{
    public ExpenseValidator()
    {
        RuleFor(x => x.Amount).GreaterThan(0);
        RuleFor(x => x.Memo).MaximumLength(1000);
        RuleFor(x => x.ClientKey).MaximumLength(100);
    }
}

public sealed class TransferValidator : AbstractValidator<TransferRequest>
{
    public TransferValidator()
    {
        RuleFor(x => x.Amount).GreaterThan(0);
        RuleFor(x => x.ToAmount).GreaterThan(0).When(x => x.ToAmount is not null);
        RuleFor(x => x.FxRate).GreaterThan(0).When(x => x.FxRate is not null);
        RuleFor(x => x.Memo).MaximumLength(1000);
        RuleFor(x => x.ClientKey).MaximumLength(100);
    }
}

public sealed class DebtValidator : AbstractValidator<DebtRequest>
{
    public DebtValidator()
    {
        RuleFor(x => x.Amount).GreaterThan(0);
        RuleFor(x => x.PersonName).MaximumLength(100);
        RuleFor(x => x.Memo).MaximumLength(1000);
        RuleFor(x => x).Must(x => x.PersonId is not null || !string.IsNullOrWhiteSpace(x.PersonName))
            .WithMessage("Person is required.");
    }
}

public sealed class RepayValidator : AbstractValidator<RepayRequest>
{
    public RepayValidator()
    {
        RuleFor(x => x.Amount).GreaterThan(0);
        RuleFor(x => x.Memo).MaximumLength(1000);
    }
}
