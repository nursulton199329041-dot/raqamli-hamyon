using System;
using System.Diagnostics;
using Avalonia;
using Avalonia.Logging;

namespace Hamyon.App.Desktop;

sealed class Program
{
    // Initialization code. Don't use any Avalonia, third-party APIs or any
    // SynchronizationContext-reliant code before AppMain is called: things aren't initialized
    // yet and stuff might break.
    [STAThread]
    public static void Main(string[] args)
    {
        // HAMYON_TRACE=path writes binding / layout warnings to a file (diagnostics on the desktop build)
        if (Environment.GetEnvironmentVariable("HAMYON_TRACE") is { Length: > 0 } trace)
        {
            Trace.Listeners.Add(new TextWriterTraceListener(trace));
            Trace.AutoFlush = true;
        }
        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    // Avalonia configuration, don't remove; also used by visual designer.
    public static AppBuilder BuildAvaloniaApp()
        => AppBuilder.Configure<App>()
            .UsePlatformDetect()
            .WithInterFont()
            .LogToTrace(LogEventLevel.Warning);
}
