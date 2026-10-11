using System;
using System.IO;

namespace Shiori.Scripting.Host;

/// <summary>引擎根路径约束：拒绝根外与遍历。</summary>
public static class PathGuard
{
    public static bool IsUnderRoot(string path, string root)
    {
        if (string.IsNullOrWhiteSpace(path) || string.IsNullOrWhiteSpace(root))
            return false;
        try
        {
            var full = Path.GetFullPath(path);
            var r = Path.GetFullPath(root);
            if (!r.EndsWith(Path.DirectorySeparatorChar))
                r += Path.DirectorySeparatorChar;
            if (Directory.Exists(full) && !full.EndsWith(Path.DirectorySeparatorChar))
                full += Path.DirectorySeparatorChar;
            if (full.StartsWith(r, StringComparison.OrdinalIgnoreCase))
                return true;
            var fullTrim = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar);
            var rootTrim = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
            return string.Equals(fullTrim, rootTrim, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception)
        {
            return false;
        }
    }

    public static string WithSep(string root)
    {
        var r = Path.GetFullPath(root);
        if (!r.EndsWith(Path.DirectorySeparatorChar))
            r += Path.DirectorySeparatorChar;
        return r;
    }
}
