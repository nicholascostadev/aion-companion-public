using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

// Permanent entry point for shortcuts. Builds are published into immutable folders
// so compiling an update never overwrites or stops a running capture.
internal static class Launcher
{
    private static string ReadOptional(string path)
    {
        return File.Exists(path) ? File.ReadAllText(path).Trim() : "";
    }

    private static bool Development(string root)
    {
        return ReadOptional(Path.Combine(root, "channel.txt")) == "development";
    }

    private static bool Owned(string path, string root, string workspace)
    {
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        foreach (string folder in new[] { root, Path.Combine(local, "AionCompanion"), Path.Combine(local, "AionCompanionDev") })
        {
            string versions = Path.GetFullPath(Path.Combine(folder, "versions")) + Path.DirectorySeparatorChar;
            if (path.StartsWith(versions, StringComparison.OrdinalIgnoreCase)) return true;
        }
        string dev = ReadOptional(Path.Combine(local, "AionCompanionDev", "dev-executable.txt"));
        if (String.Equals(path, dev, StringComparison.OrdinalIgnoreCase)) return true;
        return !String.IsNullOrEmpty(workspace) && (
            String.Equals(path, Path.Combine(workspace, @"target\debug\aion-companion.exe"), StringComparison.OrdinalIgnoreCase)
            || String.Equals(path, Path.Combine(workspace, @"target\live\debug\aion-companion.exe"), StringComparison.OrdinalIgnoreCase));
    }
    private delegate bool WindowCallback(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr window, StringBuilder text, int length);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    private static IntPtr Workspace(int processId)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr data) {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != processId) return true;
            var title = new StringBuilder(256);
            GetWindowTextW(window, title, title.Capacity);
            if (title.ToString().StartsWith("Aion Companion", StringComparison.Ordinal)
                && title.ToString().EndsWith("Combat workspace", StringComparison.Ordinal))
            {
                found = window;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    private static string Hash(string path)
    {
        using (var input = File.OpenRead(path))
        using (var hash = SHA256.Create())
            return BitConverter.ToString(hash.ComputeHash(input)).Replace("-", "").ToLowerInvariant();
    }

    private static string UpdateExecutable(string root, string checksum)
    {
        if (checksum.Length != 64) throw new IOException("Invalid update checksum.");
        foreach (char character in checksum)
            if (!(character >= '0' && character <= '9') && !(character >= 'a' && character <= 'f'))
                throw new IOException("Invalid update checksum.");
        string path = Path.Combine(root, "versions", checksum, "aion-companion.exe");
        if (!File.Exists(path) || Hash(path) != checksum)
            throw new IOException("The downloaded update failed verification. The previous app is unchanged.");
        return path;
    }

    private static void PublishPointer(string root, string value)
    {
        PublishText(root, "current.txt", value);
    }

    private static void PublishText(string root, string name, string value)
    {
        string pointer = Path.Combine(root, name);
        string temporary = Path.Combine(root, Guid.NewGuid().ToString("N") + ".tmp");
        File.WriteAllText(temporary, value);
        if (File.Exists(pointer)) File.Replace(temporary, pointer, null);
        else File.Move(temporary, pointer);
    }

    private static bool PlainDirectory(string path)
    {
        for (var directory = new DirectoryInfo(path); directory != null; directory = directory.Parent)
            if (!directory.Exists || (directory.Attributes & FileAttributes.ReparsePoint) != 0) return false;
        return true;
    }

    private static string VersionPath(string root, string pointer)
    {
        if (!Regex.IsMatch(pointer, @"\Aversions\\[a-f0-9]{64}\\aion-companion\.exe\z")) return null;
        string path = Path.Combine(root, pointer);
        if (!PlainDirectory(Path.GetDirectoryName(path)) || !File.Exists(path)
            || (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) return null;
        return path;
    }

    private static bool VerifiedVersion(string root, string pointer)
    {
        try
        {
            string path = VersionPath(root, pointer);
            return path != null && Hash(path) == new DirectoryInfo(Path.GetDirectoryName(path)).Name;
        }
        catch { return false; }
    }

    // Never recursively delete: only recognized, direct app files in plain folders
    // qualify. Unknown files, subdirectories, links and locked files are preserved.
    private static void RemoveOwnedFolder(string folder, string executable)
    {
        try
        {
            if (!PlainDirectory(folder) || Directory.GetDirectories(folder).Length != 0) return;
            string[] files = Directory.GetFiles(folder);
            foreach (string file in files)
            {
                string name = Path.GetFileName(file);
                if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0
                    || (name != executable && name != "THIRD_PARTY_NOTICES.txt"
                    && !Regex.IsMatch(name, @"\A(?:[a-f0-9]{32}|[0-9]+)\.tmp\z"))) return;
            }
            foreach (string file in files) File.Delete(file);
            Directory.Delete(folder, false);
        }
        catch (IOException) { } // A locked leftover can be retried on the next launch.
        catch (UnauthorizedAccessException) { }
    }

    private static long InstalledBytes(string root)
    {
        long bytes = 0;
        foreach (string file in Directory.GetFiles(root))
            if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) == 0) bytes += new FileInfo(file).Length;
        foreach (string directory in Directory.GetDirectories(root))
            if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) == 0) bytes += InstalledBytes(directory);
        return bytes;
    }

    // Call while holding the launch gate. Idle detection also protects a download
    // staged by a running app, including one started directly rather than by us.
    private static void MaintainInstallation(string root, string previous)
    {
        if (!Path.IsPathRooted(root) || !PlainDirectory(root)
            || ReadOptional(Path.Combine(root, "channel.txt")) != "stable")
            throw new IOException("Maintenance requires a plain stable installation folder.");
        if (InstallationIdle(root) != 0) throw new IOException("The installation is busy.");
        string current = ReadOptional(Path.Combine(root, "current.txt"));
        if (!VerifiedVersion(root, current)) throw new IOException("The active build failed verification.");
        string versions = Path.Combine(root, "versions");
        var folders = new List<DirectoryInfo>(new DirectoryInfo(versions).GetDirectories());
        folders.Sort(delegate(DirectoryInfo left, DirectoryInfo right) { return right.LastWriteTimeUtc.CompareTo(left.LastWriteTimeUtc); });
        string fallback = previous ?? ReadOptional(Path.Combine(root, "previous.txt"));
        if (fallback == current || !VerifiedVersion(root, fallback))
        {
            fallback = "";
            foreach (var folder in folders)
            {
                string candidate = Path.Combine("versions", folder.Name, "aion-companion.exe");
                if (candidate != current && VerifiedVersion(root, candidate)) { fallback = candidate; break; }
            }
        }
        // Keep the selected fallback stable across retries, even if newer stray
        // folders exist from failed or abandoned downloads.
        PublishText(root, "previous.txt", fallback);
        foreach (var folder in folders)
        {
            if (!Regex.IsMatch(folder.Name, @"\A[a-f0-9]{64}\z")) continue;
            string pointer = Path.Combine("versions", folder.Name, "aion-companion.exe");
            if (pointer != current && pointer != fallback) RemoveOwnedFolder(folder.FullName, "aion-companion.exe");
        }
        string updates = Path.Combine(root, "updates");
        if (Directory.Exists(updates) && PlainDirectory(updates))
            foreach (string folder in Directory.GetDirectories(updates))
            {
                var match = Regex.Match(Path.GetFileName(folder), @"\A([0-9]+\.[0-9]+\.[0-9]+)-[0-9]+\z");
                if (match.Success) RemoveOwnedFolder(folder, "AionCompanion-" + match.Groups[1].Value + "-windows-x64.exe");
            }
        RefreshInstalledVersion(root, VersionPath(root, current));
    }

    private static void TryMaintainInstallation(string root, string previous)
    {
        try { MaintainInstallation(root, previous); }
        catch { } // Maintenance failure must never block capture or roll back an update.
    }

    private static void RefreshInstalledVersion(string root, string executable)
    {
        // Update Apps & features after an in-app upgrade, only for this exact root.
        // Registration trouble must never interrupt a saved capture or app launch.
        try
        {
            using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\AionCompanion", true))
            {
                if (key == null) return;
                string registered = key.GetValue("InstallLocation") as string;
                if (String.IsNullOrEmpty(registered) || !String.Equals(
                    Path.GetFullPath(registered).TrimEnd(Path.DirectorySeparatorChar),
                    Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase)) return;
                string version = FileVersionInfo.GetVersionInfo(executable).ProductVersion;
                Version parsed;
                if (Version.TryParse(version, out parsed)) key.SetValue("DisplayVersion", version, RegistryValueKind.String);
                long kib = Math.Min(Int32.MaxValue, (InstalledBytes(root) + 1023) / 1024);
                key.SetValue("EstimatedSize", (int)kib, RegistryValueKind.DWord);
            }
        }
        catch { } // The app remains usable even if local registration cannot be updated.
    }

    // This separate process waits until capture has been saved and the old app exits.
    // It never replaces an executable that is still running.
    private static int ApplyUpdate(string root, string checksum, string parentId)
    {
        if (Development(root)) throw new IOException("Release updates belong to the stable app. Development is built from its checkout.");
        string executable = UpdateExecutable(root, checksum);
        int parent;
        if (!Int32.TryParse(parentId, out parent) || parent <= 0)
            throw new IOException("Invalid update process.");
        try
        {
            using (var oldApp = Process.GetProcessById(parent))
                if (!oldApp.WaitForExit(30000)) return 1; // Saving failed or quitting was cancelled.
        }
        catch (ArgumentException) { } // The old app has already exited successfully.
        using (var gate = new Mutex(false, @"Local\AionCompanion.Launch"))
        {
            bool held;
            try { held = gate.WaitOne(20000); }
            catch (AbandonedMutexException) { held = true; }
            if (!held) throw new IOException("Another app launch is still finishing. Open the shortcut again.");
            try
            {
                UpdateExecutable(root, checksum);
                string previous = File.ReadAllText(Path.Combine(root, "current.txt")).Trim();
                string previousFallback = ReadOptional(Path.Combine(root, "previous.txt"));
                PublishPointer(root, Path.Combine("versions", checksum, "aion-companion.exe"));
                try
                {
                    TryMaintainInstallation(root, previous);
                    using (var started = Process.Start(new ProcessStartInfo(executable) {
                        WorkingDirectory = Path.GetDirectoryName(executable), UseShellExecute = false, CreateNoWindow = true
                    }))
                    {
                        if (started == null) throw new IOException("Windows could not launch the update.");
                        for (int i = 0; i < 40; i++)
                        {
                            if (started.HasExited) throw new IOException("The update exited during startup.");
                            if (Workspace(started.Id) != IntPtr.Zero) { RefreshInstalledVersion(root, executable); return 0; }
                            Thread.Sleep(250);
                        }
                    }
                    RefreshInstalledVersion(root, executable);
                    return 0;
                }
                catch
                {
                    PublishPointer(root, previous);
                    // A hash-valid build can still fail to start. Never promote it
                    // to the next fallback merely because its folder is newest.
                    try
                    {
                        PublishText(root, "previous.txt", previousFallback);
                        if (InstallationIdle(root) == 0 && VersionPath(root, previous) != executable)
                            RemoveOwnedFolder(Path.GetDirectoryName(executable), "aion-companion.exe");
                    }
                    catch { }
                    throw new IOException("The update could not start. The previous version was restored; open Aion Companion again.");
                }
            }
            finally { gate.ReleaseMutex(); }
        }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            // The installer runs a newly bundled copy from its temporary directory.
            // This probe never launches, closes or mutates any installed application.
            if (args.Length == 2 && args[0] == "--installation-idle")
                return InstallationIdle(args[1]);
            if (args.Length == 2 && args[0] == "--maintain-installation")
            {
                using (var gate = new Mutex(false, @"Local\AionCompanion.Launch"))
                {
                    bool held;
                    try { held = gate.WaitOne(20000); }
                    catch (AbandonedMutexException) { held = true; }
                    if (!held) return 1;
                    try { MaintainInstallation(args[1], null); return 0; }
                    finally { gate.ReleaseMutex(); }
                }
            }
            string root = AppDomain.CurrentDomain.BaseDirectory;
            bool development = Development(root);
            bool preparing = args.Length == 1 && args[0] == "--prepare-dev";
            if (preparing && !development) throw new IOException("Only the Dev launcher can prepare development.");
            bool standalone = args.Length == 1 && args[0] == "--standalone";
            bool live = development && !standalone
                && !(args.Length > 0 && args[0].StartsWith("--verify", StringComparison.Ordinal));
            if (args.Length == 2 && args[0] == "--verify-update")
            {
                UpdateExecutable(root, args[1]);
                return 0;
            }
            if (args.Length == 3 && args[0] == "--apply-update")
                return ApplyUpdate(root, args[1], args[2]);
            string versions = Path.GetFullPath(Path.Combine(root, "versions")) + Path.DirectorySeparatorChar;
            string executable = live ? ReadOptional(Path.Combine(root, "dev-executable.txt"))
                : Path.GetFullPath(Path.Combine(root, File.ReadAllText(Path.Combine(root, "current.txt")).Trim()));
            if (!live && (!executable.StartsWith(versions, StringComparison.OrdinalIgnoreCase)
                || !String.Equals(Path.GetFileName(executable), "aion-companion.exe", StringComparison.OrdinalIgnoreCase)
                || !File.Exists(executable)))
                throw new IOException(development ? "The development build is missing. Run bash dev.sh build to publish it again." : "The installed build is missing. Download and run Aion Companion Setup again to repair the installation.");

            // Checks the real installed executable and publication hash without opening a window.
            if (args.Length == 1 && args[0] == "--verify")
            {
                if (Hash(executable) != new DirectoryInfo(Path.GetDirectoryName(executable)).Name)
                    throw new IOException("The published build did not match its checksum.");
                return 0;
            }
            bool overlay = args.Length == 1 && args[0] == "--overlay";
            string workspace = ReadOptional(Path.Combine(root, "workspace.txt"));
            if (!development) RefreshInstalledVersion(root, executable);
            using (var gate = new Mutex(false, @"Local\AionCompanion.Launch"))
            {
                bool held;
                try { held = gate.WaitOne(20000); }
                catch (AbandonedMutexException) { held = true; }
                if (!held) throw new IOException("Another app launch is still finishing. Try again shortly.");
                try
                {
                    foreach (var process in Process.GetProcessesByName("aion-companion"))
                    using (process)
                    {
                        string path;
                        try { path = Path.GetFullPath(process.MainModule.FileName); }
                        catch { continue; }
                        bool owned = Owned(path, root, workspace);
                        if (!owned) continue;
                        IntPtr window = Workspace(process.Id);
                        // A launch/build is never permission to interrupt gameplay,
                        // including across channels, versions and native Dev hosts.
                        if (preparing)
                            throw new IOException("Aion Companion is running and has been left open. Native Dev was not started. Keep playing; use a browser mock preview while coding, or quit the tray app yourself when ready to test another build.");
                        // build --run must also leave the player's focus alone.
                        if (!overlay && !standalone && window != IntPtr.Zero)
                        {
                            ShowWindow(window, 9); // SW_RESTORE, including a hidden workspace.
                            SetForegroundWindow(window);
                        }
                        return 0;
                    }
                    if (preparing) return 0;
                    if (live)
                    {
                        string script = Path.Combine(workspace, "build.ps1");
                        if (!File.Exists(script)) throw new IOException("Development checkout is missing. Run bash dev.sh dev from your current checkout to set up the shortcut again.");
                        string target = String.IsNullOrEmpty(executable) ? "" : Path.GetDirectoryName(Path.GetDirectoryName(executable));
                        string targetArgument = String.IsNullOrEmpty(target) ? "" : " -TargetDirectory \"" + target + "\"";
                        Process.Start(new ProcessStartInfo("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\" -Dev" + targetArgument) {
                            WorkingDirectory = workspace, UseShellExecute = false, CreateNoWindow = true,
                            WindowStyle = ProcessWindowStyle.Hidden
                        });
                        return 0;
                    }
                    if (!development) TryMaintainInstallation(root, null);
                    using (var started = Process.Start(new ProcessStartInfo(executable, overlay ? "--overlay" : "") {
                        WorkingDirectory = Path.GetDirectoryName(executable),
                        UseShellExecute = false,
                        CreateNoWindow = true
                    }))
                    {
                        if (started == null) throw new IOException("Windows could not start Aion Companion.");
                        for (int i = 0; i < 40; i++)
                        {
                            if (started.HasExited) throw new IOException("Aion Companion exited during startup.");
                            if (Workspace(started.Id) != IntPtr.Zero) return 0;
                            Thread.Sleep(250);
                        }
                    }
                    return 0;
                }
                finally { gate.ReleaseMutex(); }
            }
        }
        catch (Exception error)
        {
            // Verification runs are noninteractive for build automation.
            if (!((args.Length == 1 && (args[0] == "--verify" || args[0] == "--prepare-dev")) || (args.Length == 2 && (args[0] == "--verify-update" || args[0] == "--installation-idle" || args[0] == "--maintain-installation"))))
                MessageBox.Show(error.Message, "Aion Companion", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static int InstallationIdle(string installation)
    {
        if (!Path.IsPathRooted(installation)) return 2;
        string root = Path.GetFullPath(installation).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string versions = root + "versions" + Path.DirectorySeparatorChar;
        int ownId = Process.GetCurrentProcess().Id;
        foreach (var process in Process.GetProcesses())
        using (process)
        {
            if (process.Id == ownId) continue;
            // Avoid probing unrelated system processes, which normally deny inspection.
            string name = process.ProcessName;
            if (!name.Equals("aion-companion", StringComparison.OrdinalIgnoreCase)
                && !name.Equals("Aion Companion", StringComparison.OrdinalIgnoreCase)) continue;
            string path;
            try { path = Path.GetFullPath(process.MainModule.FileName); }
            catch { if (!process.HasExited) return 1; else continue; }
            if (path.StartsWith(versions, StringComparison.OrdinalIgnoreCase)
                || path.Equals(root + "Aion Companion.exe", StringComparison.OrdinalIgnoreCase)) return 1;
        }
        return 0;
    }
}
