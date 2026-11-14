using System;
using Avalonia;
using Avalonia.Controls;

namespace Hamyon.App.Views;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        // HAMYON_PHONE=1 (desktop, store screenshots): a window with the phone's shape (440x956 = 1320x2868 / 3)
        if (Environment.GetEnvironmentVariable("HAMYON_PHONE") == "1")
        {
            Width = 440;
            Height = 956;
            Position = new PixelPoint(0, 0);
        }
    }
}
