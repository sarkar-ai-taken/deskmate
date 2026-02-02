import * as os from "os";
import * as path from "path";

export const IS_MACOS = process.platform === "darwin";
export const IS_LINUX = process.platform === "linux";
export const IS_WINDOWS = process.platform === "win32";

/**
 * Returns the platform-appropriate command to take a screenshot.
 */
export function getScreenshotCommand(filepath: string): string {
  if (IS_MACOS) return `screencapture -x "${filepath}"`;
  if (IS_LINUX) return `import -window root "${filepath}"`;
  if (IS_WINDOWS)
    return `powershell -c "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object { $bmp = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size); $bmp.Save('${filepath.replace(/'/g, "''")}') }"`;
  return `echo "Screenshots not supported on ${process.platform}"`;
}

/**
 * Returns regex patterns matching protected user folders for the current OS.
 */
export function getProtectedFolderPatterns(): RegExp[] {
  const home = os.homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  if (IS_MACOS) {
    return [
      new RegExp(`^${home}/Desktop`),
      new RegExp(`^${home}/Documents`),
      new RegExp(`^${home}/Downloads`),
      new RegExp(`^${home}/Pictures`),
      new RegExp(`^${home}/Movies`),
      new RegExp(`^${home}/Music`),
      new RegExp(`^${home}/Library/Mobile Documents`),
    ];
  }

  if (IS_LINUX) {
    return [
      new RegExp(`^${home}/Desktop`),
      new RegExp(`^${home}/Documents`),
      new RegExp(`^${home}/Downloads`),
      new RegExp(`^${home}/Pictures`),
      new RegExp(`^${home}/Videos`),
      new RegExp(`^${home}/Music`),
    ];
  }

  // Windows
  const winHome = home.replace(/\\/g, "[\\\\/]");
  return [
    new RegExp(`^${winHome}[\\\\/]Desktop`, "i"),
    new RegExp(`^${winHome}[\\\\/]Documents`, "i"),
    new RegExp(`^${winHome}[\\\\/]Downloads`, "i"),
    new RegExp(`^${winHome}[\\\\/]Pictures`, "i"),
    new RegExp(`^${winHome}[\\\\/]Videos`, "i"),
    new RegExp(`^${winHome}[\\\\/]Music`, "i"),
  ];
}

/**
 * Extracts the base protected folder from a file path (e.g. /home/user/Desktop).
 * Returns null if the path is not inside a protected folder.
 */
export function extractBaseFolder(filePath: string): string | null {
  const home = os.homedir();
  const folders = IS_MACOS
    ? [
        "Desktop",
        "Documents",
        "Downloads",
        "Pictures",
        "Movies",
        "Music",
        "Library/Mobile Documents",
      ]
    : ["Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music"];

  for (const folder of folders) {
    const prefix = path.join(home, folder);
    if (filePath.startsWith(prefix)) return prefix;
  }
  return null;
}

/**
 * Returns a shell snippet for the system prompt that shows how to take a screenshot.
 */
export function getScreenshotHint(screenshotDir: string): string {
  if (IS_MACOS) {
    return `mkdir -p ${screenshotDir} && screencapture -x ${screenshotDir}/screenshot-$(date +%s).png && echo "Screenshot saved"`;
  }
  if (IS_LINUX) {
    return `mkdir -p ${screenshotDir} && import -window root ${screenshotDir}/screenshot-$(date +%s).png && echo "Screenshot saved"`;
  }
  return `echo "Use the /screenshot command instead"`;
}
