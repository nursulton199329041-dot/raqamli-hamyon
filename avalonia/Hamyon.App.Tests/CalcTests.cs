using Hamyon.App.Models;
using Xunit;

namespace Hamyon.App.Tests;

public class CalcTests
{
    [Theory]
    [InlineData("150000+25000", "175000")]
    [InlineData("2+3×4", "14")]
    [InlineData("10÷4", "2.5")]
    [InlineData("100−30−20", "50")]
    [InlineData("12,5×4", "50")]
    [InlineData("10÷3", "3.33")]
    [InlineData("2÷3", "0.67")]
    [InlineData("150000+", "150000")] // trailing operator while typing
    [InlineData("0,1+0,2", "0.3")]   // no floating point error
    public void Evaluates_with_precedence_and_rounding(string expr, string expected) =>
        Assert.Equal(decimal.Parse(expected, System.Globalization.CultureInfo.InvariantCulture), Calc.Evaluate(expr));

    [Theory]
    [InlineData("")]
    [InlineData("5÷0")]
    [InlineData("+5")]
    public void Invalid_or_empty_is_null(string expr) => Assert.Null(Calc.Evaluate(expr));

    [Fact]
    public void Keypad_builds_expressions()
    {
        var e = "";
        foreach (var k in new[] { "1", "5", "000", "0", "+", "×", "2", "5", "000" }) e = Calc.Press(e, k);
        Assert.Equal("150000×25000", e); // second operator replaced the first
        Assert.Equal("150000×2500", Calc.Press(e, "⌫"));
        Assert.Equal("", Calc.Press(e, "C"));
    }

    [Fact]
    public void Keypad_limits_decimals_and_leading_zeros()
    {
        var e = "";
        foreach (var k in new[] { ",", "5", "5", "5" }) e = Calc.Press(e, k);
        Assert.Equal("0,55", e);
        Assert.Equal("0,55", Calc.Press(e, ","));
        Assert.Equal("7", Calc.Press("0", "7"));
        Assert.Equal("", Calc.Press("", "+"));
    }

    [Fact]
    public void Equals_replaces_expression_with_result() => Assert.Equal("175000", Calc.Press("150000+25000", "="));
}
