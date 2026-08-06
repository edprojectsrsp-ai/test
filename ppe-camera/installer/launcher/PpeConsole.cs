// Desktop launcher for the PPE control room.
//
// The shortcut used to point straight at the hosted dashboard URL, so clicking
// it opened a browser tab against the cloud. That is wrong twice over: it needs
// internet on a product whose whole claim is that it runs offline, and it shows
// the fleet dashboard rather than THIS PC's agent.
//
// This opens the console the machine is already serving on loopback, in a
// browser "app" window -- no address bar, no tabs, its own taskbar button and
// icon. To an operator that is a desktop application; there is just no reason
// to ship a second rendering engine to achieve it.
//
// Built as /target:winexe deliberately: a console subsystem binary flashes a
// black window on every launch, which is exactly the sort of detail that makes
// software feel unfinished.
//
// Usage:  PpeConsole.exe [port] [path]      (defaults: 3000 /ppe/)

using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

internal static class PpeConsole
{
    private const string Host = "127.0.0.1";

    private static int Main(string[] args)
    {
        int port = 3000;
        if (args.Length > 0)
        {
            int parsed;
            if (int.TryParse(args[0], out parsed) && parsed > 0 && parsed < 65536)
                port = parsed;
        }
        string path = args.Length > 1 ? args[1] : "/ppe/";
        if (!path.StartsWith("/")) path = "/" + path;

        string url = "http://" + Host + ":" + port + path;

        // Both services are auto-start, so a click seconds after boot can beat
        // the console service to the port. Waiting beats showing the operator a
        // connection error for something that was about to work.
        if (!WaitForPort(Host, port, TimeSpan.FromSeconds(45)))
        {
            var answer = MessageBox.Show(
                "The PPE console is not responding on " + Host + ":" + port + ".\r\n\r\n" +
                "It runs as the Windows service \"PPEConsole\", which may still be " +
                "starting.\r\n\r\nOpen it anyway?",
                "PPE Control Room",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning);
            if (answer != DialogResult.Yes) return 1;
        }

        if (LaunchAppWindow(url)) return 0;

        // No Chromium-based browser: fall back to whatever handles http. A
        // normal tab is worse than an app window, but far better than nothing.
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            return 0;
        }
        catch (Exception ex)
        {
            MessageBox.Show("Could not open " + url + "\r\n\r\n" + ex.Message,
                "PPE Control Room", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 2;
        }
    }

    private static bool WaitForPort(string host, int port, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                using (var c = new TcpClient())
                {
                    var ar = c.BeginConnect(host, port, null, null);
                    if (ar.AsyncWaitHandle.WaitOne(TimeSpan.FromMilliseconds(700)) && c.Connected)
                    {
                        c.EndConnect(ar);
                        return true;
                    }
                }
            }
            catch { /* not up yet */ }
            Thread.Sleep(400);
        }
        return false;
    }

    private static bool LaunchAppWindow(string url)
    {
        foreach (string exe in BrowserCandidates())
        {
            if (string.IsNullOrEmpty(exe) || !File.Exists(exe)) continue;
            try
            {
                // --app strips the tab strip and omnibox and gives the window
                // its own taskbar identity.
                var psi = new ProcessStartInfo(exe, "--app=" + url + " --window-size=1440,900")
                {
                    UseShellExecute = false
                };
                Process.Start(psi);
                return true;
            }
            catch { /* try the next one */ }
        }
        return false;
    }

    private static string[] BrowserCandidates()
    {
        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return new[]
        {
            Path.Combine(pf,    @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(pf86,  @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(pf,    @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(pf86,  @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(local, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(pf,    @"BraveSoftware\Brave-Browser\Application\brave.exe"),
        };
    }
}
